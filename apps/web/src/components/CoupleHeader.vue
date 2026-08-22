<script setup lang="ts">
import { computed } from 'vue';
import type { Couple } from '@/api/types';
import { formatEventDate } from '@/lib/format';
import Avatar from './ui/Avatar.vue';

const props = withDefaults(
  defineProps<{ couple: Couple; variant?: 'hero' | 'row' }>(),
  { variant: 'hero' },
);

const names = computed(() =>
  props.couple.members.length
    ? props.couple.members.map((m) => m.displayName).join(' & ')
    : (props.couple.title ?? 'Our story'),
);

/**
 * In hero mode the headline is the time itself, not the names — the app bar above already says who
 * this is, and "2 years, 2 months, 20 days" is the number a couple actually opens the app for.
 */
const togetherParts = computed(() => {
  const t = props.couple.together;
  if (!t) return null;
  const parts: { value: number; unit: string }[] = [];
  if (t.years) parts.push({ value: t.years, unit: t.years === 1 ? 'year' : 'years' });
  if (t.months) parts.push({ value: t.months, unit: t.months === 1 ? 'month' : 'months' });
  parts.push({ value: t.days, unit: t.days === 1 ? 'day' : 'days' });
  return parts;
});

const stats = computed(() => [
  { label: 'Memories', value: props.couple.stats.memories },
  { label: 'Trips', value: props.couple.stats.trips },
  { label: 'Milestones', value: props.couple.stats.milestones },
  { label: 'Photos', value: props.couple.stats.photos },
]);
</script>

<template>
  <header v-if="variant === 'row'" class="flex items-center gap-3">
    <div class="flex">
      <Avatar
        v-for="(member, index) in couple.members"
        :key="member.id"
        :user-id="member.id"
        :name="member.displayName"
        :has-avatar="member.hasAvatar"
        :size="34"
        :class="index > 0 && '-ml-3 ring-2 ring-[var(--paper)]'"
      />
    </div>
    <h1 class="display min-w-0 flex-1 truncate text-[1.1rem]">{{ couple.title || names }}</h1>
    <slot name="action" />
  </header>

  <header v-else>
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <p class="eyebrow">
          <FaIcon icon="heart" class="mr-1 text-[0.7rem] text-[var(--ember)]" />
          {{ togetherParts ? 'Together for' : couple.title || names }}
        </p>

        <!-- gap-y matters: with leading-none, a duration that wraps (a long one, a narrow screen)
             would otherwise put two lines of 27px type flush against each other. -->
        <h1 v-if="togetherParts" class="display mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[1.7rem] leading-none sm:text-[2.15rem]">
          <span v-for="part in togetherParts" :key="part.unit" class="whitespace-nowrap">
            <span class="tabular-nums">{{ part.value }}</span>
            <span class="ml-1 text-[0.62em] font-normal text-muted">{{ part.unit }}</span>
          </span>
        </h1>
        <h1 v-else class="display mt-1 text-[1.7rem] leading-tight sm:text-[2.15rem]">
          {{ couple.title || names }}
        </h1>

        <p class="mt-1.5 text-[0.8125rem] text-muted">
          <template v-if="couple.startedOn">since {{ formatEventDate(couple.startedOn) }}</template>
          <template v-else>Add the day you became official to start the counter</template>
        </p>
      </div>
      <slot name="action" />
    </div>

    <!--
      Four tiles in one row is the point — the header must not push the timeline down — but
      "Milestones" is 74px of tracked uppercase and the tile's content box is only 66px on a 390px
      phone, so the label used to bleed straight over the card's edges (and collide with "Photos"
      at 320px). Tighter caps and narrower padding buy back enough to fit from 360px up; below
      that no legible one-row layout exists, so it becomes 2x2 rather than pretending.
    -->
    <dl class="mt-4 grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">
      <div v-for="stat in stats" :key="stat.label" class="card-quiet px-1 py-2.5 text-center sm:px-2">
        <dt class="text-[0.5625rem] font-semibold uppercase tracking-[0.04em] text-muted sm:text-[0.625rem] sm:tracking-[0.1em]">{{ stat.label }}</dt>
        <dd class="display mt-0.5 text-[1.25rem] tabular-nums">{{ stat.value }}</dd>
      </div>
    </dl>
  </header>
</template>
