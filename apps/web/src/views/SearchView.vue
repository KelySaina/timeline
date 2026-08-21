<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, query } from '@/api/client';
import type { TimelineEvent } from '@/api/types';
import { useTimelineStore } from '@/stores/timeline';
import { useUiStore } from '@/stores/ui';
import MemoryCard from '@/components/MemoryCard.vue';

const timeline = useTimelineStore();
const ui = useUiStore();
const router = useRouter();

const term = ref('');
const results = ref<TimelineEvent[]>([]);
const searching = ref(false);
const searched = ref(false);
const input = ref<HTMLInputElement | null>(null);
let handle = 0;
let controller: AbortController | null = null;

const suggestions = computed(() => {
  const tags = new Map<string, number>();
  for (const event of timeline.events) {
    for (const tag of event.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  return [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);
});

const grouped = computed(() => {
  const buckets = new Map<number, TimelineEvent[]>();
  for (const event of results.value) {
    const year = Number(event.eventDate.slice(0, 4));
    buckets.set(year, [...(buckets.get(year) ?? []), event]);
  }
  return [...buckets.entries()].sort((a, b) => b[0] - a[0]);
});

async function run(): Promise<void> {
  const value = term.value.trim();
  controller?.abort();
  if (!value) {
    results.value = [];
    searched.value = false;
    return;
  }
  controller = new AbortController();
  searching.value = true;
  try {
    const payload = await api.get<{ events: TimelineEvent[] }>(
      `/search${query({ q: value })}`,
      controller.signal,
    );
    results.value = payload.events;
    searched.value = true;
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') results.value = [];
  } finally {
    searching.value = false;
  }
}

// Debounced: search as you type, without a request per keystroke.
watch(term, () => {
  window.clearTimeout(handle);
  handle = window.setTimeout(run, 260);
});

onMounted(async () => {
  if (!timeline.loaded) await timeline.load();
  await nextTick();
  input.value?.focus();
});

function open(event: TimelineEvent): void {
  ui.view(event);
  void router.push({ name: 'memory', params: { id: event.id } });
}
</script>

<template>
  <div>
    <header class="mb-5">
      <h1 class="display text-[1.75rem]">Search our story</h1>
      <p class="mt-1 text-[0.9rem] text-muted">Titles, stories, places, tags.</p>
    </header>

    <div class="relative">
      <FaIcon icon="magnifying-glass" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref="input"
        v-model="term"
        class="field pl-10 pr-10"
        placeholder="Nosy Be, first kiss, inside joke…"
        type="search"
      />
      <FaIcon
        v-if="searching"
        icon="circle-notch"
        class="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-muted"
      />
      <button
        v-else-if="term"
        class="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
        aria-label="Clear search"
        @click="term = ''"
      >
        <FaIcon icon="xmark" />
      </button>
    </div>

    <div v-if="!term && suggestions.length" class="mt-4 flex flex-wrap gap-1.5">
      <button v-for="tag in suggestions" :key="tag" class="chip" @click="term = tag">
        <FaIcon icon="tag" class="text-[0.6rem] opacity-60" />{{ tag }}
      </button>
    </div>

    <p v-if="searched && !results.length && !searching" class="py-14 text-center text-[0.9375rem] text-muted">
      Nothing matches “{{ term }}”.
    </p>

    <div v-if="results.length" class="mt-6">
      <p class="eyebrow mb-3">{{ results.length }} {{ results.length === 1 ? 'memory' : 'memories' }}</p>
      <section v-for="[year, events] in grouped" :key="year" class="mb-6">
        <h2 class="display mb-2 text-[1.15rem] tabular-nums text-muted">{{ year }}</h2>
        <div class="space-y-3">
          <MemoryCard v-for="event in events" :key="event.id" :event="event" compact @open="open(event)" />
        </div>
      </section>
    </div>
  </div>
</template>
