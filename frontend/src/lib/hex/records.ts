/**
 * Intel HEX and Motorola S-Record support.
 *
 * Both formats describe sparse address ranges, so decoding returns the
 * segments as they appear in the file plus a flat image the editor can open.
 * Encoding goes the other way and takes the base address and record size.
 */

export interface RecordSegment {
  address: number
  bytes: Uint8Array
}

export interface DecodedRecords {
  format: 'intel-hex' | 'srec'
  segments: RecordSegment[]
  /** Entry point when the file declares one. */
  startAddress: number | null
  /** Lowest address present in the file. */
  baseAddress: number
  /** Flattened image from `baseAddress`, gaps filled with `fill`. */
  image: Uint8Array
  header: string | null
  warnings: string[]
}

export class RecordError extends Error {}

/** Guesses the record format from the first non empty line. */
export function detectRecordFormat(text: string): 'intel-hex' | 'srec' | null {
  const line = text.split(/\r?\n/).find((item) => item.trim() !== '')
  if (!line) return null
  if (line.startsWith(':')) return 'intel-hex'
  if (/^S[0-9]/.test(line)) return 'srec'
  return null
}

/** `true` when the bytes look like a text based record file. */
export function looksLikeRecordFile(head: Uint8Array): 'intel-hex' | 'srec' | null {
  const text = Array.from(head.subarray(0, 512), (b) => String.fromCharCode(b)).join('')
  return detectRecordFormat(text)
}

function flatten(segments: RecordSegment[], fill: number): { base: number; image: Uint8Array } {
  if (segments.length === 0) return { base: 0, image: new Uint8Array(0) }
  const base = Math.min(...segments.map((segment) => segment.address))
  const end = Math.max(...segments.map((segment) => segment.address + segment.bytes.length))
  const image = new Uint8Array(end - base).fill(fill)
  for (const segment of segments) image.set(segment.bytes, segment.address - base)
  return { base, image }
}

function mergeSegments(segments: RecordSegment[]): RecordSegment[] {
  const sorted = [...segments].sort((a, b) => a.address - b.address)
  const out: RecordSegment[] = []
  // Collect each contiguous run first and allocate its buffer once - record
  // files are usually one long run, and growing it per record is quadratic.
  let run: RecordSegment[] = []
  let runAddress = 0
  let runLength = 0

  const flush = (): void => {
    if (run.length === 0) return
    if (run.length === 1) {
      out.push({ address: runAddress, bytes: run[0]!.bytes })
    } else {
      const bytes = new Uint8Array(runLength)
      let written = 0
      for (const part of run) {
        bytes.set(part.bytes, written)
        written += part.bytes.length
      }
      out.push({ address: runAddress, bytes })
    }
    run = []
    runLength = 0
  }

  for (const segment of sorted) {
    if (run.length > 0 && runAddress + runLength === segment.address) {
      run.push(segment)
      runLength += segment.bytes.length
      continue
    }
    flush()
    run = [segment]
    runAddress = segment.address
    runLength = segment.bytes.length
  }
  flush()
  return out
}

/* ----------------------------------------------------------- Intel HEX ---- */

export function decodeIntelHex(text: string, fill = 0xff): DecodedRecords {
  const warnings: string[] = []
  const raw: RecordSegment[] = []
  let upper = 0
  let startAddress: number | null = null

  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line === '') continue
    if (!line.startsWith(':')) {
      warnings.push(`Line ${index + 1}: ignored, does not start with ":".`)
      continue
    }
    const body = line.slice(1)
    if (!/^[0-9a-fA-F]+$/.test(body) || body.length < 10 || body.length % 2 !== 0) {
      throw new RecordError(`Line ${index + 1}: malformed Intel HEX record.`)
    }

    const bytes = new Uint8Array(body.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)

    const count = bytes[0]!
    if (bytes.length !== count + 5) {
      throw new RecordError(`Line ${index + 1}: byte count does not match the record length.`)
    }
    const checksum = bytes.subarray(0, bytes.length - 1).reduce((sum, byte) => (sum + byte) & 0xff, 0)
    if (((0x100 - checksum) & 0xff) !== bytes[bytes.length - 1]!) {
      warnings.push(`Line ${index + 1}: checksum mismatch.`)
    }

    const address = (bytes[1]! << 8) | bytes[2]!
    const type = bytes[3]!
    const data = bytes.subarray(4, 4 + count)

    switch (type) {
      case 0x00:
        raw.push({ address: upper + address, bytes: new Uint8Array(data) })
        break
      case 0x01:
        index = lines.length
        break
      case 0x02:
        upper = ((data[0]! << 8) | data[1]!) * 16
        break
      case 0x03:
        startAddress = ((data[0]! << 8) | data[1]!) * 16 + ((data[2]! << 8) | data[3]!)
        break
      case 0x04:
        upper = ((data[0]! << 8) | data[1]!) * 65536
        break
      case 0x05:
        startAddress = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!
        break
      default:
        warnings.push(`Line ${index + 1}: unknown record type 0x${type.toString(16)}.`)
    }
  }

  const segments = mergeSegments(raw)
  const { base, image } = flatten(segments, fill)
  return {
    format: 'intel-hex',
    segments,
    startAddress,
    baseAddress: base,
    image,
    header: null,
    warnings,
  }
}

export interface EncodeOptions {
  /** Address the first byte is stored at. */
  baseAddress?: number
  /** Data bytes per record (1 - 255). */
  recordLength?: number
  startAddress?: number | null
  /** S-Record only: text of the S0 header record. */
  header?: string
}

export function encodeIntelHex(bytes: Uint8Array, options: EncodeOptions = {}): string {
  const base = options.baseAddress ?? 0
  const size = Math.min(255, Math.max(1, options.recordLength ?? 16))
  const lines: string[] = []
  let upper = -1

  const record = (count: number, address: number, type: number, data: number[]): string => {
    const values = [count, (address >> 8) & 0xff, address & 0xff, type, ...data]
    const checksum = (0x100 - (values.reduce((sum, byte) => sum + byte, 0) & 0xff)) & 0xff
    return (
      ':' +
      [...values, checksum].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('')
    )
  }

  for (let offset = 0; offset < bytes.length; offset += size) {
    const address = base + offset
    const high = Math.floor(address / 65536)
    if (high !== upper) {
      upper = high
      lines.push(record(2, 0, 0x04, [(high >> 8) & 0xff, high & 0xff]))
    }
    const chunk = Array.from(bytes.subarray(offset, offset + size))
    lines.push(record(chunk.length, address & 0xffff, 0x00, chunk))
  }

  if (options.startAddress != null) {
    const value = options.startAddress
    lines.push(
      record(4, 0, 0x05, [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ]),
    )
  }
  lines.push(':00000001FF')
  return lines.join('\n') + '\n'
}

/* ------------------------------------------------------------- S-Record ---- */

const ADDRESS_BYTES: Record<number, number> = { 0: 2, 1: 2, 2: 3, 3: 4, 5: 2, 6: 3, 7: 4, 8: 3, 9: 2 }

export function decodeSrec(text: string, fill = 0xff): DecodedRecords {
  const warnings: string[] = []
  const raw: RecordSegment[] = []
  let startAddress: number | null = null
  let header: string | null = null

  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line === '') continue
    if (!/^S[0-9][0-9a-fA-F]+$/.test(line)) {
      warnings.push(`Line ${index + 1}: ignored, not an S-Record.`)
      continue
    }

    const type = Number.parseInt(line[1]!, 10)
    const addressBytes = ADDRESS_BYTES[type]
    if (addressBytes === undefined) {
      warnings.push(`Line ${index + 1}: unsupported record type S${type}.`)
      continue
    }

    const body = line.slice(2)
    if (body.length % 2 !== 0) throw new RecordError(`Line ${index + 1}: odd number of digits.`)
    const bytes = new Uint8Array(body.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)

    const count = bytes[0]!
    if (bytes.length !== count + 1) {
      throw new RecordError(`Line ${index + 1}: byte count does not match the record length.`)
    }
    const sum = bytes.subarray(0, bytes.length - 1).reduce((acc, byte) => (acc + byte) & 0xff, 0)
    if ((~sum & 0xff) !== bytes[bytes.length - 1]!) {
      warnings.push(`Line ${index + 1}: checksum mismatch.`)
    }

    let address = 0
    for (let i = 0; i < addressBytes; i++) address = address * 256 + bytes[1 + i]!
    const data = bytes.subarray(1 + addressBytes, bytes.length - 1)

    if (type === 0) {
      header = Array.from(data, (byte) => String.fromCharCode(byte))
        .join('')
        .replace(/\0+$/, '')
    } else if (type >= 1 && type <= 3) {
      raw.push({ address, bytes: new Uint8Array(data) })
    } else if (type >= 7 && type <= 9) {
      startAddress = address
    }
  }

  const segments = mergeSegments(raw)
  const { base, image } = flatten(segments, fill)
  return { format: 'srec', segments, startAddress, baseAddress: base, image, header, warnings }
}

export function encodeSrec(bytes: Uint8Array, options: EncodeOptions = {}): string {
  const base = options.baseAddress ?? 0
  const size = Math.min(250, Math.max(1, options.recordLength ?? 16))
  const end = base + bytes.length
  const addressBytes = end > 0xffffff ? 4 : end > 0xffff ? 3 : 2
  const dataType = addressBytes === 4 ? 3 : addressBytes === 3 ? 2 : 1
  const endType = addressBytes === 4 ? 7 : addressBytes === 3 ? 8 : 9

  const record = (type: number, address: number, data: number[], width: number): string => {
    const addressValues: number[] = []
    for (let i = width - 1; i >= 0; i--) addressValues.push(Math.floor(address / 256 ** i) & 0xff)
    const payload = [...addressValues, ...data]
    const count = payload.length + 1
    const checksum = ~((count + payload.reduce((sum, byte) => sum + byte, 0)) & 0xff) & 0xff
    return (
      `S${type}` +
      [count, ...payload, checksum]
        .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
        .join('')
    )
  }

  const lines: string[] = []
  const header = options.header ?? 'HDR'
  lines.push(record(0, 0, Array.from(header, (char) => char.charCodeAt(0) & 0xff), 2))
  let records = 0
  for (let offset = 0; offset < bytes.length; offset += size) {
    const chunk = Array.from(bytes.subarray(offset, offset + size))
    lines.push(record(dataType, base + offset, chunk, addressBytes))
    records++
  }
  lines.push(record(5, records & 0xffff, [], 2))
  lines.push(record(endType, options.startAddress ?? base, [], addressBytes))
  return lines.join('\n') + '\n'
}

/** Decodes either format, picking it from the content. */
export function decodeRecords(text: string, fill = 0xff): DecodedRecords {
  const format = detectRecordFormat(text)
  if (format === 'intel-hex') return decodeIntelHex(text, fill)
  if (format === 'srec') return decodeSrec(text, fill)
  throw new RecordError('The text is neither an Intel HEX nor a Motorola S-Record file.')
}
