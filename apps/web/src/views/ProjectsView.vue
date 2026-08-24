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
import type { EventType, Project, ProjectStatus } from '@/api/types';
import { useProjectsStore } from '@/stores/projects';
import { useTimelineStore } from '@/stores/timeline';
import { useToastStore } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import AppButton from '@/components/ui/AppButton.vue';
import AppSheet from '@/components/ui/AppSheet.vue';
import ProjectCard from '@/components/ProjectCard.vue';
import TypePicker from '@/components/ui/TypePicker.vue';

const projects = useProjectsStore();
const timeline = useTimelineStore();
const toasts = useToastStore();
const ui = useUiStore();
const router = useRouter();

const sheetOpen = ref(false);
const editing = ref<Project | null>(null);
const saving = ref(false);

const form = ref<{
  type: EventType;
  title: string;
  notes: string;
  status: ProjectStatus;
  targetYear: string;
  steps: string;
}>({
  // The kind of thing it is, which the memory inherits when it is finished.
  type: 'milestone',
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
  form.value = { type: 'milestone', title: '', notes: '', status: 'idea', targetYear: '', steps: '' };
  sheetOpen.value = true;
}

function openEdit(project: Project): void {
  editing.value = project;
  form.value = {
    type: project.type,
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
      type: form.value.type,
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
 * Finishing. It becomes a memory, always — marking a project done is saying it happened, and a thing
 * that happened to the two of them belongs on the timeline. Offering "or not" would be offering to
 * record a milestone nowhere.
 */
async function finish(project: Project, { eventDate, files }: { eventDate: string; files: File[] }): Promise<void> {
  try {
    const done = await projects.complete(project.id, { eventDate });
    /*
     * Photos go on afterwards, through the ordinary endpoint: the memory has to exist before
     * anything can be attached to it. A failure here must not undo the finish — the project is done
     * either way, and the photos can be added to the memory later.
     */
    if (files.length && done.eventId) {
      try {
        await timeline.addPhotos(done.eventId, files);
      } catch {
        toasts.error('Done, but the photos did not upload');
        await timeline.refresh();
        return;
      }
    }
    await timeline.refresh();
    toasts.push(
      files.length ? 'Done — on your timeline, with the photos' : 'Done — and it is on your timeline',
      'warm',
    );
  } catch {
    toasts.error('Could not finish that');
  }
}

/** Push it back a year, for the commonest thing that happens to a dateless want. */
async function postpone(project: Project): Promise<void> {
  try {
    const moved = await projects.postpone(project.id);
    toasts.push(`Pushed back to ${moved.targetYear}`);
  } catch {
    toasts.error('Could not move that');
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
            @postpone="postpone(project)"
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
            @postpone="postpone(project)"
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
            @postpone="postpone(project)"
            @open-memory="openMemory(project)"
            @remove="remove(project)"
          />
        </div>
      </section>

      <!--
        Kept, and kept quiet. A diary that records only what went well is not a record of what the
        two of them wanted — but it does not need to be the loudest thing on the page either.
      -->
      <section v-if="projects.letGo.length" class="mb-8">
        <h2 class="eyebrow">Let go</h2>
        <div class="space-y-3">
          <ProjectCard
            v-for="project in projects.letGo"
            :key="project.id"
            :project="project"
            @tick="tick(project, $event.stepId, $event.done)"
            @edit="openEdit(project)"
            @move="move(project, $event)"
            @finish="finish(project, $event)"
            @postpone="postpone(project)"
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
          <span class="label">What kind of thing</span>
          <TypePicker v-model="form.type" />
          <p class="mt-1.5 text-[0.7rem] text-muted">
            The memory inherits this when you finish it.
          </p>
        </div>

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
              <option value="cancelled">Let go</option>
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
