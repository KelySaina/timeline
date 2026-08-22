<script setup lang="ts">
/**
 * The heartline: one unbroken line down the page that kicks sideways at every memory.
 *
 * Unlike the road, this one wants a *vertical* line — a cardiogram is mostly flat with sharp blips,
 * and the reading of it comes from the rhythm of those blips down the page. Drawing it as a
 * horizontal band between cards (which is what makes the road work) turns each beat into a shallow
 * diagonal that reads as a step, so this layout keeps a narrow left gutter instead: an EKG needs
 * very little amplitude to be legible, which is exactly why the gutter that ruins a road is fine
 * here.
 *
 * Each memory owns one segment, a full-height SVG stretched with preserveAspectRatio="none" that
 * enters and leaves at the same x. The line therefore stays continuous whatever height a card turns
 * out to be — no measuring, nothing to tear on reflow.
 */
import { computed } from 'vue';
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import { MOOD_META, typeMeta } from '@/lib/eventTypes';
import { feltWeight } from '@/lib/storyWeight';
import MemoryCard from '../MemoryCard.vue';

const props = defineProps<{ groups: YearGroup[] }>();
defineEmits<{ open: [TimelineEvent] }>();

const beats = computed(() =>
  props.groups.flatMap((group) =>
    group.events.map((event, index) => {
      const reach = feltWeight(event);
      return {
        event,
        year: index === 0 ? group.year : null,
        reach,
        // Kick right for a heavier memory, left for a lighter one, so the line reads as a pulse
        // rather than a staircase.
        out: 50 + (reach > 0.62 ? 1 : -1) * reach * 40,
        color: typeMeta(event.type).color,
        mood: event.mood ? MOOD_META[event.mood] : null,
      };
    }),
  ),
);

/** Flat, blip, flat — the blip's sharpness rising with the weight. */
const path = (out: number) => `M50 0 L50 34 L${out} 44 L${out} 56 L50 66 L50 100`;
</script>

<template>
  <ol>
    <li v-for="beat in beats" :key="beat.event.id" class="beat-row">
      <div v-if="beat.year" class="beat-year">
        <h2 class="display text-[1.6rem] tabular-nums leading-none sm:text-[1.9rem]">{{ beat.year }}</h2>
        <span class="h-px flex-1 bg-line" />
      </div>

      <div class="beat-gutter" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            :d="path(beat.out)"
            fill="none"
            stroke="var(--line-strong)"
            stroke-width="5"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            :d="path(beat.out)"
            fill="none"
            :stroke="beat.color"
            stroke-width="2.5"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span
          class="beat-node"
          :style="{
            left: `${beat.out}%`,
            borderColor: `color-mix(in oklab, ${beat.color} 45%, transparent)`,
            color: beat.color,
          }"
        >
          <FaIcon :icon="typeMeta(beat.event.type).icon" class="text-[0.55rem]" />
        </span>
      </div>

      <div class="reveal beat-card">
        <MemoryCard :event="beat.event" @open="$emit('open', beat.event)" />
        <p v-if="beat.mood" class="mt-1.5 pl-1 text-[0.7rem] text-muted">
          {{ beat.mood.emoji }} {{ beat.mood.label }}
        </p>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.beat-row {
  display: grid;
  /* A blip needs very little room, and every pixel here is taken from the card beside it. */
  grid-template-columns: 34px minmax(0, 1fr);
  column-gap: 6px;
  /*
    No padding on the row. The gutter SVG only paints the row's content box, so any row padding
    becomes a visible gap in a line that is supposed to be unbroken — the spacing lives on the card
    column instead, where it costs nothing.
  */
}

.beat-year {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 8px;
}

.beat-gutter { position: relative; grid-column: 1; min-height: 88px; }
.beat-gutter svg { display: block; width: 100%; height: 100%; }
.beat-card { grid-column: 2; min-width: 0; padding-bottom: 18px; }
.beat-row:last-child .beat-card { padding-bottom: 0; }

.beat-node {
  position: absolute;
  top: 50%;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  border-width: 1px;
  border-style: solid;
  background: var(--surface);
  box-shadow: 0 0 0 4px var(--paper);
  transform: translate(-50%, -50%);
}

@media (min-width: 640px) {
  .beat-row { grid-template-columns: 64px minmax(0, 1fr); column-gap: 12px; }
}
@media (min-width: 400px) {
  .beat-row { grid-template-columns: 46px minmax(0, 1fr); column-gap: 8px; }
}
</style>
