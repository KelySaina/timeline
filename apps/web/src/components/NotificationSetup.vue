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
  prefs,
  ready,
  refresh,
  sendHour,
  sendTest,
  setPref,
  state,
  working,
} from '@/lib/notifications';
import type { NotificationPrefs } from '@/lib/notifications';
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

/**
 * The three kinds, in the order they earn their keep. Reminders are why anyone turns this on, so it
 * is first and defaults to on; the other two are additions, and each says plainly how often it
 * would interrupt — that is the fact people actually decide on.
 */
const KINDS: { key: keyof NotificationPrefs; label: string; blurb: string; icon: string }[] = [
  { key: 'reminders', label: 'Dates coming up', blurb: 'Anniversaries and birthdays, as far ahead as each one says.', icon: 'calendar-day' },
  { key: 'activity', label: 'When they add something', blurb: 'Within seconds of it being written. The frequent one.', icon: 'heart' },
  { key: 'onThisDay', label: 'On this day', blurb: 'Only on days that already hold a memory.', icon: 'clock' },
];

async function toggle(key: keyof NotificationPrefs, value: boolean): Promise<void> {
  try {
    await setPref(key, value);
  } catch {
    toasts.error('Could not save that');
  }
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
            Whatever is ticked below. Dates arrive at {{ hourLabel }} where you are.
            <template v-if="elsewhere > 0">
              Also on {{ elsewhere }} other device{{ elsewhere === 1 ? '' : 's' }}.
            </template>
          </template>
          <template v-else-if="state === 'off'">
            Choose what is worth interrupting you for, then turn it on. Dates arrive at
            {{ hourLabel }} where you are.
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

        <!--
          Shown while it is still off as well, because these are settings on the person and not on
          the browser: they decide what a device gets when it is turned on, here or somewhere else.
          Choosing first also means the reader knows what they are being asked to permit.
        -->
        <ul v-if="state === 'on' || state === 'off'" class="mt-3.5 space-y-2.5 border-t border-line pt-3.5">
          <li v-for="kind in KINDS" :key="kind.key" class="flex items-start gap-2.5">
            <FaIcon :icon="kind.icon" class="mt-1 shrink-0 text-[0.65rem] text-muted" />
            <label class="min-w-0 flex-1 cursor-pointer" :for="`notify-${kind.key}`">
              <span class="block text-[0.875rem] text-ink">{{ kind.label }}</span>
              <span class="block text-[0.75rem] text-muted">{{ kind.blurb }}</span>
            </label>
            <input
              :id="`notify-${kind.key}`"
              type="checkbox"
              class="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ember)]"
              :checked="prefs[kind.key]"
              :disabled="working"
              @change="toggle(kind.key, ($event.target as HTMLInputElement).checked)"
            />
          </li>
        </ul>

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
