<script setup lang="ts">
/**
 * Key pair section shared by the certificate and CSR forms: either let the
 * backend generate a fresh key, or paste/drop an existing one.
 */
import { computed, ref } from 'vue'

import ArtifactActions from '@/components/certificates/ArtifactActions.vue'
import CodeEditor from '@/components/editor/CodeEditor.vue'
import AppButton from '@/components/ui/AppButton.vue'
import DropZone from '@/components/ui/DropZone.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import { useToast } from '@/composables/useToast'
import {
  createKey,
  KEY_ALGORITHMS,
  KEY_ALGORITHM_LABELS,
  KEY_FORMATS,
  PUBLIC_KEY_FORMATS,
  type KeyInput,
  type KeyMaterial,
  type KeySource,
} from '@/lib/certificates'

const props = withDefaults(defineProps<{ title?: string; baseName?: string }>(), {
  title: 'Key pair',
  baseName: 'private-key',
})

const key = defineModel<KeyInput>({ required: true })
const emit = defineEmits<{ generated: [material: KeyMaterial] }>()

const toast = useToast()

const SOURCES: Array<{ value: KeySource; label: string; title: string }> = [
  { value: 'generate', label: 'generate', title: 'Create a new key pair while issuing' },
  { value: 'manual', label: 'paste / import', title: 'Use an existing private key' },
]

const ALGORITHM_OPTIONS = KEY_ALGORITHMS.map((value) => ({
  value,
  label: KEY_ALGORITHM_LABELS[value],
}))

const busy = ref(false)
const error = ref<string | null>(null)
const inspected = ref<KeyMaterial | null>(null)

const privateKey = computed({
  get: () => key.value.private_key ?? '',
  set: (value: string) => {
    if (value === key.value.private_key) return
    key.value = { ...key.value, private_key: value }
    // Keep the result when the editor only echoes the key we just validated.
    if (value.trim() !== inspected.value?.private_key_pem.trim()) {
      inspected.value = null
      error.value = null
    }
  },
})

async function generateNow(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const material = await createKey({ algorithm: key.value.algorithm ?? 'ecdsa-p256' })
    key.value = { source: 'manual', algorithm: key.value.algorithm, private_key: material.private_key_pem }
    inspected.value = material
    emit('generated', material)
    toast.success(`${material.algorithm_label} key pair created`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function inspect(): Promise<void> {
  if (privateKey.value.trim() === '') {
    error.value = 'Paste a private key first.'
    return
  }
  busy.value = true
  error.value = null
  try {
    const material = await createKey({ private_key: privateKey.value })
    inspected.value = material
    key.value = { ...key.value, source: 'manual', private_key: material.private_key_pem }
    toast.success(`Recognised a ${material.algorithm_label} key`)
  } catch (cause) {
    inspected.value = null
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function onFiles(files: File[]): Promise<void> {
  const file = files[0]
  if (!file) return
  const buffer = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder().decode(buffer)
  privateKey.value = text.includes('-----BEGIN')
    ? text
    : btoa(String.fromCharCode(...buffer))
  key.value = { ...key.value, source: 'manual' }
  await inspect()
}

function clear(): void {
  key.value = { source: 'generate', algorithm: key.value.algorithm ?? 'ecdsa-p256', private_key: '' }
  inspected.value = null
  error.value = null
}
</script>

<template>
  <ToolPanel icon="key" :title="props.title" :subtitle="key.source === 'generate' ? 'a fresh key is created on issue' : 'using the supplied key'">
    <template #actions>
      <AppButton size="sm" icon="trash" title="Reset the key section" @click="clear">Reset</AppButton>
    </template>

    <div class="row">
      <SegmentedControl v-model="key.source" :options="SOURCES" />
      <label class="field">
        <span class="label">algorithm</span>
        <select v-model="key.algorithm" class="select select--algo" :disabled="key.source === 'manual' && !!inspected">
          <option v-for="option in ALGORITHM_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <span class="grow" />
      <AppButton
        v-if="key.source === 'generate'"
        variant="primary"
        size="sm"
        icon="refresh"
        :disabled="busy"
        @click="generateNow"
      >
        Generate now
      </AppButton>
      <AppButton v-else size="sm" icon="search" :disabled="busy" @click="inspect">Validate key</AppButton>
    </div>

    <template v-if="key.source === 'manual'">
      <CodeEditor
        v-model="privateKey"
        language="text"
        min-height="150px"
        max-height="260px"
        placeholder="-----BEGIN PRIVATE KEY-----&#10;…&#10;-----END PRIVATE KEY-----&#10;&#10;PKCS#8, SEC1 (EC) and PKCS#1 (RSA) PEM are accepted, as is base64 encoded DER."
      />
      <DropZone
        accept=".pem,.key,.der,.p8,application/x-pem-file,application/octet-stream"
        icon="upload"
        @files="onFiles"
      >
        <template #title>Drop a private key file or click to browse</template>
        <template #hint>.pem, .key, .der &middot; PKCS#8, SEC1 or PKCS#1</template>
      </DropZone>
    </template>

    <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>

    <template v-if="inspected">
      <StatusNote tone="ok">
        {{ inspected?.algorithm_label }} key ready — {{ inspected?.algorithm }}
      </StatusNote>
      <ArtifactActions
        :pem="inspected.private_key_pem"
        :der="inspected.private_key_der"
        :base-name="props.baseName"
        :formats="KEY_FORMATS"
        copy-label="copy private key"
      />
      <details class="public">
        <summary>public key</summary>
        <pre class="mono-out">{{ inspected.public_key_pem }}</pre>
        <ArtifactActions
          :pem="inspected.public_key_pem"
          :der="inspected.public_key_der"
          :base-name="`${props.baseName}-public`"
          :formats="PUBLIC_KEY_FORMATS"
          copy-label="copy public key"
        />
      </details>
    </template>

    <p v-else class="hint">
      Ed25519 and ECDSA keys are small and fast; RSA stays the safest bet for legacy clients and
      Java keystores. Generated keys never leave this machine - they are produced by the local
      backend and handed back to the browser.
    </p>
  </ToolPanel>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.select--algo {
  width: 180px;
}

.public {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: var(--sp-2);
}

.public summary {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.public pre {
  margin: var(--sp-2) 0;
  max-height: 180px;
  overflow: auto;
}
</style>
