use anyhow::Result;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct ProgressTracker {
    processed: Arc<AtomicU64>,
    total: u64,
    start_time: Instant,
    last_report: Instant,
}

impl ProgressTracker {
    pub fn new(total: u64) -> Self {
        Self {
            processed: Arc::new(AtomicU64::new(0)),
            total,
            start_time: Instant::now(),
            last_report: Instant::now(),
        }
    }

    pub fn add(&self, bytes: u64) {
        self.processed.fetch_add(bytes, Ordering::Relaxed);
    }

    pub fn set(&self, value: u64) {
        self.processed.store(value, Ordering::Relaxed);
    }

    pub fn progress_pct(&self) -> f64 {
        let processed = self.processed.load(Ordering::Relaxed);
        if self.total == 0 {
            return 100.0;
        }
        (processed as f64 / self.total as f64) * 100.0
    }

    pub fn processed_bytes(&self) -> u64 {
        self.processed.load(Ordering::Relaxed)
    }

    pub fn speed_bps(&self) -> u64 {
        let elapsed = self.start_time.elapsed().as_secs().max(1);
        self.processed.load(Ordering::Relaxed) / elapsed
    }

    pub fn elapsed_seconds(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }

    pub fn eta_seconds(&self) -> u64 {
        let speed = self.speed_bps();
        if speed == 0 {
            return 0;
        }
        let remaining = self.total.saturating_sub(self.processed.load(Ordering::Relaxed));
        remaining / speed
    }

    pub fn report(&self) -> ProgressReport {
        ProgressReport {
            progress_pct: self.progress_pct(),
            processed_bytes: self.processed_bytes(),
            total_bytes: self.total,
            speed_bps: self.speed_bps(),
            elapsed_seconds: self.elapsed_seconds(),
            eta_seconds: self.eta_seconds(),
        }
    }
}

pub struct ProgressReport {
    pub progress_pct: f64,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
    pub elapsed_seconds: u64,
    pub eta_seconds: u64,
}

pub struct TransferBuffer {
    buffer: Vec<u8>,
    chunk_size: usize,
}

impl TransferBuffer {
    pub fn new(chunk_size: usize) -> Self {
        Self { buffer: Vec::with_capacity(chunk_size), chunk_size }
    }

    pub fn push(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    pub fn drain(&mut self) -> Vec<u8> {
        self.buffer.drain(..).collect()
    }

    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    pub fn is_full(&self) -> bool {
        self.buffer.len() >= self.chunk_size
    }
}
