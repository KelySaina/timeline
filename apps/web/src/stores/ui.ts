import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { EventType, TimelineEvent } from '@/api/types';

/**
 * Two global surfaces — the composer and the memory viewer — live here so any view can open them
 * without prop-drilling, and only one of each can ever be open.
 */
export const useUiStore = defineStore('ui', () => {
  const composerOpen = ref(false);
  const editing = ref<TimelineEvent | null>(null);
  const preset = ref<{ title?: string; type?: EventType; prompt?: string }>({});
  const viewing = ref<TimelineEvent | null>(null);

  function compose(next: { title?: string; type?: EventType; prompt?: string } = {}): void {
    editing.value = null;
    preset.value = next;
    viewing.value = null;
    composerOpen.value = true;
  }

  function edit(event: TimelineEvent): void {
    viewing.value = null;
    preset.value = {};
    editing.value = event;
    composerOpen.value = true;
  }

  function closeComposer(): void {
    composerOpen.value = false;
    editing.value = null;
    preset.value = {};
  }

  const view = (event: TimelineEvent | null) => {
    viewing.value = event;
  };

  return { composerOpen, editing, preset, viewing, compose, edit, closeComposer, view };
});
