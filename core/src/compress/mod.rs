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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::CompressionAlgorithm;

    #[test]
    fn test_zstd_roundtrip() {
        let compressor = ZstdCompressor::new(3);
        let data = b"Hello, BCK backup system!";
        let compressed = compressor.compress(data).unwrap();
        let decompressed = compressor.decompress(&compressed).unwrap();
        assert_eq!(decompressed, data);
    }

    #[test]
    fn test_zstd_large_data() {
        let compressor = ZstdCompressor::new(1);
        let data = vec![b'A'; 1024 * 1024];
        let compressed = compressor.compress(&data).unwrap();
        assert!(compressed.len() < data.len(), "compression should reduce size");
    }

    #[test]
    fn test_lz4_roundtrip() {
        let compressor = Lz4Compressor;
        let data = b"BCK backup system LZ4 test data";
        let compressed = compressor.compress(data).unwrap();
        let decompressed = compressor.decompress(&compressed).unwrap();
        assert_eq!(decompressed, data);
    }

    #[test]
    fn test_noop_roundtrip() {
        let compressor = NoopCompressor;
        let data = b"any data";
        assert_eq!(compressor.compress(data).unwrap(), data);
        assert_eq!(compressor.decompress(data).unwrap(), data);
    }

    #[test]
    fn test_create_zstd() {
        let algo = CompressionAlgorithm::Zstd { level: 3 };
        let compressor = create_compressor(&algo);
        assert_eq!(compressor.algorithm(), "zstd");
        let data = b"test data";
        let roundtrip = compressor.decompress(&compressor.compress(data).unwrap()).unwrap();
        assert_eq!(roundtrip, data);
    }

    #[test]
    fn test_create_lz4() {
        let compressor = create_compressor(&CompressionAlgorithm::Lz4);
        assert_eq!(compressor.algorithm(), "lz4");
    }

    #[test]
    fn test_create_noop() {
        let compressor = create_compressor(&CompressionAlgorithm::None);
        assert_eq!(compressor.algorithm(), "none");
    }

    #[test]
    fn test_zstd_multiple_levels() {
        for level in [1, 3, 10] {
            let c = ZstdCompressor::new(level);
            let data = b"BCK test data for multiple compression levels";
            let comp = c.compress(data).unwrap();
            let decomp = c.decompress(&comp).unwrap();
            assert_eq!(decomp, data, "failed at level {}", level);
        }
    }
}
