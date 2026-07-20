use anyhow::Result;
use sha2::{Digest, Sha256};

use crate::index::BlockIndex;
use crate::types::BlockId;

pub struct DedupEngine {
    index: Option<BlockIndex>,
}

impl DedupEngine {
    pub fn new(index_path: Option<&str>) -> Result<Self> {
        let index = match index_path {
            Some(path) => Some(BlockIndex::new(path)?),
            None => None,
        };
        Ok(Self { index })
    }

    pub fn calculate_id(data: &[u8]) -> BlockId {
        let hash = Sha256::digest(data);
        BlockId {
            sha256: hex::encode(hash),
            size: data.len() as u32,
        }
    }

    pub fn process_block(&self, data: &[u8]) -> Result<DedupResult> {
        let id = Self::calculate_id(data);

        let is_duplicate = match &self.index {
            Some(index) => index.block_exists(&id.sha256)?,
            None => false,
        };

        Ok(DedupResult {
            id,
            data: data.to_vec(),
            is_duplicate,
        })
    }

    pub fn record_block(&self, id: &BlockId, compressed_size: u64, storage_path: &str) -> Result<()> {
        if let Some(index) = &self.index {
            index.add_block(id, compressed_size, storage_path)?;
        }
        Ok(())
    }

    pub fn release_block(&self, sha256: &str) -> Result<bool> {
        match &self.index {
            Some(index) => index.remove_block(sha256),
            None => Ok(true),
        }
    }
}

pub struct DedupResult {
    pub id: BlockId,
    pub data: Vec<u8>,
    pub is_duplicate: bool,
}
