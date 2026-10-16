/**
 * Byte sources for the hex editor.
 *
 * A `ByteSource` is a random access, read-only view over bytes that may live
 * on disk (`File`), in memory or be generated on the fly. Nothing is ever read
 * eagerly: the editor asks for the few kilobytes it currently shows and the
 * source loads exactly that much, which is what makes multi-gigabyte files
 * work without a matching amount of RAM.
 */

/** 64 KiB - the granularity at which file data is fetched and cached. */
export const CHUNK_SIZE = 1 << 16

/** Upper bound for the per-source chunk cache (64 KiB * 192 = 12 MiB). */
const MAX_CACHED_CHUNKS = 192

/** `Uint8Array` is a valid `BlobPart`; the DOM typings are stricter than reality. */
export function toBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart
}

export interface ByteSource {
  /** Number of bytes this source can serve. */
  readonly size: number
  /** Reads `[offset, offset + length)`, clamped to the source size. */
  read(offset: number, length: number): Promise<Uint8Array>
  /** Returns the range when it can be served without I/O, `null` otherwise. */
  peek(offset: number, length: number): Uint8Array | null
  /**
   * Describes the range as blob parts. Used when saving: parts that point at a
   * `File` are references, so the browser streams them straight from disk.
   */
  blobParts(offset: number, length: number): BlobPart[]
  /** Frees cached data. */
  dispose(): void
}

function clampRange(offset: number, length: number, size: number): [number, number] {
  const start = Math.max(0, Math.min(offset, size))
  const end = Math.max(start, Math.min(offset + length, size))
  return [start, end - start]
}

/* --------------------------------------------------------------- file ---- */

/**
 * Reads from a `File`/`Blob` in 64 KiB chunks and keeps the most recently used
 * ones around, so scrolling back and forth does not hit the disk every time.
 */
export class FileByteSource implements ByteSource {
  readonly size: number

  private readonly cache = new Map<number, Uint8Array>()
  private readonly inflight = new Map<number, Promise<Uint8Array>>()

  constructor(private blob: Blob) {
    this.size = blob.size
  }

  /** The underlying blob - used to build save-time references. */
  get handleBlob(): Blob {
    return this.blob
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const [start, count] = clampRange(offset, length, this.size)
    if (count === 0) return new Uint8Array(0)

    const firstChunk = Math.floor(start / CHUNK_SIZE)
    const lastChunk = Math.floor((start + count - 1) / CHUNK_SIZE)

    // A single large request would blow up the cache - read it straight through.
    if (lastChunk - firstChunk > MAX_CACHED_CHUNKS / 2) {
      return new Uint8Array(await this.blob.slice(start, start + count).arrayBuffer())
    }

    const chunks = await Promise.all(
      Array.from({ length: lastChunk - firstChunk + 1 }, (_, i) => this.chunk(firstChunk + i)),
    )

    const out = new Uint8Array(count)
    let written = 0
    for (let i = 0; i < chunks.length; i++) {
      const chunkStart = (firstChunk + i) * CHUNK_SIZE
      const from = Math.max(0, start - chunkStart)
      const to = Math.min(chunks[i]!.length, start + count - chunkStart)
      if (to > from) {
        out.set(chunks[i]!.subarray(from, to), written)
        written += to - from
      }
    }
    return written === count ? out : out.subarray(0, written)
  }

  peek(offset: number, length: number): Uint8Array | null {
    const [start, count] = clampRange(offset, length, this.size)
    if (count === 0) return new Uint8Array(0)

    const firstChunk = Math.floor(start / CHUNK_SIZE)
    const lastChunk = Math.floor((start + count - 1) / CHUNK_SIZE)

    const out = new Uint8Array(count)
    let written = 0
    for (let index = firstChunk; index <= lastChunk; index++) {
      const chunk = this.cache.get(index)
      if (!chunk) return null
      const chunkStart = index * CHUNK_SIZE
      const from = Math.max(0, start - chunkStart)
      const to = Math.min(chunk.length, start + count - chunkStart)
      if (to > from) {
        out.set(chunk.subarray(from, to), written)
        written += to - from
      }
    }
    return written === count ? out : out.subarray(0, written)
  }

  blobParts(offset: number, length: number): BlobPart[] {
    const [start, count] = clampRange(offset, length, this.size)
    return count === 0 ? [] : [this.blob.slice(start, start + count)]
  }

  dispose(): void {
    this.cache.clear()
    this.inflight.clear()
  }

  private chunk(index: number): Promise<Uint8Array> {
    const cached = this.cache.get(index)
    if (cached) {
      // Refresh the LRU position.
      this.cache.delete(index)
      this.cache.set(index, cached)
      return Promise.resolve(cached)
    }

    const pending = this.inflight.get(index)
    if (pending) return pending

    const start = index * CHUNK_SIZE
    const request = this.blob
      .slice(start, Math.min(start + CHUNK_SIZE, this.size))
      .arrayBuffer()
      .then((buffer) => {
        const bytes = new Uint8Array(buffer)
        this.cache.set(index, bytes)
        while (this.cache.size > MAX_CACHED_CHUNKS) {
          const oldest = this.cache.keys().next()
          if (oldest.done) break
          this.cache.delete(oldest.value)
        }
        return bytes
      })
      .finally(() => this.inflight.delete(index))

    this.inflight.set(index, request)
    return request
  }
}

/* ------------------------------------------------------------- memory ---- */

/** A fixed, fully in-memory buffer. */
export class MemoryByteSource implements ByteSource {
  constructor(private readonly bytes: Uint8Array) {}

  get size(): number {
    return this.bytes.length
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    return Promise.resolve(this.peek(offset, length) ?? new Uint8Array(0))
  }

  peek(offset: number, length: number): Uint8Array {
    const [start, count] = clampRange(offset, length, this.size)
    return this.bytes.subarray(start, start + count)
  }

  blobParts(offset: number, length: number): BlobPart[] {
    const slice = this.peek(offset, length)
    return slice.length === 0 ? [] : [toBlobPart(slice)]
  }

  dispose(): void {
    /* nothing to release */
  }
}

/* --------------------------------------------------------------- fill ---- */

/**
 * A virtual source of one repeated byte. Lets the editor insert or fill
 * gigabytes of padding (think flash images) at zero memory cost.
 */
export class FillByteSource implements ByteSource {
  /** Blob parts are emitted in 1 MiB slices so a huge fill never allocates at once. */
  private static readonly PART_SIZE = 1 << 20

  constructor(
    readonly size: number,
    private readonly value: number,
  ) {}

  read(offset: number, length: number): Promise<Uint8Array> {
    return Promise.resolve(this.peek(offset, length))
  }

  peek(offset: number, length: number): Uint8Array {
    const [, count] = clampRange(offset, length, this.size)
    return new Uint8Array(count).fill(this.value & 0xff)
  }

  blobParts(offset: number, length: number): BlobPart[] {
    const [, count] = clampRange(offset, length, this.size)
    if (count === 0) return []
    const full = Math.min(FillByteSource.PART_SIZE, count)
    // One buffer, referenced as often as needed - `Blob` copies each part.
    const block = new Uint8Array(full).fill(this.value & 0xff)
    const parts: BlobPart[] = []
    let done = 0
    while (count - done >= full) {
      parts.push(toBlobPart(block))
      done += full
    }
    if (done < count) parts.push(toBlobPart(block.subarray(0, count - done)))
    return parts
  }

  dispose(): void {
    /* nothing to release */
  }
}

/* ------------------------------------------------------------- append ---- */

/**
 * Append-only store holding every byte the user typed or pasted. Grows in 1 MiB
 * chunks so appending never has to copy the whole buffer.
 */
export class AppendStore implements ByteSource {
  private static readonly CHUNK = 1 << 20

  private readonly chunks: Uint8Array[] = []
  private used = 0

  get size(): number {
    return this.used
  }

  /** Stores `bytes` and returns the offset they were written to. */
  append(bytes: Uint8Array): number {
    const start = this.used
    let written = 0
    while (written < bytes.length) {
      const chunkIndex = Math.floor((start + written) / AppendStore.CHUNK)
      while (this.chunks.length <= chunkIndex) {
        this.chunks.push(new Uint8Array(AppendStore.CHUNK))
      }
      const inChunk = (start + written) % AppendStore.CHUNK
      const count = Math.min(AppendStore.CHUNK - inChunk, bytes.length - written)
      this.chunks[chunkIndex]!.set(bytes.subarray(written, written + count), inChunk)
      written += count
    }
    this.used += bytes.length
    return start
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    return Promise.resolve(this.peek(offset, length))
  }

  peek(offset: number, length: number): Uint8Array {
    const [start, count] = clampRange(offset, length, this.used)
    const out = new Uint8Array(count)
    let written = 0
    while (written < count) {
      const position = start + written
      const chunkIndex = Math.floor(position / AppendStore.CHUNK)
      const inChunk = position % AppendStore.CHUNK
      const take = Math.min(AppendStore.CHUNK - inChunk, count - written)
      const chunk = this.chunks[chunkIndex]
      if (!chunk) break
      out.set(chunk.subarray(inChunk, inChunk + take), written)
      written += take
    }
    return out
  }

  blobParts(offset: number, length: number): BlobPart[] {
    const slice = this.peek(offset, length)
    return slice.length === 0 ? [] : [toBlobPart(slice)]
  }

  /**
   * Intentionally keeps the bytes: another document may have imported a range
   * that points into this store. The store is garbage collected once no
   * document references it any more.
   */
  dispose(): void {
    /* nothing to release */
  }
}
