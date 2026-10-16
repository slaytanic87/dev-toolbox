<script setup lang="ts">
import { computed } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import {
  SAMPLE_URL,
  decodeUrl,
  decodeUrlDeep,
  encodeUrl,
  parseUrl,
  type UrlBreakdown,
  type UrlEncodeMode,
} from '@/lib/url'

type Direction = 'encode' | 'decode'

const DIRECTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'encode', label: 'Encode' },
  { value: 'decode', label: 'Decode' },
]

const MODES: Array<{ value: UrlEncodeMode; label: string; title: string }> = [
  {
    value: 'component',
    label: 'Component',
    title: 'encodeURIComponent - escapes everything except A-Z a-z 0-9 - _ . ! ~ * \' ( )',
  },
  { value: 'uri', label: 'Full URI', title: 'encodeURI - keeps reserved characters like : / ? #' },
  { value: 'form', label: 'Form', title: 'application/x-www-form-urlencoded - spaces become "+"' },
]

const toast = useToast()

const direction = usePersistentState<Direction>('url:direction', 'decode')
const mode = usePersistentState<UrlEncodeMode>('url:mode', 'component')
const input = usePersistentState('url:input', SAMPLE_URL)

const result = computed<{ value: string; error: string | null }>(() => {
  if (input.value === '') return { value: '', error: null }
  try {
    return {
      value:
        direction.value === 'encode'
          ? encodeUrl(input.value, mode.value)
          : decodeUrl(input.value, mode.value),
      error: null,
    }
  } catch (error) {
    return { value: '', error: error instanceof Error ? error.message : String(error) }
  }
})

const deepDecoded = computed(() => decodeUrlDeep(input.value))

/** The URL that drives the structural breakdown - prefer the decoded form. */
const breakdown = computed<{ data: UrlBreakdown | null; error: string | null }>(() => {
  const candidate = direction.value === 'decode' && result.value.value ? result.value.value : input.value
  if (candidate.trim() === '') return { data: null, error: null }
  try {
    return { data: parseUrl(candidate), error: null }
  } catch {
    return { data: null, error: 'Not an absolute URL (needs a scheme such as https://).' }
  }
})

function swap(): void {
  if (!result.value.value) {
    toast.error('Nothing to move to the input.')
    return
  }
  input.value = result.value.value
  direction.value = direction.value === 'encode' ? 'decode' : 'encode'
}

function applyDeepDecode(): void {
  if (deepDecoded.value.rounds === 0) {
    toast.info('Already fully decoded.')
    return
  }
  input.value = deepDecoded.value.value
  toast.success(`Decoded ${deepDecoded.value.rounds} nested layer(s)`)
}

function loadSample(): void {
  input.value = SAMPLE_URL
  direction.value = 'decode'
}

const PART_LABELS: Array<[keyof UrlBreakdown, string]> = [
  ['protocol', 'scheme'],
  ['hostname', 'host'],
  ['port', 'port'],
  ['pathname', 'path'],
  ['hash', 'fragment'],
  ['origin', 'origin'],
]

const parts = computed<Array<{ label: string; value: string }>>(() => {
  const data = breakdown.value.data
  if (!data) return []

  const rows = PART_LABELS.map(([key, label]) => ({ label, value: String(data[key] ?? '') })).filter(
    (row) => row.value !== '',
  )
  if (data.username) {
    rows.push({ label: 'credentials', value: `${data.username}:${data.password ? '••••' : ''}` })
  }
  return rows
})
</script>

<template>
  <div class="tool-view">
    <ToolPanel icon="link" title="Mode">
      <div class="row">
        <SegmentedControl v-model="direction" :options="DIRECTIONS" />
        <SegmentedControl v-model="mode" :options="MODES" />
        <span class="grow" />
        <AppButton size="sm" icon="wand" @click="applyDeepDecode">
          Deep decode ({{ deepDecoded.rounds }})
        </AppButton>
        <AppButton size="sm" icon="shuffle" @click="swap">Use output as input</AppButton>
        <AppButton size="sm" icon="info" @click="loadSample">Sample</AppButton>
        <AppButton size="sm" variant="danger" icon="trash" @click="input = ''">Clear</AppButton>
      </div>
    </ToolPanel>

    <SplitPane sizing="content" storage-key="url" :min-a="300" :min-b="300">
      <template #a>
        <ToolPanel icon="terminal" title="Input" :subtitle="`${input.length} chars`">
          <template #actions><CopyButton :value="input" label="copy" /></template>
          <CodeEditor
            v-model="input"
            placeholder="https://example.com/path?a=1&b=hello%20world"
            min-height="150px"
            :line-numbers="false"
          />
        </ToolPanel>
      </template>

      <template #b>

        <ToolPanel
          icon="link"
          title="Output"
          :subtitle="`${result.value.length} chars`"
          :tone="result.error ? 'danger' : 'default'"
        >
          <template #actions><CopyButton :value="result.value" label="copy" /></template>
          <StatusNote v-if="result.error" tone="error">{{ result.error }}</StatusNote>
          <CodeEditor
            :model-value="result.value"
            readonly
            placeholder="output appears here"
            min-height="150px"
            :line-numbers="false"
          />
        </ToolPanel>
      </template>
    </SplitPane>

    <ToolPanel icon="search" title="URL breakdown" subtitle="parsed with the native URL API">
      <StatusNote v-if="breakdown.error" tone="muted">{{ breakdown.error }}</StatusNote>

      <template v-if="breakdown.data">
        <dl class="parts">
          <div v-for="part in parts" :key="part.label" class="parts__row">
            <dt>{{ part.label }}</dt>
            <dd>{{ part.value }}</dd>
          </div>
        </dl>

        <div v-if="breakdown.data.params.length > 0" class="params">
          <span class="label">query parameters ({{ breakdown.data.params.length }})</span>
          <table class="params__table">
            <thead>
              <tr>
                <th>key</th>
                <th>decoded value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(param, index) in breakdown.data.params" :key="`${param.key}-${index}`">
                <td class="params__key">{{ param.key }}</td>
                <td class="params__value">{{ param.value }}</td>
                <td class="params__action"><CopyButton :value="param.value" label="" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </ToolPanel>
  </div>
</template>

<style scoped>
.parts {
  display: grid;
  gap: 4px;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  margin: 0;
}

.parts__row {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  padding: 4px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.parts__row dt {
  flex: 0 0 82px;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.parts__row dd {
  margin: 0;
  color: var(--cyan);
  font-size: var(--fs-sm);
  word-break: break-all;
}

.params {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.params__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.params__table th {
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.1em;
  text-align: left;
  text-transform: uppercase;
}

.params__table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: top;
  word-break: break-all;
}

.params__key {
  width: 26%;
  color: var(--accent);
}

.params__value {
  color: var(--text-strong);
}

.params__action {
  width: 34px;
  text-align: right;
}
</style>
