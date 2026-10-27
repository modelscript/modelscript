<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from "vue";
import { ICONS, type IconName } from "../data/icons";

const props = withDefaults(defineProps<{ name: IconName; size?: number | string; stroke?: number }>(), {
  size: 20,
  stroke: 1.75,
});

const body = computed(() => ICONS[props.name] ?? "");
</script>

<template>
  <svg
    class="ms-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="body"
  />
</template>

<style scoped>
.ms-icon {
  flex-shrink: 0;
  display: inline-block;
  vertical-align: middle;
}
</style>
