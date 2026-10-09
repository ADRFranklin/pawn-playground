'use strict';

(function () {
  const installButton = document.getElementById('install-app');
  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      console.warn('Installation was not available:', error);
    }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButton.hidden = true;
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'})
        .then(registration => {
          function updateReady() {
            // The new worker waits for all existing tabs to close. No editor
            // reloads and no in-memory document changes are interrupted.
            const notice = document.createElement('div');
            notice.className = 'share-toast visible pwa-update-notice';
            notice.setAttribute('role', 'status');
            notice.textContent = 'An update is ready. Close all Playground windows and reopen to use it.';
            document.body.append(notice);
            setTimeout(() => notice.remove(), 12000);
          }
          if (registration.waiting) updateReady();
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady();
            });
          });
        })
        .catch(error => console.warn('Offline support could not be enabled:', error));
    });
  }
})();
