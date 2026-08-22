<script setup lang="ts">
import { useToastStore } from '@/stores/toast';
import type { Toast } from '@/stores/toast';

const toasts = useToastStore();

function act(toast: Toast): void {
  toast.action?.run();
  toasts.dismiss(toast.id);
}
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
      <TransitionGroup
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="translate-y-3 opacity-0"
        leave-active-class="transition duration-200 ease-in"
        leave-to-class="translate-y-1 opacity-0"
      >
        <div
          v-for="toast in toasts.toasts"
          :key="toast.id"
          role="status"
          class="pointer-events-auto flex max-w-md items-center gap-3 rounded-full border px-4 py-2.5 text-sm shadow-[var(--shadow-float)] backdrop-blur"
          :class="
            toast.tone === 'error'
              ? 'border-[color-mix(in_oklab,var(--ember)_40%,transparent)] bg-[color-mix(in_oklab,var(--ember)_14%,var(--surface))] text-ink'
              : toast.tone === 'warm'
                ? 'border-[color-mix(in_oklab,var(--ember)_30%,transparent)] bg-surface text-ink'
                : 'border-line-strong bg-surface text-ink'
          "
        >
          <button class="min-w-0 text-left" @click="toasts.dismiss(toast.id)">
            <FaIcon v-if="toast.tone === 'warm'" icon="heart" class="mr-1.5 text-[var(--ember)]" />
            {{ toast.message }}
          </button>
          <button
            v-if="toast.action"
            class="shrink-0 rounded-full border border-[color-mix(in_oklab,var(--ember)_45%,transparent)] px-3 py-1 text-xs font-medium text-[var(--ember)] transition hover:bg-[var(--ember-soft)]"
            @click="act(toast)"
          >
            {{ toast.action.label }}
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
