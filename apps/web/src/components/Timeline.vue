<script setup lang="ts">
import { ref } from 'vue';
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import { useInfiniteScroll } from '@/composables/useInfiniteScroll';
import { useScrollReveal } from '@/composables/useScrollReveal';
import TimelineEventRow from './TimelineEvent.vue';

const props = defineProps<{
  groups: YearGroup[];
  hasMore?: boolean;
  loadingMore?: boolean;
}>();
const emit = defineEmits<{ open: [TimelineEvent]; reachEnd: [] }>();

const root = ref<HTMLElement | null>(null);
useScrollReveal(root);
const { sentinel } = useInfiniteScroll(() => {
  if (props.hasMore) emit('reachEnd');
});

const countLabel = (group: YearGroup) =>
  `${group.events.length} ${group.events.length === 1 ? 'memory' : 'memories'}`;
</script>

<template>
  <div ref="root">
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
          @open="emit('open', event)"
        />
      </ol>
    </section>

    <div ref="sentinel" class="h-4" />
    <div v-if="loadingMore" class="flex justify-center py-6 text-muted">
      <FaIcon icon="circle-notch" class="animate-spin" />
    </div>
    <p v-else-if="!hasMore && groups.length" class="py-8 text-center text-[0.8125rem] text-muted">
      <FaIcon icon="heart" class="mr-1.5 text-[var(--ember)] opacity-70" />
      That's the whole story — so far.
    </p>
  </div>
</template>
