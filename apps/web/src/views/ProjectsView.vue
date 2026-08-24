<script setup lang="ts">
/**
 * The projects screen: what the two of them mean to do, with no date on it yet.
 *
 * Grouped by state rather than by date, because state is the only ordering a dateless want has —
 * underway, then wanted, then behind them. Finished projects stay visible on purpose: a list that
 * hides what you achieved is a chore list, and this one is meant to be a pleasure to scroll back
 * through.
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Project, ProjectStatus } from '@/api/types';
import { useProjectsStore } from '@/stores/projects';
import { useTimelineStore } from '@/stores/timeline';
import { useToastStore } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import AppButton from '@/components/ui/AppButton.vue';
import AppSheet from '@/components/ui/AppSheet.vue';
import ProjectCard from '@/components/ProjectCard.vue';

const projects = useProjectsStore();
const timeline = useTimelineStore();
const toasts = useToastStore();
const ui = useUiStore();
const router = useRouter();

const sheetOpen = ref(false);
const editing = ref<Project | null>(null);
const saving = ref(false);

const form = ref<{ title: string; notes: string; status: ProjectStatus; targetYear: string; steps: string }>({
  title: '',
  notes: '',
  status: 'idea',
  targetYear: '',
  steps: '',
});

const thisYear = new Date().getFullYear();
/** This year, the next few, and "someday" — the answers people actually give. */
const yearOptions = computed(() => [thisYear, thisYear + 1, thisYear + 2, thisYear + 3]);

onMounted(() => {
  void projects.load();
});

function openNew(): void {
  editing.value = null;
  form.value = { title: '', notes: '', status: 'idea', targetYear: '', steps: '' };
  sheetOpen.value = true;
}

function openEdit(project: Project): void {
  editing.value = project;
  form.value = {
    title: project.title,
    notes: project.notes ?? '',
    status: project.status,
    targetYear: project.targetYear ? String(project.targetYear) : '',
    // One per line, which is how a checklist is written and read.
    steps: project.steps.map((step) => step.title).join('\n'),
  };
  sheetOpen.value = true;
}

async function save(): Promise<void> {
  const title = form.value.title.trim();
  if (!title) return;
  saving.value = true;
  try {
    const draft = {
      title,
      notes: form.value.notes.trim() || null,
      status: form.value.status,
      targetYear: form.value.targetYear ? Number(form.value.targetYear) : null,
      steps: form.value.steps
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
    if (editing.value) await projects.update(editing.value.id, draft);
    else await projects.create(draft);
    sheetOpen.value = false;
    toasts.push(editing.value ? 'Project updated' : 'On the list', 'warm');
  } catch {
    toasts.error('Could not save that');
  } finally {
    saving.value = false;
  }
}

async function tick(project: Project, stepId: string, done: boolean): Promise<void> {
  try {
    await projects.setStep(project.id, stepId, done);
  } catch {
    toasts.error('Could not save that');
  }
}

async function move(project: Project, status: ProjectStatus): Promise<void> {
  try {
    await projects.update(project.id, { status });
  } catch {
    toasts.error('Could not move that');
  }
}

/**
 * Finishing. The offer to make it a memory is the point of the whole feature, so it is a prompt
 * rather than a setting — and taking it is one tap, not a form.
 */
async function finish(project: Project, becomeMemory: boolean): Promise<void> {
  try {
    const done = await projects.complete(project.id, { becomeMemory });
    if (becomeMemory && done.eventId) {
      // The story has a new row; the timeline screen must not still be showing the old one.
      await timeline.refresh();
      toasts.push('Done — and it is on your timeline', 'warm');
    } else {
      toasts.push('Done', 'warm');
    }
  } catch {
    toasts.error('Could not finish that');
  }
}

async function openMemory(project: Project): Promise<void> {
  if (!project.eventId) return;
  const event = timeline.byId(project.eventId) ?? (await timeline.fetchOne(project.eventId).catch(() => null));
  if (!event) return;
  ui.view(event);
  void router.push({ name: 'memory', params: { id: event.id } });
}

async function remove(project: Project): Promise<void> {
  try {
    await projects.remove(project.id);
    toasts.push('Removed from the list');
  } catch {
    toasts.error('Could not remove that');
  }
}
</script>

<template>
  <div>
    <header class="mb-6">
      <h1 class="display text-[1.75rem]">Things we mean to do</h1>
      <p class="mt-1 text-[0.9rem] text-muted">
        No dates here — that is the point. When one of them happens, it can join the story.
      </p>
    </header>

    <div class="mb-6 flex items-center gap-3">
      <AppButton variant="primary" icon="plus" @click="openNew">Add a project</AppButton>
      <p v-if="projects.progress.total" class="text-[0.8125rem] text-muted">
        {{ projects.progress.done }} of {{ projects.progress.total }} steps ticked
      </p>
    </div>

    <p v-if="projects.loading && !projects.loaded" class="card-quiet px-4 py-6 text-center text-muted">
      <FaIcon icon="circle-notch" class="animate-spin" />
    </p>

    <template v-else>
      <section v-if="projects.doing.length" class="mb-8">
        <h2 class="eyebrow">Underway</h2>
        <div class="space-y-3">
          <ProjectCard
            v-for="project in projects.doing"
            :key="project.id"
            :project="project"
            @tick="tick(project, $event.stepId, $event.done)"
            @edit="openEdit(project)"
            @move="move(project, $event)"
            @finish="finish(project, $event)"
            @open-memory="openMemory(project)"
            @remove="remove(project)"
          />
        </div>
      </section>

      <section v-if="projects.ideas.length" class="mb-8">
        <h2 class="eyebrow">Someday</h2>
        <div class="space-y-3">
          <ProjectCard
            v-for="project in projects.ideas"
            :key="project.id"
            :project="project"
            @tick="tick(project, $event.stepId, $event.done)"
            @edit="openEdit(project)"
            @move="move(project, $event)"
            @finish="finish(project, $event)"
            @open-memory="openMemory(project)"
            @remove="remove(project)"
          />
        </div>
      </section>

      <section v-if="projects.done.length" class="mb-8">
        <h2 class="eyebrow">Done</h2>
        <div class="space-y-3">
          <ProjectCard
            v-for="project in projects.done"
            :key="project.id"
            :project="project"
            @tick="tick(project, $event.stepId, $event.done)"
            @edit="openEdit(project)"
            @move="move(project, $event)"
            @finish="finish(project, $event)"
            @open-memory="openMemory(project)"
            @remove="remove(project)"
          />
        </div>
      </section>

      <p
        v-if="projects.loaded && !projects.projects.length"
        class="card-quiet px-4 py-8 text-center text-[0.9rem] text-muted"
      >
        Nothing yet. A trip you keep mentioning, a room you keep meaning to paint, a thing one of you
        said once and the other did not forget.
      </p>
    </template>

    <AppSheet
      :open="sheetOpen"
      :title="editing ? 'Edit project' : 'Something we mean to do'"
      @close="sheetOpen = false"
    >
      <div class="space-y-4">
        <div>
          <label class="label" for="project-title">What is it?</label>
          <input
            id="project-title"
            v-model="form.title"
            class="field display text-[1.05rem]"
            placeholder="Learn to dive"
            maxlength="140"
          />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="project-status">Where is it</label>
            <select id="project-status" v-model="form.status" class="field">
              <option value="idea">Someday</option>
              <option value="doing">Underway</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label class="label" for="project-year">Hoping for</label>
            <select id="project-year" v-model="form.targetYear" class="field tabular-nums">
              <option value="">No particular year</option>
              <option v-for="year in yearOptions" :key="year" :value="String(year)">{{ year }}</option>
            </select>
          </div>
        </div>

        <div>
          <label class="label" for="project-notes">Notes</label>
          <textarea
            id="project-notes"
            v-model="form.notes"
            class="field min-h-[5rem]"
            placeholder="Why, or what it would take."
            maxlength="2000"
          />
        </div>

        <div>
          <label class="label" for="project-steps">Steps</label>
          <textarea
            id="project-steps"
            v-model="form.steps"
            class="field min-h-[6rem]"
            placeholder="One per line — and only if it needs them:&#10;Renew passports&#10;Pick the dates&#10;Book flights"
          />
          <p class="mt-1.5 text-[0.7rem] text-muted">
            Optional. Ticks already made are kept, matched by the step's wording.
          </p>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <AppButton variant="quiet" @click="sheetOpen = false">Cancel</AppButton>
          <AppButton
            variant="primary"
            :loading="saving"
            :disabled="!form.title.trim()"
            @click="save"
          >
            {{ editing ? 'Save' : 'Add it' }}
          </AppButton>
        </div>
      </template>
    </AppSheet>
  </div>
</template>
