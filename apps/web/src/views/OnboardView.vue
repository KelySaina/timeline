<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { todayIso } from '@/lib/format';
import AppButton from '@/components/ui/AppButton.vue';

const auth = useAuthStore();
const router = useRouter();

const tab = ref<'create' | 'join'>('create');
const title = ref('');
const startedOn = ref('');
const code = ref('');
const busy = ref(false);
const error = ref('');

async function create(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await auth.createCouple({ title: title.value.trim() || null, startedOn: startedOn.value || null });
    await router.replace('/');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not create your timeline';
  } finally {
    busy.value = false;
  }
}

async function join(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await auth.acceptInvitation(code.value.trim().toUpperCase());
    await router.replace('/');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'That code did not work';
  } finally {
    busy.value = false;
  }
}

async function signOut(): Promise<void> {
  await auth.logout();
  await router.replace({ name: 'auth' });
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
    <h1 class="display text-[2rem] leading-tight">
      Hello {{ auth.user?.displayName }}.
    </h1>
    <p class="mt-2 text-[0.95rem] text-muted">
      A timeline belongs to two people. Start one, or join the one you were invited to.
    </p>

    <div class="mt-6 flex gap-2">
      <button class="chip" :class="tab === 'create' && 'is-active'" @click="tab = 'create'">
        <FaIcon icon="heart" class="text-[0.7rem]" />Start ours
      </button>
      <button class="chip" :class="tab === 'join' && 'is-active'" @click="tab = 'join'">
        <FaIcon icon="link" class="text-[0.7rem]" />I have a code
      </button>
    </div>

    <form v-if="tab === 'create'" class="card mt-4 space-y-4 p-5" @submit.prevent="create">
      <div>
        <label class="label" for="couple-title">What should we call it?</label>
        <input id="couple-title" v-model="title" class="field" placeholder="Alex & Mira" maxlength="80" />
        <p class="mt-1 text-[0.75rem] text-muted">Optional — your names work fine.</p>
      </div>
      <div>
        <label class="label" for="started">When did you become official?</label>
        <input id="started" v-model="startedOn" type="date" :max="todayIso()" class="field tabular-nums" />
        <p class="mt-1 text-[0.75rem] text-muted">
          This drives your anniversary countdown. You can set it later.
        </p>
      </div>
      <p v-if="error" class="text-[0.875rem] text-[var(--ember)]">{{ error }}</p>
      <AppButton type="submit" variant="primary" block :loading="busy" icon="heart">
        Create our timeline
      </AppButton>
    </form>

    <form v-else class="card mt-4 space-y-4 p-5" @submit.prevent="join">
      <div>
        <label class="label" for="code">Invitation code</label>
        <input
          id="code"
          v-model="code"
          class="field display text-center text-[1.35rem] tracking-[0.2em] uppercase"
          placeholder="XXXXXXXXXX"
          maxlength="12"
          autocapitalize="characters"
        />
      </div>
      <p v-if="error" class="text-[0.875rem] text-[var(--ember)]">{{ error }}</p>
      <AppButton type="submit" variant="primary" block :loading="busy" :disabled="code.trim().length < 6">
        Join their timeline
      </AppButton>
    </form>

    <button class="mt-6 text-center text-[0.8125rem] text-muted hover:text-ink" @click="signOut">
      <FaIcon icon="right-from-bracket" class="mr-1" />Sign out
    </button>
  </div>
</template>
