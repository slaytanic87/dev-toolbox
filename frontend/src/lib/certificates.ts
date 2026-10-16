/**
 * Client for the Rust certificate API (`/api/certificates`).
 * Every cryptographic operation happens in the backend - this module only
 * transports the request and turns the returned PEM/DER into downloadable files.
 */

export const KEY_ALGORITHMS = [
  'ecdsa-p256',
  'ecdsa-p384',
  'ecdsa-p521',
  'ed25519',
  'rsa-2048',
  'rsa-3072',
  'rsa-4096',
] as const

export type KeyAlgorithm = (typeof KEY_ALGORITHMS)[number]

export const KEY_ALGORITHM_LABELS: Record<KeyAlgorithm, string> = {
  'ecdsa-p256': 'ECDSA P-256',
  'ecdsa-p384': 'ECDSA P-384',
  'ecdsa-p521': 'ECDSA P-521',
  ed25519: 'Ed25519',
  'rsa-2048': 'RSA 2048',
  'rsa-3072': 'RSA 3072',
  'rsa-4096': 'RSA 4096',
}

export type KeySource = 'generate' | 'manual'

export type SanKind = 'dns' | 'ip' | 'email' | 'uri'

export const KEY_USAGES = [
  'digital-signature',
  'content-commitment',
  'key-encipherment',
  'data-encipherment',
  'key-agreement',
  'key-cert-sign',
  'crl-sign',
  'encipher-only',
  'decipher-only',
] as const

export type KeyUsage = (typeof KEY_USAGES)[number]

export const EXTENDED_KEY_USAGES = [
  'server-auth',
  'client-auth',
  'code-signing',
  'email-protection',
  'time-stamping',
  'ocsp-signing',
  'any',
] as const

export type ExtendedKeyUsage = (typeof EXTENDED_KEY_USAGES)[number]

/* ------------------------------------------------------------------ payloads */

export interface KeyInput {
  source: KeySource
  algorithm?: KeyAlgorithm
  private_key?: string
}

export interface SubjectInput {
  common_name: string
  organization: string
  organizational_unit: string
  country: string
  state: string
  locality: string
}

export interface SanInput {
  kind: SanKind
  value: string
}

export interface ValidityInput {
  not_before?: string
  not_after?: string
  days?: number
}

export interface ConstraintsInput {
  is_ca: boolean
  path_length?: number
}

export interface IssuerInput {
  certificate_pem: string
  private_key: string
}

export interface CertificatePayload {
  key: KeyInput
  subject: SubjectInput
  subject_alt_names: SanInput[]
  validity: ValidityInput
  serial_number?: string
  constraints: ConstraintsInput
  key_usages: string[]
  extended_key_usages: string[]
  issuer?: IssuerInput
}

export interface CsrPayload {
  key: KeyInput
  subject: SubjectInput
  subject_alt_names: SanInput[]
  key_usages: string[]
  extended_key_usages: string[]
  constraints: ConstraintsInput
}

export interface SignCsrPayload {
  csr_pem: string
  issuer: IssuerInput
  validity: ValidityInput
  serial_number?: string
  constraints?: ConstraintsInput
  extended_key_usages: string[]
}

/* ------------------------------------------------------------------ results */

export interface KeyMaterial {
  algorithm: string
  algorithm_label: string
  private_key_pem: string
  private_key_der: string
  public_key_pem: string
  public_key_der: string
}

export interface CertificateDetails {
  subject: string
  issuer: string
  serial_number: string
  not_before: string
  not_after: string
  version: number
  is_ca: boolean
  path_length: number | null
  self_signed: boolean
  key_usages: string[]
  extended_key_usages: string[]
  subject_alt_names: string[]
  signature_algorithm: string
  public_key_algorithm: string
  sha256_fingerprint: string
  sha1_fingerprint: string
}

export interface CertificateBundle {
  certificate_pem: string
  certificate_der: string
  chain_pem: string
  key: KeyMaterial | null
  details: CertificateDetails
}

export interface CsrBundle {
  csr_pem: string
  csr_der: string
  subject: string
  key: KeyMaterial | null
}

/* --------------------------------------------------------------- transport */

const API_BASE = '/api/certificates'

async function post<T>(path: string, payload: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error('The certificate backend is unreachable - is the devtools server running?')
  }

  const text = await response.text()
  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      if (text.trim() !== '') message = text
    }
    throw new Error(message)
  }
  return JSON.parse(text) as T
}

export const createKey = (payload: { algorithm?: KeyAlgorithm; private_key?: string }) =>
  post<KeyMaterial>('/keys', payload)

export const createCertificate = (payload: CertificatePayload) =>
  post<CertificateBundle>('', payload)

export const createCsr = (payload: CsrPayload) => post<CsrBundle>('/csr', payload)

export const signCsr = (payload: SignCsrPayload) => post<CertificateBundle>('/csr/sign', payload)

export const inspectCertificate = (certificate: string) =>
  post<CertificateDetails>('/inspect', { certificate })

/* ----------------------------------------------------------------- defaults */

export function createDefaultSubject(): SubjectInput {
  return {
    common_name: 'devtoolbox.local',
    organization: 'DevToolbox',
    organizational_unit: '',
    country: '',
    state: '',
    locality: '',
  }
}

export function createDefaultSans(): SanInput[] {
  return [
    { kind: 'dns', value: 'devtoolbox.local' },
    { kind: 'dns', value: 'localhost' },
    { kind: 'ip', value: '127.0.0.1' },
  ]
}

/* ------------------------------------------------------------ file formats */

export interface DownloadFormat {
  label: string
  extension: string
  encoding: 'pem' | 'der'
  title: string
}

export const CERTIFICATE_FORMATS: DownloadFormat[] = [
  { label: '.pem', extension: 'pem', encoding: 'pem', title: 'Base64 PEM certificate' },
  { label: '.crt', extension: 'crt', encoding: 'pem', title: 'PEM certificate with the .crt extension' },
  { label: '.cert', extension: 'cert', encoding: 'pem', title: 'PEM certificate with the .cert extension' },
  { label: '.der', extension: 'der', encoding: 'der', title: 'Binary DER certificate' },
  { label: '.cer', extension: 'cer', encoding: 'der', title: 'Binary DER certificate with the .cer extension' },
]

export const KEY_FORMATS: DownloadFormat[] = [
  { label: '.pem', extension: 'pem', encoding: 'pem', title: 'PKCS#8 private key in PEM' },
  { label: '.key', extension: 'key', encoding: 'pem', title: 'PKCS#8 private key with the .key extension' },
  { label: '.der', extension: 'der', encoding: 'der', title: 'Binary PKCS#8 private key' },
]

export const PUBLIC_KEY_FORMATS: DownloadFormat[] = [
  { label: '.pem', extension: 'pem', encoding: 'pem', title: 'SubjectPublicKeyInfo in PEM' },
  { label: '.der', extension: 'der', encoding: 'der', title: 'Binary SubjectPublicKeyInfo' },
]

export const CSR_FORMATS: DownloadFormat[] = [
  { label: '.csr', extension: 'csr', encoding: 'pem', title: 'PEM certificate signing request' },
  { label: '.pem', extension: 'pem', encoding: 'pem', title: 'PEM certificate signing request' },
  { label: '.der', extension: 'der', encoding: 'der', title: 'Binary DER certificate signing request' },
]

/* ---------------------------------------------------------------- downloads */

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function derBlob(base64: string): Blob {
  return new Blob([base64ToBytes(base64) as unknown as BlobPart], {
    type: 'application/octet-stream',
  })
}

/** Extracts the CN value from a distinguished name such as `CN=api.test, O=Example`. */
export function commonNameOf(distinguishedName: string, fallback = 'certificate'): string {
  const match = /CN=([^,]+)/.exec(distinguishedName)
  return match?.[1]?.trim() ?? (distinguishedName.trim() || fallback)
}

/** File name suggestion derived from the common name, e.g. `*.example.com` → `wildcard_example_com`. */
export function slugify(value: string, fallback = 'certificate'): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\*/g, 'wildcard')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? fallback : slug
}
