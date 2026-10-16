<script setup lang="ts">
/** Go to offset, bookmarks, explicit range selection and the byte operations. */
import { computed, ref } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { usePersistentState } from '@/composables/usePersistentState'
import { useToast } from '@/composables/useToast'
import { formatSize, type HexTab, type HexWorkspace } from '@/composables/useHexEditor'
import { PAYLOAD_FORMATS, parsePayload, type PayloadFormat } from '@/lib/hex/parsers'

const props = defineProps<{ workspace: HexWorkspace; tab: HexTab }>()

const toast = useToast()

const gotoValue = ref('')
const gotoRelative = ref<'absolute' | 'forward' | 'backward'>('absolute')
const rangeStart = ref('')
const rangeLength = ref('')
const fillValue = usePersistentState('hex:fill', '00')
const insertCount = ref('16')
const payload = usePersistentState('hex:payload', '')
const payloadFormat = usePersistentState<PayloadFormat>('hex:payload-format', 'hex')
const bookmarkLabel = ref('')
const error = ref<string | null>(null)
const gotoInput = ref<HTMLInputElement | null>(null)

const selectionSize = computed(() => props.workspace.selectionSize(props.tab))
const selection = computed(() => props.tab.selections)

/** Accepts `0x1F`, `1Fh`, `0b1010`, `0o17` and plain decimal. */
function parseOffset(text: string): number {
  const trimmed = text.trim().replace(/[\s_']/g, '')
  if (trimmed === '') throw new Error('Enter an offset.')
  let value: number
  if (/^0x[0-9a-f]+$/i.test(trimmed)) value = Number.parseInt(trimmed.slice(2), 16)
  else if (/^[0-9a-f]+h$/i.test(trimmed)) value = Number.parseInt(trimmed.slice(0, -1), 16)
  else if (/^0b[01]+$/i.test(trimmed)) value = Number.parseInt(trimmed.slice(2), 2)
  else if (/^0o[0-7]+$/i.test(trimmed)) value = Number.parseInt(trimmed.slice(2), 8)
  else if (/^[+-]?\d+$/.test(trimmed)) value = Number.parseInt(trimmed, 10)
  else throw new Error(`"${text}" is not a valid offset.`)
  if (!Number.isFinite(value)) throw new Error(`"${text}" is not a valid offset.`)
  return value
}

function guard(body: () => void): void {
  try {
    error.value = null
    body()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

function go(): void {
  guard(() => {
    const value = parseOffset(gotoValue.value)
    const target =
      gotoRelative.value === 'absolute'
        ? value
        : gotoRelative.value === 'forward'
          ? props.tab.caret + value
          : props.tab.caret - value
    props.workspace.setCaret(props.tab, target)
  })
}

function applyRange(): void {
  guard(() => {
    const start = parseOffset(rangeStart.value)
    const length = rangeLength.value.trim() === '' ? 1 : parseOffset(rangeLength.value)
    props.workspace.selectRange(props.tab, start, start + length)
  })
}

function parseByte(text: string): number {
  const value = parseOffset(text)
  if (value < 0 || value > 255) throw new Error('The fill value must be a single byte.')
  return value
}

function fillSelection(): void {
  guard(() => {
    const value = parseByte(fillValue.value)
    const ranges = [...props.tab.selections]
    if (ranges.length === 0) throw new Error('Select the bytes to fill first.')
    props.tab.doc.transact('Fill selection', () => {
      for (const range of ranges) props.tab.doc.fill(range.start, range.end - range.start, value)
    })
    props.workspace.touch(props.tab)
    toast.success(`Filled ${formatSize(selectionSize.value)}.`)
  })
}

function insertFill(): void {
  guard(() => {
    const value = parseByte(fillValue.value)
    const count = parseOffset(insertCount.value)
    if (count <= 0) throw new Error('Enter how many bytes to insert.')
    props.workspace.insertFill(props.tab, props.tab.caret, count, value)
    toast.success(`Inserted ${formatSize(count)} of 0x${value.toString(16).toUpperCase()}.`)
  })
}

function deleteSelection(): void {
  guard(() => {
    if (!props.workspace.deleteSelection(props.tab)) {
      throw new Error('Select the bytes to delete first.')
    }
  })
}

function insertPayload(how: 'insert' | 'overwrite'): void {
  guard(() => {
    const bytes = parsePayload(payload.value, payloadFormat.value, {
      encoding: props.workspace.view.value.encoding,
    })
    if (bytes.length === 0) throw new Error('The payload is empty.')
    props.workspace.insertBytes(props.tab, bytes, how)
    toast.success(`${how === 'insert' ? 'Inserted' : 'Wrote'} ${bytes.length} byte(s).`)
  })
}

function addBookmark(): void {
  props.workspace.toggleBookmark(
    props.tab,
    props.tab.caret,
    bookmarkLabel.value.trim() === '' ? undefined : bookmarkLabel.value.trim(),
  )
  bookmarkLabel.value = ''
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`
}

defineExpose({
  focusGoto: () => {
    gotoInput.value?.focus()
    gotoInput.value?.select()
  },
})
</script>

<template>
  <div class="navigator">
    <section>
      <h3>Go to offset</h3>
      <div class="row">
        <input
          ref="gotoInput"
          v-model="gotoValue"
          class="input"
          spellcheck="false"
          placeholder="0x1000, 4096, 1000h"
          @keydown.enter.prevent="go()"
        />
        <select v-model="gotoRelative" class="input input--narrow">
          <option value="absolute">from start</option>
          <option value="forward">forward</option>
          <option value="backward">backward</option>
        </select>
        <AppButton size="sm" icon="send" @click="go()">Go</AppButton>
      </div>
    </section>

    <section>
      <h3>Select range</h3>
      <div class="row">
        <input v-model="rangeStart" class="input" spellcheck="false" placeholder="start" />
        <input v-model="rangeLength" class="input" spellcheck="false" placeholder="length" />
        <AppButton size="sm" variant="ghost" @click="applyRange()">Select</AppButton>
      </div>
      <p class="hint">
        {{ selection.length }} range(s), {{ formatSize(selectionSize) }} selected
        <template v-if="selection[0]">
          &middot; first {{ hex(selection[0].start) }} - {{ hex(selection[0].end - 1) }}
        </template>
      </p>
    </section>

    <section>
      <h3>Byte operations</h3>
      <div class="row">
        <label class="field">
          <span>Fill value</span>
          <input v-model="fillValue" class="input" spellcheck="false" placeholder="FF" />
        </label>
        <label class="field">
          <span>Insert count</span>
          <input v-model="insertCount" class="input" spellcheck="false" placeholder="16" />
        </label>
      </div>
      <div class="actions">
        <AppButton size="sm" variant="ghost" @click="fillSelection()">Fill selection</AppButton>
        <AppButton size="sm" variant="ghost" @click="insertFill()">Insert bytes</AppButton>
        <AppButton size="sm" variant="danger" icon="trash" @click="deleteSelection()">
          Delete selection
        </AppButton>
      </div>
    </section>

    <section>
      <h3>Insert payload</h3>
      <textarea
        v-model="payload"
        class="input input--area"
        spellcheck="false"
        rows="3"
        placeholder="DE AD BE EF"
      />
      <div class="row">
        <select v-model="payloadFormat" class="input">
          <option v-for="item in PAYLOAD_FORMATS" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
        <AppButton size="sm" variant="ghost" @click="insertPayload('insert')">Insert</AppButton>
        <AppButton size="sm" variant="ghost" @click="insertPayload('overwrite')">Overwrite</AppButton>
      </div>
    </section>

    <section>
      <h3>Bookmarks</h3>
      <div class="row">
        <input
          v-model="bookmarkLabel"
          class="input"
          spellcheck="false"
          placeholder="label (optional)"
          @keydown.enter.prevent="addBookmark()"
        />
        <AppButton size="sm" variant="ghost" icon="plus" @click="addBookmark()">
          At caret
        </AppButton>
      </div>
      <ul v-if="tab.bookmarks.length > 0" class="bookmarks">
        <li v-for="bookmark in tab.bookmarks" :key="bookmark.offset">
          <button type="button" @click="workspace.setCaret(tab, bookmark.offset)">
            <span class="bookmarks__offset">{{ hex(bookmark.offset) }}</span>
            <span class="bookmarks__label">{{ bookmark.label }}</span>
          </button>
          <AppButton
            size="sm"
            variant="ghost"
            icon="x"
            title="Remove bookmark"
            @click="workspace.removeBookmark(tab, bookmark.offset)"
          />
        </li>
      </ul>
      <p v-else class="hint">No bookmarks yet - press Ctrl/Cmd + B in the grid.</p>
    </section>

    <StatusNote v-if="error" tone="error">{{ error }}</StatusNote>
  </div>
</template>

<style scoped>
.navigator {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

h3 {
  margin: 0 0 var(--sp-1);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.row {
  display: flex;
  gap: var(--sp-1);
  align-items: flex-end;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 0;
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--fs-xs);
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

.input:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.input--narrow {
  flex: 0 0 auto;
  width: 8em;
}

.input--area {
  width: 100%;
  resize: vertical;
}

.actions {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  margin-top: var(--sp-1);
}

.hint {
  margin: var(--sp-1) 0 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

.bookmarks {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--sp-1) 0 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
  list-style: none;
}

.bookmarks li {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
}

.bookmarks li > button {
  display: flex;
  gap: var(--sp-2);
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 5px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  text-align: left;
  cursor: pointer;
}

.bookmarks li > button:hover {
  border-color: var(--violet);
  color: var(--text-strong);
}

.bookmarks__offset {
  color: var(--violet);
}

.bookmarks__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
