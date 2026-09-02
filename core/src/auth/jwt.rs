use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use chrono::Utc;

use super::User;

fn revoked_set() -> &'static dashmap::DashSet<String> {
    static SET: std::sync::OnceLock<dashmap::DashSet<String>> = std::sync::OnceLock::new();
    SET.get_or_init(dashmap::DashSet::new)
}
fn is_revoked(token: &str) -> bool {
    revoked_set().contains(token)
}
fn revoke_token(token: &str) {
    revoked_set().insert(token.to_string());
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub username: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
    #[serde(default)]
    pub tenant_id: Option<String>,
}

pub struct JwtManager {
    secret: Vec<u8>,
    expiration_hours: i64,
}

impl JwtManager {
    pub fn new(secret: &[u8]) -> Self {
        Self { secret: secret.to_vec(), expiration_hours: 24 }
    }

    pub fn generate(&self, user: &User) -> Result<String, anyhow::Error> {
        let now = Utc::now();
        let claims = Claims {
            sub: user.id.clone(),
            username: user.username.clone(),
            role: user.role.to_string(),
            exp: (now + chrono::Duration::hours(self.expiration_hours)).timestamp() as usize,
            iat: now.timestamp() as usize,
            tenant_id: user.tenant_id.clone(),
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(&self.secret),
        )?;
        Ok(token)
    }

    pub fn validate(&self, token: &str) -> Result<Claims, anyhow::Error> {
        if is_revoked(token) {
            anyhow::bail!("token revoked");
        }
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(&self.secret),
            &Validation::default(),
        )?;
        Ok(token_data.claims)
    }

    pub fn revoke(&self, token: &str) {
        revoke_token(token);
    }

    pub fn generate_api_token(&self, name: &str) -> Result<String, anyhow::Error> {
        let now = Utc::now();
        let claims = Claims {
            sub: uuid::Uuid::new_v4().to_string(),
            username: format!("api_{}", name),
            role: "api".into(),
            exp: (now + chrono::Duration::days(365)).timestamp() as usize,
            iat: now.timestamp() as usize,
            tenant_id: None,
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(&self.secret),
        )?;
        Ok(token)
    }
}
