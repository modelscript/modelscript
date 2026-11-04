<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  screenMenu?: boolean;
}>();

const closeScreen = inject<(() => void) | undefined>("close-screen", undefined);

const isOpen = ref(false);
const isHovered = ref(false);
const isFocused = ref(false);

let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleOpen(): void {
  clearTimeout(closeTimer);
  openTimer = setTimeout(() => {
    isOpen.value = true;
  }, 90);
}

function scheduleClose(): void {
  clearTimeout(openTimer);
  closeTimer = setTimeout(() => {
    if (!isHovered.value && !isFocused.value) {
      isOpen.value = false;
    }
  }, 160);
}

function onButtonEnter(): void {
  isHovered.value = true;
  scheduleOpen();
}

function onButtonLeave(): void {
  isHovered.value = false;
  scheduleClose();
}

function onTooltipEnter(): void {
  isHovered.value = true;
  clearTimeout(closeTimer);
  isOpen.value = true;
}

function onTooltipLeave(): void {
  isHovered.value = false;
  scheduleClose();
}

function onFocusIn(): void {
  isFocused.value = true;
  clearTimeout(closeTimer);
  isOpen.value = true;
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
    isOpen.value = false;
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
      href="https://ansatz.social"
      target="_blank"
      rel="noopener noreferrer"
      class="VPNavScreenMenuLink ansatz-screen-link"
      @click="onScreenClick"
    >
      <div class="ansatz-screen-row">
        <span class="ansatz-screen-title">
          <span class="ansatz-screen-pip" aria-hidden="true" />
          <span>Explore on Ansatz</span>
        </span>
        <span class="ansatz-screen-arrow" aria-hidden="true">↗</span>
      </div>
      <p class="ansatz-screen-desc">
        Federated social engineering network &amp; package registry powered by ModelScript
      </p>
    </a>
  </div>

  <!-- Desktop nav bar pill button + informative tooltip -->
  <div
    v-else
    class="ansatz-nav-wrapper"
    @mouseenter="onButtonEnter"
    @mouseleave="onButtonLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <a
      href="https://ansatz.social"
      target="_blank"
      rel="noopener noreferrer"
      class="VPNavBarMenuLink ansatz-nav-pill"
      :class="{ 'has-focus': isFocused, 'has-hover': isHovered }"
      aria-describedby="ansatz-nav-tooltip"
      title="Ansatz — Federated Social Engineering Network & Package Registry"
    >
      <span class="ansatz-pip" aria-hidden="true" />
      <span class="ansatz-label">Explore on Ansatz</span>
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

    <!-- Explanatory Tooltip Card -->
    <Transition name="ansatz-tooltip-fade">
      <div
        v-if="isOpen"
        id="ansatz-nav-tooltip"
        class="ansatz-tooltip"
        role="tooltip"
        @mouseenter="onTooltipEnter"
        @mouseleave="onTooltipLeave"
      >
        <div class="ansatz-tooltip-arrow" aria-hidden="true" />

        <div class="ansatz-tooltip-header">
          <div class="ansatz-tooltip-badge">
            <span class="ansatz-badge-pulse" aria-hidden="true" />
            <span>ActivityPub Federation</span>
          </div>
          <span class="ansatz-tooltip-host">ansatz.social</span>
        </div>

        <div class="ansatz-tooltip-content">
          <p class="ansatz-tooltip-title">Federated Social Engineering Network</p>
          <p class="ansatz-tooltip-desc">
            Ansatz is a federated social engineering network and package registry powered by ModelScript. Connect with systems engineers, share executable simulation models, and collaborate across decentralized nodes via ActivityPub.
          </p>
        </div>

        <div class="ansatz-tooltip-features">
          <div class="ansatz-feature-tag">
            <span class="ansatz-feature-icon" aria-hidden="true">🌐</span>
            <span>Social Feeds</span>
          </div>
          <div class="ansatz-feature-tag">
            <span class="ansatz-feature-icon" aria-hidden="true">📦</span>
            <span>Package Registry</span>
          </div>
          <div class="ansatz-feature-tag">
            <span class="ansatz-feature-icon" aria-hidden="true">⚡</span>
            <span>Cloud HPC</span>
          </div>
        </div>

        <div class="ansatz-tooltip-footer">
          <span class="ansatz-footer-hint">Decentralized engineering</span>
          <a
            href="https://ansatz.social"
            target="_blank"
            rel="noopener noreferrer"
            class="ansatz-footer-link"
          >
            Visit ansatz.social <span aria-hidden="true">↗</span>
          </a>
        </div>
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
  color: var(--vp-c-text-2);
}

/* ── Tooltip Card ── */
.ansatz-tooltip {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: 326px;
  padding: 14px 16px;
  border-radius: 12px;
  z-index: 100;
  pointer-events: auto;
  text-align: left;

  /* Light mode defaults */
  background: #ffffff;
  color: #0f172a;
  border: 1px solid rgba(15, 23, 42, 0.12);
  box-shadow:
    0 16px 36px -4px rgba(15, 23, 42, 0.16),
    0 4px 14px -2px rgba(99, 102, 241, 0.12);
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
  border: 1px solid rgba(129, 140, 248, 0.3);
  box-shadow:
    0 20px 48px -8px rgba(0, 0, 0, 0.8),
    0 0 24px -4px rgba(34, 211, 238, 0.22);
}

/* Triangle arrow pointer */
.ansatz-tooltip-arrow {
  position: absolute;
  top: -6px;
  left: 50%;
  width: 11px;
  height: 11px;
  transform: translateX(-50%) rotate(45deg);
  background: #ffffff;
  border-left: 1px solid rgba(15, 23, 42, 0.12);
  border-top: 1px solid rgba(15, 23, 42, 0.12);
}

:global(.dark) .ansatz-tooltip-arrow {
  background: #0b1120;
  border-left: 1px solid rgba(129, 140, 248, 0.3);
  border-top: 1px solid rgba(129, 140, 248, 0.3);
}

/* Header */
.ansatz-tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ansatz-tooltip-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
  background: rgba(99, 102, 241, 0.1);
  color: #4f46e5;
  border: 1px solid rgba(99, 102, 241, 0.22);
}

:global(.dark) .ansatz-tooltip-badge {
  background: rgba(129, 140, 248, 0.18);
  color: #a5b4fc;
  border: 1px solid rgba(129, 140, 248, 0.35);
}

.ansatz-badge-pulse {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background-color: #059669;
  box-shadow: 0 0 6px rgba(5, 150, 105, 0.7);
}

:global(.dark) .ansatz-badge-pulse {
  background-color: #34d399;
  box-shadow: 0 0 6px #34d399;
}

.ansatz-tooltip-host {
  font-family: var(--ms-font-mono, monospace);
  font-size: 11px;
  font-weight: 550;
  color: #0e7490;
}

:global(.dark) .ansatz-tooltip-host {
  color: #22d3ee;
}

/* Content */
.ansatz-tooltip-content {
  margin-bottom: 10px;
}

.ansatz-tooltip-title {
  margin: 0 0 4px 0;
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.35;
  color: #0f172a;
}

:global(.dark) .ansatz-tooltip-title {
  color: #f8fafc;
}

.ansatz-tooltip-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
}

:global(.dark) .ansatz-tooltip-desc {
  color: #cbd5e1;
}

/* Features */
.ansatz-tooltip-features {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 11px;
}

.ansatz-feature-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 550;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

:global(.dark) .ansatz-feature-tag {
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.ansatz-feature-icon {
  font-size: 11px;
}

/* Footer */
.ansatz-tooltip-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  font-size: 11px;
}

:global(.dark) .ansatz-tooltip-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.ansatz-footer-hint {
  color: #64748b;
  font-size: 11px;
}

:global(.dark) .ansatz-footer-hint {
  color: #94a3b8;
}

.ansatz-footer-link {
  color: #0e7490;
  font-weight: 650;
  text-decoration: none;
  transition: color 0.15s ease;
}

.ansatz-footer-link:hover {
  color: #0891b2;
  text-decoration: underline;
}

:global(.dark) .ansatz-footer-link {
  color: #38bdf8;
}

:global(.dark) .ansatz-footer-link:hover {
  color: #7dd3fc;
}

/* Transition */
.ansatz-tooltip-fade-enter-active,
.ansatz-tooltip-fade-leave-active {
  transition:
    opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.ansatz-tooltip-fade-enter-from,
.ansatz-tooltip-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}
</style>
