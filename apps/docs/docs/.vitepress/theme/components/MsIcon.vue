<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from "vue";
import { ICON_DUOTONE, ICONS, type IconName } from "../data/icons";

const props = withDefaults(
  defineProps<{
    name: IconName;
    size?: number | string;
    stroke?: number;
    duotone?: boolean;
  }>(),
  {
    size: 20,
    stroke: 1.75,
    duotone: false,
  },
);

const body = computed(() => ICONS[props.name] ?? "");
const tone = computed(() => (props.duotone ? ICON_DUOTONE[props.name] : undefined));
</script>

<template>
  <svg
    class="ms-icon"
    :class="{ 'ms-icon-duotone': !!tone }"
    :style="tone ? { '--ms-icon-sec-default': tone.secondaryColor } : undefined"
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
  >
    <template v-if="tone">
      <g v-if="tone.fill" class="ms-icon-fill" v-html="tone.fill" />
      <g class="ms-icon-primary" v-html="tone.primary" />
      <g class="ms-icon-secondary" v-html="tone.secondary" />
    </template>
    <g v-else class="ms-icon-foreground" v-html="body" />
  </svg>
</template>

<style scoped>
.ms-icon {
  flex-shrink: 0;
  display: inline-block;
  vertical-align: middle;
  overflow: visible;
}

.ms-icon-fill {
  fill: var(--ms-icon-secondary, var(--ms-icon-sec-default, currentColor));
  fill-opacity: var(--ms-icon-fill-opacity, 0.16);
  stroke: none;
}

.ms-icon-secondary {
  stroke: var(--ms-icon-secondary, var(--ms-icon-sec-default, currentColor));
}
</style>
