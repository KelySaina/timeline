import { defineStore } from 'pinia';
import { ref } from 'vue';

/** An optional single affordance on a toast — "Reload", and later "Undo". */
export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  message: string;
  tone: 'neutral' | 'warm' | 'error';
  action?: ToastAction;
};

let nextId = 1;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);

  /** ttl 0 keeps it up until it is acted on or dismissed. */
  function push(message: string, tone: Toast['tone'] = 'neutral', ttl = 3600, action?: ToastAction): void {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, message, tone, action }];
    if (ttl > 0) window.setTimeout(() => dismiss(id), ttl);
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  /** A toast that asks for something. Stays until answered — the point is that it is not missed. */
  function prompt(message: string, label: string, run: () => void): void {
    push(message, 'neutral', 0, { label, run });
  }

  /**
   * A take-it-back toast. Longer than the usual 3.6s because the reader has to notice it, read it
   * and decide, but not indefinite: an Undo that is still on screen a minute later is clutter, and
   * the delete it undoes is soft anyway.
   */
  function undo(message: string, run: () => void): void {
    push(message, 'neutral', 9000, { label: 'Undo', run });
  }

  return {
    toasts,
    push,
    dismiss,
    prompt,
    undo,
    warm: (m: string) => push(m, 'warm'),
    error: (m: string) => push(m, 'error', 5200),
  };
});
