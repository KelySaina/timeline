<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import AppButton from '@/components/ui/AppButton.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const mode = ref<'signin' | 'signup'>('signup');
const email = ref('');
const password = ref('');
const displayName = ref('');
const busy = ref(false);
const error = ref('');
const fieldErrors = ref<Record<string, string>>({});

const isSignup = computed(() => mode.value === 'signup');

async function submit(): Promise<void> {
  busy.value = true;
  error.value = '';
  fieldErrors.value = {};
  try {
    if (isSignup.value) {
      await auth.signup({ email: email.value, password: password.value, displayName: displayName.value });
    } else {
      await auth.login({ email: email.value, password: password.value });
    }
    const next = typeof route.query.next === 'string' ? route.query.next : null;
    await router.replace(next ?? (auth.hasCouple ? '/' : { name: 'onboard' }));
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err.message;
      fieldErrors.value = err.fieldErrors;
    } else {
      error.value = 'Something went wrong. Try again.';
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col justify-center px-5 py-10">
    <div class="mx-auto w-full max-w-sm">
      <div class="text-center">
        <span
          class="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ember)_28%,transparent)] bg-[var(--ember-soft)] text-xl text-[var(--ember)]"
        >
          <FaIcon icon="heart" />
        </span>
        <h1 class="display mt-5 text-[2.1rem] leading-tight">Timeline</h1>
        <p class="mt-2 text-[0.95rem] text-muted">
          The story of the two of you, in order, kept private.
        </p>
      </div>

      <form class="mt-8 space-y-3.5" @submit.prevent="submit">
        <div v-if="isSignup">
          <label class="label" for="name">Your name</label>
          <input id="name" v-model="displayName" class="field" autocomplete="given-name" required />
          <p v-if="fieldErrors.displayName" class="mt-1 text-[0.8125rem] text-[var(--ember)]">
            {{ fieldErrors.displayName }}
          </p>
        </div>
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" type="email" class="field" autocomplete="email" required />
          <p v-if="fieldErrors.email" class="mt-1 text-[0.8125rem] text-[var(--ember)]">{{ fieldErrors.email }}</p>
        </div>
        <div>
          <label class="label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="field"
            :autocomplete="isSignup ? 'new-password' : 'current-password'"
            required
          />
          <p v-if="fieldErrors.password" class="mt-1 text-[0.8125rem] text-[var(--ember)]">
            {{ fieldErrors.password }}
          </p>
          <p v-else-if="isSignup" class="mt-1 text-[0.75rem] text-muted">At least 10 characters.</p>
        </div>

        <p v-if="error" class="rounded-xl bg-[var(--ember-soft)] px-3.5 py-2.5 text-[0.875rem] text-[var(--ember)]">
          {{ error }}
        </p>

        <AppButton type="submit" variant="primary" block :loading="busy">
          {{ isSignup ? 'Start our timeline' : 'Sign in' }}
        </AppButton>
      </form>

      <p class="mt-5 text-center text-[0.875rem] text-muted">
        {{ isSignup ? 'Already have an account?' : 'New here?' }}
        <button class="ml-1 font-semibold text-ink underline decoration-[var(--ember)] decoration-2 underline-offset-2" @click="mode = isSignup ? 'signin' : 'signup'">
          {{ isSignup ? 'Sign in' : 'Create an account' }}
        </button>
      </p>
      <p class="mt-8 text-center text-[0.75rem] text-muted">
        <FaIcon icon="lock" class="mr-1" />Private by default. Only the two of you ever see it.
      </p>
    </div>
  </div>
</template>
