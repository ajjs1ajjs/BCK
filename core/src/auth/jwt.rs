use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use chrono::Utc;

use super::User;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub username: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
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
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(&self.secret),
        )?;
        Ok(token)
    }

    pub fn validate(&self, token: &str) -> Result<Claims, anyhow::Error> {
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(&self.secret),
            &Validation::default(),
        )?;
        Ok(token_data.claims)
    }

    pub fn generate_api_token(&self, name: &str) -> Result<String, anyhow::Error> {
        let now = Utc::now();
        let claims = Claims {
            sub: uuid::Uuid::new_v4().to_string(),
            username: format!("api_{}", name),
            role: "api".into(),
            exp: (now + chrono::Duration::days(365)).timestamp() as usize,
            iat: now.timestamp() as usize,
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(&self.secret),
        )?;
        Ok(token)
    }
}
