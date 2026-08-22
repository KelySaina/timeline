import { computed, ref } from 'vue';
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

/* ---------------------------------------------------------------------------------------------
 * Installing it
 * ------------------------------------------------------------------------------------------ */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const deferred = ref<InstallPromptEvent | null>(null);
const runningInstalled = ref(false);
const manual = ref(false);

const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  window.matchMedia?.('(display-mode: window-controls-overlay)').matches === true ||
  // iOS' own flag, which predates the standard media query and is the only signal there.
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * iOS has no `beforeinstallprompt` and no programmatic install at all — adding to the home screen
 * is a manual trip through the Share sheet. A button that silently does nothing is worse than no
 * button, so there we show the two steps instead of pretending we can do it for them.
 */
const isIosBrowser = (): boolean =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** True when the browser handed us a real prompt we can fire on a click. */
export const canInstall = computed(() => !runningInstalled.value && deferred.value !== null);

/** True when installing is possible but only by hand (iOS). */
export const needsManualInstall = computed(() => !runningInstalled.value && manual.value);

/** Already running as an installed app — nothing to offer. */
export const isInstalled = computed(() => runningInstalled.value);

/** Anything to show the reader at all? */
export const canOfferInstall = computed(() => canInstall.value || needsManualInstall.value);

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred.value;
  if (!event) return 'unavailable';
  await event.prompt();
  const { outcome } = await event.userChoice;
  // The event is single-use: once fired, the browser will not hand it over again this page load.
  deferred.value = null;
  if (outcome === 'accepted') runningInstalled.value = true;
  return outcome;
}

/**
 * Registered from main.ts rather than from a component. `beforeinstallprompt` fires within moments
 * of load — long before the header that offers the button has any reason to exist — and it is only
 * offered once, so missing it means no install affordance for the whole session.
 */
export function watchInstallability(): void {
  runningInstalled.value = isStandalone();
  manual.value = !runningInstalled.value && isIosBrowser();

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this Chrome shows its own mini-infobar and the event cannot be replayed later.
    event.preventDefault();
    deferred.value = event as InstallPromptEvent;
    // A real prompt beats the manual instructions wherever both somehow apply.
    manual.value = false;
  });

  window.addEventListener('appinstalled', () => {
    runningInstalled.value = true;
    deferred.value = null;
    manual.value = false;
  });

  // Launching from the home screen mid-session should retire the button without a reload.
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (event) => {
    if (event.matches) {
      runningInstalled.value = true;
      deferred.value = null;
      manual.value = false;
    }
  });
}
