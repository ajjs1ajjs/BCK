use axum::{
    extract::{Path, State},
    Json,
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::job::JobView;
use crate::server::AppState;

#[derive(Deserialize)]
pub struct CreateJobRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_job_type")]
    pub job_type: String,
    #[serde(default = "default_backup_type")]
    pub backup_type: String,
    pub source_path: String,
    pub repository_id: String,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub retention_days: Option<i32>,
}

#[derive(Deserialize)]
pub struct UpdateJobRequest {
    pub name: Option<String>,
    pub schedule: Option<String>,
    pub enabled: Option<bool>,
}

fn default_job_type() -> String {
    "file".into()
}
fn default_backup_type() -> String {
    "full".into()
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_jobs).post(create_job))
        .route("/:id", axum::routing::get(get_job).put(update_job).delete(delete_job))
        .route("/:id/run", axum::routing::post(run_job))
        .route("/:id/cancel", axum::routing::post(cancel_job))
}

async fn list_jobs(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<JobView>>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let jobs = jm.list_jobs().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(jobs))
}

async fn create_job(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateJobRequest>,
) -> Result<Json<JobView>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let id = jm.register_job(
        &req.name,
        req.description.as_deref(),
        &req.job_type,
        &req.backup_type,
        &req.source_path,
        &req.repository_id,
        req.schedule.as_deref(),
        req.retention_days,
    ).await.map_err(|e| {
        tracing::error!("create job: {}", e);
        StatusCode::BAD_REQUEST
    })?;
    drop(jm);

    let jm = state.job_manager.lock().await;
    let job = jm.get_job(&id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(jm);

    if let Some(model) = state.job_manager.lock().await.load_job_models()
        .await.ok().and_then(|jobs| jobs.into_iter().find(|j| j.id == id))
    {
        let sched = state.scheduler.lock().await;
        sched.add_job(&model).await;
    }

    Ok(Json(job))
}

async fn get_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JobView>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let job = jm.get_job(&id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(job))
}

async fn update_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<UpdateJobRequest>,
) -> Result<Json<JobView>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let found = jm.update_job(&id, req.name.as_deref(), req.schedule.as_deref().map(Some), req.enabled).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !found {
        return Err(StatusCode::NOT_FOUND);
    }
    let job = jm.get_job(&id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    drop(jm);

    if let Some(model) = state.job_manager.lock().await.load_job_models()
        .await.ok().and_then(|jobs| jobs.into_iter().find(|j| j.id == id))
    {
        let sched = state.scheduler.lock().await;
        sched.update_job(&model).await;
    }
    Ok(Json(job))
}

async fn delete_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let jm = state.job_manager.lock().await;
    let deleted = jm.delete_job(&id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !deleted {
        return Err(StatusCode::NOT_FOUND);
    }
    drop(jm);

    let sched = state.scheduler.lock().await;
    sched.remove_job(&id).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn run_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JobView>, StatusCode> {
    let jm = state.job_manager.lock().await;
    jm.start_job(&id).await
        .map_err(|e| {
            tracing::error!("run job {}: {}", id, e);
            if e.to_string().contains("already running") {
                StatusCode::CONFLICT
            } else {
                StatusCode::NOT_FOUND
            }
        })?;
    let job = jm.get_job(&id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(job))
}

async fn cancel_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<JobView>, StatusCode> {
    let jm = state.job_manager.lock().await;
    let found = jm.cancel_job(&id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !found {
        return Err(StatusCode::NOT_FOUND);
    }
    let job = jm.get_job(&id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(job))
}
