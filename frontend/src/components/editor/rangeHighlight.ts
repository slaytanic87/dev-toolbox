/**
 * Generic range highlighting for CodeMirror, used by the regex playground
 * to paint matches and capture groups onto the test text.
 */

import { StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

export interface HighlightRange {
  from: number
  to: number
  className: string
}

function buildDecorations(ranges: HighlightRange[], docLength: number): DecorationSet {
  const marks = ranges
    .map((range) => ({
      from: Math.max(0, Math.min(range.from, docLength)),
      to: Math.max(0, Math.min(range.to, docLength)),
      className: range.className,
    }))
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from || b.to - a.to)
    .map((range) =>
      Decoration.mark({ class: range.className }).range(range.from, range.to),
    )

  return Decoration.set(marks, true)
}

export function rangeHighlight(ranges: HighlightRange[]): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(ranges, state.doc.length),
    // Ranges are recomputed by the owning component after every change,
    // so mapping through the transaction is enough to avoid flicker.
    update: (decorations, tr) => (tr.docChanged ? decorations.map(tr.changes) : decorations),
    provide: (f) => EditorView.decorations.from(f),
  })
  return [field, rangeHighlightTheme]
}

export const rangeHighlightTheme = EditorView.theme({
  '.cm-rx-match': {
    backgroundColor: 'rgba(0,255,156,0.16)',
    outline: '1px solid rgba(0,255,156,0.45)',
    borderRadius: '2px',
  },
  '.cm-rx-match-odd': {
    backgroundColor: 'rgba(25,227,255,0.14)',
    outline: '1px solid rgba(25,227,255,0.40)',
    borderRadius: '2px',
  },
  '.cm-rx-group': {
    backgroundColor: 'rgba(160,124,255,0.26)',
    borderBottom: '1px solid rgba(160,124,255,0.8)',
  },
})
