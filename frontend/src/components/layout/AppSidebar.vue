<script setup lang="ts">
import { computed, ref } from 'vue'

import AppIcon from '@/components/ui/AppIcon.vue'
import { searchTools } from '@/tools/registry'

defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ toggle: []; navigate: [] }>()

const filter = ref('')
const visibleTools = computed(() => searchTools(filter.value))
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
    <RouterLink to="/" class="brand" title="DevToolbox overview" @click="emit('navigate')">
      <span class="brand__mark">&gt;_</span>
      <span v-if="!collapsed" class="brand__text">
        dev<span class="brand__accent">toolbox</span>
      </span>
    </RouterLink>

    <div v-if="!collapsed" class="sidebar__search">
      <AppIcon name="search" :size="13" />
      <input
        v-model="filter"
        class="sidebar__search-input"
        type="search"
        placeholder="filter tools…"
        spellcheck="false"
        aria-label="Filter tools"
      />
    </div>

    <nav class="nav" aria-label="Tools">
      <RouterLink
        v-for="tool in visibleTools"
        :key="tool.id"
        :to="tool.path"
        class="nav__item"
        :title="collapsed ? tool.name : tool.tagline"
        @click="emit('navigate')"
      >
        <AppIcon :name="tool.icon" :size="16" />
        <span v-if="!collapsed" class="nav__text">
          <span class="nav__name">{{ tool.name }}</span>
          <span class="nav__tag">{{ tool.tagline }}</span>
        </span>
      </RouterLink>

      <p v-if="!collapsed && visibleTools.length === 0" class="nav__empty">no tool matches</p>
    </nav>

    <button
      type="button"
      class="sidebar__toggle"
      :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      @click="emit('toggle')"
    >
      <AppIcon name="terminal" :size="14" />
      <span v-if="!collapsed">collapse</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  height: 100%;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, var(--bg-panel), var(--bg-canvas));
  transition: width var(--transition), min-width var(--transition);
}

.sidebar--collapsed {
  width: 54px;
  min-width: 54px;
}

/* ---------- brand ---------- */

.brand {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  height: var(--topbar-h);
  padding: 0 var(--sp-3);
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-strong);
  text-decoration: none;
  flex: 0 0 auto;
}

.sidebar--collapsed .brand {
  justify-content: center;
  padding: 0;
}

.brand__mark {
  color: var(--accent);
  font-weight: 700;
  letter-spacing: -0.05em;
  text-shadow: 0 0 12px var(--accent-glow);
}

.brand__text {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.brand__accent {
  color: var(--accent);
}

.brand:hover {
  text-decoration: none;
}

/* ---------- search ---------- */

.sidebar__search {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: var(--sp-3) var(--sp-3) var(--sp-2);
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text-dim);
  flex: 0 0 auto;
}

.sidebar__search:focus-within {
  border-color: var(--accent-dim);
  color: var(--accent);
}

.sidebar__search-input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-strong);
  font-size: var(--fs-xs);
  outline: none;
}

.sidebar__search-input::-webkit-search-cancel-button {
  display: none;
}

/* ---------- nav ---------- */

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  padding: var(--sp-1) var(--sp-2) var(--sp-3);
  overflow-y: auto;
}

.nav__item {
  position: relative;
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: 7px 9px;
  border-radius: var(--radius);
  border-left: 2px solid transparent;
  color: var(--text-muted);
  text-decoration: none;
  transition: background var(--transition), color var(--transition);
}

.sidebar--collapsed .nav__item {
  justify-content: center;
  padding: 9px 0;
}

.nav__item:hover {
  background: var(--bg-hover);
  color: var(--text-strong);
  text-decoration: none;
}

.nav__item.router-link-active {
  border-left-color: var(--accent);
  background: var(--accent-ghost);
  color: var(--accent);
}

.nav__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nav__name {
  font-size: var(--fs-sm);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.nav__tag {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav__item.router-link-active .nav__tag {
  color: rgb(0 255 156 / 55%);
}

.nav__empty {
  padding: var(--sp-3);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  text-align: center;
}

/* ---------- toggle ---------- */

.sidebar__toggle {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 7px;
  border: none;
  border-top: 1px solid var(--border-soft);
  background: transparent;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  flex: 0 0 auto;
}

.sidebar__toggle:hover {
  background: var(--bg-hover);
  color: var(--accent);
}
</style>
