<script setup lang="ts">
/**
 * The route map: the story as a transit diagram.
 *
 * Every memory is a station on the line, and the one field the app already stores but barely shows —
 * `location` — becomes the station name. A memory with a place steps the line sideways, which is
 * what gives the diagram its elbows; a memory without one stays on the trunk. Multi-day trips (an
 * `end_date`) draw as a spur with length, because that is what they are.
 *
 * Deliberately not cards. A transit map's whole virtue is that a hundred stops fit on one sheet, so
 * a station is a line of type and tapping it opens the memory the same way the rail's card does.
 */
import { computed } from 'vue';
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import { typeMeta } from '@/lib/eventTypes';
import { formatDateRange } from '@/lib/format';

const props = defineProps<{ groups: YearGroup[] }>();
defineEmits<{ open: [TimelineEvent] }>();

type Station = {
  event: TimelineEvent;
  /**
   * Where the track enters this stop and where it leaves. `from` is the previous stop's `to` — a
   * segment drawn from its own track alone would enter at a different x than the one above left
   * from, and the line would visibly jump at every boundary.
   */
  from: number;
  to: number;
  spur: boolean;
  color: string;
};

/** x positions, in the segment's 0–100 box: the trunk, and one step out for a located memory. */
const TRUNK = 28;
const STEPPED = 72;

const stations = computed(() => {
  // Walked flat, then regrouped: continuity has to survive a year heading.
  let previous = TRUNK;
  const flat = props.groups.flatMap((group) =>
    group.events.map((event) => {
      const to = event.location ? STEPPED : TRUNK;
      const stop: Station & { year: number } = {
        event,
        from: previous,
        to,
        spur: Boolean(event.endDate && event.endDate > event.eventDate),
        color: typeMeta(event.type).color,
        year: group.year,
      };
      previous = to;
      return stop;
    }),
  );

  return props.groups.map((group) => ({
    year: group.year,
    stops: flat.filter((stop) => stop.year === group.year),
  }));
});

/** Enter where the last one left, step across, run out straight. */
const track = (stop: Station): string =>
  stop.from === stop.to
    ? `M${stop.to} 0 L${stop.to} 100`
    : `M${stop.from} 0 L${stop.from} 32 L${stop.to} 50 L${stop.to} 100`;

const placeless = computed(
  () => props.groups.flatMap((g) => g.events).filter((e) => !e.location).length,
);
const total = computed(() => props.groups.flatMap((g) => g.events).length);
</script>

<template>
  <div>
    <!--
      Said plainly rather than left to be discovered: this layout is mostly a straight line until
      memories carry places, and a reader who picked it deserves to know why it looks flat.
    -->
    <p
      v-if="total && placeless === total"
      class="card-quiet mb-5 flex items-start gap-2.5 px-4 py-3 text-[0.8125rem]"
    >
      <FaIcon icon="location-dot" class="mt-0.5 shrink-0 text-[var(--ember)]" />
      <span class="text-muted">
        <span class="text-ink">No places yet.</span>
        The route draws its stations from where a memory happened — add a location to one and it
        steps off the trunk line.
      </span>
    </p>

    <section v-for="group in stations" :key="group.year" class="mb-1">
      <div class="sticky top-14 z-20 -mx-4 mb-2 flex items-center gap-3 bg-paper/90 px-4 py-2.5 backdrop-blur-sm">
        <h2 class="display text-[1.6rem] tabular-nums leading-none sm:text-[1.9rem]">{{ group.year }}</h2>
        <span class="h-px flex-1 bg-line" />
        <span class="text-[0.75rem] text-muted">{{ group.stops.length }} stops</span>
      </div>

      <ol>
        <li v-for="stop in group.stops" :key="stop.event.id" class="reveal route-stop">
          <!-- The track. An SVG per stop keeps the line continuous whatever the label wraps to. -->
          <span class="route-track" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="h-full w-full">
              <path
                :d="track(stop)"
                fill="none"
                stroke="var(--line-strong)"
                stroke-width="6"
                vector-effect="non-scaling-stroke"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              <path
                v-if="stop.spur"
                :d="`M${stop.to} 62 L96 62`"
                fill="none"
                :stroke="stop.color"
                stroke-width="3"
                stroke-dasharray="5 4"
                vector-effect="non-scaling-stroke"
                stroke-linecap="round"
              />
            </svg>
            <span
              class="route-dot"
              :style="{ left: `${stop.to}%`, borderColor: stop.color }"
            />
          </span>

          <button class="route-label" @click="$emit('open', stop.event)">
            <span class="flex items-center gap-2">
              <FaIcon :icon="typeMeta(stop.event.type).icon" class="shrink-0 text-[0.7rem]" :style="{ color: stop.color }" />
              <span class="display min-w-0 flex-1 truncate text-[1.02rem] text-ink">{{ stop.event.title }}</span>
              <span v-if="stop.event.photos.length" class="shrink-0 text-[0.7rem] text-muted">
                <FaIcon :icon="['far', 'images']" class="mr-0.5 text-[0.65rem]" />{{ stop.event.photos.length }}
              </span>
            </span>
            <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.75rem] text-muted">
              <span v-if="stop.event.location" class="font-semibold" :style="{ color: stop.color }">
                {{ stop.event.location }}
              </span>
              <span>{{ formatDateRange(stop.event) }}</span>
              <span v-if="stop.spur" class="chip !py-0 !text-[0.65rem]">trip</span>
            </span>
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.route-stop {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  column-gap: 10px;
  align-items: stretch;
}
.route-track { position: relative; min-height: 56px; }
.route-dot {
  position: absolute;
  top: 52%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border-width: 3px;
  border-style: solid;
  background: var(--surface);
  transform: translate(-50%, -50%);
}
.route-label {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 12px 4px 12px 0;
  text-align: left;
  border-radius: 12px;
  transition: background-color 160ms var(--ease-out-soft, ease);
}
.route-label:hover { background: var(--surface-sunk); }
</style>
