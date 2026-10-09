import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history, undoDepth} from '@codemirror/commands';
import {restoreEditorState, serializeDocument} from '../js/ppg-editor-state.js';

test('CM5 text and multiple selections import without changing the saved document', () => {
  const saved = {value: 'main()\n{\n\treturn;\n}', selection: {ranges: [{anchor: {line: 2, ch: 1}, head: {line: 2, ch: 7}}], primIndex: 0}};
  const before = JSON.stringify(saved);
  const state = restoreEditorState(saved, [history()]);
  assert.equal(state.doc.toString(), saved.value);
  assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), 'return');
  assert.equal(JSON.stringify(saved), before);
});

test('CM6 document round trips preserve selection and undo history', () => {
  let state = EditorState.create({doc: 'main()', extensions: [history()]});
  state = state.update({changes: {from: 6, insert: ' '}, selection: {anchor: 7}}).state;
  const saved = serializeDocument({name: 'demo', uid: 1, state, scrollTop: 40});
  const restored = restoreEditorState(JSON.parse(JSON.stringify(saved)), [history()]);
  assert.equal(restored.doc.toString(), 'main() ');
  assert.equal(restored.selection.main.head, 7);
  assert.equal(undoDepth(restored), 1);
  assert.equal(saved.scrollTop, 40);
});

import {readSavedDocuments, writeSavedDocuments} from '../js/ppg-editor-state.js';
function storage(values) {
  return {...values, removeItem(key) {delete this[key];}};
}

test('experiment documents migrate once to the application keys and preserve the legacy backup', () => {
  const old = JSON.stringify([{name: 'old', uid: 1, value: 'main() {}'}]);
  const experiment = [{name: 'new', uid: 2, state: {doc: 'main() { return; }'}}];
  const saved = storage({ppgDocuments: old, ppgDocumentsV6: JSON.stringify(experiment), ppgActiveDocV6: '2'});
  const imported = readSavedDocuments(saved);
  assert.deepEqual(imported.documents, experiment);
  assert.equal(imported.active, '2');
  writeSavedDocuments(saved, imported.documents, imported.active);
  assert.equal(saved.ppgDocumentsLegacyBackup, old);
  assert.equal(saved.ppgEditorVersion, '6');
  assert.equal(saved.ppgDocumentsV6, undefined);
  assert.deepEqual(readSavedDocuments(saved).documents, experiment);
  saved.ppgDocumentsV6 = old;
  assert.deepEqual(readSavedDocuments(saved).documents, experiment);
});

test('existing application saves import when there are no experiment documents', () => {
  const saved = storage({ppgDocuments: JSON.stringify([{uid: 1, value: 'main() {}'}]), ppgActiveDoc: '1'});
  assert.equal(readSavedDocuments(saved).documents[0].value, 'main() {}');
  assert.equal(readSavedDocuments(saved).active, '1');
});
