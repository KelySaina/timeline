<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import type { InvitePreview } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { formatEventDate } from '@/lib/format';
import AppButton from '@/components/ui/AppButton.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const code = String(route.params.code ?? '');
const preview = ref<InvitePreview | null>(null);
const error = ref('');
const busy = ref(false);
const loading = ref(true);

onMounted(async () => {
  if (auth.hasCouple) {
    error.value = 'You are already part of a timeline on this account.';
    loading.value = false;
    return;
  }
  try {
    preview.value = await auth.previewInvitation(code);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'That invitation is not valid';
  } finally {
    loading.value = false;
  }
});

async function accept(): Promise<void> {
  busy.value = true;
  try {
    await auth.acceptInvitation(code);
    await router.replace('/');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not join';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10 text-center">
    <div v-if="loading" class="text-muted"><FaIcon icon="circle-notch" class="animate-spin text-xl" /></div>

    <template v-else-if="preview">
      <span
        class="animate-heart mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ember)_28%,transparent)] bg-[var(--ember-soft)] text-xl text-[var(--ember)]"
      >
        <FaIcon icon="heart" />
      </span>
      <h1 class="display mt-5 text-[1.9rem] leading-tight">
        {{ preview.invitedBy }} invited you
      </h1>
      <p class="mt-2 text-[0.95rem] text-muted">
        to keep <strong class="text-ink">{{ preview.coupleTitle || 'their timeline' }}</strong> together.
        <template v-if="preview.startedOn">
          It starts on {{ formatEventDate(preview.startedOn) }}.
        </template>
      </p>
      <AppButton class="mt-7" variant="primary" block :loading="busy" icon="heart" @click="accept">
        Join our timeline
      </AppButton>
      <p class="mt-3 text-[0.75rem] text-muted">
        You will both be able to add, edit and read every memory.
      </p>
    </template>

    <template v-else>
      <h1 class="display text-[1.6rem]">This invitation has expired</h1>
      <p class="mt-2 text-[0.95rem] text-muted">{{ error }}</p>
      <AppButton class="mt-6" variant="ghost" block @click="router.replace('/')">Go back</AppButton>
    </template>
  </div>
</template>
