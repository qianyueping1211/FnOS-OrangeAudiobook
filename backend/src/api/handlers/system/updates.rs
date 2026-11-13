//! Authenticated, administrator-only update APIs, separate from business routes.
use crate::api::require_admin;
use crate::auth::middleware::AuthUser;
use axum::{Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

type Response = std::result::Result<Json<Value>, (StatusCode, Json<Value>)>;

fn failure(error: anyhow::Error) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": error.to_string() })),
    )
}

fn admin(user: &AuthUser) -> std::result::Result<(), (StatusCode, Json<Value>)> {
    require_admin(user).map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "需要管理员权限" })),
        )
    })
}

pub async fn status(user: AuthUser) -> Response {
    admin(&user)?;
    crate::update::status().await.map(Json).map_err(failure)
}

pub async fn check(user: AuthUser) -> Response {
    admin(&user)?;
    crate::update::check().await.map(Json).map_err(failure)
}

#[derive(Deserialize)]
pub struct TokenRequest {
    pub token: String,
}

pub async fn token(user: AuthUser, Json(request): Json<TokenRequest>) -> Response {
    admin(&user)?;
    crate::update::save_token(&request.token).map_err(failure)?;
    Ok(Json(json!({ "has_token": true })))
}

pub async fn delete_token(user: AuthUser) -> Response {
    admin(&user)?;
    crate::update::delete_token().map_err(failure)?;
    Ok(Json(json!({ "has_token": false })))
}

#[derive(Deserialize)]
pub struct InstallRequest {
    pub version: String,
    pub tag: String,
}

pub async fn install(user: AuthUser, Json(request): Json<InstallRequest>) -> Response {
    admin(&user)?;
    crate::update::install(request.version, request.tag)
        .await
        .map(Json)
        .map_err(failure)
}
