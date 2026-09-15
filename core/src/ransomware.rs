//! P2 ransomware heuristic (10/10 minimal viable).
//!
//! Encrypted-by-ransomware data has two cheap observable properties in the
//! backup pipeline stats: it barely compresses (ratio ≈ 1.0) and barely
//! dedups (ratio ≈ 1.0). A sudden collapse of BOTH ratios on a previously
//! healthy job is a strong smoke signal — not a verdict. We emit an event
//! (`ransomware_suspected`) so operators/SIEM can quarantine, never
//! auto-delete.

use crate::types::BackupStats;

/// Returns true when stats look like encrypted (ransomware) input:
/// large enough sample + compression AND dedup both collapsed.
pub fn suspected(stats: &BackupStats) -> bool {
    if stats.total_bytes < 10 * 1024 * 1024 {
        return false; // too small to judge
    }
    if stats.compressed_bytes == 0 || stats.unique_bytes == 0 {
        return false;
    }
    let compression_ratio = stats.compressed_bytes as f64 / stats.total_bytes.max(1) as f64;
    let dedup_ratio = stats.total_bytes.max(1) as f64 / stats.unique_bytes.max(1) as f64;
    compression_ratio > 0.95 && dedup_ratio < 1.05
}

/// Shannon entropy of a sample (0..8 bits/byte). Encrypted/compressed data
/// scores >7.5; text/code scores ~4-6. Used by future per-chunk scanning.
pub fn shannon_entropy(sample: &[u8]) -> f64 {
    if sample.is_empty() {
        return 0.0;
    }
    let mut freq = [0u64; 256];
    for b in sample {
        freq[*b as usize] += 1;
    }
    let n = sample.len() as f64;
    freq.iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / n;
            -p * p.log2()
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn healthy_backup_not_flagged() {
        let s = BackupStats {
            total_bytes: 100_000_000,
            unique_bytes: 40_000_000,
            compressed_bytes: 30_000_000,
            transferred_bytes: 0,
            files_processed: 100,
            blocks_deduped: 60,
            blocks_unique: 40,
            speed_bps: 0,
            dedup_ratio: 2.5,
            compression_ratio: 0.3,
            elapsed_seconds: 10,
        };
        assert!(!suspected(&s));
    }

    #[test]
    fn encrypted_burst_flagged() {
        let s = BackupStats {
            total_bytes: 100_000_000,
            unique_bytes: 99_000_000,
            compressed_bytes: 98_000_000,
            transferred_bytes: 0,
            files_processed: 100,
            blocks_deduped: 1,
            blocks_unique: 99,
            speed_bps: 0,
            dedup_ratio: 1.01,
            compression_ratio: 0.98,
            elapsed_seconds: 10,
        };
        assert!(suspected(&s));
    }

    #[test]
    fn entropy_separates_text_from_random() {
        assert!(shannon_entropy(b"hello world hello world") < 6.0);
        let rnd: Vec<u8> = (0..=255u8).cycle().take(1024).collect();
        assert!(shannon_entropy(&rnd) > 7.0);
    }
}
