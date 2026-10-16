<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import SplitPane from '@/components/layout/SplitPane.vue'
import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import DropZone from '@/components/ui/DropZone.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { downloadDataUrl, downloadText } from '@/composables/useClipboard'
import { useImagePaste, isImageFile } from '@/composables/useImagePaste'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import { formatBytes } from '@/lib/bytes'
import {
  DEFAULT_QR_OPTIONS,
  ERROR_CORRECTION_LEVELS,
  QR_TEMPLATES,
  decodeQrFromImageSource,
  renderQrToDataUrl,
  renderQrToSvg,
  type ErrorCorrectionLevel,
} from '@/lib/qr'

type Mode = 'encode' | 'decode'

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'encode', label: 'Encode' },
  { value: 'decode', label: 'Decode' },
]

const toast = useToast()

const mode = usePersistentState<Mode>('qr:mode', 'encode')

/* ---------------------------------------------------------------- encoding */

const templateId = usePersistentState('qr:template', 'text')
const fieldValues = usePersistentState<Record<string, string>>('qr:fields', {
  text: 'https://github.com',
})
const errorCorrection = usePersistentState<ErrorCorrectionLevel>('qr:ec', DEFAULT_QR_OPTIONS.errorCorrectionLevel)
const scale = usePersistentState('qr:scale', DEFAULT_QR_OPTIONS.scale)
const margin = usePersistentState('qr:margin', DEFAULT_QR_OPTIONS.margin)
const foreground = usePersistentState('qr:fg', DEFAULT_QR_OPTIONS.light)
const background = usePersistentState('qr:bg', DEFAULT_QR_OPTIONS.dark)

const template = computed(
  () => QR_TEMPLATES.find((item) => item.id === templateId.value) ?? (QR_TEMPLATES[0] as (typeof QR_TEMPLATES)[number]),
)
const payload = computed(() => template.value.build(fieldValues.value))

const qrDataUrl = ref('')
const qrSvg = ref('')
const encodeError = ref<string | null>(null)

const renderOptions = computed(() => ({
  errorCorrectionLevel: errorCorrection.value,
  margin: margin.value,
  scale: scale.value,
  dark: background.value,
  light: foreground.value,
}))

watch(
  [payload, renderOptions],
  async () => {
    encodeError.value = null
    if (payload.value === '') {
      qrDataUrl.value = ''
      qrSvg.value = ''
      return
    }
    try {
      const [dataUrl, svg] = await Promise.all([
        renderQrToDataUrl(payload.value, renderOptions.value),
        renderQrToSvg(payload.value, renderOptions.value),
      ])
      qrDataUrl.value = dataUrl
      qrSvg.value = svg
    } catch (error) {
      qrDataUrl.value = ''
      qrSvg.value = ''
      encodeError.value = error instanceof Error ? error.message : String(error)
    }
  },
  { immediate: true, deep: true },
)

function setField(key: string, value: string): void {
  fieldValues.value = { ...fieldValues.value, [key]: value }
}

function resetColors(): void {
  foreground.value = DEFAULT_QR_OPTIONS.light
  background.value = DEFAULT_QR_OPTIONS.dark
}

/* ---------------------------------------------------------------- decoding */

const decodedText = ref('')
const decodeError = ref<string | null>(null)
const decodeBusy = ref(false)
const previewUrl = shallowRef<string | null>(null)
const previewMeta = ref<string>('')
const remoteUrl = ref('')

async function decodeSource(source: Blob | string, meta: string): Promise<void> {
  decodeBusy.value = true
  decodeError.value = null
  decodedText.value = ''

  if (previewUrl.value?.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = typeof source === 'string' ? source : URL.createObjectURL(source)
  previewMeta.value = meta

  try {
    const result = await decodeQrFromImageSource(source)
    decodedText.value = result.text
    toast.success('QR code decoded')
  } catch (error) {
    decodeError.value = error instanceof Error ? error.message : String(error)
  } finally {
    decodeBusy.value = false
  }
}

function onFiles(files: File[]): void {
  const file = files.find(isImageFile)
  if (!file) {
    decodeError.value = 'That file is not an image.'
    return
  }
  void decodeSource(file, `${file.name} · ${formatBytes(file.size)}`)
}

function loadRemote(): void {
  const url = remoteUrl.value.trim()
  if (url === '') return
  void decodeSource(url, url)
}

/** Decodes the QR code that the encoder just produced - a quick round-trip check. */
function decodeOwnOutput(): void {
  if (!qrDataUrl.value) return
  mode.value = 'decode'
  void decodeSource(qrDataUrl.value, 'generated QR code')
}

useImagePaste({
  isEnabled: () => mode.value === 'decode',
  onFile: (file) => void decodeSource(file, `pasted image · ${formatBytes(file.size)}`),
  onUrl: (url) => void decodeSource(url, url),
})

const decodedIsUrl = computed(() => /^(https?|mailto|otpauth|tel):/i.test(decodedText.value))

function openDecoded(): void {
  if (decodedIsUrl.value) window.open(decodedText.value, '_blank', 'noopener,noreferrer')
}

function downloadPng(): void {
  if (qrDataUrl.value) downloadDataUrl('qrcode.png', qrDataUrl.value)
}

function downloadSvg(): void {
  if (qrSvg.value) downloadText('qrcode.svg', qrSvg.value, 'image/svg+xml')
}
</script>

<template>
  <div class="tool-view qr">
    <ToolPanel icon="qr" title="Mode">
      <div class="row">
        <SegmentedControl v-model="mode" :options="MODES" />
        <span class="grow" />
        <AppButton
          v-if="mode === 'encode'"
          size="sm"
          icon="refresh"
          :disabled="!qrDataUrl"
          @click="decodeOwnOutput"
        >
          Round-trip check
        </AppButton>
      </div>
    </ToolPanel>

    <!-- ============================ ENCODE ============================ -->
    <SplitPane v-if="mode === 'encode'" class="split--work" storage-key="qr:encode" :min-a="320" :min-b="300">
      <template #a>
        <ToolPanel icon="terminal" title="Payload">
          <template #actions><CopyButton :value="payload" label="copy payload" /></template>

          <label class="label" for="qr-template">payload type</label>
          <select id="qr-template" v-model="templateId" class="select">
            <option v-for="item in QR_TEMPLATES" :key="item.id" :value="item.id">
              {{ item.label }}
            </option>
          </select>

          <div v-for="field in template.fields" :key="field.key" class="field">
            <label class="label" :for="`qr-${field.key}`">{{ field.label }}</label>
            <textarea
              v-if="field.key === 'text' || field.key === 'body'"
              :id="`qr-${field.key}`"
              class="input textarea"
              rows="4"
              :placeholder="field.placeholder"
              :value="fieldValues[field.key] ?? ''"
              spellcheck="false"
              @input="setField(field.key, ($event.target as HTMLTextAreaElement).value)"
            />
            <input
              v-else
              :id="`qr-${field.key}`"
              class="input"
              :placeholder="field.placeholder"
              :value="fieldValues[field.key] ?? ''"
              spellcheck="false"
              @input="setField(field.key, ($event.target as HTMLInputElement).value)"
            />
          </div>

          <div class="preview-payload">
            <span class="label">encoded string ({{ payload.length }} chars)</span>
            <code class="mono-out">{{ payload || '—' }}</code>
          </div>
        </ToolPanel>
      </template>

      <template #b>
        <ToolPanel icon="qr" title="QR code" :subtitle="`EC level ${errorCorrection}`">
          <template #actions>
            <AppButton size="sm" icon="download" :disabled="!qrDataUrl" @click="downloadPng">
              PNG
            </AppButton>
            <AppButton size="sm" icon="download" :disabled="!qrSvg" @click="downloadSvg">
              SVG
            </AppButton>
          </template>

          <StatusNote v-if="encodeError" tone="error">{{ encodeError }}</StatusNote>

          <div class="qr-stage" :style="{ background }">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="Generated QR code" class="qr-stage__img" />
            <p v-else class="hint">Fill in the payload to generate a code.</p>
          </div>

          <div class="options">
            <div class="options__item">
              <label class="label" for="qr-ec">error correction</label>
              <select id="qr-ec" v-model="errorCorrection" class="select">
                <option v-for="level in ERROR_CORRECTION_LEVELS" :key="level.value" :value="level.value">
                  {{ level.label }}
                </option>
              </select>
            </div>
            <div class="options__item">
              <label class="label" for="qr-scale">scale ({{ scale }})</label>
              <input id="qr-scale" v-model.number="scale" type="range" min="2" max="20" />
            </div>
            <div class="options__item">
              <label class="label" for="qr-margin">quiet zone ({{ margin }})</label>
              <input id="qr-margin" v-model.number="margin" type="range" min="0" max="10" />
            </div>
            <div class="options__item options__item--colors">
              <span class="label">colours</span>
              <div class="row">
                <input v-model="foreground" type="color" class="color" title="Module colour" />
                <input v-model="background" type="color" class="color" title="Background colour" />
                <AppButton size="sm" variant="ghost" icon="refresh" @click="resetColors">
                  reset
                </AppButton>
              </div>
            </div>
          </div>
        </ToolPanel>
      </template>
    </SplitPane>

    <!-- ============================ DECODE ============================ -->
    <SplitPane v-else class="split--work" storage-key="qr:decode" :min-a="300" :min-b="300">
      <template #a>
        <ToolPanel icon="image" title="Source image" :subtitle="previewMeta">
          <DropZone accept="image/*" :disabled="decodeBusy" @files="onFiles">
            <template #title>
              Drop an image, press <kbd>Ctrl/Cmd</kbd>+<kbd>V</kbd> or click to browse
            </template>
          </DropZone>

          <div class="row">
            <input
              v-model="remoteUrl"
              class="input grow"
              placeholder="…or paste an image URL / data URI"
              spellcheck="false"
              @keydown.enter="loadRemote"
            />
            <AppButton size="sm" icon="external" :disabled="!remoteUrl" @click="loadRemote">
              Load
            </AppButton>
          </div>

          <div v-if="previewUrl" class="qr-stage qr-stage--preview">
            <img :src="previewUrl" alt="Image to decode" class="qr-stage__img" />
          </div>
        </ToolPanel>
      </template>

      <template #b>
        <ToolPanel icon="terminal" title="Decoded content" :tone="decodeError ? 'danger' : 'default'">
          <template #actions>
            <CopyButton :value="decodedText" label="copy" />
            <AppButton
              v-if="decodedIsUrl"
              size="sm"
              icon="external"
              @click="openDecoded"
            >
              Open
            </AppButton>
          </template>

          <StatusNote v-if="decodeBusy" tone="info">Scanning image…</StatusNote>
          <StatusNote v-else-if="decodeError" tone="error">{{ decodeError }}</StatusNote>
          <StatusNote v-else-if="decodedText" tone="ok">
            {{ decodedText.length }} characters decoded
          </StatusNote>

          <CodeEditor
            :model-value="decodedText"
            readonly
            :line-numbers="false"
            placeholder="decoded payload appears here"
            min-height="140px"
            class="grow"
          />

          <p class="hint">
            Images are processed with a canvas in this tab — nothing is uploaded anywhere.
          </p>
        </ToolPanel>
      </template>
    </SplitPane>
  </div>
</template>

<style scoped>
.qr {
  height: 100%;
}

.split--work {
  flex: 1 1 auto;
  min-height: 470px;
}

.field {
  display: flex;
  flex-direction: column;
}

.textarea {
  resize: vertical;
  font-size: var(--fs-sm);
  line-height: 1.5;
}

.preview-payload {
  margin-top: auto;
}

.qr-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 230px;
  padding: var(--sp-4);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
}

.qr-stage--preview {
  background: repeating-conic-gradient(var(--bg-panel-alt) 0% 25%, var(--bg-input) 0% 50%) 50% / 18px
    18px;
}

.qr-stage__img {
  max-width: 100%;
  max-height: 340px;
  image-rendering: pixelated;
}

.options {
  display: grid;
  gap: var(--sp-3);
  grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
}

.options__item {
  display: flex;
  flex-direction: column;
}

.options__item input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}

.color {
  width: 38px;
  height: 26px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  cursor: pointer;
}
</style>
