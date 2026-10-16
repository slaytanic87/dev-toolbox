<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const clock = ref(formatTime())
let timer = 0

function formatTime(): string {
  return new Date().toLocaleTimeString([], { hour12: false })
}

onMounted(() => {
  timer = window.setInterval(() => (clock.value = formatTime()), 1000)
})

onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <footer class="statusbar">
    <span class="statusbar__item statusbar__item--ok">
      <span class="dot" />offline-capable &middot; no data leaves this tool
    </span>
    <span class="statusbar__spacer" />
    <span class="statusbar__item">vue 3 + codemirror 6</span>
    <span class="statusbar__item statusbar__item--clock">{{ clock }}</span>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  gap: var(--sp-4);
  align-items: center;
  height: var(--statusbar-h);
  padding: 0 var(--sp-4);
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.05em;
  flex: 0 0 auto;
}

.statusbar__item {
  display: flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
}

.statusbar__item--ok {
  color: var(--accent-dim);
}

.statusbar__item--clock {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.statusbar__spacer {
  flex: 1 1 auto;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (width <= 720px) {
  .statusbar__item:not(.statusbar__item--ok) {
    display: none;
  }
}
</style>
