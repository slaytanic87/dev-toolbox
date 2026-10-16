use axum::{
    Router,
    routing::{get, post},
};
use devtools::adapter;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_logging("INFO".to_string(), "json".to_string());

    let app = Router::new()
        .route("/", get(crate::adapter::incoming::serve_frontend_index))
        .route("/rest", post(crate::adapter::incoming::handle_rest_request))
        .route(
            "/api/certificates/algorithms",
            get(crate::adapter::incoming::list_key_algorithms),
        )
        .route(
            "/api/certificates/keys",
            post(crate::adapter::incoming::create_key),
        )
        .route(
            "/api/certificates",
            post(crate::adapter::incoming::create_certificate),
        )
        .route(
            "/api/certificates/csr",
            post(crate::adapter::incoming::create_csr),
        )
        .route(
            "/api/certificates/csr/sign",
            post(crate::adapter::incoming::sign_csr),
        )
        .route(
            "/api/certificates/inspect",
            post(crate::adapter::incoming::inspect_certificate),
        )
        .route("/api/jwt/sign", post(crate::adapter::incoming::sign_jwt))
        .route("/api/jwt/verify", post(crate::adapter::incoming::verify_jwt))
        .route("/{*path}", get(crate::adapter::incoming::serve_ui_assets));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    info!("Devtools is running on 0.0.0.0:8080");
    axum::serve(listener, app).await?;
    Ok(())
}

fn init_logging(log_level: String, log_format: String) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_level));

    if log_format.eq_ignore_ascii_case("json") {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .compact()
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
}
