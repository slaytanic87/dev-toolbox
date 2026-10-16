/**
 * Streaming search over a {@link HexDocument}.
 *
 * Patterns are compiled into one 256 bit "allowed values" bitmap per position,
 * which covers exact bytes, hex wildcards (`4? A5 ??`) and case insensitive
 * text in any encodable code page with the same matching loop. The document is
 * scanned in 1 MiB windows that overlap by the pattern length, so nothing is
 * ever fully loaded and matches across window borders are still found.
 */

import type { HexDocument } from './document'
import { encodeCaseVariants, encodeText } from './encodings'
import { encodeNumber, NUMBER_TYPES, ParseError, type NumberType } from './parsers'

export type SearchMode = 'hex' | 'text' | 'number'

export { NUMBER_TYPES }
export type { NumberType }

/** Window size for the streaming scan. */
const WINDOW = 1 << 20

export class SearchError extends Error {}

export interface BytePattern {
  length: number
  /** One 32 byte bitmap per position: bit `v` set means byte `v` matches. */
  masks: Uint8Array[]
  /** The literal bytes when the pattern has no wildcards or alternatives. */
  exact: Uint8Array | null
  /** Human readable form, shown in the result list. */
  description: string
}

export interface PatternRequest {
  mode: SearchMode
  query: string
  encoding?: string
  caseInsensitive?: boolean
  numberType?: NumberType
  littleEndian?: boolean
}

/* ------------------------------------------------------------- compile ---- */

function maskOf(values: Iterable<number>): Uint8Array {
  const mask = new Uint8Array(32)
  for (const value of values) mask[value >> 3]! |= 1 << (value & 7)
  return mask
}

function exactMasks(bytes: Uint8Array): Uint8Array[] {
  return Array.from(bytes, (byte) => maskOf([byte]))
}

export function compilePattern(request: PatternRequest): BytePattern {
  switch (request.mode) {
    case 'hex':
      return compileHex(request.query)
    case 'text':
      return compileTextPattern(request)
    case 'number':
      return compileNumber(request)
  }
}

function compileHex(query: string): BytePattern {
  const cleaned = query.replace(/0x/gi, '').replace(/[\s,;:_|-]+/g, '')
  if (cleaned === '') throw new SearchError('Enter the hex bytes to look for.')
  if (cleaned.length % 2 !== 0) {
    throw new SearchError('Hex patterns need an even number of digits (one pair per byte).')
  }
  if (!/^[0-9a-f?*]+$/i.test(cleaned)) {
    throw new SearchError('Only hex digits and "?" as a wildcard are allowed.')
  }

  const masks: Uint8Array[] = []
  const exact: number[] = []
  let wildcard = false
  for (let i = 0; i < cleaned.length; i += 2) {
    const high = cleaned[i]!
    const low = cleaned[i + 1]!
    const highWild = high === '?' || high === '*'
    const lowWild = low === '?' || low === '*'
    wildcard ||= highWild || lowWild
    const values: number[] = []
    for (let value = 0; value < 256; value++) {
      if (!highWild && (value >> 4) !== Number.parseInt(high, 16)) continue
      if (!lowWild && (value & 0x0f) !== Number.parseInt(low, 16)) continue
      values.push(value)
    }
    masks.push(maskOf(values))
    if (!wildcard) exact.push(Number.parseInt(high + low, 16))
  }

  return {
    length: masks.length,
    masks,
    exact: wildcard ? null : new Uint8Array(exact),
    description: cleaned.toUpperCase().replace(/(..)(?=.)/g, '$1 '),
  }
}

function compileTextPattern(request: PatternRequest): BytePattern {
  if (request.query === '') throw new SearchError('Enter the text to look for.')
  const encoding = request.encoding ?? 'latin1'

  if (!request.caseInsensitive) {
    const bytes = encodeText(request.query, encoding)
    if (bytes.length === 0) throw new SearchError('The text produced no bytes.')
    return {
      length: bytes.length,
      masks: exactMasks(bytes),
      exact: bytes,
      description: `"${request.query}"`,
    }
  }

  const variants = encodeCaseVariants(request.query, encoding)
  const length = variants[0]!.length
  if (length === 0) throw new SearchError('The text produced no bytes.')
  const masks = Array.from({ length }, (_, index) =>
    maskOf(variants.filter((v) => v.length === length).map((v) => v[index]!)),
  )
  return {
    length,
    masks,
    exact: null,
    description: `"${request.query}" (any case)`,
  }
}

function compileNumber(request: PatternRequest): BytePattern {
  const type = request.numberType ?? 'uint32'
  const little = request.littleEndian ?? true
  const text = request.query.trim()
  if (text === '') throw new SearchError('Enter the number to look for.')

  let bytes: Uint8Array
  try {
    bytes = encodeNumber(type, text, little)
  } catch (error) {
    throw new SearchError(error instanceof ParseError ? error.message : String(error))
  }

  return {
    length: bytes.length,
    masks: exactMasks(bytes),
    exact: bytes,
    description: `${type} ${text} (${little ? 'LE' : 'BE'})`,
  }
}

/* -------------------------------------------------------------- match ---- */

function matchesAt(buffer: Uint8Array, index: number, pattern: BytePattern): boolean {
  if (index + pattern.length > buffer.length) return false
  for (let i = 0; i < pattern.length; i++) {
    const byte = buffer[index + i]!
    if ((pattern.masks[i]![byte >> 3]! & (1 << (byte & 7))) === 0) return false
  }
  return true
}

export interface SearchRange {
  start: number
  end: number
}

export interface ScanOptions {
  range?: SearchRange
  /** Report progress and allow cancelling long scans. */
  onProgress?: (scanned: number, total: number) => void
  shouldCancel?: () => boolean
}

/** Finds the next match at or after `from`, optionally wrapping around. */
export async function findNext(
  doc: HexDocument,
  pattern: BytePattern,
  from: number,
  wrap = true,
  options: ScanOptions = {},
): Promise<number | null> {
  const range = options.range ?? { start: 0, end: doc.size }
  const begin = Math.max(range.start, Math.min(from, range.end))
  const direct = await scanForward(doc, pattern, begin, range.end, options)
  if (direct !== null) return direct
  if (!wrap || begin <= range.start) return null
  return scanForward(doc, pattern, range.start, Math.min(begin + pattern.length - 1, range.end), options)
}

/** Finds the closest match that starts before `from`. */
export async function findPrevious(
  doc: HexDocument,
  pattern: BytePattern,
  from: number,
  wrap = true,
  options: ScanOptions = {},
): Promise<number | null> {
  const range = options.range ?? { start: 0, end: doc.size }
  const limit = Math.max(range.start, Math.min(from, range.end))
  // A match may extend past the caret, so the window reaches a bit further.
  const windowEnd = Math.min(range.end, limit + pattern.length - 1)
  const direct = await scanBackward(doc, pattern, range.start, windowEnd, limit, options)
  if (direct !== null) return direct
  if (!wrap || limit >= range.end) return null
  return scanBackward(doc, pattern, range.start, range.end, range.end, options)
}

/** Collects every match, capped at `limit` results. */
export async function findAll(
  doc: HexDocument,
  pattern: BytePattern,
  limit = 10_000,
  options: ScanOptions = {},
): Promise<{ matches: number[]; truncated: boolean }> {
  const range = options.range ?? { start: 0, end: doc.size }
  const matches: number[] = []
  const overlap = pattern.length - 1
  const step = Math.max(1, WINDOW - overlap)
  const total = Math.max(0, range.end - range.start)
  let position = range.start

  while (position + pattern.length <= range.end) {
    const length = Math.min(WINDOW, range.end - position)
    const buffer = await doc.read(position, length)
    for (let i = 0; i + pattern.length <= buffer.length; i++) {
      if (!matchesAt(buffer, i, pattern)) continue
      matches.push(position + i)
      if (matches.length >= limit) return { matches, truncated: true }
    }
    options.onProgress?.(position + length - range.start, total)
    if (options.shouldCancel?.()) break
    if (length < WINDOW) break
    position += step
  }
  return { matches, truncated: false }
}

async function scanForward(
  doc: HexDocument,
  pattern: BytePattern,
  start: number,
  end: number,
  options: ScanOptions,
): Promise<number | null> {
  const step = Math.max(1, WINDOW - (pattern.length - 1))
  const total = Math.max(0, end - start)
  let position = start

  while (position + pattern.length <= end) {
    const length = Math.min(WINDOW, end - position)
    const buffer = await doc.read(position, length)
    for (let i = 0; i + pattern.length <= buffer.length; i++) {
      if (matchesAt(buffer, i, pattern)) return position + i
    }
    if (options.shouldCancel?.()) return null
    options.onProgress?.(position + length - start, total)
    if (length < WINDOW) break
    position += step
  }
  return null
}

async function scanBackward(
  doc: HexDocument,
  pattern: BytePattern,
  start: number,
  end: number,
  maxStart: number,
  options: ScanOptions,
): Promise<number | null> {
  const overlap = pattern.length - 1
  const total = Math.max(0, end - start)
  let windowEnd = end

  while (windowEnd - pattern.length >= start) {
    const windowStart = Math.max(start, windowEnd - WINDOW)
    const buffer = await doc.read(windowStart, windowEnd - windowStart)
    for (let i = buffer.length - pattern.length; i >= 0; i--) {
      if (windowStart + i < maxStart && matchesAt(buffer, i, pattern)) return windowStart + i
    }
    if (options.shouldCancel?.()) return null
    options.onProgress?.(end - windowStart, total)
    if (windowStart === start) break
    windowEnd = windowStart + overlap
  }
  return null
}

/* ------------------------------------------------------------ replace ---- */

export interface ReplaceResult {
  replaced: number
  truncated: boolean
}

/**
 * Replaces every match with `replacement`. Matches are rewritten from the end
 * backwards so earlier offsets stay valid even when the length changes.
 */
export async function replaceAll(
  doc: HexDocument,
  pattern: BytePattern,
  replacement: Uint8Array,
  keepSize: boolean,
  options: ScanOptions = {},
): Promise<ReplaceResult> {
  const { matches, truncated } = await findAll(doc, pattern, 10_000, options)
  if (matches.length === 0) return { replaced: 0, truncated }

  doc.transact(`Replace ${matches.length} match(es)`, () => {
    for (let i = matches.length - 1; i >= 0; i--) {
      const offset = matches[i]!
      if (keepSize) {
        const bytes = replacement.subarray(0, pattern.length)
        doc.overwrite(offset, bytes)
      } else {
        doc.replace(offset, pattern.length, replacement)
      }
    }
  })
  return { replaced: matches.length, truncated }
}
