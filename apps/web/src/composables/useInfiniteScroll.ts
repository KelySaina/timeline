import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Loads the next page when a sentinel element nears the viewport. */
export function useInfiniteScroll(onReach: () => void) {
  const sentinel = ref<HTMLElement | null>(null);
  let observer: IntersectionObserver | null = null;

  onMounted(() => {
    if (!sentinel.value || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReach();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel.value);
  });

  onBeforeUnmount(() => observer?.disconnect());
  return { sentinel };
}
