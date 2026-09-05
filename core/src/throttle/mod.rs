use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub struct BandwidthLimiter {
    max_bps: u64,
    accumulated: Arc<AtomicU64>,
    last_check: Instant,
}

impl BandwidthLimiter {
    pub fn new(max_bps: u64) -> Self {
        Self {
            max_bps,
            accumulated: Arc::new(AtomicU64::new(0)),
            last_check: Instant::now(),
        }
    }

    pub async fn throttle(&mut self, bytes: u64) {
        if self.max_bps == 0 {
            return;
        }

        let prev = self.accumulated.fetch_add(bytes, Ordering::Relaxed);
        let total = prev + bytes;

        if total >= self.max_bps {
            let elapsed = self.last_check.elapsed().as_secs_f64();
            if elapsed < 1.0 {
                let sleep_time = (1.0 - elapsed).min(1.0);
                tokio::time::sleep(std::time::Duration::from_secs_f64(sleep_time)).await;
            }
            self.accumulated.store(0, Ordering::Relaxed);
            self.last_check = Instant::now();
        }
    }
}

pub struct IoLimiter {
    max_iops: u32,
    last_check: Instant,
    ops_in_second: u32,
}

impl IoLimiter {
    pub fn new(max_iops: u32) -> Self {
        Self {
            max_iops,
            last_check: Instant::now(),
            ops_in_second: 0,
        }
    }

    pub async fn wait(&mut self) {
        if self.max_iops == 0 {
            return;
        }

        let elapsed = self.last_check.elapsed().as_secs_f64();
        if elapsed >= 1.0 {
            self.ops_in_second = 0;
            self.last_check = Instant::now();
        }

        if self.ops_in_second >= self.max_iops {
            let sleep = (1.0 - elapsed).max(0.001);
            tokio::time::sleep(std::time::Duration::from_secs_f64(sleep)).await;
            self.ops_in_second = 0;
            self.last_check = Instant::now();
        }

        self.ops_in_second += 1;
    }
}
