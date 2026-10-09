import {EditorState, Compartment, Prec} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine} from '@codemirror/view';
import {history, defaultKeymap, historyKeymap, indentWithTab, deleteLine, selectLine,
  moveLineUp, moveLineDown, copyLineUp, copyLineDown} from '@codemirror/commands';
import {syntaxHighlighting, indentUnit, indentOnInput, bracketMatching, foldGutter, foldKeymap} from '@codemirror/language';
import {searchKeymap, highlightSelectionMatches, selectNextOccurrence} from '@codemirror/search';
import {autocompletion, completeFromList, closeBrackets, closeBracketsKeymap, completionKeymap} from '@codemirror/autocomplete';
import {lintGutter, setDiagnostics, lintKeymap} from '@codemirror/lint';
import {vim} from '@replit/codemirror-vim';
import {emacs} from '@replit/codemirror-emacs';
import {vscodeKeymap} from '@replit/codemirror-vscode-keymap';
import {pawnLanguage, pawnHighlightStyle, pawnFolding, pawnCompletions, highlightCode} from './ppg-language.js';
import {pawnEditorTheme} from './ppg-editor-theme.js';
import {storageKeys, restoreEditorState, serializeDocument, readSavedDocuments, writeSavedDocuments} from './ppg-editor-state.js';

'use strict';

window.PPG = (function (self) {
  var $app = $('.app');
  var $editor = $app.find('.main > .editor');
  var $documentList = $app.find('.document-list');

  var lintErrors = [];
  var keyMap = localStorage.keyMap || 'default';
  $('.keymap-current').text(keyMap);
  $('.select-keymap .dropdown-item').each(function() {
    $(this).toggleClass('active', $(this).data('keymap') === keyMap);
  });

  const keymapConfig = new Compartment();
  let view;

  const shortcuts = [
    ['Ctrl-Enter', '#run'], ['Alt-Shift-c', '#compile'],
    ['Alt-Shift-l', '#compile-lst'], ['Alt-Shift-a', '#compile-asm'], ['Alt-Shift-m', '#compile-macros']
  ].map(([key, selector]) => ({key, run: () => { $(selector).trigger('click'); return true; }}));

  const sublimeKeymap = [
    {key: 'Mod-d', run: selectNextOccurrence},
    {key: 'Mod-Shift-k', run: deleteLine},
    {key: 'Mod-l', run: selectLine},
    {key: 'Alt-Up', run: moveLineUp}, {key: 'Alt-Down', run: moveLineDown},
    {key: 'Alt-Shift-Up', run: copyLineUp}, {key: 'Alt-Shift-Down', run: copyLineDown}
  ];

  function selectedKeymap() {
    const bindings = keyMap === 'vscode' ? keymap.of(vscodeKeymap)
      : keyMap === 'sublime' ? keymap.of(sublimeKeymap)
      : keyMap === 'vim' ? vim()
      : keyMap === 'emacs' ? emacs() : [];
    return [bindings, keymap.of([...closeBracketsKeymap, ...completionKeymap, indentWithTab,
      ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap])];
  }

  function extensions() {
    return [
      pawnLanguage, pawnFolding, pawnEditorTheme, syntaxHighlighting(pawnHighlightStyle),
      EditorView.editorAttributes.of({class: 'cm-s-pawn'}),
      EditorView.contentAttributes.of({'aria-label': 'Pawn source code'}),
      EditorState.tabSize.of(4), indentUnit.of('\t'), EditorState.allowMultipleSelections.of(true),
      history(), lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
      drawSelection(), dropCursor(), rectangularSelection(), crosshairCursor(),
      highlightActiveLine(), highlightSelectionMatches(), bracketMatching(),
      indentOnInput(), closeBrackets(), foldGutter({openText: '−', closedText: '+'}), lintGutter(),
      autocompletion(), pawnLanguage.data.of({autocomplete: completeFromList(pawnCompletions)}),
      Prec.highest(keymap.of(shortcuts)), keymapConfig.of(selectedKeymap()),
      EditorView.updateListener.of(update => {
        if (!docs?.[activeDoc]?.uid) return;
        docs[activeDoc].state = update.state;
        if (update.docChanged) {
          if (lintErrors.length) {
            lintErrors = [];
            docs[activeDoc].errors = [];
            queueMicrotask(() => applyDiagnostics());
          }
          setSaveTimeout();
        }
      })
    ];
  }

  function applyDiagnostics() {
    const doc = view.state.doc;
    const diagnostics = lintErrors.map(error => {
      const start = doc.line(Math.max(1, Math.min(doc.lines, error.startLine)));
      const end = doc.line(Math.max(start.number, Math.min(doc.lines, error.endLine)));
      return {from: start.from, to: end.to, message: error.message,
        severity: error.type === 'warning' ? 'warning' : 'error'};
    });
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }

  var saveTimeout = null;

  function setSaveTimeout() {
    if (saveTimeout !== null) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(function() {
      saveTimeout = null;
      saveDocuments();
    }, 250);
  }

  const demoCode = [
      '/*',
      ' * Pawn Playground — click Run, Compile, LST, ASM, or Macros.',
      ' *',
      ' * Shortcuts:',
      ' *   Ctrl+Enter   - run',
      ' *   Alt+Shift+C  - compile',
      ' *   Alt+Shift+L  - generate LST output',
      ' *   Alt+Shift+A  - generate ASM output',
      ' *   Alt+Shift+M  - show macro expansions',
      ' */',
      '',
      '#include <open.mp>',
      '',
      '#define MAX_ITEMS 5',
      '#define GREET(%1) "Hello, " %1',
      '',
      'main()',
      '{',
      '\tnew items[MAX_ITEMS];',
      '\tnew greeting[] = GREET("world!");',
      '\t',
      '\tprintf("%s\\n", greeting);',
      '\t',
      '\tfor (new i = 0; i < MAX_ITEMS; i++) {',
      '\t\titems[i] = i * i;',
      '\t\tprintf("items[%d] = %d\\n", i, items[i]);',
      '\t}',
      '}'
    ].join('\n');

  var activeDoc = 0;
  var docs;
  var savedActive;

  loadDocuments();
  view = new EditorView({parent: $editor.get(0), state: docs[1].state});
  view.scrollDOM.addEventListener('scroll', () => {
    if (!docs[activeDoc]?.uid) return;
    docs[activeDoc].scrollTop = view.scrollDOM.scrollTop;
    docs[activeDoc].scrollLeft = view.scrollDOM.scrollLeft;
  });
  setActiveDocument(findActiveDoc() || 1);
  if (localStorage[storageKeys.version] !== '6') saveDocuments();

  // Multi-tab cross-window sync via the 'storage' event — zero CPU cost when
  // the user is idle, fires immediately when another tab writes ppgSaveRevision.
  var saveRev = +localStorage[storageKeys.revision] || 0;

  $(window).on('storage', function(e) {
    if (e.originalEvent.key !== storageKeys.revision) return;
    if (+localStorage[storageKeys.revision] === saveRev) return;
    saveRev = +localStorage[storageKeys.revision];
    var activeUid = docs[activeDoc].uid;
    loadDocuments();
    var foundDoc = null;
    for (var i = 0; i < docs.length; i++) {
      if (docs[i].uid === activeUid) { foundDoc = i; break; }
    }
    setActiveDocument(foundDoc !== null ? foundDoc : (findActiveDoc() || 1));
    syncDocumentList();
  });

  // ---- Lint ----------------------------------------------------------------

  self.clearEditorErrors = function() {
    lintErrors = [];
    if (docs[activeDoc]) docs[activeDoc].errors = [];
    applyDiagnostics();
  };

  self.setEditorErrors = function(errors) {
    lintErrors = errors;
    if (docs[activeDoc]) docs[activeDoc].errors = errors;
    applyDiagnostics();
  };

  // ---- Documents -----------------------------------------------------------

  // ---- New document modal ------------------------------------------------

  var $newDocModal = $('#new-doc-modal');
  var $newDocInput = $('#new-doc-name');
  var $newDocConfirm = $('#new-doc-confirm');
  var bsNewDocModal = new bootstrap.Modal($newDocModal[0]);

  var $deleteDocModal = $('#delete-doc-modal');
  var $deleteDocName  = $('#delete-doc-name');
  var $deleteDocConfirm = $('#delete-doc-confirm');
  var bsDeleteDocModal = new bootstrap.Modal($deleteDocModal[0]);
  var _pendingDeleteDoc = -1;

  function promptDeleteDocument(docIdx) {
    if (docIdx === 0) return;
    _pendingDeleteDoc = docIdx;
    $deleteDocName.text(docs[docIdx].name);
    bsDeleteDocModal.show();
  }

  $deleteDocConfirm.on('click', function() {
    this.blur(); // move focus out before Bootstrap sets aria-hidden
    bsDeleteDocModal.hide();
    if (_pendingDeleteDoc > 0) {
      deleteDocument(_pendingDeleteDoc);
      _pendingDeleteDoc = -1;
    }
  });

  $deleteDocModal.on('hidden.bs.modal', function() { _pendingDeleteDoc = -1; });

  function isNameTaken(name) {
    for (var i = 0; i < docs.length; i++) {
      if (docs[i].name === name) return true;
    }
    return false;
  }

  function promptNewDocument(callback) {
    $newDocInput.val('').removeClass('is-invalid');
    bsNewDocModal.show();

    $newDocModal.one('shown.bs.modal', function() {
      $newDocInput.trigger('focus');
    });

    function tryCreate() {
      var name = $newDocInput.val().trim();
      if (!name) {
        $newDocInput.addClass('is-invalid').next('.invalid-feedback').text('Please enter a name.');
        $newDocInput.trigger('focus');
        return;
      }
      if (isNameTaken(name)) {
        $newDocInput.addClass('is-invalid').next('.invalid-feedback').text('A document with that name already exists.');
        $newDocInput.trigger('focus');
        return;
      }
      if (document.activeElement) document.activeElement.blur(); // move focus out before Bootstrap sets aria-hidden
      bsNewDocModal.hide();
      $newDocModal.off('hidden.bs.modal', onCancel);
      $newDocConfirm.off('click', tryCreate);
      $newDocInput.off('keydown', onEnter);
      callback(name);
    }

    function onCancel() {
      $newDocConfirm.off('click', tryCreate);
      $newDocInput.off('keydown', onEnter);
      callback(null);
    }

    function onEnter(e) {
      if (e.key === 'Enter') tryCreate();
    }

    $newDocConfirm.on('click', tryCreate);
    $newDocModal.one('hidden.bs.modal', onCancel);
    $newDocInput.on('keydown', onEnter);
    $newDocInput.on('input', function() { $newDocInput.removeClass('is-invalid'); });
  }

  // -------------------------------------------------------------------------

  function setActiveDocument(doc) {
    if (doc === 0) {
      promptNewDocument(function(name) {
        if (!name) return;
        var newIdx = docs.push({
          name: name,
          uid: +new Date(),
          state: EditorState.create({doc: demoCode, extensions: extensions()})
        }) - 1;
        activeDoc = newIdx;
        view.setState(docs[newIdx].state);
        lintErrors = [];
        applyDiagnostics();
        syncDocumentList();
        saveDocuments();
      });
      return; // async — callback handles the rest
    }

    activeDoc = doc;
    view.setState(docs[doc].state);
    view.dispatch({effects: keymapConfig.reconfigure(selectedKeymap())});
    view.scrollDOM.scrollTop = docs[doc].scrollTop || 0;
    view.scrollDOM.scrollLeft = docs[doc].scrollLeft || 0;
    lintErrors = docs[doc].errors || [];
    applyDiagnostics();
    syncDocumentList();
  }

  function syncDocumentList() {
    $documentList.empty();
    docs.forEach(function(doc, idx) {
      var $item = $('<a class="list-group-item" href="#"/>')
        .toggleClass('active', idx === activeDoc)
        .toggleClass('new-doc', idx === 0)
        .data('doc-idx', idx);
      $('<span class="doc-item-name"/>').text(doc.name).appendTo($item);
      if (idx !== 0) {
        var $delBtn = $('<span class="doc-delete-btn" role="button" tabindex="0" title="Delete document" aria-label="Delete document"/>')
          .html('<i class="bi bi-x"></i>')
          .data('doc-idx', idx)
          .appendTo($item);
        $item
          .on('mouseenter', function() { $delBtn.css({ opacity: '0.6', 'pointer-events': 'auto' }); })
          .on('mouseleave', function() { $delBtn.css({ opacity: '',    'pointer-events': ''     }); });
      }
      $documentList.append($item);
    });
  }

  function saveDocuments() {
    var plainDocs = [];
    docs.forEach(function(doc, idx) {
      if (idx === 0) return;
      plainDocs.push(serializeDocument(doc));
    });
    savedActive = docs[activeDoc].uid;
    saveRev = writeSavedDocuments(localStorage, plainDocs, savedActive);
  }

  function findActiveDoc() {
    if (savedActive) {
      var uid = +savedActive;
      for (var i = 0; i < docs.length; i++) {
        if (docs[i].uid === uid) return i;
      }
    }
    return null;
  }

  function loadDocuments() {
    // CM5 documents import their text and selections; CM6 restores full state.
    const saved = readSavedDocuments(localStorage);
    const plainDocs = saved.documents;
    savedActive = saved.active;
    saveRev = +localStorage[storageKeys.revision] || 0;
    docs = [{name: 'New document'}];
    plainDocs.forEach(savedDoc => {
      docs.push({
        name: savedDoc.name, uid: savedDoc.uid, errors: savedDoc.errors || [],
        state: restoreEditorState(savedDoc, extensions()),
        scrollTop: savedDoc.scrollTop || 0, scrollLeft: savedDoc.scrollLeft || 0
      });
    });
    if (docs.length === 1) {
      docs.push({name: 'demo', uid: Date.now(), state: EditorState.create({doc: demoCode, extensions: extensions()})});
    }
  }

  function deleteDocument(doc) {
    docs.splice(doc, 1);
    if (docs.length === 1) {
      docs.push({name: 'demo', uid: Date.now(), state: EditorState.create({doc: demoCode, extensions: extensions()})});
    }
    if (activeDoc >= docs.length) {
      activeDoc = docs.length - 1;
    } else if (activeDoc >= doc) {
      activeDoc = Math.max(1, activeDoc - 1);
    }
    setActiveDocument(activeDoc);
    saveDocuments();
  }

  // Bootstrap 5 uses .dropdown-item, still selectable the same way
  $(document).on('click', '.select-keymap .dropdown-item', function(e) {
    keyMap = $(this).data('keymap');
    view.dispatch({effects: keymapConfig.reconfigure(selectedKeymap())});
    localStorage.keyMap = keyMap;
    $('.keymap-current').text(keyMap);
    // Mark active
    $('.select-keymap .dropdown-item').removeClass('active');
    $(this).addClass('active');
    e.preventDefault();
  });

  $documentList.on('click', '.doc-delete-btn', function(e) {
    e.preventDefault();
    e.stopPropagation();
    promptDeleteDocument($(this).data('doc-idx'));
  });

  $documentList.on('keydown', '.doc-delete-btn', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      promptDeleteDocument($(this).data('doc-idx'));
    }
  });

  $documentList.on('contextmenu', 'a', function(e) {
    e.preventDefault();
    var docIdx = $(this).data('doc-idx');
    if (docIdx !== 0) promptDeleteDocument(docIdx);
    return false;
  });

  $documentList.on('click', 'a', function(e) {
    e.preventDefault();
    setActiveDocument($(this).data('doc-idx'));
    saveDocuments();
    view.focus();
    return false;
  });

  // ---- Public API ----------------------------------------------------------

  self.setEditorFocus = function() { view.focus(); };
  self.updateEditorSize = function() { view.requestMeasure(); };
  self.getCurrentCode = function() { return view.state.doc.toString(); };
  self.setCurrentCode = function(code) {
    view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: code}});
  };
  self.highlightCode = highlightCode;

  $(window).on({
    resize: function() { self.updateEditorSize(); },
    pagehide: function() { saveDocuments(); }
  });
  view.focus();

  return self;
}(window.PPG || {}));
