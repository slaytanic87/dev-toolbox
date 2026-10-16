<script setup lang="ts">
/** Ctrl/Cmd+K quick switcher across all registered tools. */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { searchTools } from '@/tools/registry'

const open = defineModel<boolean>({ required: true })

const router = useRouter()
const query = ref('')
const activeIndex = ref(0)
const input = ref<HTMLInputElement | null>(null)

const results = computed(() => searchTools(query.value))

watch(open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  activeIndex.value = 0
  await nextTick()
  input.value?.focus()
})

watch(results, () => {
  activeIndex.value = 0
})

function move(delta: number): void {
  if (results.value.length === 0) return
  activeIndex.value = (activeIndex.value + delta + results.value.length) % results.value.length
}

function choose(index = activeIndex.value): void {
  const tool = results.value[index]
  if (!tool) return
  open.value = false
  void router.push(tool.path)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="open" class="palette" role="dialog" aria-modal="true" @click.self="open = false">
        <div class="palette__box">
          <div class="palette__input-row">
            <span class="palette__prompt">&gt;</span>
            <input
              ref="input"
              v-model="query"
              class="palette__input"
              type="text"
              placeholder="search tools…"
              spellcheck="false"
              aria-label="Search tools"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="choose()"
              @keydown.esc.prevent="open = false"
            />
            <kbd>esc</kbd>
          </div>

          <ul class="palette__list">
            <li v-for="(tool, index) in results" :key="tool.id">
              <button
                type="button"
                class="palette__item"
                :class="{ 'is-active': index === activeIndex }"
                @mouseenter="activeIndex = index"
                @click="choose(index)"
              >
                <AppIcon :name="tool.icon" :size="15" />
                <span class="palette__text">
                  <span class="palette__name">{{ tool.name }}</span>
                  <span class="palette__tag">{{ tool.tagline }}</span>
                </span>
                <code class="palette__path">{{ tool.path }}</code>
              </button>
            </li>
            <li v-if="results.length === 0" class="palette__empty">no match</li>
          </ul>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.palette {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  background: rgb(2 5 8 / 72%);
  backdrop-filter: blur(3px);
}

.palette__box {
  width: min(620px, 92vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

.palette__input-row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: var(--sp-3);
  border-bottom: 1px solid var(--border-soft);
}

.palette__prompt {
  color: var(--accent);
  font-weight: 700;
}

.palette__input {
  flex: 1 1 auto;
  border: none;
  background: transparent;
  color: var(--text-strong);
  font-size: var(--fs-lg);
  outline: none;
}

.palette__list {
  margin: 0;
  padding: var(--sp-1);
  list-style: none;
  overflow-y: auto;
}

.palette__item {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
}

.palette__item.is-active {
  background: var(--accent-ghost);
  color: var(--accent);
}

.palette__text {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}

.palette__name {
  color: var(--text-strong);
  font-size: var(--fs-sm);
}

.palette__item.is-active .palette__name {
  color: var(--accent);
}

.palette__tag {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette__path {
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

.palette__empty {
  padding: var(--sp-4);
  color: var(--text-dim);
  font-size: var(--fs-sm);
  text-align: center;
}

.palette-enter-active,
.palette-leave-active {
  transition: opacity 120ms ease;
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
</style>
