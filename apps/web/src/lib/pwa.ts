import { useToastStore } from '@/stores/toast';

/**
 * Service worker registration.
 *
 * Deliberately never registered by the dev server. A worker that outlives a `vite build` preview and
 * then serves its cached shell to `vite dev` is the classic way to spend an hour debugging a change
 * that was already correct — so in development there is simply nothing to go stale.
 *
 * Updates are offered, not forced: the new worker activates immediately (assets are content-hashed,
 * so nothing conflicts), but the open page keeps the code it started with until the reader chooses
 * to reload. Reloading mid-sentence in a composer is worse than running one version behind.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const incoming = registration.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            // A worker reaching "installed" while one is already in control means a new build is
            // waiting. On the very first install there is no controller, and nothing to announce.
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              useToastStore().prompt('A new version is ready', 'Reload', () => {
                incoming.postMessage('skip-waiting');
                window.location.reload();
              });
            }
          });
        });
      })
      .catch((error) => console.error('[pwa] service worker registration failed', error));
  });
}
