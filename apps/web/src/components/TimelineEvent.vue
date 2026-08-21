<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineEvent } from '@/api/types';
import { typeMeta } from '@/lib/eventTypes';
import MemoryCard from './MemoryCard.vue';

const props = defineProps<{ event: TimelineEvent; last?: boolean }>();
defineEmits<{ open: [] }>();

const meta = computed(() => typeMeta(props.event.type));
</script>

<template>
  <li class="reveal relative pb-5 pl-7 sm:pl-10" :class="last && 'pb-0'">
    <!-- The node on the thread: colour carries the event type without a single label. -->
    <span
      class="absolute left-0 top-6 flex h-[26px] w-[26px] -translate-x-1/2 items-center justify-center rounded-full border bg-surface"
      :style="{
        borderColor: `color-mix(in oklab, ${meta.color} 38%, transparent)`,
        color: meta.color,
        boxShadow: `0 0 0 5px var(--paper)`,
      }"
    >
      <FaIcon :icon="meta.icon" class="text-[0.65rem]" />
    </span>
    <MemoryCard :event="event" @open="$emit('open')" />
  </li>
</template>
