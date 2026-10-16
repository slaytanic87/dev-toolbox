<script setup lang="ts">
/**
 * The hex grid.
 *
 * Only the rows that are currently visible exist in the DOM and only their
 * bytes are read from the document, so the grid is just as fast on a 100 GiB
 * image as on a 100 byte file. Browsers cap an element's height at a few
 * million pixels, which is less than one row per byte for huge files, so the
 * scroll position is mapped onto the row range instead of being used directly
 * as soon as the virtual content exceeds that cap.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import { decodeRow, displayChar } from '@/lib/hex/encodings'
import {
  clamp,
  formatOffset,
  inSelection,
  type EditorPane,
  type HexTab,
  type HexWorkspace,
} from '@/composables/useHexEditor'

const props = defineProps<{
  workspace: HexWorkspace
  tab: HexTab
}>()

const emit = defineEmits<{
  command: [name: string, event: KeyboardEvent]
  paste: [text: string]
}>()

/** Browsers refuse to scroll elements that are taller than this. */
const MAX_SCROLL_HEIGHT = 15_000_000
const OVERSCAN = 4

interface GridRow {
  offset: number
  bytes: Uint8Array
  dirty: Uint8Array
  chars: string[]
}

const viewport = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
const rows = shallowRef<GridRow[]>([])
const scrollTop = ref(0)
const viewportHeight = ref(400)
const viewportWidth = ref(800)
const charWidth = ref(8)
const focused = ref(false)

const view = computed(() => props.workspace.view.value)
const size = computed(() => props.tab.size)
const rowHeight = computed(() => Math.max(14, Math.round(view.value.fontSize * 1.6)))

const bytesPerRow = computed(() => {
  if (!view.value.autoWidth) return clamp(view.value.bytesPerRow, 1, 128)
  const offsetColumns = view.value.showOffsets ? view.value.offsetDigits + 2 : 0
  const group = view.value.groupSize > 0 ? 0.6 / view.value.groupSize : 0
  const perByte = 2.6 + group + (view.value.showText ? 1.1 : 0)
  const available = viewportWidth.value / charWidth.value - offsetColumns - 6
  const columns = Math.floor(available / perByte)
  return clamp(Math.floor(columns / 4) * 4, 4, 64)
})

/** One extra row so the caret can sit behind the last byte. */
const totalRows = computed(() => Math.floor(size.value / bytesPerRow.value) + 1)
const visibleRows = computed(() => Math.max(1, Math.ceil(viewportHeight.value / rowHeight.value)))
const maxFirstRow = computed(() => Math.max(0, totalRows.value - visibleRows.value + 1))
const contentHeight = computed(() => totalRows.value * rowHeight.value)
const spacerHeight = computed(() => Math.min(contentHeight.value, MAX_SCROLL_HEIGHT))
const scaled = computed(() => contentHeight.value > MAX_SCROLL_HEIGHT)
const scrollRange = computed(() => Math.max(1, spacerHeight.value - viewportHeight.value))

/**
 * The first visible row is state, not a derivative of `scrollTop`: once the
 * virtual content is taller than the browser's limit one pixel of scrollbar
 * covers many rows, and deriving the row from the pixel would make the last
 * rows of a huge file unreachable. Scrolling updates the row, the row updates
 * the scrollbar - and in that mode the wheel moves whole rows.
 */
const firstRow = ref(0)

const offsetY = computed(() =>
  scaled.value ? scrollTop.value : firstRow.value * rowHeight.value,
)

/** `true` while we move the scrollbar ourselves, so the sync does not fight back. */
let selfScroll = false

function setFirstRow(row: number): void {
  const target = clamp(Math.round(row), 0, maxFirstRow.value)
  firstRow.value = target
  const element = viewport.value
  if (!element) return
  const pixels = scaled.value
    ? (target / Math.max(1, maxFirstRow.value)) * scrollRange.value
    : target * rowHeight.value
  if (Math.abs(element.scrollTop - pixels) >= 1) {
    selfScroll = true
    element.scrollTop = pixels
  }
  scrollTop.value = element.scrollTop
}

function syncFromScroll(): void {
  const element = viewport.value
  if (!element) return
  scrollTop.value = element.scrollTop
  props.tab.scrollTop = element.scrollTop
  if (selfScroll) {
    selfScroll = false
    return
  }
  firstRow.value = scaled.value
    ? Math.round(clamp(scrollTop.value / scrollRange.value, 0, 1) * maxFirstRow.value)
    : clamp(Math.floor(scrollTop.value / rowHeight.value), 0, maxFirstRow.value)
}

/** In the scaled mode a wheel tick must move rows, not pixels. */
function onWheel(event: WheelEvent): void {
  if (!scaled.value || event.ctrlKey) return
  event.preventDefault()
  const step = event.deltaMode === 1 ? event.deltaY * 3 : event.deltaY / rowHeight.value
  const rows = step > 0 ? Math.max(1, Math.round(step)) : Math.min(-1, Math.round(step))
  setFirstRow(firstRow.value + rows)
}

const columns = computed(() => Array.from({ length: bytesPerRow.value }, (_, index) => index))

/* ------------------------------------------------------------- loading */

let loadToken = 0

async function loadRows(): Promise<void> {
  const perRow = bytesPerRow.value
  const start = firstRow.value * perRow
  const count = visibleRows.value + OVERSCAN
  const length = count * perRow
  const doc = props.tab.doc
  // Taken before the fast path as well, so a cached read cannot be overtaken
  // by an older request that is still in flight.
  const token = ++loadToken

  const peeked = doc.peekFlagged(start, length)
  if (peeked) {
    rows.value = buildRows(start, peeked.bytes, peeked.dirty, count)
    return
  }

  const data = await doc.readFlagged(start, length)
  if (token !== loadToken) return
  rows.value = buildRows(start, data.bytes, data.dirty, count)
}

function buildRows(start: number, bytes: Uint8Array, dirty: Uint8Array, count: number): GridRow[] {
  const perRow = bytesPerRow.value
  const out: GridRow[] = []
  for (let index = 0; index < count; index++) {
    const offset = start + index * perRow
    if (offset > size.value) break
    const from = index * perRow
    const rowBytes = bytes.subarray(from, Math.min(from + perRow, bytes.length))
    out.push({
      offset,
      bytes: rowBytes,
      dirty: dirty.subarray(from, from + rowBytes.length),
      chars: view.value.showText ? decodeRow(rowBytes, view.value.encoding) : [],
    })
  }
  return out
}

watch(
  () => [
    firstRow.value,
    visibleRows.value,
    bytesPerRow.value,
    props.tab.id,
    props.tab.version,
    props.tab.size,
    view.value.encoding,
    view.value.showText,
  ],
  () => void loadRows(),
  { immediate: true },
)

/* -------------------------------------------------------------- layout */

function measure(): void {
  const element = viewport.value
  if (element) {
    viewportHeight.value = element.clientHeight
    viewportWidth.value = element.clientWidth
  }
  const sample = probe.value
  if (sample && sample.offsetWidth > 0) charWidth.value = sample.offsetWidth / 20
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  observer = new ResizeObserver(() => measure())
  if (viewport.value) observer.observe(viewport.value)
  if (probe.value) observer.observe(probe.value)
  void document.fonts?.ready.then(() => measure())
  restoreScroll()
})

onBeforeUnmount(() => observer?.disconnect())

watch(() => view.value.fontSize, () => nextTick(measure))

watch([maxFirstRow, bytesPerRow], () => {
  if (firstRow.value > maxFirstRow.value) setFirstRow(maxFirstRow.value)
})

watch(
  () => props.tab.id,
  () => {
    restoreScroll()
    void loadRows()
  },
)

function restoreScroll(): void {
  const element = viewport.value
  if (!element) return
  selfScroll = true
  element.scrollTop = props.tab.scrollTop
  scrollTop.value = element.scrollTop
  firstRow.value = clamp(
    scaled.value
      ? Math.round(clamp(scrollTop.value / scrollRange.value, 0, 1) * maxFirstRow.value)
      : Math.floor(scrollTop.value / rowHeight.value),
    0,
    maxFirstRow.value,
  )
}

/* ------------------------------------------------------------ revealing */

function rowOf(offset: number): number {
  return Math.floor(offset / bytesPerRow.value)
}

function scrollToRow(row: number): void {
  setFirstRow(row)
}

function reveal(offset: number): void {
  const row = rowOf(offset)
  const last = firstRow.value + visibleRows.value - 2
  if (row >= firstRow.value && row <= last) return
  // A jump across the file centres the target, a step just nudges the window.
  if (row < firstRow.value - visibleRows.value || row > last + visibleRows.value) {
    scrollToRow(row - Math.floor(visibleRows.value / 2))
  } else if (row < firstRow.value) {
    scrollToRow(row)
  } else {
    scrollToRow(row - visibleRows.value + 2)
  }
}

watch(
  () => props.tab.revealRequest,
  () => reveal(props.tab.caret),
)

defineExpose({ scrollToOffset: (offset: number) => scrollToRow(rowOf(offset)), focus })

/* ------------------------------------------------------------- pointer */

let dragging = false
let dragAdditive = false

function cellFromEvent(
  event: PointerEvent | MouseEvent,
  byPosition = false,
): { offset: number; pane: EditorPane; nibble: number } | null {
  const target = byPosition
    ? document.elementFromPoint(event.clientX, event.clientY)
    : (event.target as HTMLElement | null)
  const element = (target as HTMLElement | null)?.closest<HTMLElement>('[data-offset]')
  if (!element) return null
  const offset = Number(element.dataset.offset)
  if (!Number.isFinite(offset)) return null
  const pane = (element.dataset.pane as EditorPane) ?? 'hex'
  const rect = element.getBoundingClientRect()
  const nibble = pane === 'hex' && event.clientX - rect.left > rect.width / 2 ? 1 : 0
  return { offset, pane, nibble }
}

function onPointerDown(event: PointerEvent): void {
  const cell = cellFromEvent(event)
  focus()
  if (!cell) return
  event.preventDefault()
  props.workspace.setCaret(props.tab, cell.offset, {
    extend: event.shiftKey,
    add: event.ctrlKey || event.metaKey,
    pane: cell.pane,
    nibble: cell.nibble,
  })
  dragging = true
  dragAdditive = event.ctrlKey || event.metaKey
  viewport.value?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return
  const cell = cellFromEvent(event, true)
  if (!cell) return
  const anchor = props.tab.anchor ?? props.tab.caret
  props.workspace.selectRange(
    props.tab,
    Math.min(anchor, cell.offset),
    Math.max(anchor, cell.offset) + 1,
    dragAdditive,
  )
  props.tab.caret = cell.offset
  props.tab.anchor = anchor
}

function onPointerUp(): void {
  dragging = false
}

function onDoubleClick(event: MouseEvent): void {
  const cell = cellFromEvent(event)
  if (!cell) return
  // Select the group the byte belongs to.
  const group = Math.max(1, view.value.groupSize)
  const start = Math.floor(cell.offset / group) * group
  props.workspace.selectRange(props.tab, start, Math.min(start + group, size.value))
}

/* ------------------------------------------------------------ keyboard */

/** The byte under the caret, or `null` when it is not loaded right now. */
const byteAtCaret = computed<number | null>(() => {
  const caret = props.tab.caret
  for (const row of rows.value) {
    if (caret >= row.offset && caret < row.offset + row.bytes.length) {
      return row.bytes[caret - row.offset] ?? null
    }
  }
  const peeked = props.tab.doc.peek(caret, 1)
  return peeked && peeked.length === 1 ? peeked[0]! : null
})

/** Types a nibble, fetching the current byte first if it is not in reach. */
async function typeNibble(digit: number): Promise<void> {
  const tab = props.tab
  const offset = tab.caret
  let current = byteAtCaret.value
  if (current === null) {
    current = (await tab.doc.byteAt(offset)) ?? 0
    // The caret moved while we were reading - drop the keystroke rather than
    // writing the digit into the wrong byte.
    if (tab.caret !== offset) return
  }
  props.workspace.typeHexDigit(tab, digit, current)
  reveal(tab.caret)
}

function moveCaret(delta: number, event: KeyboardEvent): void {
  const target = clamp(props.tab.caret + delta, 0, size.value)
  props.workspace.setCaret(props.tab, target, { extend: event.shiftKey, pane: props.tab.pane })
}

function onKeyDown(event: KeyboardEvent): void {
  const tab = props.tab
  const workspace = props.workspace
  const perRow = bytesPerRow.value

  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'a') {
      event.preventDefault()
      workspace.selectAll(tab)
      return
    }
    if (['c', 'x', 'z', 'y', 'f', 'g', 's', 'b', 'e', 'd'].includes(key)) {
      event.preventDefault()
      emit('command', key, event)
      return
    }
    if (key === 'home' || key === 'end') {
      event.preventDefault()
      workspace.setCaret(tab, key === 'home' ? 0 : size.value, { extend: event.shiftKey })
      return
    }
    return
  }

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      moveCaret(-1, event)
      return
    case 'ArrowRight':
      event.preventDefault()
      moveCaret(1, event)
      return
    case 'ArrowUp':
      event.preventDefault()
      moveCaret(-perRow, event)
      return
    case 'ArrowDown':
      event.preventDefault()
      moveCaret(perRow, event)
      return
    case 'PageUp':
      event.preventDefault()
      moveCaret(-perRow * visibleRows.value, event)
      return
    case 'PageDown':
      event.preventDefault()
      moveCaret(perRow * visibleRows.value, event)
      return
    case 'Home':
      event.preventDefault()
      moveCaret(-(tab.caret % perRow), event)
      return
    case 'End':
      event.preventDefault()
      moveCaret(perRow - 1 - (tab.caret % perRow), event)
      return
    case 'Tab':
      event.preventDefault()
      workspace.setCaret(tab, tab.caret, { pane: tab.pane === 'hex' ? 'text' : 'hex' })
      return
    case 'Insert':
      event.preventDefault()
      workspace.mode.value = workspace.mode.value === 'insert' ? 'overwrite' : 'insert'
      return
    case 'Escape':
      event.preventDefault()
      workspace.clearSelection(tab)
      return
    case 'Backspace':
      event.preventDefault()
      workspace.backspace(tab)
      return
    case 'Delete':
      event.preventDefault()
      workspace.forwardDelete(tab)
      return
    default:
      break
  }

  if (event.altKey || event.key.length !== 1) return

  if (tab.pane === 'hex') {
    if (!/^[0-9a-fA-F]$/.test(event.key)) return
    event.preventDefault()
    void typeNibble(Number.parseInt(event.key, 16))
    return
  }

  event.preventDefault()
  if (!workspace.typeChar(tab, event.key, view.value.encoding)) {
    emit('command', 'encoding-error', event)
    return
  }
  reveal(tab.caret)
}

function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text') ?? ''
  if (text === '') return
  event.preventDefault()
  emit('paste', text)
}

function focus(): void {
  viewport.value?.focus()
}

/* -------------------------------------------------------------- styling */

function hexOf(byte: number): string {
  const text = byte.toString(16).padStart(2, '0')
  return view.value.uppercase ? text.toUpperCase() : text
}

const bookmarkOffsets = computed(() => new Set(props.tab.bookmarks.map((item) => item.offset)))

const matchRanges = computed(() => {
  const length = Math.max(1, props.tab.matchLength)
  return props.tab.matches.map((start) => ({ start, end: start + length }))
})

function cellState(offset: number, dirty: boolean): string {
  const tab = props.tab
  const classes: string[] = []
  if (offset === tab.caret) classes.push('is-caret', `is-nibble-${tab.nibble}`)
  if (inSelection(tab.selections, offset)) classes.push('is-selected')
  if (matchRanges.value.length > 0 && inSelection(matchRanges.value, offset)) classes.push('is-match')
  if (bookmarkOffsets.value.has(offset)) classes.push('is-bookmark')
  if (dirty && view.value.highlightModified) classes.push('is-dirty')
  return classes.join(' ')
}

function groupEnd(index: number): boolean {
  const group = view.value.groupSize
  return group > 0 && (index + 1) % group === 0 && index + 1 < bytesPerRow.value
}
</script>

<template>
  <div
    class="grid"
    :class="[`grid--${view.theme}`, { 'is-focused': focused }]"
    :style="{
      '--hex-font-size': `${view.fontSize}px`,
      '--hex-row-height': `${rowHeight}px`,
      '--hex-offset-width': `${view.offsetDigits + 2}ch`,
    }"
  >
    <header v-if="view.showOffsets" class="grid__head">
      <span class="grid__head-offset">offset</span>
      <span class="grid__head-cells">
        <span
          v-for="column in columns"
          :key="column"
          class="grid__head-cell"
          :class="{ 'is-group-end': groupEnd(column) }"
        >{{ (column % 256).toString(16).padStart(2, '0').toUpperCase() }}</span>
      </span>
      <span v-if="view.showText" class="grid__head-text">{{ view.encoding }}</span>
    </header>

    <div
      ref="viewport"
      class="grid__viewport"
      tabindex="0"
      role="grid"
      :aria-rowcount="totalRows"
      @scroll.passive="syncFromScroll"
      @wheel="onWheel"
      @keydown="onKeyDown"
      @paste="onPaste"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="onDoubleClick"
      @focus="focused = true"
      @blur="focused = false"
    >
      <div class="grid__spacer" :style="{ height: `${spacerHeight}px` }">
        <div class="grid__rows" :style="{ transform: `translateY(${offsetY}px)` }">
          <div v-for="row in rows" :key="row.offset" class="row">
            <span v-if="view.showOffsets" class="row__offset">{{
              formatOffset(row.offset, view)
            }}</span>

            <span class="row__hex">
              <span
                v-for="(column, index) in columns"
                :key="column"
                class="cell"
                :class="[
                  cellState(row.offset + index, row.dirty[index] === 1),
                  { 'is-group-end': groupEnd(index), 'is-empty': index >= row.bytes.length },
                ]"
                :data-offset="row.offset + index"
                data-pane="hex"
              >{{ index < row.bytes.length ? hexOf(row.bytes[index]) : '' }}</span>
            </span>

            <span v-if="view.showText" class="row__text">
              <span
                v-for="(column, index) in columns"
                :key="column"
                class="char"
                :class="[
                  cellState(row.offset + index, row.dirty[index] === 1),
                  { 'is-empty': index >= row.bytes.length },
                ]"
                :data-offset="row.offset + index"
                data-pane="text"
              >{{
                index < row.bytes.length ? displayChar(row.chars[index] ?? '', view.placeholder) : ' '
              }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <span ref="probe" class="grid__probe" aria-hidden="true">00000000000000000000</span>
  </div>
</template>

<style scoped>
.grid {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--hex-font-size);
  line-height: var(--hex-row-height);

  --hex-offset: var(--text-dim);
  --hex-byte: var(--text);
  --hex-zero: var(--text-dim);
  --hex-char: var(--cyan);
  --hex-dirty: var(--amber);
  --hex-caret: var(--accent);
}

.grid--contrast {
  --hex-byte: #ffffff;
  --hex-char: #ffffff;
  --hex-offset: #9ad7ff;
}

.grid--amber {
  --hex-byte: #ffb64a;
  --hex-char: #ffd79a;
  --hex-offset: #a9752a;
  --hex-caret: #ffcf4a;
}

.grid--mono {
  --hex-byte: var(--text);
  --hex-char: var(--text-muted);
  --hex-offset: var(--text-dim);
  --hex-caret: var(--text-strong);
}

.grid__head,
.row {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  padding: 0 var(--sp-3);
  white-space: nowrap;
}

.grid__head {
  height: calc(var(--hex-row-height) + 2px);
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-panel-alt);
  color: var(--text-dim);
  font-size: calc(var(--hex-font-size) * 0.88);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex: 0 0 auto;
}

.grid__head-offset,
.row__offset {
  width: var(--hex-offset-width);
  flex: 0 0 auto;
  color: var(--hex-offset);
  user-select: none;
}

.grid__head-cells,
.row__hex {
  display: flex;
  flex: 0 0 auto;
}

.grid__head-cell,
.cell {
  width: 2.6ch;
  text-align: center;
  flex: 0 0 auto;
}

.grid__head-cell.is-group-end {
  margin-right: 0.6ch;
}

.grid__head-text {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
}

.grid__viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  outline: none;
  contain: content;
}

.grid__viewport:focus-visible {
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

.grid__spacer {
  position: relative;
  min-width: 100%;
  width: max-content;
}

.grid__rows {
  position: absolute;
  top: 0;
  left: 0;
  min-width: 100%;
  will-change: transform;
}

.row {
  height: var(--hex-row-height);
}

.row__text {
  display: flex;
  flex: 0 0 auto;
  border-left: 1px solid var(--border-soft);
  padding-left: var(--sp-2);
}

.cell,
.char {
  cursor: text;
  border-radius: 2px;
  transition: background 60ms linear;
}

.cell {
  color: var(--hex-byte);
}

.char {
  width: 1.1ch;
  text-align: center;
  color: var(--hex-char);
  flex: 0 0 auto;
}

.cell.is-group-end {
  margin-right: 0.6ch;
}

.cell.is-empty,
.char.is-empty {
  color: transparent;
  cursor: default;
}

.cell.is-dirty,
.char.is-dirty {
  color: var(--hex-dirty);
  font-weight: 600;
}

.cell.is-selected,
.char.is-selected {
  background: rgb(25 227 255 / 22%);
}

.cell.is-match,
.char.is-match {
  background: rgb(255 207 74 / 28%);
  box-shadow: inset 0 -1px 0 var(--amber);
}

.cell.is-bookmark,
.char.is-bookmark {
  box-shadow: inset 0 0 0 1px var(--violet);
}

.cell.is-caret,
.char.is-caret {
  background: var(--accent-ghost);
  box-shadow: inset 0 0 0 1px var(--hex-caret);
  color: var(--text-strong);
}

.is-focused .cell.is-caret::after {
  content: '';
  position: absolute;
  width: 1.3ch;
  height: 2px;
  margin-top: calc(var(--hex-row-height) - 4px);
  margin-left: -1.3ch;
  background: var(--hex-caret);
  animation: hex-blink 1.1s steps(2, start) infinite;
}

.is-focused .cell.is-caret.is-nibble-0::after {
  margin-left: -2.6ch;
}

.cell.is-caret {
  position: relative;
}

@keyframes hex-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.1;
  }
}

.grid__probe {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  white-space: pre;
  font-family: var(--font-mono);
  font-size: var(--hex-font-size);
}

@media print {
  .grid__viewport {
    overflow: visible;
    height: auto;
  }
}
</style>
