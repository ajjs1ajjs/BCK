use anyhow::Result;
use crate::types::CompressionAlgorithm;

pub trait Compressor: Send + Sync {
    fn compress(&self, data: &[u8]) -> Result<Vec<u8>>;
    fn decompress(&self, data: &[u8]) -> Result<Vec<u8>>;
    fn algorithm(&self) -> &'static str;
}

pub struct ZstdCompressor {
    level: i32,
}

impl ZstdCompressor {
    pub fn new(level: i32) -> Self {
        Self { level }
    }
}

impl Compressor for ZstdCompressor {
    fn compress(&self, data: &[u8]) -> Result<Vec<u8>> {
        Ok(zstd::encode_all(std::io::Cursor::new(data), self.level)?)
    }

    fn decompress(&self, data: &[u8]) -> Result<Vec<u8>> {
        Ok(zstd::decode_all(std::io::Cursor::new(data))?)
    }

    fn algorithm(&self) -> &'static str {
        "zstd"
    }
}

pub struct Lz4Compressor;

impl Compressor for Lz4Compressor {
    fn compress(&self, data: &[u8]) -> Result<Vec<u8>> {
        Ok(lz4::block::compress(data, None, true)?)
    }

    fn decompress(&self, data: &[u8]) -> Result<Vec<u8>> {
        let decompressed = lz4::block::decompress(data, None)?;
        Ok(decompressed)
    }

    fn algorithm(&self) -> &'static str {
        "lz4"
    }
}

pub struct NoopCompressor;

impl Compressor for NoopCompressor {
    fn compress(&self, data: &[u8]) -> Result<Vec<u8>> {
        Ok(data.to_vec())
    }

    fn decompress(&self, data: &[u8]) -> Result<Vec<u8>> {
        Ok(data.to_vec())
    }

    fn algorithm(&self) -> &'static str {
        "none"
    }
}

pub fn create_compressor(algorithm: &CompressionAlgorithm) -> Box<dyn Compressor> {
    match algorithm {
        CompressionAlgorithm::Zstd { level } => Box::new(ZstdCompressor::new(*level)),
        CompressionAlgorithm::Lz4 => Box::new(Lz4Compressor),
        CompressionAlgorithm::None => Box::new(NoopCompressor),
    }
}
