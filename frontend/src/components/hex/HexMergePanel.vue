<script setup lang="ts">
/**
 * Merges several open documents into one image: each part gets a start
 * address, gaps are padded with a fill byte and overlaps are reported before
 * anything is written. The result references the original files, so merging
 * four 2 GiB images costs no memory.
 */
import { computed, ref, watch } from 'vue'

import AppButton from '@/components/ui/AppButton.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import { useToast } from '@/composables/useToast'
import { formatSize, type HexWorkspace } from '@/composables/useHexEditor'
import { HexDocument } from '@/lib/hex/document'

const props = defineProps<{ workspace: HexWorkspace }>()

const toast = useToast()

interface Part {
  tabId: string
  address: string
  include: boolean
}

const parts = ref<Part[]>([])
const fillValue = ref('FF')
const error = ref<string | null>(null)

watch(
  () => props.workspace.tabs.value.map((tab) => tab.id).join(','),
  () => {
    const known = new Map(parts.value.map((part) => [part.tabId, part]))
    parts.value = props.workspace.tabs.value.map(
      (tab) =>
        known.get(tab.id) ?? { tabId: tab.id, address: '0', include: tab.origin !== 'merge' },
    )
  },
  { immediate: true },
)

function tabOf(id: string) {
  return props.workspace.tabs.value.find((tab) => tab.id === id) ?? null
}

function parseAddress(text: string): number {
  const trimmed = text.trim().replace(/[\s_]/g, '')
  if (trimmed === '') return 0
  const value = /^0x/i.test(trimmed)
    ? Number.parseInt(trimmed.slice(2), 16)
    : Number.parseInt(trimmed, 16)
  if (!Number.isFinite(value) || value < 0) throw new Error(`"${text}" is not a valid address.`)
  return value
}

const plan = computed(() => {
  try {
    const items = parts.value
      .filter((part) => part.include)
      .map((part) => {
        const tab = tabOf(part.tabId)
        if (!tab) throw new Error('A selected document was closed.')
        return { tab, address: parseAddress(part.address) }
      })
      .sort((a, b) => a.address - b.address)

    const conflicts: string[] = []
    let end = 0
    let base = items[0]?.address ?? 0
    for (const item of items) {
      if (item.address < end) {
        conflicts.push(
          `${item.tab.name} starts at 0x${item.address.toString(16).toUpperCase()} but the previous part ends at 0x${end.toString(16).toUpperCase()}`,
        )
      }
      end = Math.max(end, item.address + item.tab.size)
      base = Math.min(base, item.address)
    }
    return { items, conflicts, base, size: items.length === 0 ? 0 : end - base, error: null }
  } catch (caught) {
    return {
      items: [],
      conflicts: [],
      base: 0,
      size: 0,
      error: caught instanceof Error ? caught.message : String(caught),
    }
  }
})

function merge(): void {
  error.value = plan.value.error
  if (error.value) return
  if (plan.value.items.length < 1) {
    error.value = 'Select at least one document.'
    return
  }
  if (plan.value.conflicts.length > 0) {
    error.value = 'Resolve the address overlaps first.'
    return
  }

  const fill = Number.parseInt(fillValue.value.replace(/^0x/i, ''), 16)
  if (!Number.isFinite(fill) || fill < 0 || fill > 255) {
    error.value = 'The fill value must be one byte, for example FF.'
    return
  }

  const merged = HexDocument.fromBytes(new Uint8Array(0))
  const base = plan.value.base
  for (const item of plan.value.items) {
    const gap = item.address - base - merged.size
    if (gap > 0) merged.insertFill(merged.size, gap, fill, { dirty: false })
    merged.appendPieces(merged.importRange(item.tab.doc, 0, item.tab.size, false))
  }

  const tab = props.workspace.createTab(
    `merged-0x${base.toString(16).toUpperCase()}.bin`,
    merged,
    'merge',
  )
  props.workspace.touch(tab)
  toast.success(`Merged ${plan.value.items.length} documents into ${formatSize(merged.size)}.`)
}
</script>

<template>
  <div class="merge">
    <p class="hint">
      Every open document can become a part of a new image. Addresses are hexadecimal and relative
      to the lowest address in the plan.
    </p>

    <ul class="parts">
      <li v-for="part in parts" :key="part.tabId">
        <label class="parts__check">
          <input v-model="part.include" type="checkbox" />
          <span>{{ tabOf(part.tabId)?.name ?? 'closed' }}</span>
        </label>
        <span class="parts__size">{{ formatSize(tabOf(part.tabId)?.size ?? 0) }}</span>
        <input v-model="part.address" class="input input--address" spellcheck="false" />
      </li>
    </ul>

    <div class="row">
      <label class="field">
        <span>Gap fill byte</span>
        <input v-model="fillValue" class="input" spellcheck="false" placeholder="FF" />
      </label>
      <AppButton size="sm" icon="plus" @click="merge()">Merge into a new document</AppButton>
    </div>

    <p v-if="plan.size > 0" class="hint">
      Result: {{ formatSize(plan.size) }} starting at 0x{{ plan.base.toString(16).toUpperCase() }}
    </p>

    <StatusNote v-for="conflict in plan.conflicts" :key="conflict" tone="warn">
      {{ conflict }}
    </StatusNote>
    <StatusNote v-if="error ?? plan.error" tone="error">{{ error ?? plan.error }}</StatusNote>
  </div>
</template>

<style scoped>
.merge {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  line-height: 1.5;
}

.parts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.parts li {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: 3px 5px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-size: var(--fs-xs);
}

.parts__check {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text);
  cursor: pointer;
}

.parts__check span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parts__size {
  flex: 0 0 auto;
  color: var(--text-dim);
}

.row {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-end;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.input {
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-canvas);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  width: 7em;
}

.input--address {
  flex: 0 0 auto;
  width: 8em;
}
</style>
