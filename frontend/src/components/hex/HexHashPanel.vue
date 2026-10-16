<script setup lang="ts">
/** Streaming hash and checksum generator. */
import { computed, ref } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import { formatSize, type HexTab, type HexWorkspace } from '@/composables/useHexEditor'
import { HASH_ALGORITHMS, createHasher } from '@/lib/hex/hashes'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

const WINDOW = 1 << 20

const selected = usePersistentState<string[]>('hex:hashes', ['crc-32', 'md5', 'sha-256'])
const scope = ref<'file' | 'selection'>('file')
const busy = ref(false)
const cancelled = ref(false)
const progress = ref(0)
const results = ref<Array<{ id: string; label: string; digest: string }>>([])
const elapsed = ref(0)

const selectionSize = computed(() => props.workspace.selectionSize(props.tab))

const groups = computed(() => {
  const map = new Map<string, typeof HASH_ALGORITHMS>()
  for (const algorithm of HASH_ALGORITHMS) {
    const list = map.get(algorithm.group) ?? []
    list.push(algorithm)
    map.set(algorithm.group, list)
  }
  return Array.from(map, ([name, items]) => ({ name, items }))
})

function toggle(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id]
}

async function run(): Promise<void> {
  const tab = props.tab
  const ids = selected.value
  if (ids.length === 0) return

  const ranges =
    scope.value === 'selection' && tab.selections.length > 0
      ? tab.selections.map((range) => ({ start: range.start, length: range.end - range.start }))
      : [{ start: 0, length: tab.size }]
  const total = ranges.reduce((sum, range) => sum + range.length, 0)

  const hashers = ids.map((id) => ({
    id,
    label: HASH_ALGORITHMS.find((item) => item.id === id)?.label ?? id,
    hasher: createHasher(id),
  }))

  busy.value = true
  cancelled.value = false
  progress.value = 0
  results.value = []
  const started = performance.now()
  let done = 0
  let sinceYield = 0

  try {
    for (const range of ranges) {
      let position = range.start
      const end = range.start + range.length
      while (position < end) {
        const bytes = await tab.doc.read(position, Math.min(WINDOW, end - position))
        if (bytes.length === 0) break
        for (const entry of hashers) entry.hasher.update(bytes)
        position += bytes.length
        done += bytes.length
        progress.value = total === 0 ? 100 : Math.round((done / total) * 100)
        sinceYield += bytes.length
        if (sinceYield >= 8 * WINDOW) {
          sinceYield = 0
          // Let the browser paint the progress on in-memory documents too.
          await new Promise((resolve) => window.setTimeout(resolve, 0))
        }
        if (cancelled.value) return
      }
    }
    results.value = hashers.map((entry) => ({
      id: entry.id,
      label: entry.label,
      digest: entry.hasher.digest(),
    }))
    elapsed.value = performance.now() - started
  } finally {
    busy.value = false
  }
}

const summary = computed(() =>
  results.value.map((item) => `${item.label}: ${item.digest}`).join('\n'),
)
</script>

<template>
  <div class="hashes">
    <div class="actions">
      <select v-model="scope" class="input">
        <option value="file">Whole file ({{ formatSize(tab.size) }})</option>
        <option value="selection" :disabled="selectionSize === 0">
          Selection ({{ formatSize(selectionSize) }})
        </option>
      </select>
      <AppButton size="sm" icon="play" :disabled="busy || selected.length === 0" @click="run()">
        Calculate
      </AppButton>
      <AppButton v-if="busy" size="sm" variant="danger" icon="x" @click="cancelled = true">
        Stop
      </AppButton>
    </div>

    <p v-if="busy" class="hint">hashing {{ progress }}%</p>

    <div v-if="results.length > 0" class="results">
      <div v-for="item in results" :key="item.id" class="result">
        <span class="result__label">{{ item.label }}</span>
        <code class="result__value">{{ item.digest }}</code>
        <CopyButton :value="item.digest" label="" size="sm" />
      </div>
      <p class="hint">
        computed in {{ (elapsed / 1000).toFixed(2) }} s
        <CopyButton :value="summary" size="sm" label="Copy all" />
      </p>
    </div>

    <section v-for="group in groups" :key="group.name">
      <h3>{{ group.name }}</h3>
      <div class="chips">
        <button
          v-for="algorithm in group.items"
          :key="algorithm.id"
          type="button"
          class="chip"
          :class="{ 'is-active': selected.includes(algorithm.id) }"
          @click="toggle(algorithm.id)"
        >
          {{ algorithm.label }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hashes {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

h3 {
  margin: 0 0 var(--sp-1);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.actions {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  flex-wrap: wrap;
}

.input {
  flex: 1 1 0;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.chip {
  padding: 2px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: all var(--transition);
}

.chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.is-active {
  border-color: var(--accent-dim);
  background: var(--accent-ghost);
  color: var(--accent);
}

.results {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.result {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: 3px 5px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-size: var(--fs-xs);
}

.result__label {
  flex: 0 0 7.5em;
  color: var(--text-muted);
}

.result__value {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--accent);
  overflow-wrap: anywhere;
}

.hint {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  margin: var(--sp-1) 0 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}
</style>
