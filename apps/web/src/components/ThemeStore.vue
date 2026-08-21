<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Theme } from '@/api/types';
import { COLLECTIONS, THEMES, themeMeta, type CollectionId, type ThemeMeta } from '@/lib/themes';
import ThemeAtmosphere from './ThemeAtmosphere.vue';

const props = withDefaults(
  defineProps<{ modelValue: Theme; busy?: boolean; hero?: boolean }>(),
  { hero: true },
);
const emit = defineEmits<{ 'update:modelValue': [Theme] }>();

const filter = ref<CollectionId | 'all'>('all');
const current = computed(() => themeMeta(props.modelValue));

// One flat list when a collection is picked, grouped sections when browsing all.
const sections = computed(() =>
  COLLECTIONS.filter((c) => filter.value === 'all' || c.id === filter.value).map((collection) => ({
    ...collection,
    themes: THEMES.filter((theme) => theme.collection === collection.id),
  })),
);

const pick = (theme: ThemeMeta) => {
  if (theme.id !== props.modelValue) emit('update:modelValue', theme.id);
};
</script>

<template>
  <div class="space-y-4">
    <!-- What you are using right now, rendered in itself. -->
    <div v-if="hero" class="relative overflow-hidden rounded-[22px] border border-line" :class="`theme-${modelValue}`">
      <ThemeAtmosphere />
      <div class="relative flex items-center gap-3.5 bg-[var(--paper)] p-4">
        <span
          class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)]"
        >
          <FaIcon icon="heart" class="text-lg text-[var(--ember)]" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="eyebrow" style="color: var(--muted)">Wearing now</span>
          <span class="display block truncate text-[1.3rem]" style="color: var(--ink)">{{ current.label }}</span>
          <span class="block truncate text-[0.8125rem]" style="color: var(--muted)">{{ current.blurb }}</span>
        </span>
        <span
          v-if="current.cinematic"
          class="hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] sm:inline-flex"
          style="border-color: var(--line-strong); color: var(--muted)"
        >
          <FaIcon icon="wand-magic-sparkles" style="color: var(--ember)" />
          {{ current.cinematic }}
        </span>
      </div>
    </div>

    <!-- Collections. Scrolls sideways on a phone rather than wrapping to four rows. -->
    <div
      class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      <button class="chip" :class="filter === 'all' && 'is-active'" @click="filter = 'all'">
        All
        <span class="opacity-60">{{ THEMES.length }}</span>
      </button>
      <button
        v-for="collection in COLLECTIONS"
        :key="collection.id"
        class="chip"
        :class="filter === collection.id && 'is-active'"
        @click="filter = collection.id"
      >
        {{ collection.label }}
      </button>
    </div>

    <section v-for="section in sections" :key="section.id">
      <div class="mb-2 flex items-baseline gap-2">
        <p class="eyebrow">{{ section.label }}</p>
        <p class="min-w-0 truncate text-[0.75rem] text-muted">{{ section.tagline }}</p>
      </div>

      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <button
          v-for="theme in section.themes"
          :key="theme.id"
          class="theme-tile lift group relative overflow-hidden rounded-2xl border text-left active:scale-[0.98]"
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
          <!-- A miniature of the theme, painted by the theme's own variables. -->
          <span class="relative block bg-[var(--paper)] px-2.5 pb-2 pt-2.5">
            <ThemeAtmosphere />
            <span
              class="relative flex h-12 items-center gap-1.5 rounded-xl border px-2"
              style="
                background: var(--surface);
                border-color: var(--line);
                box-shadow: var(--shadow-card);
              "
            >
              <span class="h-4 w-4 shrink-0 rounded-full" style="background: var(--ember)" />
              <span class="min-w-0 flex-1 space-y-1">
                <span class="block h-1.5 w-full rounded-full" style="background: var(--ink-soft); opacity: 0.5" />
                <span class="block h-1.5 w-2/3 rounded-full" style="background: var(--ember-soft)" />
              </span>
            </span>
          </span>
          <span class="relative block bg-[var(--paper)] px-2.5 pb-2.5 pt-1.5">
            <span class="flex items-center gap-1 text-[0.8125rem] font-semibold" style="color: var(--ink)">
              <span class="min-w-0 truncate">{{ theme.label }}</span>
              <FaIcon
                v-if="modelValue === theme.id"
                icon="check"
                class="shrink-0 text-[0.6rem]"
                style="color: var(--ember)"
              />
            </span>
            <span class="mt-0.5 flex items-center gap-1 text-[0.6875rem]" style="color: var(--muted)">
              <FaIcon v-if="theme.cinematic" icon="wand-magic-sparkles" class="text-[0.55rem] shrink-0" />
              <span class="truncate">{{ theme.cinematic ?? theme.blurb }}</span>
            </span>
          </span>
        </button>
      </div>
    </section>

    <p class="flex items-start gap-1.5 text-[0.75rem] text-muted">
      <FaIcon icon="heart" class="mt-[3px] text-[0.65rem] text-[var(--ember)]" />
      <span>
        The theme belongs to the relationship — you will both see it. Motion pauses on its own if
        your device asks for less of it.
      </span>
    </p>
  </div>
</template>
