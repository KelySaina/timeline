<script setup lang="ts">
/**
 * The theme store as a place rather than a panel. It was a sheet holding a hero, a chip row and
 * eight labelled sections: a scroll inside a scroll, with no back button and no address. As a route
 * the gallery gets the whole page, the phone's back gesture works, and the browsing is one scroll.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Theme } from '@/api/types';
import { themeMeta } from '@/lib/themes';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import ThemeStore from '@/components/ThemeStore.vue';

const auth = useAuthStore();
const toasts = useToastStore();
const router = useRouter();

const saving = ref(false);
const current = computed(() => themeMeta(auth.couple?.theme));

async function setTheme(theme: Theme): Promise<void> {
  saving.value = true;
  try {
    await auth.updateCouple({ theme });
  } catch {
    toasts.error('Could not save that theme');
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
          <FaIcon icon="swatchbook" class="mr-1 text-[0.7rem] text-[var(--ember)]" />
          Theme store
        </p>
        <h1 class="display mt-1 text-[1.7rem] leading-tight sm:text-[2.15rem]">
          Twenty-seven ways to read it
        </h1>
        <p class="mt-1.5 text-[0.8125rem] text-muted">
          Wearing {{ current.label }} — {{ current.blurb.toLowerCase() }}
        </p>
      </div>
    </header>

    <ThemeStore
      :model-value="auth.couple?.theme ?? 'dawn'"
      :busy="saving"
      @update:model-value="setTheme"
    />

    <RouterLink
      :to="{ name: 'story' }"
      class="card-quiet mt-5 flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--surface-sunk)]"
    >
      <FaIcon icon="sort" class="text-muted" />
      <span class="min-w-0 flex-1 text-[0.9375rem]">
        Story shape
        <span class="block text-[0.75rem] text-muted">These are the colours — the shape lives next door</span>
      </span>
      <FaIcon icon="chevron-right" class="shrink-0 text-[0.75rem] text-muted" />
    </RouterLink>
  </div>
</template>
