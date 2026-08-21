import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/**
 * Reveals elements once as they enter the viewport. Deliberately one-shot: the timeline should
 * feel alive on first read, not animate every time you scroll back up.
 */
export function useScrollReveal(root: Ref<HTMLElement | null>, selector = '.reveal') {
  let observer: IntersectionObserver | null = null;
  let mutations: MutationObserver | null = null;

  const watchAll = () => {
    if (!root.value || !observer) return;
    for (const element of root.value.querySelectorAll(selector)) {
      if (!element.classList.contains('is-visible')) observer.observe(element);
    }
  };

  onMounted(() => {
    if (!('IntersectionObserver' in window)) {
      root.value?.querySelectorAll(selector).forEach((el) => el.classList.add('is-visible'));
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        // Rows that cross the line together cascade instead of flashing in at once.
        // Capped, because a batch of thirty after an infinite-scroll page would
        // otherwise leave the last row waiting a second and a half.
        let step = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).style.setProperty('--reveal-step', String(Math.min(step, 5)));
          step += 1;
          entry.target.classList.add('is-visible');
          observer?.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    watchAll();

    // New memories arrive without a reload, so keep an eye on the DOM.
    mutations = new MutationObserver(() => watchAll());
    if (root.value) mutations.observe(root.value, { childList: true, subtree: true });
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    mutations?.disconnect();
  });

  return { watchAll };
}
