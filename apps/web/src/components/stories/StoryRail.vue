<script setup lang="ts">
/**
 * The rail: the original layout, and still the default.
 *
 * A straight thread with a node per memory and every card the same width. It carries order and
 * nothing else, which is exactly why it is the safe one — it never flatters a memory or flattens
 * one, and it reads identically whether a couple has logged four memories or four hundred.
 */
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import TimelineEventRow from '../TimelineEvent.vue';

defineProps<{ groups: YearGroup[] }>();
defineEmits<{ open: [TimelineEvent] }>();

const countLabel = (group: YearGroup) =>
  `${group.events.length} ${group.events.length === 1 ? 'memory' : 'memories'}`;
</script>

<template>
  <div>
    <section v-for="group in groups" :key="group.year" class="mb-2">
      <!-- Sticky year: the reader always knows where in the story they are. -->
      <div class="sticky top-14 z-20 -mx-4 mb-1 flex items-center gap-3 bg-paper/90 px-4 py-2.5 backdrop-blur-sm">
        <h2 class="display text-[1.75rem] tabular-nums leading-none sm:text-[2rem]">{{ group.year }}</h2>
        <span class="h-px flex-1 bg-line" />
        <span class="text-[0.75rem] text-muted">{{ countLabel(group) }}</span>
      </div>

      <ol class="relative ml-[13px]">
        <span class="rail" />
        <TimelineEventRow
          v-for="(event, index) in group.events"
          :key="event.id"
          :event="event"
          :last="index === group.events.length - 1"
          @open="$emit('open', event)"
        />
      </ol>
    </section>
  </div>
</template>
