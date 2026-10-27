<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
import { ref } from "vue";
import type { IconName } from "../data/icons";

export interface MegaMenuItem {
  name: string;
  tagline: string;
  href: string;
  icon: IconName;
  accent: string;
  target?: string;
}

export interface MegaMenuColumn {
  id: string;
  label: string;
  items: MegaMenuItem[];
}

export interface MegaMenuFeature {
  eyebrow: string;
  title: string;
  body: string;
  code: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface MegaMenuFooterLink {
  label: string;
  href: string;
  icon: IconName;
  target?: string;
}

/** Shared state across all topnav mega menus so sliding across triggers switches cleanly. */
const activeMenuId = ref<string | null>(null);
let sharedCloseTimer: ReturnType<typeof setTimeout> | undefined;
let sharedOpenTimer: ReturnType<typeof setTimeout> | undefined;
</script>

<script setup lang="ts">
import { useRoute } from "vitepress";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import MsIcon from "./MsIcon.vue";

const props = defineProps<{
  menuId: string;
  label: string;
  activePrefixes: string[];
  columns: MegaMenuColumn[];
  feature: MegaMenuFeature;
  footerLinks: MegaMenuFooterLink[];
  mobileAllLink?: { label: string; href: string };
  screenMenu?: boolean;
}>();

const route = useRoute();
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const closeScreen = inject<(() => void) | undefined>("close-screen", undefined);

const open = computed(() => activeMenuId.value === props.menuId);

const isActive = computed(() => props.activePrefixes.some((prefix) => route.path.startsWith(prefix)));

const panelDomId = computed(() => `ms-mega-panel-${props.menuId}`);
const screenDomId = computed(() => `ms-mega-screen-${props.menuId}`);

function show(): void {
  clearTimeout(sharedCloseTimer);
  clearTimeout(sharedOpenTimer);
  activeMenuId.value = props.menuId;
}

function hide(): void {
  clearTimeout(sharedOpenTimer);
  if (activeMenuId.value === props.menuId) {
    activeMenuId.value = null;
  }
}

function scheduleOpen(): void {
  clearTimeout(sharedCloseTimer);
  clearTimeout(sharedOpenTimer);
  if (activeMenuId.value !== null && activeMenuId.value !== props.menuId) {
    // Another mega menu is already open: switch immediately for fluid bar scrubbing
    activeMenuId.value = props.menuId;
    return;
  }
  sharedOpenTimer = setTimeout(show, 75);
}

function scheduleClose(): void {
  clearTimeout(sharedOpenTimer);
  clearTimeout(sharedCloseTimer);
  sharedCloseTimer = setTimeout(hide, 160);
}

function toggle(): void {
  if (open.value) {
    hide();
  } else {
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
  if (open.value) {
    clearTimeout(sharedOpenTimer);
    clearTimeout(sharedCloseTimer);
  }
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
      :aria-controls="screenDomId"
      @click="screenOpen = !screenOpen"
    >
      <span>{{ props.label }}</span>
      <MsIcon name="chevronDown" :size="16" class="screen-chevron" />
    </button>
    <div v-show="screenOpen" :id="screenDomId" class="screen-items">
      <div v-for="col in props.columns" :key="col.id" class="screen-group">
        <p class="screen-group-label">{{ col.label }}</p>
        <a
          v-for="item in col.items"
          :key="item.name"
          :href="item.href"
          :target="item.target"
          :rel="item.target === '_blank' ? 'noopener noreferrer' : undefined"
          class="screen-link"
          @click="onScreenLink"
        >
          <span class="screen-icon" :style="{ color: item.accent }">
            <MsIcon :name="item.icon" :size="18" :duotone="true" />
          </span>
          {{ item.name }}
        </a>
      </div>
      <a v-if="props.mobileAllLink" :href="props.mobileAllLink.href" class="screen-link screen-all" @click="onScreenLink">
        {{ props.mobileAllLink.label }}
      </a>
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
      :aria-controls="panelDomId"
      @click="toggle"
    >
      <span>{{ props.label }}</span>
      <MsIcon name="chevronDown" :size="14" :stroke="2" class="mega-chevron" />
    </button>

    <Teleport to="body">
      <Transition name="mega">
        <div
          v-if="open"
          :id="panelDomId"
          ref="panelRef"
          class="mega-panel"
          role="region"
          :aria-label="props.label"
          @mouseenter="show"
          @mouseleave="scheduleClose"
        >
          <div class="mega-inner">
            <div class="mega-columns">
              <section v-for="col in props.columns" :key="col.id" class="mega-col">
                <h3 class="mega-col-label">{{ col.label }}</h3>
                <ul>
                  <li v-for="item in col.items" :key="item.name">
                    <a
                      :href="item.href"
                      :target="item.target"
                      :rel="item.target === '_blank' ? 'noopener noreferrer' : undefined"
                      class="mega-item"
                      :style="{ '--accent': item.accent }"
                      @click="hide"
                    >
                      <span class="mega-item-icon"><MsIcon :name="item.icon" :size="20" :duotone="true" /></span>
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
              <span class="feature-eyebrow">{{ props.feature.eyebrow }}</span>
              <h3 class="feature-title">{{ props.feature.title }}</h3>
              <p class="feature-body">{{ props.feature.body }}</p>
              <code class="feature-code">{{ props.feature.code }}</code>
              <a :href="props.feature.ctaHref" class="feature-link" @click="hide">
                {{ props.feature.ctaLabel }} <MsIcon name="arrowRight" :size="14" :stroke="2" />
              </a>
            </aside>
          </div>

          <div class="mega-footer">
            <a
              v-for="f in props.footerLinks"
              :key="f.label"
              :href="f.href"
              :target="f.target"
              :rel="f.target === '_blank' ? 'noopener noreferrer' : undefined"
              class="mega-footer-link"
              @click="hide"
            >
              <MsIcon :name="f.icon" :size="15" :duotone="true" /> {{ f.label }}
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
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background:
    radial-gradient(circle at 25% 20%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.15), transparent 68%),
    color-mix(in srgb, var(--accent) 10%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    0 6px 16px -8px color-mix(in srgb, var(--accent) 50%, transparent);
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
}

.mega-item:hover .mega-item-icon {
  transform: scale(1.06) translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
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
    radial-gradient(120% 80% at 100% 0%, rgba(250, 204, 21, 0.14), transparent 60%),
    radial-gradient(100% 80% at 0% 100%, rgba(34, 211, 238, 0.14), transparent 60%),
    var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
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
