/**
 * Byte / text / base64 primitives shared by several tools.
 * Everything is Unicode safe (`btoa` alone is not).
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function textToBytes(text: string): Uint8Array {
  return encoder.encode(text)
}

export function bytesToText(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  // Chunked to stay below the argument limit of `String.fromCharCode`.
  const chunkSize = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return out
}

export function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff
  return bytes
}

/* ------------------------------------------------------------------ base64 */

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes))
}

export function base64ToBytes(base64: string): Uint8Array {
  const normalised = base64.replace(/\s+/g, '')
  if (normalised === '') return new Uint8Array()
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalised)) {
    throw new Error('Input contains characters that are not valid base64.')
  }
  return binaryStringToBytes(atob(normalised))
}

export function encodeBase64(text: string): string {
  return bytesToBase64(textToBytes(text))
}

export function decodeBase64(base64: string): string {
  return bytesToText(base64ToBytes(base64))
}

/* --------------------------------------------------------------- base64url */

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(base64url: string): Uint8Array {
  const padded = base64url
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.replace(/\s+/g, '').length / 4) * 4, '=')
  return base64ToBytes(padded)
}

export function encodeBase64Url(text: string): string {
  return bytesToBase64Url(textToBytes(text))
}

export function decodeBase64Url(base64url: string): string {
  return bytesToText(base64UrlToBytes(base64url))
}

/* ------------------------------------------------------------------- misc */

export function bytesToHex(bytes: Uint8Array, separator = ' '): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(separator)
}

export function isLikelyBase64(value: string): boolean {
  const trimmed = value.replace(/\s+/g, '')
  return trimmed.length > 0 && trimmed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}
