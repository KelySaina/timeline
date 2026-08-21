<script setup lang="ts">
import type { EventType } from '@/api/types';
import { eventTypeList } from '@/lib/eventTypes';

defineProps<{ modelValue: EventType }>();
const emit = defineEmits<{ 'update:modelValue': [EventType] }>();
</script>

<template>
  <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
    <button
      v-for="meta in eventTypeList"
      :key="meta.type"
      class="group flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition-all duration-200"
      :class="
        modelValue === meta.type
          ? 'border-transparent shadow-[var(--shadow-card)]'
          : 'border-line bg-surface-sunk hover:border-line-strong'
      "
      :style="
        modelValue === meta.type
          ? { background: `color-mix(in oklab, ${meta.color} 12%, var(--surface))` }
          : undefined
      "
      @click="emit('update:modelValue', meta.type)"
    >
      <span
        class="flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-200 group-active:scale-90"
        :style="{
          background: `color-mix(in oklab, ${meta.color} 16%, transparent)`,
          color: meta.color,
        }"
      >
        <FaIcon :icon="meta.icon" />
      </span>
      <span
        class="text-center text-[0.6875rem] leading-tight"
        :class="modelValue === meta.type ? 'font-semibold text-ink' : 'text-muted'"
      >
        {{ meta.label }}
      </span>
    </button>
  </div>
</template>
