//! HTTP adapter exposing JWT signing and verification to the frontend.

use axum::{Json, http::StatusCode, response::IntoResponse, response::Response};
use serde::Serialize;
use tracing::{info, warn};

use crate::jwt::{self, JwtError, SignRequest, SignResponse, VerifyRequest, VerifyResponse};

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

pub struct JwtApiError(JwtError);

impl From<JwtError> for JwtApiError {
    fn from(error: JwtError) -> Self {
        Self(error)
    }
}

impl IntoResponse for JwtApiError {
    fn into_response(self) -> Response {
        warn!("JWT request failed: {}", self.0);
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorBody {
                error: self.0.message().to_string(),
            }),
        )
            .into_response()
    }
}

type ApiResult<T> = Result<Json<T>, JwtApiError>;

pub async fn sign_jwt(Json(request): Json<SignRequest>) -> ApiResult<SignResponse> {
    info!("Signing a JWT with {:?}", request.algorithm);
    Ok(Json(jwt::sign(&request)?))
}

pub async fn verify_jwt(Json(request): Json<VerifyRequest>) -> ApiResult<VerifyResponse> {
    info!("Verifying a JWT signature with {:?}", request.algorithm);
    Ok(Json(jwt::verify(&request)?))
}
