<script setup lang="ts" generic="T extends string">
/** Generic segmented switch used for modes/tabs across the tools. */
defineProps<{
  options: ReadonlyArray<{ value: T; label: string; title?: string }>
  size?: 'sm' | 'md'
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="segmented" :class="`segmented--${size ?? 'md'}`" role="tablist">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      :title="option.title"
      class="segmented__item"
      :class="{ 'is-active': model === option.value }"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  gap: 2px;
  flex-wrap: wrap;
}

.segmented__item {
  padding: 4px 10px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.segmented--sm .segmented__item {
  padding: 2px 7px;
}

.segmented__item:hover {
  color: var(--text-strong);
  background: var(--bg-hover);
}

.segmented__item.is-active {
  background: var(--accent-ghost);
  color: var(--accent);
  font-weight: 600;
}
</style>
