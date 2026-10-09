import {EditorView} from '@codemirror/view';

export const pawnEditorTheme = EditorView.theme({
  '&': {height: '100%', color: '#D6D9E3', backgroundColor: '#14171C'},
  '&.cm-focused': {outline: 'none'},
  '.cm-scroller': {overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: '14px', lineHeight: '1.6'},
  '.cm-content': {padding: '8px 0', caretColor: '#D6D9E3'},
  '.cm-line': {padding: '0 4px'},
  '.cm-gutters': {backgroundColor: '#14171C', color: '#667185', borderRight: '1px solid #282e38'},
  '.cm-lineNumbers .cm-gutterElement': {paddingLeft: '4px', paddingRight: '12px'},
  '.cm-activeLine, .cm-activeLineGutter': {backgroundColor: 'rgba(255,255,255,0.025)'},
  '.cm-cursor, .cm-dropCursor': {borderLeftColor: '#D6D9E3'},
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {backgroundColor: '#38304f'},
  '.cm-selectionMatch': {backgroundColor: 'rgba(160,120,255,0.18)'},
  '.cm-matchingBracket': {color: '#88C0D0', backgroundColor: 'rgba(136,192,208,0.12)'},
  '.cm-panels, .cm-tooltip': {backgroundColor: '#191d24', color: '#D6D9E3', borderColor: '#282e38'},
  '.cm-search input, .cm-search button': {color: '#D6D9E3', backgroundColor: '#252a34', border: '1px solid #667185'},
  '.cm-foldPlaceholder': {backgroundColor: '#252a34', color: '#88C0D0', borderColor: '#282e38'},
  '.cm-diagnostic': {fontFamily: 'var(--font-mono)'},
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {backgroundColor: '#38304f', color: '#D6D9E3'}
}, {dark: true});
