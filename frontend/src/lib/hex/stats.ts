/**
 * Byte distribution, entropy and descriptive statistics.
 *
 * The document is walked in windows and only a 256 entry histogram is kept, so
 * the memory cost is constant no matter how large the analysed range is.
 */

import type { HexDocument } from './document'

export interface ByteStatistics {
  counts: Uint32Array
  total: number
  /** Shannon entropy in bits per byte (0 - 8). */
  entropy: number
  mean: number
  median: number
  variance: number
  standardDeviation: number
  min: number
  max: number
  /** Distinct byte values that occur at least once. */
  unique: number
  nullBytes: number
  printable: number
}

export interface AnalyseOptions {
  onProgress?: (scanned: number, total: number) => void
  shouldCancel?: () => boolean
}

const WINDOW = 1 << 20

export interface AnalyseRange {
  start: number
  length: number
}

export async function analyse(
  doc: HexDocument,
  ranges: AnalyseRange[],
  options: AnalyseOptions = {},
): Promise<ByteStatistics> {
  const counts = new Uint32Array(256)
  const total = ranges.reduce((sum, range) => sum + Math.max(0, range.length), 0)
  let scanned = 0

  for (const range of ranges) {
    let position = range.start
    const end = range.start + range.length
    while (position < end) {
      const length = Math.min(WINDOW, end - position)
      const bytes = await doc.read(position, length)
      if (bytes.length === 0) break
      for (let i = 0; i < bytes.length; i++) counts[bytes[i]!]!++
      position += bytes.length
      scanned += bytes.length
      options.onProgress?.(scanned, total)
      if (options.shouldCancel?.()) return summarise(counts)
    }
  }
  return summarise(counts)
}

export function summarise(counts: Uint32Array): ByteStatistics {
  let total = 0
  let sum = 0
  let unique = 0
  let min = 255
  let max = 0
  let printable = 0

  for (let value = 0; value < 256; value++) {
    const count = counts[value]!
    if (count === 0) continue
    total += count
    sum += value * count
    unique++
    if (value < min) min = value
    if (value > max) max = value
    if ((value >= 0x20 && value < 0x7f) || value === 0x09 || value === 0x0a || value === 0x0d) {
      printable += count
    }
  }

  if (total === 0) {
    return {
      counts,
      total: 0,
      entropy: 0,
      mean: 0,
      median: 0,
      variance: 0,
      standardDeviation: 0,
      min: 0,
      max: 0,
      unique: 0,
      nullBytes: 0,
      printable: 0,
    }
  }

  const mean = sum / total
  let variance = 0
  let entropy = 0
  for (let value = 0; value < 256; value++) {
    const count = counts[value]!
    if (count === 0) continue
    variance += count * (value - mean) ** 2
    const probability = count / total
    entropy -= probability * Math.log2(probability)
  }
  variance = total > 1 ? variance / (total - 1) : 0

  return {
    counts,
    total,
    entropy,
    mean,
    median: medianOf(counts, total),
    variance,
    standardDeviation: Math.sqrt(variance),
    min,
    max,
    unique,
    nullBytes: counts[0]!,
    printable,
  }
}

function medianOf(counts: Uint32Array, total: number): number {
  const middle = total / 2
  let seen = 0
  for (let value = 0; value < 256; value++) {
    seen += counts[value]!
    if (seen > middle) return value
    if (seen === middle) {
      for (let next = value + 1; next < 256; next++) {
        if (counts[next]! > 0) return (value + next) / 2
      }
      return value
    }
  }
  return 0
}

/** Rough verdict on the entropy, shown next to the number. */
export function entropyVerdict(entropy: number): string {
  if (entropy === 0) return 'constant data'
  if (entropy < 2) return 'highly repetitive'
  if (entropy < 4) return 'structured data'
  if (entropy < 6) return 'mixed content'
  if (entropy < 7.5) return 'dense / compressed'
  return 'compressed or encrypted'
}
