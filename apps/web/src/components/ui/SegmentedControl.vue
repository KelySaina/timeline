<script setup lang="ts" generic="T extends string | number">
defineProps<{ options: { value: T; label: string; icon?: string }[]; modelValue: T }>();
const emit = defineEmits<{ 'update:modelValue': [T] }>();
</script>

<template>
  <div class="inline-flex rounded-full border border-line-strong bg-surface-sunk p-0.5">
    <button
      v-for="option in options"
      :key="String(option.value)"
      class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] transition-all duration-200"
      :class="
        option.value === modelValue
          ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_#241f1d14]'
          : 'text-muted hover:text-ink'
      "
      @click="emit('update:modelValue', option.value)"
    >
      <FaIcon v-if="option.icon" :icon="option.icon" class="text-[0.7rem]" />
      {{ option.label }}
    </button>
  </div>
</template>
