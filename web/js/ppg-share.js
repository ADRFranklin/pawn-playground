'use strict';

(function () {
  // ---- Load shared snippet on /s/{id} URLs --------------------------------

  var pathMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  if (pathMatch) {
    var snippetId = pathMatch[1];
    fetch('/api/share/' + snippetId)
      .then(function (res) {
        if (!res.ok) throw new Error('Snippet not found');
        return res.json();
      })
      .then(function (data) {
        if (data.code && window.PPG && PPG.setCurrentCode) {
          PPG.setCurrentCode(data.code);
        }
      })
      .catch(function (err) {
        showToast(!navigator.onLine || err instanceof TypeError ? 'Shared links need an internet connection.' : 'Could not load this shared link.', true);
      });
  }

  // ---- Share button --------------------------------------------------------

  var $shareBtn = $('#share-btn');
  var $toast = null;
  var sharePending = false;
  function updateShareAvailability() {
    $shareBtn.prop('disabled', sharePending || !navigator.onLine)
      .attr('title', navigator.onLine ? 'Share code via link' : 'Sharing needs an internet connection');
  }
  window.addEventListener('online', updateShareAvailability);
  window.addEventListener('offline', updateShareAvailability);
  updateShareAvailability();

  function showToast(msg, isError) {
    if ($toast) { $toast.remove(); }
    $toast = $('<div class="share-toast' + (isError ? ' share-toast-err' : '') + '"></div>').text(msg);
    $('body').append($toast);
    setTimeout(function () { if ($toast) $toast.addClass('visible'); }, 10);
    setTimeout(function () {
      if ($toast) { $toast.removeClass('visible'); }
      setTimeout(function () { if ($toast) { $toast.remove(); $toast = null; } }, 300);
    }, 3000);
  }

  $shareBtn.on('click', function () {
    if (!navigator.onLine) { showToast('Sharing needs an internet connection.', true); return; }
    var code = window.PPG && PPG.getCurrentCode ? PPG.getCurrentCode() : '';
    if (!code.trim()) {
      showToast('Nothing to share — editor is empty.', true);
      return;
    }

    sharePending = true;
    updateShareAvailability();

    fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
        return res.json();
      })
      .then(function (data) {
        var url = location.origin + data.url;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            showToast('Link copied: ' + url);
          }).catch(function () {
            prompt('Copy this link:', url);
          });
        } else {
          prompt('Copy this link:', url);
        }
        // Update the browser URL bar so the current page IS the share link.
        history.replaceState(null, '', data.url);
      })
      .catch(function (err) {
        showToast(!navigator.onLine || err instanceof TypeError ? 'Sharing needs an internet connection.' : 'Share failed: ' + err.message, true);
      })
      .finally(function () {
        sharePending = false;
        updateShareAvailability();
      });
  });
})();
