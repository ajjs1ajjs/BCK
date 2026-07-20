use std::pin::Pin;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::info;

pub mod bck_proto {
    include!(concat!(env!("OUT_DIR"), "/bck.rs"));
}

use bck_proto::backup_engine_server::BackupEngine;
use bck_proto::{
    Empty, JobConfig, JobHandle, ProgressReport, SnapshotQuery, SnapshotList,
    ValidationResult, RestoreConfig, RestoreProgress, FileRestoreRequest,
    InstantRecoveryConfig, EngineStats, HealthStatus, RepositoryRef, RepositoryStats,
};

pub struct BackupEngineImpl;

impl BackupEngineImpl {
    pub fn new() -> Self {
        Self
    }
}

#[tonic::async_trait]
impl BackupEngine for BackupEngineImpl {
    async fn start_job(
        &self,
        request: Request<JobConfig>,
    ) -> Result<Response<JobHandle>, Status> {
        let config = request.into_inner();
        info!("gRPC start_job: {:?}", config.name);

        Ok(Response::new(JobHandle {
            job_id: config.id.clone(),
            session_id: uuid::Uuid::new_v4().to_string(),
            status: "running".into(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }))
    }

    async fn cancel_job(
        &self,
        request: Request<JobHandle>,
    ) -> Result<Response<Empty>, Status> {
        let handle = request.into_inner();
        info!("gRPC cancel_job: {}", handle.job_id);
        Ok(Response::new(Empty {}))
    }

    type StreamProgressStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<ProgressReport, Status>> + Send>>;

    async fn stream_progress(
        &self,
        request: Request<JobHandle>,
    ) -> Result<Response<Self::StreamProgressStream>, Status> {
        let _handle = request.into_inner();
        let (tx, rx) = mpsc::channel(100);

        tokio::spawn(async move {
            // Simulate progress updates
            for i in 0..100 {
                let report = ProgressReport {
                    progress_pct: i as f64,
                    processed_bytes: (i * 1000) as u64,
                    total_bytes: 100000,
                    transferred_bytes: (i * 800) as u64,
                    files_processed: i as u64,
                    files_total: 100,
                    speed_bps: 50000000,
                    current_item: format!("file_{}.dat", i),
                    phase: "transfer".into(),
                    status: if i < 99 { "running".into() } else { "completed".into() },
                    elapsed_seconds: i as u32,
                    eta_seconds: (100 - i) as u32,
                    bottleneck: "network".into(),
                    dedup_ratio: 2.5,
                    compression_ratio: 1.8,
                    ..Default::default()
                };

                if tx.send(Ok(report)).await.is_err() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    async fn list_snapshots(
        &self,
        _request: Request<SnapshotQuery>,
    ) -> Result<Response<SnapshotList>, Status> {
        Ok(Response::new(SnapshotList {
            snapshots: vec![],
            total: 0,
        }))
    }

    async fn validate_config(
        &self,
        _request: Request<JobConfig>,
    ) -> Result<Response<ValidationResult>, Status> {
        Ok(Response::new(ValidationResult {
            valid: true,
            errors: vec![],
            warnings: vec![],
        }))
    }

    type RestoreStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<RestoreProgress, Status>> + Send>>;

    async fn restore(
        &self,
        _request: Request<RestoreConfig>,
    ) -> Result<Response<Self::RestoreStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        tokio::spawn(async move {
            let _ = tx.send(Ok(RestoreProgress {
                progress_pct: 100.0,
                status: "completed".into(),
                ..Default::default()
            })).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    type RestoreFileStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<RestoreProgress, Status>> + Send>>;

    async fn restore_file(
        &self,
        _request: Request<FileRestoreRequest>,
    ) -> Result<Response<Self::RestoreFileStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        tokio::spawn(async move {
            let _ = tx.send(Ok(RestoreProgress::default())).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    type InstantRecoveryStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<RestoreProgress, Status>> + Send>>;

    async fn instant_recovery(
        &self,
        _request: Request<InstantRecoveryConfig>,
    ) -> Result<Response<Self::InstantRecoveryStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        tokio::spawn(async move {
            let _ = tx.send(Ok(RestoreProgress::default())).await;
        });
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    async fn get_stats(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<EngineStats>, Status> {
        Ok(Response::new(EngineStats::default()))
    }

    async fn check_health(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<HealthStatus>, Status> {
        Ok(Response::new(HealthStatus {
            status: "healthy".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            uptime: 0,
            components: vec![],
        }))
    }

    async fn get_repository_stats(
        &self,
        _request: Request<RepositoryRef>,
    ) -> Result<Response<RepositoryStats>, Status> {
        Ok(Response::new(RepositoryStats::default()))
    }
}
