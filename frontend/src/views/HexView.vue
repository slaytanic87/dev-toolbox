<script setup lang="ts">
/**
 * Hex editor.
 *
 * Files are opened lazily: the document only keeps descriptors, the grid reads
 * the few kilobytes it shows and saving streams the original file straight
 * into the new one. That is what makes multi-gigabyte files work in a tab.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import HexAnalysisPanel from '@/components/hex/HexAnalysisPanel.vue'
import HexEncodingsPanel from '@/components/hex/HexEncodingsPanel.vue'
import HexExportPanel from '@/components/hex/HexExportPanel.vue'
import HexGrid from '@/components/hex/HexGrid.vue'
import HexHashPanel from '@/components/hex/HexHashPanel.vue'
import HexInspector from '@/components/hex/HexInspector.vue'
import HexMergePanel from '@/components/hex/HexMergePanel.vue'
import HexNavigator from '@/components/hex/HexNavigator.vue'
import HexPreviewPanel from '@/components/hex/HexPreviewPanel.vue'
import HexSearchPanel from '@/components/hex/HexSearchPanel.vue'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import DropZone from '@/components/ui/DropZone.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { downloadBlob, useClipboard } from '@/composables/useClipboard'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import {
  createHexWorkspace,
  formatOffset,
  formatSize,
  supportsFileSystemAccess,
  type EditMode,
  type HexTab,
} from '@/composables/useHexEditor'
import { ENCODINGS } from '@/lib/hex/encodings'
import { exportBytes } from '@/lib/hex/exporters'
import { parsePayload } from '@/lib/hex/parsers'
import { decodeRecords, looksLikeRecordFile } from '@/lib/hex/records'
import { guessMimeType, IDENTIFY_WINDOW } from '@/lib/hex/signatures'

type PanelId =
  | 'inspector'
  | 'search'
  | 'navigate'
  | 'analysis'
  | 'hashes'
  | 'encodings'
  | 'export'
  | 'preview'
  | 'merge'

const PANELS: Array<{ value: PanelId; label: string; title: string }> = [
  { value: 'inspector', label: 'Inspect', title: 'Data inspector and bit editor' },
  { value: 'search', label: 'Search', title: 'Search and replace' },
  { value: 'navigate', label: 'Navigate', title: 'Go to offset, bookmarks, byte operations' },
  { value: 'analysis', label: 'Analyse', title: 'File info, format ID, histogram' },
  { value: 'hashes', label: 'Hashes', title: 'Checksums and cryptographic hashes' },
  { value: 'encodings', label: 'Encodings', title: 'Compare text encodings' },
  { value: 'export', label: 'Export', title: 'Code snippets, records, printing' },
  { value: 'preview', label: 'Preview', title: 'Live preview of the content' },
  { value: 'merge', label: 'Merge', title: 'Merge several documents into one image' },
]

const MODES: Array<{ value: EditMode; label: string; title: string }> = [
  { value: 'overwrite', label: 'Overwrite', title: 'Typing replaces bytes - the size stays' },
  { value: 'insert', label: 'Insert', title: 'Typing inserts bytes and grows the file' },
]

const BYTES_PER_ROW = [4, 8, 16, 24, 32, 48, 64]
const GROUP_SIZES = [1, 2, 4, 8, 16]

const workspace = createHexWorkspace()
const { tabs, active, mode, view } = workspace
const toast = useToast()
const clipboard = useClipboard()

const panel = usePersistentState<PanelId>('hex:panel', 'inspector')
const showSettings = ref(false)
const showShortcuts = ref(false)
const newSize = ref('1024')
const newFill = ref('00')
const busy = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const grid = ref<InstanceType<typeof HexGrid> | null>(null)
const searchPanel = ref<InstanceType<typeof HexSearchPanel> | null>(null)
const navigator = ref<InstanceType<typeof HexNavigator> | null>(null)
const dropping = ref(false)

const canUseHandles = supportsFileSystemAccess()

const caretLabel = computed(() => {
  const tab = active.value
  if (!tab) return ''
  return `${formatOffset(tab.caret, view.value)} (${tab.caret.toLocaleString()})`
})

const selectionLabel = computed(() => {
  const tab = active.value
  if (!tab || tab.selections.length === 0) return 'none'
  const bytes = workspace.selectionSize(tab)
  const first = tab.selections[0]!
  const ranges = tab.selections.length > 1 ? ` in ${tab.selections.length} ranges` : ''
  return `${formatSize(bytes)}${ranges} from ${formatOffset(first.start, view.value)}`
})

/* --------------------------------------------------------------- opening */

async function openFiles(files: File[]): Promise<void> {
  for (const file of files) await openFile(file)
}

async function openFile(file: File, handle = null as Parameters<typeof workspace.openBlob>[2]) {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
  const recordFormat = looksLikeRecordFile(head)

  if (recordFormat && file.size < (16 << 20)) {
    try {
      const text = await file.text()
      const decoded = decodeRecords(text)
      const tab = workspace.openBytes(file.name, decoded.image, 'records')
      tab.recordInfo = {
        format: decoded.format,
        baseAddress: decoded.baseAddress,
        startAddress: decoded.startAddress,
        segments: decoded.segments.length,
        header: decoded.header,
      }
      toast.success(
        `Decoded ${decoded.format === 'srec' ? 'S-Record' : 'Intel HEX'} - ${formatSize(decoded.image.length)} from 0x${decoded.baseAddress.toString(16).toUpperCase()}.`,
      )
      return
    } catch {
      // Not a valid record file after all - fall through and open it raw.
    }
  }

  workspace.openBlob(file.name, file, handle)
  toast.success(`Opened ${file.name} (${formatSize(file.size)})`)
}

async function pickFiles(): Promise<void> {
  try {
    const picked = await workspace.openWithPicker()
    if (picked.length > 0) {
      for (const item of picked) await openFile(item.file, item.handle)
      return
    }
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') return
    toast.error(error instanceof Error ? error.message : String(error))
    return
  }
  // No File System Access API - fall back to a plain file input.
  fileInput.value?.click()
}

function onInputFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  void openFiles(Array.from(input.files ?? []))
  input.value = ''
}

function createDocument(): void {
  const size = Number.parseInt(newSize.value.replace(/^0x/i, ''), newSize.value.match(/^0x/i) ? 16 : 10)
  const fill = Number.parseInt(newFill.value.replace(/^0x/i, ''), 16)
  if (!Number.isFinite(size) || size < 0) {
    toast.error('Enter the size of the new file.')
    return
  }
  // The fill itself is virtual, but the browser has to store it when saving.
  if (size > MAX_NEW_DOCUMENT) {
    toast.error(`New documents are limited to ${formatSize(MAX_NEW_DOCUMENT)}.`)
    return
  }
  workspace.newDocument(size, Number.isFinite(fill) ? fill : 0)
}

function onDrop(event: DragEvent): void {
  dropping.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length > 0) void openFiles(files)
}

/* ---------------------------------------------------------------- saving */

async function save(tab: HexTab): Promise<void> {
  busy.value = true
  try {
    if (tab.handle) {
      await workspace.saveInPlace(tab)
      toast.success(`Saved ${tab.name}`)
      return
    }
    await saveAs(tab)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    busy.value = false
  }
}

async function saveAs(tab: HexTab): Promise<void> {
  busy.value = true
  try {
    const outcome = await workspace.saveAs(tab)
    if (outcome === 'download') {
      const head = await tab.doc.read(0, IDENTIFY_WINDOW)
      downloadBlob(tab.name, tab.doc.toBlob(guessMimeType(head)))
      tab.doc.markSaved()
      workspace.touch(tab)
      toast.success(`Downloaded ${tab.name}`)
    } else {
      toast.success(`Saved ${tab.name}`)
    }
  } catch (error) {
    if ((error as DOMException)?.name !== 'AbortError') {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  } finally {
    busy.value = false
  }
}

async function exportSelection(tab: HexTab): Promise<void> {
  const selection = tab.selections[0]
  if (!selection) {
    toast.error('Select the bytes to export first.')
    return
  }
  const length = tab.selections.at(-1)!.end - selection.start
  downloadBlob(`${tab.name}-0x${selection.start.toString(16)}.bin`, tab.doc.rangeToBlob(selection.start, length))
}

function closeTab(tab: HexTab): void {
  if (tab.modified && !window.confirm(`${tab.name} has unsaved changes. Close it anyway?`)) return
  workspace.closeTab(tab.id)
}

/* ------------------------------------------------------------- clipboard */

const COPY_LIMIT = 16 << 20
/** A new document is a virtual fill, but saving it has to go through a `Blob`. */
const MAX_NEW_DOCUMENT = 16 * 1024 ** 3

async function copySelection(tab: HexTab, cut = false): Promise<void> {
  const selection = tab.selections[0]
  if (!selection) {
    toast.error('Nothing selected.')
    return
  }
  const length = tab.selections.at(-1)!.end - selection.start
  if (length > COPY_LIMIT) {
    toast.error(`${formatSize(length)} is too much for the clipboard - export it instead.`)
    return
  }
  const bytes = await tab.doc.read(selection.start, length)
  await clipboard.copy(exportBytes(bytes, 'hex-grid', { bytesPerLine: view.value.bytesPerRow }))
  if (cut) workspace.deleteSelection(tab)
}

function pasteText(tab: HexTab, text: string): void {
  try {
    const bytes = parsePayload(text, 'auto', { encoding: view.value.encoding })
    workspace.insertBytes(tab, bytes, mode.value === 'insert' ? 'insert' : 'overwrite')
    toast.success(`Pasted ${bytes.length} byte(s).`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

/* -------------------------------------------------------------- commands */

async function onCommand(name: string): Promise<void> {
  const tab = active.value
  if (!tab) return
  switch (name) {
    case 'c':
      await copySelection(tab)
      return
    case 'x':
      await copySelection(tab, true)
      return
    case 'z':
      if (!workspace.undo(tab)) toast.info('Nothing to undo.')
      return
    case 'y':
      if (!workspace.redo(tab)) toast.info('Nothing to redo.')
      return
    case 'f':
      panel.value = 'search'
      await nextTick()
      searchPanel.value?.focusQuery()
      return
    case 'g':
      panel.value = 'navigate'
      await nextTick()
      navigator.value?.focusGoto()
      return
    case 's':
      await save(tab)
      return
    case 'b':
      workspace.toggleBookmark(tab, tab.caret)
      return
    case 'e':
      panel.value = 'export'
      return
    case 'encoding-error':
      toast.error(`This character does not exist in ${view.value.encoding}.`)
      return
    default:
  }
}

function onGlobalKey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
  if (event.key.toLowerCase() === 'z') {
    const tab = active.value
    if (!tab) return
    event.preventDefault()
    if (!workspace.redo(tab)) toast.info('Nothing to redo.')
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  for (const tab of tabs.value) tab.doc.dispose()
})

watch(
  () => active.value?.id,
  () => nextTick(() => grid.value?.focus()),
)
</script>

<template>
  <div
    class="tool-view hex"
    @dragenter.prevent="dropping = true"
    @dragover.prevent
    @dragleave="dropping = false"
    @drop.prevent="onDrop"
  >
    <ToolPanel icon="binary" title="Hex editor">
      <div class="row">
        <AppButton size="sm" variant="primary" icon="upload" @click="pickFiles()">
          Open file
        </AppButton>
        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden-input"
          @change="onInputFiles"
        />
        <AppButton size="sm" icon="plus" @click="createDocument()">New</AppButton>
        <label class="field field--tight">
          <span>size</span>
          <input v-model="newSize" class="input input--xs" spellcheck="false" />
        </label>
        <label class="field field--tight">
          <span>fill</span>
          <input v-model="newFill" class="input input--xs" spellcheck="false" />
        </label>

        <span class="divider" />

        <AppButton
          size="sm"
          icon="download"
          :disabled="!active || busy"
          :title="active?.handle ? 'Write back to the opened file' : 'Save the document'"
          @click="active && save(active)"
        >
          Save
        </AppButton>
        <AppButton size="sm" variant="ghost" :disabled="!active || busy" @click="active && saveAs(active)">
          Save as
        </AppButton>
        <AppButton
          size="sm"
          variant="ghost"
          :disabled="!active || active.selections.length === 0"
          title="Download the selected bytes as their own file"
          @click="active && exportSelection(active)"
        >
          Export selection
        </AppButton>

        <span class="divider" />

        <AppButton
          size="sm"
          variant="ghost"
          icon="refresh"
          :disabled="!active?.doc.canUndo"
          title="Undo (Ctrl/Cmd + Z)"
          @click="active && workspace.undo(active)"
        >
          Undo
        </AppButton>
        <AppButton
          size="sm"
          variant="ghost"
          :disabled="!active?.doc.canRedo"
          title="Redo (Ctrl/Cmd + Y)"
          @click="active && workspace.redo(active)"
        >
          Redo
        </AppButton>

        <span class="grow" />

        <SegmentedControl v-model="mode" :options="MODES" size="sm" />
        <AppButton
          size="sm"
          variant="ghost"
          icon="grid"
          :active="showSettings"
          @click="showSettings = !showSettings"
        >
          View
        </AppButton>
        <AppButton
          size="sm"
          variant="ghost"
          icon="info"
          :active="showShortcuts"
          @click="showShortcuts = !showShortcuts"
        >
          Keys
        </AppButton>
      </div>

      <div v-if="showSettings" class="settings">
        <label class="field">
          <span>Bytes per row</span>
          <select v-model.number="view.bytesPerRow" class="input" :disabled="view.autoWidth">
            <option v-for="value in BYTES_PER_ROW" :key="value" :value="value">{{ value }}</option>
          </select>
        </label>
        <label class="check">
          <input v-model="view.autoWidth" type="checkbox" />
          <span>Fit to width</span>
        </label>
        <label class="field">
          <span>Group every</span>
          <select v-model.number="view.groupSize" class="input">
            <option v-for="value in GROUP_SIZES" :key="value" :value="value">{{ value }}</option>
          </select>
        </label>
        <label class="field">
          <span>Offsets</span>
          <select v-model="view.offsetBase" class="input">
            <option value="hex">hexadecimal</option>
            <option value="dec">decimal</option>
            <option value="oct">octal</option>
          </select>
        </label>
        <label class="field">
          <span>Offset digits</span>
          <input v-model.number="view.offsetDigits" type="number" min="4" max="16" class="input" />
        </label>
        <label class="field">
          <span>Encoding</span>
          <select v-model="view.encoding" class="input">
            <option v-for="item in ENCODINGS" :key="item.id" :value="item.id">
              {{ item.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Placeholder</span>
          <input v-model="view.placeholder" class="input input--xs" maxlength="1" />
        </label>
        <label class="field">
          <span>Zoom</span>
          <input v-model.number="view.fontSize" type="range" min="9" max="24" class="range" />
        </label>
        <label class="field">
          <span>Theme</span>
          <select v-model="view.theme" class="input">
            <option value="default">Terminal</option>
            <option value="contrast">High contrast</option>
            <option value="amber">Amber</option>
            <option value="mono">Monochrome</option>
          </select>
        </label>
        <label class="check">
          <input v-model="view.uppercase" type="checkbox" />
          <span>Upper case hex</span>
        </label>
        <label class="check">
          <input v-model="view.showOffsets" type="checkbox" />
          <span>Offset column</span>
        </label>
        <label class="check">
          <input v-model="view.showText" type="checkbox" />
          <span>Character column</span>
        </label>
        <label class="check">
          <input v-model="view.highlightModified" type="checkbox" />
          <span>Highlight changes</span>
        </label>
      </div>

      <dl v-if="showShortcuts" class="shortcuts">
        <dt>Arrows / Page / Home / End</dt>
        <dd>Move the caret, hold Shift to select</dd>
        <dt>Ctrl/Cmd + Home / End</dt>
        <dd>Jump to the start or the end of the file</dd>
        <dt>Tab</dt>
        <dd>Switch between the hex and the character column</dd>
        <dt>Insert</dt>
        <dd>Toggle overwrite / insert mode</dd>
        <dt>0-9, A-F</dt>
        <dd>Type a nibble in the hex column, any character in the text column</dd>
        <dt>Backspace / Delete</dt>
        <dd>Remove the selection, or a byte in insert mode</dd>
        <dt>Ctrl/Cmd + Z / Y</dt>
        <dd>Undo / redo - the history is unlimited</dd>
        <dt>Ctrl/Cmd + C / X / V</dt>
        <dd>Copy, cut and paste the selection (paste auto-detects hex, Base64 or text)</dd>
        <dt>Ctrl/Cmd + A</dt>
        <dd>Select everything</dd>
        <dt>Ctrl/Cmd + click</dt>
        <dd>Add another selection range</dd>
        <dt>Ctrl/Cmd + F / G / B / S / E</dt>
        <dd>Search, go to offset, bookmark, save, export</dd>
      </dl>
    </ToolPanel>

    <ToolPanel v-if="tabs.length === 0" icon="upload" title="Open a file">
      <DropZone accept="*/*" multiple icon="binary" @files="openFiles">
        <template #title>Drop a binary file, or click to browse</template>
        <template #hint>
          Any size - the file is read in 64 KiB chunks while you scroll, never as a whole
        </template>
      </DropZone>
      <StatusNote tone="info">
        Nothing is uploaded. Files are read from disk in 64 KiB chunks while you scroll, and saving
        streams the untouched parts straight from the original file.
        <template v-if="canUseHandles">
          This browser supports writing back to the opened file in place.
        </template>
      </StatusNote>
    </ToolPanel>

    <template v-else>
      <nav class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tabs__item"
          :class="{ 'is-active': tab.id === workspace.activeId.value }"
          @click="workspace.activate(tab.id)"
        >
          <span class="tabs__name">{{ tab.name }}</span>
          <span v-if="tab.modified" class="tabs__dot" title="unsaved changes">*</span>
          <span class="tabs__size">{{ formatSize(tab.size) }}</span>
          <span class="tabs__close" title="Close" @click.stop="closeTab(tab)">&times;</span>
        </button>
      </nav>

      <SplitPane class="split--work" storage-key="hex" :default-ratio="0.62" :min-a="360" :min-b="300">
        <template #a>
          <ToolPanel
            v-if="active"
            icon="terminal"
            :title="active.name"
            :subtitle="`${formatSize(active.size)}${active.modified ? ' - modified' : ''}`"
            flush
          >
            <HexGrid
              ref="grid"
              :workspace="workspace"
              :tab="active"
              @command="onCommand"
              @paste="(text: string) => active && pasteText(active, text)"
            />
            <template #footer>
              <span class="status">
                <span>caret {{ caretLabel }}</span>
                <span>selection {{ selectionLabel }}</span>
                <span>{{ mode }}</span>
                <span>{{ active.pane }} column</span>
                <span v-if="active.doc.canUndo">{{ active.doc.undoDepth }} undo steps</span>
              </span>
            </template>
          </ToolPanel>
        </template>

        <template #b>
          <ToolPanel icon="wand" title="Tools" :subtitle="PANELS.find((p) => p.value === panel)?.title">
            <template #actions>
              <SegmentedControl v-model="panel" :options="PANELS" size="sm" />
            </template>

            <template v-if="active">
              <HexInspector v-if="panel === 'inspector'" :workspace="workspace" :tab="active" />
              <HexSearchPanel
                v-else-if="panel === 'search'"
                ref="searchPanel"
                :workspace="workspace"
                :tab="active"
              />
              <HexNavigator
                v-else-if="panel === 'navigate'"
                ref="navigator"
                :workspace="workspace"
                :tab="active"
              />
              <HexAnalysisPanel v-else-if="panel === 'analysis'" :workspace="workspace" :tab="active" />
              <HexHashPanel v-else-if="panel === 'hashes'" :workspace="workspace" :tab="active" />
              <HexEncodingsPanel v-else-if="panel === 'encodings'" :workspace="workspace" :tab="active" />
              <HexExportPanel v-else-if="panel === 'export'" :workspace="workspace" :tab="active" />
              <HexPreviewPanel v-else-if="panel === 'preview'" :workspace="workspace" :tab="active" />
              <HexMergePanel v-else :workspace="workspace" />
            </template>
          </ToolPanel>
        </template>
      </SplitPane>
    </template>

    <div v-if="dropping" class="dropping">Drop to open</div>
  </div>
</template>

<style scoped>
.hex {
  height: 100%;
}

.split--work {
  flex: 1 1 auto;
  min-height: 520px;
}

.hidden-input {
  display: none;
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--border);
}

.grow {
  flex: 1 1 auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.field--tight {
  flex-direction: row;
  align-items: center;
  gap: var(--sp-1);
}

.input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}

.input--xs {
  width: 5.5em;
}

.range {
  width: 100%;
  accent-color: var(--accent);
}

.check {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.settings {
  display: grid;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr));
  align-items: end;
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.settings .input {
  width: 100%;
}

.shortcuts {
  display: grid;
  grid-template-columns: minmax(0, 14em) minmax(0, 1fr);
  gap: 2px var(--sp-3);
  margin: 0;
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  font-size: var(--fs-xs);
}

.shortcuts dt {
  color: var(--accent-dim);
}

.shortcuts dd {
  margin: 0;
  color: var(--text-muted);
}

.tabs {
  display: flex;
  gap: var(--sp-1);
  overflow-x: auto;
  padding-bottom: 2px;
}

.tabs__item {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  white-space: nowrap;
  cursor: pointer;
  transition: all var(--transition);
}

.tabs__item:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.tabs__item.is-active {
  border-color: var(--accent-dim);
  background: var(--accent-ghost);
  color: var(--accent);
}

.tabs__name {
  max-width: 18em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tabs__dot {
  color: var(--amber);
}

.tabs__size {
  color: var(--text-dim);
}

.tabs__close {
  padding: 0 2px;
  border-radius: 2px;
  color: var(--text-dim);
}

.tabs__close:hover {
  background: var(--danger-ghost);
  color: var(--danger);
}

.status {
  display: flex;
  gap: var(--sp-4);
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
}

.dropping {
  position: fixed;
  inset: var(--topbar-h) 0 var(--statusbar-h) var(--sidebar-w);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(4 7 10 / 80%);
  border: 2px dashed var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-lg);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 40;
}
</style>
