<script setup lang="ts">
import { computed } from 'vue';
import type { UpcomingItem } from '@/api/types';
import { typeMeta } from '@/lib/eventTypes';
import { formatEventDate, ordinal } from '@/lib/format';

const props = withDefaults(
  defineProps<{ items: UpcomingItem[]; limit?: number; heading?: string }>(),
  { limit: 0 },
);
const emit = defineEmits<{ open: [UpcomingItem] }>();

const shown = computed(() => (props.limit ? props.items.slice(0, props.limit) : props.items));

const glyph = (item: UpcomingItem) => {
  if (item.kind === 'anniversary') return { icon: 'heart', color: 'var(--type-milestone)' };
  if (item.kind === 'birthday') return { icon: 'cake-candles', color: 'var(--type-birthday)' };
  if (item.kind === 'plan' && item.eventType) return typeMeta(item.eventType);
  return { icon: 'calendar-day', color: 'var(--type-custom)' };
};

/** The headline stays short; the countdown lives in the badge, so nothing truncates on a phone. */
const line = (item: UpcomingItem): string => {
  if (item.kind === 'anniversary') {
    return item.ordinal ? `Your ${ordinal(item.ordinal)} anniversary` : 'Your anniversary';
  }
  return item.title;
};

/** "the sentence a couple opens the app for" — kept for the ones close enough to matter. */
const detail = (item: UpcomingItem): string => {
  const bits = [formatEventDate(item.date)];
  if (item.kind === 'birthday' && item.ordinal) bits.push(`turning ${item.ordinal}`);
  if (item.location) bits.push(item.location);
  if (item.recurring) bits.push('every year');
  return bits.join(' · ');
};

const isImminent = (item: UpcomingItem) => item.daysUntil <= 7;

/** Today deserves a word, not a zero. */
const badge = (item: UpcomingItem) =>
  item.daysUntil === 0
    ? { value: 'Today', unit: '' }
    : { value: String(item.daysUntil), unit: item.daysUntil === 1 ? 'day' : 'days' };
</script>

<template>
  <section>
    <h2 v-if="heading" class="eyebrow mb-2.5">{{ heading }}</h2>
    <ul class="space-y-2">
      <li v-for="item in shown" :key="item.key">
        <button
          class="card group flex w-full items-center gap-3 p-3.5 text-left transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"
          :class="isImminent(item) && 'animate-pulse-ring'"
          @click="emit('open', item)"
        >
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            :style="{
              background: `color-mix(in oklab, ${glyph(item).color} 14%, transparent)`,
              color: glyph(item).color,
            }"
          >
            <FaIcon :icon="glyph(item).icon" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[0.975rem] text-ink">
              {{ line(item) }}
              <FaIcon
                v-if="item.kind === 'anniversary'"
                icon="heart"
                class="ml-0.5 text-[0.7rem] text-[var(--ember)]"
              />
            </span>
            <span class="mt-0.5 block truncate text-[0.75rem] text-muted">{{ detail(item) }}</span>
          </span>
          <span
            class="display shrink-0 text-right leading-none"
            :class="isImminent(item) ? 'text-[var(--ember)]' : 'text-muted'"
          >
            <span class="block text-[1.1rem] tabular-nums">{{ badge(item).value }}</span>
            <span v-if="badge(item).unit" class="text-[0.5625rem] uppercase tracking-[0.1em]">
              {{ badge(item).unit }}
            </span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
