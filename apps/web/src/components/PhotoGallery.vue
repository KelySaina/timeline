<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { photoUrl } from '@/api/client';
import type { EventPhoto } from '@/api/types';

const props = withDefaults(
  defineProps<{ photos: EventPhoto[]; variant?: 'card' | 'detail'; alt?: string }>(),
  { variant: 'card', alt: 'Memory photo' },
);

const lightbox = ref<number | null>(null);
const open = computed(() => lightbox.value !== null);

/** Layout follows the count: one photo gets room to breathe, four become a grid. */
const layout = computed(() => {
  const count = props.photos.length;
  if (count === 0) return 'none';
  if (count === 1) return 'single';
  if (count === 2) return 'pair';
  if (count === 3) return 'feature';
  return 'grid';
});

const visible = computed(() => props.photos.slice(0, layout.value === 'grid' ? 4 : props.photos.length));
const overflow = computed(() => Math.max(0, props.photos.length - visible.value.length));

const show = (index: number) => {
  lightbox.value = index;
};
const close = () => {
  lightbox.value = null;
};
const step = (delta: number) => {
  if (lightbox.value === null) return;
  lightbox.value = (lightbox.value + delta + props.photos.length) % props.photos.length;
};

const onKey = (event: KeyboardEvent) => {
  if (!open.value) return;
  if (event.key === 'Escape') close();
  if (event.key === 'ArrowRight') step(1);
  if (event.key === 'ArrowLeft') step(-1);
};

// Touch swipe, because a photo album is something you flick through.
let touchStart = 0;
const onTouchStart = (event: TouchEvent) => {
  touchStart = event.changedTouches[0]?.clientX ?? 0;
};
const onTouchEnd = (event: TouchEvent) => {
  const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStart;
  if (Math.abs(delta) > 48) step(delta < 0 ? 1 : -1);
};

watch(open, (isOpen) => {
  document.body.style.overflow = isOpen ? 'hidden' : '';
});
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <div v-if="layout !== 'none'">
    <!-- The container owns the height so a collage can never run away down the page. -->
    <div
      class="grid gap-1.5 overflow-hidden rounded-xl"
      :class="{
        'grid-cols-1': layout === 'single',
        'grid-cols-2': layout === 'pair',
        'grid-cols-3 grid-rows-2 aspect-[3/2]': layout === 'feature',
        'grid-cols-4': layout === 'grid',
      }"
    >
      <button
        v-for="(photo, index) in visible"
        :key="photo.id"
        class="group relative overflow-hidden bg-surface-sunk"
        :class="[
          layout === 'single'
            ? variant === 'detail'
              ? 'aspect-[4/3]'
              : 'aspect-[16/10]'
            : layout === 'feature'
              ? index === 0
                ? 'col-span-2 row-span-2 h-full'
                : 'h-full'
              : 'aspect-square',
        ]"
        @click.stop="show(index)"
      >
        <img
          :src="photoUrl(photo.id, 'thumb')"
          :alt="alt"
          loading="lazy"
          decoding="async"
          class="h-full w-full object-cover transition-transform duration-[600ms] ease-[var(--ease-out-soft)] group-hover:scale-[1.035]"
        />
        <span
          v-if="index === visible.length - 1 && overflow > 0"
          class="absolute inset-0 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_52%,transparent)] text-lg font-semibold text-white"
        >
          +{{ overflow }}
        </span>
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="open && photos[lightbox!]"
        class="animate-fade fixed inset-0 z-[70] flex flex-col bg-[color-mix(in_oklab,#0b0908_94%,transparent)]"
        @click="close"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <div class="flex items-center justify-between px-4 py-3 text-white/80">
          <span class="text-sm tabular-nums">{{ lightbox! + 1 }} / {{ photos.length }}</span>
          <button class="p-2 transition-opacity hover:opacity-70" aria-label="Close" @click.stop="close">
            <FaIcon icon="xmark" class="text-xl" />
          </button>
        </div>
        <div class="flex min-h-0 flex-1 items-center justify-center px-2 pb-6">
          <img
            :key="photos[lightbox!]!.id"
            :src="photoUrl(photos[lightbox!]!.id, 'full')"
            :alt="alt"
            class="animate-fade max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            @click.stop
          />
        </div>
        <div v-if="photos.length > 1" class="flex items-center justify-center gap-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white/80">
          <button class="p-3 transition-opacity hover:opacity-70" aria-label="Previous" @click.stop="step(-1)">
            <FaIcon icon="chevron-left" class="text-lg" />
          </button>
          <div class="flex gap-1.5">
            <span
              v-for="(photo, index) in photos"
              :key="photo.id"
              class="h-1.5 rounded-full transition-all duration-300"
              :class="index === lightbox ? 'w-5 bg-white' : 'w-1.5 bg-white/40'"
            />
          </div>
          <button class="p-3 transition-opacity hover:opacity-70" aria-label="Next" @click.stop="step(1)">
            <FaIcon icon="chevron-right" class="text-lg" />
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
