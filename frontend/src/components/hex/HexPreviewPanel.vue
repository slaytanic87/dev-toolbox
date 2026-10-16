<script setup lang="ts">
/** Live preview of the document (or the selection) as image, media, PDF or text. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import { formatSize, type HexTab, type HexWorkspace } from '@/composables/useHexEditor'
import { IDENTIFY_WINDOW, identify } from '@/lib/hex/signatures'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

/** Text is decoded in the tab, so it is capped. Media stays a blob reference. */
const MAX_TEXT = 1 << 20

const auto = usePersistentState('hex:preview:auto', true)
const scope = ref<'file' | 'selection'>('file')
const mime = ref('application/octet-stream')
const url = ref<string | null>(null)
const text = ref<string | null>(null)
const error = ref<string | null>(null)
const size = ref(0)

const kind = computed(() => {
  const type = mime.value
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('text/') || type.endsWith('xml') || type.endsWith('json')) return 'text'
  return 'binary'
})

function release(): void {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = null
}

async function refresh(): Promise<void> {
  const tab = props.tab
  const selection = tab.selections[0]
  const start = scope.value === 'selection' && selection ? selection.start : 0
  const length =
    scope.value === 'selection' && selection
      ? tab.selections.at(-1)!.end - start
      : tab.size

  error.value = null
  text.value = null
  size.value = length
  release()

  if (length === 0) {
    mime.value = 'application/octet-stream'
    return
  }

  const head = await tab.doc.read(start, Math.min(IDENTIFY_WINDOW, length))
  mime.value = identify(head)[0]?.mime ?? sniffText(head)

  if (kind.value === 'text') {
    const bytes = await tab.doc.read(start, Math.min(MAX_TEXT, length))
    text.value = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (length > MAX_TEXT) text.value += `\n\n... truncated at ${formatSize(MAX_TEXT)}`
    return
  }

  if (kind.value === 'binary') return
  url.value = URL.createObjectURL(tab.doc.rangeToBlob(start, length, mime.value))
}

/** Falls back to "looks like text" when no magic byte matched. */
function sniffText(head: Uint8Array): string {
  const sample = head.subarray(0, 512)
  if (sample.length === 0) return 'application/octet-stream'
  let printable = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 0x20 && byte !== 0x7f)) printable++
  }
  return printable / sample.length > 0.9 ? 'text/plain' : 'application/octet-stream'
}

watch(
  () => [props.tab.id, props.tab.version, scope.value],
  () => {
    if (auto.value || url.value === null) void refresh()
  },
  { immediate: true },
)

onBeforeUnmount(release)

function popOut(): void {
  const tab = props.tab
  const selection = tab.selections[0]
  const start = scope.value === 'selection' && selection ? selection.start : 0
  const length =
    scope.value === 'selection' && selection ? tab.selections.at(-1)!.end - start : tab.size
  if (length === 0) return
  // Its own URL: the panel revokes its one on every refresh.
  const popupUrl = URL.createObjectURL(tab.doc.rangeToBlob(start, length, mime.value))
  const opened = window.open(popupUrl, '_blank', 'width=900,height=700')
  if (!opened) {
    URL.revokeObjectURL(popupUrl)
    error.value = 'The browser blocked the preview window.'
    return
  }
  window.setTimeout(() => URL.revokeObjectURL(popupUrl), 60_000)
}
</script>

<template>
  <div class="preview">
    <div class="actions">
      <select v-model="scope" class="input">
        <option value="file">Whole file</option>
        <option value="selection" :disabled="tab.selections.length === 0">Selection</option>
      </select>
      <AppButton size="sm" variant="ghost" icon="refresh" @click="refresh()">Refresh</AppButton>
      <AppButton
        size="sm"
        variant="ghost"
        icon="external"
        :disabled="!url"
        title="Open the preview in its own window"
        @click="popOut()"
      >
        Pop out
      </AppButton>
      <label class="check">
        <input v-model="auto" type="checkbox" />
        <span>Live</span>
      </label>
    </div>

    <p class="meta">{{ mime }} &middot; {{ formatSize(size) }}</p>

    <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>

    <div class="stage">
      <img v-if="kind === 'image' && url" :src="url" alt="preview" />
      <video v-else-if="kind === 'video' && url" :src="url" controls />
      <audio v-else-if="kind === 'audio' && url" :src="url" controls />
      <iframe v-else-if="kind === 'pdf' && url" :src="url" title="preview" />
      <pre v-else-if="kind === 'text' && text !== null">{{ text }}</pre>
      <StatusNote v-else tone="muted">
        No preview for this content type - images, audio, video, PDF, SVG and text are supported.
      </StatusNote>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-height: 0;
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

.check {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.meta {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  overflow: auto;
}

.stage img {
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
  image-rendering: pixelated;
}

.stage video {
  max-width: 100%;
  max-height: 420px;
}

.stage audio,
.stage iframe {
  width: 100%;
}

.stage iframe {
  height: 420px;
  border: none;
}

.stage pre {
  margin: 0;
  width: 100%;
  max-height: 420px;
  overflow: auto;
  color: var(--text);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
