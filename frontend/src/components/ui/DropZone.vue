<script setup lang="ts">
/** Drag & drop + click-to-browse file target. Paste support is wired by the parent. */
import { ref } from 'vue'

import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

const props = withDefaults(
  defineProps<{ accept?: string; multiple?: boolean; disabled?: boolean; icon?: IconName }>(),
  { accept: 'image/*', multiple: false, disabled: false, icon: 'image' },
)

const emit = defineEmits<{ files: [files: File[]] }>()

const input = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
let dragDepth = 0

function emitFiles(list: FileList | null | undefined): void {
  if (!list || list.length === 0) return
  emit('files', Array.from(list))
}

function onDrop(event: DragEvent): void {
  dragDepth = 0
  isDragging.value = false
  if (props.disabled) return
  emitFiles(event.dataTransfer?.files)
}

function onDragEnter(): void {
  if (props.disabled) return
  dragDepth++
  isDragging.value = true
}

function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragging.value = false
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement
  emitFiles(target.files)
  target.value = ''
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ 'is-dragging': isDragging, 'is-disabled': disabled }"
    role="button"
    tabindex="0"
    @click="!disabled && input?.click()"
    @keydown.enter.prevent="!disabled && input?.click()"
    @keydown.space.prevent="!disabled && input?.click()"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      type="file"
      class="dropzone__input"
      :accept="accept"
      :multiple="multiple"
      @change="onChange"
    />
    <AppIcon :name="props.icon" :size="26" />
    <p class="dropzone__title"><slot name="title">Drop an image, paste or click to browse</slot></p>
    <p class="dropzone__hint">
      <slot name="hint">PNG, JPG, WEBP, GIF or SVG &middot; everything stays on your machine</slot>
    </p>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5) var(--sp-4);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 9px,
    rgb(255 255 255 / 1.5%) 9px,
    rgb(255 255 255 / 1.5%) 18px
  );
  color: var(--text-muted);
  text-align: center;
  cursor: pointer;
  transition: border-color var(--transition), background var(--transition), color var(--transition);
}

.dropzone:hover:not(.is-disabled),
.dropzone.is-dragging {
  border-color: var(--accent);
  background-color: var(--accent-ghost);
  color: var(--accent);
}

.dropzone.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dropzone__input {
  display: none;
}

.dropzone__title {
  margin: 0;
  font-size: var(--fs-sm);
}

.dropzone__hint {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
}
</style>
