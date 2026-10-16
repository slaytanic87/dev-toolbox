<script setup lang="ts">
/**
 * Reusable CodeMirror 6 editor.
 * All tools share this component so editing behaviour stays consistent.
 */
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, placeholder as placeholderExt } from '@codemirror/view'
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

import { baseSetup, jsonLinting, languageExtension, type EditorLanguage } from './cmSetup'
import { hackerEditorTheme } from './cmTheme'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: EditorLanguage
    readonly?: boolean
    placeholder?: string
    lineNumbers?: boolean
    foldGutter?: boolean
    wrap?: boolean
    lint?: boolean
    tabSize?: number
    minHeight?: string
    maxHeight?: string
    /** Extra extensions (decorations, listeners, ...) supplied by a tool. */
    extensions?: Extension[]
  }>(),
  {
    language: 'text',
    readonly: false,
    placeholder: '',
    lineNumbers: true,
    foldGutter: false,
    wrap: true,
    lint: false,
    tabSize: 2,
    minHeight: '120px',
    maxHeight: 'none',
    extensions: () => [],
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = useTemplateRef<HTMLDivElement>('host')
const view = shallowRef<EditorView | null>(null)

const languageCompartment = new Compartment()
const readonlyCompartment = new Compartment()
const wrapCompartment = new Compartment()
const extraCompartment = new Compartment()

function buildExtensions(): Extension[] {
  return [
    ...baseSetup({
      lineNumbers: props.lineNumbers,
      foldGutter: props.foldGutter,
      highlightActiveLine: !props.readonly,
      tabSize: props.tabSize,
    }),
    hackerEditorTheme,
    languageCompartment.of([
      ...languageExtension(props.language),
      ...(props.lint && props.language === 'json' ? jsonLinting() : []),
    ]),
    wrapCompartment.of(props.wrap ? EditorView.lineWrapping : []),
    readonlyCompartment.of([
      EditorState.readOnly.of(props.readonly),
      EditorView.editable.of(!props.readonly),
    ]),
    extraCompartment.of(props.extensions),
    placeholderExt(props.placeholder),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
    }),
  ]
}

onMounted(() => {
  if (!host.value) return
  view.value = new EditorView({
    state: EditorState.create({ doc: props.modelValue, extensions: buildExtensions() }),
    parent: host.value,
  })
})

onBeforeUnmount(() => {
  view.value?.destroy()
  view.value = null
})

watch(
  () => props.modelValue,
  (value) => {
    const instance = view.value
    if (!instance || instance.state.doc.toString() === value) return
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: value },
      // Keep the caret inside the new document bounds.
      selection: { anchor: Math.min(instance.state.selection.main.anchor, value.length) },
    })
  },
)

watch(
  () => [props.language, props.lint] as const,
  ([language, lint]) => {
    view.value?.dispatch({
      effects: languageCompartment.reconfigure([
        ...languageExtension(language),
        ...(lint && language === 'json' ? jsonLinting() : []),
      ]),
    })
  },
)

watch(
  () => props.readonly,
  (readonly) => {
    view.value?.dispatch({
      effects: readonlyCompartment.reconfigure([
        EditorState.readOnly.of(readonly),
        EditorView.editable.of(!readonly),
      ]),
    })
  },
)

watch(
  () => props.wrap,
  (wrap) => {
    view.value?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  },
)

watch(
  () => props.extensions,
  (extensions) => {
    view.value?.dispatch({ effects: extraCompartment.reconfigure(extensions) })
  },
)

defineExpose({
  focus: () => view.value?.focus(),
  getView: () => view.value,
})
</script>

<template>
  <div
    ref="host"
    class="code-editor"
    :class="{ 'code-editor--readonly': readonly }"
    :style="{ '--editor-min-h': minHeight, '--editor-max-h': maxHeight }"
  />
</template>

<style scoped>
.code-editor {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: var(--editor-min-h, 120px);
  max-height: var(--editor-max-h, none);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  transition: border-color var(--transition);
}

.code-editor:focus-within {
  border-color: var(--accent-dim);
  box-shadow: 0 0 0 2px var(--accent-ghost);
}

.code-editor--readonly {
  background: var(--bg-panel-alt);
}

.code-editor :deep(.cm-editor) {
  width: 100%;
  height: 100%;
}

.code-editor :deep(.cm-scroller) {
  overflow: auto;
}
</style>
