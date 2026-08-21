<template>
  <div class="relative pl-8" aria-hidden="true">
    <div class="rail" />
    <div v-for="row in 4" :key="row" class="relative mb-6">
      <span class="absolute -left-8 top-5 h-3 w-3 -translate-x-1/2 rounded-full bg-line-strong" />
      <div class="card animate-pulse p-5" :style="{ opacity: 1 - row * 0.16 }">
        <div class="flex items-center gap-3">
          <div class="h-11 w-11 rounded-xl bg-surface-sunk" />
          <div class="flex-1 space-y-2">
            <div class="h-4 w-2/5 rounded bg-surface-sunk" />
            <div class="h-3 w-1/4 rounded bg-surface-sunk" />
          </div>
        </div>
        <div v-if="row % 2 === 1" class="mt-4 h-32 rounded-xl bg-surface-sunk" />
      </div>
    </div>
  </div>
</template>
