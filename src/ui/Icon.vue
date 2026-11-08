<script setup lang="ts">
import { iconPaths, type IconName } from './icons';
defineProps<{
  name: IconName;
}>();
</script>

<template>
  <svg
    :class="$style.icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="iconPaths[name]" />
  </svg>
</template>

<style module lang="scss">
.icon {
  display: block;
  width: 18px;
  height: 18px;
  flex: none;
  stroke-width: 1.75;
}
</style>
