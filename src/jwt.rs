//! JWT signature creation and verification (RFC 7518).
//!
//! The browser's Web Crypto API only imports PKCS#8 private keys and SPKI public
//! keys. This module accepts every common PEM flavour instead:
//!
//! | purpose | accepted PEM labels                                   |
//! | ------- | ----------------------------------------------------- |
//! | sign    | `PRIVATE KEY` (PKCS#8), `RSA PRIVATE KEY` (PKCS#1), `EC PRIVATE KEY` (SEC1) |
//! | verify  | `PUBLIC KEY` (SPKI), `RSA PUBLIC KEY` (PKCS#1), `CERTIFICATE` |
//!
//! Only the signature is handled here - the caller supplies the already
//! base64url encoded `header.payload` signing input.

use aws_lc_rs::hmac;
use aws_lc_rs::rand::SystemRandom;
use aws_lc_rs::signature::{
    self, EcdsaKeyPair, EcdsaSigningAlgorithm, RsaEncoding, RsaKeyPair, UnparsedPublicKey,
    VerificationAlgorithm,
};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64_URL};
use serde::{Deserialize, Serialize};
use std::fmt;
use x509_parser::prelude::{FromDer, X509Certificate};
use x509_parser::public_key::PublicKey;
use x509_parser::x509::SubjectPublicKeyInfo;

/// Key sizes the crypto library accepts for RSA signatures.
const RSA_BITS: std::ops::RangeInclusive<usize> = 2048..=8192;

/* -------------------------------------------------------------------- error */

#[derive(Debug)]
pub struct JwtError {
    message: String,
}

impl JwtError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for JwtError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for JwtError {}

type Result<T> = std::result::Result<T, JwtError>;

/* --------------------------------------------------------------- algorithms */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JwtAlgorithm {
    HS256,
    HS384,
    HS512,
    RS256,
    RS384,
    RS512,
    PS256,
    PS384,
    PS512,
    ES256,
    ES384,
    ES512,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Hmac,
    RsaPkcs1,
    RsaPss,
    Ecdsa,
}

/// How a shared secret is encoded in the request.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyFormat {
    /// The secret is used as UTF-8 text.
    #[default]
    Utf8,
    /// The secret is standard base64 encoded binary.
    Base64,
}

impl JwtAlgorithm {
    fn family(self) -> Family {
        match self {
            Self::HS256 | Self::HS384 | Self::HS512 => Family::Hmac,
            Self::RS256 | Self::RS384 | Self::RS512 => Family::RsaPkcs1,
            Self::PS256 | Self::PS384 | Self::PS512 => Family::RsaPss,
            Self::ES256 | Self::ES384 | Self::ES512 => Family::Ecdsa,
        }
    }

    fn hmac(self) -> hmac::Algorithm {
        match self {
            Self::HS256 => hmac::HMAC_SHA256,
            Self::HS384 => hmac::HMAC_SHA384,
            _ => hmac::HMAC_SHA512,
        }
    }

    fn rsa_encoding(self) -> &'static dyn RsaEncoding {
        match self {
            Self::RS256 => &signature::RSA_PKCS1_SHA256,
            Self::RS384 => &signature::RSA_PKCS1_SHA384,
            Self::RS512 => &signature::RSA_PKCS1_SHA512,
            Self::PS256 => &signature::RSA_PSS_SHA256,
            Self::PS384 => &signature::RSA_PSS_SHA384,
            _ => &signature::RSA_PSS_SHA512,
        }
    }

    fn rsa_verification(self) -> &'static dyn VerificationAlgorithm {
        match self {
            Self::RS256 => &signature::RSA_PKCS1_2048_8192_SHA256,
            Self::RS384 => &signature::RSA_PKCS1_2048_8192_SHA384,
            Self::RS512 => &signature::RSA_PKCS1_2048_8192_SHA512,
            Self::PS256 => &signature::RSA_PSS_2048_8192_SHA256,
            Self::PS384 => &signature::RSA_PSS_2048_8192_SHA384,
            _ => &signature::RSA_PSS_2048_8192_SHA512,
        }
    }

    fn ecdsa_signing(self) -> &'static EcdsaSigningAlgorithm {
        match self {
            Self::ES256 => &signature::ECDSA_P256_SHA256_FIXED_SIGNING,
            Self::ES384 => &signature::ECDSA_P384_SHA384_FIXED_SIGNING,
            _ => &signature::ECDSA_P521_SHA512_FIXED_SIGNING,
        }
    }

    fn ecdsa_verification(self) -> &'static dyn VerificationAlgorithm {
        match self {
            Self::ES256 => &signature::ECDSA_P256_SHA256_FIXED,
            Self::ES384 => &signature::ECDSA_P384_SHA384_FIXED,
            _ => &signature::ECDSA_P521_SHA512_FIXED,
        }
    }

    /// Curve name and the length of an uncompressed EC point on that curve.
    fn curve(self) -> (&'static str, usize) {
        match self {
            Self::ES256 => ("P-256", 65),
            Self::ES384 => ("P-384", 97),
            _ => ("P-521", 133),
        }
    }
}

/* ----------------------------------------------------------------- requests */

#[derive(Debug, Deserialize)]
pub struct SignRequest {
    pub algorithm: JwtAlgorithm,
    /// HMAC secret, or a PEM encoded private key for RSA/ECDSA algorithms.
    pub key: String,
    #[serde(default)]
    pub key_format: KeyFormat,
    /// `base64url(header) + "." + base64url(payload)`.
    pub signing_input: String,
}

#[derive(Debug, Serialize)]
pub struct SignResponse {
    /// base64url encoded signature without padding.
    pub signature: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    pub algorithm: JwtAlgorithm,
    /// HMAC secret, or a PEM encoded public key / certificate for RSA/ECDSA algorithms.
    pub key: String,
    #[serde(default)]
    pub key_format: KeyFormat,
    pub signing_input: String,
    /// base64url encoded signature.
    pub signature: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    pub valid: bool,
}

/* --------------------------------------------------------------------- sign */

pub fn sign(request: &SignRequest) -> Result<SignResponse> {
    let input = request.signing_input.as_bytes();
    let algorithm = request.algorithm;

    let signature = match algorithm.family() {
        Family::Hmac => {
            let key = hmac_key(algorithm, &request.key, request.key_format)?;
            hmac::sign(&key, input).as_ref().to_vec()
        }
        Family::RsaPkcs1 | Family::RsaPss => sign_rsa(algorithm, &request.key, input)?,
        Family::Ecdsa => sign_ecdsa(algorithm, &request.key, input)?,
    };

    Ok(SignResponse {
        signature: BASE64_URL.encode(signature),
    })
}

fn sign_rsa(algorithm: JwtAlgorithm, pem_text: &str, input: &[u8]) -> Result<Vec<u8>> {
    let block = parse_pem(pem_text)?;
    let key_pair = match block.label.as_str() {
        "RSA PRIVATE KEY" => RsaKeyPair::from_der(&block.der),
        "PRIVATE KEY" => RsaKeyPair::from_pkcs8(&block.der),
        "EC PRIVATE KEY" => {
            return Err(JwtError::new(format!(
                "The key is an EC key, but {algorithm:?} requires an RSA key."
            )));
        }
        other => return Err(unsupported_private_key_label(other)),
    }
    .map_err(|_| {
        JwtError::new(format!(
            "The private key is not a valid RSA key, which {algorithm:?} requires \
             (RSA keys must be 2048-8192 bits)."
        ))
    })?;

    let mut signature = vec![0; key_pair.public_modulus_len()];
    key_pair
        .sign(
            algorithm.rsa_encoding(),
            &SystemRandom::new(),
            input,
            &mut signature,
        )
        .map_err(|_| JwtError::new("Signing with the RSA key failed."))?;
    Ok(signature)
}

fn sign_ecdsa(algorithm: JwtAlgorithm, pem_text: &str, input: &[u8]) -> Result<Vec<u8>> {
    let block = parse_pem(pem_text)?;
    match block.label.as_str() {
        "PRIVATE KEY" | "EC PRIVATE KEY" => {}
        "RSA PRIVATE KEY" => {
            return Err(JwtError::new(format!(
                "The key is an RSA key, but {algorithm:?} requires an EC key."
            )));
        }
        other => return Err(unsupported_private_key_label(other)),
    }

    let (curve, _) = algorithm.curve();
    // Accepts both PKCS#8 and SEC1 (RFC 5915) encodings.
    let key_pair = EcdsaKeyPair::from_private_key_der(algorithm.ecdsa_signing(), &block.der)
        .map_err(|_| {
            JwtError::new(format!(
                "The private key is not a valid {curve} EC key, which {algorithm:?} requires."
            ))
        })?;

    let signature = key_pair
        .sign(&SystemRandom::new(), input)
        .map_err(|_| JwtError::new("Signing with the EC key failed."))?;
    Ok(signature.as_ref().to_vec())
}

fn unsupported_private_key_label(label: &str) -> JwtError {
    match label {
        "ENCRYPTED PRIVATE KEY" => JwtError::new(
            "Encrypted private keys are not supported. Decrypt the key first: \
             openssl pkcs8 -in key.pem -out key.pkcs8.pem",
        ),
        "PUBLIC KEY" | "RSA PUBLIC KEY" | "CERTIFICATE" => {
            JwtError::new("Signing requires a private key, but a public key was supplied.")
        }
        other => JwtError::new(format!(
            "Unsupported PEM block \"{other}\". Use PRIVATE KEY (PKCS#8), \
             RSA PRIVATE KEY (PKCS#1) or EC PRIVATE KEY (SEC1)."
        )),
    }
}

/* ------------------------------------------------------------------- verify */

pub fn verify(request: &VerifyRequest) -> Result<VerifyResponse> {
    let input = request.signing_input.as_bytes();
    let algorithm = request.algorithm;
    let signature = decode_signature(&request.signature)?;

    let valid = match algorithm.family() {
        Family::Hmac => {
            let key = hmac_key(algorithm, &request.key, request.key_format)?;
            hmac::verify(&key, input, &signature).is_ok()
        }
        Family::RsaPkcs1 | Family::RsaPss => match parse_public_key(&request.key)? {
            ParsedPublicKey::Rsa(der) => {
                check_rsa_size(&der)?;
                UnparsedPublicKey::new(algorithm.rsa_verification(), der)
                    .verify(input, &signature)
                    .is_ok()
            }
            ParsedPublicKey::Ec(_) => {
                return Err(JwtError::new(format!(
                    "The key is an EC key, but {algorithm:?} requires an RSA key."
                )));
            }
        },
        Family::Ecdsa => match parse_public_key(&request.key)? {
            ParsedPublicKey::Ec(point) => {
                let (curve, point_len) = algorithm.curve();
                if point.len() != point_len {
                    return Err(JwtError::new(format!(
                        "The public key is not a {curve} key, which {algorithm:?} requires."
                    )));
                }
                UnparsedPublicKey::new(algorithm.ecdsa_verification(), point)
                    .verify(input, &signature)
                    .is_ok()
            }
            ParsedPublicKey::Rsa(_) => {
                return Err(JwtError::new(format!(
                    "The key is an RSA key, but {algorithm:?} requires an EC key."
                )));
            }
        },
    };

    Ok(VerifyResponse { valid })
}

fn decode_signature(signature: &str) -> Result<Vec<u8>> {
    BASE64_URL
        .decode(signature.trim().trim_end_matches('='))
        .map_err(|_| JwtError::new("The signature segment is not valid base64url."))
}

fn check_rsa_size(pkcs1_public_key: &[u8]) -> Result<()> {
    let bits = x509_parser::public_key::RSAPublicKey::from_der(pkcs1_public_key)
        .map(|(_, key)| key.key_size())
        .map_err(|_| JwtError::new("The RSA public key could not be parsed."))?;
    if RSA_BITS.contains(&bits) {
        Ok(())
    } else {
        Err(JwtError::new(format!(
            "RSA keys must be 2048-8192 bits, this one has {bits} bits."
        )))
    }
}

/* -------------------------------------------------------------------- hmac */

fn hmac_key(algorithm: JwtAlgorithm, secret: &str, format: KeyFormat) -> Result<hmac::Key> {
    let bytes = match format {
        KeyFormat::Utf8 => secret.as_bytes().to_vec(),
        KeyFormat::Base64 => BASE64
            .decode(secret.split_whitespace().collect::<String>())
            .map_err(|_| JwtError::new("The secret is not valid base64."))?,
    };
    if bytes.is_empty() {
        return Err(JwtError::new("The HMAC secret must not be empty."));
    }
    Ok(hmac::Key::new(algorithm.hmac(), &bytes))
}

/* ---------------------------------------------------------------- key parsing */

struct PemBlock {
    label: String,
    der: Vec<u8>,
}

fn parse_pem(text: &str) -> Result<PemBlock> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(JwtError::new("The key must not be empty."));
    }
    let block = pem::parse(trimmed).map_err(|_| {
        JwtError::new("Expected a PEM block such as \"-----BEGIN PRIVATE KEY-----\".")
    })?;
    Ok(PemBlock {
        label: block.tag().to_string(),
        der: block.contents().to_vec(),
    })
}

enum ParsedPublicKey {
    /// PKCS#1 `RSAPublicKey` DER.
    Rsa(Vec<u8>),
    /// Uncompressed EC point.
    Ec(Vec<u8>),
}

fn parse_public_key(text: &str) -> Result<ParsedPublicKey> {
    let block = parse_pem(text)?;
    match block.label.as_str() {
        "RSA PUBLIC KEY" => Ok(ParsedPublicKey::Rsa(block.der)),
        "PUBLIC KEY" => {
            let (_, spki) = SubjectPublicKeyInfo::from_der(&block.der).map_err(|_| {
                JwtError::new("The PUBLIC KEY block is not a valid SPKI structure.")
            })?;
            public_key_from_spki(&spki)
        }
        "CERTIFICATE" => {
            let (_, certificate) = X509Certificate::from_der(&block.der).map_err(|_| {
                JwtError::new("The CERTIFICATE block is not a valid X.509 certificate.")
            })?;
            public_key_from_spki(certificate.public_key())
        }
        "PRIVATE KEY" | "RSA PRIVATE KEY" | "EC PRIVATE KEY" | "ENCRYPTED PRIVATE KEY" => Err(
            JwtError::new("Verification requires a public key, but a private key was supplied."),
        ),
        other => Err(JwtError::new(format!(
            "Unsupported PEM block \"{other}\". Use PUBLIC KEY (SPKI), \
             RSA PUBLIC KEY (PKCS#1) or CERTIFICATE."
        ))),
    }
}

fn public_key_from_spki(spki: &SubjectPublicKeyInfo<'_>) -> Result<ParsedPublicKey> {
    let bytes = spki.subject_public_key.data.to_vec();
    match spki.parsed() {
        Ok(PublicKey::RSA(_)) => Ok(ParsedPublicKey::Rsa(bytes)),
        Ok(PublicKey::EC(_)) => Ok(ParsedPublicKey::Ec(bytes)),
        _ => Err(JwtError::new(
            "Unsupported public key type. Only RSA and EC (P-256, P-384, P-521) keys can verify a JWT.",
        )),
    }
}

/* -------------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;
    use aws_lc_rs::encoding::AsDer;
    use rcgen::{
        KeyPair, PKCS_ECDSA_P256_SHA256, PKCS_ECDSA_P384_SHA384, PKCS_ECDSA_P521_SHA512,
        PKCS_RSA_SHA256, RsaKeySize,
    };
    use x509_parser::der_parser::parse_der;

    const INPUT: &str = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";

    fn pem_block(label: &str, der: &[u8]) -> String {
        pem::encode(&pem::Pem::new(label, der.to_vec()))
    }

    fn rsa_pair() -> KeyPair {
        KeyPair::generate_rsa_for(&PKCS_RSA_SHA256, RsaKeySize::_2048).unwrap()
    }

    /// Unwraps the PKCS#1 `RSAPrivateKey` embedded in a PKCS#8 container.
    fn pkcs1_private_key(pair: &KeyPair) -> String {
        let pkcs8 = pair.serialize_der();
        let (_, object) = parse_der(&pkcs8).unwrap();
        let inner = object.as_sequence().unwrap()[2].as_slice().unwrap();
        pem_block("RSA PRIVATE KEY", inner)
    }

    fn pkcs1_public_key(pair: &KeyPair) -> String {
        let spki = pem::parse(pair.public_key_pem()).unwrap();
        let (_, spki) = SubjectPublicKeyInfo::from_der(spki.contents()).unwrap();
        pem_block("RSA PUBLIC KEY", &spki.subject_public_key.data)
    }

    fn sec1_private_key(pair: &KeyPair, algorithm: JwtAlgorithm) -> String {
        let key_pair =
            EcdsaKeyPair::from_pkcs8(algorithm.ecdsa_signing(), &pair.serialize_der()).unwrap();
        let der =
            AsDer::<aws_lc_rs::encoding::EcPrivateKeyRfc5915Der>::as_der(&key_pair.private_key())
                .unwrap();
        pem_block("EC PRIVATE KEY", der.as_ref())
    }

    fn sign_with(algorithm: JwtAlgorithm, key: &str) -> Result<String> {
        sign(&SignRequest {
            algorithm,
            key: key.to_string(),
            key_format: KeyFormat::Utf8,
            signing_input: INPUT.to_string(),
        })
        .map(|response| response.signature)
    }

    fn verify_with(algorithm: JwtAlgorithm, key: &str, signature: &str) -> Result<bool> {
        verify(&VerifyRequest {
            algorithm,
            key: key.to_string(),
            key_format: KeyFormat::Utf8,
            signing_input: INPUT.to_string(),
            signature: signature.to_string(),
        })
        .map(|response| response.valid)
    }

    #[test]
    fn hmac_matches_the_jwt_io_sample() {
        let request = SignRequest {
            algorithm: JwtAlgorithm::HS256,
            key: "your-256-bit-secret".to_string(),
            key_format: KeyFormat::Utf8,
            signing_input: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.\
                eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ"
                .to_string(),
        };
        assert_eq!(
            sign(&request).unwrap().signature,
            "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        );
    }

    #[test]
    fn hmac_round_trips_for_every_hash_and_secret_encoding() {
        for algorithm in [
            JwtAlgorithm::HS256,
            JwtAlgorithm::HS384,
            JwtAlgorithm::HS512,
        ] {
            for (secret, format) in [("secret", KeyFormat::Utf8), ("c2VjcmV0", KeyFormat::Base64)] {
                let signature = sign(&SignRequest {
                    algorithm,
                    key: secret.to_string(),
                    key_format: format,
                    signing_input: INPUT.to_string(),
                })
                .unwrap()
                .signature;

                let verify_request = |signature: &str, key: &str| VerifyRequest {
                    algorithm,
                    key: key.to_string(),
                    key_format: format,
                    signing_input: INPUT.to_string(),
                    signature: signature.to_string(),
                };
                assert!(verify(&verify_request(&signature, secret)).unwrap().valid);
                assert!(
                    !verify(&verify_request(&signature, "c2VjcmV1"))
                        .unwrap()
                        .valid
                );
            }
        }
    }

    #[test]
    fn rejects_empty_and_malformed_hmac_secrets() {
        let empty = sign_with(JwtAlgorithm::HS256, "");
        assert_eq!(
            empty.unwrap_err().message(),
            "The HMAC secret must not be empty."
        );

        let request = SignRequest {
            algorithm: JwtAlgorithm::HS256,
            key: "***".to_string(),
            key_format: KeyFormat::Base64,
            signing_input: INPUT.to_string(),
        };
        assert_eq!(
            sign(&request).unwrap_err().message(),
            "The secret is not valid base64."
        );
    }

    #[test]
    fn rsa_round_trips_with_pkcs8_pkcs1_and_spki_keys() {
        let pair = rsa_pair();
        let pkcs8 = pair.serialize_pem();
        let pkcs1 = pkcs1_private_key(&pair);
        let spki = pair.public_key_pem();
        let pkcs1_public = pkcs1_public_key(&pair);

        for algorithm in [
            JwtAlgorithm::RS256,
            JwtAlgorithm::RS384,
            JwtAlgorithm::RS512,
            JwtAlgorithm::PS256,
            JwtAlgorithm::PS384,
            JwtAlgorithm::PS512,
        ] {
            for private_key in [&pkcs8, &pkcs1] {
                let signature = sign_with(algorithm, private_key).unwrap();
                for public_key in [&spki, &pkcs1_public] {
                    assert!(
                        verify_with(algorithm, public_key, &signature).unwrap(),
                        "{algorithm:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn rsa_pkcs1_signatures_are_deterministic_and_match_the_sample_format() {
        let pair = rsa_pair();
        let key = pkcs1_private_key(&pair);
        let first = sign_with(JwtAlgorithm::RS256, &key).unwrap();
        assert_eq!(first, sign_with(JwtAlgorithm::RS256, &key).unwrap());
        // 256 byte signature -> 342 base64url characters without padding.
        assert_eq!(first.len(), 342);
    }

    #[test]
    fn ecdsa_round_trips_with_pkcs8_and_sec1_keys() {
        for (algorithm, rcgen_algorithm) in [
            (JwtAlgorithm::ES256, &PKCS_ECDSA_P256_SHA256),
            (JwtAlgorithm::ES384, &PKCS_ECDSA_P384_SHA384),
            (JwtAlgorithm::ES512, &PKCS_ECDSA_P521_SHA512),
        ] {
            let pair = KeyPair::generate_for(rcgen_algorithm).unwrap();
            let spki = pair.public_key_pem();

            for private_key in [pair.serialize_pem(), sec1_private_key(&pair, algorithm)] {
                let signature = sign_with(algorithm, &private_key).unwrap();
                assert!(
                    verify_with(algorithm, &spki, &signature).unwrap(),
                    "{algorithm:?}"
                );
            }
        }
    }

    #[test]
    fn ecdsa_signatures_have_the_fixed_jws_length() {
        let pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
        let signature = sign_with(JwtAlgorithm::ES256, &pair.serialize_pem()).unwrap();
        // r || s is 64 bytes -> 86 base64url characters without padding.
        assert_eq!(signature.len(), 86);
    }

    #[test]
    fn verifies_with_a_certificate() {
        let pair = rsa_pair();
        let certificate = rcgen::CertificateParams::new(vec!["jwt.test".to_string()])
            .unwrap()
            .self_signed(&pair)
            .unwrap();

        let signature = sign_with(JwtAlgorithm::RS256, &pair.serialize_pem()).unwrap();
        assert!(verify_with(JwtAlgorithm::RS256, &certificate.pem(), &signature).unwrap());
    }

    #[test]
    fn a_tampered_signature_is_invalid_not_an_error() {
        let pair = rsa_pair();
        let signature = sign_with(JwtAlgorithm::RS256, &pair.serialize_pem()).unwrap();

        let other = rsa_pair();
        assert!(!verify_with(JwtAlgorithm::RS256, &other.public_key_pem(), &signature).unwrap());
        assert!(!verify_with(JwtAlgorithm::RS256, &pair.public_key_pem(), "AAAA").unwrap());

        let tampered = verify(&VerifyRequest {
            algorithm: JwtAlgorithm::RS256,
            key: pair.public_key_pem(),
            key_format: KeyFormat::Utf8,
            signing_input: format!("{INPUT}x"),
            signature,
        })
        .unwrap();
        assert!(!tampered.valid);
    }

    #[test]
    fn rejects_keys_that_do_not_match_the_algorithm() {
        let rsa = rsa_pair();
        let p256 = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();

        let message = |result: Result<String>| result.unwrap_err().message().to_string();
        assert!(message(sign_with(JwtAlgorithm::ES256, &rsa.serialize_pem())).contains("P-256"));
        assert!(message(sign_with(JwtAlgorithm::RS256, &p256.serialize_pem())).contains("RSA"));
        assert!(message(sign_with(JwtAlgorithm::ES384, &p256.serialize_pem())).contains("P-384"));
        assert!(
            message(sign_with(JwtAlgorithm::ES256, &pkcs1_private_key(&rsa))).contains("RSA key")
        );
        assert!(
            message(sign_with(
                JwtAlgorithm::RS256,
                &sec1_private_key(&p256, JwtAlgorithm::ES256)
            ))
            .contains("EC key")
        );

        let signature = sign_with(JwtAlgorithm::ES256, &p256.serialize_pem()).unwrap();
        let verify_error = |algorithm, key: &str| {
            verify_with(algorithm, key, &signature)
                .unwrap_err()
                .message()
                .to_string()
        };
        assert!(verify_error(JwtAlgorithm::RS256, &p256.public_key_pem()).contains("EC key"));
        assert!(verify_error(JwtAlgorithm::ES256, &rsa.public_key_pem()).contains("RSA key"));
        assert!(verify_error(JwtAlgorithm::ES384, &p256.public_key_pem()).contains("P-384"));
    }

    #[test]
    fn rejects_the_wrong_kind_of_pem_block() {
        let pair = rsa_pair();
        let sign_error = sign_with(JwtAlgorithm::RS256, &pair.public_key_pem()).unwrap_err();
        assert!(sign_error.message().contains("private key"));

        let verify_error =
            verify_with(JwtAlgorithm::RS256, &pair.serialize_pem(), "AAAA").unwrap_err();
        assert!(verify_error.message().contains("public key"));

        let encrypted = pem_block("ENCRYPTED PRIVATE KEY", &[1, 2, 3]);
        assert!(
            sign_with(JwtAlgorithm::RS256, &encrypted)
                .unwrap_err()
                .message()
                .contains("Encrypted")
        );

        assert!(
            sign_with(JwtAlgorithm::RS256, "not a pem")
                .unwrap_err()
                .message()
                .contains("PEM")
        );
        assert!(
            sign_with(JwtAlgorithm::RS256, "  ")
                .unwrap_err()
                .message()
                .contains("empty")
        );
    }

    #[test]
    fn rejects_an_invalid_signature_encoding() {
        let pair = rsa_pair();
        let error = verify_with(JwtAlgorithm::RS256, &pair.public_key_pem(), "%%%").unwrap_err();
        assert_eq!(
            error.message(),
            "The signature segment is not valid base64url."
        );
    }

    #[test]
    fn accepts_padded_signatures() {
        let signature = sign(&SignRequest {
            algorithm: JwtAlgorithm::HS256,
            key: "k".to_string(),
            key_format: KeyFormat::Utf8,
            signing_input: INPUT.to_string(),
        })
        .unwrap()
        .signature;
        assert!(verify_with(JwtAlgorithm::HS256, "k", &format!("{signature}=")).unwrap());
    }
}
