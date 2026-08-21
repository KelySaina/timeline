<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useTimelineStore } from '@/stores/timeline';
import { useUiStore } from '@/stores/ui';
import type { Theme } from '@/api/types';
import { themeMeta } from '@/lib/themes';
import { useToastStore } from '@/stores/toast';
import AppSheet from './ui/AppSheet.vue';
import Avatar from './ui/Avatar.vue';
import EventForm from './EventForm.vue';
import MemoryModal from './MemoryModal.vue';
import ThemePicker from './ThemePicker.vue';

const auth = useAuthStore();
const timeline = useTimelineStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const tabs = computed(() => [
  { name: 'timeline', label: 'Story', icon: 'heart' },
  { name: 'upcoming', label: 'Soon', icon: 'clock', badge: timeline.upcoming.filter((i) => i.daysUntil <= 30).length },
  { name: 'search', label: 'Search', icon: 'magnifying-glass' },
  { name: 'profile', label: 'Us', icon: 'user' },
]);

const toasts = useToastStore();
const themeOpen = ref(false);
const savingTheme = ref(false);
const currentTheme = computed(() => themeMeta(auth.couple?.theme));

async function setTheme(theme: Theme): Promise<void> {
  savingTheme.value = true;
  try {
    await auth.updateCouple({ theme });
  } catch {
    toasts.error('Could not save that theme');
  } finally {
    savingTheme.value = false;
  }
}

const title = computed(() => auth.couple?.title || auth.displayNames.join(' & ') || 'Our story');

function onSaved(): void {
  if (route.name !== 'timeline') void router.push({ name: 'timeline' });
}
</script>

<template>
  <div class="min-h-dvh">
    <header
      class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-paper/85 px-4 backdrop-blur-md"
    >
      <RouterLink :to="{ name: 'profile' }" class="flex min-w-0 items-center gap-2.5">
        <span class="flex">
          <Avatar
            v-for="(member, index) in auth.couple?.members ?? []"
            :key="member.id"
            :user-id="member.id"
            :name="member.displayName"
            :has-avatar="member.hasAvatar"
            :size="30"
            :class="index > 0 && '-ml-2.5 ring-2 ring-[var(--paper)]'"
          />
        </span>
        <span class="display truncate text-[1.02rem]">{{ title }}</span>
      </RouterLink>

      <span class="flex-1" />

      <button
        class="btn btn-quiet h-9 w-9 rounded-full p-0"
        aria-label="Change theme"
        :title="`Theme: ${currentTheme.label}`"
        @click="themeOpen = true"
      >
        <FaIcon icon="palette" />
      </button>
      <button class="btn btn-primary hidden h-9 px-3.5 sm:inline-flex" @click="ui.compose()">
        <FaIcon icon="plus" />
        <span class="text-[0.875rem]">Add memory</span>
      </button>
    </header>

    <main class="mx-auto w-full max-w-2xl px-4 pb-32 pt-4 sm:pb-24">
      <slot />
    </main>

    <!-- Bottom bar on mobile, floating pill on desktop: the FAB stays within thumb reach. -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-auto sm:-translate-x-1/2 sm:rounded-full sm:border sm:px-2 sm:shadow-[var(--shadow-float)]"
    >
      <div class="mx-auto flex max-w-lg items-center justify-around px-2 py-1.5 sm:gap-1 sm:px-1">
        <RouterLink
          v-for="tab in tabs.slice(0, 2)"
          :key="tab.name"
          :to="{ name: tab.name }"
          class="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[0.65rem] transition-colors sm:flex-none sm:flex-row sm:gap-1.5 sm:text-[0.8125rem]"
          :class="route.name === tab.name ? 'text-[var(--ember)]' : 'text-muted hover:text-ink'"
        >
          <FaIcon :icon="tab.icon" class="text-[0.95rem] sm:text-[0.8rem]" />
          {{ tab.label }}
          <span
            v-if="tab.badge"
            class="absolute right-2 top-1 h-1.5 w-1.5 rounded-full bg-[var(--ember)] sm:static sm:ml-0.5"
          />
        </RouterLink>

        <button
          class="btn btn-primary mx-1 h-12 w-12 shrink-0 rounded-full p-0 shadow-[var(--shadow-float)] sm:h-9 sm:w-9"
          aria-label="Add a memory"
          @click="ui.compose()"
        >
          <FaIcon icon="plus" class="text-lg sm:text-sm" />
        </button>

        <RouterLink
          v-for="tab in tabs.slice(2)"
          :key="tab.name"
          :to="{ name: tab.name }"
          class="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[0.65rem] transition-colors sm:flex-none sm:flex-row sm:gap-1.5 sm:text-[0.8125rem]"
          :class="route.name === tab.name ? 'text-[var(--ember)]' : 'text-muted hover:text-ink'"
        >
          <FaIcon :icon="tab.icon" class="text-[0.95rem] sm:text-[0.8rem]" />
          {{ tab.label }}
        </RouterLink>
      </div>
    </nav>

    <EventForm
      :open="ui.composerOpen"
      :event="ui.editing"
      :preset-title="ui.preset.title"
      :preset-type="ui.preset.type"
      :preset-prompt="ui.preset.prompt"
      @close="ui.closeComposer()"
      @saved="onSaved"
    />
    <MemoryModal :event="ui.viewing" @close="ui.view(null)" @edit="ui.edit($event)" />

    <AppSheet
      :open="themeOpen"
      title="Choose a mood"
      :subtitle="`Currently ${currentTheme.label} — ${currentTheme.blurb.toLowerCase()}`"
      @close="themeOpen = false"
    >
      <ThemePicker
        :model-value="auth.couple?.theme ?? 'dawn'"
        :busy="savingTheme"
        @update:model-value="setTheme"
      />
    </AppSheet>
  </div>
</template>
