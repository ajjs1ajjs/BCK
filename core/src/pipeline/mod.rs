use anyhow::Result;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::chunker::{Chunk, Chunker};
use crate::compress::{create_compressor, Compressor};
use crate::dedup::DedupEngine;
use crate::encrypt::Encryptor;
use crate::scanner::{create_scanner, FileScanner};
use crate::storage::StorageBackend;
use crate::stream::ProgressTracker;
use crate::throttle::BandwidthLimiter;
use crate::types::{
    BackupStats, CompressionAlgorithm, EncryptionAlgorithm, FileBlock, FileMetadata,
    PipelineConfig,
};

pub struct BackupPipeline {
    config: PipelineConfig,
    scanner: Box<dyn FileScanner>,
    chunker: Chunker,
    dedup: Option<DedupEngine>,
    compressor: Box<dyn Compressor>,
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

        Self {
            config,
            scanner: create_scanner("local"),
            chunker: Chunker::new(chunk_size),
            dedup: None,
            compressor,
            progress: None,
            throttler,
        }
    }

    pub fn with_dedup(mut self, index_path: &str) -> Result<Self> {
        self.dedup = Some(DedupEngine::new(Some(index_path))?);
        Ok(self)
    }

    pub async fn run(
        &mut self,
        source_path: &str,
        storage: &dyn StorageBackend,
    ) -> Result<BackupStats> {
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

        for file in &scan_result.files {
            let file_data = tokio::fs::read(&file.path).await?;
            let chunks = self.chunker.chunk_data(&file_data)?;

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

                if dedup_result.is_duplicate {
                    stats.blocks_deduped += 1;
                    continue;
                }

                // Compress
                let compressed = self.compressor.compress(&dedup_result.data)?;
                stats.compressed_bytes += compressed.len() as u64;

                // Encrypt (if configured)
                let final_data = match &self.config.encryption {
                    EncryptionAlgorithm::None => compressed,
                    _ => compressed, // TODO: integrate encryptor
                };

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

        stats.unique_bytes = stats.blocks_unique as u64 * 8192; // estimate
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

        Ok(stats)
    }
}
