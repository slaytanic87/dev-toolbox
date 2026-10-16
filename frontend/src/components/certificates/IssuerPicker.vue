<script setup lang="ts">
/** Picks the issuing CA: either one stored in the vault or a pasted PEM pair. */
import CodeEditor from '@/components/editor/CodeEditor.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import {
  useCertificateVault,
  type IssuerSelection,
  type VaultItem,
} from '@/composables/useCertificateVault'
import { commonNameOf } from '@/lib/certificates'

const selection = defineModel<IssuerSelection>({ required: true })

const { authorities } = useCertificateVault()

const SOURCES: Array<{ value: IssuerSelection['source']; label: string; title: string }> = [
  { value: 'vault', label: 'from vault', title: 'Use a CA created earlier in this browser' },
  { value: 'manual', label: 'paste PEM', title: 'Paste an existing CA certificate and key' },
]

function describe(item: VaultItem): string {
  const name = commonNameOf(item.subject, item.label)
  return name === item.label ? item.label : `${item.label} · ${name}`
}
</script>

<template>
  <div class="issuer">
    <div class="row">
      <SegmentedControl v-model="selection.source" :options="SOURCES" size="sm" />
      <select
        v-if="selection.source === 'vault'"
        v-model="selection.vaultId"
        class="select issuer__select"
      >
        <option value="">— select a certificate authority —</option>
        <option v-for="item in authorities" :key="item.id" :value="item.id">
          {{ describe(item) }}
        </option>
      </select>
    </div>

    <StatusNote v-if="selection.source === 'vault' && authorities.length === 0" tone="warn">
      No CA with a private key is stored yet — issue a Root CA first or paste one.
    </StatusNote>

    <template v-if="selection.source === 'manual'">
      <div>
        <span class="label">issuer certificate (PEM or base64 DER)</span>
        <CodeEditor
          v-model="selection.certificate_pem"
          language="text"
          min-height="120px"
          max-height="200px"
          placeholder="-----BEGIN CERTIFICATE-----"
        />
      </div>
      <div>
        <span class="label">issuer private key</span>
        <CodeEditor
          v-model="selection.private_key"
          language="text"
          min-height="120px"
          max-height="200px"
          placeholder="-----BEGIN PRIVATE KEY-----"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.issuer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.issuer__select {
  flex: 1 1 260px;
  width: auto;
}
</style>
