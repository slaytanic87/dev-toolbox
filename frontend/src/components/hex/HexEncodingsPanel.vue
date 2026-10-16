<script setup lang="ts">
/** Shows the bytes at the caret or selection in every supported code page at once. */
import { computed, ref, watch } from 'vue'

import CopyButton from '@/components/ui/CopyButton.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import type { HexTab, HexWorkspace } from '@/composables/useHexEditor'
import { ENCODINGS, decodeText, displayChar } from '@/lib/hex/encodings'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

const MAX_BYTES = 128

const length = usePersistentState('hex:compare:length', 24)
const filter = ref('')
const bytes = ref<Uint8Array>(new Uint8Array(0))

const start = computed(() => props.tab.selections[0]?.start ?? props.tab.caret)
const count = computed(() => {
  const selection = props.tab.selections[0]
  if (selection) return Math.min(selection.end - selection.start, MAX_BYTES)
  return Math.min(length.value, MAX_BYTES)
})

watch(
  () => [props.tab.id, props.tab.version, start.value, count.value],
  async () => {
    bytes.value = await props.tab.doc.read(start.value, count.value)
  },
  { immediate: true },
)

const rows = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  return ENCODINGS.filter(
    (encoding) =>
      needle === '' ||
      encoding.label.toLowerCase().includes(needle) ||
      encoding.id.includes(needle),
  ).map((encoding) => ({
    id: encoding.id,
    label: encoding.label,
    text: Array.from(decodeText(bytes.value, encoding.id), (char) => displayChar(char)).join(''),
  }))
})

const preview = computed(() =>
  Array.from(bytes.value, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '),
)
</script>

<template>
  <div class="compare">
    <p class="source">
      <span>{{ count }} byte(s) at 0x{{ start.toString(16).toUpperCase() }}</span>
      <label v-if="tab.selections.length === 0" class="length">
        length
        <input v-model.number="length" type="number" min="1" :max="MAX_BYTES" class="input" />
      </label>
    </p>
    <code class="preview">{{ preview }}</code>

    <input v-model="filter" class="input input--filter" placeholder="filter encodings" />

    <ul class="rows">
      <li v-for="row in rows" :key="row.id">
        <span class="rows__label">{{ row.label }}</span>
        <span class="rows__text">{{ row.text }}</span>
        <CopyButton :value="row.text" label="" size="sm" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.compare {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.source {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  justify-content: space-between;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.length {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--text-dim);
}

.input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  width: 5em;
}

.input--filter {
  width: 100%;
}

.preview {
  display: block;
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--accent);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
  max-height: 80px;
  overflow: auto;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rows li {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: 2px 4px;
  border-bottom: 1px solid var(--border-soft);
  font-size: var(--fs-xs);
}

.rows__label {
  flex: 0 0 11em;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows__text {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--cyan);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
