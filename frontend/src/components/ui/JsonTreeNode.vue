<script setup lang="ts">
/** Recursive, collapsible JSON tree node. */
import { computed, ref } from 'vue'

import type { JsonValue } from '@/lib/json'

const props = withDefaults(
  defineProps<{ name?: string; value: JsonValue; depth?: number; defaultOpenDepth?: number }>(),
  { depth: 0, defaultOpenDepth: 2 },
)

const open = ref(props.depth < props.defaultOpenDepth)

const kind = computed(() => {
  if (props.value === null) return 'null'
  if (Array.isArray(props.value)) return 'array'
  return typeof props.value
})

const isBranch = computed(() => kind.value === 'array' || kind.value === 'object')

const entries = computed<Array<{ key: string; value: JsonValue }>>(() => {
  if (Array.isArray(props.value)) {
    return props.value.map((item, index) => ({ key: String(index), value: item }))
  }
  if (props.value !== null && typeof props.value === 'object') {
    return Object.entries(props.value).map(([key, value]) => ({ key, value }))
  }
  return []
})

const preview = computed(() => {
  if (kind.value === 'array') return `Array(${entries.value.length})`
  if (kind.value === 'object') return `Object{${entries.value.length}}`
  if (kind.value === 'string') return `"${String(props.value)}"`
  return String(props.value)
})
</script>

<template>
  <div class="node" :style="{ '--depth': depth }">
    <div class="node__row" :class="{ 'node__row--branch': isBranch }" @click="isBranch && (open = !open)">
      <span v-if="isBranch" class="node__caret" :class="{ 'is-open': open }">▸</span>
      <span v-else class="node__caret node__caret--empty" />

      <span v-if="name !== undefined" class="node__key">{{ name }}</span>
      <span v-if="name !== undefined" class="node__colon">:</span>

      <span class="node__value" :class="`node__value--${kind}`">
        {{ isBranch && open ? (kind === 'array' ? '[' : '{') : preview }}
      </span>
    </div>

    <div v-if="isBranch && open" class="node__children">
      <JsonTreeNode
        v-for="entry in entries"
        :key="entry.key"
        :name="entry.key"
        :value="entry.value"
        :depth="depth + 1"
        :default-open-depth="defaultOpenDepth"
      />
      <div class="node__row node__row--close">
        <span class="node__caret node__caret--empty" />
        <span class="node__value node__value--bracket">{{ kind === 'array' ? ']' : '}' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node {
  font-size: var(--fs-sm);
  line-height: 1.5;
}

.node__row {
  display: flex;
  gap: 4px;
  align-items: baseline;
  padding: 0 4px;
  border-radius: 3px;
  white-space: pre-wrap;
  word-break: break-word;
}

.node__row--branch {
  cursor: pointer;
}

.node__row--branch:hover {
  background: var(--bg-hover);
}

.node__caret {
  width: 10px;
  flex: 0 0 10px;
  color: var(--text-dim);
  transition: transform var(--transition);
}

.node__caret.is-open {
  transform: rotate(90deg);
}

.node__caret--empty {
  visibility: hidden;
}

.node__key {
  color: var(--cyan);
}

.node__colon {
  color: var(--text-dim);
}

.node__children {
  margin-left: 11px;
  padding-left: 6px;
  border-left: 1px solid var(--border-soft);
}

.node__value--string {
  color: var(--accent);
}

.node__value--number {
  color: var(--amber);
}

.node__value--boolean,
.node__value--null {
  color: var(--violet);
}

.node__value--array,
.node__value--object,
.node__value--bracket {
  color: var(--text-muted);
}
</style>
