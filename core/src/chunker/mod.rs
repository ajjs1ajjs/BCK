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
            hash = hash.wrapping_sub(exiting as u64 * 131u64.wrapping_pow(self.window_size as u32));

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
