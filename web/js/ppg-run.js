'use strict';

window.PPG = (function (self) {
  // ---- WASM compile -------------------------------------------------------

  var wasmJobId = 0;
  var runId = 0;
  var $app = $('.app');
  var $output = $app.find('.output');
  var $outputScroller = $output.find('.scroller');
  var $compilerOutput = $output.find('.compiler-output');
  var $compilerOutputLst = $output.find('.compiler-output-lst');
  var $compilerOutputAsm = $output.find('.compiler-output-asm');
  var $programOutput = $output.find('.program-output');
  var $runButtons = $('#run,#compile,#compile-lst,#compile-asm,#compile-macros');
  var $outputFields = $output.find('.compiler-output,.compiler-output-lst,.compiler-output-asm,.program-output');
  var $status = $('#compile-status');
  var $buildBadge = $('#build-tab-badge');
  var activeMode = null;
  var lastInput = null;
  var macroStep, numMacroSteps;

  function setBuildBadge(hardErrors, warnings) {
    if (hardErrors > 0) {
      $buildBadge.text(hardErrors).removeClass('tab-badge-warn').addClass('visible');
    } else if (warnings > 0) {
      $buildBadge.text(warnings).addClass('tab-badge-warn').addClass('visible');
    } else {
      $buildBadge.removeClass('visible tab-badge-warn');
    }
  }

  $runButtons.removeAttr('disabled');
  $status.text('ready').removeClass('err warn').addClass('ok');

  // ---- Output tabs --------------------------------------------------------

  function activateTab(name) {
    $output.find('.output-tab').each(function() {
      $(this).toggleClass('active', $(this).data('tab') === name);
    });
    var panelName = (name === 'macros') ? 'lst' : name;
    $outputFields.each(function() {
      var panel = $(this).data('panel');
      if (panel) {
        $(this).toggle(panel === panelName);
      }
    });
  }

  $output.find('.output-tab').on('click', function() {
    activateTab($(this).data('tab'));
  });

  // ---- Persistent WASM workers -------------------------------------------
  //
  // Workers are created once and reused across compiles/runs.  This avoids
  // re-initialising the WASM module (loading pawncc.js + unpacking ~854 KB of
  // include files into MEMFS) on every button press.
  //
  // On timeout the worker is terminated so a stuck AMX loop cannot block the
  // next run.  The worker is recreated transparently on the next request.

  var _compilerWorker = null;
  var _compilerPending = {};  // id → { resolve, timer }

  function getCompilerWorker() {
    if (_compilerWorker) return _compilerWorker;
    _compilerWorker = new Worker('/js/pawn-compiler-worker.js');
    _compilerWorker.onmessage = function(e) {
      var p = _compilerPending[e.data.id];
      if (!p) return;  // already timed out — ignore stale result
      clearTimeout(p.timer);
      delete _compilerPending[e.data.id];
      p.resolve(e.data);
    };
    _compilerWorker.onerror = function(err) {
      // Worker crashed unexpectedly — reject all pending and allow restart.
      var pending = _compilerPending;
      _compilerPending = {};
      _compilerWorker = null;
      for (var id in pending) {
        clearTimeout(pending[id].timer);
        pending[id].resolve({ id: +id, exitCode: 1, stdout: '', stderr: String(err), lst: '', asm: '', amxBytes: null });
      }
    };
    return _compilerWorker;
  }

  var _runnerWorker = null;
  var _runnerPending = {};  // id → { resolve, timer }

  function getRunnerWorker() {
    if (_runnerWorker) return _runnerWorker;
    _runnerWorker = new Worker('/js/pawn-runner-worker.js');
    _runnerWorker.onmessage = function(e) {
      var p = _runnerPending[e.data.id];
      if (!p) return;
      clearTimeout(p.timer);
      delete _runnerPending[e.data.id];
      p.resolve(e.data);
    };
    _runnerWorker.onerror = function(err) {
      var pending = _runnerPending;
      _runnerPending = {};
      _runnerWorker = null;
      for (var id in pending) {
        clearTimeout(pending[id].timer);
        pending[id].resolve({ id: +id, exitCode: 1, stdout: '', stderr: String(err) });
      }
    };
    return _runnerWorker;
  }

  // Returns a Promise resolving with { exitCode, stdout, stderr, lst, asm, amxBytes }.
  function wasmCompile(source, mode) {
    return new Promise(function(resolve) {
      var id = ++wasmJobId;
      var timer = setTimeout(function() {
        delete _compilerPending[id];
        // Terminate so a stuck compiler cannot block the next compile.
        if (_compilerWorker) { _compilerWorker.terminate(); _compilerWorker = null; }
        resolve({ id: id, exitCode: 1, stdout: '', stderr: 'Compile timeout.', lst: '', asm: '', amxBytes: null });
      }, 15000);
      _compilerPending[id] = { resolve: resolve, timer: timer };
      getCompilerWorker().postMessage({ id: id, source: source, mode: mode || 0 });
    });
  }

  // Returns a Promise resolving with { exitCode, stdout, stderr }.
  function wasmRun(amxBytes) {
    return new Promise(function(resolve) {
      var id = ++wasmJobId;
      var timer = setTimeout(function() {
        delete _runnerPending[id];
        // Terminate so an infinite loop in user code cannot block the next run.
        if (_runnerWorker) { _runnerWorker.terminate(); _runnerWorker = null; }
        resolve({ id: id, exitCode: 1, stdout: '', stderr: 'Execution timeout.' });
      }, 10000);
      _runnerPending[id] = { resolve: resolve, timer: timer };
      getRunnerWorker().postMessage({ id: id, amxBytes: amxBytes }, [amxBytes.buffer]);
    });
  }

  function handleEvent(event, output) {
    switch (event) {
      case 'compiler-output':   onCompilerOutput(output); break;
      case 'compiler-errors':   onCompilerErrors(output); break;
      case 'compiler-lst':      onCompilerLST(output); break;
      case 'compiler-asm':      onCompilerASM(output); break;
      case 'program-output':    onProgramOutput(output); break;
    }
  }

  function clearOutput() {
    $outputFields.hide().empty();
    $output.find('.macro-stepper').hide();
    setBuildBadge(0, 0);
  }

  // ---- Compile dispatch ---------------------------------------------------

  function dispatchCompile(mode, compileEvent) {
    var code = self.getCurrentCode();
    $runButtons.attr('disabled', true);
    clearOutput();

    var modeInt = (mode === 'asm')    ? 2
                : (mode === 'macros') ? 3
                : (mode === 'lst')    ? 1
                : 0;  /* 'run' and 'compile' both need mode 0 (full compile → AMX) */
    activeMode = mode;
    lastInput = code;
    $runButtons.addClass('compiling');
    $status.text('Compiling\u2026').removeClass('ok err warn');

    wasmCompile(code, modeInt).then(function(result) {
      var thisRunId = ++runId;
      $runButtons.removeAttr('disabled').removeClass('compiling');

      var errors = parseCompilerErrors(result.stderr);
      var warnings = errors.filter(function(e) { return e.type === 'warning'; });
      var hardErrors = errors.filter(function(e) { return e.type !== 'warning'; });
      if (result.exitCode === 0) {
        $status.text(warnings.length ? warnings.length + ' warning(s)' : 'OK')
               .removeClass('err').addClass(warnings.length ? 'warn' : 'ok');
      } else {
        $status.text(hardErrors.length + ' error(s)').removeClass('ok warn').addClass('err');
      }
      setBuildBadge(hardErrors.length, warnings.length);

      if (mode === 'run') {
        // Always show build output first, switch to program output after execution.
        handleEvent('compiler-output', { runId: thisRunId, data: result.stderr + result.stdout });
        if (errors.length) {
          handleEvent('compiler-errors', { runId: thisRunId, data: errors });
        }
        if (result.exitCode === 0 && result.amxBytes && result.amxBytes.byteLength) {
          activateTab('output');
          $status.text('Running\u2026').removeClass('ok err warn');
          wasmRun(result.amxBytes).then(function(runResult) {
            handleEvent('program-output', { runId: thisRunId, data: runResult.stdout, stderr: runResult.stderr, exitCode: runResult.exitCode });
          });
        } else {
          // Compile failed — show build tab.
          activateTab('build');
        }
      } else if (mode === 'compile') {
        handleEvent('compiler-output', { runId: thisRunId, data: result.stderr + result.stdout });
        if (errors.length) {
          handleEvent('compiler-errors', { runId: thisRunId, data: errors });
        }
        activateTab('build');
      } else if (compileEvent === 'compile-asm') {
        handleEvent('compiler-output', { runId: thisRunId, data: result.stderr });
        handleEvent('compiler-asm', { runId: thisRunId, data: result.asm });
        activateTab('asm');
      } else {
        // LST / Macros
        var macroReplacements = [];
        if (compileEvent === 'compile-macros') {
          var substRe = /^SUBST\(([^)]+)\):\s*(\d+)\.(\d+)-(\d+)\s*=\s*\((\d+)\)\s*(.*)$/gm;
          var m;
          while ((m = substRe.exec(result.stdout)) !== null) {
            /* Only process substitutions in the user's input file, not includes. */
            if (m[1] !== '/input.p' && m[1] !== 'input.p') continue;
            macroReplacements.push({
              line:        parseInt(m[2], 10),
              col:         parseInt(m[3], 10) - 1,
              end:         parseInt(m[4], 10),
              start_len:   parseInt(m[5], 10),
              replacement: m[6]
            });
          }
        }
        // Only put content in the build panel if there are actual errors/warnings.
        if (errors.length) {
          handleEvent('compiler-output', { runId: thisRunId, data: result.stderr });
          handleEvent('compiler-errors', { runId: thisRunId, data: errors });
        }
        handleEvent('compiler-lst', {
          runId: thisRunId,
          data: result.lst,
          macroReplacements: macroReplacements
        });
        activateTab(compileEvent === 'compile-macros' ? 'macros' : 'lst');
      }
    });
  }

  function parseCompilerErrors(text) {
    var errors = [];
    var re = /^[^(]+\((\d+)\)\s*:\s*(error|warning|fatal error)\s+\d+:\s*(.+)$/gm;
    var m;
    while ((m = re.exec(text)) !== null) {
      errors.push({ line: parseInt(m[1], 10), type: m[2], message: m[3] });
    }
    return errors;
  }

  $('#run').on('click', function() {
    dispatchCompile('run', 'compile-lst');
  });

  $('#compile').on('click', function() {
    dispatchCompile('compile', 'compile-lst');
  });

  $('#compile-lst').on('click', function() {
    dispatchCompile('lst', 'compile-lst');
  });

  $('#compile-asm').on('click', function() {
    dispatchCompile('asm', 'compile-asm');
  });

  $('#compile-macros').on('click', function() {
    dispatchCompile('macros', 'compile-macros');
  });

  // ---- Macro stepper -------------------------------------------------------

  function setMacroStep(idx) {
    var dir = macroStep - idx;
    macroStep = Math.max(1, Math.min(idx, numMacroSteps));
    $('.macro-stepper .current-step').text(macroStep + ' / ' + numMacroSteps);

    $('.compiler-output-lst .repl-line').each(function() {
      var $this = $(this);
      var step = +$this.data('step');
      $this
        .toggleClass('behind', step < macroStep)
        .toggleClass('active', step === macroStep)
        .toggleClass('ahead', step > macroStep)
        .toggleClass('dir-left', step === macroStep && dir < 0)
        .toggleClass('dir-right', step === macroStep && dir > 0);
    });

    if (macroStep !== 1 && macroStep !== numMacroSteps) {
      var scrollerTop = $outputScroller.scrollTop();
      var scrollerHeight = $outputScroller.height();
      var $active = $output.find('.repl-line.active');
      if ($active.length) {
        var activeTop = $active.position().top + scrollerTop;
        if (activeTop < scrollerTop + 60) {
          $outputScroller.scrollTop(activeTop - 60);
        } else if (activeTop > scrollerTop + scrollerHeight - 40) {
          $outputScroller.scrollTop(activeTop - scrollerHeight + 40);
        }
      }
    }
  }

  $('.macro-stepper .forward').on('click', function() { setMacroStep(macroStep + 1); });
  $('.macro-stepper .backward').on('click', function() { setMacroStep(macroStep - 1); });

  // ---- Output renderers ----------------------------------------------------

  function escape(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function onCompilerOutput(output) {
    if (output.runId !== runId) return;
    // Strip SUBST(...) lines — macro substitution output belongs in the Macros tab only.
    var data = (output.data || '').replace(/^SUBST\([^)]*\):.*$\n?/mg, '');
    if (data.trim()) {
      $compilerOutput.append($('<span/>').text(data));
      $outputScroller.scrollTop($outputScroller[0].scrollHeight - $outputScroller.height());
    }
  }

  function onCompilerErrors(output) {
    if (output.runId !== runId) return;
    if (output.data) {
      self.setEditorErrors(output.data.map(function(e) {
        return {
          startLine: e.line,
          endLine: e.line,
          message: e.message,
          type: e.type
        };
      }));
    }
  }

  function onCompilerLST(output) {
    if (output.runId !== runId) return;

    $runButtons.removeAttr('disabled');

    if (activeMode === 'macros' && output.macroReplacements && output.macroReplacements.length > 0) {
      renderMacros(output);
    } else {
      var value = output.data || '';
      value = value.replace(/(^#line \d+$\n\s*)+(#line \d+)/mg, '$2').trimLeft();
      CodeMirror.runMode(value, 'text/x-pawn', $compilerOutputLst.get(0));
    }
  }

  function renderMacros(output) {
    var outputNode = $compilerOutputLst.get(0);
    var rawLines = lastInput.split('\n').map(function(l) { return l || ' '; });
    var lines = rawLines.map(function() { return []; });

    var step = 1;
    var lastIdx = output.macroReplacements.length - 1;

    output.macroReplacements.forEach(function(repl, i) {
      var l = repl.line - 1;
      var line = rawLines[l];

      rawLines[l] = line.substr(0, repl.col) + repl.replacement + line.substr(repl.col + repl.start_len);

      var renderedLine =
        escape(line.substr(0, repl.col)) +
        '<span class="repl">' +
          '<span class="old">' + escape(line.substr(repl.col, repl.start_len)) + '</span>' +
          '<span class="new">' + escape(repl.replacement) + '</span>' +
        '</span>' +
        escape(line.substr(repl.col + repl.start_len));

      var classes = ['repl-line', 'ahead'];
      if (!lines[l].length) classes.push('first');
      if (i === lastIdx || output.macroReplacements[i + 1].line !== repl.line) classes.push('last');

      lines[l].push('<span class="' + classes.join(' ') + '" data-step="' + (++step) + '">' + renderedLine + '</span>');
    });

    numMacroSteps = ++step === 2 ? 1 : step;
    macroStep = 1;

    lines.forEach(function(line, l) {
      lines[l] = line.length === 0
        ? '<span class="line">' + escape(rawLines[l]) + '</span>'
        : line.join('');
    });

    outputNode.innerHTML = lines.join('');

    $output.find('.macro-stepper').show();
    setMacroStep(1);
  }

  function onCompilerASM(output) {
    if (output.runId !== runId) return;

    $runButtons.removeAttr('disabled');

    var data = (output.data || '').replace(/; line ([0-9a-f]+)/gi, function(match, lineNum) {
      return '; line ' + parseInt(lineNum, 16);
    });

    CodeMirror.runMode(data, 'text/x-pawn-asm', $compilerOutputAsm.get(0));
  }

  function onProgramOutput(output) {
    if (output.runId !== runId) return;

    var exitCode = output.exitCode || 0;
    var text = output.data || '';

    if (exitCode !== 0) {
      $status.text('Runtime error ' + exitCode).removeClass('ok warn').addClass('err');
      if (output.stderr && output.stderr.trim()) {
        text += (text ? '\n' : '') + output.stderr;
      }
    } else {
      $status.text('Done').removeClass('err warn').addClass('ok');
    }

    $programOutput.empty();
    if (text.trim()) {
      $programOutput.append($('<span/>').text(text));
    } else {
      $programOutput.append($('<span class="program-output-empty"/>').text('(no output)'));
    }
    $outputScroller.scrollTop(0);
  }

  // Pre-warm the WASM compiler worker immediately so pawncc.wasm is loaded
  // and include files are unpacked into MEMFS before the user's first compile.
  // Without this, the first click has a multi-second cold-start delay.
  // Deferred 800 ms so it doesn't compete with the initial page render.
  setTimeout(function() { getCompilerWorker(); }, 800);

  return self;
}(window.PPG || {}));
