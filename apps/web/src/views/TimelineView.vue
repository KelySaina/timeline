<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { TimelineEvent, UpcomingItem } from '@/api/types';
import { eventTypeList } from '@/lib/eventTypes';
import { useAuthStore } from '@/stores/auth';
import { useTimelineStore } from '@/stores/timeline';
import { useUiStore } from '@/stores/ui';
import CoupleHeader from '@/components/CoupleHeader.vue';
import EmptyTimeline from '@/components/EmptyTimeline.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import SkeletonTimeline from '@/components/ui/SkeletonTimeline.vue';
import Timeline from '@/components/Timeline.vue';
import UpcomingEvents from '@/components/UpcomingEvents.vue';

const auth = useAuthStore();
const timeline = useTimelineStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const isEmpty = computed(() => !timeline.loading && timeline.events.length === 0 && !timeline.isFiltered);
const noMatches = computed(() => !timeline.loading && timeline.events.length === 0 && timeline.isFiltered);

/** Only offer type filters the couple actually has memories in. */
const availableTypes = computed(() =>
  eventTypeList.filter((meta) => (timeline.summary?.types[meta.type] ?? 0) > 0),
);
const years = computed(() => timeline.summary?.years ?? []);
const nextUp = computed(() => timeline.upcoming.slice(0, 2));

onMounted(async () => {
  if (!timeline.loaded) await timeline.load();
  await timeline.loadUpcoming();
  await openFromRoute();
  openFromShortcut();
});

/**
 * The installed app's "Add a memory" shortcut lands on /?compose=1. The flag is stripped once used,
 * so a reload or a back-navigation does not reopen the composer.
 */
function openFromShortcut(): void {
  if (!route.query.compose) return;
  ui.compose();
  void router.replace({ path: route.path, query: { ...route.query, compose: undefined } });
}

/** /memory/:id is a real, linkable address for a memory. */
async function openFromRoute(): Promise<void> {
  const id = route.params.id;
  if (typeof id !== 'string' || !id) return;
  const local = timeline.byId(id);
  ui.view(local ?? (await timeline.fetchOne(id).catch(() => null)));
}

watch(() => route.params.id, openFromRoute);

function open(event: TimelineEvent): void {
  ui.view(event);
  void router.push({ name: 'memory', params: { id: event.id } });
}

function closeViewer(): void {
  if (route.name === 'memory') void router.push({ name: 'timeline' });
}
watch(() => ui.viewing, (event) => {
  if (!event) closeViewer();
});

function openUpcoming(item: UpcomingItem): void {
  if (item.eventId) {
    void router.push({ name: 'memory', params: { id: item.eventId } });
    return;
  }
  void router.push({ name: 'upcoming' });
}
</script>

<template>
  <div>
    <CoupleHeader v-if="auth.couple" :couple="auth.couple" variant="hero" class="mb-6">
      <template #action>
        <RouterLink :to="{ name: 'profile' }" class="btn btn-quiet h-9 w-9 rounded-full p-0" aria-label="Couple profile">
          <FaIcon icon="sliders" />
        </RouterLink>
      </template>
    </CoupleHeader>

    <div v-if="auth.isSolo" class="card-quiet mb-6 flex items-center gap-3 px-4 py-3">
      <FaIcon icon="user-plus" class="text-[var(--ember)]" />
      <p class="min-w-0 flex-1 text-[0.875rem]">
        <span class="text-ink">Just you so far.</span>
        <span class="text-muted"> Start anyway — they can catch up.</span>
      </p>
      <RouterLink :to="{ name: 'profile' }" class="chip shrink-0">Invite</RouterLink>
    </div>

    <UpcomingEvents
      v-if="nextUp.length"
      :items="nextUp"
      heading="Coming up"
      class="mb-7"
      @open="openUpcoming"
    />

    <template v-if="isEmpty">
      <EmptyTimeline @start="ui.compose({ title: $event.title === 'Add something else' ? '' : $event.title, type: $event.type, prompt: $event.prompt })" />
    </template>

    <template v-else>
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl
          :model-value="timeline.order"
          :options="[
            { value: 'desc', label: 'Newest' },
            { value: 'asc', label: 'From the start' },
          ]"
          @update:model-value="timeline.setOrder($event as 'asc' | 'desc')"
        />
        <span class="flex-1" />
        <button v-if="timeline.isFiltered" class="chip" @click="timeline.clearFilters()">
          <FaIcon icon="xmark" class="text-[0.65rem]" />Clear
        </button>
      </div>

      <div class="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          v-for="year in years"
          :key="year.year"
          class="chip tabular-nums"
          :class="timeline.activeYear === year.year && 'is-active'"
          @click="timeline.setYear(year.year)"
        >
          {{ year.year }}
          <span class="opacity-60">{{ year.count }}</span>
        </button>
        <span v-if="years.length && availableTypes.length" class="mx-1 w-px shrink-0 bg-line" />
        <button
          v-for="meta in availableTypes"
          :key="meta.type"
          class="chip"
          :class="timeline.activeTypes.includes(meta.type) && 'is-active'"
          @click="timeline.toggleType(meta.type)"
        >
          <FaIcon :icon="meta.icon" class="text-[0.65rem]" :style="{ color: meta.color }" />
          {{ meta.label }}
        </button>
      </div>

      <SkeletonTimeline v-if="timeline.loading && !timeline.events.length" />

      <p v-else-if="noMatches" class="py-14 text-center text-[0.9375rem] text-muted">
        Nothing matches that filter — yet.
        <button class="ml-1 underline hover:text-ink" @click="timeline.clearFilters()">Show everything</button>
      </p>

      <Timeline
        v-else
        :groups="timeline.grouped"
        :has-more="timeline.hasMore"
        :loading-more="timeline.loadingMore"
        @open="open"
        @reach-end="timeline.loadMore()"
      />
    </template>
  </div>
</template>
