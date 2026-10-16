<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    icon?: IconName
    iconRight?: IconName
    disabled?: boolean
    active?: boolean
    type?: 'button' | 'submit'
    title?: string
  }>(),
  {
    variant: 'default',
    size: 'md',
    disabled: false,
    active: false,
    type: 'button',
  },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :title="title"
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'is-active': active }]"
  >
    <AppIcon v-if="icon" :name="icon" :size="size === 'sm' ? 13 : 15" />
    <span v-if="$slots.default" class="btn__label"><slot /></span>
    <AppIcon v-if="iconRight" :name="iconRight" :size="size === 'sm' ? 13 : 15" />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: var(--fs-sm);
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--transition),
    border-color var(--transition),
    color var(--transition),
    box-shadow var(--transition);
}

.btn--md {
  padding: 6px 11px;
}

.btn--sm {
  padding: 3px 8px;
  font-size: var(--fs-xs);
}

.btn:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text-strong);
}

.btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn--primary {
  border-color: var(--accent-dim);
  background: var(--accent-ghost);
  color: var(--accent);
  font-weight: 600;
}

.btn--primary:hover:not(:disabled) {
  background: rgb(0 255 156 / 20%);
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 0 14px -4px var(--accent-glow);
}

.btn--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);
}

.btn--ghost:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-hover);
}

.btn--danger {
  border-color: rgb(255 84 102 / 35%);
  background: var(--danger-ghost);
  color: var(--danger);
}

.btn--danger:hover:not(:disabled) {
  border-color: var(--danger);
  background: rgb(255 84 102 / 20%);
  color: var(--danger);
}

.btn.is-active {
  border-color: var(--accent-dim);
  background: var(--accent-ghost);
  color: var(--accent);
}

.btn__label {
  line-height: 1.2;
}
</style>
