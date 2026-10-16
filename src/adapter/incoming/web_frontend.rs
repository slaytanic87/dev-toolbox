use axum::{
    body::Body,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "frontend/dist"]
struct WebAssets;

fn embedded_asset_response(path: &str, content: rust_embed::EmbeddedFile) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Body::from(content.data).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_str(mime.as_ref())
            .unwrap_or_else(|_| header::HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        if path == "index.html" {
            header::HeaderValue::from_static("no-cache")
        } else {
            header::HeaderValue::from_static("public, max-age=31536000, immutable")
        },
    );
    response
}

pub async fn serve_ui_assets(uri: Uri) -> impl IntoResponse {
    let mut path: String = uri.path().trim_start_matches("/").to_string();
    if path.is_empty() {
        path = "index.html".to_string();
    }

    match WebAssets::get(&path) {
        Some(content) => embedded_asset_response(&path, content),
        None => {
            if path.contains('.') {
                StatusCode::NOT_FOUND.into_response()
            } else {
                // Fallback to index.html
                match WebAssets::get("index.html") {
                    Some(content) => embedded_asset_response("index.html", content),
                    None => StatusCode::NOT_FOUND.into_response(),
                }
            }
        }
    }
}

pub async fn serve_frontend_index() -> impl IntoResponse {
    match WebAssets::get("index.html") {
        Some(content) => embedded_asset_response("index.html", content),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
