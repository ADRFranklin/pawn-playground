import {EditorState, EditorSelection} from '@codemirror/state';
import {historyField} from '@codemirror/commands';

export const storageKeys = {
  documents: 'ppgDocuments', active: 'ppgActiveDoc', revision: 'ppgSaveRevision', version: 'ppgEditorVersion'
};
export const historyFields = {history: historyField};

// Prefer experiment saves once, then use the established application keys.
export function readSavedDocuments(storage) {
  const experiment = storage[storageKeys.version] !== '6' && storage.ppgDocumentsV6;
  const raw = experiment || storage[storageKeys.documents] || '[]';
  const documents = JSON.parse(raw);
  return {
    documents: Array.isArray(documents) ? documents : [],
    active: experiment ? storage.ppgActiveDocV6 : storage[storageKeys.active]
  };
}

export function writeSavedDocuments(storage, documents, active) {
  if (storage[storageKeys.version] !== '6' && storage[storageKeys.documents] && !storage.ppgDocumentsLegacyBackup) {
    storage.ppgDocumentsLegacyBackup = storage[storageKeys.documents];
  }
  storage[storageKeys.documents] = JSON.stringify(documents);
  storage[storageKeys.active] = active;
  storage[storageKeys.version] = '6';
  const revision = (+storage[storageKeys.revision] || 0) + 1;
  // Notify other tabs only after the complete document snapshot is written.
  storage[storageKeys.revision] = revision;
  for (const key of ['ppgDocumentsV6', 'ppgActiveDocV6', 'ppgSaveRevisionV6']) storage.removeItem(key);
  return revision;
}

function offset(doc, position) {
  const line = doc.line(Math.max(1, Math.min(doc.lines, (position?.line || 0) + 1)));
  return line.from + Math.max(0, Math.min(line.length, position?.ch || 0));
}

export function restoreEditorState(saved, extensions) {
  if (saved.state) return EditorState.fromJSON(saved.state, {extensions}, historyFields);
  const state = EditorState.create({doc: saved.value || '', extensions});
  const ranges = saved.selection?.ranges || [{anchor: saved.cursor, head: saved.cursor}];
  const selection = EditorSelection.create(ranges.map(range => EditorSelection.range(
    offset(state.doc, range.anchor), offset(state.doc, range.head)
  )), Math.min(saved.selection?.primIndex || 0, ranges.length - 1));
  return state.update({selection}).state;
}

export function serializeDocument(doc) {
  return {
    name: doc.name, uid: doc.uid, errors: doc.errors || [],
    state: doc.state.toJSON(historyFields),
    scrollLeft: doc.scrollLeft || 0, scrollTop: doc.scrollTop || 0
  };
}
