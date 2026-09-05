use anyhow::Result;
use std::collections::HashMap;

use crate::chunker::Chunker;
use crate::compress::{create_compressor, Compressor};
use crate::dedup::DedupEngine;
use crate::encrypt::{create_encryptor, Encryptor};
use crate::scanner::{create_scanner, FileScanner};
use crate::storage::StorageBackend;
use crate::stream::ProgressTracker;
use crate::throttle::BandwidthLimiter;
use crate::types::{
    BackupStats, CompressionAlgorithm, EncryptionAlgorithm, FileBlock, FileMetadata, PipelineConfig,
};

// Block encoding magic markers.
// Layout of a stored block: [magic] ([nonce 12 bytes if encrypted]) [payload]
pub const MAGIC_RAW: u8 = 0x00;
pub const MAGIC_ZSTD: u8 = 0x01;
pub const MAGIC_LZ4: u8 = 0x02;
pub const MAGIC_RAW_AES: u8 = 0x31;
pub const MAGIC_ZSTD_AES: u8 = 0x11;
pub const MAGIC_LZ4_AES: u8 = 0x21;
pub const MAGIC_RAW_CHACHA: u8 = 0x32;
pub const MAGIC_ZSTD_CHACHA: u8 = 0x12;
pub const MAGIC_LZ4_CHACHA: u8 = 0x22;

pub const NONCE_LEN: usize = 12;

#[derive(Debug)]
pub struct BackupResult {
    pub stats: BackupStats,
    pub blocks: Vec<FileBlock>,
}

pub struct BackupPipeline {
    config: PipelineConfig,
    scanner: Box<dyn FileScanner>,
    chunker: Chunker,
    dedup: Option<DedupEngine>,
    compressor: Box<dyn Compressor>,
    encryptor: Option<Box<dyn Encryptor>>,
    progress: Option<ProgressTracker>,
    throttler: Option<BandwidthLimiter>,
}

impl BackupPipeline {
    pub fn new(config: PipelineConfig) -> Self {
        let chunk_size = config.chunk_size.clone();
        let throttler = config.throttle.as_ref().map(|t| BandwidthLimiter::new(t.bandwidth_bps));
        let compressor = match &config.compression {
            CompressionAlgorithm::None => create_compressor(&CompressionAlgorithm::None),
            CompressionAlgorithm::Zstd { level } => create_compressor(&CompressionAlgorithm::Zstd { level: *level }),
            CompressionAlgorithm::Lz4 => create_compressor(&CompressionAlgorithm::Lz4),
        };

        let encryptor = if config.encryption != EncryptionAlgorithm::None
            && config.encryption_key.is_some() {
            Some(create_encryptor(&config.encryption))
        } else {
            None
        };

        Self {
            config,
            scanner: create_scanner("local"),
            chunker: Chunker::new(chunk_size),
            dedup: None,
            compressor,
            encryptor,
            progress: None,
            throttler,
        }
    }

    pub fn with_dedup(mut self, index_path: &str) -> Result<Self> {
        self.dedup = Some(DedupEngine::new(Some(index_path))?);
        Ok(self)
    }

    pub fn block_magic(&self) -> u8 {
        block_magic(&self.config.compression, &self.config.encryption)
    }

    fn encode_block(&self, compressed: &[u8]) -> Result<Vec<u8>> {
        let magic = self.block_magic();
        let mut out = vec![magic];
        match (&self.encryptor, &self.config.encryption_key) {
            (Some(enc), Some(key)) => {
                let encrypted = enc.encrypt(compressed, key)?;
                out.extend_from_slice(&encrypted.nonce);
                out.extend_from_slice(&encrypted.ciphertext);
            }
            _ => {
                out.extend_from_slice(compressed);
            }
        }
        Ok(out)
    }

    pub async fn run(
        &mut self,
        source_path: &str,
        storage: &dyn StorageBackend,
    ) -> Result<BackupResult> {
        let scan_result = self.scanner.scan(source_path).await?;
        let total_bytes = scan_result.total_size;

        self.progress = Some(ProgressTracker::new(total_bytes));

        let mut stats = BackupStats {
            total_bytes,
            unique_bytes: 0,
            compressed_bytes: 0,
            transferred_bytes: 0,
            files_processed: 0,
            blocks_deduped: 0,
            blocks_unique: 0,
            speed_bps: 0,
            dedup_ratio: 1.0,
            compression_ratio: 1.0,
            elapsed_seconds: 0,
        };

        let mut blocks: Vec<FileBlock> = Vec::new();

        for file in &scan_result.files {
            // Stream the file through the chunker instead of loading it into
            // memory — multi-GB files previously caused OOM.
            let file_handle = std::fs::File::open(&file.path)?;
            let mut reader = std::io::BufReader::new(file_handle);
            let chunks = self.chunker.chunk_reader(&mut reader)?;

            for chunk in &chunks {
                // Dedup
                let dedup_result = match &self.dedup {
                    Some(dedup) => dedup.process_block(&chunk.data)?,
                    None => crate::dedup::DedupResult {
                        id: crate::dedup::DedupEngine::calculate_id(&chunk.data),
                        data: chunk.data.clone(),
                        is_duplicate: false,
                    },
                };

                // Record the block reference regardless of dedup so the
                // manifest can be used for restore.
                blocks.push(FileBlock {
                    relative_path: file.relative_path.clone(),
                    offset: chunk.offset,
                    size: chunk.size,
                    block_id: dedup_result.id.clone(),
                    metadata: file.metadata.clone(),
                });

                if dedup_result.is_duplicate {
                    stats.blocks_deduped += 1;
                    continue;
                }

                // Compress
                let compressed = self.compressor.compress(&dedup_result.data)?;
                stats.compressed_bytes += compressed.len() as u64;

                // Encrypt + wrap with magic marker
                let final_data = self.encode_block(&compressed)?;

                // Write to storage
                storage.write_block(&dedup_result.id.sha256, &final_data).await?;

                // Record in dedup index
                if let Some(dedup) = &self.dedup {
                    dedup.record_block(&dedup_result.id, final_data.len() as u64, &dedup_result.id.sha256)?;
                }

                stats.blocks_unique += 1;
                stats.transferred_bytes += final_data.len() as u64;

                // Throttle
                if let Some(throttler) = &mut self.throttler {
                    throttler.throttle(final_data.len() as u64).await;
                }
            }

            stats.files_processed += 1;
            stats.unique_bytes += file.metadata.size;

            if let Some(progress) = &self.progress {
                progress.add(file.metadata.size);
            }
        }

        stats.dedup_ratio = if stats.blocks_unique > 0 {
            (stats.blocks_deduped as f64 + stats.blocks_unique as f64) / stats.blocks_unique as f64
        } else {
            1.0
        };
        stats.compression_ratio = if stats.compressed_bytes > 0 {
            stats.total_bytes as f64 / stats.compressed_bytes as f64
        } else {
            1.0
        };

        if let Some(progress) = &self.progress {
            stats.elapsed_seconds = progress.elapsed_seconds();
            stats.speed_bps = progress.speed_bps();
        }

        Ok(BackupResult { stats, blocks })
    }

    /// Process raw bytes through the pipeline (chunk → dedup → compress →
    /// encrypt → write) without a filesystem source. Used for non-file backup
    /// sources such as VM virtual disks. `logical_path` becomes the relative
    /// path recorded in the manifest; `base_offset` is the absolute byte
    /// offset within the logical disk, so blocks can be reassembled later.
    pub async fn process_bytes(
        &mut self,
        logical_path: &str,
        base_offset: u64,
        logical_size: u64,
        data: &[u8],
        storage: &dyn StorageBackend,
        stats: &mut BackupStats,
    ) -> Result<Vec<FileBlock>> {
        let chunks = self.chunker.chunk_data(data)?;

        let metadata = FileMetadata {
            path: logical_path.to_string(),
            size: logical_size,
            modified_time: 0,
            mode: 0,
            owner: "vm".into(),
            group: "vm".into(),
            extended_attributes: HashMap::new(),
            acl: Vec::new(),
        };

        let mut blocks = Vec::new();
        for chunk in &chunks {
            // Dedup
            let dedup_result = match &self.dedup {
                Some(dedup) => dedup.process_block(&chunk.data)?,
                None => crate::dedup::DedupResult {
                    id: crate::dedup::DedupEngine::calculate_id(&chunk.data),
                    data: chunk.data.clone(),
                    is_duplicate: false,
                },
            };

            blocks.push(FileBlock {
                relative_path: logical_path.to_string(),
                offset: base_offset + chunk.offset,
                size: chunk.size,
                block_id: dedup_result.id.clone(),
                metadata: metadata.clone(),
            });

            if dedup_result.is_duplicate {
                stats.blocks_deduped += 1;
                continue;
            }

            // Compress
            let compressed = self.compressor.compress(&dedup_result.data)?;
            stats.compressed_bytes += compressed.len() as u64;

            // Encrypt + wrap with magic marker
            let final_data = self.encode_block(&compressed)?;

            // Write to storage
            storage.write_block(&dedup_result.id.sha256, &final_data).await?;

            // Record in dedup index
            if let Some(dedup) = &self.dedup {
                dedup.record_block(&dedup_result.id, final_data.len() as u64, &dedup_result.id.sha256)?;
            }

            stats.blocks_unique += 1;
            stats.transferred_bytes += final_data.len() as u64;
            stats.unique_bytes += chunk.size as u64;

            // Throttle
            if let Some(throttler) = &mut self.throttler {
                throttler.throttle(final_data.len() as u64).await;
            }
        }

        Ok(blocks)
    }
}

pub fn block_magic(compression: &CompressionAlgorithm, encryption: &EncryptionAlgorithm) -> u8 {
    match (compression, encryption) {
        (CompressionAlgorithm::None, EncryptionAlgorithm::None) => MAGIC_RAW,
        (CompressionAlgorithm::Zstd { .. }, EncryptionAlgorithm::None) => MAGIC_ZSTD,
        (CompressionAlgorithm::Lz4, EncryptionAlgorithm::None) => MAGIC_LZ4,
        (CompressionAlgorithm::None, EncryptionAlgorithm::Aes256Gcm) => MAGIC_RAW_AES,
        (CompressionAlgorithm::Zstd { .. }, EncryptionAlgorithm::Aes256Gcm) => MAGIC_ZSTD_AES,
        (CompressionAlgorithm::Lz4, EncryptionAlgorithm::Aes256Gcm) => MAGIC_LZ4_AES,
        (CompressionAlgorithm::None, EncryptionAlgorithm::ChaCha20Poly1305) => MAGIC_RAW_CHACHA,
        (CompressionAlgorithm::Zstd { .. }, EncryptionAlgorithm::ChaCha20Poly1305) => MAGIC_ZSTD_CHACHA,
        (CompressionAlgorithm::Lz4, EncryptionAlgorithm::ChaCha20Poly1305) => MAGIC_LZ4_CHACHA,
    }
}

/// Reverses `encode_block`: decrypts (if needed) and decompresses a stored block.
pub fn decode_block(data: &[u8], key: Option<&[u8]>) -> Result<Vec<u8>> {
    if data.is_empty() {
        anyhow::bail!("empty block data");
    }
    let magic = data[0];
    let encrypted = matches!(
        magic,
        MAGIC_RAW_AES | MAGIC_ZSTD_AES | MAGIC_LZ4_AES | MAGIC_RAW_CHACHA | MAGIC_ZSTD_CHACHA | MAGIC_LZ4_CHACHA
    );

    let payload: Vec<u8> = if encrypted {
        if data.len() < 1 + NONCE_LEN {
            anyhow::bail!("encrypted block too short");
        }
        let key = key.ok_or_else(|| anyhow::anyhow!("encrypted block requires a key"))?;
        let nonce = &data[1..1 + NONCE_LEN];
        let ciphertext = &data[1 + NONCE_LEN..];

        let algo = if matches!(magic, MAGIC_RAW_AES | MAGIC_ZSTD_AES | MAGIC_LZ4_AES) {
            EncryptionAlgorithm::Aes256Gcm
        } else {
            EncryptionAlgorithm::ChaCha20Poly1305
        };
        let enc = create_encryptor(&algo);
        let encrypted_data = crate::encrypt::EncryptedData {
            ciphertext: ciphertext.to_vec(),
            nonce: nonce.to_vec(),
            algorithm: String::new(),
            key_check: [0u8; 8],
        };
        enc.decrypt(&encrypted_data, key)?
    } else {
        data[1..].to_vec()
    };

    let out = match magic {
        MAGIC_ZSTD | MAGIC_ZSTD_AES | MAGIC_ZSTD_CHACHA => {
            crate::compress::ZstdCompressor::new(3).decompress(&payload)?
        }
        MAGIC_LZ4 | MAGIC_LZ4_AES | MAGIC_LZ4_CHACHA => {
            crate::compress::Lz4Compressor.decompress(&payload)?
        }
        _ => payload,
    };
    // Anti-decompression-bomb: single block must not expand beyond 64 MB.
    const MAX_BLOCK_DECOMPRESSED: usize = 64 * 1024 * 1024;
    if out.len() > MAX_BLOCK_DECOMPRESSED {
        anyhow::bail!("decompressed block too large: {} > {}", out.len(), MAX_BLOCK_DECOMPRESSED);
    }
    Ok(out)
}
