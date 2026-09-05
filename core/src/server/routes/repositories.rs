use axum::{
    extract::{Extension, Path, State},
    Json,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::db::models::repository::RepositoryModel;
use crate::db::DbPool;
use crate::server::AppState;

#[derive(Serialize)]
pub struct RepositoryResponse {
    pub id: String,
    pub name: String,
    pub repo_type: String,
    pub capacity_bytes: i64,
    pub used_bytes: i64,
    pub free_bytes: i64,
    pub encrypted: bool,
    pub status: String,
    pub created_at: i64,
}

impl From<RepositoryModel> for RepositoryResponse {
    fn from(r: RepositoryModel) -> Self {
        Self {
            id: r.id,
            name: r.name,
            repo_type: r.repo_type,
            capacity_bytes: r.capacity_bytes,
            used_bytes: r.used_bytes,
            free_bytes: r.free_bytes,
            encrypted: r.encrypted,
            status: r.status,
            created_at: r.created_at,
        }
    }
}

#[derive(Deserialize)]
pub struct CreateRepoRequest {
    pub name: String,
    pub repo_type: String,
    pub path: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    pub container: Option<String>,
    pub connection_string: Option<String>,
    pub account: Option<String>,
}

pub fn router() -> axum::Router<Arc<AppState>> {
    axum::Router::new()
        .route("/", axum::routing::get(list_repositories).post(create_repository))
        .route("/:id", axum::routing::get(get_repository).delete(delete_repository))
}

/// The tenant a caller may operate on: super-admins (and global users with no
/// tenant) see everything; everyone else is confined to their own tenant.
fn scoped_tenant(claims: &Claims) -> Option<String> {
    if claims.role == "super_admin" {
        None
    } else {
        claims.tenant_id.clone()
    }
}

fn tenant_allows(claims: &Claims, owner: Option<&str>) -> bool {
    match scoped_tenant(claims) {
        None => true,
        Some(mine) => owner == Some(mine.as_str()),
    }
}

async fn list_repositories(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<RepositoryResponse>>, StatusCode> {
    let repos = fetch_repositories(&state.db).await
        .map_err(|e| {
            tracing::error!("list repositories: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .into_iter()
        .filter(|r| tenant_allows(&claims, r.tenant_id.as_deref()))
        .map(RepositoryResponse::from)
        .collect();
    Ok(Json(repos))
}

#[derive(Deserialize)]
pub struct RepoConfig {
    pub path: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
}

async fn create_repository(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateRepoRequest>,
) -> Result<Json<RepositoryResponse>, StatusCode> {
    // Validate that the storage backend can be created (creates dirs for local).
    let storage_config = crate::storage::StorageConfig {
        backend_type: req.repo_type.clone(),
        path: req.path.clone(),
        bucket: req.bucket.clone(),
        region: req.region.clone(),
        endpoint: req.endpoint.clone(),
        access_key: req.access_key.clone(),
        secret_key: req.secret_key.clone(),
        container: req.container.clone(),
        connection_string: req.connection_string.clone(),
        account: req.account.clone(),
    };
    if let Err(e) = crate::storage::create_backend(storage_config).await {
        tracing::error!("repository storage init: {}", e);
        return Err(StatusCode::BAD_REQUEST);
    }

    // Credentials are encrypted at rest with the application key, so a DB-file
    // compromise alone does not expose them.
    let key = crate::encrypt::app_key(&state.config).map_err(|e| {
        tracing::error!("repository credential encryption key: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let secret_key_enc = req.secret_key.as_deref()
        .map(|s| crate::encrypt::encrypt_secret(&key, s))
        .transpose()
        .map_err(|e| {
            tracing::error!("encrypt repository secret: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let connection_string_enc = req.connection_string.as_deref()
        .map(|s| crate::encrypt::encrypt_secret(&key, s))
        .transpose()
        .map_err(|e| {
            tracing::error!("encrypt repository connection string: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let config = serde_json::json!({
        "path": req.path,
        "bucket": req.bucket,
        "region": req.region,
        "endpoint": req.endpoint,
        "access_key": req.access_key,
        "secret_key": secret_key_enc,
        "container": req.container,
        "connection_string": connection_string_enc,
        "account": req.account,
    });

    let id = uuid::Uuid::new_v4().to_string();
    let t = chrono::Utc::now().timestamp();
    let tenant_id = scoped_tenant(&claims);

    match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query(
                "INSERT INTO repositories
                 (id, name, repo_type, config_json, capacity_bytes, used_bytes, free_bytes,
                  encrypted, immutable, status, created_at, updated_at, tenant_id)
                 VALUES (?1, ?2, ?3, ?4, 0, 0, 0, 0, 0, 'ready', ?5, ?5, ?6)"
            )
            .bind(&id)
            .bind(&req.name)
            .bind(&req.repo_type)
            .bind(config.to_string())
            .bind(t)
            .bind(&tenant_id)
            .execute(pool)
            .await
            .map_err(|e| {
                tracing::error!("create repository: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
        DbPool::Postgres(pool) => {
            sqlx::query(
                "INSERT INTO repositories
                 (id, name, repo_type, config_json, capacity_bytes, used_bytes, free_bytes,
                  encrypted, immutable, status, created_at, updated_at, tenant_id)
                 VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, 'ready', $5, $5, $6)"
            )
            .bind(&id)
            .bind(&req.name)
            .bind(&req.repo_type)
            .bind(config.to_string())
            .bind(t)
            .bind(&tenant_id)
            .execute(pool)
            .await
            .map_err(|e| {
                tracing::error!("create repository: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
    }

    crate::db::record_event(
        &state.db,
        "repository_created",
        "repositories",
        &format!("Repository {} created ({})", req.name, req.repo_type),
        None,
        None,
    ).await.ok();

    let repo = fetch_repository(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(RepositoryResponse::from(repo)))
}

async fn get_repository(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<RepositoryResponse>, StatusCode> {
    let repo = fetch_repository(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter(|r| tenant_allows(&claims, r.tenant_id.as_deref()))
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(RepositoryResponse::from(repo)))
}

async fn delete_repository(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Verify the repository exists and belongs to the caller's tenant.
    let owned = fetch_repository(&state.db, &id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_or(false, |r| tenant_allows(&claims, r.tenant_id.as_deref()));
    if !owned {
        return Err(StatusCode::NOT_FOUND);
    }
    let affected = match &state.db {
        DbPool::Sqlite(pool) => {
            sqlx::query("DELETE FROM repositories WHERE id = ?1")
                .bind(&id)
                .execute(pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .rows_affected()
        }
        DbPool::Postgres(pool) => {
            sqlx::query("DELETE FROM repositories WHERE id = $1")
                .bind(&id)
                .execute(pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                .rows_affected()
        }
    };

    if affected == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    crate::db::record_event(
        &state.db,
        "repository_deleted",
        "repositories",
        &format!("Repository {} deleted", id),
        None,
        None,
    ).await.ok();
    Ok(StatusCode::NO_CONTENT)
}

pub async fn fetch_repositories(db: &DbPool) -> anyhow::Result<Vec<RepositoryModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let rows = sqlx::query_as::<_, RepositoryModel>(
                "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                        free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                 FROM repositories ORDER BY created_at DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows)
        }
        DbPool::Postgres(pool) => {
            let rows = sqlx::query_as::<_, RepositoryModel>(
                "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                        free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                 FROM repositories ORDER BY created_at DESC"
            )
            .fetch_all(pool)
            .await?;
            Ok(rows)
        }
    }
}

pub async fn fetch_repository(db: &DbPool, id: &str) -> anyhow::Result<Option<RepositoryModel>> {
    match db {
        DbPool::Sqlite(pool) => {
            let row = sqlx::query_as::<_, RepositoryModel>(
                "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                        free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                 FROM repositories WHERE id = ?1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
        DbPool::Postgres(pool) => {
            let row = sqlx::query_as::<_, RepositoryModel>(
                "SELECT id, name, repo_type, config_json, capacity_bytes, used_bytes,
                        free_bytes, encrypted, immutable, status, created_at, updated_at, tenant_id
                 FROM repositories WHERE id = $1"
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            Ok(row)
        }
    }
}
