<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useTimelineStore } from '@/stores/timeline';
import { useToastStore } from '@/stores/toast';
import { formatEventDate, possessive } from '@/lib/format';
import { COLLECTIONS, THEMES, themeMeta } from '@/lib/themes';
import { storyLayoutMeta } from '@/lib/storyLayouts';
import AppButton from '@/components/ui/AppButton.vue';
import Avatar from '@/components/ui/Avatar.vue';
import CoupleInvite from '@/components/CoupleInvite.vue';

const auth = useAuthStore();
const timeline = useTimelineStore();
const toasts = useToastStore();
const router = useRouter();

const editing = ref(false);
const title = ref(auth.couple?.title ?? '');
const startedOn = ref(auth.couple?.startedOn ?? '');
const displayName = ref(auth.user?.displayName ?? '');
const birthday = ref(auth.user?.birthday ?? '');
const saving = ref(false);

const together = computed(() => auth.couple?.together ?? null);
const stats = computed(() => auth.couple?.stats);

const firstMemory = computed(() => timeline.summary?.firstDate ?? null);
const currentTheme = computed(() => themeMeta(auth.couple?.theme));
const currentLayout = computed(() => storyLayoutMeta(auth.couple?.storyLayout));

async function save(): Promise<void> {
  saving.value = true;
  try {
    await auth.updateCouple({ title: title.value.trim() || null, startedOn: startedOn.value || null });
    if (displayName.value !== auth.user?.displayName || (birthday.value || null) !== auth.user?.birthday) {
      await auth.updateProfile({ displayName: displayName.value.trim(), birthday: birthday.value || null });
    }
    await timeline.loadUpcoming();
    editing.value = false;
    toasts.push('Saved', 'warm');
  } catch (error) {
    toasts.error(error instanceof ApiError ? error.message : 'Could not save that');
  } finally {
    saving.value = false;
  }
}

async function pickAvatar(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await auth.uploadAvatar(file);
    toasts.push('New photo saved', 'warm');
  } catch {
    toasts.error('That photo did not upload');
  }
}

async function signOut(): Promise<void> {
  await auth.logout();
  timeline.reset();
  await router.replace({ name: 'auth' });
}
</script>

<template>
  <div v-if="auth.couple">
    <!-- The couple, as a keepsake rather than a settings page. -->
    <section class="card overflow-hidden">
      <div class="relative h-24 bg-[radial-gradient(120%_140%_at_20%_0%,color-mix(in_oklab,var(--ember)_22%,transparent),transparent_70%)]" />
      <div class="-mt-10 px-5 pb-5">
        <div class="flex items-end gap-3">
          <label
            v-for="member in auth.couple.members"
            :key="member.id"
            class="relative"
            :class="member.id === auth.user?.id && 'cursor-pointer'"
          >
            <Avatar
              :user-id="member.id"
              :name="member.displayName"
              :has-avatar="member.hasAvatar"
              :size="72"
              class="ring-4 ring-[var(--surface)]"
            />
            <span
              v-if="member.id === auth.user?.id"
              class="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ember)] text-[0.6rem] text-white"
            >
              <FaIcon icon="camera" />
            </span>
            <input
              v-if="member.id === auth.user?.id"
              type="file"
              accept="image/*"
              class="hidden"
              @change="pickAvatar"
            />
          </label>
        </div>

        <h1 class="display mt-4 text-[1.6rem] leading-tight">
          {{ auth.couple.title || auth.displayNames.join(' & ') }}
        </h1>

        <p v-if="together" class="mt-1 text-[0.9375rem] text-muted">
          <FaIcon icon="heart" class="mr-1 text-[0.8rem] text-[var(--ember)]" />
          Together for
          <strong class="font-semibold text-ink">
            {{ together.years }} year{{ together.years === 1 ? '' : 's' }},
            {{ together.months }} month{{ together.months === 1 ? '' : 's' }},
            {{ together.days }} day{{ together.days === 1 ? '' : 's' }}
          </strong>
          <span class="block text-[0.8125rem]">
            {{ together.totalDays.toLocaleString() }} days since {{ formatEventDate(auth.couple.startedOn!) }}
          </span>
        </p>
        <p v-else class="mt-1 text-[0.9rem] text-muted">
          Add the day you became official to start the counter.
        </p>

        <dl v-if="stats" class="mt-5 grid grid-cols-4 gap-2">
          <div v-for="stat in [
            { label: 'Memories', value: stats.memories },
            { label: 'Trips', value: stats.trips },
            { label: 'Milestones', value: stats.milestones },
            { label: 'Photos', value: stats.photos },
          ]" :key="stat.label" class="card-quiet px-2 py-2.5 text-center">
            <dt class="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">{{ stat.label }}</dt>
            <dd class="display mt-0.5 text-[1.3rem] tabular-nums">{{ stat.value }}</dd>
          </div>
        </dl>

        <p v-if="firstMemory" class="mt-3 text-center text-[0.75rem] text-muted">
          Your story reaches back to {{ formatEventDate(firstMemory) }}.
        </p>
      </div>
    </section>

    <CoupleInvite v-if="auth.isSolo" class="mt-4" />

    <section class="card mt-4 overflow-hidden">
      <button
        class="flex w-full items-center gap-3 px-5 py-4 text-left"
        @click="editing = !editing"
      >
        <FaIcon icon="pen" class="text-muted" />
        <span class="flex-1 text-[0.9375rem]">Names, start date, your birthday</span>
        <FaIcon icon="chevron-down" class="text-muted transition-transform duration-200" :class="editing && 'rotate-180'" />
      </button>

      <div v-if="editing" class="space-y-4 border-t border-line px-5 py-5">
        <div>
          <label class="label" for="p-title">What we call it</label>
          <input id="p-title" v-model="title" class="field" placeholder="Alex & Mira" maxlength="80" />
        </div>
        <div>
          <label class="label" for="p-started">Together since</label>
          <input id="p-started" v-model="startedOn" type="date" class="field tabular-nums" />
          <p class="mt-1 text-[0.75rem] text-muted">Drives the anniversary reminder every year.</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="p-name">Your name</label>
            <input id="p-name" v-model="displayName" class="field" maxlength="60" />
          </div>
          <div>
            <label class="label" for="p-birthday">Your birthday</label>
            <input id="p-birthday" v-model="birthday" type="date" class="field tabular-nums" />
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <AppButton variant="quiet" @click="editing = false">Cancel</AppButton>
          <AppButton variant="primary" :loading="saving" @click="save">Save</AppButton>
        </div>
      </div>
    </section>

    <section class="card mt-4 divide-y divide-[var(--line)]">
      <RouterLink :to="{ name: 'story' }" class="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[var(--surface-sunk)]">
        <FaIcon icon="sort" class="text-muted" />
        <span class="min-w-0 flex-1 text-[0.9375rem]">
          Story shape
          <span class="block truncate text-[0.75rem] text-muted">
            Reading it as {{ currentLayout.label }} — {{ currentLayout.blurb.toLowerCase() }}
          </span>
        </span>
        <FaIcon icon="chevron-right" class="shrink-0 text-[0.75rem] text-muted" />
      </RouterLink>

      <RouterLink :to="{ name: 'themes' }" class="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[var(--surface-sunk)]">
        <FaIcon icon="palette" class="text-muted" />
        <span class="min-w-0 flex-1 text-[0.9375rem]">
          Theme store
          <span class="block truncate text-[0.75rem] text-muted">
            Wearing {{ currentTheme.label }} — {{ THEMES.length }} looks across
            {{ COLLECTIONS.length }} collections
          </span>
        </span>
        <span
          class="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line"
          :class="`theme-${auth.couple.theme}`"
          style="background: var(--paper)"
          aria-hidden="true"
        >
          <span class="h-3.5 w-3.5 rounded-full" style="background: var(--ember)" />
        </span>
        <FaIcon icon="chevron-right" class="shrink-0 text-[0.75rem] text-muted" />
      </RouterLink>
      <!--
        A plain link, not a fetch. The archive is built as it is sent and can run to gigabytes, so
        the browser has to be the thing saving it — pulling it through JavaScript would mean holding
        the whole story in memory first.
      -->
      <a
        href="/api/export"
        download
        class="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[var(--surface-sunk)]"
      >
        <FaIcon icon="download" class="text-muted" />
        <span class="min-w-0 flex-1 text-[0.9375rem]">
          Take a copy
          <span class="block text-[0.75rem] text-muted">
            Every memory and every photo in one file, with a page that opens in any browser —
            no app, no internet.
          </span>
        </span>
        <FaIcon icon="chevron-right" class="shrink-0 text-[0.75rem] text-muted" />
      </a>

      <div class="flex items-center gap-3 px-5 py-4">
        <FaIcon icon="lock" class="text-muted" />
        <span class="flex-1 text-[0.9375rem]">
          Private timeline
          <span class="block text-[0.75rem] text-muted">
            Only {{ auth.displayNames.join(' and ') }} can open it. Photos are served to you alone.
          </span>
        </span>
      </div>
      <div v-if="auth.partner" class="flex items-center gap-3 px-5 py-4">
        <FaIcon icon="cake-candles" class="text-muted" />
        <span class="flex-1 text-[0.9375rem]">
          {{ possessive(auth.partner.displayName) }} birthday
          <span class="block text-[0.75rem] text-muted">
            {{ auth.partner.birthday ? formatEventDate(auth.partner.birthday) : 'They can add it from their own profile' }}
          </span>
        </span>
      </div>
      <button class="flex w-full items-center gap-3 px-5 py-4 text-left text-[0.9375rem]" @click="signOut">
        <FaIcon icon="right-from-bracket" class="text-muted" />
        <span class="flex-1">Sign out</span>
      </button>
    </section>

    <p class="mt-6 text-center text-[0.75rem] text-muted">
      Timeline · kept for years, not for feeds.
    </p>
  </div>
</template>
