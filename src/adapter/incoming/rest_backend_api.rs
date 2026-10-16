use axum::{
    Json,
    http::{HeaderMap, HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Serialize, Deserialize)]
pub struct RestRequest {
    method: String,
    path: String,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct RestResponse {
    status: u16,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
}

fn build_header_map(headers: Option<&Vec<(String, String)>>) -> HeaderMap {
    let mut header_map = HeaderMap::new();
    for (key, value) in headers.into_iter().flatten() {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(key.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            header_map.insert(name, value);
        }
    }
    header_map
}

pub async fn handle_rest_request(Json(request): Json<RestRequest>) -> Json<RestResponse> {
    let method = request.method.clone();
    let path = request.path.clone();
    let headers = request.headers.clone();
    let body = request.body.clone();
    info!("Sending {} request to {} with headers {:?}", method, path, headers);
    let response: RestResponse = match method.as_str() {
        "GET" => {
            let request_headers = build_header_map(headers.as_ref());
            let result = reqwest::Client::new()
                .get(&path)
                .headers(request_headers)
                .send()
                .await;
            let response = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = Some(
                        resp.headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect(),
                    );
                    let body = Some(resp.text().await.unwrap_or_default());
                    RestResponse {
                        status,
                        headers,
                        body,
                    }
                }
                Err(_) => RestResponse {
                    status: 500,
                    headers: None,
                    body: Some("Internal Server Error".to_string()),
                },
            };
            response
        }
        "HEAD" => {
            let request_headers = build_header_map(headers.as_ref());
            let result = reqwest::Client::new()
                .head(&path)
                .headers(request_headers)
                .send()
                .await;
            let response = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = Some(
                        resp.headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect(),
                    );
                    RestResponse {
                        status,
                        headers,
                        body: None,
                    }
                }
                Err(_) => RestResponse {
                    status: 500,
                    headers: None,
                    body: Some("Internal Server Error".to_string()),
                },
            };
            response
        }
        "POST" => {
            let request_headers = build_header_map(headers.as_ref());
            let result = reqwest::Client::new()
                .post(&path)
                .headers(request_headers)
                .body(body.clone().unwrap_or_default())
                .send()
                .await;
            let response = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = Some(
                        resp.headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect(),
                    );
                    let body = Some(resp.text().await.unwrap_or_default());
                    RestResponse {
                        status,
                        headers,
                        body,
                    }
                }
                Err(_) => RestResponse {
                    status: 500,
                    headers: None,
                    body: Some("Internal Server Error".to_string()),
                },
            };
            response
        }
        "PUT" => {
            let request_headers = build_header_map(headers.as_ref());
            let result = reqwest::Client::new()
                .put(&path)
                .headers(request_headers)
                .body(body.clone().unwrap_or_default())
                .send()
                .await;
            let response = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = Some(
                        resp.headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect(),
                    );
                    let body = Some(resp.text().await.unwrap_or_default());
                    RestResponse {
                        status,
                        headers,
                        body,
                    }
                }
                Err(_) => RestResponse {
                    status: 500,
                    headers: None,
                    body: Some("Internal Server Error".to_string()),
                },
            };
            response
        }
        "DELETE" => {
            let request_headers = build_header_map(headers.as_ref());
            let result = reqwest::Client::new()
                .delete(&path)
                .headers(request_headers)
                .body(body.clone().unwrap_or_default())
                .send()
                .await;
            let response = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = Some(
                        resp.headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect(),
                    );
                    let body = Some(resp.text().await.unwrap_or_default());
                    RestResponse {
                        status,
                        headers,
                        body,
                    }
                }
                Err(_) => RestResponse {
                    status: 500,
                    headers: None,
                    body: Some("Internal Server Error".to_string()),
                },
            };
            response
        }
        "PATCH" => {
            let request_headers = build_header_map(headers.as_ref());
            let result = reqwest::Client::new()
                .patch(&path)
                .headers(request_headers)
                .body(body.clone().unwrap_or_default())
                .send()
                .await;
            let response = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = Some(
                        resp.headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect(),
                    );
                    let body = Some(resp.text().await.unwrap_or_default());
                    RestResponse {
                        status,
                        headers,
                        body,
                    }
                }
                Err(_) => RestResponse {
                    status: 500,
                    headers: None,
                    body: Some("Internal Server Error".to_string()),
                },
            };
            response
        }
        "OPTIONS" => {
            let request_headers = build_header_map(headers.as_ref());
            let result = reqwest::Client::new()
                .request(reqwest::Method::OPTIONS, &path)
                .headers(request_headers)
                .send()
                .await;
            let response = match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = Some(
                        resp.headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect(),
                    );
                    RestResponse {
                        status,
                        headers,
                        body: None,
                    }
                }
                Err(_) => RestResponse {
                    status: 500,
                    headers: None,
                    body: Some("Internal Server Error".to_string()),
                },
            };
            response
        }
        _ => RestResponse {
            status: 405,
            headers: None,
            body: Some("Method Not Allowed".to_string()),
        },
    };

    Json(response)
}
