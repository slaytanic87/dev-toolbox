<script setup lang="ts">
/** Export as source code, hex dump, BaseXX, Intel HEX / S-Record - and printing. */
import { computed, ref } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { downloadText } from '@/composables/useClipboard'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import { formatSize, type HexTab, type HexWorkspace } from '@/composables/useHexEditor'
import {
  EXPORT_FORMATS,
  exportBytes,
  exportExtension,
  hexDump,
  DEFAULT_EXPORT_OPTIONS,
  type ExportFormat,
} from '@/lib/hex/exporters'
import { encodeIntelHex, encodeSrec } from '@/lib/hex/records'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

const toast = useToast()

/** Exports materialise the range - keep it to something a tab can hold. */
const MAX_EXPORT = 8 << 20
const MAX_PRINT = 1 << 20

const format = usePersistentState<ExportFormat>('hex:export:format', 'c')
const variableName = usePersistentState('hex:export:name', 'data')
const bytesPerLine = usePersistentState('hex:export:per-line', 16)
const uppercase = usePersistentState('hex:export:upper', true)
const scope = ref<'selection' | 'file'>('selection')
const recordFormat = usePersistentState<'intel-hex' | 'srec'>('hex:export:records', 'intel-hex')
const baseAddress = usePersistentState('hex:export:base', '0')
const recordLength = usePersistentState('hex:export:record-length', 16)
const output = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

const selectionSize = computed(() => props.workspace.selectionSize(props.tab))

const groups = computed(() => {
  const map = new Map<string, typeof EXPORT_FORMATS>()
  for (const item of EXPORT_FORMATS) {
    const list = map.get(item.group) ?? []
    list.push(item)
    map.set(item.group, list)
  }
  return Array.from(map, ([name, items]) => ({ name, items }))
})

function range(): { start: number; length: number } {
  const selection = props.tab.selections[0]
  if (scope.value === 'selection' && selection) {
    const last = props.tab.selections.at(-1)!
    return { start: selection.start, length: last.end - selection.start }
  }
  return { start: 0, length: props.tab.size }
}

async function readRange(limit: number): Promise<Uint8Array> {
  const { start, length } = range()
  if (length > limit) {
    throw new Error(
      `${formatSize(length)} is too much to export at once - select up to ${formatSize(limit)}.`,
    )
  }
  return props.tab.doc.read(start, length)
}

async function generate(): Promise<void> {
  busy.value = true
  try {
    error.value = null
    const bytes = await readRange(MAX_EXPORT)
    output.value = exportBytes(bytes, format.value, {
      ...DEFAULT_EXPORT_OPTIONS,
      variableName: variableName.value,
      bytesPerLine: Math.max(1, bytesPerLine.value),
      uppercase: uppercase.value,
      baseOffset: range().start,
      encoding: props.workspace.view.value.encoding,
    })
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    output.value = ''
  } finally {
    busy.value = false
  }
}

function download(): void {
  if (output.value === '') return
  downloadText(`${variableName.value || 'export'}.${exportExtension(format.value)}`, output.value)
}

async function generateRecords(): Promise<void> {
  busy.value = true
  try {
    error.value = null
    const bytes = await readRange(MAX_EXPORT)
    const base = Number.parseInt(baseAddress.value.replace(/^0x/i, ''), 16) || 0
    const options = { baseAddress: base, recordLength: Math.max(1, recordLength.value) }
    output.value =
      recordFormat.value === 'intel-hex'
        ? encodeIntelHex(bytes, options)
        : encodeSrec(bytes, { ...options, header: props.tab.name.slice(0, 32) })
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

function downloadRecords(): void {
  if (output.value === '') return
  const extension = recordFormat.value === 'intel-hex' ? 'hex' : 'srec'
  downloadText(`${props.tab.name.replace(/\.[^.]+$/, '')}.${extension}`, output.value)
}

async function print(): Promise<void> {
  try {
    error.value = null
    const { start } = range()
    const bytes = await readRange(MAX_PRINT)
    const dump = hexDump(bytes, {
      ...DEFAULT_EXPORT_OPTIONS,
      bytesPerLine: Math.max(8, bytesPerLine.value),
      uppercase: uppercase.value,
      baseOffset: start,
      encoding: props.workspace.view.value.encoding,
    })
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) {
      toast.error('The browser blocked the print window.')
      return
    }
    const title = `${props.tab.name} - 0x${start.toString(16).toUpperCase()}`
    win.document.title = title
    const heading = win.document.createElement('h1')
    heading.textContent = title
    const pre = win.document.createElement('pre')
    pre.textContent = dump
    const style = win.document.createElement('style')
    style.textContent =
      'body{font-family:ui-monospace,monospace;font-size:11px;margin:16px}h1{font-size:13px}pre{white-space:pre}'
    win.document.head.append(style)
    win.document.body.append(heading, pre)
    win.focus()
    win.print()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}
</script>

<template>
  <div class="export">
    <div class="row">
      <select v-model="scope" class="input">
        <option value="selection" :disabled="selectionSize === 0">
          Selection ({{ formatSize(selectionSize) }})
        </option>
        <option value="file">Whole file ({{ formatSize(tab.size) }})</option>
      </select>
    </div>

    <label class="field">
      <span>Format</span>
      <select v-model="format" class="input">
        <optgroup v-for="group in groups" :key="group.name" :label="group.name">
          <option v-for="item in group.items" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </optgroup>
      </select>
    </label>

    <div class="row">
      <label class="field">
        <span>Name</span>
        <input v-model="variableName" class="input" spellcheck="false" />
      </label>
      <label class="field">
        <span>Per line</span>
        <input v-model.number="bytesPerLine" type="number" min="1" max="64" class="input" />
      </label>
      <label class="check">
        <input v-model="uppercase" type="checkbox" />
        <span>Upper case</span>
      </label>
    </div>

    <div class="actions">
      <AppButton size="sm" icon="play" :disabled="busy" @click="generate()">Generate</AppButton>
      <CopyButton :value="output" label="Copy" size="sm" />
      <AppButton size="sm" variant="ghost" icon="download" :disabled="!output" @click="download()">
        Download
      </AppButton>
      <AppButton size="sm" variant="ghost" icon="terminal" @click="print()">Print</AppButton>
    </div>

    <details class="records">
      <summary>Intel HEX / Motorola S-Record</summary>
      <div class="row">
        <label class="field">
          <span>Format</span>
          <select v-model="recordFormat" class="input">
            <option value="intel-hex">Intel HEX</option>
            <option value="srec">Motorola S-Record</option>
          </select>
        </label>
        <label class="field">
          <span>Base address (hex)</span>
          <input v-model="baseAddress" class="input" spellcheck="false" placeholder="0" />
        </label>
        <label class="field">
          <span>Record length</span>
          <input v-model.number="recordLength" type="number" min="1" max="250" class="input" />
        </label>
      </div>
      <div class="actions">
        <AppButton size="sm" variant="ghost" :disabled="busy" @click="generateRecords()">
          Generate records
        </AppButton>
        <AppButton
          size="sm"
          variant="ghost"
          icon="download"
          :disabled="!output"
          @click="downloadRecords()"
        >
          Download
        </AppButton>
      </div>
    </details>

    <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>

    <textarea
      v-if="output"
      :value="output"
      class="input output"
      readonly
      spellcheck="false"
      rows="12"
    />
  </div>
</template>

<style scoped>
.export {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.row {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-end;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 0;
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}

.input:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.check {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
}

.records {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
}

.records summary {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.output {
  resize: vertical;
  color: var(--text);
  line-height: 1.45;
}
</style>
