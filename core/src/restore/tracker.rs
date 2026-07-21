use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use super::RestoreSession;

/// In-memory restore session tracker
pub struct RestoreTracker {
    sessions: Arc<RwLock<HashMap<String, RestoreSession>>>,
}

impl RestoreTracker {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create(&self, session: RestoreSession) -> String {
        let id = session.id.clone();
        self.sessions.write().await.insert(id.clone(), session);
        id
    }

    pub async fn get(&self, id: &str) -> Option<RestoreSession> {
        self.sessions.read().await.get(id).cloned()
    }

    pub async fn update(&self, id: &str, f: impl FnOnce(&mut RestoreSession)) {
        if let Some(session) = self.sessions.write().await.get_mut(id) {
            f(session);
        }
    }

    pub async fn list(&self) -> Vec<RestoreSession> {
        self.sessions.read().await.values().cloned().collect()
    }
}
