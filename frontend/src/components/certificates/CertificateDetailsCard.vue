<script setup lang="ts">
/** Read-only summary of a parsed X.509 certificate. */
import { computed } from 'vue'

import type { CertificateDetails } from '@/lib/certificates'

const props = defineProps<{ details: CertificateDetails }>()

const expiry = computed(() => {
  const end = new Date(props.details.not_after).getTime()
  const days = Math.round((end - Date.now()) / 86_400_000)
  if (Number.isNaN(days)) return { tone: 'muted', text: props.details.not_after }
  if (days < 0) return { tone: 'danger', text: `expired ${Math.abs(days)} day(s) ago` }
  if (days < 30) return { tone: 'warn', text: `expires in ${days} day(s)` }
  return { tone: 'ok', text: `valid for ${days} more day(s)` }
})

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
</script>

<template>
  <dl class="info">
    <div class="info__row">
      <dt>subject</dt>
      <dd>{{ details.subject }}</dd>
    </div>
    <div class="info__row">
      <dt>issuer</dt>
      <dd>{{ details.issuer }}{{ details.self_signed ? ' (self-signed)' : '' }}</dd>
    </div>
    <div class="info__row">
      <dt>serial</dt>
      <dd>{{ details.serial_number }}</dd>
    </div>
    <div class="info__row">
      <dt>valid from</dt>
      <dd>{{ formatDate(details.not_before) }}</dd>
    </div>
    <div class="info__row">
      <dt>valid to</dt>
      <dd>
        {{ formatDate(details.not_after) }}
        <span class="badge" :class="`badge--${expiry.tone}`">{{ expiry.text }}</span>
      </dd>
    </div>
    <div class="info__row">
      <dt>basic constraints</dt>
      <dd>
        CA:{{ details.is_ca ? 'TRUE' : 'FALSE' }}
        <template v-if="details.path_length !== null && details.path_length !== undefined">
          · pathlen:{{ details.path_length }}
        </template>
      </dd>
    </div>
    <div v-if="details.subject_alt_names.length > 0" class="info__row">
      <dt>SAN</dt>
      <dd>{{ details.subject_alt_names.join(', ') }}</dd>
    </div>
    <div v-if="details.key_usages.length > 0" class="info__row">
      <dt>key usage</dt>
      <dd>{{ details.key_usages.join(', ') }}</dd>
    </div>
    <div v-if="details.extended_key_usages.length > 0" class="info__row">
      <dt>ext. key usage</dt>
      <dd>{{ details.extended_key_usages.join(', ') }}</dd>
    </div>
    <div class="info__row">
      <dt>public key</dt>
      <dd>{{ details.public_key_algorithm }}</dd>
    </div>
    <div class="info__row">
      <dt>signature</dt>
      <dd>{{ details.signature_algorithm }}</dd>
    </div>
    <div class="info__row">
      <dt>sha-256</dt>
      <dd class="info__fingerprint">{{ details.sha256_fingerprint }}</dd>
    </div>
    <div class="info__row">
      <dt>sha-1</dt>
      <dd class="info__fingerprint">{{ details.sha1_fingerprint }}</dd>
    </div>
  </dl>
</template>

<style scoped>
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
  flex: 0 0 120px;
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

.info__fingerprint {
  font-size: var(--fs-xs);
}

.badge {
  margin-left: var(--sp-2);
  padding: 1px 6px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.badge--ok {
  background: var(--accent-ghost);
  color: var(--ok);
}

.badge--warn {
  background: var(--accent-ghost);
  color: var(--warn);
}

.badge--danger {
  background: var(--danger-ghost);
  color: var(--danger);
}

.badge--muted {
  color: var(--text-dim);
}
</style>
