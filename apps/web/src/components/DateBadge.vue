<script setup lang="ts">
import { computed } from 'vue';
import type { DatePrecision } from '@/api/types';
import { monthLabel, parts } from '@/lib/format';

const props = withDefaults(
  defineProps<{ date: string; precision?: DatePrecision; size?: 'sm' | 'md' }>(),
  { precision: 'day', size: 'md' },
);

/** A fuzzy memory shows what it actually knows: a month, or just a year. */
const primary = computed(() => {
  if (props.precision === 'year') return parts(props.date).year;
  if (props.precision === 'month') return monthLabel(props.date);
  return parts(props.date).day;
});

const secondary = computed(() => {
  if (props.precision === 'year') return null;
  if (props.precision === 'month') return String(parts(props.date).year);
  return monthLabel(props.date);
});
</script>

<template>
  <span
    class="flex shrink-0 flex-col items-center justify-center rounded-xl border border-line bg-surface-sunk leading-none"
    :class="size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'"
  >
    <span class="display tabular-nums" :class="size === 'sm' ? 'text-[0.8rem]' : 'text-[0.95rem]'">
      {{ primary }}
    </span>
    <span v-if="secondary" class="mt-0.5 text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted">
      {{ secondary }}
    </span>
  </span>
</template>
