'use strict';

window.PPG = (function (self) {
  var $body = $('body');
  var $app = $('.app');
  var $editor = $app.find('.main > .editor');
  var $output = $app.find('.main > .output');
  var $outputSeparator = $output.find('.separator');

  var MIN_OUTPUT_HEIGHT = 80;
  var MIN_EDITOR_HEIGHT = 100;

  if (!localStorage.outputHeight) {
    localStorage.outputHeight = Math.round(window.innerHeight * 0.24);
  }
  setOutputHeight(+localStorage.outputHeight);

  // Keep output line numbers in sync with the visible result panel.
  var outputScroller = $output.find('.scroller')[0];
  var outputGutter = $output.find('.output-gutter')[0];
  function updateOutputGutter() {
    var panel = Array.prototype.find.call(outputScroller.querySelectorAll('pre'), function (pre) {
      return pre.style.display !== 'none';
    });
    var count = panel ? panel.textContent.replace(/\n$/, '').split('\n').length : 1;
    var numbers = [];
    for (var line = 1; line <= count; line++) numbers.push(line);
    var text = numbers.join('\n');
    if (outputGutter.textContent !== text) outputGutter.textContent = text;
  }
  new MutationObserver(updateOutputGutter).observe(outputScroller, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style']
  });

  /* ---- Sidebar toggle (mobile) ----------------------------------------- */

  var $sidebarToggle = $('#sidebar-toggle');
  var $sidebarOverlay = $('#sidebar-overlay');

  function openSidebar() { $app.addClass('sidebar-open'); }
  function closeSidebar() { $app.removeClass('sidebar-open'); }
  function toggleSidebar() { $app.toggleClass('sidebar-open'); }

  $sidebarToggle.on('click', function (e) { e.stopPropagation(); toggleSidebar(); });
  $sidebarOverlay.on('click', closeSidebar);

  /* Close sidebar when a document link is clicked on mobile. */
  $app.find('.document-list').on('click', 'a, .list-group-item', function () {
    if ($(window).width() <= 767) closeSidebar();
  });

  /* Close sidebar on resize back to desktop. */
  $(window).on('resize', function () {
    if ($(window).width() > 767) closeSidebar();
  });

  /* ---- Output resize (drag separator) ----------------------------------- */

  var separatorDrag = null;

  $(window).on({
    load: function () {
      requestAnimationFrame(function () {
        $body.addClass('visible');
        self.updateEditorSize();
      });
    },
    mousemove: function (e) {
      if (separatorDrag === null) return;
      var windowHeight = $(window).height();
      var rawHeight = windowHeight - e.clientY + separatorDrag;
      var height = Math.max(MIN_OUTPUT_HEIGHT, Math.min(rawHeight, windowHeight - MIN_EDITOR_HEIGHT));
      setOutputHeight(height);
      localStorage.outputHeight = height;
      self.updateEditorSize();
    },
    mouseup: function () {
      if (separatorDrag !== null) {
        separatorDrag = null;
        $outputSeparator.removeClass('dragging');
      }
    }
  });

  $outputSeparator.on('mousedown', function (e) {
    // offsetY: distance from top of separator bar to where user clicked
    separatorDrag = $(this).height() - e.offsetY;
    $outputSeparator.addClass('dragging');
    e.preventDefault();
  });

  // Touch drag support for the separator (mobile / tablet).
  $outputSeparator.on('touchstart', function (e) {
    var touch = e.originalEvent.touches[0];
    separatorDrag = $(this).height() - (touch.clientY - $(this).offset().top);
    $outputSeparator.addClass('dragging');
    e.preventDefault();
  });
  $(window).on('touchmove', function (e) {
    if (separatorDrag === null) return;
    var touch = e.originalEvent.touches[0];
    var windowHeight = $(window).height();
    var rawHeight = windowHeight - touch.clientY + separatorDrag;
    var height = Math.max(MIN_OUTPUT_HEIGHT, Math.min(rawHeight, windowHeight - MIN_EDITOR_HEIGHT));
    setOutputHeight(height);
    localStorage.outputHeight = height;
    self.updateEditorSize();
    e.preventDefault();
  });
  $(window).on('touchend touchcancel', function () {
    if (separatorDrag !== null) {
      separatorDrag = null;
      $outputSeparator.removeClass('dragging');
    }
  });

  function setOutputHeight(h) {
    $output.css('height', h + 'px');
  }

  return self;
}(window.PPG || {}));