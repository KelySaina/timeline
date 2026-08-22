<script setup lang="ts">
/**
 * The album: a scrapbook page per year, uneven on purpose.
 *
 * No rail and no uniform card. Each memory's block size comes from its **weight** — how many photos
 * it carries and how much was written about it — so the day that mattered takes a quarter of the
 * page and "coffee, and she laughed" takes one quiet strip. Nobody has to grade their own memories;
 * the length of what they wrote already did it.
 *
 * Read order stays strictly left-to-right, top-to-bottom. That is not decoration — the whole
 * product rests on chronology, so the collage may vary size but never order.
 */
import { computed } from 'vue';
import { photoUrl } from '@/api/client';
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import { typeMeta } from '@/lib/eventTypes';
import { formatDateRange } from '@/lib/format';

const props = defineProps<{ groups: YearGroup[] }>();
defineEmits<{ open: [TimelineEvent] }>();

type Block = {
  event: TimelineEvent;
  /** 'hero' spans the full width and leads with the photo; 'wide' takes two columns; 'quiet' one. */
  size: 'hero' | 'wide' | 'quiet';
  color: string;
};

const WEIGHTY_TYPES = new Set(['milestone', 'life']);

function weigh(event: TimelineEvent): number {
  const photos = Math.min(3, event.photos.length);
  const written = (event.description ?? '').trim().length;
  const words = written > 400 ? 2 : written > 120 ? 1 : 0;
  return photos + words + (WEIGHTY_TYPES.has(event.type) ? 1 : 0);
}

const pages = computed(() =>
  props.groups.map((group) => {
    const blocks = group.events.map<Block>((event) => {
      const weight = weigh(event);
      return {
        event,
        size: weight >= 4 ? 'hero' : weight >= 2 ? 'wide' : 'quiet',
        color: typeMeta(event.type).color,
      };
    });

    // A year holding one or two memories must not render as a lonely box in a field of white.
    if (blocks.length <= 2) for (const block of blocks) block.size = 'hero';

    /**
     * Close the gaps a half-width block leaves when it has no half-width neighbour to pair with.
     * `grid-auto-flow: dense` would do this for free and is the wrong tool: it backfills holes with
     * whatever fits, which silently reorders the page. Chronology is the product, so the fix has to
     * happen in the sizing rather than in the packing — a lone 'quiet' is simply promoted to 'wide'
     * and fills its row.
     */
    for (let i = 0; i < blocks.length; i += 1) {
      if (blocks[i]!.size !== 'quiet') continue;
      let run = 0;
      while (blocks[i + run]?.size === 'quiet') run += 1;
      // Pairs tile perfectly; an odd tail would leave the hole, so widen it.
      if (run % 2 === 1) blocks[i + run - 1]!.size = 'wide';
      i += run - 1;
    }

    return { year: group.year, blocks };
  }),
);

const cover = (event: TimelineEvent) => (event.photos.length ? photoUrl(event.photos[0]!.id, 'thumb') : null);
</script>

<template>
  <div>
    <section v-for="page in pages" :key="page.year" class="album-page">
      <!-- The year as a plate number, set big and faint behind the top of the page. -->
      <div class="sticky top-14 z-20 -mx-4 mb-3 flex items-baseline gap-3 bg-paper/90 px-4 py-2.5 backdrop-blur-sm">
        <h2 class="display text-[2rem] tabular-nums leading-none sm:text-[2.5rem]">{{ page.year }}</h2>
        <span class="h-px flex-1 bg-line" />
        <span class="text-[0.75rem] text-muted">{{ page.blocks.length }}</span>
      </div>

      <div class="album-grid">
        <button
          v-for="block in page.blocks"
          :key="block.event.id"
          class="reveal album-block card group text-left"
          :class="`album-block--${block.size}`"
          @click="$emit('open', block.event)"
        >
          <span
            v-if="cover(block.event)"
            class="album-photo"
            :style="{ backgroundImage: `url(${cover(block.event)})` }"
            role="img"
            :aria-label="block.event.title"
          />
          <span
            v-else
            class="album-edge"
            :style="{ background: `color-mix(in oklab, ${block.color} 60%, transparent)` }"
            aria-hidden="true"
          />

          <span class="album-text">
            <span class="flex items-center gap-1.5 text-[0.7rem]" :style="{ color: block.color }">
              <FaIcon :icon="typeMeta(block.event.type).icon" class="text-[0.6rem]" />
              <span class="truncate font-semibold uppercase tracking-[0.08em]">{{ typeMeta(block.event.type).label }}</span>
            </span>
            <span class="display mt-0.5 block text-[1.02rem] leading-snug text-ink album-title">
              {{ block.event.title }}
            </span>
            <span class="mt-0.5 block text-[0.7rem] text-muted">{{ formatDateRange(block.event) }}</span>
            <span
              v-if="block.size === 'hero' && block.event.description"
              class="album-excerpt mt-1.5 block text-[0.875rem] text-ink-soft"
            >
              {{ block.event.description }}
            </span>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.album-page { margin-bottom: 28px; }

/*
  Two columns on a phone, four from the small breakpoint. The spans below are written against a
  4-column track and clamped to 2 on narrow screens, so a 'hero' is always the full page width and
  never a lopsided 3-of-2.
*/
.album-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  /*
    Not stretch. A text-only block beside a photo would grow to match it and carry a third of a card
    in empty white; a scrapbook page has ragged rows, not padded ones. Each block keeps its own
    height and the slack falls between rows where it belongs.
  */
  align-items: start;
}
@media (min-width: 640px) {
  .album-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
}

.album-block {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  cursor: pointer;
  transition: transform 300ms var(--ease-out-soft, ease), box-shadow 300ms var(--ease-out-soft, ease);
}
.album-block:hover { transform: translateY(-2px); box-shadow: var(--shadow-float); }

/*
  On a phone there are only two columns, so a 'wide' spanning two of them is a full-width card and
  the collage collapses back into a feed. Below the breakpoint only a hero goes full width; 'wide'
  earns its extra column once there are four to spend.
*/
.album-block--quiet { grid-column: span 1; }
.album-block--wide  { grid-column: span 1; }
.album-block--hero  { grid-column: 1 / -1; }
@media (min-width: 640px) {
  .album-block--wide { grid-column: span 2; }
}

.album-photo {
  display: grid;
  place-items: center;
  width: 100%;
  background-size: cover;
  background-position: center;
  /* Half-width blocks are small enough to take a squarer crop. */
  aspect-ratio: 4 / 3;
  font-size: 1.1rem;
}
/*
  A full-width block gets a letterbox instead. At 4/3 a full-width photo is ~265px tall and one
  memory owns the whole screen, which is the feed again.
*/
.album-block--hero .album-photo { aspect-ratio: 16 / 9; }
@media (min-width: 640px) {
  .album-block--wide .album-photo { aspect-ratio: 3 / 2; }
}
/* A memory with no picture gets an edge, not an empty frame pretending to be one. */
.album-edge { display: block; width: 100%; height: 3px; }

.album-text { display: block; padding: 10px 12px 12px; min-width: 0; }
/* Text-led blocks need more room to breathe than captioned photos do. */
.album-block:has(.album-edge) .album-text { padding-top: 12px; }

/* Two lines of title in a small block, three in a hero — so blocks in a row stay comparable. */
.album-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.album-block--hero .album-title { -webkit-line-clamp: 3; font-size: 1.25rem; }

.album-excerpt {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
