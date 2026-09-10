use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use chrono::Utc;

use super::User;

/// SEC-003: bound the in-memory revocation map to prevent unbounded growth.
const MAX_REVOKED_TOKENS: usize = 10_000;

fn revoked_map() -> &'static dashmap::DashMap<String, i64> {
    static MAP: std::sync::OnceLock<dashmap::DashMap<String, i64>> = std::sync::OnceLock::new();
    MAP.get_or_init(dashmap::DashMap::new)
}

fn bound_revoked_map() {
    let map = revoked_map();
    if map.len() <= MAX_REVOKED_TOKENS {
        return;
    }
    let now = chrono::Utc::now().timestamp();
    // First drop expired entries.
    map.retain(|_, exp| *exp > now);
    if map.len() <= MAX_REVOKED_TOKENS {
        return;
    }
    // Still overfull: drop a batch of the soonest-expiring entries to
    // keep memory bounded (persistent DB table remains authoritative).
    let mut entries: Vec<(String, i64)> = map.iter().map(|e| (e.key().clone(), *e.value())).collect();
    entries.sort_by_key(|(_, exp)| *exp);
    let to_drop = map.len() - MAX_REVOKED_TOKENS + 1000;
    for (k, _) in entries.into_iter().take(to_drop) {
        map.remove(&k);
    }
}
fn is_revoked(token: &str) -> bool {
    let now = chrono::Utc::now().timestamp();
    if let Some(entry) = revoked_map().get(token) {
        if *entry > now {
            return true;
        } else {
            drop(entry);
            revoked_map().remove(token);
        }
    }
    false
}
fn revoke_token(secret: &[u8], token: &str) {
    let exp = jsonwebtoken::decode::<Claims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(secret),
        &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
    )
    .ok()
    .map(|d| d.claims.exp as i64)
    .unwrap_or_else(|| chrono::Utc::now().timestamp() + 24 * 3600);
    revoked_map().insert(token.to_string(), exp);
    // Prune expired entries opportunistically + enforce hard bound (keep map bounded)
    bound_revoked_map();
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

#[derive(Clone)]
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
        revoke_token(&self.secret, token);
    }

    /// Decode the expiry of a token without consulting the revocation list
    /// (used when persisting a revocation that is already in-memory).
    pub fn expiry_of(&self, token: &str) -> Option<i64> {
        jsonwebtoken::decode::<Claims>(
            token,
            &jsonwebtoken::DecodingKey::from_secret(&self.secret),
            &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
        )
        .ok()
        .map(|d| d.claims.exp as i64)
    }

        /// Periodically clean up expired entries from the JWT revocation map.
    /// Returns the number of entries removed.
    pub fn cleanup_revoked(&self) -> usize {
        let now = chrono::Utc::now().timestamp();
        let map = revoked_map();
        let initial_len = map.len();
        map.retain(|_, exp| *exp > now);
        let final_len = map.len();
        initial_len - final_len
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

