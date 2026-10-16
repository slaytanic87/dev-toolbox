/**
 * Piece table over one or more {@link ByteSource}s.
 *
 * The document is only a list of *descriptors* ("take 4 KiB from the file at
 * 0x1000, then 2 bytes the user typed, then the rest of the file"). Inserting,
 * overwriting and deleting therefore never copies file data, undo/redo only
 * stores descriptors, and saving turns the list into `Blob` parts the browser
 * streams straight from the original file to the new one.
 */

import {
  AppendStore,
  FileByteSource,
  FillByteSource,
  MemoryByteSource,
  type ByteSource,
} from './source'

export interface Piece {
  /** Index into the document's source list. */
  source: number
  /** Offset inside that source. */
  start: number
  length: number
  /** `true` for bytes produced by an edit - the grid highlights them. */
  dirty: boolean
}

interface Edit {
  index: number
  removed: Piece[]
  inserted: Piece[]
}

interface EditGroup {
  edits: Edit[]
  label: string
  coalesceKey: string | null
}

export interface ReplaceOptions {
  label?: string
  /** `false` keeps the written bytes out of the "changed" highlight. */
  dirty?: boolean
  /**
   * Consecutive edits sharing a key land in the same undo step - used while
   * typing the two nibbles of a byte.
   */
  coalesceKey?: string | null
}

export interface FlaggedBytes {
  bytes: Uint8Array
  /** `1` where the byte was changed since the file was opened. */
  dirty: Uint8Array
}

const EMPTY = new Uint8Array(0)

export class HexDocument {
  private readonly sources: ByteSource[] = []
  private appendStore = new AppendStore()
  private pieces: Piece[] = []
  /** `offsets[i]` is the document offset at which `pieces[i]` starts. */
  private offsets: number[] = [0]
  private undoStack: EditGroup[] = []
  private redoStack: EditGroup[] = []
  private revision = 0

  private constructor() {
    this.sources.push(this.appendStore)
  }

  /* ------------------------------------------------------------ factory */

  /** Opens a blob/file without reading a single byte of it. */
  static fromBlob(blob: Blob): HexDocument {
    const doc = new HexDocument()
    const index = doc.sources.push(new FileByteSource(blob)) - 1
    if (blob.size > 0) doc.pieces.push({ source: index, start: 0, length: blob.size, dirty: false })
    doc.rebuildOffsets()
    return doc
  }

  /** Creates an in-memory document, optionally pre-filled. */
  static fromBytes(bytes: Uint8Array): HexDocument {
    const doc = new HexDocument()
    if (bytes.length > 0) {
      const index = doc.sources.push(new MemoryByteSource(bytes)) - 1
      doc.pieces.push({ source: index, start: 0, length: bytes.length, dirty: false })
    }
    doc.rebuildOffsets()
    return doc
  }

  /** Creates a document of `size` bytes with the same value everywhere. */
  static filled(size: number, value = 0): HexDocument {
    const doc = new HexDocument()
    if (size > 0) {
      const index = doc.sources.push(new FillByteSource(size, value)) - 1
      doc.pieces.push({ source: index, start: 0, length: size, dirty: false })
    }
    doc.rebuildOffsets()
    return doc
  }

  /* ------------------------------------------------------------- state */

  get size(): number {
    return this.offsets[this.pieces.length] ?? 0
  }

  /** Bumped on every change - cheap way for the UI to detect staleness. */
  get version(): number {
    return this.revision
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoDepth(): number {
    return this.undoStack.length
  }

  get redoDepth(): number {
    return this.redoStack.length
  }

  get isModified(): boolean {
    return this.undoStack.length > 0
  }

  get pieceCount(): number {
    return this.pieces.length
  }

  get nextUndoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null
  }

  get nextRedoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null
  }

  /* -------------------------------------------------------------- read */

  /** Reads `length` bytes from `offset`, loading only the chunks involved. */
  async read(offset: number, length: number): Promise<Uint8Array> {
    const plan = this.plan(offset, length)
    if (plan.total === 0) return EMPTY
    const out = new Uint8Array(plan.total)
    await Promise.all(
      plan.segments.map(async (segment) => {
        const bytes = await this.sources[segment.source]!.read(segment.start, segment.length)
        out.set(bytes.subarray(0, segment.length), segment.target)
      }),
    )
    return out
  }

  /** Same as {@link read} but returns `null` when any byte needs disk access. */
  peek(offset: number, length: number): Uint8Array | null {
    const plan = this.plan(offset, length)
    if (plan.total === 0) return EMPTY
    const out = new Uint8Array(plan.total)
    for (const segment of plan.segments) {
      const bytes = this.sources[segment.source]!.peek(segment.start, segment.length)
      if (bytes === null) return null
      out.set(bytes.subarray(0, segment.length), segment.target)
    }
    return out
  }

  /** Reads bytes together with their "changed since open" flags. */
  async readFlagged(offset: number, length: number): Promise<FlaggedBytes> {
    const plan = this.plan(offset, length)
    if (plan.total === 0) return { bytes: EMPTY, dirty: EMPTY }
    const bytes = new Uint8Array(plan.total)
    const dirty = new Uint8Array(plan.total)
    await Promise.all(
      plan.segments.map(async (segment) => {
        const data = await this.sources[segment.source]!.read(segment.start, segment.length)
        bytes.set(data.subarray(0, segment.length), segment.target)
        if (segment.dirty) dirty.fill(1, segment.target, segment.target + segment.length)
      }),
    )
    return { bytes, dirty }
  }

  peekFlagged(offset: number, length: number): FlaggedBytes | null {
    const plan = this.plan(offset, length)
    if (plan.total === 0) return { bytes: EMPTY, dirty: EMPTY }
    const bytes = new Uint8Array(plan.total)
    const dirty = new Uint8Array(plan.total)
    for (const segment of plan.segments) {
      const data = this.sources[segment.source]!.peek(segment.start, segment.length)
      if (data === null) return null
      bytes.set(data.subarray(0, segment.length), segment.target)
      if (segment.dirty) dirty.fill(1, segment.target, segment.target + segment.length)
    }
    return { bytes, dirty }
  }

  async byteAt(offset: number): Promise<number | null> {
    if (offset < 0 || offset >= this.size) return null
    const bytes = await this.read(offset, 1)
    return bytes.length === 1 ? bytes[0]! : null
  }

  /* ------------------------------------------------------------- edits */

  /** The one primitive every other edit is built on. */
  replace(
    offset: number,
    deleteLength: number,
    insert: Uint8Array | Piece[],
    options: ReplaceOptions = {},
  ): void {
    const size = this.size
    const start = Math.max(0, Math.min(offset, size))
    const removeCount = Math.max(0, Math.min(deleteLength, size - start))
    const end = start + removeCount

    const newPieces = Array.isArray(insert) ? insert.filter((p) => p.length > 0) : this.store(insert)
    if (removeCount === 0 && newPieces.length === 0) return

    const first = this.pieceIndexAt(start)
    const last =
      removeCount > 0
        ? this.pieceIndexAt(end - 1) + 1
        : // A pure insert still has to split the piece it lands inside.
          first < this.pieces.length && start > this.offsets[first]!
          ? first + 1
          : first
    const removed = this.pieces.slice(first, last)

    const inserted: Piece[] = []
    const firstPiece = removed[0]
    if (firstPiece) {
      const headLength = start - this.offsets[first]!
      if (headLength > 0) {
        inserted.push({ ...firstPiece, length: headLength })
      }
    }
    inserted.push(...newPieces)
    const lastPiece = removed.at(-1)
    if (lastPiece) {
      const lastStart = this.offsets[last - 1]!
      const tailLength = lastStart + lastPiece.length - end
      if (tailLength > 0) {
        inserted.push({
          source: lastPiece.source,
          start: lastPiece.start + (end - lastStart),
          length: tailLength,
          dirty: lastPiece.dirty,
        })
      }
    }

    this.apply({ index: first, removed, inserted: mergePieces(inserted) }, options)
  }

  /** Replaces the bytes at `offset` in place, never changing the file size. */
  overwrite(offset: number, bytes: Uint8Array, options: ReplaceOptions = {}): void {
    const count = Math.min(bytes.length, Math.max(0, this.size - offset))
    const tail = bytes.subarray(count)
    const head = bytes.subarray(0, count)

    // Writing past the end grows the document, like every hex editor does -
    // but the two splices stay a single undo step.
    if (head.length > 0 && tail.length > 0) {
      this.transact(options.label ?? 'Overwrite', () => {
        this.replace(offset, count, head, { ...options, coalesceKey: null })
        this.replace(this.size, 0, tail, { ...options, coalesceKey: null })
      })
      return
    }
    if (tail.length > 0) {
      this.replace(this.size, 0, tail, { label: 'Append', ...options })
      return
    }
    this.replace(offset, count, head, { label: 'Overwrite', ...options })
  }

  insert(offset: number, bytes: Uint8Array, options: ReplaceOptions = {}): void {
    this.replace(offset, 0, bytes, { label: 'Insert', ...options })
  }

  remove(offset: number, length: number, options: ReplaceOptions = {}): void {
    this.replace(offset, length, EMPTY, { label: 'Delete', ...options })
  }

  /** Overwrites a range with one repeated byte without allocating it. */
  fill(offset: number, length: number, value: number, options: ReplaceOptions = {}): void {
    if (length <= 0) return
    const index = this.sources.push(new FillByteSource(length, value)) - 1
    const dirty = options.dirty ?? true
    this.replace(offset, length, [{ source: index, start: 0, length, dirty }], {
      label: 'Fill',
      ...options,
    })
  }

  /** Inserts a repeated byte, growing the document. */
  insertFill(offset: number, length: number, value: number, options: ReplaceOptions = {}): void {
    if (length <= 0) return
    const index = this.sources.push(new FillByteSource(length, value)) - 1
    const dirty = options.dirty ?? true
    this.replace(offset, 0, [{ source: index, start: 0, length, dirty }], {
      label: 'Insert fill',
      ...options,
    })
  }

  /**
   * Describes a range of another document as pieces of this one, so ranges can
   * be copied or merged between documents without materialising the bytes.
   */
  importRange(other: HexDocument, offset: number, length: number, dirty = true): Piece[] {
    const plan = other.plan(offset, length)
    return plan.segments.map((segment) => ({
      source: this.adoptSource(other.sources[segment.source]!),
      start: segment.start,
      length: segment.length,
      dirty,
    }))
  }

  /** Registers an external source (or reuses it) and returns its index. */
  adoptSource(source: ByteSource): number {
    const existing = this.sources.indexOf(source)
    return existing >= 0 ? existing : this.sources.push(source) - 1
  }

  appendPieces(pieces: Piece[], options: ReplaceOptions = {}): void {
    this.replace(this.size, 0, pieces, { label: 'Append', ...options })
  }

  /** Runs several edits as a single undo step. */
  transact(label: string, body: () => void): void {
    const before = this.undoStack.length
    body()
    const groups = this.undoStack.splice(before)
    if (groups.length === 0) return
    this.undoStack.push({
      edits: groups.flatMap((group) => group.edits),
      label,
      coalesceKey: null,
    })
  }

  undo(): boolean {
    const group = this.undoStack.pop()
    if (!group) return false
    for (let i = group.edits.length - 1; i >= 0; i--) {
      const edit = group.edits[i]!
      this.pieces.splice(edit.index, edit.inserted.length, ...edit.removed)
    }
    this.redoStack.push(group)
    this.rebuildOffsets()
    this.revision++
    return true
  }

  redo(): boolean {
    const group = this.redoStack.pop()
    if (!group) return false
    for (const edit of group.edits) {
      this.pieces.splice(edit.index, edit.removed.length, ...edit.inserted)
    }
    this.undoStack.push(group)
    this.rebuildOffsets()
    this.revision++
    return true
  }

  /** Drops the history - used after the document was written to disk. */
  markSaved(): void {
    this.undoStack = []
    this.redoStack = []
    this.pieces = this.pieces.map((piece) => ({ ...piece, dirty: false }))
    this.revision++
  }

  /** Points the document at the freshly written file and forgets the history. */
  rebase(blob: Blob): void {
    for (const source of this.sources) source.dispose()
    this.sources.length = 0
    // A fresh store: the previous one may still back another document.
    this.appendStore = new AppendStore()
    this.sources.push(this.appendStore)
    const index = this.sources.push(new FileByteSource(blob)) - 1
    this.pieces = blob.size > 0 ? [{ source: index, start: 0, length: blob.size, dirty: false }] : []
    this.undoStack = []
    this.redoStack = []
    this.rebuildOffsets()
    this.revision++
  }

  /* -------------------------------------------------------------- save */

  /** Blob parts for the whole document - file backed parts stay references. */
  blobParts(): BlobPart[] {
    const parts: BlobPart[] = []
    for (const piece of this.pieces) {
      parts.push(...this.sources[piece.source]!.blobParts(piece.start, piece.length))
    }
    return parts
  }

  /** Blob parts for a range, used by exports and the live preview. */
  rangeBlobParts(offset: number, length: number): BlobPart[] {
    const plan = this.plan(offset, length)
    return plan.segments.flatMap((segment) =>
      this.sources[segment.source]!.blobParts(segment.start, segment.length),
    )
  }

  toBlob(type = 'application/octet-stream'): Blob {
    return new Blob(this.blobParts(), { type })
  }

  rangeToBlob(offset: number, length: number, type = 'application/octet-stream'): Blob {
    return new Blob(this.rangeBlobParts(offset, length), { type })
  }

  dispose(): void {
    for (const source of this.sources) source.dispose()
    this.pieces = []
    this.offsets = [0]
    this.undoStack = []
    this.redoStack = []
  }

  /* ----------------------------------------------------------- internal */

  private store(bytes: Uint8Array): Piece[] {
    if (bytes.length === 0) return []
    const start = this.appendStore.append(bytes)
    return [{ source: 0, start, length: bytes.length, dirty: true }]
  }

  private apply(edit: Edit, options: ReplaceOptions): void {
    this.pieces.splice(edit.index, edit.removed.length, ...edit.inserted)
    this.rebuildOffsets()
    this.revision++

    const coalesceKey = options.coalesceKey ?? null
    const top = this.undoStack.at(-1)
    if (coalesceKey !== null && top && top.coalesceKey === coalesceKey) {
      top.edits.push(edit)
    } else {
      this.undoStack.push({ edits: [edit], label: options.label ?? 'Edit', coalesceKey })
    }
    this.redoStack = []
  }

  private rebuildOffsets(): void {
    const offsets = new Array<number>(this.pieces.length + 1)
    let total = 0
    for (let i = 0; i < this.pieces.length; i++) {
      offsets[i] = total
      total += this.pieces[i]!.length
    }
    offsets[this.pieces.length] = total
    this.offsets = offsets
  }

  /** Index of the piece containing `offset` (`pieces.length` at end of file). */
  private pieceIndexAt(offset: number): number {
    if (this.pieces.length === 0 || offset >= this.size) return this.pieces.length
    let low = 0
    let high = this.pieces.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (this.offsets[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low
  }

  /** Maps a document range onto source reads. */
  private plan(
    offset: number,
    length: number,
  ): {
    total: number
    segments: Array<{
      source: number
      start: number
      length: number
      target: number
      dirty: boolean
    }>
  } {
    const size = this.size
    const start = Math.max(0, Math.min(offset, size))
    const total = Math.max(0, Math.min(offset + length, size) - start)
    const segments: Array<{
      source: number
      start: number
      length: number
      target: number
      dirty: boolean
    }> = []
    if (total === 0) return { total: 0, segments }

    let index = this.pieceIndexAt(start)
    let cursor = start
    while (cursor < start + total && index < this.pieces.length) {
      const piece = this.pieces[index]!
      const pieceStart = this.offsets[index]!
      const within = cursor - pieceStart
      const take = Math.min(piece.length - within, start + total - cursor)
      segments.push({
        source: piece.source,
        start: piece.start + within,
        length: take,
        target: cursor - start,
        dirty: piece.dirty,
      })
      cursor += take
      index++
    }
    return { total, segments }
  }
}

/** Collapses pieces that are contiguous in the same source. */
function mergePieces(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  for (const piece of pieces) {
    if (piece.length === 0) continue
    const previous = out.at(-1)
    if (
      previous &&
      previous.source === piece.source &&
      previous.dirty === piece.dirty &&
      previous.start + previous.length === piece.start
    ) {
      previous.length += piece.length
    } else {
      out.push({ ...piece })
    }
  }
  return out
}
