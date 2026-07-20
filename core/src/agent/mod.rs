pub mod vss;
pub mod appaware;
pub mod discovery;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub agent_id: String,
    pub hostname: String,
    pub ip_address: Option<String>,
    pub os_type: String,
    pub os_version: String,
    pub agent_version: String,
    pub status: AgentStatus,
    pub last_seen: i64,
    pub capabilities: Vec<AgentCapability>,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub disk_free_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Online,
    Offline,
    Busy,
    Updating,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentCapability {
    FileSystem,
    VolumeSnapshot,
    Vss,
    AppAwareSql,
    AppAwareOracle,
    AppAwarePostgres,
    AppAwareExchange,
    AppAwareActiveDirectory,
}

pub struct AgentManager {
    agents: Arc<RwLock<HashMap<String, AgentInfo>>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self { agents: Arc::new(RwLock::new(HashMap::new())) }
    }

    pub async fn register(&self, info: AgentInfo) {
        let hostname = info.hostname.clone();
        let agent_id = info.agent_id.clone();
        let mut agents = self.agents.write().await;
        agents.insert(agent_id.clone(), info);
        info!("Agent registered: {} ({})", hostname, agent_id);
    }

    pub async fn heartbeat(&self, agent_id: &str, cpu: f64, mem: f64, disk_free: u64) -> bool {
        let mut agents = self.agents.write().await;
        if let Some(agent) = agents.get_mut(agent_id) {
            agent.cpu_usage = cpu;
            agent.memory_usage = mem;
            agent.disk_free_bytes = disk_free;
            agent.last_seen = chrono::Utc::now().timestamp();
            agent.status = AgentStatus::Online;
            true
        } else {
            warn!("Heartbeat from unknown agent: {}", agent_id);
            false
        }
    }

    pub async fn set_offline(&self, agent_id: &str) {
        let mut agents = self.agents.write().await;
        if let Some(agent) = agents.get_mut(agent_id) {
            agent.status = AgentStatus::Offline;
        }
    }

    pub async fn get_agent(&self, agent_id: &str) -> Option<AgentInfo> {
        self.agents.read().await.get(agent_id).cloned()
    }

    pub async fn list_agents(&self) -> Vec<AgentInfo> {
        self.agents.read().await.values().cloned().collect()
    }

    pub async fn get_online_agents(&self) -> Vec<AgentInfo> {
        self.agents.read().await.values()
            .filter(|a| a.status == AgentStatus::Online)
            .cloned()
            .collect()
    }

    pub async fn remove_stale(&self, max_age_seconds: i64) {
        let now = chrono::Utc::now().timestamp();
        let mut agents = self.agents.write().await;
        agents.retain(|_, a| now - a.last_seen < max_age_seconds);
    }

    pub fn into_inner(self) -> Arc<RwLock<HashMap<String, AgentInfo>>> {
        self.agents
    }
}
