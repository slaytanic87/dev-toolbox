<script setup lang="ts">
import { computed, ref } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import JsonTreeNode from '@/components/ui/JsonTreeNode.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { downloadText } from '@/composables/useClipboard'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import {
  SAMPLE_JSON,
  analyseJson,
  formatJson,
  minifyJson,
  parseJson,
  queryJson,
  toJsonError,
  type JsonValue,
} from '@/lib/json'

type RightTab = 'tree' | 'stats' | 'query'
type Indent = '2' | '4' | 'tab'

const TABS: Array<{ value: RightTab; label: string }> = [
  { value: 'tree', label: 'Tree' },
  { value: 'stats', label: 'Stats' },
  { value: 'query', label: 'Query' },
]

const INDENTS: Array<{ value: Indent; label: string }> = [
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: 'tab', label: 'tab' },
]

const toast = useToast()

const source = usePersistentState('json:source', SAMPLE_JSON)
const indent = usePersistentState<Indent>('json:indent', '2')
const sortKeys = usePersistentState('json:sort', false)
const tab = usePersistentState<RightTab>('json:tab', 'tree')
const jsonPath = usePersistentState('json:path', '$.tools[*]')
const treeKey = ref(0)

const parsed = computed<{ value: JsonValue | null; error: ReturnType<typeof toJsonError> | null }>(
  () => {
    if (source.value.trim() === '') return { value: null, error: null }
    try {
      return { value: parseJson(source.value), error: null }
    } catch (error) {
      return { value: null, error: toJsonError(error, source.value) }
    }
  },
)

const stats = computed(() => (parsed.value.value === null ? null : analyseJson(parsed.value.value)))

const queryResult = computed(() => {
  if (parsed.value.value === null) return null
  try {
    return queryJson(parsed.value.value, jsonPath.value)
  } catch {
    return []
  }
})

const indentValue = computed<number | '\t'>(() => (indent.value === 'tab' ? '\t' : Number(indent.value)))

function runFormat(): void {
  apply(() => formatJson(source.value, indentValue.value, sortKeys.value), 'Formatted')
}

function runMinify(): void {
  apply(() => minifyJson(source.value), 'Minified')
}

function runEscape(): void {
  apply(() => JSON.stringify(source.value), 'Escaped as JSON string')
}

function runUnescape(): void {
  apply(() => {
    const parsedString: unknown = JSON.parse(source.value)
    if (typeof parsedString !== 'string') throw new Error('The document is not a JSON string.')
    return parsedString
  }, 'Unescaped')
}

function apply(transform: () => string, message: string): void {
  try {
    source.value = transform()
    treeKey.value++
    toast.success(message)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

function loadSample(): void {
  source.value = SAMPLE_JSON
  treeKey.value++
}

const statRows = computed(() => {
  const value = stats.value
  if (!value) return []
  return [
    { label: 'total nodes', value: value.nodes },
    { label: 'max depth', value: value.maxDepth },
    { label: 'objects', value: value.objects },
    { label: 'arrays', value: value.arrays },
    { label: 'strings', value: value.strings },
    { label: 'numbers', value: value.numbers },
    { label: 'booleans', value: value.booleans },
    { label: 'nulls', value: value.nulls },
    { label: 'characters', value: source.value.length },
    { label: 'lines', value: source.value.split('\n').length },
  ]
})
</script>

<template>
  <div class="tool-view json">
    <ToolPanel icon="braces" title="Actions">
      <div class="row">
        <AppButton size="sm" variant="primary" icon="wand" @click="runFormat">Format</AppButton>
        <AppButton size="sm" icon="zap" @click="runMinify">Minify</AppButton>
        <span class="row__group">
          <span class="label label--inline">indent</span>
          <SegmentedControl v-model="indent" :options="INDENTS" size="sm" />
        </span>
        <label class="checkbox">
          <input v-model="sortKeys" type="checkbox" />
          sort keys
        </label>
        <AppButton size="sm" @click="runEscape">Escape</AppButton>
        <AppButton size="sm" @click="runUnescape">Unescape</AppButton>
        <span class="grow" />
        <AppButton size="sm" icon="info" @click="loadSample">Sample</AppButton>
        <AppButton
          size="sm"
          icon="download"
          :disabled="!source"
          @click="downloadText('document.json', source, 'application/json')"
        >
          .json
        </AppButton>
        <AppButton size="sm" variant="danger" icon="trash" @click="source = ''">Clear</AppButton>
      </div>
    </ToolPanel>

    <SplitPane class="split--work" storage-key="json" :min-a="320" :min-b="320">
      <template #a>
        <ToolPanel
          icon="terminal"
          title="Document"
          :subtitle="`${source.length} chars`"
          :tone="parsed.error ? 'danger' : 'default'"
        >
          <template #actions><CopyButton :value="source" label="copy" /></template>

          <StatusNote v-if="parsed.error" tone="error">
            {{ parsed.error.message }} — line {{ parsed.error.line }}, column
            {{ parsed.error.column }}
          </StatusNote>
          <StatusNote v-else-if="parsed.value !== null" tone="ok">Valid JSON</StatusNote>

          <CodeEditor
            v-model="source"
            language="json"
            lint
            fold-gutter
            placeholder="Paste JSON here…"
            min-height="140px"
            class="grow"
          />
        </ToolPanel>
      </template>

      <template #b>
        <ToolPanel icon="search" title="Inspector">
          <template #actions>
            <SegmentedControl v-model="tab" :options="TABS" size="sm" />
          </template>

          <!-- tree -->
          <div v-if="tab === 'tree'" class="tree grow">
            <JsonTreeNode
              v-if="parsed.value !== null"
              :key="treeKey"
              :value="parsed.value"
              :default-open-depth="2"
            />
            <p v-else class="hint">Nothing to show — fix the document first.</p>
          </div>

          <!-- stats -->
          <div v-else-if="tab === 'stats'" class="stats grow">
            <div v-for="row in statRows" :key="row.label" class="stats__cell">
              <span class="stats__value">{{ row.value }}</span>
              <span class="stats__label">{{ row.label }}</span>
            </div>
            <p v-if="statRows.length === 0" class="hint">Nothing to measure.</p>
          </div>

          <!-- query -->
          <div v-else class="query grow">
            <label class="label" for="json-path">path expression</label>
            <input
              id="json-path"
              v-model="jsonPath"
              class="input"
              placeholder="$.users[0].name"
              spellcheck="false"
            />
            <p class="hint">
              Supports <code>$.a.b</code>, <code>a[0]</code> and the <code>[*]</code> wildcard.
            </p>

            <StatusNote v-if="queryResult === null" tone="muted">Invalid document.</StatusNote>
            <StatusNote v-else tone="info">{{ queryResult.length }} match(es)</StatusNote>

            <CodeEditor
              :model-value="queryResult ? JSON.stringify(queryResult, null, 2) : ''"
              language="json"
              readonly
              min-height="140px"
              class="grow"
            />
          </div>
        </ToolPanel>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.json {
  height: 100%;
}

.split--work {
  flex: 1 1 auto;
  min-height: 460px;
}

.row__group {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.label--inline {
  margin: 0;
}

.tree {
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  overflow: auto;
}

.stats {
  display: grid;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fill, minmax(min(118px, 100%), 1fr));
  align-content: start;
}

.stats__cell {
  display: flex;
  flex-direction: column;
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.stats__value {
  color: var(--accent);
  font-size: var(--fs-xl);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.stats__label {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.query {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.query code {
  color: var(--accent);
}
</style>
