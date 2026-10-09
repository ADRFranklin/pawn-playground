import {test} from 'node:test';
import assert from 'node:assert/strict';
import {highlightTree} from '@lezer/highlight';
import {EditorState} from '@codemirror/state';
import {foldable, ensureSyntaxTree, indentUnit, getIndentation} from '@codemirror/language';
import {pawnLanguage, pawnAsmLanguage, pawnHighlightStyle, pawnFolding} from '../js/ppg-language.js';

function tokens(source, language = pawnLanguage) {
  const tokens = [];
  highlightTree(language.parser.parse(source), pawnHighlightStyle,
    (from, to, style) => tokens.push([source.slice(from, to), style]));
  return tokens;
}
function hasToken(source, text, style) {
  assert(tokens(source).some(token => token[0] === text && token[1] === `cm-${style}`), JSON.stringify(tokens(source)));
}

test('Pawn directives, macros, function names, and numbers retain the palette', () => {
  const source = '#include <open.mp>   \n#define greet(%1) "Hello, " %1\nmain() { new i = 1; greet("world"); custom (i + 1); }';
  for (const [text, style] of [['#include', 'meta'], ['<open.mp>   ', 'link'], ['greet', 'atom'], ['main', 'def'], ['new', 'keyword'], ['custom', 'def']]) hasToken(source, text, style);
  hasToken('i + 1', '1', 'number');
  hasToken('i + 1', 'i', 'variable');
  hasToken('1.25e-3', '1.25e-3', 'number');
});

test('continued macros and optional includes do not leak into following code', () => {
  hasToken('#tryinclude <optional>\nnew count = 5;', 'new', 'keyword');
  hasToken('#define greet(%1) \\\n printf("%s", %1)\nnew value = 5;', '%1', 'variable-2');
  hasToken('#define greet(%1) \\\n printf("%s", %1)\nnew value = 5;', 'new', 'keyword');
});

test('Pawn supports indentation and folding through the CM6 language service', () => {
  const state = EditorState.create({doc: 'main()\n{\n\tprintf("{");\n}\n', extensions: [pawnLanguage, pawnFolding, indentUnit.of('\t')]});
  ensureSyntaxTree(state, state.doc.length, 1000);
  assert.equal(getIndentation(state, state.doc.line(2).from), 0);
  assert.equal(getIndentation(state, state.doc.line(3).from), 4);
  assert.equal(getIndentation(state, state.doc.line(4).from), 0);
  assert.deepEqual(foldable(state, state.doc.line(2).from, state.doc.line(2).to), {from: state.doc.line(2).to, to: state.doc.line(4).from});
});

test('assembly listing parser recognises opcodes and comments', () => {
  const result = tokens('proc\nconst.pri 00000001\n; line 1', pawnAsmLanguage);
  assert(result.some(([text, style]) => /PROC/i.test(text) && /atom/.test(style)), JSON.stringify(result));
  assert(result.some(([, style]) => style === 'cm-comment'), JSON.stringify(result));
});

test('invalid format sequences remain strings and the parser always advances', () => {
  assert.doesNotThrow(() => tokens('printf("%5z %123 %! %5.2f");'));
  hasToken('printf("%5z %123 %!");', 'printf', 'builtin');
});

test('comments fold and braces inside comments and strings do not offer folds', () => {
  for (const source of ['// {\n// }', 'printf("{");\nprintf("}");']) {
    const state = EditorState.create({doc: source, extensions: [pawnLanguage, pawnFolding]});
    ensureSyntaxTree(state, state.doc.length, 1000);
    assert.equal(foldable(state, 0, state.doc.line(1).to), null);
  }
  const state = EditorState.create({doc: '/*\n comment\n*/', extensions: [pawnLanguage, pawnFolding]});
  ensureSyntaxTree(state, state.doc.length, 1000);
  assert.deepEqual(foldable(state, 0, 2), {from: 2, to: state.doc.line(3).from});
});
