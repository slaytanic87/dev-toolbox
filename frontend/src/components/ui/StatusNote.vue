<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{ tone?: 'ok' | 'error' | 'warn' | 'muted' | 'info'; icon?: IconName }>(),
  { tone: 'muted' },
)

const ICON_BY_TONE: Record<string, IconName> = {
  ok: 'check',
  error: 'alert',
  warn: 'alert',
  info: 'info',
  muted: 'info',
}
</script>

<template>
  <p class="status" :class="`status--${tone}`" role="status">
    <AppIcon :name="icon ?? ICON_BY_TONE[tone] ?? 'info'" :size="13" />
    <span><slot /></span>
  </p>
</template>

<style scoped>
.status {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  margin: 0;
  padding: 5px 9px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-input);
  font-size: var(--fs-xs);
  line-height: 1.5;
  word-break: break-word;
}

.status :deep(svg) {
  margin-top: 2px;
}

.status--ok {
  border-color: rgb(0 255 156 / 35%);
  background: var(--accent-ghost);
  color: var(--accent);
}

.status--error {
  border-color: rgb(255 84 102 / 40%);
  background: var(--danger-ghost);
  color: var(--danger);
}

.status--warn {
  border-color: rgb(255 162 58 / 40%);
  background: rgb(255 162 58 / 10%);
  color: var(--warn);
}

.status--info {
  border-color: rgb(25 227 255 / 30%);
  background: var(--cyan-ghost);
  color: var(--cyan);
}

.status--muted {
  color: var(--text-muted);
}
</style>
