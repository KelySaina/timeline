<script setup lang="ts">
/**
 * Chooses how the story is drawn, and owns everything the shape does not change: the scroll reveal,
 * the infinite-scroll sentinel, and the end-of-story line. Each layout under stories/ therefore only
 * has to render years and memories — it never handles paging, and swapping layouts cannot break it.
 *
 * The layout belongs to the couple, like the theme, so it arrives over the change stream: one
 * partner picking The Album repaints the other's story without a refresh.
 */
import { computed, ref } from 'vue';
import type { TimelineEvent } from '@/api/types';
import type { YearGroup } from '@/stores/timeline';
import { useInfiniteScroll } from '@/composables/useInfiniteScroll';
import { useScrollReveal } from '@/composables/useScrollReveal';
import { useAuthStore } from '@/stores/auth';
import { storyLayoutMeta } from '@/lib/storyLayouts';
import StoryAlbum from './stories/StoryAlbum.vue';
import StoryHeartline from './stories/StoryHeartline.vue';
import StoryRail from './stories/StoryRail.vue';
import StoryReel from './stories/StoryReel.vue';
import StoryRoad from './stories/StoryRoad.vue';
import StoryRoute from './stories/StoryRoute.vue';

const props = defineProps<{
  groups: YearGroup[];
  hasMore?: boolean;
  loadingMore?: boolean;
}>();
const emit = defineEmits<{ open: [TimelineEvent]; reachEnd: [] }>();

const auth = useAuthStore();
const layout = computed(() => storyLayoutMeta(auth.couple?.storyLayout).id);

const root = ref<HTMLElement | null>(null);
useScrollReveal(root);
const { sentinel } = useInfiniteScroll(() => {
  if (props.hasMore) emit('reachEnd');
});
</script>

<template>
  <div ref="root">
    <StoryRail v-if="layout === 'rail'" :groups="groups" @open="emit('open', $event)" />
    <StoryRoad v-else-if="layout === 'road'" :groups="groups" @open="emit('open', $event)" />
    <StoryHeartline v-else-if="layout === 'heartline'" :groups="groups" @open="emit('open', $event)" />
    <StoryRoute v-else-if="layout === 'route'" :groups="groups" @open="emit('open', $event)" />
    <StoryAlbum v-else-if="layout === 'album'" :groups="groups" @open="emit('open', $event)" />
    <StoryReel v-else-if="layout === 'reel'" :groups="groups" @open="emit('open', $event)" />
    <StoryRail v-else :groups="groups" @open="emit('open', $event)" />

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
