<script setup lang="ts">
/**
 * Picking the shape of the story. A sibling of the theme store, and deliberately a separate route
 * from it: one decides what the story is coloured like, this decides what it is drawn like, and
 * cramming both into one screen made neither browsable.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { StoryLayout } from '@/api/types';
import { storyLayoutMeta } from '@/lib/storyLayouts';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import StoryLayoutStore from '@/components/StoryLayoutStore.vue';

const auth = useAuthStore();
const toasts = useToastStore();
const router = useRouter();

const saving = ref(false);
const current = computed(() => storyLayoutMeta(auth.couple?.storyLayout));

async function setLayout(storyLayout: StoryLayout): Promise<void> {
  saving.value = true;
  try {
    await auth.updateCouple({ storyLayout });
  } catch {
    toasts.error('Could not save that layout');
  } finally {
    saving.value = false;
  }
}

const back = () => (window.history.length > 1 ? router.back() : router.push({ name: 'timeline' }));
</script>

<template>
  <div>
    <header class="mb-5 flex items-start gap-3">
      <button class="btn btn-quiet mt-0.5 h-9 w-9 shrink-0 rounded-full p-0" aria-label="Back" @click="back">
        <FaIcon icon="chevron-left" />
      </button>
      <div class="min-w-0 flex-1">
        <p class="eyebrow">
          <FaIcon icon="sort" class="mr-1 text-[0.7rem] text-[var(--ember)]" />
          Story shape
        </p>
        <h1 class="display mt-1 text-[1.7rem] leading-tight sm:text-[2.15rem]">
          How your story is drawn
        </h1>
        <p class="mt-1.5 text-[0.8125rem] text-muted">
          Reading it as {{ current.label }} — {{ current.blurb.toLowerCase() }}
        </p>
      </div>
    </header>

    <StoryLayoutStore
      :model-value="auth.couple?.storyLayout ?? 'rail'"
      :busy="saving"
      @update:model-value="setLayout"
    />

    <RouterLink
      :to="{ name: 'themes' }"
      class="card-quiet mt-5 flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--surface-sunk)]"
    >
      <FaIcon icon="palette" class="text-muted" />
      <span class="min-w-0 flex-1 text-[0.9375rem]">
        Theme store
        <span class="block text-[0.75rem] text-muted">This is the shape — the colours live next door</span>
      </span>
      <FaIcon icon="chevron-right" class="shrink-0 text-[0.75rem] text-muted" />
    </RouterLink>
  </div>
</template>
