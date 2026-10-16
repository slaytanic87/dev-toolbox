<script setup lang="ts">
/** Distinguished name plus subject alternative name editor. */
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import ToolPanel from '@/components/ui/ToolPanel.vue'
import type { SanInput, SanKind, SubjectInput } from '@/lib/certificates'

const subject = defineModel<SubjectInput>('subject', { required: true })
const sans = defineModel<SanInput[]>('sans', { required: true })

withDefaults(defineProps<{ showSans?: boolean }>(), { showSans: true })

const SAN_KINDS: Array<{ value: SanKind; label: string; placeholder: string }> = [
  { value: 'dns', label: 'DNS', placeholder: 'app.example.com' },
  { value: 'ip', label: 'IP', placeholder: '192.168.1.10' },
  { value: 'email', label: 'EMAIL', placeholder: 'dev@example.com' },
  { value: 'uri', label: 'URI', placeholder: 'https://example.com/api' },
]

const FIELDS: Array<{ key: keyof SubjectInput; label: string; placeholder: string }> = [
  { key: 'common_name', label: 'common name (CN)', placeholder: 'app.example.com' },
  { key: 'organization', label: 'organization (O)', placeholder: 'Example GmbH' },
  { key: 'organizational_unit', label: 'org. unit (OU)', placeholder: 'Platform Engineering' },
  { key: 'country', label: 'country (C)', placeholder: 'DE' },
  { key: 'state', label: 'state (ST)', placeholder: 'Bavaria' },
  { key: 'locality', label: 'locality (L)', placeholder: 'Munich' },
]

function placeholderFor(kind: SanKind): string {
  return SAN_KINDS.find((entry) => entry.value === kind)?.placeholder ?? ''
}

function addSan(): void {
  sans.value = [...sans.value, { kind: 'dns', value: '' }]
}

function removeSan(index: number): void {
  sans.value = sans.value.filter((_, position) => position !== index)
}

function useCommonNameAsSan(): void {
  const name = subject.value.common_name.trim()
  if (name === '') return
  if (sans.value.some((entry) => entry.value === name)) return
  sans.value = [...sans.value, { kind: /^[\d.:]+$/.test(name) ? 'ip' : 'dns', value: name }]
}
</script>

<template>
  <ToolPanel icon="fingerprint" title="Subject" subtitle="distinguished name & SAN">
    <div class="grid">
      <label v-for="field in FIELDS" :key="field.key" class="field">
        <span class="label">{{ field.label }}</span>
        <input
          v-model="subject[field.key]"
          class="input"
          :placeholder="field.placeholder"
          spellcheck="false"
        />
      </label>
    </div>

    <template v-if="showSans">
      <div class="row">
        <span class="label label--inline">subject alternative names</span>
        <span class="grow" />
        <AppButton size="sm" icon="wand" title="Add the common name as SAN" @click="useCommonNameAsSan">
          CN as SAN
        </AppButton>
        <AppButton size="sm" icon="plus" @click="addSan">Add</AppButton>
      </div>

      <div v-if="sans.length > 0" class="sans">
        <div v-for="(entry, index) in sans" :key="index" class="sans__row">
          <select v-model="entry.kind" class="select sans__kind">
            <option v-for="kind in SAN_KINDS" :key="kind.value" :value="kind.value">
              {{ kind.label }}
            </option>
          </select>
          <input
            v-model="entry.value"
            class="input"
            :placeholder="placeholderFor(entry.kind)"
            spellcheck="false"
          />
          <button type="button" class="sans__remove" title="Remove" @click="removeSan(index)">
            <AppIcon name="x" :size="13" />
          </button>
        </div>
      </div>

      <p v-else class="hint">
        Modern browsers ignore the common name entirely - add at least one DNS or IP entry for TLS
        certificates.
      </p>
    </template>
  </ToolPanel>
</template>

<style scoped>
.grid {
  display: grid;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
}

.field {
  display: flex;
  flex-direction: column;
}

.label--inline {
  margin-bottom: 0;
}

.sans {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.sans__row {
  display: grid;
  grid-template-columns: 96px 1fr 28px;
  gap: var(--sp-1);
  align-items: center;
}

.sans__kind {
  width: 96px;
}

.sans__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text-dim);
  cursor: pointer;
}

.sans__remove:hover {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
