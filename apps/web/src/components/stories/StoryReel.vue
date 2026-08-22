<script setup lang="ts">
/**
 * The reel: two axes. Scrolling down moves between years, swiping sideways moves through the
 * memories inside one. Photos get to be the point rather than a thumbnail strip.
 *
 * The honest cost, stated in the picker too: horizontal scroll hides content. Anything past the
 * right edge is invisible to a reader who does not think to swipe, and "read it from the beginning"
 * becomes a swipe per year instead of one long scroll. Two things make that survivable — a count
 * per band so you know how much is off-screen, and scroll-snap so the swipe lands cleanly.
 */
import { ref } from 'vue';
import { photoUrl } from '@/api/client';
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import { typeMeta } from '@/lib/eventTypes';
import { formatDateRange } from '@/lib/format';

defineProps<{ groups: YearGroup[] }>();
defineEmits<{ open: [TimelineEvent] }>();

const bands = ref<Record<number, HTMLElement | null>>({});

/** Keyboard and mouse users get buttons; the swipe is for thumbs. */
function nudge(year: number, direction: 1 | -1): void {
  const band = bands.value[year];
  if (!band) return;
  band.scrollBy({ left: direction * band.clientWidth * 0.8, behavior: 'smooth' });
}

const cover = (event: TimelineEvent) => (event.photos.length ? photoUrl(event.photos[0]!.id, 'thumb') : null);
</script>

<template>
  <div>
    <section v-for="group in groups" :key="group.year" class="mb-7">
      <div class="mb-2.5 flex items-center gap-3">
        <h2 class="display text-[1.6rem] tabular-nums leading-none sm:text-[1.9rem]">{{ group.year }}</h2>
        <span class="text-[0.75rem] text-muted">
          {{ group.events.length }} {{ group.events.length === 1 ? 'memory' : 'memories' }}
        </span>
        <span class="h-px flex-1 bg-line" />
        <span class="hidden gap-1 sm:flex">
          <button class="btn btn-quiet h-7 w-7 rounded-full p-0" :aria-label="`Earlier in ${group.year}`" @click="nudge(group.year, -1)">
            <FaIcon icon="chevron-left" class="text-[0.7rem]" />
          </button>
          <button class="btn btn-quiet h-7 w-7 rounded-full p-0" :aria-label="`Later in ${group.year}`" @click="nudge(group.year, 1)">
            <FaIcon icon="chevron-right" class="text-[0.7rem]" />
          </button>
        </span>
      </div>

      <!-- Bleeds to the screen edge so a half-visible next card advertises the swipe. -->
      <div
        :ref="(el) => (bands[group.year] = el as HTMLElement | null)"
        class="reel-band -mx-4 px-4"
      >
        <button
          v-for="event in group.events"
          :key="event.id"
          class="reveal reel-card card text-left"
          @click="$emit('open', event)"
        >
          <span
            v-if="cover(event)"
            class="reel-photo"
            :style="{ backgroundImage: `url(${cover(event)})` }"
            role="img"
            :aria-label="event.title"
          />
          <span
            v-else
            class="reel-photo reel-photo--empty"
            :style="{ background: `color-mix(in oklab, ${typeMeta(event.type).color} 12%, var(--surface-sunk))` }"
            aria-hidden="true"
          >
            <FaIcon :icon="typeMeta(event.type).icon" class="text-2xl" :style="{ color: typeMeta(event.type).color }" />
          </span>

          <span class="block min-w-0 px-3.5 pb-3.5 pt-2.5">
            <span class="flex items-center gap-1.5 text-[0.7rem]" :style="{ color: typeMeta(event.type).color }">
              <FaIcon :icon="typeMeta(event.type).icon" class="text-[0.6rem]" />
              <span class="truncate font-semibold uppercase tracking-[0.08em]">{{ typeMeta(event.type).label }}</span>
            </span>
            <span class="display mt-1 block text-[1.15rem] leading-snug text-ink reel-title">{{ event.title }}</span>
            <span class="mt-1 block text-[0.75rem] text-muted">{{ formatDateRange(event) }}</span>
            <span v-if="event.location" class="mt-0.5 block truncate text-[0.75rem] text-muted">
              <FaIcon icon="location-dot" class="mr-1 text-[0.65rem]" />{{ event.location }}
            </span>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.reel-band {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
  padding-bottom: 6px;
  scrollbar-width: none;
}
.reel-band::-webkit-scrollbar { display: none; }

.reel-card {
  flex: 0 0 auto;
  /* A sliver of the next card stays visible, which is the only hint that a swipe exists. */
  width: 78%;
  max-width: 300px;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  scroll-snap-align: start;
  cursor: pointer;
  transition: transform 300ms var(--ease-out-soft, ease), box-shadow 300ms var(--ease-out-soft, ease);
}
@media (min-width: 640px) { .reel-card { width: 268px; } }
.reel-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-float); }

.reel-photo {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  background-size: cover;
  background-position: center;
}
.reel-photo--empty { aspect-ratio: 2 / 1; }

.reel-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
