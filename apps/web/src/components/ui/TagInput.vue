<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ modelValue: string[]; suggestions?: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [string[]] }>();

const draft = ref('');

function add(raw: string): void {
  const tag = raw.trim().toLowerCase().replace(/^#/, '');
  if (!tag || props.modelValue.includes(tag) || props.modelValue.length >= 12) return;
  emit('update:modelValue', [...props.modelValue, tag]);
  draft.value = '';
}

const remove = (tag: string) => emit('update:modelValue', props.modelValue.filter((t) => t !== tag));

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    add(draft.value);
  } else if (event.key === 'Backspace' && !draft.value && props.modelValue.length) {
    remove(props.modelValue[props.modelValue.length - 1]!);
  }
}
</script>

<template>
  <div>
    <div class="field flex flex-wrap items-center gap-1.5 py-2">
      <span
        v-for="tag in modelValue"
        :key="tag"
        class="inline-flex items-center gap-1.5 rounded-full bg-[var(--ember-soft)] px-2.5 py-1 text-[0.8125rem] text-[var(--ember)]"
      >
        {{ tag }}
        <button class="opacity-60 transition-opacity hover:opacity-100" :aria-label="`Remove ${tag}`" @click="remove(tag)">
          <FaIcon icon="xmark" class="text-[0.65rem]" />
        </button>
      </span>
      <input
        v-model="draft"
        class="min-w-24 flex-1 bg-transparent py-1 outline-none"
        :placeholder="modelValue.length ? '' : 'beach, inside joke…'"
        @keydown="onKeydown"
        @blur="add(draft)"
      />
    </div>
    <div v-if="suggestions?.length" class="mt-2 flex flex-wrap gap-1.5">
      <button
        v-for="tag in suggestions.filter((t) => !modelValue.includes(t)).slice(0, 6)"
        :key="tag"
        class="chip py-1 text-[0.75rem]"
        @click="add(tag)"
      >
        <FaIcon icon="tag" class="text-[0.6rem]" />{{ tag }}
      </button>
    </div>
  </div>
</template>
