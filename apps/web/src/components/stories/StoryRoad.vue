<script setup lang="ts">
/**
 * The winding road: asphalt with a dashed centre line, sweeping between the memories.
 *
 * The obvious build — a curve in a side gutter with cards alongside — fails on a phone. A 390px
 * screen can spare about 30px of gutter, and 30px of curve is a straight line with a kink in it:
 * the road ends up reading as a worse rail exactly where most of the reading happens.
 *
 * So the road lives in a full-width band *between* the cards instead. It sweeps across the whole
 * screen from one side to the other in the gap under each memory, which reads unmistakably as a
 * path at any width and steals no horizontal room from the card. Each band is its own SVG stretched
 * with preserveAspectRatio="none", entering where the previous one left — so the line stays
 * continuous no matter what height a card turns out to be, with no measuring and nothing to tear on
 * reflow.
 *
 * How far it swings comes from the gap between one memory and the next, so a busy month draws
 * switchbacks and a quiet year draws one long sweep. (The heartline wanted the opposite structure —
 * a vertical line with lateral blips — and lives in its own component.)
 */
import { computed } from 'vue';
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import { typeMeta } from '@/lib/eventTypes';
import { paceWeight } from '@/lib/storyWeight';
import MemoryCard from '../MemoryCard.vue';

const props = defineProps<{ groups: YearGroup[] }>();
defineEmits<{ open: [TimelineEvent] }>();

type Step = {
  event: TimelineEvent;
  year: number | null;
  /** Where the line sits when it leaves this memory: 0 = hard left, 1 = hard right. */
  from: number;
  to: number;
  /** 0.28–1, how emphatic this step is. Drives the beat height and the card's inset. */
  reach: number;
  color: string;
  last: boolean;
};

const steps = computed<Step[]>(() => {
  const flat = props.groups.flatMap((group) =>
    group.events.map((event, index) => ({ event, year: index === 0 ? group.year : null })),
  );

  return flat.map(({ event, year }, index) => {
    const reach = paceWeight(event, flat[index + 1]?.event ?? flat[index - 1]?.event);

    // Alternate which side the line rests on, pushed out by this step's reach.
    const rest = (i: number, r: number) => (i % 2 === 0 ? 0.5 + r * 0.34 : 0.5 - r * 0.34);
    return {
      event,
      year,
      from: rest(index, reach),
      to: rest(index + 1, reach),
      reach,
      color: typeMeta(event.type).color,
      last: index === flat.length - 1,
    };
  });
});

/** The band path, in a 0–100 box stretched to the band's real width and height. */
function band(step: Step): string {
  const a = step.from * 100;
  const b = step.to * 100;
  return `M${a} 0 C ${a} 42, ${b} 58, ${b} 100`;
}
</script>

<template>
  <ol>
    <li v-for="step in steps" :key="step.event.id">
      <!-- Year turns over on the line itself rather than above it. -->
      <div v-if="step.year" class="mb-1 flex items-center gap-3 pt-1">
        <h2 class="display text-[1.6rem] tabular-nums leading-none sm:text-[1.9rem]">{{ step.year }}</h2>
        <span class="h-px flex-1 bg-line" />
      </div>

      <div class="reveal thread-card" :style="{ '--reach': step.reach }">
        <MemoryCard :event="step.event" @open="$emit('open', step.event)" />
      </div>

      <!-- The band. Skipped after the final memory: a road to nowhere reads as a bug. -->
      <div v-if="!step.last" class="thread-band" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <!-- the surface -->
          <path
            :d="band(step)"
            fill="none"
            stroke="var(--line-strong)"
            stroke-width="9"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <!-- the memory's own colour, laid over it -->
          <path
            :d="band(step)"
            fill="none"
            :stroke="step.color"
            stroke-width="5"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.55"
          />
          <!-- road markings: the one detail that makes it a road rather than a curve -->
          <path
            :d="band(step)"
            fill="none"
            stroke="var(--paper)"
            stroke-width="1.5"
            stroke-dasharray="7 9"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            opacity="0.85"
          />
        </svg>

        <span
          class="thread-node"
          :style="{
            left: `${step.to * 100}%`,
            borderColor: `color-mix(in oklab, ${step.color} 45%, transparent)`,
            color: step.color,
          }"
        >
          <FaIcon :icon="typeMeta(step.event.type).icon" class="text-[0.58rem]" />
        </span>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.thread-band {
  position: relative;
  width: 100%;
  /* Tall enough for the sweep to read as a path, short enough not to pad out the story. */
  height: 58px;
}
.thread-band svg { display: block; width: 100%; height: 100%; }

.thread-node {
  position: absolute;
  bottom: -12px;
  display: grid;
  place-items: center;
  width: 23px;
  height: 23px;
  border-radius: 50%;
  border-width: 1px;
  border-style: solid;
  background: var(--surface);
  box-shadow: 0 0 0 4px var(--paper);
  transform: translateX(-50%);
  z-index: 1;
}

/*
  Cards keep the full width on a phone. From the small breakpoint they narrow and lean toward the
  side the line rests on, so the road visibly runs from one card to the next instead of just
  passing under them.
*/
.thread-card { min-width: 0; }
@media (min-width: 640px) {
  .thread-card {
    width: calc(100% - (var(--reach, 0.5) * 14%));
  }
  li:nth-child(even) .thread-card { margin-left: auto; }
}
</style>
