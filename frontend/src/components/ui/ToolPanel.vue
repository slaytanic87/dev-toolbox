<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    icon?: IconName
    /** Removes the inner padding - use for panels that only host an editor. */
    flush?: boolean
    tone?: 'default' | 'accent' | 'danger'
  }>(),
  { flush: false, tone: 'default' },
)
</script>

<template>
  <section class="panel" :class="[`panel--${tone}`, { 'panel--flush': flush }]">
    <header v-if="title || $slots.actions" class="panel__head">
      <div class="panel__title">
        <AppIcon v-if="icon" :name="icon" :size="14" />
        <h2>{{ title }}</h2>
        <span v-if="subtitle" class="panel__subtitle">{{ subtitle }}</span>
      </div>
      <div v-if="$slots.actions" class="panel__actions">
        <slot name="actions" />
      </div>
    </header>

    <div class="panel__body">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="panel__foot">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}

.panel--accent {
  border-color: var(--border-strong);
}

.panel--danger {
  border-color: rgb(255 84 102 / 40%);
}

.panel__head {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 7px var(--sp-3);
  border-bottom: 1px solid var(--border-soft);
  background: linear-gradient(180deg, var(--bg-panel-alt), var(--bg-panel));
}

.panel__title {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
  min-width: 0;
  color: var(--accent);
}

.panel__title :deep(svg) {
  align-self: center;
}

.panel__title h2 {
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-strong);
  white-space: nowrap;
}

.panel__subtitle {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel__actions {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  flex-wrap: wrap;
}

.panel__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--sp-3);
  overflow: auto;
}

.panel--flush .panel__body {
  padding: 0;
  gap: 0;
}

.panel__foot {
  padding: 6px var(--sp-3);
  border-top: 1px solid var(--border-soft);
  background: var(--bg-panel-alt);
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
</style>
