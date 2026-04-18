/**
 * pawn-runner-worker.js
 *
 * Web Worker that wraps the Emscripten-compiled pawnrun WebAssembly module.
 * The main thread posts { id, amxBytes } and receives back
 * { id, exitCode, stdout, stderr } messages.
 *
 * stdout/stderr are captured by intercepting Emscripten's print/printErr.
 */
'use strict';

var _stdout = '';
var _stderr = '';

importScripts('/wasm/pawnrun.js');

var _runnerReady = PawnRunner({
  locateFile: function(path) { return '/wasm/' + path; },
  print:    function(line) { _stdout += line + '\n'; },
  printErr: function(line) { _stderr += line + '\n'; }
});

self.onmessage = function(e) {
  var msg = e.data;   /* { id, amxBytes: Uint8Array } */

  if (!msg.amxBytes || !msg.amxBytes.byteLength) {
    self.postMessage({
      id:       msg.id,
      exitCode: 1,
      stdout:   '',
      stderr:   'No AMX bytecode to execute.\n'
    });
    return;
  }

  _runnerReady.then(function(Module) {
    _stdout = '';
    _stderr = '';

    var amxBytes = msg.amxBytes;
    var len = amxBytes.byteLength;

    /* Allocate WASM heap space and copy the AMX bytes in. */
    var ptr = Module._malloc(len);
    if (!ptr) {
      self.postMessage({
        id:       msg.id,
        exitCode: 1,
        stdout:   '',
        stderr:   'wasm_execute: malloc failed\n'
      });
      return;
    }
    Module.HEAPU8.set(amxBytes, ptr);

    var exitCode = Module.ccall(
      'wasm_execute',
      'number',
      ['number', 'number'],
      [ptr, len]
    );

    Module._free(ptr);

    self.postMessage({
      id:       msg.id,
      exitCode: exitCode,
      stdout:   _stdout,
      stderr:   _stderr
    });
  }).catch(function(err) {
    self.postMessage({
      id:       msg.id,
      exitCode: 1,
      stdout:   '',
      stderr:   'WASM initialisation failed: ' + err
    });
  });
};
