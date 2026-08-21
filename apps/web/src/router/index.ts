import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from, saved) => saved ?? (to.path === from.path ? false : { top: 0 }),
  routes: [
    { path: '/welcome', name: 'auth', component: () => import('@/views/AuthView.vue'), meta: { guest: true } },
    { path: '/start', name: 'onboard', component: () => import('@/views/OnboardView.vue'), meta: { auth: true } },
    { path: '/join/:code', name: 'join', component: () => import('@/views/JoinView.vue'), meta: { auth: true } },
    {
      path: '/',
      name: 'timeline',
      component: () => import('@/views/TimelineView.vue'),
      meta: { auth: true, couple: true },
      children: [{ path: 'memory/:id', name: 'memory', component: () => import('@/views/TimelineView.vue') }],
    },
    { path: '/upcoming', name: 'upcoming', component: () => import('@/views/UpcomingView.vue'), meta: { auth: true, couple: true } },
    { path: '/search', name: 'search', component: () => import('@/views/SearchView.vue'), meta: { auth: true, couple: true } },
    { path: '/us', name: 'profile', component: () => import('@/views/ProfileView.vue'), meta: { auth: true, couple: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.bootstrap();

  if (to.meta.auth && !auth.isSignedIn) {
    // Keep the invite link so a brand-new partner lands back on it after signing up.
    return { name: 'auth', query: to.name === 'join' ? { next: to.fullPath } : undefined };
  }
  if (to.meta.guest && auth.isSignedIn) return { path: '/' };
  if (to.meta.couple && !auth.hasCouple) return { name: 'onboard' };
  if (to.name === 'onboard' && auth.hasCouple) return { path: '/' };
  return true;
});

export default router;
