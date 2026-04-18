// CodeMirror 5 — VS Code-compatible keymap
// Mirrors the most common VS Code editor keybindings.
// Inherits unspecified bindings from the "default" keymap.
(function (mod) {
  if (typeof exports === 'object' && typeof module === 'object') {
    mod(require('../../lib/codemirror')); // CommonJS
  } else if (typeof define === 'function' && define.amd) {
    define(['../../lib/codemirror'], mod); // AMD
  } else {
    mod(CodeMirror);
  }
}(function (CodeMirror) {
  'use strict';

  CodeMirror.defineOption('keyMap', 'default');

  CodeMirror.keyMap.vscode = {
    // ---- Navigation -------------------------------------------------------
    'Home':            'goLineStartSmart',       // smart Home (first non-WS)
    'Ctrl-Home':       'goDocStart',
    'Ctrl-End':        'goDocEnd',
    'Ctrl-G':          'jumpToLine',

    // ---- Selection --------------------------------------------------------
    'Shift-Alt-Right': 'selectNextOccurrence',   // Ctrl-D equivalent (expand selection)
    'Ctrl-D':          'selectNextOccurrence',

    // ---- Editing ----------------------------------------------------------
    'Ctrl-Shift-K':    'deleteLine',
    'Ctrl-Enter':      'newlineAndIndent',        // insert line below
    'Shift-Ctrl-Enter':'insertLineAbove',

    // ---- Move / copy lines ------------------------------------------------
    // These use the extra-commands extension bundled with CodeMirror addon
    'Alt-Up':          'moveLinesUp',
    'Alt-Down':        'moveLinesDown',
    'Shift-Alt-Up':    'copyLinesUp',
    'Shift-Alt-Down':  'copyLinesDown',

    // ---- Comments ---------------------------------------------------------
    'Ctrl-/':          'toggleComment',

    // ---- Indent -----------------------------------------------------------
    'Tab':             'indentMore',
    'Shift-Tab':       'indentLess',
    'Ctrl-]':          'indentMore',
    'Ctrl-[':          'indentLess',

    // ---- Fold -------------------------------------------------------------
    'Ctrl-Shift-[':    'fold',
    'Ctrl-Shift-]':    'unfold',

    // ---- Find & Replace ---------------------------------------------------
    'Ctrl-F':          'find',
    'Ctrl-H':          'replace',
    'F3':              'findNext',
    'Shift-F3':        'findPrev',

    // ---- Undo / Redo ------------------------------------------------------
    'Ctrl-Z':          'undo',
    'Ctrl-Y':          'redo',
    'Shift-Ctrl-Z':    'redo',

    // ---- Clipboard --------------------------------------------------------
    'Ctrl-X':          'cutToClipboard',
    'Ctrl-C':          'copyToClipboard',
    'Ctrl-V':          'paste',

    // ---- Cursor extras ----------------------------------------------------
    'Ctrl-Alt-Up':     'addCursorToPrevLine',
    'Ctrl-Alt-Down':   'addCursorToNextLine',

    fallthrough: 'default'
  };
}));
