<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { downloadText } from '@/composables/useClipboard'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import {
  generateMany,
  inspectUuid,
  nanoId,
  randomHex,
  ulid,
  type UuidVersion,
} from '@/lib/uuid'

type Kind = 'uuid-v4' | 'uuid-v7' | 'ulid' | 'nanoid' | 'hex' | 'nil' | 'max'
type Casing = 'lower' | 'upper'

const KINDS: Array<{ value: Kind; label: string; title: string }> = [
  { value: 'uuid-v4', label: 'UUID v4', title: 'Random, RFC 9562' },
  { value: 'uuid-v7', label: 'UUID v7', title: 'Time ordered, RFC 9562' },
  { value: 'ulid', label: 'ULID', title: 'Lexicographically sortable, Crockford base32' },
  { value: 'nanoid', label: 'NanoID', title: '21 character URL friendly id' },
  { value: 'hex', label: 'Hex token', title: '32 hex characters (16 random bytes)' },
  { value: 'nil', label: 'Nil', title: 'All-zero UUID' },
  { value: 'max', label: 'Max', title: 'All-ones UUID' },
]

const CASINGS: Array<{ value: Casing; label: string }> = [
  { value: 'lower', label: 'lower' },
  { value: 'upper', label: 'UPPER' },
]

const WRAPPERS: Array<{ value: Wrapper; label: string; title: string }> = [
  { value: 'plain', label: 'plain', title: 'One id per line' },
  { value: 'braces', label: '{…}', title: 'Microsoft registry style' },
  { value: 'quotes', label: '"…"', title: 'Quoted, comma separated' },
  { value: 'json', label: 'JSON', title: 'JSON array' },
  { value: 'sql', label: 'SQL', title: 'INSERT VALUES list' },
]

type Wrapper = 'plain' | 'braces' | 'quotes' | 'json' | 'sql'

const toast = useToast()

const kind = usePersistentState<Kind>('uuid:kind', 'uuid-v4')
const count = usePersistentState('uuid:count', 10)
const casing = usePersistentState<Casing>('uuid:casing', 'lower')
const wrapper = usePersistentState<Wrapper>('uuid:wrapper', 'plain')
const hyphens = usePersistentState('uuid:hyphens', true)

const ids = ref<string[]>([])
const inspectInput = usePersistentState('uuid:inspect', '')

function generateOne(current: Kind): string {
  switch (current) {
    case 'uuid-v7':
      return generateMany('v7', 1)[0] as string
    case 'nil':
      return generateMany('nil', 1)[0] as string
    case 'max':
      return generateMany('max', 1)[0] as string
    case 'ulid':
      return ulid()
    case 'nanoid':
      return nanoId()
    case 'hex':
      return randomHex(16)
    default:
      return generateMany('v4', 1)[0] as string
  }
}

function generate(): void {
  const total = Math.max(1, Math.min(count.value || 1, 10_000))
  const isUuid = kind.value.startsWith('uuid') || kind.value === 'nil' || kind.value === 'max'
  const version: UuidVersion | null = isUuid
    ? kind.value === 'uuid-v7'
      ? 'v7'
      : kind.value === 'nil'
        ? 'nil'
        : kind.value === 'max'
          ? 'max'
          : 'v4'
    : null

  ids.value =
    version !== null
      ? generateMany(version, total)
      : Array.from({ length: total }, () => generateOne(kind.value))
}

generate()

watch(kind, generate)

/** Casing and hyphen options only make sense for hexadecimal ids. */
const isHexId = computed(
  () => kind.value.startsWith('uuid') || kind.value === 'hex' || kind.value === 'nil' || kind.value === 'max',
)

const transformed = computed(() =>
  ids.value.map((id) => {
    if (!isHexId.value) return id
    const value = hyphens.value ? id : id.replace(/-/g, '')
    return casing.value === 'upper' ? value.toUpperCase() : value.toLowerCase()
  }),
)

const output = computed(() => {
  const list = transformed.value
  switch (wrapper.value) {
    case 'braces':
      return list.map((id) => `{${id}}`).join('\n')
    case 'quotes':
      return list.map((id) => `"${id}"`).join(',\n')
    case 'json':
      return JSON.stringify(list, null, 2)
    case 'sql':
      return list.map((id) => `('${id}')`).join(',\n') + ';'
    default:
      return list.join('\n')
  }
})

const inspection = computed(() =>
  inspectInput.value.trim() === '' ? null : inspectUuid(inspectInput.value),
)

function inspectFirst(): void {
  const first = transformed.value[0]
  if (!first) return
  inspectInput.value = first
  toast.info('Loaded the first id into the inspector')
}

function exportFile(): void {
  const extension = wrapper.value === 'json' ? 'json' : wrapper.value === 'sql' ? 'sql' : 'txt'
  downloadText(`ids.${extension}`, output.value)
}
</script>

<template>
  <div class="tool-view">
    <ToolPanel icon="fingerprint" title="Generator">
      <div class="row">
        <SegmentedControl v-model="kind" :options="KINDS" />
        <span class="grow" />
        <AppButton variant="primary" size="sm" icon="refresh" @click="generate">Generate</AppButton>
      </div>

      <div class="row">
        <label class="field">
          <span class="label">amount</span>
          <input
            v-model.number="count"
            class="input input--narrow"
            type="number"
            min="1"
            max="10000"
            @change="generate"
          />
        </label>

        <div class="field">
          <span class="label">casing</span>
          <SegmentedControl v-model="casing" :options="CASINGS" size="sm" />
        </div>

        <div class="field">
          <span class="label">format</span>
          <SegmentedControl v-model="wrapper" :options="WRAPPERS" size="sm" />
        </div>

        <label class="checkbox checkbox--aligned">
          <input v-model="hyphens" type="checkbox" :disabled="!isHexId" />
          keep hyphens
        </label>
      </div>
    </ToolPanel>

    <SplitPane class="split--work" storage-key="uuid" :min-a="300" :min-b="300">
      <template #a>
        <ToolPanel icon="terminal" title="Output" :subtitle="`${ids.length} id(s)`">
          <template #actions>
            <CopyButton :value="output" label="copy all" variant="default" />
            <AppButton size="sm" icon="download" @click="exportFile">Export</AppButton>
          </template>
          <CodeEditor
            :model-value="output"
            readonly
            :language="wrapper === 'json' ? 'json' : 'text'"
            min-height="140px"
            class="grow"
          />
        </ToolPanel>
      </template>

      <template #b>
        <ToolPanel icon="search" title="Inspector" subtitle="decode an existing UUID">
          <template #actions>
            <AppButton size="sm" icon="wand" @click="inspectFirst">Use first</AppButton>
          </template>

          <input
            v-model="inspectInput"
            class="input"
            placeholder="0190f2e1-7c3a-7b1e-8a6b-5d2f9c4b0e11"
            spellcheck="false"
          />

          <StatusNote v-if="inspection && !inspection.valid" tone="error">
            Not a valid UUID — expected 8-4-4-4-12 hexadecimal characters.
          </StatusNote>

          <dl v-else-if="inspection" class="info">
            <div class="info__row">
              <dt>normalised</dt>
              <dd>{{ inspection.normalised }}</dd>
            </div>
            <div class="info__row">
              <dt>version</dt>
              <dd>v{{ inspection.version }}</dd>
            </div>
            <div class="info__row">
              <dt>variant</dt>
              <dd>{{ inspection.variant }}</dd>
            </div>
            <div v-if="inspection.timestamp" class="info__row">
              <dt>timestamp</dt>
              <dd>{{ inspection.timestamp.toLocaleString() }}</dd>
            </div>
          </dl>

          <p class="hint">
            <strong>v4</strong> is purely random — the safest default.
            <strong>v7</strong> embeds a millisecond timestamp, so ids sort chronologically and index
            far better in databases. <strong>ULID</strong> offers the same property in a shorter,
            case-insensitive base32 form.
          </p>
        </ToolPanel>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.split--work {
  flex: 1 1 auto;
  min-height: 420px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.input--narrow {
  width: 96px;
}

.checkbox--aligned {
  align-self: flex-end;
  padding-bottom: 5px;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.info__row {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  padding: 4px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.info__row dt {
  flex: 0 0 90px;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.info__row dd {
  margin: 0;
  color: var(--accent);
  font-size: var(--fs-sm);
  word-break: break-all;
}

.hint strong {
  color: var(--text-muted);
}
</style>
