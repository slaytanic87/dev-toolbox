<script setup lang="ts">
/**
 * Two pane layout with a draggable divider.
 *
 * - `orientation="auto"` lays the panes out side by side and flips them to a
 *   stacked (top/bottom) layout as soon as the available width drops below
 *   `stackBelow`, so a tool stays usable on a narrow window or with the
 *   sidebar expanded.
 * - `sizing="fill"` panes share the height of the work area, `sizing="content"`
 *   panes are as tall as their content and simply stack when space runs out.
 * - The split ratio is remembered per `storageKey`.
 * - The divider is keyboard operable (arrows / home / end) and resets to the
 *   default ratio on double click.
 */
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, type Ref } from 'vue'

import { usePersistentState } from '@/composables/usePersistentState'

const props = withDefaults(
  defineProps<{
    /** Persists the ratio under `split:<storageKey>` when given. */
    storageKey?: string
    orientation?: 'auto' | 'horizontal' | 'vertical'
    /** `fill` stretches the panes over the work area, `content` does not. */
    sizing?: 'fill' | 'content'
    /** Size of the first pane as a fraction of the available space. */
    defaultRatio?: number
    /** Smallest size of the first/second pane while dragging, in pixels. */
    minA?: number
    minB?: number
    /** Width at which `auto` switches to the stacked layout, in pixels. */
    stackBelow?: number
    /** Minimum pane height in the stacked `fill` layout. */
    stackedMin?: string
    /** Height the stacked `fill` layout claims - the page scrolls past it. */
    stackedHeight?: string
    label?: string
  }>(),
  {
    storageKey: undefined,
    orientation: 'auto',
    sizing: 'fill',
    defaultRatio: 0.5,
    minA: 220,
    minB: 220,
    stackBelow: 760,
    stackedMin: '240px',
    stackedHeight: 'clamp(560px, 120vh, 1100px)',
    label: 'Resize panels',
  },
)

const DIVIDER = 10
const KEYBOARD_STEP = 0.02

const root = useTemplateRef<HTMLDivElement>('root')

function makeRatio(suffix: string): Ref<number> {
  return props.storageKey
    ? usePersistentState(`split:${props.storageKey}${suffix}`, props.defaultRatio)
    : ref(props.defaultRatio)
}

// Side by side and stacked layouts keep their own ratio, so resizing on a
// narrow window does not reshuffle the wide layout.
const sideRatio = makeRatio('')
const stackRatio = makeRatio(':stacked')

const width = ref(0)
const dragging = ref(false)

/** `auto` fell back to the stacked layout because the view got too narrow. */
const autoStacked = computed(() => {
  if (props.orientation !== 'auto') return false
  // Before the first measurement assume a wide container to avoid a flash of
  // the stacked layout on mount.
  return width.value > 0 && width.value < props.stackBelow
})

const stacked = computed(() => props.orientation === 'vertical' || autoStacked.value)

const ratio = computed({
  get: () => (autoStacked.value ? stackRatio.value : sideRatio.value),
  set: (value: number) => {
    if (autoStacked.value) stackRatio.value = value
    else sideRatio.value = value
  },
})

/** Content sized panes simply flow below each other once they are stacked. */
const resizable = computed(() => !(stacked.value && props.sizing === 'content'))

const clamped = computed(() => clampRatio(ratio.value))

const gridStyle = computed(() => {
  if (!resizable.value) {
    return {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: 'auto auto',
      rowGap: 'var(--sp-3)',
    }
  }

  // Stacked panes keep a workable height and let the page scroll instead of
  // squeezing two tools into the height meant for one.
  const floor = autoStacked.value ? props.stackedMin : '0'
  const track = `minmax(${floor}, ${clamped.value}fr) ${DIVIDER}px minmax(${floor}, ${1 - clamped.value}fr)`

  if (!stacked.value) {
    return {
      gridTemplateColumns: track,
      gridTemplateRows: props.sizing === 'content' ? 'auto' : 'minmax(0, 1fr)',
    }
  }

  return {
    gridTemplateRows: track,
    gridTemplateColumns: 'minmax(0, 1fr)',
    ...(autoStacked.value ? { minHeight: props.stackedHeight } : {}),
  }
})

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return props.defaultRatio
  const element = root.value
  const available =
    (element ? (stacked.value ? element.clientHeight : element.clientWidth) : 0) - DIVIDER

  if (available <= 0) return Math.min(Math.max(value, 0.05), 0.95)
  if (props.minA + props.minB >= available) return 0.5

  const min = props.minA / available
  const max = 1 - props.minB / available
  return Math.min(Math.max(value, min), max)
}

function onPointerDown(event: PointerEvent): void {
  const element = root.value
  if (!element || event.button !== 0) return

  ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  dragging.value = true
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  const element = root.value
  if (!dragging.value || !element) return

  const rect = element.getBoundingClientRect()
  const total = (stacked.value ? rect.height : rect.width) - DIVIDER
  if (total <= 0) return

  const offset = stacked.value ? event.clientY - rect.top : event.clientX - rect.left
  ratio.value = clampRatio((offset - DIVIDER / 2) / total)
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  const target = event.target as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

function onKeydown(event: KeyboardEvent): void {
  const back = stacked.value ? 'ArrowUp' : 'ArrowLeft'
  const forward = stacked.value ? 'ArrowDown' : 'ArrowRight'

  switch (event.key) {
    case back:
      ratio.value = clampRatio(clamped.value - KEYBOARD_STEP)
      break
    case forward:
      ratio.value = clampRatio(clamped.value + KEYBOARD_STEP)
      break
    case 'Home':
      ratio.value = clampRatio(0)
      break
    case 'End':
      ratio.value = clampRatio(1)
      break
    case 'Enter':
    case ' ':
      reset()
      break
    default:
      return
  }
  event.preventDefault()
}

function reset(): void {
  ratio.value = props.defaultRatio
}

let observer: ResizeObserver | null = null

onMounted(() => {
  if (!root.value) return
  width.value = root.value.clientWidth
  observer = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (entry) width.value = entry.contentRect.width
  })
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div
    ref="root"
    class="splitpane"
    :class="{ 'splitpane--stacked': stacked, 'splitpane--dragging': dragging }"
    :style="gridStyle"
  >
    <div class="splitpane__pane"><slot name="a" /></div>

    <div
      v-if="resizable"
      class="splitpane__divider"
      role="separator"
      tabindex="0"
      :aria-label="label"
      :aria-orientation="stacked ? 'horizontal' : 'vertical'"
      :aria-valuenow="Math.round(clamped * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="reset"
      @keydown="onKeydown"
    >
      <span class="splitpane__grip" />
    </div>

    <div class="splitpane__pane"><slot name="b" /></div>
  </div>
</template>

<style scoped>
.splitpane {
  display: grid;
  min-width: 0;
  min-height: 0;
}

.splitpane__pane {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
  min-height: 0;
}

/* A pane normally hosts a single panel - let it claim the whole cell. */
.splitpane__pane > :deep(*) {
  flex: 1 1 auto;
  min-height: 0;
}

.splitpane__divider {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
  border-radius: var(--radius-sm);
  transition: background var(--transition);
}

.splitpane--stacked .splitpane__divider {
  cursor: row-resize;
}

.splitpane__grip {
  background: var(--border);
  border-radius: 999px;
  transition:
    background var(--transition),
    box-shadow var(--transition);
}

.splitpane:not(.splitpane--stacked) .splitpane__grip {
  width: 2px;
  height: 34px;
  min-height: 24px;
}

.splitpane--stacked .splitpane__grip {
  width: 34px;
  height: 2px;
}

.splitpane__divider:hover .splitpane__grip,
.splitpane__divider:focus-visible .splitpane__grip,
.splitpane--dragging .splitpane__grip {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.splitpane__divider:focus-visible {
  outline: 1px solid var(--accent-dim);
  outline-offset: -1px;
}

/* Keep the pointer stream on the divider while dragging over an editor. */
.splitpane--dragging {
  user-select: none;
}

.splitpane--dragging .splitpane__pane {
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .splitpane__divider,
  .splitpane__grip {
    transition: none;
  }
}
</style>
