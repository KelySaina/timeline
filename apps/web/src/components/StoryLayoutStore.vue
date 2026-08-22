<script setup lang="ts">
/**
 * The layout gallery. Same shape as the theme store, because it is the same kind of decision: a
 * look that belongs to the relationship rather than the device.
 *
 * Every tile is a real miniature of the layout drawn in the couple's current theme, so the choice
 * is made by eye. Two of the six only come alive once memories carry a place or a mood, and those
 * say so on the tile — a layout that draws you a flat line because a column is empty should tell
 * you that before you pick it, not after.
 */
import type { StoryLayout } from '@/api/types';
import { STORY_LAYOUT_META, storyLayoutMeta } from '@/lib/storyLayouts';
import { computed } from 'vue';

const props = defineProps<{ modelValue: StoryLayout; busy?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [StoryLayout] }>();

const current = computed(() => storyLayoutMeta(props.modelValue));

const pick = (id: StoryLayout) => {
  if (id !== props.modelValue) emit('update:modelValue', id);
};
</script>

<template>
  <div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="meta in STORY_LAYOUT_META"
        :key="meta.id"
        class="lift group relative overflow-hidden rounded-[20px] border bg-surface text-left transition active:scale-[0.99]"
        :class="
          modelValue === meta.id
            ? 'border-transparent shadow-[var(--shadow-card)] ring-2 ring-[var(--ember)]'
            : 'border-line hover:border-line-strong'
        "
        :aria-pressed="modelValue === meta.id"
        :aria-label="`${meta.label} — ${meta.blurb}`"
        :disabled="busy"
        @click="pick(meta.id)"
      >
        <!-- A miniature of the layout, in whatever theme is on. -->
        <span class="block bg-paper px-3 pb-2 pt-3">
          <svg viewBox="0 0 200 108" class="h-auto w-full" aria-hidden="true">
            <!-- rail -->
            <g v-if="meta.id === 'rail'">
              <line x1="20" y1="8" x2="20" y2="100" stroke="var(--line-strong)" stroke-width="2" />
              <g v-for="(y, i) in [18, 46, 74]" :key="i">
                <circle :cy="y" cx="20" r="4.5" fill="var(--surface)" stroke="var(--ember)" stroke-width="2" />
                <rect x="34" :y="y - 11" width="150" height="22" rx="4" fill="var(--surface)" stroke="var(--line)" />
              </g>
            </g>

            <!-- road: full-width cards, the path sweeping across the gaps between them -->
            <g v-else-if="meta.id === 'road'">
              <rect x="12" y="4" width="176" height="26" rx="5" fill="var(--surface)" stroke="var(--line)" />
              <rect x="12" y="52" width="176" height="26" rx="5" fill="var(--surface)" stroke="var(--line)" />
              <rect x="12" y="100" width="176" height="8" rx="4" fill="var(--surface)" stroke="var(--line)" />
              <g fill="none" stroke-linecap="round">
                <path d="M140 30 C 140 40, 62 42, 62 52" stroke="var(--line-strong)" stroke-width="7" />
                <path d="M140 30 C 140 40, 62 42, 62 52" stroke="var(--ember)" stroke-width="4" opacity="0.6" />
                <path d="M140 30 C 140 40, 62 42, 62 52" stroke="var(--paper)" stroke-width="1.2" stroke-dasharray="5 6" />
                <path d="M62 78 C 62 88, 148 90, 148 100" stroke="var(--line-strong)" stroke-width="7" />
                <path d="M62 78 C 62 88, 148 90, 148 100" stroke="var(--ember)" stroke-width="4" opacity="0.6" />
                <path d="M62 78 C 62 88, 148 90, 148 100" stroke="var(--paper)" stroke-width="1.2" stroke-dasharray="5 6" />
              </g>
              <circle cx="62" cy="52" r="4.5" fill="var(--surface)" stroke="var(--ember)" stroke-width="2" />
              <circle cx="148" cy="100" r="4.5" fill="var(--surface)" stroke="var(--ember)" stroke-width="2" />
            </g>

            <!-- route -->
            <g v-else-if="meta.id === 'route'">
              <path
                d="M40 6 L40 34 L74 48 L74 76 L40 90 L40 104"
                fill="none" stroke="var(--line-strong)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"
              />
              <path d="M74 48 L124 48" fill="none" stroke="var(--ember)" stroke-width="2.5" stroke-dasharray="5 4" stroke-linecap="round" />
              <g fill="var(--surface)" stroke="var(--ember)" stroke-width="2.5">
                <circle cx="40" cy="16" r="5" /><circle cx="74" cy="48" r="5" /><circle cx="40" cy="98" r="5" />
              </g>
              <g fill="var(--ink-soft)" opacity="0.55">
                <rect x="54" y="12" width="52" height="6" rx="3" />
                <rect x="88" y="60" width="58" height="6" rx="3" />
                <rect x="54" y="94" width="44" height="6" rx="3" />
              </g>
            </g>

            <!-- album -->
            <g v-else-if="meta.id === 'album'" stroke="var(--line)">
              <rect x="12" y="6" width="106" height="52" rx="4" fill="color-mix(in oklab, var(--ember) 16%, var(--surface))" />
              <rect x="124" y="6" width="64" height="24" rx="4" fill="var(--surface-sunk)" />
              <rect x="124" y="34" width="64" height="24" rx="4" fill="var(--surface-sunk)" />
              <rect x="12" y="64" width="50" height="38" rx="4" fill="var(--surface-sunk)" />
              <rect x="68" y="64" width="120" height="38" rx="4" fill="color-mix(in oklab, var(--ember) 10%, var(--surface))" />
            </g>

            <!-- reel -->
            <g v-else-if="meta.id === 'reel'" stroke="var(--line)">
              <rect x="12" y="10" width="58" height="38" rx="4" fill="color-mix(in oklab, var(--ember) 14%, var(--surface))" />
              <rect x="76" y="10" width="58" height="38" rx="4" fill="var(--surface-sunk)" />
              <rect x="140" y="10" width="58" height="38" rx="4" fill="var(--surface-sunk)" />
              <rect x="12" y="62" width="58" height="38" rx="4" fill="color-mix(in oklab, var(--ember) 14%, var(--surface))" />
              <rect x="76" y="62" width="58" height="38" rx="4" fill="var(--surface-sunk)" />
              <rect x="140" y="62" width="58" height="38" rx="4" fill="var(--surface-sunk)" />
              <path d="M186 30 l7 -6 -7 -6" fill="none" stroke="var(--ember)" stroke-width="2" stroke-linecap="round" />
              <path d="M186 82 l7 -6 -7 -6" fill="none" stroke="var(--ember)" stroke-width="2" stroke-linecap="round" />
            </g>

            <!-- heartline: a narrow gutter of pulse, cards alongside -->
            <g v-else>
              <path
                d="M26 2 L26 20 L40 26 L40 32 L26 38 L26 56 L14 62 L14 68 L26 74 L26 92 L38 98 L38 104"
                fill="none" stroke="var(--line-strong)" stroke-width="5"
                stroke-linejoin="round" stroke-linecap="round"
              />
              <path
                d="M26 2 L26 20 L40 26 L40 32 L26 38 L26 56 L14 62 L14 68 L26 74 L26 92 L38 98 L38 104"
                fill="none" stroke="var(--ember)" stroke-width="2.5"
                stroke-linejoin="round" stroke-linecap="round"
              />
              <g fill="var(--surface)" stroke="var(--ember)" stroke-width="2">
                <circle cx="40" cy="29" r="4" /><circle cx="14" cy="65" r="3.5" /><circle cx="38" cy="101" r="4" />
              </g>
              <g fill="var(--surface)" stroke="var(--line)">
                <rect x="56" y="8" width="132" height="34" rx="5" />
                <rect x="56" y="52" width="132" height="26" rx="5" />
                <rect x="56" y="88" width="132" height="18" rx="5" />
              </g>
            </g>
          </svg>
        </span>

        <span class="block px-4 pb-4 pt-2">
          <span class="flex items-center gap-1.5">
            <span class="display min-w-0 truncate text-[1.05rem] text-ink">{{ meta.label }}</span>
            <FaIcon v-if="modelValue === meta.id" icon="check" class="shrink-0 text-[0.65rem] text-[var(--ember)]" />
          </span>
          <span class="mt-0.5 block text-[0.8125rem] text-muted">{{ meta.blurb }}</span>

          <span class="mt-2.5 flex items-start gap-1.5 text-[0.7rem] text-muted">
            <FaIcon icon="sort" class="mt-[3px] shrink-0 text-[0.6rem] opacity-70" />
            <span><span class="text-ink-soft">Shape from</span> {{ meta.driver.toLowerCase() }}</span>
          </span>
          <span v-if="meta.needs" class="mt-1 flex items-start gap-1.5 text-[0.7rem]">
            <FaIcon icon="star" class="mt-[3px] shrink-0 text-[0.6rem] text-[var(--ember)]" />
            <span class="text-muted">{{ meta.needs }}</span>
          </span>
        </span>

        <span
          v-if="modelValue === meta.id"
          class="absolute right-3 top-3 rounded-full bg-[var(--ember)] px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--on-ember)]"
        >
          On
        </span>
      </button>
    </div>

    <p class="mt-5 flex items-start gap-1.5 text-[0.75rem] text-muted">
      <FaIcon icon="heart" class="mt-[3px] text-[0.65rem] text-[var(--ember)]" />
      <span>
        Reading it as <span class="text-ink">{{ current.label }}</span>. Like the theme, the shape
        belongs to the relationship — change it and their story changes too, straight away.
      </span>
    </p>
  </div>
</template>
