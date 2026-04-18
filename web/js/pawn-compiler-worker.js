/**
 * pawn-compiler-worker.js
 *
 * Web Worker that wraps the Emscripten-compiled pawncc WebAssembly module.
 * The main thread posts { id, source, mode } messages and receives back
 * { id, stdout, stderr, lst, asm, exitCode } messages.
 *
 * mode:
 *   0 — LST (default)
 *   1 — LST only
 *   2 — ASM
 *   3 — Macros (LST + -m substitution output)
 *
 * stdout/stderr are captured by intercepting Emscripten's print/printErr.
 */
'use strict';

var _stdout = '';
var _stderr = '';

importScripts('/wasm/pawncc.js');

var _compilerReady = PawnCompiler({
  // Override path resolution: pawncc.js is loaded via importScripts so
  // self.location points to this worker file (/js/…), not to pawncc.js.
  // Without this, Emscripten would look for pawncc.wasm in /js/ → 404.
  locateFile: function(path) { return '/wasm/' + path; },
  print: function(line) { _stdout += line + '\n'; },
  printErr: function(line) { _stderr += line + '\n'; }
});

self.onmessage = function(e) {
  var msg = e.data;          // { id, source, mode }

  _compilerReady.then(function(Module) {
    _stdout = '';
    _stderr = '';

    /* Clear stale output files that may linger in MEMFS. */
    try { Module.FS.unlink('/output.lst'); } catch(_) {}
    try { Module.FS.unlink('/output.asm'); } catch(_) {}
    try { Module.FS.unlink('/output.amx'); } catch(_) {}

    /* Call the exported entry point.
     * Pass Module.lengthBytesUTF8 for the byte count so non-ASCII chars
     * (e.g. em-dash in comments) are counted correctly.  The C side now uses
     * strlen() too, so this is belt-and-suspenders. */
    var exitCode = Module.ccall(
      'wasm_compile',
      'number',
      ['string', 'number', 'number'],
      [msg.source, Module.lengthBytesUTF8(msg.source), msg.mode || 0]
    );

    var lst = '', asm = '';
    var amxBytes = null;
    try { lst = Module.FS.readFile('/output.lst', { encoding: 'utf8' }); } catch(_) {}
    try { asm = Module.FS.readFile('/output.asm', { encoding: 'utf8' }); } catch(_) {}
    /* Read AMX binary (Uint8Array) — only present when compile succeeded. */
    try { amxBytes = Module.FS.readFile('/output.amx'); } catch(_) {}

    self.postMessage({
      id:       msg.id,
      exitCode: exitCode,
      stdout:   _stdout,
      stderr:   _stderr,
      lst:      lst,
      asm:      asm,
      amxBytes: amxBytes   /* Uint8Array or null */
    });
  }).catch(function(err) {
    self.postMessage({
      id:       msg.id,
      exitCode: 1,
      stdout:   '',
      stderr:   'WASM initialisation failed: ' + err,
      lst:      '',
      asm:      '',
      amxBytes: null
    });
  });
};
