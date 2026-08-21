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
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
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
