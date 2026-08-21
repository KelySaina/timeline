import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type { Couple, InvitePreview, Invitation, Theme, User } from '@/api/types';
import { THEMES, themeMeta } from '@/lib/themes';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const couple = ref<Couple | null>(null);
  const invitation = ref<Invitation | null>(null);
  const ready = ref(false);

  const isSignedIn = computed(() => user.value !== null);
  const hasCouple = computed(() => couple.value !== null);
  const partner = computed(() => couple.value?.members.find((m) => m.id !== user.value?.id) ?? null);
  const me = computed(() => couple.value?.members.find((m) => m.id === user.value?.id) ?? null);
  const isSolo = computed(() => (couple.value?.members.length ?? 0) < 2);

  /** Names in a stable order: you first, so the header never reshuffles between sessions. */
  const displayNames = computed(() => {
    if (!couple.value) return [] as string[];
    const mine = me.value?.displayName;
    const theirs = partner.value?.displayName;
    return [mine, theirs].filter(Boolean) as string[];
  });

  let switchTimer = 0;

  function applyTheme(): void {
    const root = document.documentElement;
    const theme = couple.value?.theme ?? 'dawn';
    const next = `theme-${themeMeta(theme).id}`;
    if (root.classList.contains(next)) return;

    // Ease the swap instead of flashing it. The class is removed again so nothing else in the
    // app carries a global colour transition.
    root.classList.add('theme-switching');
    window.clearTimeout(switchTimer);
    switchTimer = window.setTimeout(() => root.classList.remove('theme-switching'), 420);

    for (const meta of THEMES) root.classList.remove(`theme-${meta.id}`);
    root.classList.add(next);

    // Keeps the mobile browser chrome in the same mood as the page. Read back from
    // the applied theme rather than a JS copy of the palette, which can go stale.
    const paper = getComputedStyle(root).getPropertyValue('--paper').trim();
    if (paper) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paper);
  }

  function adopt(payload: { user: User | null; couple: Couple | null }): void {
    user.value = payload.user;
    couple.value = payload.couple;
    applyTheme();
  }

  async function bootstrap(): Promise<void> {
    try {
      adopt(await api.get<{ user: User | null; couple: Couple | null }>('/session'));
    } catch {
      adopt({ user: null, couple: null });
    } finally {
      ready.value = true;
    }
  }

  async function signup(input: { email: string; password: string; displayName: string }): Promise<void> {
    adopt(await api.post<{ user: User; couple: Couple | null }>('/auth/signup', input));
  }

  async function login(input: { email: string; password: string }): Promise<void> {
    adopt(await api.post<{ user: User; couple: Couple | null }>('/auth/login', input));
  }

  async function logout(): Promise<void> {
    await api.post('/auth/logout');
    adopt({ user: null, couple: null });
    invitation.value = null;
  }

  async function refreshCouple(): Promise<void> {
    if (!user.value) return;
    const payload = await api.get<{ couple: Couple; invitation: Invitation | null }>('/couples/me');
    couple.value = payload.couple;
    invitation.value = payload.invitation;
    applyTheme();
  }

  async function createCouple(input: { title?: string | null; startedOn?: string | null }): Promise<void> {
    const payload = await api.post<{ couple: Couple }>('/couples', input);
    couple.value = payload.couple;
    applyTheme();
  }

  async function updateCouple(patch: {
    title?: string | null;
    startedOn?: string | null;
    theme?: Theme;
  }): Promise<void> {
    // Optimistic for theme changes only: a colour swap that waits for a round trip feels broken,
    // and the worst case is the server refusing and applyTheme() putting the old one back.
    if (patch.theme && couple.value) {
      couple.value = { ...couple.value, theme: patch.theme };
      applyTheme();
    }
    const payload = await api.patch<{ couple: Couple }>('/couples/me', patch);
    couple.value = payload.couple;
    applyTheme();
  }

  async function updateProfile(patch: { displayName?: string; birthday?: string | null }): Promise<void> {
    const payload = await api.patch<{ user: User }>('/me', patch);
    user.value = payload.user;
    await refreshCouple();
  }

  async function uploadAvatar(file: File): Promise<void> {
    const form = new FormData();
    form.append('avatar', file);
    const response = await fetch('/api/me/avatar', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': document.cookie.match(/tl_csrf=([^;]+)/)?.[1] ?? '' },
    });
    if (!response.ok) throw new Error('Upload failed');
    const payload = (await response.json()) as { user: User };
    user.value = payload.user;
    await refreshCouple();
  }

  async function createInvitation(): Promise<Invitation> {
    const payload = await api.post<{ invitation: Invitation }>('/couples/me/invitations');
    invitation.value = payload.invitation;
    return payload.invitation;
  }

  const previewInvitation = (code: string) =>
    api.get<{ invitation: InvitePreview }>(`/invitations/${encodeURIComponent(code)}`).then((r) => r.invitation);

  async function acceptInvitation(code: string): Promise<void> {
    const payload = await api.post<{ couple: Couple }>(`/invitations/${encodeURIComponent(code)}/accept`);
    couple.value = payload.couple;
    applyTheme();
  }

  return {
    user, couple, invitation, ready,
    isSignedIn, hasCouple, partner, me, isSolo, displayNames,
    bootstrap, signup, login, logout, refreshCouple, createCouple, updateCouple, updateProfile,
    uploadAvatar, createInvitation, previewInvitation, acceptInvitation,
  };
});
