/**
 * CodeMirror 6 theme matching the DevToolbox terminal look.
 * Colours intentionally reference the CSS custom properties from `tokens.css`
 * where CodeMirror allows it, and fall back to literals where it does not.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const ACCENT = '#00ff9c'
const CYAN = '#19e3ff'
const MAGENTA = '#ff3cad'
const VIOLET = '#a07cff'
const AMBER = '#ffcf4a'
const DANGER = '#ff5466'
const TEXT = '#cbe7df'
const MUTED = '#6f8d93'
const DIM = '#3d565c'

export const hackerTheme: Extension = EditorView.theme(
  {
    '&': {
      color: TEXT,
      backgroundColor: 'transparent',
      fontSize: '0.8rem',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, Consolas, monospace",
      lineHeight: '1.6',
    },
    '.cm-content': {
      caretColor: ACCENT,
      padding: '8px 0',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: DIM,
      border: 'none',
      borderRight: '1px solid #102532',
    },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(0,255,156,0.06)', color: ACCENT },
    '.cm-activeLine': { backgroundColor: 'rgba(0,255,156,0.04)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: ACCENT, borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(0,255,156,0.20)',
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(25,227,255,0.18)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(25,227,255,0.22)',
      outline: 'none',
      color: '#e8fff7',
    },
    '.cm-nonmatchingBracket': { color: DANGER },
    '.cm-placeholder': { color: DIM, fontStyle: 'italic' },
    '.cm-tooltip': {
      backgroundColor: '#0d1620',
      border: '1px solid #1d4a5c',
      borderRadius: '5px',
      color: TEXT,
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgba(0,255,156,0.14)',
      color: '#e8fff7',
    },
    '.cm-panels': { backgroundColor: '#0a1118', color: TEXT, borderColor: '#16303d' },
    '.cm-panels input, .cm-panels button': {
      backgroundColor: '#060d13',
      color: TEXT,
      border: '1px solid #16303d',
      borderRadius: '3px',
      padding: '2px 6px',
    },
    '.cm-searchMatch': { backgroundColor: 'rgba(255,207,74,0.25)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255,207,74,0.5)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'rgba(0,255,156,0.12)',
      border: 'none',
      color: ACCENT,
      padding: '0 6px',
    },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: `underline wavy ${DANGER}` },
  },
  { dark: true },
)

export const hackerHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: MUTED, fontStyle: 'italic' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: MAGENTA },
  { tag: [t.operator, t.operatorKeyword, t.punctuation, t.separator], color: MUTED },
  { tag: [t.bracket, t.brace, t.squareBracket, t.paren], color: '#4f7f8c' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: CYAN },
  { tag: [t.variableName, t.definition(t.variableName)], color: TEXT },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: ACCENT },
  { tag: [t.string, t.special(t.string)], color: ACCENT },
  { tag: [t.number, t.integer, t.float], color: AMBER },
  { tag: [t.bool, t.null, t.atom], color: VIOLET },
  { tag: [t.typeName, t.className, t.namespace], color: '#7fe3c4' },
  { tag: [t.tagName], color: MAGENTA },
  { tag: [t.attributeName], color: CYAN },
  { tag: [t.attributeValue], color: ACCENT },
  { tag: [t.regexp], color: AMBER },
  { tag: [t.escape], color: VIOLET },
  { tag: [t.meta, t.documentMeta], color: MUTED },
  { tag: [t.link, t.url], color: CYAN, textDecoration: 'underline' },
  { tag: [t.heading], color: ACCENT, fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.invalid], color: DANGER },
])

export const hackerEditorTheme: Extension = [hackerTheme, syntaxHighlighting(hackerHighlightStyle)]
