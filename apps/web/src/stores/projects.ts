/**
 * The projects list.
 *
 * Its own store rather than a corner of the timeline store: projects are not events, they are not
 * paged, and they do not participate in the story scroll. Sharing a store would mean every timeline
 * refresh dragged this along and every project tick invalidated the scroll.
 *
 * Ticking a step is optimistic. It is the action that happens most, it is trivially reversible, and
 * a checkbox that waits for a round trip before moving feels broken — the server's answer replaces
 * the guess a moment later either way.
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type { Project, ProjectDraft, ProjectStatus } from '@/api/types';

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  const byStatus = (status: ProjectStatus) => computed(() => projects.value.filter((p) => p.status === status));

  const doing = byStatus('doing');
  const ideas = byStatus('idea');
  const done = byStatus('done');

  /** How many steps are ticked across everything underway — the one number worth a glance. */
  const progress = computed(() => {
    const steps = doing.value.flatMap((project) => project.steps);
    return { done: steps.filter((step) => step.done).length, total: steps.length };
  });

  async function load(force = false): Promise<void> {
    if (loading.value || (loaded.value && !force)) return;
    loading.value = true;
    try {
      projects.value = (await api.get<{ projects: Project[] }>('/projects')).projects;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  /** Replace one project in place, keeping the server's ordering rather than guessing at it. */
  function absorb(project: Project): void {
    const index = projects.value.findIndex((p) => p.id === project.id);
    if (index === -1) projects.value = [project, ...projects.value];
    else projects.value = projects.value.map((p) => (p.id === project.id ? project : p));
  }

  async function create(draft: ProjectDraft): Promise<Project> {
    const { project } = await api.post<{ project: Project }>('/projects', draft);
    // Reloaded rather than prepended: the list is ordered by status and target year, and guessing
    // where a new one lands would put it in the wrong place until the next visit.
    await load(true);
    return project;
  }

  async function update(id: string, patch: Partial<ProjectDraft>): Promise<Project> {
    const { project } = await api.patch<{ project: Project }>(`/projects/${id}`, patch);
    await load(true);
    return project;
  }

  async function remove(id: string): Promise<void> {
    projects.value = (await api.del<{ projects: Project[] }>(`/projects/${id}`)).projects;
  }

  async function setStep(projectId: string, stepId: string, done: boolean): Promise<void> {
    const before = projects.value;
    // Optimistic, including the promotion the server will make: ticking a step on an idea starts it.
    projects.value = projects.value.map((project) =>
      project.id !== projectId
        ? project
        : {
            ...project,
            status: done && project.status === 'idea' ? 'doing' : project.status,
            steps: project.steps.map((step) => (step.id === stepId ? { ...step, done } : step)),
          },
    );
    try {
      const { project } = await api.patch<{ project: Project }>(
        `/projects/${projectId}/steps/${stepId}`,
        { done },
      );
      absorb(project);
    } catch (error) {
      projects.value = before;
      throw error;
    }
  }

  /** Finish it, and optionally put it on the timeline as a memory in the same request. */
  async function complete(
    id: string,
    options: { becomeMemory?: boolean; eventDate?: string } = {},
  ): Promise<Project> {
    const { project } = await api.post<{ project: Project }>(`/projects/${id}/complete`, options);
    await load(true);
    return project;
  }

  function reset(): void {
    projects.value = [];
    loaded.value = false;
  }

  return {
    projects, loaded, loading, doing, ideas, done, progress,
    load, create, update, remove, setStep, complete, absorb, reset,
  };
});
