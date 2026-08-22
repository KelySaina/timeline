<script setup lang="ts">
/**
 * The reminders switch, and — more importantly — the reason it cannot be flipped when it cannot.
 *
 * Every state gets its own sentence. A card that says "notifications are off" when the real answer
 * is "this browser cannot do it", "you have to install the app first", or "you said no and only
 * Settings can change that" sends the reader off to poke at a switch that will never work. So the
 * copy names the actual obstacle, and only offers a control where there is something a tap can do.
 */
import { computed, onMounted } from 'vue';
import {
  devices,
  disable,
  enable,
  ready,
  refresh,
  sendHour,
  sendTest,
  state,
  working,
} from '@/lib/notifications';
import { canOfferInstall } from '@/lib/pwa';
import { useToastStore } from '@/stores/toast';
import AppButton from './ui/AppButton.vue';

const toasts = useToastStore();

onMounted(() => {
  void refresh();
});

/** 9 → "9am", 14 → "2pm". */
const hourLabel = computed(() => {
  const h = sendHour.value;
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
});

const elsewhere = computed(() => Math.max(0, devices.value - (state.value === 'on' ? 1 : 0)));

async function turnOn(): Promise<void> {
  const result = await enable();
  if (result === 'on') toasts.push('Reminders are on for this device', 'warm');
  else if (result === 'blocked') {
    toasts.error('Your browser is blocking notifications — allow them in its site settings');
  }
}

async function turnOff(): Promise<void> {
  await disable();
  toasts.push('Reminders off for this device');
}

async function test(): Promise<void> {
  try {
    const delivered = await sendTest();
    // Zero delivered with permission granted almost always means the OS is silencing the app, and
    // that is invisible to the browser — so say what to check rather than claiming success.
    if (delivered > 0) toasts.push('Sent — it should appear in a moment', 'warm');
    else toasts.error('Nothing accepted it. Check notifications for this app in your device settings');
  } catch {
    toasts.error('Could not send a test');
  }
}
</script>

<template>
  <section v-if="ready" class="card mb-7 px-4 py-4 sm:px-5">
    <div class="flex items-start gap-3">
      <span
        class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full"
        :style="{
          background:
            state === 'on'
              ? 'color-mix(in oklab, var(--ember) 18%, transparent)'
              : 'var(--surface-sunk)',
          color: state === 'on' ? 'var(--ember)' : 'var(--ink-soft)',
        }"
      >
        <FaIcon :icon="state === 'on' ? 'bell' : 'bell-slash'" class="text-[0.85rem]" />
      </span>

      <div class="min-w-0 flex-1">
        <h2 class="display text-[1.05rem] leading-snug text-ink">
          {{ state === 'on' ? 'Reminders are on' : 'Get reminded' }}
        </h2>

        <!-- One sentence per state, naming the actual obstacle. -->
        <p class="mt-0.5 text-[0.8125rem] text-muted">
          <template v-if="state === 'on'">
            A notification lands at {{ hourLabel }}, however many days ahead each date says.
            <template v-if="elsewhere > 0">
              Also on {{ elsewhere }} other device{{ elsewhere === 1 ? '' : 's' }}.
            </template>
          </template>
          <template v-else-if="state === 'off'">
            A notification at {{ hourLabel }}, as far ahead as each date below says. Nothing else —
            no digests, no activity.
          </template>
          <template v-else-if="state === 'needs-install'">
            On iPhone and iPad, notifications only work once the app is on your home screen.
            <template v-if="canOfferInstall">Use the install button in the header first.</template>
          </template>
          <template v-else-if="state === 'blocked'">
            Your browser is blocking notifications for this app. Only its site settings can undo
            that — the page is not allowed to ask again.
          </template>
          <template v-else-if="state === 'no-worker'">
            No service worker is registered in this build, so there is nothing to subscribe.
            Notifications work in the installed app and on the deployed site.
          </template>
          <template v-else-if="state === 'unconfigured'">
            Notifications are not set up on this server yet, so there is nothing to switch on.
          </template>
          <template v-else>
            This browser cannot receive notifications. A private window, or a version too old for
            the Push API.
          </template>
        </p>

        <div v-if="state === 'on' || state === 'off'" class="mt-3 flex flex-wrap items-center gap-2">
          <AppButton v-if="state === 'off'" variant="primary" :loading="working" @click="turnOn">
            Turn on
          </AppButton>
          <template v-else>
            <AppButton variant="ghost" :loading="working" @click="test">Send a test</AppButton>
            <AppButton variant="quiet" :loading="working" @click="turnOff">Turn off</AppButton>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
