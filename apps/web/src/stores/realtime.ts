import { ref } from 'vue';
import { defineStore } from 'pinia';
import { clientId } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useTimelineStore } from '@/stores/timeline';
import { useToastStore } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';

type ChangeKind =
  | 'event.created'
  | 'event.updated'
  | 'event.deleted'
  | 'couple.updated'
  | 'member.joined'
  | 'recurring.changed';

type Change = { couple: string; kind: ChangeKind; id?: string; actor?: string; origin?: string };

/**
 * The live half of "two people, one story": what one partner writes shows up on the other's screen
 * without a refresh.
 *
 * EventSource rather than a WebSocket — the traffic only ever flows one way, it rides the session
 * cookie unchanged, and the browser owns the reconnect. What arrives is never content, only "this
 * row changed", so every update is re-read through the ordinary authorized endpoint.
 */
export const useRealtimeStore = defineStore('realtime', () => {
  const connected = ref(false);
  let source: EventSource | null = null;
  /** Set while a change is being applied, so a burst of nudges cannot interleave two reconciles. */
  let queue: Promise<void> = Promise.resolve();

  const named = (actor?: string): string | null => {
    const auth = useAuthStore();
    if (!actor || actor === auth.user?.id) return null;
    return auth.couple?.members.find((member) => member.id === actor)?.displayName ?? 'Your partner';
  };

  async function apply(change: Change): Promise<void> {
    const timeline = useTimelineStore();
    const auth = useAuthStore();
    const toasts = useToastStore();
    const ui = useUiStore();
    const who = named(change.actor);

    switch (change.kind) {
      case 'event.created':
      case 'event.updated': {
        if (!change.id) return;
        await timeline.applyRemote(change.kind === 'event.created' ? 'created' : 'updated', change.id);
        // Keep an open memory viewer on the same row rather than showing a stale copy of it.
        if (ui.viewing?.id === change.id) {
          const fresh = timeline.byId(change.id) ?? (await timeline.fetchOne(change.id).catch(() => null));
          if (fresh) ui.view(fresh);
        }
        if (who && change.kind === 'event.created') toasts.warm(`${who} added a memory`);
        return;
      }
      case 'event.deleted': {
        if (!change.id) return;
        if (ui.viewing?.id === change.id) ui.view(null);
        await timeline.applyRemote('deleted', change.id);
        if (who) toasts.push(`${who} removed a memory`);
        return;
      }
      case 'couple.updated': {
        // Covers the theme, the title, the start date and either partner's profile — the couple
        // snapshot carries all of them, and applyTheme() repaints if the colours moved.
        await auth.refreshCouple();
        return;
      }
      case 'member.joined': {
        await auth.refreshCouple();
        // Resolved after the refresh on purpose: before it, the new partner is not in the member
        // list yet and the greeting would read "Your partner joined your timeline".
        const arrival = named(change.actor);
        if (arrival) toasts.warm(`${arrival} joined your timeline`);
        return;
      }
      case 'recurring.changed': {
        await timeline.loadUpcoming();
        return;
      }
    }
  }

  /**
   * A backgrounded phone suspends the stream, and the changes that happened meanwhile are simply
   * gone — there is no replay. So coming back to the app re-reads the window on screen rather than
   * trusting a connection that may have missed something.
   */
  function onVisible(): void {
    if (document.visibilityState !== 'visible') return;
    if (source && source.readyState === EventSource.CLOSED) {
      source = null;
      connected.value = false;
      connect();
    }
    queue = queue
      .then(() => useTimelineStore().refresh())
      .then(() => useAuthStore().refreshCouple())
      .catch((error) => console.error('[realtime] catch-up failed', error));
  }

  function connect(): void {
    if (source || typeof EventSource === 'undefined') return;
    document.addEventListener('visibilitychange', onVisible);

    // EventSource cannot set headers, so this tab identifies itself in the query string; the server
    // uses it to skip echoing a change back to whoever made it.
    source = new EventSource(`/api/stream?client=${encodeURIComponent(clientId)}`);

    source.addEventListener('open', () => {
      connected.value = true;
    });

    source.addEventListener('change', (message) => {
      let change: Change;
      try {
        change = JSON.parse((message as MessageEvent<string>).data) as Change;
      } catch {
        return;
      }
      queue = queue.then(() => apply(change)).catch((error) => {
        console.error('[realtime] could not apply change', error);
      });
    });

    // The session was revoked elsewhere (password change, sign out everywhere). Stop reconnecting
    // and let the router send them back to the door.
    source.addEventListener('revoked', () => {
      disconnect();
      void useAuthStore().bootstrap();
    });

    source.addEventListener('error', () => {
      // EventSource reconnects on its own; this only reflects the gap in the UI.
      connected.value = false;
    });
  }

  function disconnect(): void {
    document.removeEventListener('visibilitychange', onVisible);
    source?.close();
    source = null;
    connected.value = false;
  }

  return { connected, connect, disconnect };
});
