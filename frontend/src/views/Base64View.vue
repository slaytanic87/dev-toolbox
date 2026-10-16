<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import DropZone from '@/components/ui/DropZone.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { downloadBlob, downloadText } from '@/composables/useClipboard'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  bytesToText,
  formatBytes,
  textToBytes,
} from '@/lib/bytes'

type Direction = 'encode' | 'decode'
type Variant = 'standard' | 'url'

const DIRECTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'encode', label: 'Encode' },
  { value: 'decode', label: 'Decode' },
]
const VARIANTS: Array<{ value: Variant; label: string; title: string }> = [
  { value: 'standard', label: 'Base64', title: 'Standard alphabet with padding (+ /)' },
  { value: 'url', label: 'Base64URL', title: 'URL safe alphabet without padding (- _)' },
]

const toast = useToast()

const direction = usePersistentState<Direction>('base64:direction', 'encode')
const variant = usePersistentState<Variant>('base64:variant', 'standard')
const wrapLines = usePersistentState('base64:wrap76', false)
const input = usePersistentState('base64:input', 'Hello, DevToolbox! 🛠')

const fileName = ref<string | null>(null)
const fileBytes = ref<Uint8Array | null>(null)

interface Conversion {
  output: string
  bytes: Uint8Array | null
  error: string | null
}

const result = computed<Conversion>(() => convert())

function convert(): Conversion {
  const source = input.value
  if (source === '') return { output: '', bytes: null, error: null }

  try {
    if (direction.value === 'encode') {
      const bytes = fileBytes.value ?? textToBytes(source)
      const encoded =
        variant.value === 'url' ? bytesToBase64Url(bytes) : bytesToBase64(bytes)
      return { output: wrapLines.value ? chunk(encoded, 76) : encoded, bytes, error: null }
    }

    const bytes =
      variant.value === 'url' ? base64UrlToBytes(source) : base64ToBytes(source)
    return { output: bytesToText(bytes), bytes, error: null }
  } catch (error) {
    return {
      output: '',
      bytes: null,
      error:
        error instanceof Error && error.message.includes('decode')
          ? 'The decoded bytes are not valid UTF-8 text. Use "Download bytes" for binary payloads.'
          : error instanceof Error
            ? error.message
            : String(error),
    }
  }
}

function chunk(value: string, size: number): string {
  return value.replace(new RegExp(`.{1,${size}}`, 'g'), '$&\n').trimEnd()
}

const hexPreview = computed(() => {
  const bytes = result.value.bytes
  if (!bytes) return ''
  const head = bytes.subarray(0, 48)
  return bytesToHex(head) + (bytes.length > head.length ? ' …' : '')
})

const inputBytes = computed(() =>
  fileBytes.value ? fileBytes.value.length : textToBytes(input.value).length,
)

/** Editing the text by hand detaches the loaded file. */
watch(input, () => {
  if (fileBytes.value && input.value !== `[file] ${fileName.value}`) {
    fileBytes.value = null
    fileName.value = null
  }
})

watch(direction, () => {
  fileBytes.value = null
  fileName.value = null
})

function swap(): void {
  const next = result.value.output
  if (next === '' || result.value.error) {
    toast.error('Nothing to move to the input.')
    return
  }
  fileBytes.value = null
  fileName.value = null
  input.value = next
  direction.value = direction.value === 'encode' ? 'decode' : 'encode'
}

async function onFiles(files: File[]): Promise<void> {
  const file = files[0]
  if (!file) return
  const buffer = await file.arrayBuffer()
  fileBytes.value = new Uint8Array(buffer)
  fileName.value = file.name
  direction.value = 'encode'
  input.value = `[file] ${file.name}`
  toast.success(`Loaded ${file.name} (${formatBytes(file.size)})`)
}

function downloadOutput(): void {
  if (result.value.output === '') return
  downloadText(direction.value === 'encode' ? 'encoded.b64.txt' : 'decoded.txt', result.value.output)
}

function downloadBytes(): void {
  const bytes = result.value.bytes
  if (!bytes || direction.value !== 'decode') return
  downloadBlob('decoded.bin', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
}

function asDataUri(): void {
  const bytes = fileBytes.value
  if (!bytes || !fileName.value) {
    toast.error('Load a file first to build a data URI.')
    return
  }
  const mime = guessMime(fileName.value)
  void navigator.clipboard
    ?.writeText(`data:${mime};base64,${bytesToBase64(bytes)}`)
    .then(() => toast.success('Data URI copied to clipboard'))
    .catch(() => toast.error('Clipboard access was blocked.'))
}

function guessMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    json: 'application/json',
    txt: 'text/plain',
  }
  return map[extension] ?? 'application/octet-stream'
}

function clearAll(): void {
  input.value = ''
  fileBytes.value = null
  fileName.value = null
}
</script>

<template>
  <div class="tool-view base64">
    <ToolPanel icon="binary" title="Mode">
      <div class="row">
        <SegmentedControl v-model="direction" :options="DIRECTIONS" />
        <SegmentedControl v-model="variant" :options="VARIANTS" />
        <label class="checkbox">
          <input v-model="wrapLines" type="checkbox" :disabled="direction === 'decode'" />
          wrap at 76 chars (MIME)
        </label>
        <span class="grow" />
        <AppButton size="sm" icon="shuffle" @click="swap">Use output as input</AppButton>
        <AppButton size="sm" variant="danger" icon="trash" @click="clearAll">Clear</AppButton>
      </div>
    </ToolPanel>

    <SplitPane class="split--editors" storage-key="base64" :min-a="300" :min-b="300">
      <template #a>
        <ToolPanel
          icon="terminal"
          :title="direction === 'encode' ? 'Plain input' : 'Base64 input'"
          :subtitle="`${inputBytes} bytes`"
        >
          <template #actions>
            <CopyButton :value="input" label="copy" />
          </template>

          <CodeEditor
            v-model="input"
            :placeholder="
              direction === 'encode' ? 'Type or paste text…' : 'Paste a Base64 string…'
            "
            min-height="140px"
            :line-numbers="false"
            class="grow"
          />

          <DropZone v-if="direction === 'encode'" accept="*/*" @files="onFiles">
            <template #title>Drop any file to encode it</template>
            <template #hint>
              {{ fileName ? `loaded: ${fileName}` : 'binary safe · file never leaves the browser' }}
            </template>
          </DropZone>
        </ToolPanel>
      </template>

      <template #b>
        <ToolPanel
          icon="binary"
          :title="direction === 'encode' ? 'Base64 output' : 'Decoded output'"
          :subtitle="result.bytes ? `${formatBytes(result.bytes.length)} decoded` : ''"
          :tone="result.error ? 'danger' : 'default'"
        >
          <template #actions>
            <CopyButton :value="result.output" label="copy" />
            <AppButton size="sm" icon="download" :disabled="!result.output" @click="downloadOutput">
              .txt
            </AppButton>
            <AppButton
              v-if="direction === 'decode'"
              size="sm"
              icon="download"
              :disabled="!result.bytes"
              @click="downloadBytes"
            >
              bytes
            </AppButton>
            <AppButton v-else size="sm" icon="image" :disabled="!fileBytes" @click="asDataUri">
              data URI
            </AppButton>
          </template>

          <StatusNote v-if="result.error" tone="error">{{ result.error }}</StatusNote>

          <CodeEditor
            :model-value="result.output"
            readonly
            placeholder="output appears here"
            min-height="140px"
            :line-numbers="false"
            class="grow"
          />

          <div v-if="hexPreview" class="hex">
            <span class="label">hex preview</span>
            <code>{{ hexPreview }}</code>
          </div>
        </ToolPanel>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.base64 {
  height: 100%;
}

.split--editors {
  flex: 1 1 auto;
  min-height: 420px;
}

.hex {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hex code {
  display: block;
  padding: var(--sp-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--amber);
  font-size: var(--fs-xs);
  word-break: break-all;
}
</style>
