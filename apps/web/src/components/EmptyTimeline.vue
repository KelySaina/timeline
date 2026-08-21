<script setup lang="ts">
import { QUICK_STARTS, typeMeta } from '@/lib/eventTypes';

defineProps<{ soloName?: string }>();
const emit = defineEmits<{ start: [{ title: string; type: (typeof QUICK_STARTS)[number]['type']; prompt: string }] }>();
</script>

<template>
  <div class="animate-fade py-6">
    <div class="relative mx-auto max-w-md text-center">
      <span
        class="animate-heart mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ember)_28%,transparent)] bg-[var(--ember-soft)] text-2xl text-[var(--ember)]"
      >
        <FaIcon icon="heart" />
      </span>
      <h2 class="display mt-5 text-[2rem] leading-tight sm:text-[2.4rem]">Your story starts here</h2>
      <p class="mx-auto mt-3 max-w-sm text-[0.975rem] text-muted">
        Add one moment — the day you met, a first date, anything. The timeline builds itself in
        the right order, whatever you write first.
      </p>
    </div>

    <div class="mx-auto mt-8 max-w-lg space-y-2">
      <p class="eyebrow mb-3 text-center">Somewhere to begin</p>
      <button
        v-for="start in QUICK_STARTS"
        :key="start.title"
        class="card group flex w-full items-center gap-3.5 p-4 text-left transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"
        @click="emit('start', start)"
      >
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105"
          :style="{
            background: `color-mix(in oklab, ${typeMeta(start.type).color} 14%, transparent)`,
            color: typeMeta(start.type).color,
          }"
        >
          <FaIcon :icon="typeMeta(start.type).icon" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="display block text-[1.05rem]">{{ start.title }}</span>
          <span class="block truncate text-[0.8125rem] text-muted">{{ start.prompt }}</span>
        </span>
        <FaIcon icon="arrow-right" class="text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    </div>
  </div>
</template>
