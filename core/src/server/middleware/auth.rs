use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};

pub async fn auth_middleware(
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // TODO: implement proper JWT validation
    let _headers = req.headers();
    Ok(next.run(req).await)
}
