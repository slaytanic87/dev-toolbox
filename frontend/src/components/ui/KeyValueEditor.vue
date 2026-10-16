<script setup lang="ts">
/** Editable key/value table used for query params, headers and form fields. */
import { createEntry, type KeyValueEntry } from '@/lib/http'

import AppButton from './AppButton.vue'
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{ keyPlaceholder?: string; valuePlaceholder?: string; addLabel?: string }>(),
  { keyPlaceholder: 'name', valuePlaceholder: 'value', addLabel: 'Add row' },
)

const rows = defineModel<KeyValueEntry[]>({ required: true })

function addRow(): void {
  rows.value = [...rows.value, createEntry()]
}

function removeRow(id: string): void {
  const next = rows.value.filter((row) => row.id !== id)
  rows.value = next.length > 0 ? next : [createEntry()]
}

/** Typing in the last row automatically appends a fresh empty row. */
function onKeyInput(index: number): void {
  if (index === rows.value.length - 1) addRow()
}
</script>

<template>
  <div class="kv">
    <div class="kv__row kv__row--head">
      <span />
      <span class="kv__label">key</span>
      <span class="kv__label">value</span>
      <span />
    </div>

    <div v-for="(row, index) in rows" :key="row.id" class="kv__row">
      <label class="kv__toggle" :title="row.enabled ? 'Disable row' : 'Enable row'">
        <input v-model="row.enabled" type="checkbox" />
      </label>
      <input
        v-model="row.key"
        class="input kv__input"
        :placeholder="keyPlaceholder"
        spellcheck="false"
        @input="onKeyInput(index)"
      />
      <input
        v-model="row.value"
        class="input kv__input"
        :placeholder="valuePlaceholder"
        spellcheck="false"
      />
      <button type="button" class="kv__remove" title="Remove row" @click="removeRow(row.id)">
        <AppIcon name="x" :size="13" />
      </button>
    </div>

    <AppButton size="sm" variant="ghost" icon="plus" @click="addRow">{{ addLabel }}</AppButton>
  </div>
</template>

<style scoped>
.kv {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.kv__row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1.6fr) 24px;
  gap: 5px;
  align-items: center;
  width: 100%;
}

.kv__row--head {
  padding-bottom: 2px;
}

.kv__label {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.kv__toggle {
  display: flex;
  justify-content: center;
  cursor: pointer;
}

.kv__toggle input {
  width: 12px;
  height: 12px;
  accent-color: var(--accent);
  cursor: pointer;
}

.kv__input {
  padding: 4px 7px;
  font-size: var(--fs-xs);
}

.kv__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--transition), background var(--transition);
}

.kv__remove:hover {
  background: var(--danger-ghost);
  color: var(--danger);
}
</style>
