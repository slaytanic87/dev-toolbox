/**
 * Reactive state for the hex editor: open documents (tabs), caret, multiple
 * selections, bookmarks, editing commands and the save paths.
 *
 * The `HexDocument` instances are kept raw on purpose - they are large,
 * mutable data structures and Vue must not proxy them. Every command bumps the
 * tab's `version`, which is what the UI watches.
 */

import { computed, markRaw, ref, type Ref } from 'vue'

import { HexDocument } from '@/lib/hex/document'
import { encodeChar } from '@/lib/hex/encodings'
import { usePersistentState } from './usePersistentState'

export interface Selection {
  /** Inclusive. */
  start: number
  /** Exclusive. */
  end: number
}

export interface Bookmark {
  offset: number
  label: string
}

export type EditorPane = 'hex' | 'text'
export type EditMode = 'overwrite' | 'insert'
export type InsertMode = 'insert' | 'overwrite'

export interface RecordInfo {
  format: 'intel-hex' | 'srec'
  baseAddress: number
  startAddress: number | null
  segments: number
  header: string | null
}

export interface HexTab {
  id: string
  name: string
  doc: HexDocument
  /** Set when the file was opened through the File System Access API. */
  handle: FileHandleLike | null
  origin: 'file' | 'memory' | 'records' | 'merge'
  /** Mirrors `doc.size` so templates stay reactive. */
  size: number
  version: number
  modified: boolean
  caret: number
  nibble: number
  pane: EditorPane
  selections: Selection[]
  anchor: number | null
  bookmarks: Bookmark[]
  matches: number[]
  matchLength: number
  recordInfo: RecordInfo | null
  scrollTop: number
  /** Offset the caret should be scrolled to, bumped to re-trigger. */
  revealRequest: number
}

export interface ViewSettings {
  bytesPerRow: number
  /** `0` lets the grid fit as many columns as the width allows. */
  autoWidth: boolean
  groupSize: number
  offsetBase: 'hex' | 'dec' | 'oct'
  offsetDigits: number
  uppercase: boolean
  encoding: string
  placeholder: string
  showText: boolean
  showOffsets: boolean
  highlightModified: boolean
  fontSize: number
  theme: 'default' | 'contrast' | 'amber' | 'mono'
}

/** Minimal shape of a File System Access handle - avoids a DOM lib dependency. */
export interface FileHandleLike {
  name: string
  getFile(): Promise<File>
  createWritable(options?: { keepExistingData?: boolean }): Promise<{
    write(data: BlobPart): Promise<void>
    close(): Promise<void>
  }>
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface PickerWindow {
  showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileHandleLike[]>
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileHandleLike>
}

/** Largest range the clipboard and the one-shot exports will materialise. */
export const MAX_MATERIALISE = 64 << 20

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

let tabCounter = 0

export function createHexWorkspace() {
  const tabs = ref<HexTab[]>([]) as Ref<HexTab[]>
  const activeId = ref<string | null>(null)
  const mode = usePersistentState<EditMode>('hex:mode', 'overwrite')
  const view = usePersistentState<ViewSettings>('hex:view', {
    bytesPerRow: 16,
    autoWidth: false,
    groupSize: 8,
    offsetBase: 'hex',
    offsetDigits: 8,
    uppercase: true,
    encoding: 'latin1',
    placeholder: '.',
    showText: true,
    showOffsets: true,
    highlightModified: true,
    fontSize: 13,
    theme: 'default',
  })

  const active = computed<HexTab | null>(
    () => tabs.value.find((tab) => tab.id === activeId.value) ?? null,
  )

  /* ------------------------------------------------------------- tabs */

  function createTab(
    name: string,
    doc: HexDocument,
    origin: HexTab['origin'],
    handle: FileHandleLike | null = null,
  ): HexTab {
    const tab: HexTab = {
      id: `tab-${++tabCounter}`,
      name,
      doc: markRaw(doc),
      handle: handle ? markRaw(handle) : null,
      origin,
      size: doc.size,
      version: 0,
      modified: false,
      caret: 0,
      nibble: 0,
      pane: 'hex',
      selections: [],
      anchor: null,
      bookmarks: [],
      matches: [],
      matchLength: 0,
      recordInfo: null,
      scrollTop: 0,
      revealRequest: 0,
    }
    tabs.value.push(tab)
    activeId.value = tab.id
    // Hand out the reactive proxy, never the raw object.
    return tabs.value.at(-1)!
  }

  function openBlob(name: string, blob: Blob, handle: FileHandleLike | null = null): HexTab {
    return createTab(name, HexDocument.fromBlob(blob), 'file', handle)
  }

  function openBytes(name: string, bytes: Uint8Array, origin: HexTab['origin'] = 'memory'): HexTab {
    return createTab(name, HexDocument.fromBytes(bytes), origin)
  }

  function newDocument(size: number, fill: number): HexTab {
    return createTab(
      `untitled-${tabs.value.length + 1}.bin`,
      size > 0 ? HexDocument.filled(size, fill) : HexDocument.fromBytes(new Uint8Array(0)),
      'memory',
    )
  }

  function closeTab(id: string): void {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index < 0) return
    tabs.value[index]!.doc.dispose()
    const next = tabs.value.filter((tab) => tab.id !== id)
    tabs.value = next
    if (activeId.value === id) {
      activeId.value = next[Math.min(index, next.length - 1)]?.id ?? null
    }
  }

  function activate(id: string): void {
    activeId.value = id
  }

  function touch(tab: HexTab): void {
    tab.size = tab.doc.size
    tab.version = tab.doc.version
    tab.modified = tab.doc.isModified
    tab.caret = clamp(tab.caret, 0, tab.size)
    tab.selections = tab.selections
      .map((range) => ({
        start: clamp(range.start, 0, tab.size),
        end: clamp(range.end, 0, tab.size),
      }))
      .filter((range) => range.end > range.start)
    tab.matches = []
  }

  /* -------------------------------------------------------- selection */

  function setCaret(
    tab: HexTab,
    offset: number,
    options: { extend?: boolean; add?: boolean; pane?: EditorPane; nibble?: number } = {},
  ): void {
    const target = clamp(offset, 0, tab.size)
    if (options.pane) tab.pane = options.pane
    tab.nibble = options.nibble ?? 0

    if (options.extend && tab.anchor !== null) {
      const start = Math.min(tab.anchor, target)
      // The byte under the caret belongs to the selection.
      const end = Math.min(Math.max(tab.anchor, target) + 1, Math.max(tab.size, 1))
      // Extending replaces the range that grew out of the anchor and keeps the
      // other ranges of a multi selection intact.
      const base = options.add ? withoutRangeAt(tab.selections, tab.anchor) : []
      tab.selections = normalise([...base, { start, end }])
    } else {
      tab.anchor = target
      if (!options.add) tab.selections = []
    }

    tab.caret = target
    tab.revealRequest++
  }

  function selectRange(tab: HexTab, start: number, end: number, add = false): void {
    const range = {
      start: clamp(Math.min(start, end), 0, tab.size),
      end: clamp(Math.max(start, end), 0, tab.size),
    }
    if (range.end <= range.start) return
    const base = add ? withoutRangeAt(tab.selections, tab.anchor ?? range.start) : []
    tab.selections = normalise([...base, range])
    tab.anchor = range.start
    tab.caret = range.start
    tab.revealRequest++
  }

  function selectAll(tab: HexTab): void {
    selectRange(tab, 0, tab.size)
  }

  function clearSelection(tab: HexTab): void {
    tab.selections = []
  }

  /** Total number of selected bytes. */
  function selectionSize(tab: HexTab): number {
    return tab.selections.reduce((sum, range) => sum + (range.end - range.start), 0)
  }

  /** The range commands operate on: the selection, or the byte at the caret. */
  function effectiveRange(tab: HexTab): Selection {
    const first = tab.selections[0]
    if (first) {
      const last = tab.selections.at(-1)!
      return { start: first.start, end: last.end }
    }
    return { start: tab.caret, end: Math.min(tab.caret + 1, tab.size) }
  }

  /* ------------------------------------------------------------ edits */

  function deleteSelection(tab: HexTab): boolean {
    if (tab.selections.length === 0) return false
    const ranges = [...tab.selections].sort((a, b) => b.start - a.start)
    const caret = tab.selections[0]!.start
    tab.doc.transact('Delete selection', () => {
      for (const range of ranges) tab.doc.remove(range.start, range.end - range.start)
    })
    tab.selections = []
    tab.caret = caret
    tab.nibble = 0
    touch(tab)
    return true
  }

  /**
   * Types one hex digit. `currentByte` is the value the grid shows at the
   * caret, which keeps the edit synchronous even when the chunk cache was
   * evicted in the meantime.
   */
  function typeHexDigit(tab: HexTab, digit: number, currentByte: number): void {
    deleteSelection(tab)
    const offset = tab.caret

    if (mode.value === 'insert' || offset >= tab.size) {
      if (tab.nibble === 0) {
        tab.doc.insert(offset, new Uint8Array([digit << 4]), { coalesceKey: `type:${offset}` })
        tab.nibble = 1
      } else {
        tab.doc.overwrite(offset, new Uint8Array([((currentByte & 0xf0) | digit) & 0xff]), {
          coalesceKey: `type:${offset}`,
        })
        tab.caret = offset + 1
        tab.nibble = 0
      }
      touch(tab)
      return
    }

    const value =
      tab.nibble === 0 ? (digit << 4) | (currentByte & 0x0f) : (currentByte & 0xf0) | digit
    tab.doc.overwrite(offset, new Uint8Array([value & 0xff]), { coalesceKey: `type:${offset}` })
    if (tab.nibble === 0) {
      tab.nibble = 1
    } else {
      tab.caret = offset + 1
      tab.nibble = 0
    }
    touch(tab)
  }

  function typeChar(tab: HexTab, char: string, encoding: string): boolean {
    const bytes = encodeChar(char, encoding)
    if (!bytes) return false
    deleteSelection(tab)
    const offset = tab.caret
    if (mode.value === 'insert' || offset >= tab.size) tab.doc.insert(offset, bytes)
    else tab.doc.overwrite(offset, bytes)
    tab.caret = offset + bytes.length
    tab.nibble = 0
    touch(tab)
    return true
  }

  function insertBytes(tab: HexTab, bytes: Uint8Array, how: InsertMode): void {
    if (bytes.length === 0) return
    deleteSelection(tab)
    const offset = tab.caret
    if (how === 'insert') tab.doc.insert(offset, bytes)
    else tab.doc.overwrite(offset, bytes)
    tab.caret = offset + bytes.length
    tab.nibble = 0
    touch(tab)
  }

  /** Writes bytes at a fixed offset, independent of the caret and the mode. */
  function overwriteAt(tab: HexTab, offset: number, bytes: Uint8Array, label = 'Overwrite'): void {
    if (bytes.length === 0) return
    tab.doc.overwrite(offset, bytes, { label })
    touch(tab)
  }

  function fillRange(tab: HexTab, start: number, length: number, value: number): void {
    if (length <= 0) return
    tab.doc.fill(start, length, value)
    touch(tab)
  }

  function insertFill(tab: HexTab, offset: number, length: number, value: number): void {
    if (length <= 0) return
    tab.doc.insertFill(offset, length, value)
    tab.caret = offset + length
    touch(tab)
  }

  function removeRange(tab: HexTab, start: number, length: number): void {
    if (length <= 0) return
    tab.doc.remove(start, length)
    tab.caret = start
    touch(tab)
  }

  function backspace(tab: HexTab): void {
    if (deleteSelection(tab)) return
    if (tab.nibble === 1) {
      tab.nibble = 0
      return
    }
    if (tab.caret === 0) return
    if (mode.value === 'insert') {
      tab.doc.remove(tab.caret - 1, 1)
      tab.caret--
      touch(tab)
    } else {
      setCaret(tab, tab.caret - 1)
    }
  }

  function forwardDelete(tab: HexTab): void {
    if (deleteSelection(tab)) return
    if (mode.value === 'insert') {
      if (tab.caret >= tab.size) return
      tab.doc.remove(tab.caret, 1)
      touch(tab)
    } else {
      setCaret(tab, Math.min(tab.caret + 1, tab.size))
    }
  }

  function undo(tab: HexTab): boolean {
    const done = tab.doc.undo()
    if (done) touch(tab)
    return done
  }

  function redo(tab: HexTab): boolean {
    const done = tab.doc.redo()
    if (done) touch(tab)
    return done
  }

  /* -------------------------------------------------------- bookmarks */

  function toggleBookmark(tab: HexTab, offset: number, label?: string): void {
    const existing = tab.bookmarks.findIndex((bookmark) => bookmark.offset === offset)
    if (existing >= 0) tab.bookmarks = tab.bookmarks.filter((_, index) => index !== existing)
    else {
      tab.bookmarks = [
        ...tab.bookmarks,
        { offset, label: label ?? `0x${offset.toString(16).toUpperCase()}` },
      ].sort((a, b) => a.offset - b.offset)
    }
  }

  function removeBookmark(tab: HexTab, offset: number): void {
    tab.bookmarks = tab.bookmarks.filter((bookmark) => bookmark.offset !== offset)
  }

  /* ------------------------------------------------------------- save */

  async function readRange(tab: HexTab, start: number, length: number): Promise<Uint8Array> {
    return tab.doc.read(start, Math.min(length, MAX_MATERIALISE))
  }

  /** Writes back through the handle the file was opened with. */
  async function saveInPlace(tab: HexTab): Promise<void> {
    if (!tab.handle) throw new Error('This document is not connected to a file on disk.')
    const permission = await tab.handle.requestPermission?.({ mode: 'readwrite' })
    if (permission && permission !== 'granted') {
      throw new Error('Write permission for the file was denied.')
    }
    const writable = await tab.handle.createWritable()
    try {
      for (const part of tab.doc.blobParts()) await writable.write(part)
    } finally {
      await writable.close()
    }
    // The old File object points at data that has just been replaced.
    const file = await tab.handle.getFile()
    tab.doc.rebase(file)
    tab.name = file.name
    touch(tab)
  }

  /** Asks for a target file and streams the document into it. */
  async function saveAs(tab: HexTab): Promise<'handle' | 'download'> {
    const picker = (window as unknown as PickerWindow).showSaveFilePicker
    if (picker) {
      const handle = await picker({
        suggestedName: tab.name,
        types: [
          {
            description: 'Binary file',
            accept: { 'application/octet-stream': ['.bin', '.dat', '.img', '.hex'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      try {
        for (const part of tab.doc.blobParts()) await writable.write(part)
      } finally {
        await writable.close()
      }
      tab.handle = markRaw(handle)
      tab.name = handle.name
      tab.doc.rebase(await handle.getFile())
      touch(tab)
      return 'handle'
    }
    return 'download'
  }

  async function openWithPicker(): Promise<Array<{ file: File; handle: FileHandleLike }>> {
    const picker = (window as unknown as PickerWindow).showOpenFilePicker
    if (!picker) return []
    const handles = await picker({ multiple: true })
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })))
  }

  return {
    tabs,
    activeId,
    active,
    mode,
    view,
    createTab,
    openBlob,
    openBytes,
    newDocument,
    closeTab,
    activate,
    touch,
    setCaret,
    selectRange,
    selectAll,
    clearSelection,
    selectionSize,
    effectiveRange,
    deleteSelection,
    typeHexDigit,
    typeChar,
    insertBytes,
    overwriteAt,
    fillRange,
    insertFill,
    removeRange,
    backspace,
    forwardDelete,
    undo,
    redo,
    toggleBookmark,
    removeBookmark,
    readRange,
    saveInPlace,
    saveAs,
    openWithPicker,
  }
}

export type HexWorkspace = ReturnType<typeof createHexWorkspace>

/* ------------------------------------------------------------- helpers ---- */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** Drops the range that contains `offset` - used while re-extending it. */
function withoutRangeAt(ranges: Selection[], offset: number): Selection[] {
  return ranges.filter((range) => offset < range.start || offset >= range.end)
}

/** Sorts selections and merges the ones that touch or overlap. */
export function normalise(ranges: Selection[]): Selection[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Selection[] = []
  for (const range of sorted) {
    const previous = out.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      out.push({ ...range })
    }
  }
  return out
}

/** `true` when `offset` falls into any of the ranges. */
export function inSelection(ranges: Selection[], offset: number): boolean {
  for (const range of ranges) {
    if (offset >= range.start && offset < range.end) return true
    if (range.start > offset) break
  }
  return false
}

export function formatOffset(offset: number, settings: ViewSettings): string {
  const radix = settings.offsetBase === 'hex' ? 16 : settings.offsetBase === 'oct' ? 8 : 10
  const text = offset.toString(radix).padStart(settings.offsetDigits, '0')
  return settings.uppercase && radix === 16 ? text.toUpperCase() : text
}

export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`
}
