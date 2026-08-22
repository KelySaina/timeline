import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api, clientId, query } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { EventDraft, EventType, Summary, TimelineEvent, UpcomingItem } from '@/api/types';
import { todayIso } from '@/lib/format';

const PAGE_SIZE = 40;

export type YearGroup = { year: number; events: TimelineEvent[] };

export const useTimelineStore = defineStore('timeline', () => {
  const events = ref<TimelineEvent[]>([]);
  const upcoming = ref<UpcomingItem[]>([]);
  const summary = ref<Summary | null>(null);
  const total = ref(0);
  const loading = ref(false);
  const loadingMore = ref(false);
  const loaded = ref(false);

  const activeTypes = ref<EventType[]>([]);
  const activeYear = ref<number | null>(null);
  const order = ref<'asc' | 'desc'>('desc');

  const hasMore = computed(() => events.value.length < total.value);
  const isFiltered = computed(() => activeTypes.value.length > 0 || activeYear.value !== null);

  /** Year buckets in the direction the reader chose — the timeline's only structural grouping. */
  const grouped = computed<YearGroup[]>(() => {
    const buckets = new Map<number, TimelineEvent[]>();
    for (const event of events.value) {
      const year = Number(event.eventDate.slice(0, 4));
      const bucket = buckets.get(year);
      if (bucket) bucket.push(event);
      else buckets.set(year, [event]);
    }
    return [...buckets.entries()]
      .map(([year, list]) => ({ year, events: list }))
      .sort((a, b) => (order.value === 'asc' ? a.year - b.year : b.year - a.year));
  });

  const listParams = (offset: number) => ({
    scope: 'past',
    order: order.value,
    type: activeTypes.value.length ? activeTypes.value.join(',') : undefined,
    year: activeYear.value ?? undefined,
    limit: PAGE_SIZE,
    offset,
  });

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const [list, stats] = await Promise.all([
        api.get<{ events: TimelineEvent[]; total: number }>(`/events${query(listParams(0))}`),
        api.get<Summary>('/events/summary'),
      ]);
      events.value = list.events;
      total.value = list.total;
      summary.value = stats;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
    try {
      const list = await api.get<{ events: TimelineEvent[]; total: number }>(
        `/events${query(listParams(events.value.length))}`,
      );
      events.value = [...events.value, ...list.events];
      total.value = list.total;
    } finally {
      loadingMore.value = false;
    }
  }

  async function loadUpcoming(): Promise<void> {
    upcoming.value = (await api.get<{ items: UpcomingItem[] }>('/upcoming?days=365')).items;
  }

  function toggleType(type: EventType): void {
    activeTypes.value = activeTypes.value.includes(type)
      ? activeTypes.value.filter((t) => t !== type)
      : [...activeTypes.value, type];
    void load();
  }

  function setYear(year: number | null): void {
    activeYear.value = activeYear.value === year ? null : year;
    void load();
  }

  function setOrder(next: 'asc' | 'desc'): void {
    if (order.value === next) return;
    order.value = next;
    void load();
  }

  function clearFilters(): void {
    activeTypes.value = [];
    activeYear.value = null;
    void load();
  }

  /** Insert locally so a new memory slides into its chronological place without a full reload. */
  function absorb(event: TimelineEvent): void {
    const withoutIt = events.value.filter((e) => e.id !== event.id);
    const isPast = event.eventDate <= todayIso();
    if (!isPast) {
      events.value = withoutIt;
      return;
    }
    const index = withoutIt.findIndex((e) =>
      order.value === 'desc' ? e.eventDate < event.eventDate : e.eventDate > event.eventDate,
    );
    events.value = index === -1 ? [...withoutIt, event] : [...withoutIt.slice(0, index), event, ...withoutIt.slice(index)];
  }

  async function create(draft: EventDraft): Promise<TimelineEvent> {
    const { event } = await api.post<{ event: TimelineEvent }>('/events', draft);
    absorb(event);
    total.value += 1;
    await Promise.all([refreshSummary(), loadUpcoming()]);
    return event;
  }

  async function update(id: string, patch: Partial<EventDraft>): Promise<TimelineEvent> {
    const { event } = await api.patch<{ event: TimelineEvent }>(`/events/${id}`, patch);
    absorb(event);
    await Promise.all([refreshSummary(), loadUpcoming()]);
    return event;
  }

  async function remove(id: string): Promise<void> {
    await api.del(`/events/${id}`);
    events.value = events.value.filter((event) => event.id !== id);
    total.value = Math.max(0, total.value - 1);
    await Promise.all([refreshSummary(), loadUpcoming()]);
  }

  /**
   * Put back a memory this session deleted. The row was only soft-deleted, so this is a restore
   * rather than a re-create: the same id, the same photos, the same place in the story.
   */
  async function restore(id: string): Promise<TimelineEvent> {
    const { event } = await api.post<{ event: TimelineEvent }>(`/events/${id}/restore`, {});
    const before = events.value.length;
    absorb(event);
    // absorb() keeps a future-dated memory out of the story scroll, so the count follows what
    // actually landed rather than assuming a restore always puts a row back on screen.
    total.value = Math.max(0, total.value + (events.value.length - before));
    await Promise.all([refreshSummary(), loadUpcoming()]);
    return event;
  }

  /**
   * Re-read exactly the window that is already on screen. Used when the change stream was asleep —
   * a phone in a pocket suspends it — so catching up does not mean snapping the reader back to the
   * top of the story. Capped at the endpoint's own maximum page.
   */
  async function refresh(): Promise<void> {
    if (!loaded.value) return;
    const span = Math.min(100, Math.max(PAGE_SIZE, events.value.length));
    const list = await api.get<{ events: TimelineEvent[]; total: number }>(
      `/events${query({ ...listParams(0), limit: span })}`,
    );
    events.value = list.events;
    total.value = list.total;
    await Promise.all([refreshSummary(), loadUpcoming()]);
  }

  /**
   * Apply a change the other side of the story made. The stream carries no content — only "row X
   * changed" — so the memory is re-read through the normal endpoint and the couple check stays on
   * the read path exactly as it is for a first-party fetch.
   */
  async function applyRemote(kind: 'created' | 'updated' | 'deleted', id: string): Promise<void> {
    if (kind === 'deleted') {
      const before = events.value.length;
      events.value = events.value.filter((event) => event.id !== id);
      if (events.value.length < before) total.value = Math.max(0, total.value - 1);
    } else if (loaded.value) {
      if (isFiltered.value) {
        // A filtered list cannot decide locally whether an incoming memory belongs in it.
        await load();
      } else {
        const event = await fetchOne(id).catch(() => null);
        if (event) {
          const before = events.value.length;
          absorb(event);
          // absorb() keeps future-dated memories out of the story scroll, so the count follows what
          // actually landed rather than assuming a create always adds a row.
          total.value = Math.max(0, total.value + (events.value.length - before));
        }
      }
    }
    // The counters describe the same events whether or not the scroll is on screen.
    await Promise.all([refreshSummary(), loadUpcoming()]);
  }

  async function addPhotos(id: string, files: File[]): Promise<TimelineEvent> {
    const form = new FormData();
    for (const file of files) form.append('photos', file);
    const response = await fetch(`/api/events/${id}/photos`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      headers: {
        'X-CSRF-Token': document.cookie.match(/tl_csrf=([^;]+)/)?.[1] ?? '',
        'X-Client-Id': clientId,
      },
    });
    const payload = (await response.json()) as { event?: TimelineEvent; error?: { message: string } };
    if (!response.ok || !payload.event) throw new Error(payload.error?.message ?? 'Those photos did not upload');
    absorb(payload.event);
    await refreshSummary();
    return payload.event;
  }

  async function removePhoto(eventId: string, photoId: string): Promise<TimelineEvent> {
    const { event } = await api.del<{ event: TimelineEvent }>(`/events/${eventId}/photos/${photoId}`);
    absorb(event);
    await refreshSummary();
    return event;
  }

  /**
   * The timeline's own summary and the couple's stat counters both describe the same events, so any
   * write refreshes both — otherwise the header keeps claiming zero memories after the first one.
   */
  const refreshSummary = async () => {
    const [stats] = await Promise.all([
      api.get<Summary>('/events/summary'),
      useAuthStore().refreshCouple(),
    ]);
    summary.value = stats;
  };

  const fetchOne = (id: string) => api.get<{ event: TimelineEvent }>(`/events/${id}`).then((r) => r.event);
  const byId = (id: string) => events.value.find((event) => event.id === id) ?? null;

  function reset(): void {
    events.value = [];
    upcoming.value = [];
    summary.value = null;
    total.value = 0;
    loaded.value = false;
    activeTypes.value = [];
    activeYear.value = null;
  }

  return {
    events, upcoming, summary, total, loading, loadingMore, loaded,
    activeTypes, activeYear, order, hasMore, isFiltered, grouped,
    load, loadMore, loadUpcoming, toggleType, setYear, setOrder, clearFilters,
    create, update, remove, restore, addPhotos, removePhoto, fetchOne, byId, reset, refreshSummary,
    applyRemote, refresh,
  };
});
