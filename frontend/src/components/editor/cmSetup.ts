/**
 * Language + feature extension presets for the shared `CodeEditor` component.
 */

import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language'
import { lintGutter, linter } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

export type EditorLanguage = 'json' | 'javascript' | 'typescript' | 'html' | 'xml' | 'text'

export function languageExtension(language: EditorLanguage): Extension[] {
  switch (language) {
    case 'json':
      return [json()]
    case 'javascript':
      return [javascript()]
    case 'typescript':
      return [javascript({ typescript: true })]
    case 'html':
      return [html()]
    case 'xml':
      return [xml()]
    default:
      return []
  }
}

/** JSON syntax errors as inline squiggles + gutter markers. */
export function jsonLinting(): Extension[] {
  return [linter(jsonParseLinter()), lintGutter()]
}

export interface BaseSetupOptions {
  lineNumbers: boolean
  foldGutter: boolean
  highlightActiveLine: boolean
  tabSize: number
}

export function baseSetup(options: BaseSetupOptions): Extension[] {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    indentUnit.of(' '.repeat(options.tabSize)),
    EditorState.tabSize.of(options.tabSize),
    EditorState.allowMultipleSelections.of(true),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    highlightSelectionMatches(),
    highlightSpecialChars(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
  ]

  if (options.lineNumbers) extensions.push(lineNumbers())
  if (options.foldGutter) extensions.push(foldGutter())
  if (options.highlightActiveLine) {
    extensions.push(highlightActiveLine(), highlightActiveLineGutter())
  }
  return extensions
}
