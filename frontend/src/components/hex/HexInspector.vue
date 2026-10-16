<script setup lang="ts">
/** Data inspector: every interpretation of the bytes at the caret, plus a bit editor. */
import { computed, ref, watch } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import type { HexTab, HexWorkspace } from '@/composables/useHexEditor'
import {
  INSPECTOR_WINDOW,
  bitsOf,
  encodeField,
  inspect,
  toggleBit,
  type InspectorField,
} from '@/lib/hex/inspector'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

const toast = useToast()
const endian = usePersistentState<'le' | 'be'>('hex:endian', 'le')
const ENDIAN_OPTIONS = [
  { value: 'le' as const, label: 'Little endian', title: 'Intel byte order' },
  { value: 'be' as const, label: 'Big endian', title: 'Motorola byte order' },
]

const bytes = ref<Uint8Array>(new Uint8Array(0))
const editing = ref<string | null>(null)
const draft = ref('')

watch(
  () => [props.tab.id, props.tab.caret, props.tab.version, props.tab.size],
  async () => {
    const tab = props.tab
    bytes.value = await tab.doc.read(tab.caret, INSPECTOR_WINDOW)
  },
  { immediate: true },
)

const fields = computed<InspectorField[]>(() =>
  inspect(bytes.value, endian.value === 'le', props.workspace.view.value.encoding, props.tab.caret),
)

const groups = computed(() => {
  const map = new Map<string, InspectorField[]>()
  for (const field of fields.value) {
    const list = map.get(field.group) ?? []
    list.push(field)
    map.set(field.group, list)
  }
  return Array.from(map, ([name, items]) => ({ name, items }))
})

const bits = computed(() => (bytes.value.length > 0 ? bitsOf(bytes.value[0] ?? 0) : null))

function startEdit(field: InspectorField): void {
  if (!field.editable) return
  editing.value = field.id
  draft.value = field.value
}

function commit(field: InspectorField): void {
  try {
    const encoded = encodeField(field.id, draft.value, endian.value === 'le')
    props.workspace.overwriteAt(props.tab, props.tab.caret, encoded, `Set ${field.label}`)
    toast.success(`${field.label} written at 0x${props.tab.caret.toString(16).toUpperCase()}`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    editing.value = null
  }
}

function flipBit(index: number): void {
  if (bytes.value.length === 0) return
  const value = toggleBit(bytes.value[0] ?? 0, 7 - index)
  props.workspace.overwriteAt(props.tab, props.tab.caret, new Uint8Array([value]), 'Toggle bit')
}

function selectField(field: InspectorField): void {
  if (field.size <= 0) return
  props.workspace.selectRange(props.tab, props.tab.caret, props.tab.caret + field.size)
}
</script>

<template>
  <div class="inspector">
    <SegmentedControl v-model="endian" :options="ENDIAN_OPTIONS" size="sm" />

    <div v-if="bits" class="bits">
      <span class="bits__label">bit editor</span>
      <div class="bits__row">
        <button
          v-for="(bit, index) in bits"
          :key="index"
          type="button"
          class="bits__bit"
          :class="{ 'is-set': bit }"
          :title="`Bit ${7 - index} - click to toggle`"
          @click="flipBit(index)"
        >
          {{ bit ? 1 : 0 }}
        </button>
      </div>
    </div>

    <StatusNote v-if="bytes.length === 0" tone="muted">
      The caret is behind the last byte - nothing to interpret.
    </StatusNote>

    <section v-for="group in groups" :key="group.name" class="group">
      <h3>{{ group.name }}</h3>
      <dl>
        <template v-for="field in group.items" :key="field.id">
          <dt :title="field.note">
            <button type="button" class="field__name" @click="selectField(field)">
              {{ field.label }}
            </button>
          </dt>
          <dd>
            <input
              v-if="editing === field.id"
              v-model="draft"
              class="field__input"
              spellcheck="false"
              @keydown.enter.prevent="commit(field)"
              @keydown.esc.prevent="editing = null"
              @blur="editing = null"
            />
            <button
              v-else
              type="button"
              class="field__value"
              :class="{ 'is-editable': field.editable }"
              :title="field.editable ? 'Click to write this value back' : undefined"
              @click="startEdit(field)"
            >
              {{ field.value }}
            </button>
          </dd>
        </template>
      </dl>
    </section>

    <AppButton
      size="sm"
      variant="ghost"
      icon="info"
      title="Editable values are written at the caret when you press Enter"
      disabled
    >
      Click a value to edit it
    </AppButton>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.bits {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.bits__label {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.bits__row {
  display: flex;
  gap: 3px;
}

.bits__bit {
  flex: 1 1 0;
  padding: 5px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: all var(--transition);
}

.bits__bit.is-set {
  border-color: var(--accent-dim);
  background: var(--accent-ghost);
  color: var(--accent);
}

.bits__bit:hover {
  border-color: var(--border-strong);
}

.group h3 {
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

dt,
dd {
  margin: 0;
  min-width: 0;
}

.field__name {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.field__name:hover {
  color: var(--cyan);
}

.field__value {
  width: 100%;
  padding: 1px 3px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.field__value.is-editable {
  cursor: text;
}

.field__value.is-editable:hover {
  border-color: var(--border);
  background: var(--bg-input);
  color: var(--text-strong);
}

.field__input {
  width: 100%;
  padding: 1px 3px;
  border: 1px solid var(--accent-dim);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-strong);
  font: inherit;
}
</style>
