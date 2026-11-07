<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";
import { CALLOUTS, type CalloutSpec } from "./turbine/callouts";
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

const sectionCutPct = ref<number>(48);
const isManualScrub = ref<boolean>(false);
const activeCalloutKey = ref<string | null>(null);

const activeCallout = computed<CalloutSpec | null>(
  () => CALLOUTS.find((c) => c.key === activeCalloutKey.value) ?? null,
);

const MODES: ReadonlyArray<{ id: ViewMode; label: string; icon: IconName; hint: string }> = [
  { id: "section", label: "Section", icon: "split", hint: "Animated section plane: solid ahead, wireframe behind" },
  { id: "wire", label: "Wireframe", icon: "grid", hint: "Full wireframe digital twin" },
  { id: "solid", label: "Solid", icon: "cube", hint: "Solid exterior" },
];

let resizeObs: ResizeObserver | undefined;
let interObs: IntersectionObserver | undefined;
let motionQuery: MediaQueryList | undefined;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
const onMotionChange = (e: MediaQueryListEvent) => scene.value?.setReducedMotion(e.matches);

function webglAvailable(): boolean {
  try {
    if (typeof window === "undefined" || !window.WebGL2RenderingContext) return false;
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return false;
    try {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // ignore
    }
    return true;
  } catch {
    return false;
  }
}

function onScrubInput(e: Event): void {
  const val = Number((e.target as HTMLInputElement).value);
  sectionCutPct.value = val;
  isManualScrub.value = true;
  scene.value?.setManualSectionCut(val / 100);
}

function resetAutoSweep(): void {
  isManualScrub.value = false;
  scene.value?.setManualSectionCut(null);
}

function selectCallout(c: CalloutSpec): void {
  if (activeCalloutKey.value === c.key) {
    activeCalloutKey.value = null;
    return;
  }
  activeCalloutKey.value = c.key;
}

onMounted(async () => {
  if (!canvas.value || !stage.value || !webglAvailable()) {
    fallback.value = true;
    return;
  }

  // Safety net: if the 3D scene never signals first frame within 8s (generous for older mobile A10 CPUs),
  // gracefully fall back to the digital twin illustration so the hero is never blank.
  fallbackTimer = setTimeout(() => {
    if (!ready.value && !fallback.value) {
      fallback.value = true;
    }
  }, 8000);

  await nextTick();
  if (!canvas.value || !stage.value) {
    fallback.value = true;
    return;
  }

  try {
    motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const { TurbineScene } = await import("./turbine/scene");
    if (!canvas.value || !stage.value) return;

    scene.value = new TurbineScene({
      canvas: canvas.value,
      dark: isDark.value,
      reducedMotion: motionQuery?.matches ?? false,
      callouts: CALLOUTS.map((_, i) => ({
        label: labelEls.value[i],
        line: lineEls.value[i],
        dot: dotEls.value[i],
      })),
      onFirstFrame: () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallback.value = false;
        ready.value = true;
      },
      onError: () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallback.value = true;
      },
    });
  } catch {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallback.value = true;
    return;
  }

  // WebKit on older iOS only implements .addListener / .removeListener on MediaQueryList
  if (motionQuery) {
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", onMotionChange);
    } else if (typeof (motionQuery as any).addListener === "function") {
      (motionQuery as any).addListener(onMotionChange);
    }
  }

  const s = scene.value;
  if (!s || !stage.value) return;

  const rect = stage.value.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    s.resize(rect.width, rect.height);
  }

  if (typeof ResizeObserver !== "undefined") {
    resizeObs = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        s.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    resizeObs.observe(stage.value);
  } else {
    window.addEventListener("resize", () => {
      if (stage.value) {
        const r = stage.value.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) s.resize(r.width, r.height);
      }
    });
  }

  if (typeof IntersectionObserver !== "undefined" && root.value) {
    interObs = new IntersectionObserver(([entry]) => s.setVisible(entry.isIntersecting), { threshold: 0.01 });
    interObs.observe(root.value);
  }

  canvas.value.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallback.value = true;
  });
});

onBeforeUnmount(() => {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  resizeObs?.disconnect();
  interObs?.disconnect();
  if (motionQuery) {
    if (typeof motionQuery.removeEventListener === "function") {
      motionQuery.removeEventListener("change", onMotionChange);
    } else if (typeof (motionQuery as any).removeListener === "function") {
      (motionQuery as any).removeListener(onMotionChange);
    }
  }
  scene.value?.dispose();
  scene.value = null;
});

watch(mode, (m) => {
  if (m !== "section") {
    isManualScrub.value = false;
    scene.value?.setManualSectionCut(null);
  }
  scene.value?.setMode(m);
});
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
      <img
        class="turbine-fallback"
        :class="{ 'is-hidden': ready && !fallback }"
        src="/ms-logo.png"
        alt="ModelScript Turbofan Digital Twin"
      />
      <canvas ref="canvas" class="turbine-canvas" :class="{ 'is-ready': ready && !fallback }" />
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
      <button
        v-for="(c, i) in CALLOUTS"
        :key="c.key"
        type="button"
        class="turbine-callout"
        :class="{ 'is-active': activeCalloutKey === c.key }"
        :aria-pressed="activeCalloutKey === c.key"
        :title="`Inspect ${c.title} governing equations`"
        :ref="
          (el) => {
            if (el) labelEls[i] = el as HTMLElement;
          }
        "
        @click.stop="selectCallout(c)"
      >
        <span class="turbine-callout-title">{{ c.title }}</span>
        <span class="turbine-callout-detail">{{ c.detail }}</span>
      </button>

      <!-- Interactive Callout Domain & Physics Inspector Card -->
      <transition name="callout-pop">
        <div v-if="activeCallout" class="turbine-inspector" role="dialog" :aria-label="`${activeCallout.title} physics`">
          <div class="ti-head">
            <div>
              <span class="ti-kicker">{{ activeCallout.domain }}</span>
              <h4 class="ti-title">{{ activeCallout.title }} · {{ activeCallout.detail }}</h4>
            </div>
            <button type="button" class="ti-close" aria-label="Close inspector" @click="activeCalloutKey = null">
              ×
            </button>
          </div>
          <code class="ti-eq">{{ activeCallout.equation }}</code>
          <p class="ti-summary">{{ activeCallout.summary }}</p>
          <a :href="activeCallout.link" class="ti-link">{{ activeCallout.linkLabel }}</a>
        </div>
      </transition>
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
      <template v-if="mode === 'section'">
        <span class="turbine-divider" aria-hidden="true" />
        <label class="turbine-scrubber" title="Drag to scrub the axial section plane along the engine">
          <span class="scrubber-label">Cut</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="sectionCutPct"
            aria-label="Section cutaway axial position"
            @input="onScrubInput"
          />
          <button
            v-if="isManualScrub"
            type="button"
            class="scrubber-auto-btn"
            title="Resume automatic section plane sweep"
            @click="resetAutoSweep"
          >
            Auto
          </button>
        </label>
      </template>
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
  opacity: 1;
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
  opacity: 0;
  transition: opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}

.turbine-canvas.is-ready {
  opacity: 1;
}

.turbine-fallback {
  position: absolute;
  inset: 0;
  margin: auto;
  max-height: 62%;
  max-width: 72%;
  object-fit: contain;
  opacity: 1;
  filter: drop-shadow(0 16px 36px rgba(6, 182, 212, 0.32));
  transition: opacity 0.6s ease;
  pointer-events: none;
}

.turbine-fallback.is-hidden {
  opacity: 0;
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
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--vp-c-bg) 72%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  white-space: nowrap;
  cursor: pointer;
  pointer-events: none;
  will-change: transform, opacity;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease;
}

.turbine-callout:hover,
.turbine-callout.is-active {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 55%, transparent);
  background: color-mix(in srgb, var(--vp-c-bg-elv) 92%, transparent);
  box-shadow: 0 4px 14px -4px rgba(6, 182, 212, 0.32);
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

/* ── Inspector Popover Card ───────────────────────────── */

.turbine-inspector {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  width: min(360px, calc(100% - 24px));
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 42%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-bg-elv) 94%, transparent);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: 0 16px 36px -12px rgba(2, 6, 23, 0.45);
  z-index: 4;
  cursor: default;
}

.ti-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.ti-kicker {
  display: block;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.ti-title {
  margin: 2px 0 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ti-close {
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.ti-close:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.ti-eq {
  display: block;
  padding: 5px 8px;
  margin: 6px 0;
  border-radius: 6px;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-1);
  overflow-x: auto;
}

.ti-summary {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.ti-link {
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.ti-link:hover {
  text-decoration: underline;
}

.callout-pop-enter-active,
.callout-pop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.callout-pop-enter-from,
.callout-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
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
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  margin-top: 8px;
  padding: 3px 6px;
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

.turbine-scrubber {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.scrubber-label {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.turbine-scrubber input[type="range"] {
  width: 72px;
  height: 4px;
  accent-color: var(--vp-c-brand-1);
  cursor: pointer;
}

.scrubber-auto-btn {
  padding: 1px 6px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 40%, transparent);
  background: var(--ms-brand-soft);
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
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

@media (max-width: 520px) {
  .turbine-seg-btn span {
    display: none;
  }
  .turbine-scrubber input[type="range"] {
    width: 54px;
  }
}
</style>

