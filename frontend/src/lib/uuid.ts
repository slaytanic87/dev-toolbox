/**
 * UUID / ULID / NanoID generation - all based on `crypto.getRandomValues`.
 */

import { bytesToHex } from './bytes'

export type UuidVersion = 'v4' | 'v7' | 'nil' | 'max'

const HEX = '0123456789abcdef'

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function formatUuid(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes, '')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = randomBytes(16)
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  return formatUuid(bytes)
}

/** RFC 9562 version 7: 48 bit unix-ms timestamp prefix + random, so it sorts by creation time. */
export function uuidV7(timestamp: number = Date.now()): string {
  const bytes = randomBytes(16)
  const ms = BigInt(timestamp)
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  return formatUuid(bytes)
}

export const NIL_UUID = '00000000-0000-0000-0000-000000000000'
export const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

export function generateUuid(version: UuidVersion): string {
  switch (version) {
    case 'v7':
      return uuidV7()
    case 'nil':
      return NIL_UUID
    case 'max':
      return MAX_UUID
    default:
      return uuidV4()
  }
}

export function generateMany(version: UuidVersion, count: number): string[] {
  const total = Math.max(1, Math.min(count, 10_000))
  return Array.from({ length: total }, () => generateUuid(version))
}

/* -------------------------------------------------------- other id formats */

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(timestamp: number = Date.now()): string {
  let time = ''
  let ms = timestamp
  for (let i = 0; i < 10; i++) {
    time = (ULID_ALPHABET[ms % 32] as string) + time
    ms = Math.floor(ms / 32)
  }
  const random = randomBytes(16)
  let tail = ''
  for (let i = 0; i < 16; i++) tail += ULID_ALPHABET[(random[i] as number) % 32]
  return time + tail
}

/** URL-safe 64 character alphabet: A-Z a-z 0-9 plus `-` and `_`. */
const NANOID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function nanoId(size = 21): string {
  const bytes = randomBytes(size)
  let out = ''
  for (let i = 0; i < size; i++) out += NANOID_ALPHABET[(bytes[i] as number) & 63]
  return out
}

export function randomHex(byteLength = 16): string {
  const bytes = randomBytes(byteLength)
  let out = ''
  for (const byte of bytes) out += (HEX[byte >> 4] as string) + (HEX[byte & 0x0f] as string)
  return out
}

/* ------------------------------------------------------------- inspection */

export interface UuidInfo {
  valid: boolean
  version: number | null
  variant: string
  timestamp?: Date
  normalised: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function inspectUuid(value: string): UuidInfo {
  const normalised = value.trim().replace(/^urn:uuid:/i, '').replace(/[{}]/g, '').toLowerCase()
  if (!UUID_PATTERN.test(normalised)) {
    return { valid: false, version: null, variant: '-', normalised }
  }

  const hex = normalised.replace(/-/g, '')
  const version = parseInt(hex[12] as string, 16)
  const variantNibble = parseInt(hex[16] as string, 16)
  const variant =
    variantNibble >= 0x8 && variantNibble <= 0xb
      ? 'RFC 4122 / 9562'
      : variantNibble >= 0xc && variantNibble <= 0xd
        ? 'Microsoft'
        : variantNibble === 0xe || variantNibble === 0xf
          ? 'Reserved'
          : 'NCS (legacy)'

  const info: UuidInfo = { valid: true, version, variant, normalised }
  if (version === 7) info.timestamp = new Date(Number(BigInt(`0x${hex.slice(0, 12)}`)))
  if (version === 1) {
    const ticks = BigInt(`0x${hex.slice(12, 16).slice(1)}${hex.slice(8, 12)}${hex.slice(0, 8)}`)
    info.timestamp = new Date(Number(ticks / 10000n - 12219292800000n))
  }
  return info
}
