<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppStatusBar from '@/components/layout/AppStatusBar.vue'
import AppTopBar from '@/components/layout/AppTopBar.vue'
import CommandPalette from '@/components/layout/CommandPalette.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { usePersistentState } from '@/composables/usePersistentState'

const sidebarCollapsed = usePersistentState('ui:sidebar-collapsed', false)
const paletteOpen = ref(false)

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="shell">
    <AppSidebar :collapsed="sidebarCollapsed" @toggle="sidebarCollapsed = !sidebarCollapsed" />

    <div class="shell__main">
      <AppTopBar @open-palette="paletteOpen = true" />

      <main class="shell__content">
        <RouterView v-slot="{ Component }">
          <Transition name="view" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>

      <AppStatusBar />
    </div>

    <CommandPalette v-model="paletteOpen" />
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.shell__main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  background: var(--bg-canvas);
}

.shell__content {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--sp-4);
  overflow: auto;
}

.view-enter-active,
.view-leave-active {
  transition: opacity 110ms ease;
}

.view-enter-from,
.view-leave-to {
  opacity: 0;
}

@media (width <= 720px) {
  .shell__content {
    padding: var(--sp-2);
  }
}
</style>
