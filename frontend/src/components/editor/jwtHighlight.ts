/**
 * CodeMirror decoration that colours the three JWT segments
 * (header / payload / signature) the way jwt.io does.
 */

import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

const SEGMENT_MARKS = [
  Decoration.mark({ class: 'cm-jwt-header' }),
  Decoration.mark({ class: 'cm-jwt-payload' }),
  Decoration.mark({ class: 'cm-jwt-signature' }),
]

const DOT_MARK = Decoration.mark({ class: 'cm-jwt-dot' })

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()

  let segment = 0
  let start = 0

  for (let i = 0; i <= text.length; i++) {
    const isEnd = i === text.length
    if (!isEnd && text[i] !== '.') continue

    if (i > start && segment < SEGMENT_MARKS.length) {
      builder.add(start, i, SEGMENT_MARKS[segment] as Decoration)
    }
    if (!isEnd) builder.add(i, i + 1, DOT_MARK)
    segment++
    start = i + 1
  }
  return builder.finish()
}

const jwtHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const jwtHighlightTheme = EditorView.theme({
  '.cm-jwt-header': { color: '#ff3cad' },
  '.cm-jwt-payload': { color: '#a07cff' },
  '.cm-jwt-signature': { color: '#19e3ff' },
  '.cm-jwt-dot': { color: '#cbe7df', fontWeight: '700' },
})

export const jwtHighlight: Extension = [jwtHighlightPlugin, jwtHighlightTheme]
