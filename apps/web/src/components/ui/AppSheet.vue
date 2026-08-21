<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';

const props = withDefaults(
  defineProps<{ open: boolean; title?: string; subtitle?: string; size?: 'md' | 'lg' | 'full' }>(),
  { size: 'md' },
);
const emit = defineEmits<{ close: [] }>();

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) emit('close');
};

// Locking the body is what keeps a bottom sheet from dragging the timeline behind it.
const lockScroll = (locked: boolean) => {
  document.body.style.overflow = locked ? 'hidden' : '';
};

watch(() => props.open, lockScroll);
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  lockScroll(false);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        class="animate-fade absolute inset-0 bg-[color-mix(in_oklab,var(--ink)_46%,transparent)] backdrop-blur-[3px]"
        @click="emit('close')"
      />
      <div
        role="dialog"
        aria-modal="true"
        class="animate-sheet relative flex w-full flex-col overflow-hidden bg-surface shadow-[var(--shadow-float)]"
        :class="[
          size === 'full'
            ? 'max-h-[94dvh] rounded-t-[28px] sm:max-h-[92dvh] sm:max-w-3xl sm:rounded-[24px]'
            : size === 'lg'
              ? 'max-h-[92dvh] rounded-t-[28px] sm:max-w-2xl sm:rounded-[24px]'
              : 'max-h-[90dvh] rounded-t-[28px] sm:max-w-lg sm:rounded-[24px]',
        ]"
      >
        <header
          v-if="title || $slots.header"
          class="flex items-start gap-3 border-b border-line px-5 pb-4 pt-5 sm:px-6"
        >
          <div class="min-w-0 flex-1">
            <slot name="header">
              <h2 class="display truncate text-[1.35rem]">{{ title }}</h2>
              <p v-if="subtitle" class="mt-0.5 text-sm text-muted">{{ subtitle }}</p>
            </slot>
          </div>
          <button
            class="btn btn-quiet -mr-2 -mt-1 h-9 w-9 shrink-0 rounded-full p-0"
            aria-label="Close"
            @click="emit('close')"
          >
            <FaIcon icon="xmark" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="border-t border-line bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
