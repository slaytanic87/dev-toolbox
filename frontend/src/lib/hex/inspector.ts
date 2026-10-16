/**
 * Data inspector: interprets the bytes at the caret as every data type a hex
 * editor is expected to understand, in little and big endian, and encodes a
 * typed value back to bytes when a field is edited.
 */

import { decodeRow, displayChar } from './encodings'

export type InspectorGroup = 'Integer' | 'Floating point' | 'Variable length' | 'Date / time' | 'Other'

export interface InspectorField {
  id: string
  label: string
  group: InspectorGroup
  /** Bytes consumed, `0` when the value could not be read. */
  size: number
  value: string
  /** `true` when typing a new value writes it back to the document. */
  editable: boolean
  note?: string
}

/** Bytes the inspector would like to have around the caret. */
export const INSPECTOR_WINDOW = 24

const MS_PER_DAY = 86_400_000
const UNIX_TO_FILETIME_MS = 11_644_473_600_000
const HFS_EPOCH_MS = -2_082_844_800_000
const COCOA_EPOCH_MS = 978_307_200_000
const OLE_EPOCH_DAYS = 25_569

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return '-'
  const date = new Date(ms)
  const time = date.getTime()
  if (Number.isNaN(time) || time < -11_676_096_000_000 || time > 32_503_680_000_000) return '-'
  return date.toISOString().replace('T', ' ').replace('.000Z', 'Z')
}

/* ------------------------------------------------------------- readers ---- */

function readIntN(bytes: Uint8Array, size: number, little: boolean, signed: boolean): number | null {
  if (bytes.length < size) return null
  let value = 0
  for (let i = 0; i < size; i++) {
    const byte = bytes[little ? i : size - 1 - i]!
    value += byte * 2 ** (8 * i)
  }
  if (signed) {
    const limit = 2 ** (8 * size - 1)
    if (value >= limit) value -= limit * 2
  }
  return value
}

function readBigInt(bytes: Uint8Array, little: boolean, signed: boolean): bigint | null {
  if (bytes.length < 8) return null
  const dv = view(bytes)
  return signed ? dv.getBigInt64(0, little) : dv.getBigUint64(0, little)
}

function readFloat16(bytes: Uint8Array, little: boolean): number | null {
  if (bytes.length < 2) return null
  const raw = view(bytes).getUint16(0, little)
  const sign = raw & 0x8000 ? -1 : 1
  const exponent = (raw >> 10) & 0x1f
  const fraction = raw & 0x3ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

export interface VarIntResult {
  value: bigint
  size: number
}

/** LEB128 - little endian base 128, as used by DWARF and WebAssembly. */
export function readLeb128(bytes: Uint8Array, signed: boolean): VarIntResult | null {
  let result = 0n
  let shift = 0n
  for (let i = 0; i < Math.min(bytes.length, 10); i++) {
    const byte = bytes[i]!
    result |= BigInt(byte & 0x7f) << shift
    shift += 7n
    if ((byte & 0x80) === 0) {
      if (signed && byte & 0x40) result -= 1n << shift
      return { value: result, size: i + 1 }
    }
  }
  return null
}

/** VLQ - big endian base 128, as used by MIDI and Standard MIDI Files. */
export function readVlq(bytes: Uint8Array): VarIntResult | null {
  let result = 0n
  for (let i = 0; i < Math.min(bytes.length, 10); i++) {
    const byte = bytes[i]!
    result = (result << 7n) | BigInt(byte & 0x7f)
    if ((byte & 0x80) === 0) return { value: result, size: i + 1 }
  }
  return null
}

function formatGuid(bytes: Uint8Array, little: boolean): string | null {
  if (bytes.length < 16) return null
  const hex = Array.from(bytes.subarray(0, 16), (b) => b.toString(16).padStart(2, '0'))
  const group = (from: number, to: number, reverse: boolean): string => {
    const slice = hex.slice(from, to)
    return (reverse ? slice.reverse() : slice).join('')
  }
  return [
    group(0, 4, little),
    group(4, 6, little),
    group(6, 8, little),
    group(8, 10, false),
    group(10, 16, false),
  ].join('-')
}

/* ------------------------------------------------------------- inspect ---- */

export function inspect(
  bytes: Uint8Array,
  little: boolean,
  encoding = 'latin1',
  offset = 0,
): InspectorField[] {
  const fields: InspectorField[] = []
  const add = (
    id: string,
    label: string,
    group: InspectorGroup,
    size: number,
    value: string | null,
    editable = false,
    note?: string,
  ): void => {
    fields.push({
      id,
      label,
      group,
      size: value === null ? 0 : size,
      value: value ?? '-',
      editable: editable && value !== null,
      note,
    })
  }

  const first = bytes.length > 0 ? bytes[0]! : null

  add('binary', 'Binary', 'Other', 1, first === null ? null : first.toString(2).padStart(8, '0'), true)
  add('octal', 'Octal', 'Other', 1, first === null ? null : first.toString(8).padStart(3, '0'))
  add(
    'char',
    'Character',
    'Other',
    1,
    first === null ? null : displayChar(decodeRow(bytes.subarray(0, 1), encoding)[0] ?? ''),
    false,
    encoding,
  )
  add('offset', 'Offset', 'Other', 0, `0x${offset.toString(16).toUpperCase()} (${offset})`)

  const int = (id: string, label: string, size: number, signed: boolean): void => {
    const value = readIntN(bytes, size, little, signed)
    add(id, label, 'Integer', size, value === null ? null : String(value), true)
  }
  int('int8', 'Int8', 1, true)
  int('uint8', 'UInt8', 1, false)
  int('int16', 'Int16', 2, true)
  int('uint16', 'UInt16', 2, false)
  int('int24', 'Int24', 3, true)
  int('uint24', 'UInt24', 3, false)
  int('int32', 'Int32', 4, true)
  int('uint32', 'UInt32', 4, false)

  const int64 = readBigInt(bytes, little, true)
  const uint64 = readBigInt(bytes, little, false)
  add('int64', 'Int64', 'Integer', 8, int64 === null ? null : int64.toString(), true)
  add('uint64', 'UInt64', 'Integer', 8, uint64 === null ? null : uint64.toString(), true)

  const f16 = readFloat16(bytes, little)
  add('float16', 'Float16', 'Floating point', 2, f16 === null ? null : String(f16))
  add(
    'float32',
    'Float32',
    'Floating point',
    4,
    bytes.length < 4 ? null : String(view(bytes).getFloat32(0, little)),
    true,
  )
  add(
    'float64',
    'Float64',
    'Floating point',
    8,
    bytes.length < 8 ? null : String(view(bytes).getFloat64(0, little)),
    true,
  )

  const uleb = readLeb128(bytes, false)
  const sleb = readLeb128(bytes, true)
  const vlq = readVlq(bytes)
  add('uleb128', 'ULEB128', 'Variable length', uleb?.size ?? 0, uleb ? uleb.value.toString() : null)
  add('sleb128', 'SLEB128', 'Variable length', sleb?.size ?? 0, sleb ? sleb.value.toString() : null)
  add('vlq', 'VLQ', 'Variable length', vlq?.size ?? 0, vlq ? vlq.value.toString() : null)

  const rationalNum = readIntN(bytes, 4, little, false)
  const rationalDen = readIntN(bytes.subarray(4), 4, little, false)
  add(
    'rational',
    'Rational',
    'Variable length',
    8,
    rationalNum === null || rationalDen === null
      ? null
      : `${rationalNum}/${rationalDen}${rationalDen ? ` = ${rationalNum / rationalDen}` : ''}`,
  )
  const sNum = readIntN(bytes, 4, little, true)
  const sDen = readIntN(bytes.subarray(4), 4, little, true)
  add(
    'srational',
    'SRational',
    'Variable length',
    8,
    sNum === null || sDen === null
      ? null
      : `${sNum}/${sDen}${sDen ? ` = ${sNum / sDen}` : ''}`,
  )

  const unix32 = readIntN(bytes, 4, little, false)
  add(
    'unix32',
    'Unix time (32 bit)',
    'Date / time',
    4,
    unix32 === null ? null : formatDate(unix32 * 1000),
  )
  add(
    'unix64ms',
    'Unix time (ms, 64 bit)',
    'Date / time',
    8,
    int64 === null ? null : formatDate(Number(int64)),
  )
  add(
    'filetime',
    'Windows FILETIME',
    'Date / time',
    8,
    uint64 === null ? null : formatDate(Number(uint64 / 10_000n) - UNIX_TO_FILETIME_MS),
  )
  const dos = readIntN(bytes, 4, little, false)
  add('dos', 'MS-DOS date & time', 'Date / time', 4, dos === null ? null : formatDosDateTime(dos))
  const hfs = readIntN(bytes, 4, little, false)
  add(
    'hfs',
    'HFS+ / Mac time',
    'Date / time',
    4,
    hfs === null ? null : formatDate(HFS_EPOCH_MS + hfs * 1000),
  )
  add(
    'ole',
    'OLE automation date',
    'Date / time',
    8,
    bytes.length < 8
      ? null
      : formatDate((view(bytes).getFloat64(0, little) - OLE_EPOCH_DAYS) * MS_PER_DAY),
  )
  add(
    'cocoa',
    'Apple / Cocoa (NSDate)',
    'Date / time',
    8,
    bytes.length < 8
      ? null
      : formatDate(view(bytes).getFloat64(0, little) * 1000 + COCOA_EPOCH_MS),
  )

  add('guid', 'GUID / UUID', 'Other', 16, formatGuid(bytes, little))

  return fields
}

function formatDosDateTime(value: number): string {
  const time = value & 0xffff
  const date = (value >>> 16) & 0xffff
  const year = 1980 + ((date >> 9) & 0x7f)
  const month = (date >> 5) & 0x0f
  const day = date & 0x1f
  const hour = (time >> 11) & 0x1f
  const minute = (time >> 5) & 0x3f
  const second = (time & 0x1f) * 2
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return '-'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`
}

/* -------------------------------------------------------------- encode ---- */

export class InspectorEditError extends Error {}

/** Turns an edited inspector field back into the bytes to write at the caret. */
export function encodeField(id: string, text: string, little: boolean): Uint8Array {
  const trimmed = text.trim()
  if (trimmed === '') throw new InspectorEditError('Enter a value.')

  const writeInt = (size: number, signed: boolean): Uint8Array => {
    const value = parseIntegerLike(trimmed)
    const min = signed ? -(2n ** BigInt(size * 8 - 1)) : 0n
    const max = signed ? 2n ** BigInt(size * 8 - 1) - 1n : 2n ** BigInt(size * 8) - 1n
    if (value < min || value > max) {
      throw new InspectorEditError(`Value does not fit into ${size} byte(s).`)
    }
    const unsigned = value < 0n ? value + 2n ** BigInt(size * 8) : value
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
      out[little ? i : size - 1 - i] = Number((unsigned >> BigInt(8 * i)) & 0xffn)
    }
    return out
  }

  switch (id) {
    case 'int8':
      return writeInt(1, true)
    case 'uint8':
      return writeInt(1, false)
    case 'int16':
      return writeInt(2, true)
    case 'uint16':
      return writeInt(2, false)
    case 'int24':
      return writeInt(3, true)
    case 'uint24':
      return writeInt(3, false)
    case 'int32':
      return writeInt(4, true)
    case 'uint32':
      return writeInt(4, false)
    case 'int64':
      return writeInt(8, true)
    case 'uint64':
      return writeInt(8, false)
    case 'float32': {
      const value = Number(trimmed)
      if (Number.isNaN(value) && trimmed.toLowerCase() !== 'nan') {
        throw new InspectorEditError('Not a number.')
      }
      const out = new Uint8Array(4)
      view(out).setFloat32(0, value, little)
      return out
    }
    case 'float64': {
      const value = Number(trimmed)
      if (Number.isNaN(value) && trimmed.toLowerCase() !== 'nan') {
        throw new InspectorEditError('Not a number.')
      }
      const out = new Uint8Array(8)
      view(out).setFloat64(0, value, little)
      return out
    }
    case 'binary': {
      const bits = trimmed.replace(/\s+/g, '')
      if (!/^[01]{1,8}$/.test(bits)) throw new InspectorEditError('Enter up to 8 bits (0 or 1).')
      return new Uint8Array([Number.parseInt(bits, 2)])
    }
    default:
      throw new InspectorEditError('This field cannot be edited.')
  }
}

function parseIntegerLike(text: string): bigint {
  try {
    if (/^[+-]?0x[0-9a-f]+$/i.test(text)) {
      const negative = text.startsWith('-')
      const digits = text.replace(/^[+-]/, '')
      const value = BigInt(digits)
      return negative ? -value : value
    }
    if (!/^[+-]?\d+$/.test(text)) throw new Error('nan')
    return BigInt(text)
  } catch {
    throw new InspectorEditError('Not a whole number.')
  }
}

/* ---------------------------------------------------------------- bits ---- */

/** Flips a single bit of a byte - used by the bit editor. */
export function toggleBit(byte: number, bit: number): number {
  return (byte ^ (1 << bit)) & 0xff
}

export function bitsOf(byte: number): boolean[] {
  return Array.from({ length: 8 }, (_, i) => Boolean(byte & (1 << (7 - i))))
}
