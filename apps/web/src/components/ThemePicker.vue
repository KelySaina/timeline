<script setup lang="ts">
import { computed } from 'vue';
import type { Theme } from '@/api/types';
import { THEMES } from '@/lib/themes';

const props = defineProps<{ modelValue: Theme; busy?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [Theme] }>();

const groups = computed(() => [
  { mood: 'daylight' as const, label: 'Daylight', themes: THEMES.filter((t) => t.mood === 'daylight') },
  { mood: 'evening' as const, label: 'Evening', themes: THEMES.filter((t) => t.mood === 'evening') },
]);

const pick = (theme: Theme) => {
  if (theme !== props.modelValue) emit('update:modelValue', theme);
};
</script>

<template>
  <div class="space-y-4">
    <section v-for="group in groups" :key="group.mood">
      <p class="eyebrow mb-2">{{ group.label }}</p>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="theme in group.themes"
          :key="theme.id"
          class="group relative overflow-hidden rounded-2xl border text-left transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out-soft)] active:scale-[0.97]"
          :class="
            modelValue === theme.id
              ? 'border-transparent shadow-[var(--shadow-card)] ring-2 ring-[var(--ember)]'
              : 'border-line hover:border-line-strong hover:shadow-[var(--shadow-card)]'
          "
          :aria-pressed="modelValue === theme.id"
          :disabled="busy"
          @click="pick(theme.id)"
        >
          <!-- A miniature of the theme itself: its paper, a card on it, and its accent. -->
          <span class="block px-2.5 pb-2 pt-2.5" :style="{ background: theme.swatch.paper }">
            <span
              class="flex h-11 items-center gap-1.5 rounded-lg px-2"
              :style="{ background: theme.swatch.surface, boxShadow: '0 1px 2px #0000001a' }"
            >
              <span class="h-4 w-4 shrink-0 rounded-full" :style="{ background: theme.swatch.ember }" />
              <span class="flex-1 space-y-1">
                <span class="block h-1.5 w-full rounded-full" :style="{ background: theme.swatch.ember, opacity: 0.28 }" />
                <span class="block h-1.5 w-2/3 rounded-full" :style="{ background: theme.swatch.ember, opacity: 0.16 }" />
              </span>
            </span>
          </span>
          <span class="block px-2.5 pb-2.5 pt-2">
            <span class="flex items-center gap-1 text-[0.8125rem] font-semibold text-ink">
              {{ theme.label }}
              <FaIcon v-if="modelValue === theme.id" icon="check" class="text-[0.6rem] text-[var(--ember)]" />
            </span>
            <span class="mt-0.5 block truncate text-[0.6875rem] text-muted">{{ theme.blurb }}</span>
          </span>
        </button>
      </div>
    </section>
    <p class="text-[0.75rem] text-muted">
      <FaIcon icon="heart" class="mr-1 text-[0.65rem] text-[var(--ember)]" />
      The theme belongs to the relationship — you will both see it.
    </p>
  </div>
</template>
