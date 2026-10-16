/**
 * JWT encode / decode / verify.
 *
 * HMAC secrets and PKCS#8 / SPKI keys are handled by the Web Crypto API, fully
 * in the browser. Key formats the browser cannot import (PKCS#1, SEC1, X.509
 * certificates) are signed / verified by the local Rust backend (`/api/jwt`).
 * Nothing ever leaves the machine.
 */

import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToText,
  textToBytes,
  base64ToBytes,
} from './bytes'

export const JWT_ALGORITHMS = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
] as const

export type JwtAlgorithm = (typeof JWT_ALGORITHMS)[number]

export type JwtKeyFormat = 'utf8' | 'base64' | 'pem'

export interface JwtParts {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  headerRaw: string
  payloadRaw: string
  signature: string
  signingInput: string
}

export interface JwtClaimInfo {
  key: string
  label: string
  value: number
  date: Date
  expired?: boolean
  notYetValid?: boolean
}

export function isJwtAlgorithm(value: unknown): value is JwtAlgorithm {
  return typeof value === 'string' && (JWT_ALGORITHMS as readonly string[]).includes(value)
}

export function isSymmetric(alg: JwtAlgorithm): boolean {
  return alg.startsWith('HS')
}

/* ----------------------------------------------------------------- decode */

export function decodeJwt(token: string): JwtParts {
  const compact = token.trim().replace(/\s+/g, '')
  const segments = compact.split('.')
  if (segments.length !== 3) {
    throw new Error(
      `A JWT needs exactly 3 dot separated segments, received ${segments.length}.`,
    )
  }
  const [headerRaw, payloadRaw, signature] = segments as [string, string, string]
  if (!headerRaw || !payloadRaw) throw new Error('Header and payload segments must not be empty.')

  const header = parseJsonSegment(headerRaw, 'header')
  const payload = parseJsonSegment(payloadRaw, 'payload')

  return {
    header,
    payload,
    headerRaw,
    payloadRaw,
    signature,
    signingInput: `${headerRaw}.${payloadRaw}`,
  }
}

function parseJsonSegment(segment: string, name: string): Record<string, unknown> {
  let json: string
  try {
    json = bytesToText(base64UrlToBytes(segment))
  } catch {
    throw new Error(`The ${name} segment is not valid base64url.`)
  }
  try {
    const parsed: unknown = JSON.parse(json)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`The ${name} segment does not contain a JSON object.`)
  }
}

/* ------------------------------------------------------------- time claims */

const TIME_CLAIMS: Array<{ key: string; label: string }> = [
  { key: 'iat', label: 'Issued at' },
  { key: 'nbf', label: 'Not before' },
  { key: 'exp', label: 'Expires at' },
]

export function describeTimeClaims(
  payload: Record<string, unknown>,
  now: number = Date.now(),
): JwtClaimInfo[] {
  const nowSeconds = Math.floor(now / 1000)
  const result: JwtClaimInfo[] = []

  for (const { key, label } of TIME_CLAIMS) {
    const value = payload[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    result.push({
      key,
      label,
      value,
      date: new Date(value * 1000),
      expired: key === 'exp' ? value < nowSeconds : undefined,
      notYetValid: key === 'nbf' ? value > nowSeconds : undefined,
    })
  }
  return result
}

export function isTokenExpired(payload: Record<string, unknown>, now = Date.now()): boolean {
  const exp = payload['exp']
  return typeof exp === 'number' && exp * 1000 < now
}

/* ------------------------------------------------------------ key handling */

const HASH_BY_ALG: Record<JwtAlgorithm, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
  RS256: 'SHA-256',
  RS384: 'SHA-384',
  RS512: 'SHA-512',
  PS256: 'SHA-256',
  PS384: 'SHA-384',
  PS512: 'SHA-512',
  ES256: 'SHA-256',
  ES384: 'SHA-384',
  ES512: 'SHA-512',
}

const EC_CURVE_BY_ALG: Record<string, string> = {
  ES256: 'P-256',
  ES384: 'P-384',
  ES512: 'P-521',
}

const PSS_SALT_LENGTH: Record<string, number> = { PS256: 32, PS384: 48, PS512: 64 }

function importParams(alg: JwtAlgorithm): AlgorithmIdentifier | RsaHashedImportParams |
  EcKeyImportParams | HmacImportParams {
  const hash = HASH_BY_ALG[alg]
  if (alg.startsWith('HS')) return { name: 'HMAC', hash }
  if (alg.startsWith('RS')) return { name: 'RSASSA-PKCS1-v1_5', hash }
  if (alg.startsWith('PS')) return { name: 'RSA-PSS', hash }
  return { name: 'ECDSA', namedCurve: EC_CURVE_BY_ALG[alg] as string }
}

function signParams(alg: JwtAlgorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  if (alg.startsWith('HS')) return { name: 'HMAC' }
  if (alg.startsWith('RS')) return { name: 'RSASSA-PKCS1-v1_5' }
  if (alg.startsWith('PS')) return { name: 'RSA-PSS', saltLength: PSS_SALT_LENGTH[alg] as number }
  return { name: 'ECDSA', hash: HASH_BY_ALG[alg] }
}

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/

function pemLabel(pem: string): string {
  const match = PEM_BLOCK.exec(pem.trim())
  if (!match) throw new Error('Expected a PEM block such as "-----BEGIN PUBLIC KEY-----".')
  return (match[1] as string).trim()
}

/** Only PKCS#8 private keys and SPKI public keys can be imported by Web Crypto. */
function isWebCryptoPem(pem: string): boolean {
  const label = pemLabel(pem)
  return label === 'PRIVATE KEY' || label === 'PUBLIC KEY'
}

function pemToBytes(pem: string): { bytes: Uint8Array; kind: 'pkcs8' | 'spki' } {
  const match = PEM_BLOCK.exec(pem.trim()) as RegExpExecArray
  const kind: 'pkcs8' | 'spki' = (match[1] as string).trim() === 'PRIVATE KEY' ? 'pkcs8' : 'spki'
  return { bytes: base64ToBytes((match[2] as string).replace(/\s+/g, '')), kind }
}

async function importKey(
  alg: JwtAlgorithm,
  secret: string,
  format: JwtKeyFormat,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  if (isSymmetric(alg)) {
    const raw = format === 'base64' ? base64ToBytes(secret) : textToBytes(secret)
    if (raw.length === 0) throw new Error('The HMAC secret must not be empty.')
    return crypto.subtle.importKey('raw', toArrayBuffer(raw), importParams(alg) as HmacImportParams, false, [
      usage,
    ])
  }

  const { bytes, kind } = pemToBytes(secret)
  if (usage === 'sign' && kind !== 'pkcs8') {
    throw new Error('Signing requires a PRIVATE KEY in PKCS#8 PEM format.')
  }
  if (usage === 'verify' && kind !== 'spki') {
    throw new Error('Verification requires a PUBLIC KEY in SPKI PEM format.')
  }
  return crypto.subtle.importKey(kind, toArrayBuffer(bytes), importParams(alg), false, [usage])
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

/* ------------------------------------------------------------ sign / verify */

export interface SignJwtOptions {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  secret: string
  keyFormat?: JwtKeyFormat
}

export async function signJwt({
  header,
  payload,
  secret,
  keyFormat = 'utf8',
}: SignJwtOptions): Promise<string> {
  const alg = header['alg']
  if (!isJwtAlgorithm(alg)) {
    throw new Error(`Unsupported "alg" header: ${String(alg)}.`)
  }
  const headerRaw = bytesToBase64Url(textToBytes(JSON.stringify(header)))
  const payloadRaw = bytesToBase64Url(textToBytes(JSON.stringify(payload)))
  const signingInput = `${headerRaw}.${payloadRaw}`

  const signature = await createSignature(alg, secret, keyFormat, signingInput)
  return `${signingInput}.${signature}`
}

async function createSignature(
  alg: JwtAlgorithm,
  secret: string,
  keyFormat: JwtKeyFormat,
  signingInput: string,
): Promise<string> {
  if (!isSymmetric(alg) && !isWebCryptoPem(secret)) {
    return (
      await postJwt<{ signature: string }>('/sign', {
        algorithm: alg,
        key: secret,
        signing_input: signingInput,
      })
    ).signature
  }

  const key = await importKey(alg, secret, isSymmetric(alg) ? keyFormat : 'pem', 'sign')
  const signature = await crypto.subtle.sign(
    signParams(alg),
    key,
    toArrayBuffer(textToBytes(signingInput)),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function verifyJwt(
  token: string,
  secret: string,
  keyFormat: JwtKeyFormat = 'utf8',
): Promise<boolean> {
  const parts = decodeJwt(token)
  const alg = parts.header['alg']
  if (!isJwtAlgorithm(alg)) throw new Error(`Unsupported "alg" header: ${String(alg)}.`)
  if (!parts.signature) throw new Error('The token has no signature to verify.')

  if (!isSymmetric(alg) && !isWebCryptoPem(secret)) {
    const result = await postJwt<{ valid: boolean }>('/verify', {
      algorithm: alg,
      key: secret,
      signing_input: parts.signingInput,
      signature: parts.signature,
    })
    return result.valid
  }

  const key = await importKey(alg, secret, isSymmetric(alg) ? keyFormat : 'pem', 'verify')
  return crypto.subtle.verify(
    signParams(alg),
    key,
    toArrayBuffer(base64UrlToBytes(parts.signature)),
    toArrayBuffer(textToBytes(parts.signingInput)),
  )
}

/* ------------------------------------------------------------------ backend */

const API_BASE = '/api/jwt'

const BACKEND_UNREACHABLE =
  'This key format needs the devtools backend, which is unreachable. Start the server, ' +
  'or use a PKCS#8 private key / SPKI public key, which work without it.'

async function postJwt<T>(path: string, payload: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error(BACKEND_UNREACHABLE)
  }

  // The backend always answers with JSON. Anything else comes from a proxy or a
  // static host standing in for a server that is not running.
  let body: { error?: string } | null
  try {
    body = JSON.parse(await response.text()) as { error?: string } | null
  } catch {
    throw new Error(BACKEND_UNREACHABLE)
  }

  if (!response.ok) throw new Error(body?.error ?? BACKEND_UNREACHABLE)
  return body as T
}

/* -------------------------------------------------------------- templates */

export const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

export const SAMPLE_SECRET = 'your-256-bit-secret'
