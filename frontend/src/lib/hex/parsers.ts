/**
 * Parses text into bytes - used when pasting into the editor, when entering a
 * replacement value and when filling a range. The same number encoder backs
 * the "search for a number" mode.
 */

import { encodeText } from './encodings'
import { base64ToBytes, base64UrlToBytes } from '@/lib/bytes'

export type NumberType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float32'
  | 'float64'

export const NUMBER_TYPES: Array<{ value: NumberType; label: string; size: number }> = [
  { value: 'int8', label: 'Int8', size: 1 },
  { value: 'uint8', label: 'UInt8', size: 1 },
  { value: 'int16', label: 'Int16', size: 2 },
  { value: 'uint16', label: 'UInt16', size: 2 },
  { value: 'int32', label: 'Int32', size: 4 },
  { value: 'uint32', label: 'UInt32', size: 4 },
  { value: 'int64', label: 'Int64', size: 8 },
  { value: 'uint64', label: 'UInt64', size: 8 },
  { value: 'float32', label: 'Float32', size: 4 },
  { value: 'float64', label: 'Float64', size: 8 },
]

export class ParseError extends Error {}

/** Encodes a number of the given type and endianness. */
export function encodeNumber(type: NumberType, text: string, little: boolean): Uint8Array {
  const size = NUMBER_TYPES.find((item) => item.value === type)?.size ?? 4
  const trimmed = text.trim()
  if (trimmed === '') throw new ParseError('Enter a number.')

  const bytes = new Uint8Array(size)
  const dv = new DataView(bytes.buffer)

  if (type === 'float32' || type === 'float64') {
    const value = Number(trimmed)
    if (!Number.isFinite(value)) throw new ParseError('Not a finite number.')
    if (type === 'float32') dv.setFloat32(0, value, little)
    else dv.setFloat64(0, value, little)
    return bytes
  }

  let value: bigint
  try {
    value = BigInt(trimmed.replace(/^\+/, ''))
  } catch {
    throw new ParseError('Not a whole number.')
  }

  const bits = BigInt(size * 8)
  const signed = type.startsWith('int')
  const min = signed ? -(2n ** (bits - 1n)) : 0n
  const max = signed ? 2n ** (bits - 1n) - 1n : 2n ** bits - 1n
  if (value < min || value > max) throw new ParseError(`${trimmed} does not fit into ${type}.`)

  const unsigned = value < 0n ? value + 2n ** bits : value
  for (let i = 0; i < size; i++) {
    bytes[little ? i : size - 1 - i] = Number((unsigned >> BigInt(8 * i)) & 0xffn)
  }
  return bytes
}

/* --------------------------------------------------------------- paste ---- */

export type PayloadFormat =
  | 'auto'
  | 'hex'
  | 'text'
  | 'base64'
  | 'base64url'
  | 'base32'
  | 'decimal'
  | 'binary'
  | 'escape'
  | 'number'

export const PAYLOAD_FORMATS: Array<{ value: PayloadFormat; label: string }> = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'hex', label: 'Hex values' },
  { value: 'text', label: 'Text' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
  { value: 'base32', label: 'Base32' },
  { value: 'decimal', label: 'Decimal bytes' },
  { value: 'binary', label: 'Binary digits' },
  { value: 'escape', label: 'Escape sequences' },
  { value: 'number', label: 'Number' },
]

export interface ParseOptions {
  encoding?: string
  numberType?: NumberType
  littleEndian?: boolean
}

export function parsePayload(
  text: string,
  format: PayloadFormat,
  options: ParseOptions = {},
): Uint8Array {
  const encoding = options.encoding ?? 'latin1'
  const effective = format === 'auto' ? detectFormat(text) : format

  switch (effective) {
    case 'hex':
      return parseHexBytes(text)
    case 'decimal':
      return parseNumberList(text, 10)
    case 'binary':
      return parseBinary(text)
    case 'base64':
      return base64ToBytes(text)
    case 'base64url':
      return base64UrlToBytes(text)
    case 'base32':
      return parseBase32(text)
    case 'escape':
      return parseEscapes(text)
    case 'number':
      return encodeNumber(options.numberType ?? 'uint32', text, options.littleEndian ?? true)
    case 'auto':
    case 'text':
      return encodeText(text, encoding)
  }
}

/** Picks the most likely format for pasted text. */
export function detectFormat(text: string): PayloadFormat {
  const trimmed = text.trim()
  if (trimmed === '') return 'text'
  const compact = trimmed.replace(/(?:0x|\\x)/gi, '').replace(/[\s,;:_|-]+/g, '')
  if (compact.length >= 2 && compact.length % 2 === 0 && /^[0-9a-f]+$/i.test(compact)) return 'hex'
  if (/^[0-9]{1,3}(\s*[,;\s]\s*[0-9]{1,3})+$/.test(trimmed)) return 'decimal'
  return 'text'
}

export function parseHexBytes(text: string): Uint8Array {
  const cleaned = text.replace(/(?:0x|\\x)/gi, '').replace(/[\s,;:_|-]+/g, '')
  if (cleaned === '') return new Uint8Array(0)
  if (cleaned.length % 2 !== 0) throw new ParseError('Hex input needs an even number of digits.')
  if (!/^[0-9a-f]+$/i.test(cleaned)) throw new ParseError('Hex input contains invalid characters.')
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function parseNumberList(text: string, radix: number): Uint8Array {
  const parts = text.split(/[^0-9a-fA-F]+/).filter((part) => part !== '')
  const out = new Uint8Array(parts.length)
  parts.forEach((part, index) => {
    const value = Number.parseInt(part, radix)
    if (Number.isNaN(value) || value < 0 || value > 255) {
      throw new ParseError(`"${part}" is not a byte value.`)
    }
    out[index] = value
  })
  return out
}

function parseBinary(text: string): Uint8Array {
  const bits = text.replace(/[^01]/g, '')
  if (bits.length === 0) throw new ParseError('No binary digits found.')
  if (bits.length % 8 !== 0) throw new ParseError('Binary input needs a multiple of 8 digits.')
  const out = new Uint8Array(bits.length / 8)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return out
}

function parseBase32(text: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleaned = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of cleaned) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new ParseError(`"${char}" is not a Base32 character.`)
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

function parseEscapes(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char !== '\\') {
      out.push(char.charCodeAt(0) & 0xff)
      continue
    }
    const next = text[++i]
    switch (next) {
      case 'x': {
        const hex = text.slice(i + 1, i + 3)
        if (!/^[0-9a-f]{2}$/i.test(hex)) throw new ParseError(`Bad escape "\\x${hex}".`)
        out.push(Number.parseInt(hex, 16))
        i += 2
        break
      }
      case 'n':
        out.push(0x0a)
        break
      case 'r':
        out.push(0x0d)
        break
      case 't':
        out.push(0x09)
        break
      case '0':
        out.push(0x00)
        break
      case '\\':
        out.push(0x5c)
        break
      default:
        if (next === undefined) throw new ParseError('Input ends with a lone backslash.')
        out.push(next.charCodeAt(0) & 0xff)
    }
  }
  return new Uint8Array(out)
}
