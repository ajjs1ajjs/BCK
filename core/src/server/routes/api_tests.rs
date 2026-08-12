//! End-to-end route tests for the Phase 4-6 API modules (SOBR, Cloud, M365,
//! Tape, CDP, DR). Routers are exercised directly with a shared test state,
//! matching the existing hypervisors route test pattern.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use crate::server::routes::{cdp, cloud, dr, m365, portal, sobr, tape, tenants};
use crate::server::routes::testutil::{read_json, test_state};
use crate::auth::jwt::Claims;

fn admin_claims() -> Claims {
    Claims {
        sub: "user-admin".into(),
        username: "admin".into(),
        role: "admin".into(),
        exp: usize::MAX,
        iat: 0,
    }
}

fn viewer_claims() -> Claims {
    Claims {
        sub: "user-viewer".into(),
        username: "viewer".into(),
        role: "viewer".into(),
        exp: usize::MAX,
        iat: 0,
    }
}

/// `oneshot` variant that attaches a `Claims` extension (bypasses JWT, as the
/// auth middleware has already run).
async fn oneshot_with_claims(
    app: axum::Router,
    method: &str,
    uri: &str,
    body: Option<&str>,
    claims: &Claims,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let body = body.map(|s| Body::from(s.to_string())).unwrap_or_else(Body::empty);
    let mut req = builder.body(body).unwrap();
    req.extensions_mut().insert(claims.clone());
    app.oneshot(req).await.unwrap()
}

async fn oneshot(
    app: axum::Router,
    method: &str,
    uri: &str,
    body: Option<&str>,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let body = body.map(|s| Body::from(s.to_string())).unwrap_or_else(Body::empty);
    app.oneshot(builder.body(body).unwrap()).await.unwrap()
}

fn temp_dir(tag: &str) -> String {
    let dir = std::env::temp_dir().join(format!("bck-api-{}-{}", tag, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.to_string_lossy().into_owned()
}

#[tokio::test]
async fn sobr_tiers_and_policies() {
    let state = test_state(&format!("{}\\sobr.db", temp_dir("sobr"))).await;
    let app = sobr::router().with_state(state.clone());

    // No tiers/policies initially.
    let resp = oneshot(app.clone(), "GET", "/", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let tiers: Vec<serde_json::Value> = read_json(resp).await;
    assert!(tiers.is_empty());

    // Add a performance tier.
    let resp = oneshot(app.clone(), "POST", "/tiers", Some(
        r#"{"name":"Perf","tier_type":"Performance","backend":"local",
            "backend_config":{"backend_type":"local","path":"C:/tmp/perf"},
            "capacity_bytes":1000000,"used_bytes":0,"status":"Online","priority":1}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Add a capacity tier.
    let resp = oneshot(app.clone(), "POST", "/tiers", Some(
        r#"{"name":"Cap","tier_type":"Capacity","backend":"local",
            "backend_config":{"backend_type":"local","path":"C:/tmp/cap"},
            "capacity_bytes":1000000,"used_bytes":0,"status":"Online","priority":2}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Create a policy and execute it (no snapshots -> moves 0 bytes).
    let resp = oneshot(app.clone(), "POST", "/policies", Some(
        r#"{"name":"test","performance_tier_id":"p","capacity_tier_id":"c",
            "archive_tier_id":null,"capacity_move_days":30,"archive_move_days":null,
            "seal_days":null,"retention_days":null}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let policy: serde_json::Value = read_json(resp).await;
    let pid = policy["id"].as_str().unwrap().to_string();

    let resp = oneshot(app.clone(), "GET", "/policies", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let policies: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(policies.len(), 1);
    assert_eq!(policies[0]["id"], pid);

    // Executing a policy with a tier id that is not registered -> BAD_REQUEST.
    let resp = oneshot(app.clone(), "POST", &format!("/policies/{}/execute", pid), None).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn cloud_accounts_crud() {
    let state = test_state(&format!("{}\\cloud.db", temp_dir("cloud"))).await;
    let app = cloud::router().with_state(state.clone());

    let resp = oneshot(app.clone(), "POST", "/", Some(
        r#"{"name":"prod-aws","provider":"Aws","auth_type":"access_key","region":"eu-central-1",
            "status":"Disconnected","access_key":"AKIA","secret_key":"secret"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let account: serde_json::Value = read_json(resp).await;
    let id = account["id"].as_str().unwrap().to_string();

    let resp = oneshot(app.clone(), "GET", "/", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let accounts: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(accounts.len(), 1);
    // Credentials must never be serialized back through the API.
    assert!(accounts[0]["secret_key"].is_null(), "secret_key must be redacted");
    assert!(accounts[0]["session_token"].is_null(), "session_token must be redacted");
    let raw = accounts[0].to_string();
    assert!(!raw.contains("\"secret\""), "raw secret value must not leak in list");

    let resp = oneshot(app.clone(), "GET", &format!("/{}", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let single: serde_json::Value = read_json(resp).await;
    assert!(single["secret_key"].is_null(), "get_account must redact secret_key");

    let resp = oneshot(app.clone(), "DELETE", &format!("/{}", id), None).await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let resp = oneshot(app.clone(), "GET", &format!("/{}", id), None).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cloud_restore_workflow() {
    let state = test_state(&format!("{}\\cloud-restore.db", temp_dir("cloud-restore"))).await;
    let app = cloud::router().with_state(state.clone());

    // No account -> restore endpoints reject.
    let resp = oneshot(app.clone(), "GET", "/missing/restorable", None).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Register an AWS account without live credentials.
    let resp = oneshot(app.clone(), "POST", "/", Some(
        r#"{"name":"prod","provider":"Aws","auth_type":"access_key","region":"us-east-1",
            "status":"Connected"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let account: serde_json::Value = read_json(resp).await;
    let id = account["id"].as_str().unwrap().to_string();

    // List restorable kinds.
    let resp = oneshot(app.clone(), "GET", &format!("/{}/restorable", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let kinds: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(kinds.len(), 3);
    assert_eq!(kinds[0]["resource_type"], "ec2_ami");

    // Submit a restore (no credentials -> Planned).
    let resp = oneshot(app.clone(), "POST", &format!("/{}/restore", id), Some(
        r#"{"resource_type":"ebs_snapshot","resource_id":"snap-1","target_name":"us-east-1a","params":{}}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let restore: serde_json::Value = read_json(resp).await;
    let rid = restore["id"].as_str().unwrap().to_string();
    assert_eq!(restore["status"], "Planned");

    // Unsupported resource type is rejected.
    let resp = oneshot(app.clone(), "POST", &format!("/{}/restore", id), Some(
        r#"{"resource_type":"nope","resource_id":"x","target_name":"y","params":{}}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Account scoped + global lists and get.
    let resp = oneshot(app.clone(), "GET", &format!("/{}/restores", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let scoped: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(scoped.len(), 1);

    let resp = oneshot(app.clone(), "GET", "/restores", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let all: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(all.len(), 1);

    let resp = oneshot(app.clone(), "GET", &format!("/restores/{}", rid), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let detail: serde_json::Value = read_json(resp).await;
    assert_eq!(detail["account_id"], id);

    // Missing restore id -> not found.
    let resp = oneshot(app.clone(), "GET", "/restores/nope", None).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn m365_tenant_and_job() {
    let state = test_state(&format!("{}\\m365.db", temp_dir("m365"))).await;
    let app = m365::router().with_state(state.clone());

    let resp = oneshot(app.clone(), "POST", "/tenants", Some(
        r#"{"name":"contoso","tenant_id":"tenant-1","auth_type":"AppOnly",
            "client_id":"client-1","encrypted_secret":"secret","status":"Disconnected"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let tenant: serde_json::Value = read_json(resp).await;
    assert!(tenant["id"].as_str().is_some());

    let resp = oneshot(app.clone(), "GET", "/tenants", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let tenants: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(tenants.len(), 1);
    // The client secret must never be echoed back through the API.
    assert!(
        tenants[0]["encrypted_secret"].as_str().map_or(true, |s| s.is_empty()),
        "M365 client secret must be redacted"
    );

    // Starting a job for a missing tenant is rejected.
    let resp = oneshot(app.clone(), "POST", "/jobs", Some(
        r#"{"tenant_id":"nope","backup_type":"Mailbox"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn tape_drive_media_roundtrip() {
    let dir = temp_dir("tape");
    let state = test_state(&format!("{}\\tape.db", dir)).await;
    let app = tape::router().with_state(state.clone());

    let resp = oneshot(app.clone(), "POST", "/drives", Some(
        r#"{"name":"Drive0","device_path":"/dev/sg1","drive_type":"LTO-9",
            "loaded_media":null,"status":"Online","capacity_bytes":10000,"used_bytes":0}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let drive: serde_json::Value = read_json(resp).await;
    let drive_id = drive["id"].as_str().unwrap().to_string();

    let tape_path = format!("{}\\BK0001L9.ltfs", dir);
    let format_body = format!(
        r#"{{"device_path":"{}","barcode":"BK0001L9","capacity_bytes":10000}}"#,
        tape_path.replace('\\', "\\\\"),
    );
    let resp = oneshot(app.clone(), "POST", "/media/format", Some(&format_body)).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let media: serde_json::Value = read_json(resp).await;
    let media_id = media["id"].as_str().unwrap().to_string();

    let load_body = format!(r#"{{"media_id":"{}"}}"#, media_id);
    let resp = oneshot(app.clone(), "POST", &format!("/drives/{}/load", drive_id), Some(&load_body)).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Write base64 data.
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b"block-data");
    let write_body = format!(r#"{{"name":"vm.vmdk","data_base64":"{}"}}"#, b64);
    let resp = oneshot(app.clone(), "POST", &format!("/drives/{}/write", drive_id), Some(&write_body)).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let written: serde_json::Value = read_json(resp).await;
    assert_eq!(written["bytes_written"], 10);

    // Read it back.
    let resp = oneshot(app.clone(), "GET", &format!("/drives/{}/read?name=vm.vmdk", drive_id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let read: serde_json::Value = read_json(resp).await;
    assert_eq!(read["data_base64"], b64);

    // Media list reflects the write.
    let resp = oneshot(app.clone(), "GET", "/media", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let media_list: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(media_list.len(), 1);
    assert_eq!(media_list[0]["used_bytes"], 10);
}

#[tokio::test]
async fn cdp_policy_and_protection() {
    let dir = temp_dir("cdp");
    let state = test_state(&format!("{}\\cdp.db", dir)).await;
    let app = cdp::router().with_state(state.clone());

    let resp = oneshot(app.clone(), "POST", "/policies", Some(
        r#"{"name":"app-log","paths":["C:/tmp/logs"],"rpo_seconds":60,
            "min_interval_seconds":5,"retention_days":7,"compression":"zstd",
            "encryption":false,"exclude_patterns":[]}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let policy: serde_json::Value = read_json(resp).await;
    let pid = policy["id"].as_str().unwrap().to_string();

    let resp = oneshot(app.clone(), "GET", "/policies", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let policies: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(policies.len(), 1);

    // Start protection for the policy.
    let resp = oneshot(app.clone(), "POST", &format!("/policies/{}/start", pid), None).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let session: serde_json::Value = read_json(resp).await;
    let sid = session["id"].as_str().unwrap().to_string();

    let resp = oneshot(app.clone(), "GET", "/sessions", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let sessions: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], sid);

    let resp = oneshot(app.clone(), "POST", &format!("/sessions/{}/stop", sid), None).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let resp = oneshot(app.clone(), "GET", "/stats", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn dr_sites_plans_and_test() {
    let state = test_state(&format!("{}\\dr.db", temp_dir("dr"))).await;
    let app = dr::router().with_state(state.clone());

    let resp = oneshot(app.clone(), "POST", "/sites", Some(
        r#"{"name":"primary","dr_type":"Vmware","endpoint":"https://vc1.local",
            "credentials_id":"","storage_id":"","is_primary":true,"status":"Online"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let site: serde_json::Value = read_json(resp).await;
    assert!(site["id"].as_str().is_some());

    let resp = oneshot(app.clone(), "POST", "/plans", Some(
        r#"{"name":"plan-a","source_site":"src","target_site":"dst","vms":["vm-1"],
            "replication_policy":{"rpo_seconds":300,"rto_seconds":600,"compression":"zstd",
            "encryption":true,"bandwidth_throttle_mbps":100},"failover_order":["vm-1"],
            "auto_commit":true,"test_mode":false}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let plan: serde_json::Value = read_json(resp).await;
    let pid = plan["id"].as_str().unwrap().to_string();

    let resp = oneshot(app.clone(), "GET", "/plans", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let plans: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(plans.len(), 1);

    let resp = oneshot(app.clone(), "GET", "/status", None).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Non-destructive test failover succeeds.
    let resp = oneshot(app.clone(), "POST", &format!("/plans/{}/test", pid), None).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Failover for a missing plan is rejected.
    let resp = oneshot(app.clone(), "POST", "/plans/missing/failover", None).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn tenant_lifecycle() {
    let state = test_state(&format!("{}\\tenants.db", temp_dir("tenants"))).await;
    let app = tenants::router().with_state(state.clone());

    // No tenants initially.
    let resp = oneshot(app.clone(), "GET", "/", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let tenants: Vec<serde_json::Value> = read_json(resp).await;
    assert!(tenants.is_empty());

    // Create a tenant.
    let resp = oneshot(app.clone(), "POST", "/", Some(
        r#"{"name":"Acme Corp","slug":"acme"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let tenant: serde_json::Value = read_json(resp).await;
    let id = tenant["id"].as_str().unwrap().to_string();
    assert_eq!(tenant["status"], "Active");
    assert_eq!(tenant["slug"], "acme");

    // Defaults from create_tenant.
    assert_eq!(tenant["quota"]["max_repositories"], 5);
    assert_eq!(tenant["settings"]["default_retention_days"], 30);

    // List reflects the tenant.
    let resp = oneshot(app.clone(), "GET", "/", None).await;
    let tenants: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(tenants.len(), 1);

    // Get by id.
    let resp = oneshot(app.clone(), "GET", &format!("/{}", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Suspend -> activate.
    let resp = oneshot(app.clone(), "POST", &format!("/{}/suspend", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = oneshot(app.clone(), "GET", &format!("/{}", id), None).await;
    let tenant: serde_json::Value = read_json(resp).await;
    assert_eq!(tenant["status"], "Suspended");

    let resp = oneshot(app.clone(), "POST", &format!("/{}/activate", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Update quota.
    let resp = oneshot(app.clone(), "PUT", &format!("/{}/quota", id), Some(
        r#"{"max_repositories":10,"max_vms":100,"max_users":25,"max_storage_gb":2048,
            "max_retention_days":180,"max_snapshots_per_vm":60,
            "allow_cloud_tiers":true,"allow_tape":true}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let tenant: serde_json::Value = read_json(resp).await;
    assert_eq!(tenant["quota"]["max_repositories"], 10);

    // Usage + quota check.
    let resp = oneshot(app.clone(), "POST", &format!("/{}/usage", id), Some(
        r#"{"repositories":3,"vms":0,"users":0,"storage_used_gb":0,"snapshots_total":0,
            "monthly_data_written_gb":0}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = oneshot(app.clone(), "GET", &format!("/{}/usage", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = oneshot(app.clone(), "GET", &format!("/{}/check-quota?resource=repository", id), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let check: serde_json::Value = read_json(resp).await;
    assert_eq!(check["within_quota"], true);

    // Delete -> not found.
    let resp = oneshot(app.clone(), "DELETE", &format!("/{}", id), None).await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let resp = oneshot(app.clone(), "GET", &format!("/{}", id), None).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Missing tenant operations are rejected.
    let resp = oneshot(app.clone(), "POST", "/missing/suspend", None).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn portal_restore_request_lifecycle() {
    let state = test_state(&format!("{}\\portal.db", temp_dir("portal"))).await;
    let app = portal::router().with_state(state.clone());

    // Self-service /me endpoint.
    let resp = oneshot_with_claims(app.clone(), "GET", "/me", None, &admin_claims()).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let me: serde_json::Value = read_json(resp).await;
    assert_eq!(me["username"], "admin");
    assert_eq!(me["can_approve"], true);

    // A viewer cannot approve.
    let resp = oneshot_with_claims(app.clone(), "GET", "/me", None, &viewer_claims()).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let me: serde_json::Value = read_json(resp).await;
    assert_eq!(me["can_approve"], false);

    // Submit a restore request.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        "/restore-requests",
        Some(r#"{"snapshot_id":"snap-1","files":["/etc/hosts"],"target_path":"/tmp/restore","reason":"test"}"#),
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let request: serde_json::Value = read_json(resp).await;
    let id = request["id"].as_str().unwrap().to_string();
    assert_eq!(request["status"], "Pending");
    assert_eq!(request["user_id"], "user-admin");

    // Missing required fields are rejected.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        "/restore-requests",
        Some(r#"{"snapshot_id":"","target_path":""}"#),
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // The submitter sees their own request.
    let resp = oneshot_with_claims(app.clone(), "GET", "/restore-requests", None, &admin_claims()).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let mine: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(mine.len(), 1);

    // A different user sees none.
    let resp = oneshot_with_claims(app.clone(), "GET", "/restore-requests", None, &viewer_claims()).await;
    let mine: Vec<serde_json::Value> = read_json(resp).await;
    assert!(mine.is_empty());

    // A viewer is forbidden from the admin endpoints.
    let resp = oneshot_with_claims(app.clone(), "GET", "/admin/restore-requests", None, &viewer_claims()).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // The admin lists all pending requests.
    let resp = oneshot_with_claims(app.clone(), "GET", "/admin/restore-requests", None, &admin_claims()).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let all: Vec<serde_json::Value> = read_json(resp).await;
    assert_eq!(all.len(), 1);

    // Approve it.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        &format!("/admin/restore-requests/{}/approve", id),
        Some(r#"{"note":"ok"}"#),
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Approving again is rejected (not pending anymore).
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        &format!("/admin/restore-requests/{}/approve", id),
        Some(r#"{"note":"again"}"#),
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Complete it.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        &format!("/admin/restore-requests/{}/complete", id),
        None,
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Submit, then cancel a second request.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        "/restore-requests",
        Some(r#"{"snapshot_id":"snap-2","files":[],"target_path":"/tmp/restore2"}"#),
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let second: serde_json::Value = read_json(resp).await;
    let id2 = second["id"].as_str().unwrap().to_string();

    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        &format!("/restore-requests/{}/cancel", id2),
        None,
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // A request that is not pending cannot be cancelled.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        &format!("/restore-requests/{}/cancel", id),
        None,
        &admin_claims(),
    ).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn portal_cancel_requires_ownership() {
    let state = test_state(&format!("{}\\portal-idor.db", temp_dir("portal-idor"))).await;
    let app = portal::router().with_state(state.clone());

    let victim = Claims {
        sub: "user-victim".into(),
        username: "victim".into(),
        role: "operator".into(),
        exp: usize::MAX,
        iat: 0,
    };
    let attacker = Claims {
        sub: "user-attacker".into(),
        username: "attacker".into(),
        role: "viewer".into(),
        exp: usize::MAX,
        iat: 0,
    };

    // Victim submits a restore request.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        "/restore-requests",
        Some(r#"{"snapshot_id":"snap-v","files":[],"target_path":"/tmp/r"}"#),
        &victim,
    ).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let req: serde_json::Value = read_json(resp).await;
    let id = req["id"].as_str().unwrap().to_string();

    // A different user cannot cancel it (IDOR / BOLA).
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        &format!("/restore-requests/{}/cancel", id),
        None,
        &attacker,
    ).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // The owner can cancel it.
    let resp = oneshot_with_claims(
        app.clone(),
        "POST",
        &format!("/restore-requests/{}/cancel", id),
        None,
        &victim,
    ).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn hypervisor_instant_recovery_routes() {
    use crate::server::routes::{hypervisors, restore};

    let state = test_state(&format!("{}\\ir.db", temp_dir("ir"))).await;

    // Register a hypervisor (connection fails, but the record is stored).
    let hv_app = hypervisors::router().with_state(state.clone());
    let resp = oneshot(hv_app.clone(), "POST", "/", Some(
        r#"{"name":"lab","hv_type":"hyperv","host":"hv.local","port":5985,"username":"u","password":"p"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let hv: serde_json::Value = read_json(resp).await;
    let hv_id = hv["id"].as_str().unwrap().to_string();

    let app = restore::router().with_state(state.clone());

    // Unknown hypervisor on the VM instant-recovery endpoint -> 404.
    let resp = oneshot(app.clone(), "POST", "/instant/vm", Some(
        r#"{"snapshot_id":"snap-x","vm_name":"vm","hypervisor_id":"nope","protocol":"nfs","target_host":"127.0.0.1:2049"}"#,
    )).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Invalid protocol is rejected before connecting to the hypervisor.
    let resp = oneshot(app.clone(), "POST", "/instant/vm", Some(
        &format!(r#"{{"snapshot_id":"snap-x","vm_name":"vm","hypervisor_id":"{}","protocol":"bogus","target_host":"127.0.0.1:2049"}}"#, hv_id),
    )).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // The hypervisor exists now, so an unknown snapshot -> 404.
    let resp = oneshot(app.clone(), "POST", "/instant/vm", Some(
        &format!(r#"{{"snapshot_id":"snap-x","vm_name":"vm","hypervisor_id":"{}","protocol":"nfs","target_host":"127.0.0.1:2049"}}"#, hv_id),
    )).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Listing instant recovery sessions returns an empty list initially.
    let resp = oneshot(app.clone(), "GET", "/instant", None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let sessions: Vec<serde_json::Value> = read_json(resp).await;
    assert!(sessions.is_empty());

    std::fs::remove_dir_all(std::path::Path::new(
        &state.config.storage.default_path.to_string_lossy().to_string(),
    ).parent().unwrap()).ok();
}

#[tokio::test]
async fn agent_endpoints_require_agent_token() {
    let state = test_state(&format!("{}\\agent-auth.db", temp_dir("agent-auth"))).await;
    let app = crate::server::routes::api_routes(state.clone());

    let heartbeat = r#"{"agent_id":"agent-1","hostname":"test"}"#;

    // No token -> 401.
    let resp = oneshot(app.clone(), "POST", "/agents/heartbeat", Some(heartbeat)).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Wrong token -> 401.
    let resp = oneshot_auth(app.clone(), "POST", "/agents/heartbeat", Some(heartbeat), "Bearer wrong-token").await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Correct pre-shared token -> accepted (200).
    let resp = oneshot_auth(app.clone(), "POST", "/agents/heartbeat", Some(heartbeat), "Bearer test-agent-token").await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Pending-task polling also requires the token.
    let resp = oneshot_auth(app.clone(), "GET", "/agents/agent-1/tasks/pending", None, "Bearer test-agent-token").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let resp = oneshot(app.clone(), "GET", "/agents/agent-1/tasks/pending", None).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

async fn oneshot_auth(
    app: axum::Router,
    method: &str,
    uri: &str,
    body: Option<&str>,
    auth: &str,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri)
        .header("authorization", auth);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let body = body.map(|s| Body::from(s.to_string())).unwrap_or_else(Body::empty);
    app.oneshot(builder.body(body).unwrap()).await.unwrap()
}

#[tokio::test]
async fn agent_task_creation_enforces_allowlist_and_registered_agent() {
    let state = test_state(&format!("{}\\agent-tasks.db", temp_dir("agent-tasks"))).await;
    let app = crate::server::routes::api_routes(state.clone());
    let admin = jwt_for(&state, crate::auth::UserRole::Admin);

    // Register an agent via heartbeat (agent token).
    let hb = r#"{"agent_id":"agent-ok","hostname":"test"}"#;
    let resp = oneshot_auth(app.clone(), "POST", "/agents/heartbeat", Some(hb), "Bearer test-agent-token").await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Unknown agent -> task rejected.
    let resp = oneshot_auth(
        app.clone(),
        "POST",
        "/agents/ghost/tasks",
        Some(r#"{"task_type":"file_backup","payload":{}}"#),
        &format!("Bearer {admin}"),
    ).await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND, "task for unknown agent must be rejected");

    // Disallowed / dangerous task type -> rejected.
    let resp = oneshot_auth(
        app.clone(),
        "POST",
        "/agents/agent-ok/tasks",
        Some(r#"{"task_type":"run_script","payload":{"script":"x"}}"#),
        &format!("Bearer {admin}"),
    ).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "run_script task type must be rejected");

    // Allowed task type on a registered agent -> accepted.
    let resp = oneshot_auth(
        app.clone(),
        "POST",
        "/agents/agent-ok/tasks",
        Some(r#"{"task_type":"file_backup","payload":{"paths":["/tmp"]}}"#),
        &format!("Bearer {admin}"),
    ).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn login_rate_limits_after_repeated_failures() {
    let state = test_state(&format!("{}\\login-rate.db", temp_dir("login-rate"))).await;
    let app = crate::server::routes::api_routes(state.clone());

    let body = r#"{"username":"rate-user","password":"wrong"}"#;
    for _ in 0..10 {
        let resp = oneshot(app.clone(), "POST", "/auth/login", Some(body)).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
    let resp = oneshot(app.clone(), "POST", "/auth/login", Some(body)).await;
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS, "login must be rate limited");
}

// --- RBAC ---

fn jwt_for(state: &std::sync::Arc<crate::server::AppState>, role: crate::auth::UserRole) -> String {
    let user = crate::auth::User {
        id: uuid::Uuid::new_v4().to_string(),
        username: format!("user-{}", role).to_lowercase(),
        role,
        email: None,
        enabled: true,
    };
    state.jwt.generate(&user).unwrap()
}

#[tokio::test]
async fn rbac_blocks_viewer_mutations_but_allows_reads() {
    let state = test_state(&format!("{}\\rbac.db", temp_dir("rbac"))).await;
    let app = crate::server::routes::api_routes(state.clone());

    let viewer = jwt_for(&state, crate::auth::UserRole::Viewer);
    let admin = jwt_for(&state, crate::auth::UserRole::Admin);

    // Reads are allowed for a Viewer.
    let resp = oneshot_auth(app.clone(), "GET", "/jobs", None, &format!("Bearer {viewer}")).await;
    assert_ne!(resp.status(), StatusCode::FORBIDDEN, "viewer must be able to read jobs");

    // Mutations are forbidden for a Viewer.
    let resp = oneshot_auth(
        app.clone(),
        "POST",
        "/jobs",
        Some(r#"{"name":"job","source_path":"/tmp","repository_id":"repo-1"}"#),
        &format!("Bearer {viewer}"),
    ).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "viewer must not create jobs");

    // Deleting a job is also forbidden for a Viewer.
    let resp = oneshot_auth(app.clone(), "DELETE", "/jobs/does-not-exist", None, &format!("Bearer {viewer}")).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "viewer must not delete jobs");

    // An Admin may create jobs (200/400, but not 403).
    let resp = oneshot_auth(
        app.clone(),
        "POST",
        "/jobs",
        Some(r#"{"name":"job","source_path":"/tmp","repository_id":"repo-1"}"#),
        &format!("Bearer {admin}"),
    ).await;
    assert_ne!(resp.status(), StatusCode::FORBIDDEN, "admin must be able to create jobs");
}

#[tokio::test]
async fn rbac_restore_requires_restore_capability() {
    let state = test_state(&format!("{}\\rbac-restore.db", temp_dir("rbac-restore"))).await;
    let app = crate::server::routes::api_routes(state.clone());

    let viewer = jwt_for(&state, crate::auth::UserRole::Viewer);
    let restore_op = jwt_for(&state, crate::auth::UserRole::RestoreOperator);

    // A Viewer cannot trigger a restore.
    let resp = oneshot_auth(
        app.clone(),
        "POST",
        "/restore/file",
        Some(r#"{"snapshot_id":"snap-x","files":[],"target_path":"/tmp","overwrite":false}"#),
        &format!("Bearer {viewer}"),
    ).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "viewer must not restore");

    // RestoreOperator is allowed past RBAC (the body may 400/404, not 403).
    let resp = oneshot_auth(
        app.clone(),
        "POST",
        "/restore/file",
        Some(r#"{"snapshot_id":"snap-x","files":[],"target_path":"/tmp","overwrite":false}"#),
        &format!("Bearer {restore_op}"),
    ).await;
    assert_ne!(resp.status(), StatusCode::FORBIDDEN, "restore_operator must be allowed");
}

#[tokio::test]
async fn rbac_tenants_require_admin() {
    let state = test_state(&format!("{}\\rbac-tenant.db", temp_dir("rbac-tenant"))).await;
    let app = crate::server::routes::api_routes(state.clone());

    let operator = jwt_for(&state, crate::auth::UserRole::Operator);
    let admin = jwt_for(&state, crate::auth::UserRole::Admin);

    let body = r#"{"name":"acme"}"#;
    let resp = oneshot_auth(app.clone(), "POST", "/tenants", Some(body), &format!("Bearer {operator}")).await;
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "operator must not manage tenants");
    let resp = oneshot_auth(app.clone(), "POST", "/tenants", Some(body), &format!("Bearer {admin}")).await;
    assert_ne!(resp.status(), StatusCode::FORBIDDEN, "admin must be able to manage tenants");
}
