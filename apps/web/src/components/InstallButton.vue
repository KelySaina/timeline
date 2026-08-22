<script setup lang="ts">
/**
 * Offers the app to the home screen, and only when that means something: nothing renders once
 * Timeline is already installed, or in a browser that cannot install at all.
 *
 * Two paths, because the platforms differ. Where the browser hands us a `beforeinstallprompt` we
 * fire the real thing on a click. On iOS there is no such event and no programmatic install, so we
 * show the two Share-sheet steps rather than a button that quietly does nothing.
 */
import { ref } from 'vue';
import { canInstall, canOfferInstall, needsManualInstall, promptInstall } from '@/lib/pwa';
import { useToastStore } from '@/stores/toast';
import AppSheet from './ui/AppSheet.vue';

const toasts = useToastStore();
const howTo = ref(false);
const busy = ref(false);

async function onClick(): Promise<void> {
  if (needsManualInstall.value) {
    howTo.value = true;
    return;
  }
  busy.value = true;
  try {
    if ((await promptInstall()) === 'accepted') toasts.warm('Timeline is on your home screen');
  } catch {
    // A browser that refuses the prompt is not an error worth a toast — the button just retires.
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    v-if="canOfferInstall"
    class="btn btn-quiet h-9 shrink-0 gap-1.5 rounded-full px-2.5 sm:px-3"
    :disabled="busy"
    :aria-label="canInstall ? 'Install Timeline as an app' : 'How to add Timeline to your home screen'"
    :title="canInstall ? 'Keep it on your home screen' : 'Add it to your home screen'"
    @click="onClick"
  >
    <FaIcon :icon="busy ? 'circle-notch' : 'mobile-screen-button'" :class="busy && 'animate-spin'" />
    <span class="hidden text-[0.8125rem] sm:inline">Install</span>
  </button>

  <AppSheet
    :open="howTo"
    title="Add Timeline to your home screen"
    subtitle="Two taps in Safari — iOS has no install button to press for you"
    @close="howTo = false"
  >
    <ol class="space-y-3">
      <li class="card-quiet flex items-start gap-3 px-4 py-3">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ember-soft)] text-[var(--ember)]">
          <FaIcon icon="arrow-up-from-bracket" />
        </span>
        <p class="min-w-0 flex-1 text-[0.9375rem]">
          <span class="text-ink">Tap Share</span>
          <span class="text-muted"> — the square with an arrow, in Safari's toolbar.</span>
        </p>
      </li>
      <li class="card-quiet flex items-start gap-3 px-4 py-3">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ember-soft)] text-[var(--ember)]">
          <FaIcon icon="square-plus" />
        </span>
        <p class="min-w-0 flex-1 text-[0.9375rem]">
          <span class="text-ink">Choose "Add to Home Screen"</span>
          <span class="text-muted"> — then Add. It opens without browser chrome after that.</span>
        </p>
      </li>
    </ol>
    <p class="mt-4 flex items-start gap-1.5 text-[0.75rem] text-muted">
      <FaIcon icon="heart" class="mt-[3px] text-[0.65rem] text-[var(--ember)]" />
      <span>Nothing is downloaded and nothing changes — it is the same private story, one tap closer.</span>
    </p>
  </AppSheet>
</template>
