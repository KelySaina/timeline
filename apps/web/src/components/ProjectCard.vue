<script setup lang="ts">
/**
 * One project, with its checklist.
 *
 * The steps are the body of the card rather than something behind a tap, because ticking one is the
 * commonest thing anyone does here and hiding it behind an expand would cost a tap every time.
 * Everything else — editing, moving, removing — is one level down, since it happens rarely.
 */
import { computed, ref } from 'vue';
import type { Project, ProjectStatus } from '@/api/types';
import { typeMeta } from '@/lib/eventTypes';

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{
  tick: [{ stepId: string; done: boolean }];
  edit: [];
  move: [ProjectStatus];
  finish: [{ eventDate: string; files: File[] }];
  postpone: [];
  openMemory: [];
  remove: [];
}>();

const menu = ref(false);
const confirmingFinish = ref(false);
/** Defaults to today, because most things are marked done the day they happen. */
const finishedOn = ref(new Date().toISOString().slice(0, 10));
/**
 * Photos of the thing, offered here rather than only on the memory afterwards. This is the moment
 * someone has them — they just did the thing — and sending them to "open the memory and edit it"
 * costs the moment.
 */
const files = ref<File[]>([]);

function pickFiles(event: Event): void {
  const picked = [...((event.target as HTMLInputElement).files ?? [])];
  // Ten per memory, the same cap the composer enforces and the API checks.
  files.value = [...files.value, ...picked.slice(0, 10 - files.value.length)];
}

/** The same icon and colour the memory will carry, so the two screens agree about what this is. */
const meta = computed(() => typeMeta(props.project.type));

const ticked = computed(() => props.project.steps.filter((step) => step.done).length);
const total = computed(() => props.project.steps.length);
const fraction = computed(() => (total.value ? ticked.value / total.value : 0));

const isDone = computed(() => props.project.status === 'done');
const isLetGo = computed(() => props.project.status === 'cancelled');
const isClosed = computed(() => isDone.value || isLetGo.value);

/** "2027", or nothing at all. A missing year is "someday", which the section heading already says. */
const target = computed(() => (props.project.targetYear ? String(props.project.targetYear) : null));

const closedOn = computed(() =>
  props.project.completedAt
    ? new Date(props.project.completedAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null,
);
</script>

<template>
  <article class="card px-4 py-3.5 sm:px-5" :class="isClosed && 'opacity-80'">
    <div class="flex items-start gap-3">
      <span
        class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full"
        :style="{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }"
        :title="meta.label"
      >
        <FaIcon :icon="meta.icon" class="text-[0.75rem]" />
      </span>

      <div class="min-w-0 flex-1">
        <h3
          class="display text-[1.1rem] leading-snug text-ink"
          :class="isClosed && 'line-through decoration-[var(--line-strong)]'"
        >
          {{ project.title }}
        </h3>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-muted">
          <span>{{ project.author.displayName }}'s idea</span>
          <span v-if="target" class="tabular-nums">· hoping for {{ target }}</span>
          <span v-if="isDone && closedOn">· done {{ closedOn }}</span>
          <span v-else-if="isLetGo && closedOn">· let go {{ closedOn }}</span>
        </p>
      </div>

      <div class="relative shrink-0">
        <button
          class="btn btn-quiet h-8 w-8 rounded-full p-0"
          :aria-label="`More for ${project.title}`"
          :aria-expanded="menu"
          @click="menu = !menu"
        >
          <FaIcon icon="sliders" class="text-[0.75rem]" />
        </button>
        <!--
          A plain dropdown rather than a sheet: these are rare, small actions and a full-screen
          sheet for "move to someday" is a heavier gesture than the action deserves.
        -->
        <div
          v-if="menu"
          class="absolute right-0 top-9 z-30 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-float)]"
        >
          <button class="menu-item" @click="emit('edit'); menu = false">
            <FaIcon icon="pen" class="text-[0.7rem]" />Edit
          </button>
          <button
            v-if="project.status !== 'doing'"
            class="menu-item"
            @click="emit('move', 'doing'); menu = false"
          >
            <FaIcon icon="circle-notch" class="text-[0.7rem]" />Start it
          </button>
          <button
            v-if="project.status !== 'idea'"
            class="menu-item"
            @click="emit('move', 'idea'); menu = false"
          >
            <FaIcon icon="clock" class="text-[0.7rem]" />Back to someday
          </button>
          <!-- Only means something when there is a year to push. "Someday" is already pushed back. -->
          <button
            v-if="project.targetYear"
            class="menu-item"
            @click="emit('postpone'); menu = false"
          >
            <FaIcon icon="calendar-day" class="text-[0.7rem]" />Push it to {{ project.targetYear + 1 }}
          </button>
          <!--
            Letting go is not removing. Deciding against something is part of the story too — a diary
            that only records what went well is not a record of what you wanted.
          -->
          <button
            v-if="!isLetGo"
            class="menu-item"
            @click="emit('move', 'cancelled'); menu = false"
          >
            <FaIcon icon="xmark" class="text-[0.7rem]" />Let it go
          </button>
          <button
            v-if="isLetGo"
            class="menu-item"
            @click="emit('move', 'idea'); menu = false"
          >
            <FaIcon icon="star" class="text-[0.7rem]" />Want it again
          </button>
          <button class="menu-item text-[var(--ember)]" @click="emit('remove'); menu = false">
            <FaIcon icon="trash-can" class="text-[0.7rem]" />Remove
          </button>
        </div>
      </div>
    </div>

    <p v-if="project.notes" class="mt-2 whitespace-pre-line text-[0.875rem] text-ink-soft">
      {{ project.notes }}
    </p>

    <!-- The checklist, if it has one. -->
    <div v-if="total" class="mt-3">
      <div class="mb-2 flex items-center gap-2">
        <span class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunk)]">
          <span
            class="block h-full rounded-full bg-[var(--ember)] transition-[width] duration-300"
            :style="{ width: `${Math.round(fraction * 100)}%` }"
          />
        </span>
        <span class="shrink-0 text-[0.7rem] tabular-nums text-muted">{{ ticked }} of {{ total }}</span>
      </div>
      <ul class="space-y-1">
        <li v-for="step in project.steps" :key="step.id" class="flex items-start gap-2">
          <input
            :id="`step-${step.id}`"
            type="checkbox"
            class="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--ember)]"
            :checked="step.done"
            @change="emit('tick', { stepId: step.id, done: ($event.target as HTMLInputElement).checked })"
          />
          <label
            :for="`step-${step.id}`"
            class="cursor-pointer text-[0.875rem]"
            :class="step.done ? 'text-muted line-through' : 'text-ink-soft'"
          >
            {{ step.title }}
          </label>
        </li>
      </ul>
    </div>

    <!--
      Finishing. It becomes a memory — that is what done means here, so there is nothing to decide,
      only a date to confirm. Today by default, because most things are marked done the day they
      happen; a field because "we finally did it" is often remembered a week later.
    -->
    <div v-if="!isClosed" class="mt-3.5 border-t border-line pt-3">
      <div v-if="!confirmingFinish" class="flex justify-end">
        <button class="chip" @click="confirmingFinish = true">
          <FaIcon icon="check" class="text-[0.6rem]" />We did it
        </button>
      </div>
      <div v-else class="space-y-2">
        <label class="block text-[0.8125rem] text-ink-soft" :for="`finished-${project.id}`">
          When? It joins your timeline as a memory.
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <input
            :id="`finished-${project.id}`"
            v-model="finishedOn"
            type="date"
            class="field !h-8 !w-auto flex-1 !py-0 !text-[0.8125rem] tabular-nums"
          />
          <label
            v-if="files.length < 10"
            class="chip cursor-pointer"
            :title="`Photos for ${project.title}`"
          >
            <FaIcon icon="camera" class="text-[0.6rem]" />
            {{ files.length ? `${files.length} photo${files.length === 1 ? '' : 's'}` : 'Photos' }}
            <input type="file" accept="image/*" multiple class="hidden" @change="pickFiles" />
          </label>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button class="chip" @click="confirmingFinish = false; files = []">Cancel</button>
          <button
            class="chip !border-[var(--ember)] !text-[var(--ember)]"
            @click="emit('finish', { eventDate: finishedOn, files }); confirmingFinish = false; files = []"
          >
            <FaIcon icon="heart" class="text-[0.6rem]" />Add it
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="project.eventId" class="mt-3 border-t border-line pt-2.5">
      <button class="text-[0.75rem] text-muted underline decoration-dotted" @click="emit('openMemory')">
        <FaIcon icon="heart" class="mr-1 text-[0.6rem] text-[var(--ember)]" />It is on your timeline
      </button>
    </div>
  </article>
</template>

<style scoped>
.menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.85rem;
  font-size: 0.8125rem;
  text-align: left;
  color: var(--ink);
  transition: background-color 140ms var(--ease-out-soft, ease);
}
.menu-item:hover {
  background: var(--surface-sunk);
}
</style>
