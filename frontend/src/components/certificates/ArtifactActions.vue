<script setup lang="ts">
/** Copy + download bar for a single artefact in every supported file format. */
import { downloadBlob, downloadText } from '@/composables/useClipboard'
import { derBlob, type DownloadFormat } from '@/lib/certificates'

import AppButton from '@/components/ui/AppButton.vue'
import CopyButton from '@/components/ui/CopyButton.vue'

const props = withDefaults(
  defineProps<{
    /** PEM text of the artefact. */
    pem: string
    /** Base64 encoded DER of the artefact - required for binary formats. */
    der?: string
    /** File name without extension. */
    baseName: string
    formats: DownloadFormat[]
    copyLabel?: string
  }>(),
  { der: '', copyLabel: 'copy PEM' },
)

function save(format: DownloadFormat): void {
  const name = `${props.baseName}.${format.extension}`
  if (format.encoding === 'der') {
    downloadBlob(name, derBlob(props.der))
  } else {
    downloadText(name, props.pem, 'application/x-pem-file')
  }
}

function isAvailable(format: DownloadFormat): boolean {
  return format.encoding === 'der' ? props.der !== '' : props.pem !== ''
}
</script>

<template>
  <div class="row artefact">
    <CopyButton :value="pem" :label="copyLabel" />
    <span class="artefact__label">save as</span>
    <AppButton
      v-for="format in formats"
      :key="format.extension + format.encoding"
      size="sm"
      icon="download"
      :title="format.title"
      :disabled="!isAvailable(format)"
      @click="save(format)"
    >
      {{ format.label }}
    </AppButton>
  </div>
</template>

<style scoped>
.artefact {
  gap: var(--sp-1);
}

.artefact__label {
  margin-left: var(--sp-2);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
</style>
