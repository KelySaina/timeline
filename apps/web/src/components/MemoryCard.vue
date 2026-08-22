<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineEvent } from '@/api/types';
import { MOOD_META, typeMeta } from '@/lib/eventTypes';
import { formatDateRange } from '@/lib/format';
import DateBadge from './DateBadge.vue';
import PhotoGallery from './PhotoGallery.vue';

const props = withDefaults(defineProps<{ event: TimelineEvent; compact?: boolean }>(), { compact: false });
defineEmits<{ open: [] }>();

const meta = computed(() => typeMeta(props.event.type));
const dateLabel = computed(() => formatDateRange(props.event));
const mood = computed(() => (props.event.mood ? MOOD_META[props.event.mood] : null));
const excerpt = computed(() => props.event.description?.replace(/\s+/g, ' ').trim() ?? '');
</script>

<template>
  <article
    class="card group cursor-pointer overflow-hidden transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"
    @click="$emit('open')"
  >
    <div class="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
      <DateBadge :date="event.eventDate" :precision="event.datePrecision" />
      <div class="min-w-0 flex-1">
        <!--
          Wraps as a unit: in a narrow column (the heartline's gutter costs ~50px) an unwrapped row
          broke the date mid-string and left the separator orphaned on a line of its own.
        -->
        <div class="flex flex-wrap items-center gap-x-2">
          <FaIcon :icon="meta.icon" class="shrink-0 text-[0.7rem]" :style="{ color: meta.color }" />
          <span class="eyebrow" :style="{ color: meta.color }">{{ meta.label }}</span>
          <span class="whitespace-nowrap text-[0.7rem] text-muted">{{ dateLabel }}</span>
        </div>
        <h3 class="display mt-1 text-[1.2rem] leading-snug text-ink sm:text-[1.32rem]">
          {{ event.title }}
        </h3>
      </div>
      <span v-if="mood" class="text-lg leading-none" :title="mood.label">{{ mood.emoji }}</span>
    </div>

    <p
      v-if="excerpt && !compact"
      class="mt-2 line-clamp-3 px-4 text-[0.9375rem] text-ink-soft sm:px-5"
    >
      {{ excerpt }}
    </p>

    <div v-if="event.photos.length" class="mt-3 px-2 sm:px-3">
      <PhotoGallery :photos="event.photos" :alt="event.title" />
    </div>

    <footer class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 text-[0.75rem] text-muted sm:px-5">
      <span v-if="event.location" class="inline-flex items-center gap-1">
        <FaIcon icon="location-dot" class="text-[0.65rem]" />{{ event.location }}
      </span>
      <span v-for="tag in event.tags.slice(0, 3)" :key="tag" class="inline-flex items-center gap-1">
        <FaIcon icon="tag" class="text-[0.6rem] opacity-60" />{{ tag }}
      </span>
      <span v-if="event.photos.length > 1" class="inline-flex items-center gap-1">
        <FaIcon :icon="['far', 'images']" class="text-[0.65rem]" />{{ event.photos.length }}
      </span>
      <span class="ml-auto inline-flex items-center gap-1 opacity-80">
        {{ event.author.displayName }}
      </span>
    </footer>
  </article>
</template>
