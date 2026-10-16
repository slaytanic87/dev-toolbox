/**
 * Turns a byte range into something you can paste somewhere else: source code
 * for a dozen languages, a classic hex dump, CSV or one of the BaseXX text
 * encodings.
 */

import { bytesToBase64, bytesToBase64Url } from '@/lib/bytes'

export type ExportFormat =
  | 'hexdump'
  | 'hex-plain'
  | 'hex-grid'
  | 'csv'
  | 'c'
  | 'rust'
  | 'go'
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'assemblyscript'
  | 'java'
  | 'csharp'
  | 'asm'
  | 'base64'
  | 'base64url'
  | 'base32'
  | 'base58'
  | 'base62'
  | 'escape'
  | 'text'

export interface ExportFormatInfo {
  value: ExportFormat
  label: string
  group: 'Dump' | 'Source code' | 'Text encoding'
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { value: 'hexdump', label: 'Hex dump', group: 'Dump' },
  { value: 'hex-grid', label: 'Hex grid', group: 'Dump' },
  { value: 'hex-plain', label: 'Plain hex', group: 'Dump' },
  { value: 'csv', label: 'CSV', group: 'Dump' },
  { value: 'c', label: 'C / C++', group: 'Source code' },
  { value: 'rust', label: 'Rust', group: 'Source code' },
  { value: 'go', label: 'Go', group: 'Source code' },
  { value: 'python', label: 'Python', group: 'Source code' },
  { value: 'javascript', label: 'JavaScript', group: 'Source code' },
  { value: 'typescript', label: 'TypeScript', group: 'Source code' },
  { value: 'assemblyscript', label: 'AssemblyScript', group: 'Source code' },
  { value: 'java', label: 'Java', group: 'Source code' },
  { value: 'csharp', label: 'C#', group: 'Source code' },
  { value: 'asm', label: 'Assembler (x86)', group: 'Source code' },
  { value: 'base64', label: 'Base64', group: 'Text encoding' },
  { value: 'base64url', label: 'Base64URL', group: 'Text encoding' },
  { value: 'base32', label: 'Base32', group: 'Text encoding' },
  { value: 'base58', label: 'Base58', group: 'Text encoding' },
  { value: 'base62', label: 'Base62', group: 'Text encoding' },
  { value: 'escape', label: 'Escape sequences', group: 'Text encoding' },
  { value: 'text', label: 'Raw text', group: 'Text encoding' },
]

export interface ExportOptions {
  bytesPerLine: number
  variableName: string
  uppercase: boolean
  /** Document offset the range starts at - used by the dump formats. */
  baseOffset: number
  /** Encoding used by the `text` format and the hex dump's character column. */
  encoding: string
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  bytesPerLine: 16,
  variableName: 'data',
  uppercase: true,
  baseOffset: 0,
  encoding: 'latin1',
}

/** BaseXX with a numeric alphabet is quadratic - keep those inputs small. */
export const BIGNUM_EXPORT_LIMIT = 8192

export class ExportError extends Error {}

function hex(byte: number, uppercase: boolean): string {
  const text = byte.toString(16).padStart(2, '0')
  return uppercase ? text.toUpperCase() : text
}

function lines(bytes: Uint8Array, perLine: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += perLine) out.push(bytes.subarray(i, i + perLine))
  return out
}

function codeBlock(
  bytes: Uint8Array,
  options: ExportOptions,
  prefix: string,
  format: (byte: number) => string,
  suffix: string,
  indent = '  ',
): string {
  const rows = lines(bytes, options.bytesPerLine).map(
    (row) => indent + Array.from(row, format).join(', ') + ',',
  )
  return [prefix, ...rows, suffix].join('\n')
}

export function exportBytes(
  bytes: Uint8Array,
  format: ExportFormat,
  options: Partial<ExportOptions> = {},
): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options }
  const name = opts.variableName.replace(/[^A-Za-z0-9_]/g, '_') || 'data'
  const byteHex = (byte: number): string => `0x${hex(byte, opts.uppercase)}`

  switch (format) {
    case 'hexdump':
      return hexDump(bytes, opts)
    case 'hex-grid':
      return lines(bytes, opts.bytesPerLine)
        .map((row) => Array.from(row, (b) => hex(b, opts.uppercase)).join(' '))
        .join('\n')
    case 'hex-plain':
      return Array.from(bytes, (b) => hex(b, opts.uppercase)).join('')
    case 'csv':
      return lines(bytes, opts.bytesPerLine)
        .map((row) => Array.from(row).join(','))
        .join('\n')
    case 'c':
      return codeBlock(
        bytes,
        opts,
        `const unsigned char ${name}[${bytes.length}] = {`,
        byteHex,
        '};',
      )
    case 'rust':
      return codeBlock(
        bytes,
        opts,
        `const ${name.toUpperCase()}: [u8; ${bytes.length}] = [`,
        byteHex,
        '];',
      )
    case 'go':
      return codeBlock(bytes, opts, `${name} := []byte{`, byteHex, '}')
    case 'python':
      return `${name} = bytes([\n${lines(bytes, opts.bytesPerLine)
        .map((row) => '    ' + Array.from(row, byteHex).join(', ') + ',')
        .join('\n')}\n])`
    case 'javascript':
      return codeBlock(bytes, opts, `const ${name} = new Uint8Array([`, byteHex, ']);')
    case 'typescript':
      return codeBlock(bytes, opts, `const ${name}: Uint8Array = new Uint8Array([`, byteHex, ']);')
    case 'assemblyscript':
      return codeBlock(
        bytes,
        opts,
        `const ${name}: StaticArray<u8> = [`,
        (byte) => `0x${hex(byte, opts.uppercase)}`,
        '];',
      )
    case 'java':
      return codeBlock(
        bytes,
        opts,
        `byte[] ${name} = {`,
        (byte) => `(byte) 0x${hex(byte, opts.uppercase)}`,
        '};',
      )
    case 'csharp':
      return codeBlock(bytes, opts, `byte[] ${name} = {`, byteHex, '};')
    case 'asm':
      return lines(bytes, opts.bytesPerLine)
        .map((row) => `    db ${Array.from(row, (b) => `0${hex(b, true)}h`).join(', ')}`)
        .join('\n')
    case 'base64':
      return bytesToBase64(bytes)
    case 'base64url':
      return bytesToBase64Url(bytes)
    case 'base32':
      return toBase32(bytes)
    case 'base58':
      return toBaseN(bytes, BASE58_ALPHABET)
    case 'base62':
      return toBaseN(bytes, BASE62_ALPHABET)
    case 'escape':
      return Array.from(bytes, (b) => `\\x${hex(b, opts.uppercase)}`).join('')
    case 'text':
      return decodeForExport(bytes, opts.encoding)
  }
}

function decodeForExport(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding === 'latin1' ? 'windows-1252' : encoding, {
      fatal: false,
    }).decode(bytes)
  } catch {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  }
}

/** Classic `offset  hex bytes  |characters|` dump. */
export function hexDump(bytes: Uint8Array, options: ExportOptions): string {
  const width = Math.max(8, options.bytesPerLine)
  const digits = Math.max(8, (options.baseOffset + bytes.length).toString(16).length)
  return lines(bytes, width)
    .map((row, index) => {
      const offset = (options.baseOffset + index * width).toString(16).padStart(digits, '0')
      const hexPart = Array.from(row, (b) => hex(b, options.uppercase))
        .join(' ')
        .padEnd(width * 3 - 1, ' ')
      const text = Array.from(row, (b) =>
        b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.',
      ).join('')
      const label = options.uppercase ? offset.toUpperCase() : offset
      return `${label}  ${hexPart}  |${text}|`
    })
    .join('\n')
}

/* ------------------------------------------------------------ baseXX ---- */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function toBase32(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  while (out.length % 8 !== 0) out += '='
  return out
}

/** Big-integer base conversion, used for Base58 and Base62. */
export function toBaseN(bytes: Uint8Array, alphabet: string): string {
  if (bytes.length > BIGNUM_EXPORT_LIMIT) {
    throw new ExportError(
      `Base${alphabet.length} export is limited to ${BIGNUM_EXPORT_LIMIT} bytes - select a smaller range.`,
    )
  }
  if (bytes.length === 0) return ''

  const base = BigInt(alphabet.length)
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)

  let out = ''
  while (value > 0n) {
    out = alphabet[Number(value % base)]! + out
    value /= base
  }
  // Leading zero bytes are encoded as the alphabet's zero digit.
  for (const byte of bytes) {
    if (byte !== 0) break
    out = alphabet[0]! + out
  }
  return out === '' ? alphabet[0]! : out
}

/** File name suffix suggested when an export is downloaded. */
export function exportExtension(format: ExportFormat): string {
  switch (format) {
    case 'c':
      return 'h'
    case 'rust':
      return 'rs'
    case 'go':
      return 'go'
    case 'python':
      return 'py'
    case 'javascript':
      return 'js'
    case 'typescript':
    case 'assemblyscript':
      return 'ts'
    case 'java':
      return 'java'
    case 'csharp':
      return 'cs'
    case 'asm':
      return 'asm'
    case 'csv':
      return 'csv'
    default:
      return 'txt'
  }
}
