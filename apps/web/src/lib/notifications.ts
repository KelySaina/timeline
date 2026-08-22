/**
 * Turning reminders on, and being honest about the many reasons that might not be possible.
 *
 * This is the part of push that is nearly all edge case. A switch that says "on" while the OS is
 * quietly dropping every notification is worse than no switch, so every state the reader could be
 * in is named and reported rather than collapsed into a boolean:
 *
 *   unsupported    no service worker or no PushManager — an old browser, or a private window
 *   no-worker      the APIs exist but no service worker is registered, so there is nothing to
 *                  subscribe: development builds deliberately never register one
 *   needs-install  iOS, where push only exists once the app is on the home screen
 *   unconfigured   this deployment has no VAPID keys, so there is nothing to subscribe to
 *   blocked        permission was denied, and only the reader can undo that in browser settings
 *   off            possible, not on
 *   on             this browser holds a subscription the server knows about
 *
 * Permission is only ever requested from a click. Asking on load is how a site ends up permanently
 * denied with no way back, and the answer would be no.
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';

export type NotificationState =
  | 'unsupported'
  | 'no-worker'
  | 'needs-install'
  | 'unconfigured'
  | 'blocked'
  | 'off'
  | 'on';

type ServerState = {
  configured: boolean;
  publicKey: string | null;
  subscribed: boolean;
  devices: number;
  sendHour: number;
};

const server = ref<ServerState | null>(null);
const permission = ref<NotificationPermission>('default');
const endpoint = ref<string | null>(null);
const worker = ref(false);
const busy = ref(false);
const loaded = ref(false);

const hasPushApi = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * iOS grants push only to a home-screen app, and there is no way to ask before then: the API is
 * simply absent in Safari's tab. The install button already exists for this — the notification card
 * points at it rather than offering a switch that cannot work.
 */
const iosNeedsInstall = (): boolean => {
  const ios =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
};

export const state = computed<NotificationState>(() => {
  if (!hasPushApi()) return iosNeedsInstall() ? 'needs-install' : 'unsupported';
  if (server.value && !server.value.configured) return 'unconfigured';
  // Checked before permission, because asking for permission with nothing to subscribe would burn
  // the one chance to ask and still leave notifications off.
  if (!worker.value) return 'no-worker';
  if (permission.value === 'denied') return 'blocked';
  return server.value?.subscribed ? 'on' : 'off';
});

export const working = computed(() => busy.value);
export const ready = computed(() => loaded.value);
/** How many of this person's devices are subscribed, including this one. */
export const devices = computed(() => server.value?.devices ?? 0);
/** The local hour reminders arrive at, so the card can say when rather than only whether. */
export const sendHour = computed(() => server.value?.sendHour ?? 9);

/**
 * base64url from the API to the raw bytes the Push API insists on. Returned as the ArrayBuffer
 * rather than the view: `applicationServerKey` is typed as a BufferSource, and a Uint8Array over an
 * unknown buffer kind does not satisfy it.
 */
function decodeKey(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // `ready` resolves only once a worker controls the page, which never happens in development —
  // registerServiceWorker() deliberately skips dev — so this must not be awaited unguarded.
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? null;
}

/**
 * Ask the server what it knows, and tell it about the subscription this browser already holds.
 *
 * That second half is the repair mechanism: a push service may rotate an endpoint at any time, and
 * the browser does not tell the page when it happens. Re-sending whatever subscription exists on
 * every load means a rotated endpoint is corrected the next time the app is opened, rather than
 * silently never receiving anything again.
 */
export async function refresh(): Promise<void> {
  if (!hasPushApi()) {
    loaded.value = true;
    return;
  }
  permission.value = Notification.permission;

  const registered = await registration();
  worker.value = registered !== null;
  const subscription = await registered?.pushManager.getSubscription().catch(() => null);
  endpoint.value = subscription?.endpoint ?? null;

  const query = endpoint.value ? `?endpoint=${encodeURIComponent(endpoint.value)}` : '';
  server.value = await api.get<ServerState>(`/push/state${query}`).catch(() => null);

  // The browser holds a subscription the server has never heard of — a rotated endpoint, or a
  // server that lost the row. Re-register it rather than leaving a switch that reads "on" and does
  // nothing.
  if (subscription && server.value?.configured && !server.value.subscribed) {
    await send(subscription).catch(() => undefined);
    server.value = await api.get<ServerState>(`/push/state?endpoint=${encodeURIComponent(subscription.endpoint)}`);
  }

  loaded.value = true;
}

async function send(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await api.post('/push/subscribe', {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    // The browser knows this and a person should never be asked for it.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent.slice(0, 400),
  });
}

/**
 * Enable reminders on this browser. Must be called from a click: `requestPermission()` outside a
 * user gesture is refused outright by some browsers and ignored by others.
 *
 * Returns the state that resulted, so the caller can say something specific rather than guessing.
 */
export async function enable(): Promise<NotificationState> {
  if (busy.value) return state.value;
  busy.value = true;
  try {
    const registered = await registration();
    if (!registered || !server.value?.publicKey) return state.value;

    permission.value = await Notification.requestPermission();
    if (permission.value !== 'granted') return state.value;

    // Reuse whatever this browser already has: subscribing again with the same key returns the
    // same subscription, but only if the key matches — a redeployed VAPID pair needs the old one
    // dropped first.
    const existing = await registered.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registered.pushManager.subscribe({
        // Required to be true by every implementation: a push that shows nothing is not allowed.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(server.value.publicKey),
      }));

    endpoint.value = subscription.endpoint;
    await send(subscription);
    server.value = { ...server.value, subscribed: true, devices: Math.max(1, server.value.devices) };
    await refresh();
    return state.value;
  } finally {
    busy.value = false;
  }
}

/**
 * Turn it off on this browser only. The subscription is dropped locally *and* on the server: a row
 * left behind would keep paying for sends nothing can receive, and a local unsubscribe left alone
 * would make the switch lie on the next load.
 */
export async function disable(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const registered = await registration();
    const subscription = await registered?.pushManager.getSubscription().catch(() => null);
    const gone = subscription?.endpoint ?? endpoint.value;
    if (subscription) await subscription.unsubscribe().catch(() => undefined);
    if (gone) await api.del(`/push/subscribe`, { endpoint: gone }).catch(() => undefined);
    endpoint.value = null;
    await refresh();
  } finally {
    busy.value = false;
  }
}

/** Send one to yourself now. The only way to catch notifications silenced at OS level. */
export async function sendTest(): Promise<number> {
  const result = await api.post<{ delivered: number }>('/push/test', {});
  return result.delivered;
}
