<script setup lang="ts">
/**
 * The gallery: twenty-seven themes as one continuous wall of live previews.
 *
 * It used to be a sheet containing a hero, a chip row and eight labelled sections — a scroll inside
 * a scroll, where choosing meant reading. A gallery is the right shape for this: every tile paints
 * itself in its own theme, so the browsing is done with the eyes and the collection becomes a
 * filter rather than a chapter heading. The tile is the pitch; the words underneath are a caption.
 */
import { computed, ref } from 'vue';
import type { Theme } from '@/api/types';
import { COLLECTIONS, THEMES, themeMeta, type CollectionId, type ThemeMeta } from '@/lib/themes';
import ThemeAtmosphere from './ThemeAtmosphere.vue';

const props = defineProps<{ modelValue: Theme; busy?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [Theme] }>();

const filter = ref<CollectionId | 'all'>('all');
const current = computed(() => themeMeta(props.modelValue));

/** One flat wall, in collection order, so filtering narrows rather than restructures. */
const shown = computed(() =>
  filter.value === 'all' ? THEMES : THEMES.filter((theme) => theme.collection === filter.value),
);

const collectionOf = (theme: ThemeMeta) =>
  COLLECTIONS.find((collection) => collection.id === theme.collection);

const pick = (theme: ThemeMeta) => {
  if (theme.id !== props.modelValue) emit('update:modelValue', theme.id);
};
</script>

<template>
  <div>
    <!-- Filter row. Sideways on a phone rather than four rows of chips stealing the gallery. -->
    <div
      class="sticky top-14 z-20 -mx-4 mb-4 flex gap-1.5 overflow-x-auto bg-paper/90 px-4 py-2.5 backdrop-blur-sm [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      <button class="chip shrink-0" :class="filter === 'all' && 'is-active'" @click="filter = 'all'">
        Everything
        <span class="opacity-60">{{ THEMES.length }}</span>
      </button>
      <button
        v-for="collection in COLLECTIONS"
        :key="collection.id"
        class="chip shrink-0"
        :class="filter === collection.id && 'is-active'"
        @click="filter = collection.id"
      >
        {{ collection.label }}
      </button>
    </div>

    <p v-if="filter !== 'all'" class="mb-3 text-[0.8125rem] text-muted">
      {{ COLLECTIONS.find((c) => c.id === filter)?.tagline }}
    </p>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <button
        v-for="theme in shown"
        :key="theme.id"
        class="theme-tile lift group relative overflow-hidden rounded-[20px] border text-left transition active:scale-[0.98]"
        :class="[
          `theme-${theme.id}`,
          modelValue === theme.id
            ? 'is-active border-transparent shadow-[var(--shadow-card)] ring-2 ring-[var(--ember)]'
            : 'border-line hover:border-line-strong',
        ]"
        :aria-pressed="modelValue === theme.id"
        :aria-label="`${theme.label} — ${theme.blurb}`"
        :disabled="busy"
        @click="pick(theme)"
      >
        <!-- A miniature of the app, painted entirely by the theme's own variables. Taller than the
             old tile so the motif and the glow get room to actually read as themselves. -->
        <span class="relative block bg-[var(--paper)] px-3 pb-2.5 pt-3">
          <ThemeAtmosphere />

          <span class="relative block space-y-1.5">
            <!-- a year heading and its rail, the two things the story always shows -->
            <span class="flex items-center gap-1.5">
              <span class="h-2 w-6 rounded-full" style="background: var(--ink); opacity: 0.55" />
              <span class="h-px flex-1" style="background: var(--line-strong)" />
            </span>

            <span
              class="flex items-center gap-1.5 rounded-xl border px-2 py-1.5"
              style="background: var(--surface); border-color: var(--line); box-shadow: var(--shadow-card)"
            >
              <span class="h-3.5 w-3.5 shrink-0 rounded-full" style="background: var(--ember)" />
              <span class="min-w-0 flex-1 space-y-1">
                <span class="block h-1.5 w-full rounded-full" style="background: var(--ink-soft); opacity: 0.55" />
                <span class="block h-1.5 w-2/3 rounded-full" style="background: var(--ember-soft)" />
              </span>
            </span>

            <span
              class="flex items-center gap-1.5 rounded-xl border px-2 py-1.5"
              style="background: var(--surface); border-color: var(--line)"
            >
              <span class="h-3.5 w-3.5 shrink-0 rounded-full" style="background: var(--ink); opacity: 0.35" />
              <span class="min-w-0 flex-1 space-y-1">
                <span class="block h-1.5 w-3/4 rounded-full" style="background: var(--ink-soft); opacity: 0.45" />
              </span>
            </span>
          </span>
        </span>

        <span class="relative block bg-[var(--paper)] px-3 pb-3 pt-1">
          <span class="flex items-center gap-1 text-[0.875rem] font-semibold" style="color: var(--ink)">
            <span class="min-w-0 truncate">{{ theme.label }}</span>
            <FaIcon
              v-if="modelValue === theme.id"
              icon="check"
              class="shrink-0 text-[0.6rem]"
              style="color: var(--ember)"
            />
          </span>
          <span class="mt-0.5 flex items-center gap-1 text-[0.6875rem]" style="color: var(--muted)">
            <FaIcon v-if="theme.cinematic" icon="wand-magic-sparkles" class="shrink-0 text-[0.55rem]" />
            <span class="truncate">{{ theme.cinematic ?? collectionOf(theme)?.label }}</span>
          </span>
        </span>

        <!-- Says what you are already wearing without a second row of chrome above the wall. -->
        <span
          v-if="modelValue === theme.id"
          class="absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em]"
          style="background: var(--ember); color: var(--on-ember)"
        >
          On
        </span>
      </button>
    </div>

    <p class="mt-5 flex items-start gap-1.5 text-[0.75rem] text-muted">
      <FaIcon icon="heart" class="mt-[3px] text-[0.65rem] text-[var(--ember)]" />
      <span>
        <span class="text-ink">{{ current.label }}</span> is on now, and the theme belongs to the
        relationship — you will both see it, straight away. Motion pauses on its own if your device
        asks for less of it.
      </span>
    </p>
  </div>
</template>
