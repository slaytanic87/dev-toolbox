//! HTTP adapter exposing the certificate toolkit to the frontend.

use axum::{Json, http::StatusCode, response::IntoResponse, response::Response};
use serde::Serialize;
use tracing::{info, warn};

use crate::certificate::{
    self, AlgorithmInfo, CertificateBundle, CertificateDetails, CertificateRequest, CertificateError,
    CsrBundle, CsrRequest, InspectRequest, KeyMaterial, KeyRequest, SignCsrRequest,
};

#[derive(Serialize)]
pub struct ApiError {
    error: String,
}

pub struct CertificateApiError(CertificateError);

impl From<CertificateError> for CertificateApiError {
    fn from(error: CertificateError) -> Self {
        Self(error)
    }
}

impl IntoResponse for CertificateApiError {
    fn into_response(self) -> Response {
        warn!("Certificate request failed: {}", self.0);
        (
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                error: self.0.message().to_string(),
            }),
        )
            .into_response()
    }
}

type ApiResult<T> = Result<Json<T>, CertificateApiError>;

pub async fn list_key_algorithms() -> Json<Vec<AlgorithmInfo>> {
    Json(certificate::supported_algorithms())
}

pub async fn create_key(Json(request): Json<KeyRequest>) -> ApiResult<KeyMaterial> {
    info!("Creating key material");
    Ok(Json(certificate::create_key(&request)?))
}

pub async fn create_certificate(
    Json(request): Json<CertificateRequest>,
) -> ApiResult<CertificateBundle> {
    info!(
        "Creating certificate for '{}' (ca: {}, signed by CA: {})",
        request.subject.common_name,
        request.constraints.is_ca,
        request.issuer.is_some()
    );
    Ok(Json(certificate::create_certificate(&request)?))
}

pub async fn create_csr(Json(request): Json<CsrRequest>) -> ApiResult<CsrBundle> {
    info!(
        "Creating certificate signing request for '{}'",
        request.subject.common_name
    );
    Ok(Json(certificate::create_csr(&request)?))
}

pub async fn sign_csr(Json(request): Json<SignCsrRequest>) -> ApiResult<CertificateBundle> {
    info!("Signing a certificate signing request");
    Ok(Json(certificate::sign_csr(&request)?))
}

pub async fn inspect_certificate(
    Json(request): Json<InspectRequest>,
) -> ApiResult<CertificateDetails> {
    Ok(Json(certificate::inspect_certificate(&request)?))
}
