<script setup lang="ts">
/** Search and replace over the whole document or the current selection. */
import { computed, ref } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import type { HexTab, HexWorkspace } from '@/composables/useHexEditor'
import { ENCODINGS } from '@/lib/hex/encodings'
import { NUMBER_TYPES, PAYLOAD_FORMATS, parsePayload, type PayloadFormat } from '@/lib/hex/parsers'
import {
  compilePattern,
  findAll,
  findNext,
  findPrevious,
  replaceAll,
  type BytePattern,
  type NumberType,
  type SearchMode,
} from '@/lib/hex/search'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

const toast = useToast()

const MODES: Array<{ value: SearchMode; label: string; title: string }> = [
  { value: 'hex', label: 'Hex', title: 'Hex bytes, "?" works as a wildcard' },
  { value: 'text', label: 'Text', title: 'Text in any of the supported encodings' },
  { value: 'number', label: 'Number', title: 'Integer and floating point values' },
]

const mode = usePersistentState<SearchMode>('hex:search:mode', 'hex')
const query = usePersistentState('hex:search:query', '')
const encoding = usePersistentState('hex:search:encoding', 'latin1')
const caseInsensitive = usePersistentState('hex:search:ci', false)
const numberType = usePersistentState<NumberType>('hex:search:number', 'uint32')
const littleEndian = usePersistentState('hex:search:le', true)
const inSelectionOnly = usePersistentState('hex:search:selection', false)
const replacement = usePersistentState('hex:search:replace', '')
const replaceFormat = usePersistentState<PayloadFormat>('hex:search:replace-format', 'hex')
const keepSize = usePersistentState('hex:search:keep-size', true)

const busy = ref(false)
const cancelled = ref(false)
const progress = ref(0)
const error = ref<string | null>(null)
const results = ref<number[]>([])
const truncated = ref(false)
const queryInput = ref<HTMLInputElement | null>(null)

const encodableEncodings = computed(() => ENCODINGS.filter((item) => item.encodable))

const searchRange = computed(() => {
  const selections = props.tab.selections
  if (!inSelectionOnly.value || selections.length === 0) {
    return { start: 0, end: props.tab.size }
  }
  return { start: selections[0]!.start, end: selections.at(-1)!.end }
})

function buildPattern(): BytePattern | null {
  try {
    error.value = null
    return compilePattern({
      mode: mode.value,
      query: query.value,
      encoding: encoding.value,
      caseInsensitive: caseInsensitive.value,
      numberType: numberType.value,
      littleEndian: littleEndian.value,
    })
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    return null
  }
}

function scanOptions() {
  return {
    range: searchRange.value,
    onProgress: (scanned: number, total: number) => {
      progress.value = total === 0 ? 0 : Math.min(100, Math.round((scanned / total) * 100))
    },
    shouldCancel: () => cancelled.value,
  }
}

async function run<T>(body: (pattern: BytePattern) => Promise<T>): Promise<T | null> {
  const pattern = buildPattern()
  if (!pattern) return null
  busy.value = true
  cancelled.value = false
  progress.value = 0
  try {
    return await body(pattern)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    return null
  } finally {
    busy.value = false
    progress.value = 0
  }
}

function showMatch(offset: number, length: number): void {
  props.tab.matchLength = length
  props.workspace.selectRange(props.tab, offset, offset + length)
}

async function next(): Promise<void> {
  await run(async (pattern) => {
    const from = props.tab.selections.at(-1)?.start ?? props.tab.caret
    const hit = await findNext(props.tab.doc, pattern, from + 1, true, scanOptions())
    if (hit === null) toast.info('No match found.')
    else showMatch(hit, pattern.length)
  })
}

async function previous(): Promise<void> {
  await run(async (pattern) => {
    const from = props.tab.selections[0]?.start ?? props.tab.caret
    const hit = await findPrevious(props.tab.doc, pattern, from, true, scanOptions())
    if (hit === null) toast.info('No match found.')
    else showMatch(hit, pattern.length)
  })
}

async function all(): Promise<void> {
  await run(async (pattern) => {
    const found = await findAll(props.tab.doc, pattern, 10_000, scanOptions())
    results.value = found.matches
    truncated.value = found.truncated
    props.tab.matchLength = pattern.length
    props.tab.matches = found.matches
    if (found.matches.length === 0) toast.info('No match found.')
    else toast.success(`${found.matches.length}${found.truncated ? '+' : ''} match(es)`)
  })
}

function parseReplacement(): Uint8Array {
  return parsePayload(replacement.value, replaceFormat.value, {
    encoding: encoding.value,
    numberType: numberType.value,
    littleEndian: littleEndian.value,
  })
}

async function replaceCurrent(): Promise<void> {
  const selection = props.tab.selections[0]
  if (!selection) {
    toast.error('Find a match first - the replacement goes into the selection.')
    return
  }
  try {
    const bytes = parseReplacement()
    const length = selection.end - selection.start
    if (keepSize.value) {
      props.workspace.overwriteAt(props.tab, selection.start, bytes.subarray(0, length), 'Replace')
    } else {
      props.tab.doc.replace(selection.start, length, bytes, { label: 'Replace' })
      props.workspace.touch(props.tab)
    }
    await next()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

async function replaceEverything(): Promise<void> {
  let bytes: Uint8Array
  try {
    bytes = parseReplacement()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    return
  }
  await run(async (pattern) => {
    const outcome = await replaceAll(
      props.tab.doc,
      pattern,
      bytes,
      keepSize.value,
      scanOptions(),
    )
    props.workspace.touch(props.tab)
    results.value = []
    toast.success(`Replaced ${outcome.replaced} match(es).`)
  })
}

function jumpTo(offset: number): void {
  showMatch(offset, Math.max(1, props.tab.matchLength))
}

function clearResults(): void {
  results.value = []
  props.tab.matches = []
}

defineExpose({
  focusQuery: () => {
    queryInput.value?.focus()
    queryInput.value?.select()
  },
})
</script>

<template>
  <div class="search">
    <SegmentedControl v-model="mode" :options="MODES" size="sm" />

    <label class="field">
      <span>{{ mode === 'hex' ? 'Hex bytes (? = wildcard)' : mode === 'text' ? 'Text' : 'Value' }}</span>
      <input
        ref="queryInput"
        v-model="query"
        class="input"
        spellcheck="false"
        :placeholder="mode === 'hex' ? '4D 5A ?? 00' : mode === 'number' ? '1234' : 'search text'"
        @keydown.enter.prevent="next()"
      />
    </label>

    <label v-if="mode === 'text'" class="field">
      <span>Encoding</span>
      <select v-model="encoding" class="input">
        <option v-for="item in encodableEncodings" :key="item.id" :value="item.id">
          {{ item.label }}
        </option>
      </select>
    </label>

    <label v-if="mode === 'text'" class="check">
      <input v-model="caseInsensitive" type="checkbox" />
      <span>Ignore case</span>
    </label>

    <div v-if="mode === 'number'" class="row">
      <label class="field">
        <span>Type</span>
        <select v-model="numberType" class="input">
          <option v-for="item in NUMBER_TYPES" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Byte order</span>
        <select v-model="littleEndian" class="input">
          <option :value="true">Little endian</option>
          <option :value="false">Big endian</option>
        </select>
      </label>
    </div>

    <label class="check">
      <input v-model="inSelectionOnly" type="checkbox" />
      <span>Search inside the selection only</span>
    </label>

    <div class="actions">
      <AppButton size="sm" icon="search" :disabled="busy" @click="next()">Find next</AppButton>
      <AppButton size="sm" variant="ghost" :disabled="busy" @click="previous()">Previous</AppButton>
      <AppButton size="sm" variant="ghost" :disabled="busy" @click="all()">Find all</AppButton>
      <AppButton v-if="busy" size="sm" variant="danger" icon="x" @click="cancelled = true">
        Stop
      </AppButton>
    </div>

    <div v-if="busy" class="progress" :style="{ '--value': `${progress}%` }">
      <span>scanning {{ progress }}%</span>
    </div>

    <details class="replace" open>
      <summary>Replace</summary>
      <label class="field">
        <span>Replacement</span>
        <input v-model="replacement" class="input" spellcheck="false" placeholder="00 FF" />
      </label>
      <label class="field">
        <span>Interpret as</span>
        <select v-model="replaceFormat" class="input">
          <option v-for="item in PAYLOAD_FORMATS" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
      </label>
      <label class="check">
        <input v-model="keepSize" type="checkbox" />
        <span>Keep the file size (overwrite instead of splice)</span>
      </label>
      <div class="actions">
        <AppButton size="sm" variant="ghost" :disabled="busy" @click="replaceCurrent()">
          Replace
        </AppButton>
        <AppButton size="sm" variant="ghost" :disabled="busy" @click="replaceEverything()">
          Replace all
        </AppButton>
      </div>
    </details>

    <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>

    <div v-if="results.length > 0" class="results">
      <header>
        <span>{{ results.length }}{{ truncated ? '+' : '' }} matches</span>
        <AppButton size="sm" variant="ghost" icon="x" @click="clearResults()">Clear</AppButton>
      </header>
      <ul>
        <li v-for="offset in results.slice(0, 500)" :key="offset">
          <button type="button" @click="jumpTo(offset)">
            0x{{ offset.toString(16).toUpperCase().padStart(8, '0') }}
          </button>
        </li>
      </ul>
      <p v-if="results.length > 500" class="results__more">
        showing the first 500 of {{ results.length }}{{ truncated ? '+' : '' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 0;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.row {
  display: flex;
  gap: var(--sp-2);
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
  gap: var(--sp-2);
  align-items: center;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  cursor: pointer;
}

.actions {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
}

.progress {
  position: relative;
  height: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  overflow: hidden;
}

.progress::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--value);
  background: var(--accent-ghost);
}

.progress span {
  position: relative;
  display: block;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  line-height: 14px;
}

.replace summary {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.replace {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
}

.results header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

.results ul {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin: var(--sp-1) 0 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
  list-style: none;
}

.results li button {
  padding: 1px 4px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  cursor: pointer;
}

.results li button:hover {
  border-color: var(--accent-dim);
  color: var(--accent);
}

.results__more {
  margin: var(--sp-1) 0 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}
</style>
