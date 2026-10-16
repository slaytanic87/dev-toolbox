<script setup lang="ts">
/** File information, magic byte identification, histogram and statistics. */
import { computed, onMounted, ref, watch } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { formatSize, type HexTab, type HexWorkspace } from '@/composables/useHexEditor'
import { IDENTIFY_WINDOW, identify, type FormatMatch } from '@/lib/hex/signatures'
import { analyse, entropyVerdict, type ByteStatistics } from '@/lib/hex/stats'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

const formats = ref<FormatMatch[]>([])
const stats = ref<ByteStatistics | null>(null)
const scope = ref<'file' | 'selection'>('file')
const busy = ref(false)
const cancelled = ref(false)
const progress = ref(0)
const canvas = ref<HTMLCanvasElement | null>(null)

const selectionSize = computed(() => props.workspace.selectionSize(props.tab))

watch(
  () => [props.tab.id, props.tab.version],
  async () => {
    const head = await props.tab.doc.read(0, IDENTIFY_WINDOW)
    formats.value = identify(head).slice(0, 6)
  },
  { immediate: true },
)

watch(
  () => props.tab.id,
  () => {
    stats.value = null
  },
)

async function run(): Promise<void> {
  const tab = props.tab
  const ranges =
    scope.value === 'selection' && tab.selections.length > 0
      ? tab.selections.map((range) => ({ start: range.start, length: range.end - range.start }))
      : [{ start: 0, length: tab.size }]

  busy.value = true
  cancelled.value = false
  progress.value = 0
  try {
    stats.value = await analyse(tab.doc, ranges, {
      onProgress: (scanned, total) => {
        progress.value = total === 0 ? 100 : Math.round((scanned / total) * 100)
      },
      shouldCancel: () => cancelled.value,
    })
  } finally {
    busy.value = false
  }
}

function draw(): void {
  const element = canvas.value
  const data = stats.value
  if (!element) return
  const context = element.getContext('2d')
  if (!context) return

  const width = (element.width = element.clientWidth * window.devicePixelRatio)
  const height = (element.height = 120 * window.devicePixelRatio)
  context.clearRect(0, 0, width, height)
  if (!data || data.total === 0) return

  const peak = Math.max(...data.counts)
  const barWidth = width / 256
  for (let value = 0; value < 256; value++) {
    const bar = peak === 0 ? 0 : (data.counts[value]! / peak) * (height - 2)
    const printable = value >= 0x20 && value < 0x7f
    context.fillStyle = value === 0 ? '#4d6a70' : printable ? '#19e3ff' : '#00ff9c'
    context.fillRect(value * barWidth, height - bar, Math.max(1, barWidth - 0.5), bar)
  }
}

watch(stats, () => draw())
onMounted(() => draw())

function percent(part: number, total: number): string {
  return total === 0 ? '0%' : `${((part / total) * 100).toFixed(1)}%`
}

const info = computed(() => {
  const tab = props.tab
  return [
    { label: 'Name', value: tab.name },
    { label: 'Size', value: `${formatSize(tab.size)} (${tab.size.toLocaleString()} bytes)` },
    { label: 'Source', value: tab.origin },
    { label: 'Modified', value: tab.modified ? 'yes - unsaved changes' : 'no' },
    { label: 'Edit pieces', value: String(tab.doc.pieceCount) },
    { label: 'Undo steps', value: `${tab.doc.undoDepth} / redo ${tab.doc.redoDepth}` },
    ...(tab.recordInfo
      ? [
          {
            label: 'Record file',
            value: `${tab.recordInfo.format === 'srec' ? 'Motorola S-Record' : 'Intel HEX'} @ 0x${tab.recordInfo.baseAddress.toString(16).toUpperCase()}, ${tab.recordInfo.segments} segment(s)`,
          },
        ]
      : []),
  ]
})
</script>

<template>
  <div class="analysis">
    <section>
      <h3>Document</h3>
      <dl>
        <template v-for="item in info" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </template>
      </dl>
    </section>

    <section>
      <h3>Format identification</h3>
      <ul v-if="formats.length > 0" class="formats">
        <li v-for="format in formats" :key="`${format.name}-${format.offset}`">
          <strong>{{ format.name }}</strong>
          <span>.{{ format.extension }} &middot; {{ format.mime }}</span>
          <span class="formats__offset">
            magic at 0x{{ format.offset.toString(16).toUpperCase() }}
          </span>
        </li>
      </ul>
      <StatusNote v-else tone="muted">
        No known magic bytes - the content does not match any of the built-in signatures.
      </StatusNote>
    </section>

    <section>
      <h3>Statistics &amp; histogram</h3>
      <div class="actions">
        <select v-model="scope" class="input">
          <option value="file">Whole file</option>
          <option value="selection" :disabled="selectionSize === 0">
            Selection ({{ formatSize(selectionSize) }})
          </option>
        </select>
        <AppButton size="sm" icon="play" :disabled="busy" @click="run()">Analyse</AppButton>
        <AppButton v-if="busy" size="sm" variant="danger" icon="x" @click="cancelled = true">
          Stop
        </AppButton>
      </div>
      <p v-if="busy" class="hint">scanning {{ progress }}%</p>

      <canvas ref="canvas" class="histogram" height="120" />

      <dl v-if="stats && stats.total > 0">
        <dt>Bytes</dt>
        <dd>{{ stats.total.toLocaleString() }}</dd>
        <dt>Entropy</dt>
        <dd>{{ stats.entropy.toFixed(4) }} bit/byte - {{ entropyVerdict(stats.entropy) }}</dd>
        <dt>Mean</dt>
        <dd>{{ stats.mean.toFixed(3) }}</dd>
        <dt>Median</dt>
        <dd>{{ stats.median }}</dd>
        <dt>Variance</dt>
        <dd>{{ stats.variance.toFixed(3) }}</dd>
        <dt>Std. deviation</dt>
        <dd>{{ stats.standardDeviation.toFixed(3) }}</dd>
        <dt>Min / max</dt>
        <dd>{{ stats.min }} / {{ stats.max }}</dd>
        <dt>Distinct values</dt>
        <dd>{{ stats.unique }} of 256</dd>
        <dt>Null bytes</dt>
        <dd>{{ stats.nullBytes.toLocaleString() }} ({{ percent(stats.nullBytes, stats.total) }})</dd>
        <dt>Printable</dt>
        <dd>{{ stats.printable.toLocaleString() }} ({{ percent(stats.printable, stats.total) }})</dd>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.analysis {
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

dl {
  display: grid;
  grid-template-columns: minmax(0, 8.5em) minmax(0, 1fr);
  gap: 1px var(--sp-2);
  margin: 0;
  font-size: var(--fs-xs);
}

dt {
  color: var(--text-muted);
}

dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.formats {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-xs);
}

.formats li {
  display: flex;
  flex-direction: column;
  padding: 4px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}

.formats strong {
  color: var(--accent);
  font-weight: 600;
}

.formats span {
  color: var(--text-muted);
}

.formats__offset {
  color: var(--text-dim);
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

.histogram {
  width: 100%;
  height: 120px;
  margin: var(--sp-2) 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}

.hint {
  margin: var(--sp-1) 0 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}
</style>
