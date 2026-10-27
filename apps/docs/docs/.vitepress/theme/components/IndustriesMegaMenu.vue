<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useRoute } from "vitepress";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { INDUSTRIES, INDUSTRY_GROUPS } from "../data/industries";
import { LANGUAGE_COUNT } from "../data/languages";
import MsIcon from "./MsIcon.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const route = useRoute();
const open = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const closeScreen = inject<(() => void) | undefined>("close-screen", undefined);

const groups = computed(() =>
  INDUSTRY_GROUPS.map((g) => ({ ...g, items: INDUSTRIES.filter((i) => i.group === g.id) })),
);

const isActive = computed(() => route.path.startsWith("/industries"));

let closeTimer: ReturnType<typeof setTimeout> | undefined;
let openTimer: ReturnType<typeof setTimeout> | undefined;

function show(): void {
  clearTimeout(closeTimer);
  open.value = true;
}
function hide(): void {
  clearTimeout(openTimer);
  open.value = false;
}
function scheduleOpen(): void {
  clearTimeout(closeTimer);
  openTimer = setTimeout(show, 80);
}
function scheduleClose(): void {
  clearTimeout(openTimer);
  closeTimer = setTimeout(hide, 160);
}
function toggle(): void {
  if (open.value) hide();
  else {
    show();
    void nextTick(() => panelRef.value?.querySelector<HTMLElement>("a")?.focus());
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && open.value) {
    hide();
    triggerRef.value?.focus();
  }
}
function onDocClick(e: MouseEvent): void {
  if (!open.value) return;
  const t = e.target as Node;
  if (panelRef.value?.contains(t) || triggerRef.value?.contains(t)) return;
  hide();
}

watch(
  () => route.path,
  () => hide(),
);

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("mousedown", onDocClick);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("mousedown", onDocClick);
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
});

// ── Mobile (screen menu) ───────────────────────────────────────────────────
const screenOpen = ref(false);
function onScreenLink(): void {
  closeScreen?.();
}
</script>

<template>
  <!-- Mobile / tablet screen menu: accordion -->
  <div v-if="props.screenMenu" class="ms-mega-screen" :class="{ open: screenOpen }">
    <button
      type="button"
      class="screen-button"
      :aria-expanded="screenOpen"
      aria-controls="ms-mega-screen-items"
      @click="screenOpen = !screenOpen"
    >
      <span>Industries</span>
      <MsIcon name="chevronDown" :size="16" class="screen-chevron" />
    </button>
    <div v-show="screenOpen" id="ms-mega-screen-items" class="screen-items">
      <div v-for="g in groups" :key="g.id" class="screen-group">
        <p class="screen-group-label">{{ g.label }}</p>
        <a
          v-for="item in g.items"
          :key="item.slug"
          :href="`/industries/${item.slug}`"
          class="screen-link"
          @click="onScreenLink"
        >
          <span class="screen-icon" :style="{ color: item.accent }"><MsIcon :name="item.icon" :size="16" /></span>
          {{ item.name }}
        </a>
      </div>
      <a href="/industries/" class="screen-link screen-all" @click="onScreenLink">All industries →</a>
    </div>
  </div>

  <!-- Desktop nav bar trigger + teleported panel -->
  <div v-else class="ms-mega" @mouseenter="scheduleOpen" @mouseleave="scheduleClose">
    <button
      ref="triggerRef"
      type="button"
      class="mega-trigger"
      :class="{ active: isActive, open }"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="ms-mega-panel"
      @click="toggle"
    >
      <span>Industries</span>
      <MsIcon name="chevronDown" :size="14" :stroke="2" class="mega-chevron" />
    </button>

    <Teleport to="body">
      <Transition name="mega">
        <div
          v-if="open"
          id="ms-mega-panel"
          ref="panelRef"
          class="mega-panel"
          role="region"
          aria-label="Industries"
          @mouseenter="show"
          @mouseleave="scheduleClose"
        >
          <div class="mega-inner">
            <div class="mega-columns">
              <section v-for="g in groups" :key="g.id" class="mega-col">
                <h3 class="mega-col-label">{{ g.label }}</h3>
                <ul>
                  <li v-for="item in g.items" :key="item.slug">
                    <a :href="`/industries/${item.slug}`" class="mega-item" :style="{ '--accent': item.accent }">
                      <span class="mega-item-icon"><MsIcon :name="item.icon" :size="18" /></span>
                      <span class="mega-item-text">
                        <span class="mega-item-name">{{ item.name }}</span>
                        <span class="mega-item-tag">{{ item.tagline }}</span>
                      </span>
                    </a>
                  </li>
                </ul>
              </section>
            </div>

            <aside class="mega-feature">
              <span class="feature-eyebrow">Featured workflow</span>
              <h3 class="feature-title">IEEE 2800 ride-through, automated</h3>
              <p class="feature-body">
                Verify LVRT/HVRT compliance for inverter-based resources directly from PSCAD projects, with no desktop
                license required.
              </p>
              <code class="feature-code">msx pscad verify-ieee2800 Plant.pscx</code>
              <a href="/industries/power-systems" class="feature-link">
                Explore Power Systems <MsIcon name="arrowRight" :size="14" :stroke="2" />
              </a>
            </aside>
          </div>

          <div class="mega-footer">
            <a href="/industries/" class="mega-footer-link"> <MsIcon name="globe" :size="15" /> All industries </a>
            <a href="/languages/overview" class="mega-footer-link">
              <MsIcon name="layers" :size="15" /> Browse all {{ LANGUAGE_COUNT }} languages &amp; formats
            </a>
            <a href="https://modelscript.org/playground" class="mega-footer-link">
              <MsIcon name="terminal" :size="15" /> Try it in the Playground
            </a>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Desktop trigger (matches VPNavBarMenuLink metrics) ── */
.ms-mega {
  display: flex;
  align-items: center;
  height: var(--vp-nav-height);
}

.mega-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  height: var(--vp-nav-height);
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}

.mega-trigger:hover,
.mega-trigger.open,
.mega-trigger.active {
  color: var(--vp-c-brand-1);
}

.mega-chevron {
  transition: transform 0.25s ease;
  opacity: 0.7;
}

.mega-trigger.open .mega-chevron {
  transform: rotate(180deg);
}
</style>

<style>
/* Panel is teleported to <body>, so these styles are global but namespaced. */
.mega-panel {
  position: fixed;
  top: calc(var(--vp-nav-height) + var(--vp-layout-top-height, 0px) - 4px);
  left: 50%;
  transform: translateX(-50%);
  width: min(1180px, calc(100vw - 48px));
  z-index: calc(var(--vp-z-index-nav) + 10);
  border-radius: 18px;
  border: 1px solid var(--ms-border-strong);
  background: var(--ms-surface-glass);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow:
    0 30px 80px -20px rgba(2, 6, 23, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.02) inset;
  overflow: hidden;
}

.mega-panel::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: var(--ms-gradient);
  opacity: 0.7;
}

.mega-inner {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 8px;
  padding: 22px;
}

.mega-columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.mega-col-label {
  margin: 0 0 8px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.mega-col ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mega-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px;
  border-radius: 12px;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition:
    background 0.2s ease,
    transform 0.2s ease;
}

.mega-item:hover,
.mega-item:focus-visible {
  background: var(--ms-surface-hover);
  outline: none;
}

.mega-item-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  transition: transform 0.2s ease;
}

.mega-item:hover .mega-item-icon {
  transform: scale(1.06);
}

.mega-item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mega-item-name {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.mega-item-tag {
  margin-top: 2px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--vp-c-text-2);
}

.mega-feature {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border-radius: 14px;
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(250, 204, 21, 0.16), transparent 60%),
    radial-gradient(100% 80% at 0% 100%, rgba(34, 211, 238, 0.14), transparent 60%), var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.feature-eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.feature-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--vp-c-text-1);
}

.feature-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.feature-code {
  display: block;
  padding: 8px 10px;
  border-radius: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feature-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.feature-link:hover {
  gap: 9px;
}

.mega-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 24px;
  padding: 14px 32px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--ms-surface-footer);
}

.mega-footer-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.2s;
}

.mega-footer-link:hover {
  color: var(--vp-c-brand-1);
}

.mega-enter-active,
.mega-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.mega-enter-from,
.mega-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}

@media (max-width: 1100px) {
  .mega-inner {
    grid-template-columns: 1fr;
  }
  .mega-feature {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mega-enter-active,
  .mega-leave-active {
    transition: none;
  }
}

/* ── Mobile screen menu ── */
.ms-mega-screen {
  border-bottom: 1px solid var(--vp-c-divider);
}

.ms-mega-screen .screen-button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 12px 4px 11px 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 24px;
  color: var(--vp-c-text-1);
}

.ms-mega-screen .screen-chevron {
  transition: transform 0.25s;
}

.ms-mega-screen.open .screen-chevron {
  transform: rotate(180deg);
}

.ms-mega-screen .screen-items {
  padding-bottom: 10px;
}

.ms-mega-screen .screen-group-label {
  margin: 10px 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.ms-mega-screen .screen-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  font-size: 14px;
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.ms-mega-screen .screen-link:hover {
  color: var(--vp-c-brand-1);
}

.ms-mega-screen .screen-all {
  margin-top: 6px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
</style>
