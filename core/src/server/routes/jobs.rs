use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::server::AppState;
use crate::types::{JobInfo, JobStatus, BackupStats};

#[derive(Serialize)]
pub struct JobResponse {
    pub id: String,
    pub name: String,
    pub status: String,
    pub progress: f64,
    pub stats: Option<BackupStats>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

impl From<JobInfo> for JobResponse {
    fn from(job: JobInfo) -> Self {
        Self {
            id: job.id.to_string(),
            name: job.name,
            status: match job.status {
                JobStatus::Pending => "pending".into(),
                JobStatus::Running => "running".into(),
                JobStatus::Completed => "completed".into(),
                JobStatus::Failed(ref e) => format!("failed: {}", e),
                JobStatus::Cancelled => "cancelled".into(),
            },
            progress: job.progress,
            stats: job.stats,
            started_at: job.started_at,
            finished_at: job.finished_at,
        }
    }
}

#[derive(Deserialize)]
pub struct CreateJobRequest {
    pub name: String,
    pub job_type: String,
    pub backup_type: String,
    pub source_path: String,
    pub repository_id: String,
    pub schedule: Option<String>,
    pub retention_days: Option<i32>,
}

#[derive(Deserialize)]
pub struct UpdateJobRequest {
    pub name: Option<String>,
    pub schedule: Option<String>,
    pub enabled: Option<bool>,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_jobs).post(create_job))
        .route("/{id}", axum::routing::get(get_job).put(update_job).delete(delete_job))
        .route("/{id}/run", axum::routing::post(run_job))
        .route("/{id}/cancel", axum::routing::post(cancel_job))
}

async fn list_jobs(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<JobResponse>> {
    let jm = state.job_manager.lock().await;
    let jobs = jm.list_jobs().await;
    Json(jobs.into_iter().map(JobResponse::from).collect())
}

async fn create_job(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateJobRequest>,
) -> Result<Json<JobResponse>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let id = jm.register_job(&req.name).await;
    let job = jm.get_job(&id).await
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(JobResponse::from(job)))
}

async fn get_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JobResponse>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let job = jm.get_job(&id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(JobResponse::from(job)))
}

async fn update_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(_req): Json<UpdateJobRequest>,
) -> Result<Json<JobResponse>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let job = jm.get_job(&id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(JobResponse::from(job)))
}

async fn delete_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> StatusCode {
    let jm = state.job_manager.lock().await;
    match jm.cancel_job(&id).await {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

async fn run_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JobResponse>, StatusCode> {
    let jm = state.job_manager.lock().await;
    jm.start_job(&id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let job = jm.get_job(&id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(JobResponse::from(job)))
}

async fn cancel_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JobResponse>, StatusCode> {
    let jm = state.job_manager.lock().await;
    jm.cancel_job(&id).await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let job = jm.get_job(&id).await
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(JobResponse::from(job)))
}
