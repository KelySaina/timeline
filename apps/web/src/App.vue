<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import ThemeAtmosphere from '@/components/ThemeAtmosphere.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();

// The shell (nav, composer) only exists once a couple exists; auth screens stand alone.
const framed = computed(() => auth.isSignedIn && auth.hasCouple && !route.meta.guest && route.name !== 'onboard');
</script>

<template>
  <ThemeAtmosphere fixed />

  <div v-if="!auth.ready" class="flex min-h-dvh items-center justify-center text-muted">
    <FaIcon icon="heart" class="animate-heart text-2xl text-[var(--ember)]" />
  </div>

  <AppShell v-else-if="framed">
    <RouterView v-slot="{ Component }">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-300 ease-[var(--ease-out-soft)]"
        enter-from-class="translate-y-2 opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0"
      >
        <component :is="Component" />
      </Transition>
    </RouterView>
  </AppShell>

  <RouterView v-else />

  <ToastHost />
</template>
