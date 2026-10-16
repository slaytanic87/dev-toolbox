<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { TOOL_BY_ID } from '@/tools/registry'

defineEmits<{ openPalette: [] }>()

const route = useRoute()

const current = computed(() => {
  const id = route.meta['toolId'] as string | undefined
  return id ? TOOL_BY_ID.get(id) : undefined
})

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
</script>

<template>
  <header class="topbar">
    <div class="topbar__title">
      <AppIcon :name="current?.icon ?? 'grid'" :size="15" />
      <h1>{{ current?.name ?? 'Overview' }}</h1>
      <span class="topbar__tagline">
        {{ current?.tagline ?? 'Everything runs in your ownership.' }}
      </span>
    </div>

    <div class="topbar__right">
      <button type="button" class="palette-trigger" @click="$emit('openPalette')">
        <AppIcon name="search" :size="13" />
        <span>jump to tool</span>
        <kbd>{{ isMac ? '⌘' : 'Ctrl' }}</kbd><kbd>K</kbd>
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  justify-content: space-between;
  height: var(--topbar-h);
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--bg-panel), var(--bg-canvas));
  flex: 0 0 auto;
}

.topbar__title {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  min-width: 0;
  color: var(--accent);
}

.topbar__title :deep(svg) {
  align-self: center;
}

.topbar__title h1 {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text-strong);
  white-space: nowrap;
}

.topbar__tagline {
  color: var(--accent-dim);
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar__right {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex: 0 0 auto;
}

.palette-trigger {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: border-color var(--transition), color var(--transition);
}

.palette-trigger:hover {
  border-color: var(--accent-dim);
  color: var(--accent);
}

@media (width <= 720px) {
  .topbar__tagline,
  .palette-trigger span {
    display: none;
  }
}
</style>
