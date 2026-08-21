<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { DatePrecision, EventDraft, EventType, TimelineEvent } from '@/api/types';
import { moodList, typeMeta } from '@/lib/eventTypes';
import { todayIso } from '@/lib/format';
import { ApiError } from '@/api/client';
import { useTimelineStore } from '@/stores/timeline';
import { useToastStore } from '@/stores/toast';
import AppButton from './ui/AppButton.vue';
import AppSheet from './ui/AppSheet.vue';
import TagInput from './ui/TagInput.vue';
import TypePicker from './ui/TypePicker.vue';

const props = defineProps<{
  open: boolean;
  event?: TimelineEvent | null;
  presetTitle?: string;
  presetType?: EventType;
  presetPrompt?: string;
}>();
const emit = defineEmits<{ close: []; saved: [TimelineEvent] }>();

const timeline = useTimelineStore();
const toasts = useToastStore();

const type = ref<EventType>('memory');
const title = ref('');
const description = ref('');
const eventDate = ref(todayIso());
const endDate = ref<string>('');
const precision = ref<DatePrecision>('day');
const location = ref('');
const mood = ref<string | null>(null);
const tags = ref<string[]>([]);
const files = ref<File[]>([]);
const previews = ref<string[]>([]);

const expanded = ref(false);
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const titleInput = ref<HTMLInputElement | null>(null);

const isEditing = computed(() => Boolean(props.event));
const meta = computed(() => typeMeta(type.value));
const isFuture = computed(() => eventDate.value > todayIso());
const canSave = computed(() => title.value.trim().length > 0 && Boolean(eventDate.value) && !saving.value);

/** The date input matches the precision: a whole month or a whole year is a valid memory. */
const dateInputType = computed(() => (precision.value === 'day' ? 'date' : precision.value === 'month' ? 'month' : 'number'));
const dateInputValue = computed(() => {
  if (precision.value === 'day') return eventDate.value;
  if (precision.value === 'month') return eventDate.value.slice(0, 7);
  return eventDate.value.slice(0, 4);
});

function setDateFromInput(raw: string): void {
  if (!raw) return;
  if (precision.value === 'day') eventDate.value = raw;
  else if (precision.value === 'month') eventDate.value = `${raw}-01`;
  else if (/^\d{4}$/.test(raw)) eventDate.value = `${raw}-01-01`;
}

const suggestedTags = computed(() => {
  const seen = new Map<string, number>();
  for (const event of timeline.events) {
    for (const tag of event.tags) seen.set(tag, (seen.get(tag) ?? 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
});

function reset(): void {
  const source = props.event;
  type.value = source?.type ?? props.presetType ?? 'memory';
  title.value = source?.title ?? props.presetTitle ?? '';
  description.value = source?.description ?? '';
  eventDate.value = source?.eventDate ?? todayIso();
  endDate.value = source?.endDate ?? '';
  precision.value = source?.datePrecision ?? 'day';
  location.value = source?.location ?? '';
  mood.value = source?.mood ?? null;
  tags.value = [...(source?.tags ?? [])];
  files.value = [];
  previews.value.forEach(URL.revokeObjectURL);
  previews.value = [];
  errors.value = {};
  expanded.value = Boolean(source?.description || source?.location || source?.mood || source?.tags.length);
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    reset();
    await nextTick();
    // Land the cursor where the thinking happens, not on the first field of a form.
    if (!title.value) titleInput.value?.focus();
  },
  { immediate: true },
);

function pickFiles(event: Event): void {
  const picked = [...((event.target as HTMLInputElement).files ?? [])];
  const room = 10 - files.value.length;
  files.value = [...files.value, ...picked.slice(0, room)];
  previews.value = [...previews.value, ...picked.slice(0, room).map((file) => URL.createObjectURL(file))];
  expanded.value = true;
}

function dropFile(index: number): void {
  const [url] = previews.value.splice(index, 1);
  if (url) URL.revokeObjectURL(url);
  files.value.splice(index, 1);
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  errors.value = {};
  try {
    const draft: EventDraft = {
      type: type.value,
      title: title.value.trim(),
      eventDate: eventDate.value,
      datePrecision: precision.value,
      description: description.value.trim() || null,
      endDate: endDate.value || null,
      location: location.value.trim() || null,
      mood: (mood.value as EventDraft['mood']) ?? null,
      tags: tags.value,
    };

    let saved = props.event
      ? await timeline.update(props.event.id, draft)
      : await timeline.create(draft);

    if (files.value.length) {
      saved = await timeline.addPhotos(saved.id, files.value);
    }

    toasts.push(
      props.event ? 'Memory updated' : isFuture.value ? 'Added to what’s coming' : 'Added to your story',
      'warm',
    );
    emit('saved', saved);
    emit('close');
  } catch (error) {
    if (error instanceof ApiError) {
      errors.value = error.fieldErrors;
      toasts.error(error.message);
    } else {
      toasts.error(error instanceof Error ? error.message : 'That did not save');
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppSheet
    :open="open"
    size="lg"
    :title="isEditing ? 'Edit memory' : 'Add a memory'"
    :subtitle="presetPrompt || (isFuture ? 'A date in the future — it will wait for you under Upcoming.' : undefined)"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <!-- 1. When -->
      <div>
        <div class="mb-1.5 flex items-center justify-between gap-2">
          <span class="label mb-0">When</span>
          <div class="flex gap-1">
            <button
              v-for="option in (['day', 'month', 'year'] as DatePrecision[])"
              :key="option"
              class="chip px-2.5 py-1 text-[0.7rem]"
              :class="precision === option && 'is-active'"
              @click="precision = option"
            >
              {{ option === 'day' ? 'Exact day' : option === 'month' ? 'A month' : 'A year' }}
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input
            :type="dateInputType"
            :value="dateInputValue"
            :min="precision === 'year' ? 1900 : undefined"
            :max="precision === 'year' ? 2200 : undefined"
            class="field w-auto flex-1 tabular-nums"
            @input="setDateFromInput(($event.target as HTMLInputElement).value)"
          />
          <button v-if="precision === 'day' && eventDate !== todayIso()" class="chip" @click="eventDate = todayIso()">
            Today
          </button>
        </div>
        <button
          v-if="!endDate && precision === 'day'"
          class="mt-2 text-[0.8125rem] text-muted transition-colors hover:text-ink"
          @click="endDate = eventDate"
        >
          <FaIcon icon="plus" class="text-[0.6rem]" /> It lasted several days
        </button>
        <div v-else-if="endDate" class="mt-2 flex items-center gap-2">
          <span class="text-[0.8125rem] text-muted">until</span>
          <input v-model="endDate" type="date" :min="eventDate" class="field w-auto flex-1 tabular-nums" />
          <button class="btn btn-quiet h-9 w-9 rounded-full p-0" aria-label="Remove end date" @click="endDate = ''">
            <FaIcon icon="xmark" />
          </button>
        </div>
        <p v-if="errors.endDate" class="mt-1.5 text-[0.8125rem] text-[var(--ember)]">{{ errors.endDate }}</p>
      </div>

      <!-- 2. What kind -->
      <div>
        <span class="label">What kind of moment</span>
        <TypePicker v-model="type" />
      </div>

      <!-- 3. Title -->
      <div>
        <label class="label" for="memory-title">Title</label>
        <input
          id="memory-title"
          ref="titleInput"
          v-model="title"
          class="field display text-[1.05rem]"
          :placeholder="meta.hint"
          maxlength="140"
          @keydown.meta.enter="save"
        />
        <p v-if="errors.title" class="mt-1.5 text-[0.8125rem] text-[var(--ember)]">{{ errors.title }}</p>
      </div>

      <!-- Everything below is optional and one tap away. -->
      <button
        v-if="!expanded"
        class="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong py-3 text-[0.875rem] text-muted transition-colors hover:border-[color-mix(in_oklab,var(--ember)_40%,transparent)] hover:text-ink"
        @click="expanded = true"
      >
        <FaIcon icon="plus" class="text-[0.7rem]" />
        Add the story, photos, place, mood
      </button>

      <div v-else class="space-y-5 border-t border-line pt-5">
        <div>
          <label class="label" for="memory-story">The story</label>
          <textarea
            id="memory-story"
            v-model="description"
            rows="4"
            class="field resize-y leading-relaxed"
            placeholder="What happened, what was said, what you want to remember in ten years."
            maxlength="5000"
          />
        </div>

        <div>
          <span class="label">Photos</span>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(preview, index) in previews"
              :key="preview"
              class="relative h-20 w-20 overflow-hidden rounded-xl border border-line"
            >
              <img :src="preview" alt="" class="h-full w-full object-cover" />
              <button
                class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--ink)_70%,transparent)] text-[0.6rem] text-white"
                aria-label="Remove photo"
                @click="dropFile(index)"
              >
                <FaIcon icon="xmark" />
              </button>
            </div>
            <label
              v-if="files.length < 10"
              class="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-muted transition-colors hover:border-[color-mix(in_oklab,var(--ember)_40%,transparent)] hover:text-ink"
            >
              <FaIcon icon="camera" />
              <span class="text-[0.65rem]">Add</span>
              <input type="file" accept="image/*" multiple class="hidden" @change="pickFiles" />
            </label>
          </div>
          <p v-if="event?.photos.length" class="mt-2 text-[0.75rem] text-muted">
            {{ event.photos.length }} photo{{ event.photos.length === 1 ? '' : 's' }} already saved — new ones are added.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="memory-place">Place</label>
            <input id="memory-place" v-model="location" class="field" placeholder="Nosy Be" maxlength="160" />
          </div>
          <div>
            <span class="label">Mood</span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="item in moodList"
                :key="item.mood"
                class="chip px-2.5 py-1"
                :class="mood === item.mood && 'is-active'"
                @click="mood = mood === item.mood ? null : item.mood"
              >
                <span>{{ item.emoji }}</span>{{ item.label }}
              </button>
            </div>
          </div>
        </div>

        <div>
          <span class="label">Tags</span>
          <TagInput v-model="tags" :suggestions="suggestedTags" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <p class="hidden min-w-0 flex-1 text-[0.75rem] text-muted sm:block">
          <template v-if="isFuture">
            <FaIcon icon="clock" class="mr-1" />Saved as a plan
          </template>
          <template v-else>
            <FaIcon icon="lock" class="mr-1" />Private to the two of you
          </template>
        </p>
        <AppButton variant="quiet" @click="emit('close')">Cancel</AppButton>
        <AppButton variant="primary" :loading="saving" :disabled="!canSave" icon="heart" @click="save">
          {{ isEditing ? 'Save' : 'Add to our story' }}
        </AppButton>
      </div>
    </template>
  </AppSheet>
</template>
