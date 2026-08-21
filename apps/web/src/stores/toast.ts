import { defineStore } from 'pinia';
import { ref } from 'vue';

export type Toast = { id: number; message: string; tone: 'neutral' | 'warm' | 'error' };

let nextId = 1;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);

  function push(message: string, tone: Toast['tone'] = 'neutral', ttl = 3600): void {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, message, tone }];
    window.setTimeout(() => dismiss(id), ttl);
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  return { toasts, push, dismiss, warm: (m: string) => push(m, 'warm'), error: (m: string) => push(m, 'error', 5200) };
});
