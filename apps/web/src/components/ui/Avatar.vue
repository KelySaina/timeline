<script setup lang="ts">
import { computed, ref } from 'vue';
import { avatarUrl } from '@/api/client';
import { initials } from '@/lib/format';

const props = withDefaults(
  defineProps<{ userId?: string | null; name: string; hasAvatar?: boolean; size?: number }>(),
  { size: 44 },
);

const failed = ref(false);
const showImage = computed(() => props.hasAvatar && props.userId && !failed.value);
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(11, props.size * 0.34)}px`,
}));
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line-strong bg-surface-sunk font-semibold text-muted select-none"
    :style="style"
    :title="name"
  >
    <img
      v-if="showImage"
      :src="avatarUrl(userId!)"
      :alt="name"
      class="h-full w-full object-cover"
      loading="lazy"
      @error="failed = true"
    />
    <template v-else>{{ initials(name) }}</template>
  </span>
</template>
