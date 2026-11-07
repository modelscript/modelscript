<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useAnsatzOrigin } from "../util/ansatz";
import { activeMenuId, cancelSharedMenuTimers } from "./NavMegaMenu.vue";

const props = defineProps<{
  screenMenu?: boolean;
}>();

const closeScreen = inject<(() => void) | undefined>("close-screen", undefined);

const MENU_ID = "ansatz";
const isOpen = computed(() => activeMenuId.value === MENU_ID);
const isHovered = ref(false);
const isFocused = ref(false);

const { ansatzOrigin } = useAnsatzOrigin();
const hostLabel = computed(() => {
  try {
    return new URL(ansatzOrigin.value).host;
  } catch {
    return "ansatz.social";
  }
});

const exploreHref = computed(() => `${ansatzOrigin.value}/explore`);

let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function openCard(): void {
  cancelSharedMenuTimers();
  clearTimeout(closeTimer);
  clearTimeout(openTimer);
  activeMenuId.value = MENU_ID;
}

function closeCard(): void {
  clearTimeout(openTimer);
  if (activeMenuId.value === MENU_ID) {
    activeMenuId.value = null;
  }
}

function scheduleOpen(): void {
  clearTimeout(closeTimer);
  clearTimeout(openTimer);
  if (activeMenuId.value !== null && activeMenuId.value !== MENU_ID) {
    openCard();
    return;
  }
  openTimer = setTimeout(openCard, 90);
}

function scheduleClose(): void {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!isHovered.value && !isFocused.value) {
      closeCard();
    }
  }, 150);
}

function onButtonEnter(e: PointerEvent): void {
  if (e.pointerType !== "mouse") return;
  isHovered.value = true;
  scheduleOpen();
}

function onButtonLeave(e: PointerEvent): void {
  if (e.pointerType !== "mouse") return;
  isHovered.value = false;
  scheduleClose();
}

function onTooltipEnter(e: PointerEvent): void {
  if (e.pointerType !== "mouse") return;
  isHovered.value = true;
  openCard();
}

function onTooltipLeave(e: PointerEvent): void {
  if (e.pointerType !== "mouse") return;
  isHovered.value = false;
  scheduleClose();
}

function onFocusIn(): void {
  isFocused.value = true;
  openCard();
}

function onFocusOut(e: FocusEvent): void {
  const currentTarget = e.currentTarget as HTMLElement | null;
  const relatedTarget = e.relatedTarget as HTMLElement | null;
  if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
    return;
  }
  isFocused.value = false;
  scheduleClose();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && isOpen.value) {
    closeCard();
    isHovered.value = false;
    isFocused.value = false;
  }
}

function onScreenClick(): void {
  closeScreen?.();
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
});
</script>

<template>
  <!-- Mobile / tablet screen drawer navigation -->
  <div v-if="props.screenMenu" class="ansatz-screen-item">
    <a
      :href="exploreHref"
      target="_blank"
      rel="noopener noreferrer"
      class="VPNavScreenMenuLink ansatz-screen-link"
      @click="onScreenClick"
    >
      <div class="ansatz-screen-row">
        <span class="ansatz-screen-title">
          <span class="ansatz-screen-pip" aria-hidden="true" />
          <span>Explore Ansatz Hub</span>
        </span>
        <span class="ansatz-screen-arrow" aria-hidden="true">↗</span>
      </div>
      <p class="ansatz-screen-desc">
        Federated engineering network &amp; package registry
      </p>
    </a>
  </div>

  <!-- Desktop nav bar pill button + compact popover -->
  <div
    v-else
    class="ansatz-nav-wrapper"
    @pointerenter="onButtonEnter"
    @pointerleave="onButtonLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <a
      :href="exploreHref"
      target="_blank"
      rel="noopener noreferrer"
      class="VPNavBarMenuLink ansatz-nav-pill"
      :class="{ 'has-focus': isFocused, 'has-hover': isHovered }"
      aria-describedby="ansatz-nav-tooltip"
    >
      <span class="ansatz-pip" aria-hidden="true" />
      <span class="ansatz-label">Explore Ansatz Hub</span>
      <svg
        class="ansatz-external"
        viewBox="0 0 24 24"
        width="13"
        height="13"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M7 17L17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>

    <Transition name="ansatz-tooltip-fade">
      <div
        v-if="isOpen"
        id="ansatz-nav-tooltip"
        class="ansatz-tooltip"
        role="tooltip"
        @pointerenter="onTooltipEnter"
        @pointerleave="onTooltipLeave"
      >
        <div class="ansatz-tooltip-arrow" aria-hidden="true" />

        <div class="ansatz-tooltip-header">
          <span class="ansatz-tooltip-title">Ansatz</span>
          <span class="ansatz-tooltip-host">{{ hostLabel }}</span>
        </div>

        <p class="ansatz-tooltip-desc">
          Federated engineering network and package registry powered by ModelScript.
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Wrapper ── */
.ansatz-nav-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  align-self: center;
}

/* ── Mobile Screen Link ── */
.ansatz-screen-item {
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 10px 0 12px;
}

.ansatz-screen-link {
  display: flex !important;
  flex-direction: column;
  gap: 4px;
  text-decoration: none !important;
  border-bottom: none !important;
  padding: 0 !important;
}

.ansatz-screen-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ansatz-screen-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.ansatz-screen-pip {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: #059669;
  box-shadow: 0 0 8px rgba(5, 150, 105, 0.7);
  flex-shrink: 0;
}

:global(.dark) .ansatz-screen-pip {
  background-color: #34d399;
  box-shadow: 0 0 8px #34d399;
}

.ansatz-screen-arrow {
  font-size: 14px;
  color: var(--vp-c-text-3);
}

.ansatz-screen-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  white-space: normal;
  color: var(--vp-c-text-2);
}

/* ── Tooltip Card ── */
.ansatz-tooltip {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 264px;
  padding: 12px 14px;
  border-radius: 12px;
  z-index: 100;
  pointer-events: auto;
  text-align: left;
  white-space: normal;
  line-height: 1.45;
  font-weight: 400;

  background: var(--vp-c-bg-elv, #ffffff);
  color: var(--vp-c-text-1, #0f172a);
  border: 1px solid var(--vp-c-divider, rgba(15, 23, 42, 0.12));
  box-shadow:
    0 14px 32px -6px rgba(15, 23, 42, 0.16),
    0 4px 12px -2px rgba(15, 23, 42, 0.08);
}

/* Hover bridge so mouse movement into tooltip is continuous */
.ansatz-tooltip::before {
  content: "";
  position: absolute;
  top: -12px;
  left: 0;
  right: 0;
  height: 12px;
}

:global(.dark) .ansatz-tooltip {
  background: #0b1120;
  color: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 18px 40px -8px rgba(0, 0, 0, 0.75);
}

/* Triangle arrow pointer */
.ansatz-tooltip-arrow {
  position: absolute;
  top: -6px;
  right: 28px;
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
  background: var(--vp-c-bg-elv, #ffffff);
  border-left: 1px solid var(--vp-c-divider, rgba(15, 23, 42, 0.12));
  border-top: 1px solid var(--vp-c-divider, rgba(15, 23, 42, 0.12));
}

:global(.dark) .ansatz-tooltip-arrow {
  background: #0b1120;
  border-left: 1px solid rgba(148, 163, 184, 0.22);
  border-top: 1px solid rgba(148, 163, 184, 0.22);
}

/* Header */
.ansatz-tooltip-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.ansatz-tooltip-title {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.3;
  color: var(--vp-c-text-1, #0f172a);
}

.ansatz-tooltip-host {
  font-family: var(--vp-font-family-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--vp-c-brand-1, #0e7490);
}

/* Description */
.ansatz-tooltip-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  white-space: normal;
  overflow-wrap: break-word;
  color: var(--vp-c-text-2, #475569);
}

/* Transition */
.ansatz-tooltip-fade-enter-active,
.ansatz-tooltip-fade-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.ansatz-tooltip-fade-enter-from,
.ansatz-tooltip-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
