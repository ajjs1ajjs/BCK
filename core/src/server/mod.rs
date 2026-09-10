pub mod routes;
pub mod middleware;

use axum::Router;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tower_http::compression::CompressionLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::auth::jwt::JwtManager;
use crate::cdp::CdpEngine;
use crate::cloud::CloudBackupManager;
use crate::cloud::restore::CloudRestoreManager;
use crate::config::AppConfig;
use crate::db::DbPool;
use crate::dr::DrOrchestrator;
use crate::enterprise::multitenant::TenantManager;
use crate::enterprise::sso::SsoManager;
use crate::job::JobManager;
use crate::m365::M365BackupManager;
use crate::restore::surebackup::SureBackupEngine;
use crate::restore::requests::RestoreRequestManager;
use crate::restore::tracker::RestoreTracker;
use crate::scheduler::Scheduler;
use crate::sobr::SobrManager;
use crate::tape::TapeManager;

pub struct AppState {
    pub config: AppConfig,
    pub db: DbPool,
    pub job_manager: Arc<Mutex<JobManager>>,
    pub scheduler: Arc<Mutex<Scheduler>>,
    pub jwt: JwtManager,
    pub agent_token: Option<String>,
    pub restore_tracker: RestoreTracker,
    pub instant_recovery: crate::restore::instant::InstantRecoveryRegistry,
    pub surebackup: SureBackupEngine,
    pub sso: SsoManager,
    pub sobr: SobrManager,
    pub cloud: CloudBackupManager,
    pub cloud_restore: CloudRestoreManager,
    pub m365: M365BackupManager,
    pub tape: TapeManager,
    pub cdp: CdpEngine,
    pub dr: DrOrchestrator,
    pub tenants: TenantManager,
    pub restore_requests: RestoreRequestManager,
}

pub fn create_router(state: Arc<AppState>) -> Router {
    let api = routes::api_routes(state.clone());

    // Same-origin by default (the SPA is served by this daemon). Cross-origin
    // is only allowed for explicitly configured origins — never `permissive()`.
    let cors = cors_layer(&state.config.server.allowed_origins);

    // OPS-002: propagate x-request-id for log correlation.
    let request_id = SetRequestIdLayer::x_request_id(MakeRequestUuid);
    let propagate = PropagateRequestIdLayer::x_request_id();

    // Serve the built web UI (SPA) if a directory is configured and exists.
    let mut router = Router::new()
        .nest("/api/v1", api)
        .layer(axum::middleware::from_fn(security_headers))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(propagate)
        .layer(request_id)
        .layer(cors);

    if let Some(web_dir) = &state.config.server.web_ui_dir {
        if Path::new(web_dir).is_dir() {
            let index = web_dir.clone() + "/index.html";
            let serve = ServeDir::new(web_dir).fallback(ServeFile::new(index));
            // axum 0.8 removed nesting at root (`nest_service("/")` panics);
            // `fallback_service` serves the SPA for every non-API route while
            // `/api/v1/*` keeps matching the API router above.
            router = router.fallback_service(serve);
        }
    }

    router
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    /// Regression test: serving the SPA must not panic (axum 0.8 removed
    /// root nesting) and must not swallow `/api/v1/*` routes.
    #[tokio::test]
    async fn spa_fallback_serves_index_without_swallowing_api() {
        let dir = std::env::temp_dir().join(format!("bck-webui-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<html>spa</html>").unwrap();
        let db_path = dir.join("t.db");
        let state = crate::server::routes::testutil::test_state(db_path.to_str().unwrap()).await;
        let mut owned = match Arc::try_unwrap(state) {
            Ok(s) => s,
            Err(_) => panic!("test state Arc must have a single strong ref"),
        };
        owned.config.server.web_ui_dir = Some(dir.to_string_lossy().to_string());
        let app = create_router(Arc::new(owned));

        let resp = app
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        assert!(body.windows(3).any(|w| w == b"spa"), "root must serve index.html");

        // SPA client-side route falls back to index too.
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/dashboard")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // API routes still win over the fallback.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        std::fs::remove_dir_all(&dir).ok();
    }
}

/// Adds baseline security headers to every response (CSP, nosniff, frame
/// protection, referrer policy). Defense in depth against XSS/clickjacking.
/// HSTS is included — it only takes effect when the browser has seen the
/// site served over HTTPS; on a fresh HTTP deployment it will be stored
/// but won't block HTTP access until TLS is subsequently enabled.
async fn security_headers(req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert(
        axum::http::header::CONTENT_SECURITY_POLICY,
        axum::http::HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
             img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; \
             base-uri 'self'",
        ),
    );
    headers.insert(axum::http::header::X_CONTENT_TYPE_OPTIONS, axum::http::HeaderValue::from_static("nosniff"));
    headers.insert(axum::http::header::X_FRAME_OPTIONS, axum::http::HeaderValue::from_static("DENY"));
    headers.insert(axum::http::header::REFERRER_POLICY, axum::http::HeaderValue::from_static("same-origin"));
    headers.insert(axum::http::header::STRICT_TRANSPORT_SECURITY, axum::http::HeaderValue::from_static("max-age=63072000; includeSubDomains; preload"));
    response
}

fn cors_layer(allowed: &[String]) -> CorsLayer {
    if allowed.is_empty() {
        return CorsLayer::new();
    }
    use tower_http::cors::AllowOrigin;
    let origins: Vec<axum::http::HeaderValue> = allowed
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    if origins.is_empty() {
        return CorsLayer::new();
    }
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
        ])
        .allow_headers([axum::http::header::AUTHORIZATION, axum::http::header::CONTENT_TYPE])
        .allow_credentials(true)
}