<script setup lang="ts">
import { useToast } from '@/composables/useToast'

import AppIcon from './AppIcon.vue'

const { toasts, dismiss } = useToast()

const ICONS = { success: 'check', error: 'alert', info: 'info' } as const
</script>

<template>
  <Teleport to="body">
    <div class="toasts" aria-live="polite">
      <TransitionGroup name="toast">
        <button
          v-for="toast in toasts"
          :key="toast.id"
          type="button"
          class="toast"
          :class="`toast--${toast.tone}`"
          @click="dismiss(toast.id)"
        >
          <AppIcon :name="ICONS[toast.tone]" :size="14" />
          <span>{{ toast.message }}</span>
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: var(--sp-4);
  bottom: calc(var(--statusbar-h) + var(--sp-3));
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  align-items: flex-end;
  pointer-events: none;
}

.toast {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  max-width: 420px;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-pop);
  color: var(--text-strong);
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
}

.toast--success {
  border-color: var(--accent-dim);
  color: var(--accent);
}

.toast--error {
  border-color: var(--danger);
  color: var(--danger);
}

.toast--info {
  border-color: var(--cyan);
  color: var(--cyan);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(14px);
}
</style>
