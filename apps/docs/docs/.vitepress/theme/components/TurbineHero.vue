<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";
import { CALLOUTS } from "./turbine/geometry";
import type { TurbineScene, ViewMode } from "./turbine/scene";

const { isDark } = useData();

const root = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const labelEls = ref<HTMLElement[]>([]);
const lineEls = ref<SVGLineElement[]>([]);
const dotEls = ref<SVGCircleElement[]>([]);

const mode = ref<ViewMode>("section");
const paused = ref(false);
const ready = ref(false);
const fallback = ref(false);
const scene = shallowRef<TurbineScene | null>(null);

const MODES: ReadonlyArray<{ id: ViewMode; label: string; icon: IconName; hint: string }> = [
  { id: "section", label: "Section", icon: "split", hint: "Animated section plane: solid ahead, wireframe behind" },
  { id: "wire", label: "Wireframe", icon: "grid", hint: "Full wireframe digital twin" },
  { id: "solid", label: "Solid", icon: "cube", hint: "Solid exterior" },
];

let resizeObs: ResizeObserver | undefined;
let interObs: IntersectionObserver | undefined;
let motionQuery: MediaQueryList | undefined;
const onMotionChange = (e: MediaQueryListEvent) => scene.value?.setReducedMotion(e.matches);

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

onMounted(async () => {
  if (!canvas.value || !stage.value || !webglAvailable()) {
    fallback.value = true;
    return;
  }
  await nextTick();
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const { TurbineScene } = await import("./turbine/scene");
  if (!canvas.value || !stage.value) return;
  try {
    scene.value = new TurbineScene({
      canvas: canvas.value,
      dark: isDark.value,
      reducedMotion: motionQuery.matches,
      callouts: CALLOUTS.map((_, i) => ({
        label: labelEls.value[i],
        line: lineEls.value[i],
        dot: dotEls.value[i],
      })),
      onFirstFrame: () => (ready.value = true),
    });
  } catch {
    fallback.value = true;
    return;
  }
  motionQuery.addEventListener("change", onMotionChange);

  const s = scene.value;
  const rect = stage.value.getBoundingClientRect();
  s.resize(rect.width, rect.height);
  resizeObs = new ResizeObserver(([entry]) => s.resize(entry.contentRect.width, entry.contentRect.height));
  resizeObs.observe(stage.value);
  interObs = new IntersectionObserver(([entry]) => s.setVisible(entry.isIntersecting), { threshold: 0.01 });
  if (root.value) interObs.observe(root.value);
});

onBeforeUnmount(() => {
  resizeObs?.disconnect();
  interObs?.disconnect();
  motionQuery?.removeEventListener("change", onMotionChange);
  scene.value?.dispose();
  scene.value = null;
});

watch(mode, (m) => scene.value?.setMode(m));
watch(paused, (p) => scene.value?.setPaused(p));
watch(isDark, () => nextTick(() => scene.value?.setDark(isDark.value)));

function onRadioKey(e: KeyboardEvent, index: number) {
  const delta =
    e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!delta) return;
  e.preventDefault();
  const next = (index + delta + MODES.length) % MODES.length;
  mode.value = MODES[next].id;
  const group = (e.currentTarget as HTMLElement).parentElement;
  group?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
}
</script>

<template>
  <div ref="root" class="turbine" :class="{ 'is-ready': ready, 'is-fallback': fallback }">
    <div
      ref="stage"
      class="turbine-stage"
      role="img"
      aria-label="Interactive cutaway of a two-spool turbofan engine. A section plane sweeps along the engine: solid geometry ahead of the plane, a wireframe digital twin behind it revealing the fan, compressors, annular combustor and turbines."
    >
      <canvas ref="canvas" class="turbine-canvas" />
      <svg class="turbine-leaders" aria-hidden="true">
        <g v-for="(c, i) in CALLOUTS" :key="c.key">
          <line
            :ref="
              (el) => {
                if (el) lineEls[i] = el as SVGLineElement;
              }
            "
          />
          <circle
            r="2.5"
            :ref="
              (el) => {
                if (el) dotEls[i] = el as SVGCircleElement;
              }
            "
          />
        </g>
      </svg>
      <div
        v-for="(c, i) in CALLOUTS"
        :key="c.key"
        class="turbine-callout"
        aria-hidden="true"
        :ref="
          (el) => {
            if (el) labelEls[i] = el as HTMLElement;
          }
        "
      >
        <span class="turbine-callout-title">{{ c.title }}</span>
        <span class="turbine-callout-detail">{{ c.detail }}</span>
      </div>
      <img v-if="fallback" class="turbine-fallback" src="/ms-logo.png" alt="" />
    </div>

    <div v-if="!fallback" class="turbine-toolbar" role="toolbar" aria-label="Engine model view">
      <div class="turbine-seg" role="radiogroup" aria-label="Display mode">
        <button
          v-for="(m, i) in MODES"
          :key="m.id"
          type="button"
          role="radio"
          class="turbine-seg-btn"
          :aria-checked="mode === m.id"
          :tabindex="mode === m.id ? 0 : -1"
          :title="m.hint"
          @click="mode = m.id"
          @keydown="onRadioKey($event, i)"
        >
          <MsIcon :name="m.icon" :size="14" :stroke="1.9" />
          <span>{{ m.label }}</span>
        </button>
      </div>
      <span class="turbine-divider" aria-hidden="true" />
      <button
        type="button"
        class="turbine-icon-btn"
        :aria-pressed="paused"
        :aria-label="paused ? 'Resume animation' : 'Pause animation'"
        :title="paused ? 'Resume animation' : 'Pause animation'"
        @click="paused = !paused"
      >
        <MsIcon :name="paused ? 'play' : 'pause'" :size="13" :stroke="1.9" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.turbine {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 1.1s cubic-bezier(0.22, 1, 0.36, 1),
    transform 1.1s cubic-bezier(0.22, 1, 0.36, 1);
}

.turbine.is-ready,
.turbine.is-fallback {
  opacity: 1;
  transform: none;
}

.turbine-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  touch-action: pan-y;
  cursor: grab;
}

.turbine-stage:active {
  cursor: grabbing;
}

.turbine-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.turbine-fallback {
  position: absolute;
  inset: 0;
  margin: auto;
  max-height: 70%;
  max-width: 80%;
  object-fit: contain;
}

/* ── Callouts ─────────────────────────────────────────── */

.turbine-leaders {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.turbine-leaders line {
  stroke: var(--vp-c-text-3);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.turbine-leaders circle {
  fill: var(--vp-c-bg);
  stroke: color-mix(in srgb, var(--vp-c-brand-1) var(--ms-accent-strength, 100%), var(--vp-c-text-1));
  stroke-width: 1.25;
}

.turbine-callout {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px 0;
  white-space: nowrap;
  pointer-events: none;
  will-change: transform, opacity;
}

.turbine-callout-title {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-1);
}

.turbine-callout-detail {
  font-size: 11.5px;
  color: var(--vp-c-text-2);
}

@media (max-width: 640px) {
  .turbine-leaders,
  .turbine-callout {
    display: none;
  }
}

/* ── Toolbar ──────────────────────────────────────────── */

.turbine-toolbar {
  flex: 0 0 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 3px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-bg) 78%, transparent);
  backdrop-filter: blur(10px) saturate(1.4);
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.turbine-seg {
  display: inline-flex;
  gap: 2px;
}

.turbine-seg-btn,
.turbine-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-base);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.turbine-seg-btn {
  padding: 0 10px;
}

.turbine-icon-btn {
  width: 28px;
}

.turbine-seg-btn:hover,
.turbine-icon-btn:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}

.turbine-seg-btn[aria-checked="true"] {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border-color: var(--vp-c-divider);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.turbine-seg-btn[aria-checked="true"] :deep(.ms-icon) {
  color: color-mix(in srgb, var(--vp-c-brand-1) var(--ms-accent-strength, 100%), var(--vp-c-text-1));
}

.turbine-seg-btn:focus-visible,
.turbine-icon-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 1px;
}

.turbine-divider {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--vp-c-divider);
}

@media (max-width: 420px) {
  .turbine-seg-btn span {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .turbine {
    transform: none;
  }
}
</style>
