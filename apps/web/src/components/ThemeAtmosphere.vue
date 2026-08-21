<script setup lang="ts">
/**
 * The theme's wallpaper: three layers driven entirely by CSS variables, so this
 * component never needs to know which theme is on. `fixed` mounts it behind the
 * whole app; the default is absolute, which is what the theme store's tiles use
 * to preview a theme's cinematic inside a card.
 */
withDefaults(defineProps<{ fixed?: boolean }>(), { fixed: false });
</script>

<template>
  <div class="atmos" :class="fixed && 'atmos-fixed'" aria-hidden="true">
    <span class="atmos-a" />
    <span class="atmos-b" />
    <span class="atmos-c" />
  </div>
</template>
