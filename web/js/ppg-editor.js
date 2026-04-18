'use strict';

window.PPG = (function (self) {
  var $body = $('body');
  var $app = $('.app');
  var $editor = $app.find('.main > .editor');
  var $documentList = $app.find('.document-list');

  var lintErrors = [];
  var keyMap = localStorage.keyMap || 'default';
  $('.keymap-current').text(keyMap);

  var cm = CodeMirror($editor.get(0), {
    autoCloseBrackets: true,
    autofocus: true,
    dragDrop: true,
    foldGutter: true,
    gutters: [
      'CodeMirror-linenumbers',
      'CodeMirror-lint-markers',
      'CodeMirror-foldgutter'
    ],
    highlightSelectionMatches: true,
    indentUnit: 4,
    indentWithTabs: true,
    lineNumbers: true,
    lineWrapping: false,
    matchBrackets: true,
    showCursorWhenSelecting: true,
    smartIndent: true,
    tabSize: 4,
    keyMap: keyMap,
    theme: 'dracula pawn',
    extraKeys: {
      // Ctrl+Shift+Letter combinations are all claimed by browser chrome
      // (add-ons, devtools, responsive design, etc.) and fire before JS can
      // intercept them.  Alt+Shift+Letter is not reserved by any major browser.
      // Ctrl+Enter is the universal "run" convention for code playgrounds.
      'Ctrl-Enter':   function() { $('#run').trigger('click'); },
      'Alt-Shift-C':  function() { $('#compile').trigger('click'); },
      'Alt-Shift-L':  function() { $('#compile-lst').trigger('click'); },
      'Alt-Shift-A':  function() { $('#compile-asm').trigger('click'); },
      'Alt-Shift-M':  function() { $('#compile-macros').trigger('click'); }
    },
    lint: {
      getAnnotations: function() {
        return lintErrors.map(function(err) {
          return {
            from: CodeMirror.Pos(err.startLine - 1, 0),
            to: CodeMirror.Pos(err.endLine - 1, 0),
            message: err.message,
            severity: err.type
          };
        });
      }
    }
  });

  var saveTimeout = null;

  function setSaveTimeout() {
    if (saveTimeout !== null) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(function() {
      saveTimeout = null;
      saveDocuments();
    }, 250);
  }

  cm.on('change', setSaveTimeout);
  // Note: cursorActivity is intentionally NOT a save trigger — cursor movement
  // alone fires hundreds of times per second and does not alter document content.

  var demoDoc = new CodeMirror.Doc(
    [
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
    ].join('\n'),
    'text/x-pawn'
  );

  var activeDoc = 0;
  var docs;

  loadDocuments();
  setActiveDocument(findActiveDoc() || 1);

  // Multi-tab cross-window sync via the 'storage' event — zero CPU cost when
  // the user is idle, fires immediately when another tab writes ppgSaveRevision.
  var saveRev = +localStorage.ppgSaveRevision || 0;

  $(window).on('storage', function(e) {
    if (e.originalEvent.key !== 'ppgSaveRevision') return;
    if (+localStorage.ppgSaveRevision === saveRev) return;
    saveRev = +localStorage.ppgSaveRevision;
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
    CodeMirror.startLinting(cm);
  };

  self.setEditorErrors = function(errors) {
    lintErrors = errors;
    if (docs[activeDoc]) docs[activeDoc].errors = errors;
    CodeMirror.startLinting(cm);
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
          cmDoc: demoDoc.copy()
        }) - 1;
        activeDoc = newIdx;
        cm.swapDoc(docs[newIdx].cmDoc);
        lintErrors = [];
        CodeMirror.startLinting(cm);
        syncDocumentList();
        saveDocuments();
      });
      return; // async — callback handles the rest
    }

    activeDoc = doc;
    cm.swapDoc(docs[doc].cmDoc);
    lintErrors = docs[doc].errors || [];
    CodeMirror.startLinting(cm);
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
      plainDocs.push({
        name: doc.name,
        errors: doc.errors || [],
        uid: doc.uid,
        value: doc.cmDoc.getValue(),
        cursor: doc.cmDoc.getCursor(),
        selection: doc.cmDoc.sel,
        scrollLeft: doc.cmDoc.scrollLeft,
        scrollTop: doc.cmDoc.scrollTop,
        history: doc.cmDoc.getHistory()
      });
    });
    saveRev = (+localStorage.ppgSaveRevision || 0) + 1;
    localStorage.ppgSaveRevision = saveRev;
    localStorage.ppgDocuments = JSON.stringify(plainDocs);
    localStorage.ppgActiveDoc = docs[activeDoc].uid;
  }

  function findActiveDoc() {
    if (localStorage.ppgActiveDoc) {
      var uid = +localStorage.ppgActiveDoc;
      for (var i = 0; i < docs.length; i++) {
        if (docs[i].uid === uid) return i;
      }
    }
    return null;
  }

  function loadDocuments() {
    var plainDocs = JSON.parse(localStorage.ppgDocuments || '[]');
    saveRev = +localStorage.ppgSaveRevision || 0;

    docs = [{ name: 'New document' }];

    plainDocs.forEach(function(doc) {
      var cmDoc = new CodeMirror.Doc(doc.value, 'text/x-pawn');
      cmDoc.setHistory(doc.history);
      cmDoc.setCursor(doc.cursor);
      cmDoc.setSelections(doc.selection.ranges, doc.selection.primIndex);
      cmDoc.scrollLeft = doc.scrollLeft;
      cmDoc.scrollTop = doc.scrollTop;
      docs.push({
        name: doc.name,
        errors: doc.errors,
        uid: doc.uid,
        cmDoc: cmDoc
      });
    });

    if (docs.length === 1) {
      docs.push({ name: 'demo', uid: +new Date(), cmDoc: demoDoc.copy() });
    }
  }

  function deleteDocument(doc) {
    docs.splice(doc, 1);
    if (docs.length === 1) {
      docs.push({ name: 'demo', uid: +new Date(), cmDoc: demoDoc.copy() });
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
    cm.setOption('keyMap', keyMap);
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
    cm.focus();
    return false;
  });

  // ---- Public API ----------------------------------------------------------

  self.setEditorFocus = function() { cm.focus(); };
  self.updateEditorSize = function() { cm.setSize('100%', '100%'); };
  self.getCurrentCode = function() { return cm.getValue(); };
  self.setCurrentCode = function(code) { cm.setValue(code); };

  $(window).on({
    load: function() {
      cm.on('change', function() {
        if (lintErrors.length) {
          self.clearEditorErrors();
          if (docs[activeDoc]) docs[activeDoc].errors = [];
        }
      });
    },
    resize: function() { self.updateEditorSize(); },
    unload: function() { saveDocuments(); }
  });

  return self;
}(window.PPG || {}));
