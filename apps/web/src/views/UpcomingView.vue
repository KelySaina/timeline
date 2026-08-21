<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import type { RecurringDate, UpcomingItem } from '@/api/types';
import { monthName } from '@/lib/format';
import { useTimelineStore } from '@/stores/timeline';
import { useToastStore } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import AppButton from '@/components/ui/AppButton.vue';
import AppSheet from '@/components/ui/AppSheet.vue';
import UpcomingEvents from '@/components/UpcomingEvents.vue';

const timeline = useTimelineStore();
const toasts = useToastStore();
const ui = useUiStore();
const router = useRouter();

const recurring = ref<RecurringDate[]>([]);
const sheetOpen = ref(false);
const form = ref({ title: '', month: 1, day: 1 });
const saving = ref(false);

const soon = computed(() => timeline.upcoming.filter((item) => item.daysUntil <= 60));
const later = computed(() => timeline.upcoming.filter((item) => item.daysUntil > 60));
const plans = computed(() => timeline.upcoming.filter((item) => item.kind === 'plan'));

onMounted(async () => {
  await timeline.loadUpcoming();
  recurring.value = (await api.get<{ recurring: RecurringDate[] }>('/recurring')).recurring;
});

async function addRecurring(): Promise<void> {
  saving.value = true;
  try {
    const payload = await api.post<{ recurring: RecurringDate[] }>('/recurring', form.value);
    recurring.value = payload.recurring;
    await timeline.loadUpcoming();
    sheetOpen.value = false;
    form.value = { title: '', month: 1, day: 1 };
    toasts.push('Reminder added', 'warm');
  } catch {
    toasts.error('Could not add that reminder');
  } finally {
    saving.value = false;
  }
}

async function removeRecurring(item: RecurringDate): Promise<void> {
  try {
    const payload = await api.del<{ recurring: RecurringDate[] }>(`/recurring/${item.id}`);
    recurring.value = payload.recurring;
    await timeline.loadUpcoming();
  } catch {
    toasts.error('Could not remove that reminder');
  }
}

async function open(item: UpcomingItem): Promise<void> {
  if (!item.eventId) return;
  const event = timeline.byId(item.eventId) ?? (await timeline.fetchOne(item.eventId).catch(() => null));
  if (event) {
    ui.view(event);
    void router.push({ name: 'memory', params: { id: event.id } });
  }
}
</script>

<template>
  <div>
    <header class="mb-6">
      <h1 class="display text-[1.75rem]">What's coming</h1>
      <p class="mt-1 text-[0.9rem] text-muted">
        Anniversaries, birthdays and the plans you have already made.
      </p>
    </header>

    <UpcomingEvents v-if="soon.length" :items="soon" heading="Next 60 days" class="mb-7" @open="open" />

    <div v-else class="card-quiet mb-7 px-4 py-6 text-center text-[0.9rem] text-muted">
      Nothing in the next two months. Quiet season.
    </div>

    <UpcomingEvents v-if="later.length" :items="later" heading="Later this year" class="mb-7" @open="open" />

    <section class="mb-7">
      <div class="mb-2.5 flex items-center justify-between">
        <h2 class="eyebrow mb-0">Yearly dates</h2>
        <button class="chip" @click="sheetOpen = true">
          <FaIcon icon="plus" class="text-[0.6rem]" />Add
        </button>
      </div>
      <ul class="card divide-y divide-[var(--line)]">
        <li v-for="item in recurring" :key="item.id" class="flex items-center gap-3 px-4 py-3">
          <span class="display w-16 shrink-0 text-[0.8125rem] tabular-nums text-muted">
            {{ monthName(item.month, true) }} {{ item.day }}
          </span>
          <span class="min-w-0 flex-1 truncate text-[0.9375rem]">{{ item.title }}</span>
          <span v-if="!item.editable" class="text-[0.7rem] text-muted">
            <FaIcon icon="lock" class="mr-1 text-[0.6rem]" />from your profile
          </span>
          <button
            v-else
            class="btn btn-quiet h-8 w-8 rounded-full p-0"
            :aria-label="`Remove ${item.title}`"
            @click="removeRecurring(item)"
          >
            <FaIcon icon="trash-can" class="text-[0.75rem]" />
          </button>
        </li>
        <li v-if="!recurring.length" class="px-4 py-6 text-center text-[0.875rem] text-muted">
          Set your start date and birthdays in <RouterLink :to="{ name: 'profile' }" class="underline">Us</RouterLink>,
          and they will show up here every year.
        </li>
      </ul>
    </section>

    <section>
      <div class="mb-2.5 flex items-center justify-between">
        <h2 class="eyebrow mb-0">Plans on the timeline</h2>
        <button class="chip" @click="ui.compose({ prompt: 'Something you are looking forward to.' })">
          <FaIcon icon="plus" class="text-[0.6rem]" />Add a plan
        </button>
      </div>
      <UpcomingEvents v-if="plans.length" :items="plans" @open="open" />
      <p v-else class="card-quiet px-4 py-6 text-center text-[0.9rem] text-muted">
        No future memories yet. A trip, a dinner, a promise — put it here and it waits for you.
      </p>
    </section>

    <AppSheet :open="sheetOpen" title="A date every year" @close="sheetOpen = false">
      <div class="space-y-4">
        <div>
          <label class="label" for="recurring-title">What is it?</label>
          <input id="recurring-title" v-model="form.title" class="field" placeholder="The day we met" maxlength="120" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="recurring-month">Month</label>
            <select id="recurring-month" v-model.number="form.month" class="field">
              <option v-for="m in 12" :key="m" :value="m">{{ monthName(m) }}</option>
            </select>
          </div>
          <div>
            <label class="label" for="recurring-day">Day</label>
            <input id="recurring-day" v-model.number="form.day" type="number" min="1" max="31" class="field tabular-nums" />
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <AppButton variant="quiet" @click="sheetOpen = false">Cancel</AppButton>
          <AppButton variant="primary" :loading="saving" :disabled="!form.title.trim()" @click="addRecurring">
            Add reminder
          </AppButton>
        </div>
      </template>
    </AppSheet>
  </div>
</template>
