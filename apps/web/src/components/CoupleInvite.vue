<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import AppButton from './ui/AppButton.vue';

const auth = useAuthStore();
const toasts = useToastStore();
const working = ref(false);

const code = computed(() => auth.invitation?.code ?? null);
const link = computed(() => (code.value ? `${window.location.origin}/join/${code.value}` : ''));

async function generate(): Promise<void> {
  working.value = true;
  try {
    await auth.createInvitation();
  } catch {
    toasts.error('Could not create an invitation');
  } finally {
    working.value = false;
  }
}

async function share(): Promise<void> {
  if (!link.value) return;
  const text = `Join our timeline — the story of us. ${link.value}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Our timeline', text, url: link.value });
      return;
    } catch {
      /* the share sheet was dismissed — fall through to copying */
    }
  }
  await copy(link.value, 'Invite link copied');
}

async function copy(value: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toasts.push(message, 'warm');
  } catch {
    toasts.error('Copy failed — select it by hand');
  }
}
</script>

<template>
  <div class="card overflow-hidden">
    <div class="border-b border-line px-5 py-4">
      <h2 class="display text-[1.15rem]">
        <FaIcon icon="user-plus" class="mr-1.5 text-[0.85rem] text-[var(--ember)]" />
        Invite your partner
      </h2>
      <p class="mt-1 text-[0.8125rem] text-muted">
        One link, used once. You both write to the same timeline — nobody else can see it.
      </p>
    </div>

    <div v-if="code" class="px-5 py-4">
      <p class="eyebrow mb-2">Their code</p>
      <button
        class="display w-full rounded-xl border border-dashed border-line-strong bg-surface-sunk py-3 text-center text-[1.5rem] tracking-[0.22em] transition-colors hover:border-[color-mix(in_oklab,var(--ember)_45%,transparent)]"
        @click="copy(code, 'Code copied')"
      >
        {{ code }}
      </button>
      <div class="mt-3 flex gap-2">
        <AppButton variant="primary" icon="link" block @click="share">Share the link</AppButton>
        <AppButton variant="ghost" icon="copy" aria-label="Copy the invite link" @click="copy(link, 'Invite link copied')" />
      </div>
      <p class="mt-2.5 text-center text-[0.75rem] text-muted">
        Expires in 14 days · <button class="underline hover:text-ink" @click="generate">make a new one</button>
      </p>
    </div>

    <div v-else class="px-5 py-5">
      <AppButton variant="primary" icon="user-plus" block :loading="working" @click="generate">
        Create an invitation
      </AppButton>
    </div>
  </div>
</template>
