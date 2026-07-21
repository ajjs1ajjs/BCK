use anyhow::Result;
use notify::event::EventKind;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use tokio::sync::mpsc as tokio_mpsc;
use tracing::{info, warn};

use super::ChangeEvent;

/// Cross-platform filesystem watcher for CDP
pub struct FileWatcher {
    watch_paths: Vec<PathBuf>,
    event_tx: tokio_mpsc::UnboundedSender<ChangeEvent>,
    exclude_patterns: Vec<String>,
}

impl FileWatcher {
    pub fn new(
        paths: Vec<String>,
        exclude: Vec<String>,
        _buffer_size: usize,
    ) -> Self {
        let (tx, _rx) = tokio_mpsc::unbounded_channel();

        Self {
            watch_paths: paths.into_iter().map(PathBuf::from).collect(),
            event_tx: tx,
            exclude_patterns: exclude,
        }
    }

    /// Start watching filesystem for changes (blocking — spawn in tokio::task::spawn_blocking)
    pub fn start_blocking(&self) -> Result<()> {
        let (notify_tx, notify_rx) = mpsc::channel::<Result<Event, notify::Error>>();

        let mut watcher = RecommendedWatcher::new(notify_tx, Config::default())
            .map_err(|e| anyhow::anyhow!("Failed to create watcher: {:?}", e))?;

        for path in &self.watch_paths {
            watcher.watch(path, RecursiveMode::Recursive)
                .map_err(|e| anyhow::anyhow!("Failed to watch {}: {:?}", path.display(), e))?;
            info!("CDP watching: {}", path.display());
        }

        // Process events in a blocking loop
        for event_result in notify_rx {
            match event_result {
                Ok(event) => {
                    if let Err(e) = self.handle_event(&event) {
                        warn!("CDP watcher event error: {}", e);
                    }
                }
                Err(e) => warn!("CDP watcher error: {:?}", e),
            }
        }

        Ok(())
    }

    fn handle_event(&self, event: &Event) -> Result<()> {
        for path in &event.paths {
            let path_str = path.to_string_lossy().to_string();
            if self.should_exclude(&path_str) {
                continue;
            }

            let change_type = match event.kind {
                EventKind::Create(_) => super::ChangeType::Created,
                EventKind::Modify(_) => super::ChangeType::Modified,
                EventKind::Remove(_) => super::ChangeType::Deleted,
                _ => continue,
            };

            let change = ChangeEvent {
                path: path_str,
                change_type,
                timestamp: chrono::Utc::now().timestamp(),
                size: 0,
                checksum: String::new(),
            };

            let _ = self.event_tx.send(change);
        }
        Ok(())
    }

    /// Start watcher in background tokio task
    pub async fn start_watching(&self) -> Result<()> {
        let paths = self.watch_paths.clone();
        let exclude = self.exclude_patterns.clone();

        tokio::task::spawn_blocking(move || {
            let watcher = FileWatcher::new(
                paths.into_iter().map(|p| p.to_string_lossy().to_string()).collect(),
                exclude,
                1024,
            );
            let _ = watcher.start_blocking();
        }).await
            .map_err(|e| anyhow::anyhow!("Watcher task join error: {}", e))?;

        Ok(())
    }

    fn should_exclude(&self, path: &str) -> bool {
        self.exclude_patterns.iter().any(|p| path.contains(p))
    }
}
