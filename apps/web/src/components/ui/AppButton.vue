<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'quiet';
    icon?: string;
    loading?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    block?: boolean;
  }>(),
  { variant: 'ghost', type: 'button' },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="btn"
    :class="[`btn-${variant}`, block && 'w-full']"
  >
    <FaIcon v-if="loading" icon="circle-notch" class="animate-spin" />
    <FaIcon v-else-if="icon" :icon="icon" />
    <span v-if="$slots.default"><slot /></span>
  </button>
</template>
