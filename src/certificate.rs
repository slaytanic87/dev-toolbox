//! X.509 certificate, CSR and key pair generation.
//!
//! Everything cryptographic happens here: the frontend only ever renders the
//! artefacts (PEM text plus base64 encoded DER) returned by these functions.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rcgen::{
    BasicConstraints, CertificateParams, CertificateSigningRequestParams, DnType,
    ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair, KeyUsagePurpose, PublicKeyData, RsaKeySize,
    SanType, SerialNumber, SignatureAlgorithm, string::Ia5String,
};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::fmt;
use std::net::IpAddr;
use std::str::FromStr;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use x509_parser::prelude::{FromDer, X509Certificate};

/* -------------------------------------------------------------------- error */

#[derive(Debug)]
pub struct CertificateError {
    message: String,
}

impl CertificateError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for CertificateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CertificateError {}

impl From<rcgen::Error> for CertificateError {
    fn from(error: rcgen::Error) -> Self {
        Self::new(error.to_string())
    }
}

type Result<T> = std::result::Result<T, CertificateError>;

/* ---------------------------------------------------------------- algorithms */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeyAlgorithm {
    EcdsaP256,
    EcdsaP384,
    EcdsaP521,
    Ed25519,
    #[serde(rename = "rsa-2048")]
    Rsa2048,
    #[serde(rename = "rsa-3072")]
    Rsa3072,
    #[serde(rename = "rsa-4096")]
    Rsa4096,
}

impl KeyAlgorithm {
    fn signature_algorithm(self) -> &'static SignatureAlgorithm {
        match self {
            Self::EcdsaP256 => &rcgen::PKCS_ECDSA_P256_SHA256,
            Self::EcdsaP384 => &rcgen::PKCS_ECDSA_P384_SHA384,
            Self::EcdsaP521 => &rcgen::PKCS_ECDSA_P521_SHA512,
            Self::Ed25519 => &rcgen::PKCS_ED25519,
            Self::Rsa2048 | Self::Rsa3072 | Self::Rsa4096 => &rcgen::PKCS_RSA_SHA256,
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::EcdsaP256 => "ecdsa-p256",
            Self::EcdsaP384 => "ecdsa-p384",
            Self::EcdsaP521 => "ecdsa-p521",
            Self::Ed25519 => "ed25519",
            Self::Rsa2048 => "rsa-2048",
            Self::Rsa3072 => "rsa-3072",
            Self::Rsa4096 => "rsa-4096",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::EcdsaP256 => "ECDSA P-256 (SHA-256)",
            Self::EcdsaP384 => "ECDSA P-384 (SHA-384)",
            Self::EcdsaP521 => "ECDSA P-521 (SHA-512)",
            Self::Ed25519 => "Ed25519",
            Self::Rsa2048 => "RSA 2048 (SHA-256)",
            Self::Rsa3072 => "RSA 3072 (SHA-256)",
            Self::Rsa4096 => "RSA 4096 (SHA-256)",
        }
    }

    fn generate(self) -> Result<KeyPair> {
        let key_pair = match self {
            Self::Rsa2048 => KeyPair::generate_rsa_for(self.signature_algorithm(), RsaKeySize::_2048),
            Self::Rsa3072 => KeyPair::generate_rsa_for(self.signature_algorithm(), RsaKeySize::_3072),
            Self::Rsa4096 => KeyPair::generate_rsa_for(self.signature_algorithm(), RsaKeySize::_4096),
            other => KeyPair::generate_for(other.signature_algorithm()),
        }?;
        Ok(key_pair)
    }

    /// Best effort mapping of a parsed key back onto one of the offered presets.
    /// RSA key sizes are reported by the caller, because the signature algorithm
    /// alone does not carry the modulus length.
    fn from_signature_algorithm(algorithm: &'static SignatureAlgorithm) -> Option<Self> {
        [
            Self::EcdsaP256,
            Self::EcdsaP384,
            Self::EcdsaP521,
            Self::Ed25519,
            Self::Rsa2048,
        ]
        .into_iter()
        .find(|candidate| candidate.signature_algorithm() == algorithm)
    }
}

/* -------------------------------------------------------------------- input */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeySource {
    Generate,
    Manual,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyInput {
    pub source: KeySource,
    #[serde(default)]
    pub algorithm: Option<KeyAlgorithm>,
    /// PEM (PKCS#8, SEC1 or PKCS#1) or base64 encoded DER - only for `manual`.
    #[serde(default)]
    pub private_key: Option<String>,
}

impl Default for KeyInput {
    fn default() -> Self {
        Self {
            source: KeySource::Generate,
            algorithm: Some(KeyAlgorithm::EcdsaP256),
            private_key: None,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SubjectInput {
    #[serde(default)]
    pub common_name: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub organizational_unit: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub locality: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SanKind {
    Dns,
    Ip,
    Email,
    Uri,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SanInput {
    pub kind: SanKind,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ValidityInput {
    /// RFC 3339 timestamp or `YYYY-MM-DD`; defaults to "now".
    #[serde(default)]
    pub not_before: Option<String>,
    /// RFC 3339 timestamp or `YYYY-MM-DD`; takes precedence over `days`.
    #[serde(default)]
    pub not_after: Option<String>,
    #[serde(default)]
    pub days: Option<i64>,
}

impl Default for ValidityInput {
    fn default() -> Self {
        Self {
            not_before: None,
            not_after: None,
            days: Some(365),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ConstraintsInput {
    #[serde(default)]
    pub is_ca: bool,
    #[serde(default)]
    pub path_length: Option<u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IssuerInput {
    pub certificate_pem: String,
    pub private_key: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CertificateRequest {
    #[serde(default)]
    pub key: KeyInput,
    #[serde(default)]
    pub subject: SubjectInput,
    #[serde(default)]
    pub subject_alt_names: Vec<SanInput>,
    #[serde(default)]
    pub validity: ValidityInput,
    #[serde(default)]
    pub serial_number: Option<String>,
    #[serde(default)]
    pub constraints: ConstraintsInput,
    #[serde(default)]
    pub key_usages: Vec<String>,
    #[serde(default)]
    pub extended_key_usages: Vec<String>,
    /// When present the certificate is signed by this CA instead of itself.
    #[serde(default)]
    pub issuer: Option<IssuerInput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CsrRequest {
    #[serde(default)]
    pub key: KeyInput,
    #[serde(default)]
    pub subject: SubjectInput,
    #[serde(default)]
    pub subject_alt_names: Vec<SanInput>,
    #[serde(default)]
    pub key_usages: Vec<String>,
    #[serde(default)]
    pub extended_key_usages: Vec<String>,
    #[serde(default)]
    pub constraints: ConstraintsInput,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SignCsrRequest {
    pub csr_pem: String,
    pub issuer: IssuerInput,
    #[serde(default)]
    pub validity: ValidityInput,
    #[serde(default)]
    pub serial_number: Option<String>,
    /// Overrides the basic constraints carried by the CSR when present.
    #[serde(default)]
    pub constraints: Option<ConstraintsInput>,
    #[serde(default)]
    pub extended_key_usages: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyRequest {
    #[serde(default)]
    pub algorithm: Option<KeyAlgorithm>,
    /// Supply an existing key instead of generating one.
    #[serde(default)]
    pub private_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InspectRequest {
    /// Certificate as PEM or base64 encoded DER.
    pub certificate: String,
}

/* ------------------------------------------------------------------- output */

#[derive(Debug, Clone, Serialize)]
pub struct KeyMaterial {
    pub algorithm: String,
    pub algorithm_label: String,
    pub private_key_pem: String,
    /// Base64 encoded PKCS#8 DER - the frontend turns this into a `.der` file.
    pub private_key_der: String,
    pub public_key_pem: String,
    /// Base64 encoded SubjectPublicKeyInfo DER.
    pub public_key_der: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CertificateDetails {
    pub subject: String,
    pub issuer: String,
    pub serial_number: String,
    pub not_before: String,
    pub not_after: String,
    pub version: u32,
    pub is_ca: bool,
    pub path_length: Option<u32>,
    pub self_signed: bool,
    pub key_usages: Vec<String>,
    pub extended_key_usages: Vec<String>,
    pub subject_alt_names: Vec<String>,
    pub signature_algorithm: String,
    pub public_key_algorithm: String,
    pub sha256_fingerprint: String,
    pub sha1_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CertificateBundle {
    pub certificate_pem: String,
    /// Base64 encoded DER - used for `.der` / `.cer` downloads.
    pub certificate_der: String,
    /// Leaf first, issuer appended when the certificate was signed by a CA.
    pub chain_pem: String,
    pub key: Option<KeyMaterial>,
    pub details: CertificateDetails,
}

#[derive(Debug, Clone, Serialize)]
pub struct CsrBundle {
    pub csr_pem: String,
    /// Base64 encoded DER.
    pub csr_der: String,
    pub subject: String,
    pub key: Option<KeyMaterial>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlgorithmInfo {
    pub id: String,
    pub label: String,
}

/* ------------------------------------------------------------------ helpers */

fn decode_der(input: &str) -> Result<Vec<u8>> {
    let cleaned: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    BASE64
        .decode(cleaned.as_bytes())
        .map_err(|_| CertificateError::new("Expected PEM text or base64 encoded DER."))
}

fn parse_key_pair(input: &str) -> Result<KeyPair> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(CertificateError::new("No private key supplied."));
    }
    if trimmed.contains("-----BEGIN") {
        KeyPair::from_pem(trimmed).map_err(|error| {
            CertificateError::new(format!("The private key could not be parsed: {error}"))
        })
    } else {
        let der = decode_der(trimmed)?;
        KeyPair::try_from(der.as_slice()).map_err(|error| {
            CertificateError::new(format!("The private key could not be parsed: {error}"))
        })
    }
}

fn certificate_der(input: &str) -> Result<Vec<u8>> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(CertificateError::new("No certificate supplied."));
    }
    if trimmed.contains("-----BEGIN") {
        let parsed = pem::parse(trimmed)
            .map_err(|error| CertificateError::new(format!("Invalid PEM: {error}")))?;
        Ok(parsed.contents().to_vec())
    } else {
        decode_der(trimmed)
    }
}

fn der_to_pem(label: &str, der: &[u8]) -> String {
    let encoded = BASE64.encode(der);
    let body = encoded
        .as_bytes()
        .chunks(64)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    format!("-----BEGIN {label}-----\n{body}\n-----END {label}-----\n")
}

fn resolve_key(input: &KeyInput) -> Result<(KeyPair, KeyAlgorithm)> {
    match input.source {
        KeySource::Generate => {
            let algorithm = input.algorithm.unwrap_or(KeyAlgorithm::EcdsaP256);
            Ok((algorithm.generate()?, algorithm))
        }
        KeySource::Manual => {
            let pem = input
                .private_key
                .as_deref()
                .ok_or_else(|| CertificateError::new("No private key supplied."))?;
            let key_pair = parse_key_pair(pem)?;
            let algorithm = KeyAlgorithm::from_signature_algorithm(key_pair.algorithm())
                .unwrap_or(KeyAlgorithm::EcdsaP256);
            Ok((key_pair, algorithm))
        }
    }
}

fn key_material(key_pair: &KeyPair, algorithm: KeyAlgorithm) -> KeyMaterial {
    KeyMaterial {
        algorithm: algorithm.id().to_string(),
        algorithm_label: algorithm.label().to_string(),
        private_key_pem: key_pair.serialize_pem(),
        private_key_der: BASE64.encode(key_pair.serialized_der()),
        public_key_pem: key_pair.public_key_pem(),
        public_key_der: BASE64.encode(key_pair.subject_public_key_info()),
    }
}

fn parse_timestamp(value: &str) -> Result<OffsetDateTime> {
    let trimmed = value.trim();
    if let Ok(parsed) = OffsetDateTime::parse(trimmed, &Rfc3339) {
        return Ok(parsed);
    }
    // Accept the `YYYY-MM-DD` shape emitted by `<input type="date">`.
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() == 3 {
        let date = format!("{trimmed}T00:00:00Z");
        if let Ok(parsed) = OffsetDateTime::parse(&date, &Rfc3339) {
            return Ok(parsed);
        }
    }
    Err(CertificateError::new(format!(
        "'{trimmed}' is not a valid date - use YYYY-MM-DD or an RFC 3339 timestamp."
    )))
}

fn validity_window(validity: &ValidityInput) -> Result<(OffsetDateTime, OffsetDateTime)> {
    let not_before = match validity.not_before.as_deref() {
        Some(value) if !value.trim().is_empty() => parse_timestamp(value)?,
        _ => OffsetDateTime::now_utc(),
    };
    let not_after = match validity.not_after.as_deref() {
        Some(value) if !value.trim().is_empty() => parse_timestamp(value)?,
        _ => {
            let days = validity.days.unwrap_or(365).clamp(1, 36_500);
            not_before + Duration::days(days)
        }
    };
    if not_after <= not_before {
        return Err(CertificateError::new(
            "The end of the validity window must be after its start.",
        ));
    }
    Ok((not_before, not_after))
}

fn parse_serial_number(value: &str) -> Result<SerialNumber> {
    let cleaned: String = value
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .chars()
        .filter(|c| !matches!(c, ':' | ' ' | '-' | '_'))
        .collect();
    if cleaned.is_empty() {
        return Err(CertificateError::new("The serial number is empty."));
    }

    let looks_hex = value.trim().starts_with("0x")
        || value.trim().starts_with("0X")
        || cleaned.chars().any(|c| c.is_ascii_hexdigit() && !c.is_ascii_digit());

    let bytes = if looks_hex {
        let padded = if cleaned.len() % 2 == 1 {
            format!("0{cleaned}")
        } else {
            cleaned
        };
        (0..padded.len() / 2)
            .map(|index| {
                u8::from_str_radix(&padded[index * 2..index * 2 + 2], 16)
                    .map_err(|_| CertificateError::new("The serial number is not valid hex."))
            })
            .collect::<Result<Vec<u8>>>()?
    } else {
        let number = u128::from_str(&cleaned)
            .map_err(|_| CertificateError::new("The serial number is not a valid number."))?;
        let bytes = number.to_be_bytes();
        let first = bytes.iter().position(|byte| *byte != 0).unwrap_or(15);
        bytes[first..].to_vec()
    };

    // A leading bit of 1 would make the DER integer negative.
    let bytes = if bytes.first().is_some_and(|byte| *byte & 0x80 != 0) {
        let mut padded = vec![0u8];
        padded.extend_from_slice(&bytes);
        padded
    } else {
        bytes
    };
    Ok(SerialNumber::from_slice(&bytes))
}

fn key_usage(name: &str) -> Result<KeyUsagePurpose> {
    match name.trim().to_ascii_lowercase().replace([' ', '_'], "-").as_str() {
        "digital-signature" | "digitalsignature" => Ok(KeyUsagePurpose::DigitalSignature),
        "content-commitment" | "non-repudiation" | "contentcommitment" => {
            Ok(KeyUsagePurpose::ContentCommitment)
        }
        "key-encipherment" | "keyencipherment" => Ok(KeyUsagePurpose::KeyEncipherment),
        "data-encipherment" | "dataencipherment" => Ok(KeyUsagePurpose::DataEncipherment),
        "key-agreement" | "keyagreement" => Ok(KeyUsagePurpose::KeyAgreement),
        "key-cert-sign" | "keycertsign" => Ok(KeyUsagePurpose::KeyCertSign),
        "crl-sign" | "crlsign" => Ok(KeyUsagePurpose::CrlSign),
        "encipher-only" | "encipheronly" => Ok(KeyUsagePurpose::EncipherOnly),
        "decipher-only" | "decipheronly" => Ok(KeyUsagePurpose::DecipherOnly),
        other => Err(CertificateError::new(format!(
            "'{other}' is not a known key usage."
        ))),
    }
}

fn extended_key_usage(name: &str) -> Result<ExtendedKeyUsagePurpose> {
    let normalised = name.trim().to_ascii_lowercase().replace([' ', '_'], "-");
    match normalised.as_str() {
        "any" => Ok(ExtendedKeyUsagePurpose::Any),
        "server-auth" | "serverauth" => Ok(ExtendedKeyUsagePurpose::ServerAuth),
        "client-auth" | "clientauth" => Ok(ExtendedKeyUsagePurpose::ClientAuth),
        "code-signing" | "codesigning" => Ok(ExtendedKeyUsagePurpose::CodeSigning),
        "email-protection" | "emailprotection" => Ok(ExtendedKeyUsagePurpose::EmailProtection),
        "time-stamping" | "timestamping" => Ok(ExtendedKeyUsagePurpose::TimeStamping),
        "ocsp-signing" | "ocspsigning" => Ok(ExtendedKeyUsagePurpose::OcspSigning),
        other => {
            // Allow raw OIDs such as `1.3.6.1.5.5.7.3.1`.
            let components = other
                .split('.')
                .map(|part| u64::from_str(part).ok())
                .collect::<Option<Vec<u64>>>();
            match components {
                Some(oid) if oid.len() > 2 => Ok(ExtendedKeyUsagePurpose::Other(oid)),
                _ => Err(CertificateError::new(format!(
                    "'{other}' is not a known extended key usage."
                ))),
            }
        }
    }
}

fn san_type(entry: &SanInput) -> Result<SanType> {
    let value = entry.value.trim();
    if value.is_empty() {
        return Err(CertificateError::new("A subject alternative name is empty."));
    }
    let ia5 = |value: &str| {
        Ia5String::try_from(value.to_string())
            .map_err(|_| CertificateError::new(format!("'{value}' is not a valid IA5 string.")))
    };
    match entry.kind {
        SanKind::Dns => Ok(SanType::DnsName(ia5(value)?)),
        SanKind::Email => Ok(SanType::Rfc822Name(ia5(value)?)),
        SanKind::Uri => Ok(SanType::URI(ia5(value)?)),
        SanKind::Ip => {
            let address = IpAddr::from_str(value)
                .map_err(|_| CertificateError::new(format!("'{value}' is not a valid IP address.")))?;
            Ok(SanType::IpAddress(address))
        }
    }
}

fn distinguished_name(subject: &SubjectInput) -> rcgen::DistinguishedName {
    let mut name = rcgen::DistinguishedName::new();
    let common_name = subject.common_name.trim();
    name.push(
        DnType::CommonName,
        if common_name.is_empty() {
            "DevToolbox Certificate"
        } else {
            common_name
        },
    );
    for (dn_type, value) in [
        (DnType::OrganizationName, &subject.organization),
        (DnType::OrganizationalUnitName, &subject.organizational_unit),
        (DnType::CountryName, &subject.country),
        (DnType::StateOrProvinceName, &subject.state),
        (DnType::LocalityName, &subject.locality),
    ] {
        let value = value.trim();
        if !value.is_empty() {
            name.push(dn_type, value);
        }
    }
    name
}

fn is_ca(constraints: &ConstraintsInput) -> IsCa {
    if !constraints.is_ca {
        return IsCa::ExplicitNoCa;
    }
    match constraints.path_length {
        Some(length) => IsCa::Ca(BasicConstraints::Constrained(length)),
        None => IsCa::Ca(BasicConstraints::Unconstrained),
    }
}

fn apply_usages(
    params: &mut CertificateParams,
    key_usages: &[String],
    extended_key_usages: &[String],
) -> Result<()> {
    for name in key_usages {
        params.key_usages.push(key_usage(name)?);
    }
    for name in extended_key_usages {
        params.extended_key_usages.push(extended_key_usage(name)?);
    }
    Ok(())
}

/* ------------------------------------------------------------------- public */

pub fn supported_algorithms() -> Vec<AlgorithmInfo> {
    [
        KeyAlgorithm::EcdsaP256,
        KeyAlgorithm::EcdsaP384,
        KeyAlgorithm::EcdsaP521,
        KeyAlgorithm::Ed25519,
        KeyAlgorithm::Rsa2048,
        KeyAlgorithm::Rsa3072,
        KeyAlgorithm::Rsa4096,
    ]
    .into_iter()
    .map(|algorithm| AlgorithmInfo {
        id: algorithm.id().to_string(),
        label: algorithm.label().to_string(),
    })
    .collect()
}

/// Generates a fresh key pair, or normalises a pasted one into every format.
pub fn create_key(request: &KeyRequest) -> Result<KeyMaterial> {
    match request.private_key.as_deref() {
        Some(pem) if !pem.trim().is_empty() => {
            let key_pair = parse_key_pair(pem)?;
            let algorithm = KeyAlgorithm::from_signature_algorithm(key_pair.algorithm())
                .unwrap_or(KeyAlgorithm::EcdsaP256);
            Ok(key_material(&key_pair, algorithm))
        }
        _ => {
            let algorithm = request.algorithm.unwrap_or(KeyAlgorithm::EcdsaP256);
            let key_pair = algorithm.generate()?;
            Ok(key_material(&key_pair, algorithm))
        }
    }
}

pub fn create_certificate(request: &CertificateRequest) -> Result<CertificateBundle> {
    let (key_pair, algorithm) = resolve_key(&request.key)?;
    let (not_before, not_after) = validity_window(&request.validity)?;

    let mut params = CertificateParams::default();
    params.not_before = not_before;
    params.not_after = not_after;
    params.distinguished_name = distinguished_name(&request.subject);
    params.is_ca = is_ca(&request.constraints);
    params.use_authority_key_identifier_extension = request.issuer.is_some();
    for entry in &request.subject_alt_names {
        params.subject_alt_names.push(san_type(entry)?);
    }
    apply_usages(
        &mut params,
        &request.key_usages,
        &request.extended_key_usages,
    )?;
    if let Some(serial) = request.serial_number.as_deref()
        && !serial.trim().is_empty()
    {
        params.serial_number = Some(parse_serial_number(serial)?);
    }

    let (certificate, issuer_pem) = match &request.issuer {
        Some(issuer_input) => {
            let issuer_key = parse_key_pair(&issuer_input.private_key)?;
            let issuer_certificate_pem = normalise_certificate_pem(&issuer_input.certificate_pem)?;
            let issuer = Issuer::from_ca_cert_pem(&issuer_certificate_pem, issuer_key).map_err(
                |error| {
                    CertificateError::new(format!(
                        "The issuing certificate could not be parsed: {error}"
                    ))
                },
            )?;
            (
                params.signed_by(&key_pair, &issuer)?,
                Some(issuer_certificate_pem),
            )
        }
        None => (params.self_signed(&key_pair)?, None),
    };

    let der = certificate.der().to_vec();
    let pem = certificate.pem();
    let chain_pem = match issuer_pem {
        Some(issuer_pem) => format!("{}{}", ensure_trailing_newline(&pem), issuer_pem),
        None => pem.clone(),
    };

    Ok(CertificateBundle {
        certificate_pem: pem,
        certificate_der: BASE64.encode(&der),
        chain_pem,
        key: Some(key_material(&key_pair, algorithm)),
        details: inspect_der(&der)?,
    })
}

pub fn create_csr(request: &CsrRequest) -> Result<CsrBundle> {
    let (key_pair, algorithm) = resolve_key(&request.key)?;

    let mut params = CertificateParams::default();
    params.distinguished_name = distinguished_name(&request.subject);
    params.is_ca = is_ca(&request.constraints);
    for entry in &request.subject_alt_names {
        params.subject_alt_names.push(san_type(entry)?);
    }
    apply_usages(
        &mut params,
        &request.key_usages,
        &request.extended_key_usages,
    )?;

    let csr = params.serialize_request(&key_pair)?;
    Ok(CsrBundle {
        csr_pem: csr.pem()?,
        csr_der: BASE64.encode(csr.der()),
        subject: format_distinguished_name(&params.distinguished_name),
        key: Some(key_material(&key_pair, algorithm)),
    })
}

pub fn sign_csr(request: &SignCsrRequest) -> Result<CertificateBundle> {
    let csr_pem = request.csr_pem.trim();
    let mut csr = if csr_pem.contains("-----BEGIN") {
        CertificateSigningRequestParams::from_pem(csr_pem)
    } else {
        let der = decode_der(csr_pem)?;
        CertificateSigningRequestParams::from_der(&der.into())
    }
    .map_err(|error| CertificateError::new(format!("The CSR could not be parsed: {error}")))?;

    let (not_before, not_after) = validity_window(&request.validity)?;
    csr.params.not_before = not_before;
    csr.params.not_after = not_after;
    csr.params.use_authority_key_identifier_extension = true;
    if let Some(constraints) = &request.constraints {
        csr.params.is_ca = is_ca(constraints);
    }
    if !request.extended_key_usages.is_empty() {
        csr.params.extended_key_usages.clear();
        for name in &request.extended_key_usages {
            csr.params
                .extended_key_usages
                .push(extended_key_usage(name)?);
        }
    }
    if let Some(serial) = request.serial_number.as_deref()
        && !serial.trim().is_empty()
    {
        csr.params.serial_number = Some(parse_serial_number(serial)?);
    }

    let issuer_key = parse_key_pair(&request.issuer.private_key)?;
    let issuer_certificate_pem = normalise_certificate_pem(&request.issuer.certificate_pem)?;
    let issuer = Issuer::from_ca_cert_pem(&issuer_certificate_pem, issuer_key).map_err(|error| {
        CertificateError::new(format!(
            "The issuing certificate could not be parsed: {error}"
        ))
    })?;

    let certificate = csr.signed_by(&issuer)?;
    let der = certificate.der().to_vec();
    let pem = certificate.pem();

    Ok(CertificateBundle {
        certificate_pem: pem.clone(),
        certificate_der: BASE64.encode(&der),
        chain_pem: format!(
            "{}{}",
            ensure_trailing_newline(&pem),
            issuer_certificate_pem
        ),
        key: None,
        details: inspect_der(&der)?,
    })
}

pub fn inspect_certificate(request: &InspectRequest) -> Result<CertificateDetails> {
    let der = certificate_der(&request.certificate)?;
    inspect_der(&der)
}

/* ------------------------------------------------------------- introspection */

fn normalise_certificate_pem(input: &str) -> Result<String> {
    let der = certificate_der(input)?;
    Ok(der_to_pem("CERTIFICATE", &der))
}

fn ensure_trailing_newline(value: &str) -> String {
    if value.ends_with('\n') {
        value.to_string()
    } else {
        format!("{value}\n")
    }
}

fn format_distinguished_name(name: &rcgen::DistinguishedName) -> String {
    name.iter()
        .map(|(dn_type, value)| {
            let key = match dn_type {
                DnType::CommonName => "CN".to_string(),
                DnType::OrganizationName => "O".to_string(),
                DnType::OrganizationalUnitName => "OU".to_string(),
                DnType::CountryName => "C".to_string(),
                DnType::StateOrProvinceName => "ST".to_string(),
                DnType::LocalityName => "L".to_string(),
                other => format!("{other:?}"),
            };
            let value = match value {
                rcgen::DnValue::Utf8String(text) => text.to_string(),
                rcgen::DnValue::PrintableString(text) => text.to_string(),
                rcgen::DnValue::Ia5String(text) => text.to_string(),
                other => format!("{other:?}"),
            };
            format!("{key}={value}")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn fingerprint(digest: &[u8]) -> String {
    digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn inspect_der(der: &[u8]) -> Result<CertificateDetails> {
    let (_, certificate) = X509Certificate::from_der(der).map_err(|error| {
        CertificateError::new(format!("The certificate could not be parsed: {error}"))
    })?;

    let basic_constraints = certificate
        .basic_constraints()
        .ok()
        .flatten()
        .map(|extension| extension.value.clone());

    let key_usages = certificate
        .key_usage()
        .ok()
        .flatten()
        .map(|extension| {
            let usage = extension.value;
            let flags = [
                (usage.digital_signature(), "digitalSignature"),
                (usage.non_repudiation(), "contentCommitment"),
                (usage.key_encipherment(), "keyEncipherment"),
                (usage.data_encipherment(), "dataEncipherment"),
                (usage.key_agreement(), "keyAgreement"),
                (usage.key_cert_sign(), "keyCertSign"),
                (usage.crl_sign(), "cRLSign"),
                (usage.encipher_only(), "encipherOnly"),
                (usage.decipher_only(), "decipherOnly"),
            ];
            flags
                .into_iter()
                .filter(|(enabled, _)| *enabled)
                .map(|(_, label)| label.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let extended_key_usages = certificate
        .extended_key_usage()
        .ok()
        .flatten()
        .map(|extension| {
            let eku = extension.value;
            let mut names = Vec::new();
            if eku.any {
                names.push("any".to_string());
            }
            if eku.server_auth {
                names.push("serverAuth".to_string());
            }
            if eku.client_auth {
                names.push("clientAuth".to_string());
            }
            if eku.code_signing {
                names.push("codeSigning".to_string());
            }
            if eku.email_protection {
                names.push("emailProtection".to_string());
            }
            if eku.time_stamping {
                names.push("timeStamping".to_string());
            }
            if eku.ocsp_signing {
                names.push("OCSPSigning".to_string());
            }
            names.extend(eku.other.iter().map(|oid| oid.to_id_string()));
            names
        })
        .unwrap_or_default();

    let subject_alt_names = certificate
        .subject_alternative_name()
        .ok()
        .flatten()
        .map(|extension| {
            extension
                .value
                .general_names
                .iter()
                .map(|name| match name {
                    x509_parser::extensions::GeneralName::DNSName(value) => format!("DNS:{value}"),
                    x509_parser::extensions::GeneralName::IPAddress(value) => {
                        format!("IP:{}", format_ip(value))
                    }
                    x509_parser::extensions::GeneralName::RFC822Name(value) => {
                        format!("EMAIL:{value}")
                    }
                    x509_parser::extensions::GeneralName::URI(value) => format!("URI:{value}"),
                    other => format!("{other}"),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let serial = certificate
        .raw_serial()
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":");

    let public_key_algorithm = oid_label(&certificate.public_key().algorithm.algorithm.to_id_string());
    let signature_algorithm = oid_label(&certificate.signature_algorithm.algorithm.to_id_string());

    Ok(CertificateDetails {
        subject: certificate.subject().to_string(),
        issuer: certificate.issuer().to_string(),
        serial_number: serial,
        not_before: format_timestamp(certificate.validity().not_before.timestamp()),
        not_after: format_timestamp(certificate.validity().not_after.timestamp()),
        version: certificate.version().0,
        is_ca: basic_constraints
            .as_ref()
            .is_some_and(|constraints| constraints.ca),
        path_length: basic_constraints
            .as_ref()
            .and_then(|constraints| constraints.path_len_constraint),
        self_signed: certificate.subject() == certificate.issuer(),
        key_usages,
        extended_key_usages,
        subject_alt_names,
        signature_algorithm,
        public_key_algorithm,
        sha256_fingerprint: fingerprint(&Sha256::digest(der)),
        sha1_fingerprint: fingerprint(&Sha1::digest(der)),
    })
}

fn format_ip(bytes: &[u8]) -> String {
    match bytes.len() {
        4 => {
            let octets: [u8; 4] = bytes.try_into().unwrap_or([0; 4]);
            IpAddr::from(octets).to_string()
        }
        16 => {
            let octets: [u8; 16] = bytes.try_into().unwrap_or([0; 16]);
            IpAddr::from(octets).to_string()
        }
        _ => BASE64.encode(bytes),
    }
}

fn format_timestamp(seconds: i64) -> String {
    OffsetDateTime::from_unix_timestamp(seconds)
        .ok()
        .and_then(|value| value.format(&Rfc3339).ok())
        .unwrap_or_else(|| seconds.to_string())
}

fn oid_label(oid: &str) -> String {
    let label = match oid {
        "1.2.840.113549.1.1.1" => "RSA",
        "1.2.840.113549.1.1.11" => "SHA256withRSA",
        "1.2.840.113549.1.1.12" => "SHA384withRSA",
        "1.2.840.113549.1.1.13" => "SHA512withRSA",
        "1.2.840.113549.1.1.10" => "RSASSA-PSS",
        "1.2.840.10045.2.1" => "EC",
        "1.2.840.10045.4.3.2" => "SHA256withECDSA",
        "1.2.840.10045.4.3.3" => "SHA384withECDSA",
        "1.2.840.10045.4.3.4" => "SHA512withECDSA",
        "1.3.101.112" => "Ed25519",
        _ => return oid.to_string(),
    };
    format!("{label} ({oid})")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subject(common_name: &str) -> SubjectInput {
        SubjectInput {
            common_name: common_name.to_string(),
            organization: "DevToolbox".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn generates_a_self_signed_certificate() {
        let request = CertificateRequest {
            subject: subject("self.test"),
            subject_alt_names: vec![
                SanInput {
                    kind: SanKind::Dns,
                    value: "self.test".to_string(),
                },
                SanInput {
                    kind: SanKind::Ip,
                    value: "127.0.0.1".to_string(),
                },
            ],
            key_usages: vec!["digital-signature".to_string()],
            extended_key_usages: vec!["server-auth".to_string()],
            serial_number: Some("0x01F4".to_string()),
            ..Default::default()
        };

        let bundle = create_certificate(&request).expect("certificate");
        assert!(bundle.certificate_pem.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(!bundle.certificate_der.is_empty());
        assert!(bundle.details.self_signed);
        assert_eq!(bundle.details.serial_number, "01:F4");
        assert!(bundle.details.subject_alt_names.contains(&"DNS:self.test".to_string()));
        assert!(bundle.details.subject_alt_names.contains(&"IP:127.0.0.1".to_string()));
        assert!(bundle.key.is_some());
    }

    #[test]
    fn signs_a_leaf_with_a_generated_ca() {
        let ca = create_certificate(&CertificateRequest {
            subject: subject("DevToolbox Root CA"),
            constraints: ConstraintsInput {
                is_ca: true,
                path_length: Some(1),
            },
            key_usages: vec!["key-cert-sign".to_string(), "crl-sign".to_string()],
            ..Default::default()
        })
        .expect("ca");
        assert!(ca.details.is_ca);

        let ca_key = ca.key.expect("ca key");
        let leaf = create_certificate(&CertificateRequest {
            subject: subject("leaf.test"),
            issuer: Some(IssuerInput {
                certificate_pem: ca.certificate_pem.clone(),
                private_key: ca_key.private_key_pem.clone(),
            }),
            ..Default::default()
        })
        .expect("leaf");

        assert!(!leaf.details.self_signed);
        assert!(leaf.details.issuer.contains("DevToolbox Root CA"));
        assert_eq!(leaf.chain_pem.matches("BEGIN CERTIFICATE").count(), 2);
    }

    #[test]
    fn creates_and_signs_a_csr_with_a_manual_key() {
        let key = create_key(&KeyRequest {
            algorithm: Some(KeyAlgorithm::Ed25519),
            private_key: None,
        })
        .expect("key");

        let csr = create_csr(&CsrRequest {
            key: KeyInput {
                source: KeySource::Manual,
                algorithm: None,
                private_key: Some(key.private_key_pem.clone()),
            },
            subject: subject("csr.test"),
            subject_alt_names: vec![SanInput {
                kind: SanKind::Dns,
                value: "csr.test".to_string(),
            }],
            ..Default::default()
        })
        .expect("csr");
        assert!(csr.csr_pem.contains("CERTIFICATE REQUEST"));

        let ca = create_certificate(&CertificateRequest {
            subject: subject("Signing CA"),
            constraints: ConstraintsInput {
                is_ca: true,
                path_length: None,
            },
            ..Default::default()
        })
        .expect("ca");
        let ca_key = ca.key.expect("ca key");

        let signed = sign_csr(&SignCsrRequest {
            csr_pem: csr.csr_pem,
            issuer: IssuerInput {
                certificate_pem: ca.certificate_pem,
                private_key: ca_key.private_key_der.clone(),
            },
            validity: ValidityInput::default(),
            serial_number: None,
            constraints: None,
            extended_key_usages: vec!["client-auth".to_string()],
        })
        .expect("signed");

        assert!(signed.details.issuer.contains("Signing CA"));
        assert!(signed.key.is_none());
        assert!(
            signed
                .details
                .extended_key_usages
                .contains(&"clientAuth".to_string())
        );
    }

    #[test]
    fn inspects_a_der_encoded_certificate() {
        let bundle = create_certificate(&CertificateRequest {
            subject: subject("inspect.test"),
            key: KeyInput {
                source: KeySource::Generate,
                algorithm: Some(KeyAlgorithm::Rsa2048),
                private_key: None,
            },
            ..Default::default()
        })
        .expect("certificate");

        let details = inspect_certificate(&InspectRequest {
            certificate: bundle.certificate_der.clone(),
        })
        .expect("details");

        assert!(details.subject.contains("inspect.test"));
        assert!(details.public_key_algorithm.starts_with("RSA"));
        assert_eq!(details.sha256_fingerprint.len(), 32 * 3 - 1);
    }

    #[test]
    fn rejects_an_invalid_private_key() {
        let error = create_key(&KeyRequest {
            algorithm: None,
            private_key: Some("not a key".to_string()),
        })
        .unwrap_err();
        assert!(error.message().contains("could not be parsed") || error.message().contains("PEM"));
    }

    /// The ids advertised by `/algorithms` must be accepted by the request parser.
    #[test]
    fn algorithm_ids_match_their_serde_names() {
        for info in supported_algorithms() {
            let parsed: KeyAlgorithm =
                serde_json::from_value(serde_json::Value::String(info.id.clone()))
                    .unwrap_or_else(|_| panic!("'{}' is not accepted by serde", info.id));
            assert_eq!(
                serde_json::to_value(parsed).expect("serialise"),
                serde_json::Value::String(info.id)
            );
        }
    }
}
