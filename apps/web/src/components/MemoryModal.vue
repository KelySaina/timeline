<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TimelineEvent } from '@/api/types';
import { MOOD_META, typeMeta } from '@/lib/eventTypes';
import { formatDateRange, isFuture, relativeTime } from '@/lib/format';
import { useTimelineStore } from '@/stores/timeline';
import { useToastStore } from '@/stores/toast';
import AppButton from './ui/AppButton.vue';
import AppSheet from './ui/AppSheet.vue';
import PhotoGallery from './PhotoGallery.vue';

const props = defineProps<{ event: TimelineEvent | null }>();
const emit = defineEmits<{ close: []; edit: [TimelineEvent] }>();

const timeline = useTimelineStore();
const toasts = useToastStore();
const confirming = ref(false);
const working = ref(false);

const meta = computed(() => (props.event ? typeMeta(props.event.type) : null));
const mood = computed(() => (props.event?.mood ? MOOD_META[props.event.mood] : null));
const edited = computed(
  () => props.event && props.event.updatedAt !== props.event.createdAt,
);

async function remove(): Promise<void> {
  if (!props.event) return;
  working.value = true;
  try {
    await timeline.remove(props.event.id);
    toasts.push('Memory removed');
    emit('close');
  } catch {
    toasts.error('That did not delete');
  } finally {
    working.value = false;
    confirming.value = false;
  }
}
</script>

<template>
  <AppSheet :open="Boolean(event)" size="full" @close="emit('close')">
    <template #header>
      <div v-if="event && meta" class="min-w-0">
        <div class="flex items-center gap-2">
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full text-[0.65rem]"
            :style="{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }"
          >
            <FaIcon :icon="meta.icon" />
          </span>
          <span class="eyebrow" :style="{ color: meta.color }">{{ meta.label }}</span>
          <span v-if="isFuture(event.eventDate)" class="chip cursor-default px-2 py-0.5 text-[0.7rem]">
            <FaIcon icon="clock" class="text-[0.6rem]" />Upcoming
          </span>
        </div>
        <h2 class="display mt-1.5 text-[1.6rem] leading-tight sm:text-[2rem]">{{ event.title }}</h2>
        <p class="mt-1 text-[0.9rem] text-muted">
          {{ formatDateRange(event) }}
          <template v-if="event.location">
            · <FaIcon icon="location-dot" class="text-[0.7rem]" /> {{ event.location }}
          </template>
        </p>
      </div>
    </template>

    <div v-if="event" class="space-y-6">
      <PhotoGallery v-if="event.photos.length" :photos="event.photos" variant="detail" :alt="event.title" />

      <blockquote v-if="event.description" class="relative pl-6">
        <FaIcon icon="quote-left" class="absolute left-0 top-1 text-[0.85rem] text-[var(--ember)] opacity-45" />
        <p class="prose-story text-[1.02rem]">{{ event.description }}</p>
      </blockquote>

      <div v-if="event.tags.length || mood" class="flex flex-wrap items-center gap-1.5">
        <span v-if="mood" class="chip cursor-default">{{ mood.emoji }} {{ mood.label }}</span>
        <span v-for="tag in event.tags" :key="tag" class="chip cursor-default">
          <FaIcon icon="tag" class="text-[0.6rem] opacity-60" />{{ tag }}
        </span>
      </div>

      <footer class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-4 text-[0.8125rem] text-muted">
        <span>Added by <strong class="font-semibold text-ink">{{ event.author.displayName }}</strong></span>
        <span>· {{ relativeTime(event.createdAt) }}</span>
        <span v-if="edited">· edited {{ relativeTime(event.updatedAt) }}</span>
      </footer>
    </div>

    <template #footer>
      <div v-if="confirming" class="flex items-center gap-3">
        <p class="flex-1 text-[0.875rem]">Remove this memory from your story?</p>
        <AppButton variant="quiet" @click="confirming = false">Keep it</AppButton>
        <AppButton variant="primary" :loading="working" icon="trash-can" @click="remove">Remove</AppButton>
      </div>
      <div v-else class="flex items-center gap-2">
        <AppButton variant="quiet" icon="trash-can" @click="confirming = true" />
        <span class="flex-1" />
        <AppButton variant="ghost" icon="pen" @click="event && emit('edit', event)">Edit</AppButton>
        <AppButton variant="primary" @click="emit('close')">Close</AppButton>
      </div>
    </template>
  </AppSheet>
</template>
