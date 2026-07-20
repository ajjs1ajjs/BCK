use anyhow::Result;
use std::io::Read;

use crate::types::ChunkSizeConfig;

/// Content-Defined Chunking (CDC) using buzhash
pub struct Chunker {
    config: ChunkSizeConfig,
    window_size: usize,
}

impl Chunker {
    pub fn new(config: ChunkSizeConfig) -> Self {
        Self { config, window_size: 48 }
    }

    pub fn chunk_data(&self, data: &[u8]) -> Result<Vec<Chunk>> {
        let mut chunks = Vec::new();
        let mut start = 0usize;
        let len = data.len();

        while start < len {
            let end = self.find_chunk_boundary(data, start, len);
            chunks.push(Chunk {
                offset: start as u64,
                size: (end - start) as u32,
                data: data[start..end].to_vec(),
                hash: 0,
            });
            start = end;
        }

        Ok(chunks)
    }

    pub fn chunk_stream<R: Read>(&self, reader: &mut R) -> Result<Vec<Chunk>> {
        let mut buffer = Vec::new();
        reader.read_to_end(&mut buffer)?;
        self.chunk_data(&buffer)
    }

    fn find_chunk_boundary(&self, data: &[u8], start: usize, end: usize) -> usize {
        let min_size = self.config.min as usize;
        let avg_size = self.config.avg as usize;
        let max_size = self.config.max as usize;

        if start + min_size >= end {
            return end;
        }

        let search_start = (start + min_size).min(end);
        let search_end = (start + max_size).min(end);

        if search_start >= search_end {
            return search_end;
        }

        let mask = (avg_size as u32 - 1) as u64;
        // Precompute 131^window_size mod 2^64 via repeated multiplication
        let power = {
            let mut p: u64 = 1;
            for _ in 0..self.window_size {
                p = p.wrapping_mul(131);
            }
            p
        };

        let mut hash: u64 = 0;

        // Initialize hash with first window bytes
        for i in 0..self.window_size {
            let idx = search_start.saturating_sub(self.window_size).saturating_add(i);
            if idx < search_start {
                let byte = data.get(idx).copied().unwrap_or(0);
                hash = hash.wrapping_mul(131).wrapping_add(byte as u64);
            }
        }

        // Slide through the search window
        for i in search_start..search_end {
            let entering = if i + self.window_size <= search_end {
                data[i]
            } else {
                0
            };
            let exiting = if i >= self.window_size + 1 {
                data[i - self.window_size - 1]
            } else {
                0
            };

            hash = hash.wrapping_mul(131).wrapping_add(entering as u64);
            hash = hash.wrapping_sub((exiting as u64).wrapping_mul(power));

            if (hash & mask) == 0 && i - start >= min_size {
                return i + 1;
            }
        }

        search_end
    }
}

#[derive(Debug, Clone)]
pub struct Chunk {
    pub offset: u64,
    pub size: u32,
    pub data: Vec<u8>,
    pub hash: u64,
}

impl Default for Chunker {
    fn default() -> Self {
        Self::new(ChunkSizeConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ChunkSizeConfig;

    fn test_chunker() -> Chunker {
        Chunker::new(ChunkSizeConfig { min: 256, avg: 1024, max: 4096 })
    }

    #[test]
    fn test_chunker_small_data() {
        let chunker = test_chunker();
        let data = b"hello world";
        let chunks = chunker.chunk_data(data).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].data, data);
    }

    #[test]
    fn test_chunker_large_data() {
        let chunker = test_chunker();
        let data = vec![b'A'; 100_000];
        let chunks = chunker.chunk_data(&data).unwrap();
        assert!(chunks.len() > 1, "should produce multiple chunks");
        let total: usize = chunks.iter().map(|c| c.data.len()).sum();
        assert_eq!(total, data.len());
    }

    #[test]
    fn test_chunker_deterministic() {
        let chunker = test_chunker();
        let data = vec![0u8; 50_000];
        let chunks1 = chunker.chunk_data(&data).unwrap();
        let chunks2 = chunker.chunk_data(&data).unwrap();
        assert_eq!(chunks1.len(), chunks2.len());
        for (a, b) in chunks1.iter().zip(chunks2.iter()) {
            assert_eq!(a.offset, b.offset);
            assert_eq!(a.size, b.size);
        }
    }

    #[test]
    fn test_chunker_boundary_respects_min_size() {
        let chunker = test_chunker();
        let data = vec![0u8; 10_000];
        let chunks = chunker.chunk_data(&data).unwrap();
        for (i, c) in chunks.iter().enumerate() {
            if i < chunks.len() - 1 {
                assert!(c.size >= 256, "chunk {} too small: {}", i, c.size);
            }
        }
    }

    #[test]
    fn test_chunker_empty_data() {
        let chunker = test_chunker();
        let chunks = chunker.chunk_data(b"").unwrap();
        assert!(chunks.is_empty());
    }
}
