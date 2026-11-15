<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";
import { CALLOUTS, type CalloutSpec } from "./turbine/callouts";
import { TURBINE_GDT_ITEMS, TURBINE_GDT_OVERLAY } from "./turbine/gdt-callouts";
import type { TurbineArtifactId } from "./turbine/models";
import type { ScadOverlayMesh, StepSpoolBinding, TurbineScene, ViewMode } from "./turbine/scene";
import type { CompiledStepPayload, StudioView } from "./TurbineLspStudio.vue";

const LazyTurbineLspStudio = defineAsyncComponent(() => import("./TurbineLspStudio.vue"));

const { isDark } = useData();

const root = ref<HTMLElement | null>(null);
const frameEl = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const labelEls = ref<HTMLElement[]>([]);
const lineEls = ref<SVGLineElement[]>([]);
const dotEls = ref<SVGCircleElement[]>([]);
const gdtDatumEls: Array<HTMLElement | undefined> = [];
const gdtCalloutEls: Array<HTMLElement | undefined> = [];

const mode = ref<ViewMode>("section");
const paused = ref(false);
const ready = ref(false);
const fallback = ref(false);
const scene = shallowRef<TurbineScene | null>(null);

const sectionCutPct = ref<number>(48);
const isManualScrub = ref<boolean>(false);
const activeCalloutKey = ref<string | null>(null);
const showGdt = ref(false);
const liveGdtOverlay = shallowRef<CompiledStepPayload["gdtOverlay"] | null>(null);

// Studio in-place state (zero Monaco/LSP cost until hovered or clicked)
const studioOpen = ref(false);
const studioView = ref<StudioView>("split");
const studioExpanded = ref(false);
const studioInitialArtifact = ref<TurbineArtifactId>("modelica");
const studioSearchHint = ref<string | null>(null);
const highlightedGdtId = ref<string | null>(null);
const isStageOccluded = computed(
  () => studioOpen.value && (studioView.value === "code" || studioView.value === "diagram"),
);
const showGdtLayer = computed(
  () => showGdt.value && ready.value && !fallback.value && !isStageOccluded.value,
);

const stageSlotCss = ref<Record<string, string>>({});
let slotEl: HTMLElement | null = null;
let slotObs: ResizeObserver | undefined;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
let prefetched = false;

const activeCallout = computed<CalloutSpec | null>(
  () => CALLOUTS.find((c) => c.key === activeCalloutKey.value) ?? null,
);

const MODES: ReadonlyArray<{ id: ViewMode; label: string; icon: IconName; hint: string }> = [
  { id: "section", label: "Section", icon: "split", hint: "Animated section plane: solid ahead, wireframe behind" },
  { id: "wire", label: "Wireframe", icon: "grid", hint: "Full wireframe digital twin" },
  { id: "solid", label: "Solid", icon: "cube", hint: "Solid exterior" },
];

const activeGdtDatums = computed(() => liveGdtOverlay.value?.datums ?? TURBINE_GDT_OVERLAY.datums);

const activeGdtItems = computed(() => {
  const ov = liveGdtOverlay.value;
  if (!ov || ov.callouts.length === 0) return TURBINE_GDT_ITEMS;
  return ov.callouts.map((c) => {
    const fallbackItem = TURBINE_GDT_ITEMS.find((t) => t.qifCharacteristicId === c.id);
    const datumStr = c.datums.map((d) => d.label).join("|");
    const tolStr = `${c.diametrical ? "⌀" : ""}${Number(c.tolerance).toFixed(3)}`;
    const fcfText = datumStr ? `${c.symbol} ${tolStr} | ${datumStr}` : `${c.symbol} ${tolStr}`;
    return {
      qifCharacteristicId: c.id,
      sectionId: fallbackItem?.sectionId ?? "hpc",
      actualDeviationMm: c.measured ?? 0,
      fcfText,
      callout: c,
    };
  });
});

const gdtAnchorPoints = computed(() => [
  ...activeGdtDatums.value.map((d) => d.anchor),
  ...activeGdtItems.value.map((item) => item.callout.anchor),
]);

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

function scheduleIntentPrefetch(): void {
  if (prefetched || prefetchTimer || studioOpen.value) return;
  prefetchTimer = setTimeout(() => {
    prefetchTimer = undefined;
    if (prefetched) return;
    prefetched = true;
    void import("./TurbineLspStudio.vue");
    void import("../util/docs-lsp-client.js")
      .then((m) => m.ensureDocsLspReady("modelica"))
      .catch(() => {});
  }, 120);
}

function cancelIntentPrefetch(): void {
  if (prefetchTimer) {
    clearTimeout(prefetchTimer);
    prefetchTimer = undefined;
  }
}

function syncGdtOverlayDom(): void {
  const s = scene.value;
  if (!s || !showGdtLayer.value) return;
  const pts = s.projectWorldPoints(gdtAnchorPoints.value);
  const datumCount = activeGdtDatums.value.length;

  for (let i = 0; i < datumCount; i++) {
    const el = gdtDatumEls[i];
    const pt = pts[i];
    if (!el || !pt) continue;
    el.style.opacity = pt.visible ? "1" : "0";
    el.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  for (let j = 0; j < activeGdtItems.value.length; j++) {
    const el = gdtCalloutEls[j];
    const pt = pts[datumCount + j];
    if (!el || !pt) continue;
    el.style.opacity = pt.visible ? "1" : "0";
    el.style.pointerEvents = pt.visible ? "auto" : "none";
    el.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${(pt.y - 12).toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}

function measureStageSlot(): void {
  if (!slotEl || !frameEl.value || !studioOpen.value) return;
  const fr = frameEl.value.getBoundingClientRect();
  const sr = slotEl.getBoundingClientRect();
  if (sr.width <= 0 || sr.height <= 0) return;
  stageSlotCss.value = {
    position: "absolute",
    left: `${Math.round(sr.left - fr.left)}px`,
    top: `${Math.round(sr.top - fr.top)}px`,
    width: `${Math.round(sr.width)}px`,
    height: `${Math.round(sr.height)}px`,
    flex: "none",
    zIndex: "5",
  };
}

function onStageSlot(el: HTMLElement | null): void {
  slotEl = el;
  slotObs?.disconnect();
  slotObs = undefined;
  if (!el) {
    if (!studioOpen.value) {
      stageSlotCss.value = {};
    }
    return;
  }
  slotObs = new ResizeObserver(() => measureStageSlot());
  slotObs.observe(el);
  if (frameEl.value) slotObs.observe(frameEl.value);
  void nextTick().then(() => {
    measureStageSlot();
    requestAnimationFrame(measureStageSlot);
  });
}

function openStudio(artifactId: TurbineArtifactId = "modelica", searchHint: string | null = null): void {
  cancelIntentPrefetch();
  activeCalloutKey.value = null;
  studioInitialArtifact.value = artifactId;
  studioSearchHint.value = searchHint;
  const containerH = root.value?.clientHeight ?? 560;
  studioView.value = containerH < 410 ? "code" : "split";
  if (artifactId === "qif") {
    showGdt.value = true;
  }
  studioOpen.value = true;
  void nextTick().then(() => {
    measureStageSlot();
    syncGdtOverlayDom();
  });
}

function closeStudio(): void {
  studioOpen.value = false;
  studioExpanded.value = false;
  stageSlotCss.value = {};
  slotEl = null;
  slotObs?.disconnect();
  slotObs = undefined;
  highlightedGdtId.value = null;
  scene.value?.setStepWireHighlight(false);
  if (!isManualScrub.value) {
    scene.value?.setManualSectionCut(null);
  }
  void nextTick().then(() => {
    if (stage.value && scene.value) {
      const rect = stage.value.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) scene.value.resize(rect.width, rect.height);
    }
    syncGdtOverlayDom();
  });
}

function onStudioLiveParams(params: {
  n1Rpm: number;
  n2Rpm: number;
  t04K: number;
  cutX: number | null;
  cutEdited: boolean;
}): void {
  scene.value?.setSpoolRpms(params.n1Rpm, params.n2Rpm);
  scene.value?.setCombustorIntensity(params.t04K);
  if (params.cutEdited && params.cutX !== null) {
    isManualScrub.value = true;
    scene.value?.setManualSectionCutX(params.cutX);
  }
}

function onStudioCompiledStep(payload: CompiledStepPayload | null): void {
  if (!payload) {
    liveGdtOverlay.value = null;
    gdtDatumEls.length = 0;
    gdtCalloutEls.length = 0;
    scene.value?.setCompiledStepScene(null);
    void nextTick().then(() => syncGdtOverlayDom());
    return;
  }
  const spools: StepSpoolBinding[] = payload.spools.map((s) => ({
    part: s.part,
    spool: s.spool,
    axis: s.axis,
  }));
  scene.value?.setCompiledStepScene(payload.meshes, spools);
  if (payload.gdtOverlay && (payload.gdtOverlay.datums.length > 0 || payload.gdtOverlay.callouts.length > 0)) {
    gdtDatumEls.length = 0;
    gdtCalloutEls.length = 0;
    liveGdtOverlay.value = payload.gdtOverlay;
  }
  void nextTick().then(() => syncGdtOverlayDom());
}

function onStudioStepWire(enabled: boolean): void {
  scene.value?.setStepWireHighlight(enabled);
}

function onStudioScadMeshes(meshes: ScadOverlayMesh[] | null): void {
  scene.value?.setCompiledStepScene(meshes);
}

function onGdtBadgeClick(qifCharacteristicId: string): void {
  highlightedGdtId.value = qifCharacteristicId;
  if (!studioOpen.value) {
    openStudio("qif", qifCharacteristicId);
  } else {
    studioInitialArtifact.value = "qif";
    studioSearchHint.value = qifCharacteristicId;
    if (studioView.value === "3d" || studioView.value === "diagram") {
      studioView.value = "split";
    }
  }
}

function onWindowKeydown(e: KeyboardEvent): void {
  if (!studioOpen.value || e.key !== "Escape") return;
  if (studioExpanded.value) {
    studioExpanded.value = false;
    e.preventDefault();
  } else {
    closeStudio();
    e.preventDefault();
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
  window.addEventListener("keydown", onWindowKeydown);

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
        syncGdtOverlayDom();
      },
      onError: () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallback.value = true;
      },
    });
    scene.value.setAfterRender(syncGdtOverlayDom);
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
        syncGdtOverlayDom();
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
  cancelIntentPrefetch();
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onWindowKeydown);
  }
  if (fallbackTimer) clearTimeout(fallbackTimer);
  slotObs?.disconnect();
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
watch(
  [showGdtLayer, studioView, studioExpanded],
  ([visible]) => {
    if (!visible) {
      gdtDatumEls.length = 0;
      gdtCalloutEls.length = 0;
    }
    measureStageSlot();
    syncGdtOverlayDom();
    void nextTick().then(() => {
      measureStageSlot();
      syncGdtOverlayDom();
      requestAnimationFrame(() => {
        measureStageSlot();
        syncGdtOverlayDom();
      });
    });
  },
  { flush: "post" },
);

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
  <div
    ref="root"
    class="turbine"
    :class="{
      'is-ready': ready,
      'is-fallback': fallback,
      'is-studio': studioOpen,
      'is-expanded': studioExpanded,
    }"
    @pointerenter="scheduleIntentPrefetch"
    @focusin="scheduleIntentPrefetch"
  >
    <div v-if="studioOpen && studioExpanded" class="turbine-backdrop" @click="studioExpanded = false" />

    <div ref="frameEl" class="turbine-frame">
      <!-- Persistent WebGL2 stage (never unmounted or reparented across Hero <-> Studio transitions) -->
      <div
        ref="stage"
        class="turbine-stage"
        :style="studioOpen ? stageSlotCss : undefined"
        :class="{ 'is-studio-hidden': isStageOccluded }"
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

        <!-- In-place Studio entry trigger pill (revealed smoothly on hover/focus without crowding initial load) -->
        <button
          v-if="!studioOpen && !fallback && ready"
          type="button"
          class="turbine-lsp-trigger"
          aria-expanded="false"
          title="Open interactive 4-file digital twin inside the Live In-Browser WASM LSP"
          @click.stop="openStudio('modelica')"
        >
          <span class="tlt-dot" aria-hidden="true" />
          <span class="tlt-main">Inspect in Live WASM LSP</span>
          <span class="tlt-meta">4 Files · 100% Local</span>
        </button>

        <!-- Compact 3D viewport HUD rendered on top of canvas during Studio 3D/Split modes -->
        <div v-if="studioOpen && !isStageOccluded" class="turbine-stage-hud">
          <div class="tls-hud-modes" role="group" aria-label="3D display mode">
            <button
              v-for="m in ['section', 'wire', 'solid'] as const"
              :key="m"
              type="button"
              class="tls-hud-chip"
              :class="{ 'is-active': mode === m }"
              @click.stop="mode = m"
            >
              {{ m === "section" ? "Section" : m === "wire" ? "Wire" : "Solid" }}
            </button>
            <button
              type="button"
              class="tls-hud-chip"
              :aria-pressed="paused"
              :title="paused ? 'Resume rotor animation' : 'Pause rotor animation'"
              @click.stop="paused = !paused"
            >
              <MsIcon :name="paused ? 'play' : 'pause'" :size="10" :stroke="2.2" />
            </button>
          </div>
          <span v-if="studioView === 'split'" class="tls-hud-hint">Edit N1 / N2 / T_04 below</span>
        </div>

        <!-- Standard stage callout leaders & labels (hidden when occluded or in compact studio split) -->
        <svg v-show="!studioOpen" class="turbine-leaders" aria-hidden="true">
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
          v-show="!studioOpen"
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

        <!-- Projected 3D ASME Y14.5 GD&T Datums & Feature Control Frames -->
        <div v-if="showGdtLayer" class="turbine-gdt-layer">
          <div
            v-for="(d, di) in activeGdtDatums"
            :key="`datum-${d.label}`"
            :ref="
              (el) => {
                if (el) gdtDatumEls[di] = el as HTMLElement;
              }
            "
            class="turbine-gdt-datum"
            :title="`Datum ${d.label}: ${d.name}`"
          >
            {{ d.label }}
          </div>
          <button
            v-for="(item, gi) in activeGdtItems"
            :key="item.callout.id"
            type="button"
            :ref="
              (el) => {
                if (el) gdtCalloutEls[gi] = el as HTMLElement;
              }
            "
            class="turbine-gdt-fcf"
            :class="{ 'is-highlighted': highlightedGdtId === item.qifCharacteristicId }"
            :data-status="item.callout.status ?? 'PASS'"
            :title="`${item.callout.label} ${item.fcfText}${item.callout.measured !== undefined ? ` (Measured ${item.actualDeviationMm.toFixed(3)} mm · ${item.callout.status ?? 'PASS'})` : ''} — Click to inspect in TurbofanMBD.qif`"
            @click.stop="onGdtBadgeClick(item.qifCharacteristicId)"
          >
            <span class="gdt-sym">{{ item.callout.symbol }}</span>
            <span class="gdt-tol">{{ item.callout.diametrical ? "⌀" : "" }}{{ item.callout.tolerance }}</span>
            <span class="gdt-status" :data-status="item.callout.status ?? 'PASS'" aria-hidden="true" />
          </button>
        </div>

        <!-- Interactive Callout Domain & Physics Inspector Card -->
        <transition name="callout-pop">
          <div
            v-if="activeCallout && !studioOpen"
            class="turbine-inspector"
            role="dialog"
            :aria-label="`${activeCallout.title} physics`"
          >
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
            <div class="ti-footer">
              <a :href="activeCallout.link" class="ti-link">{{ activeCallout.linkLabel }}</a>
              <button
                type="button"
                class="ti-lsp-link"
                @click.stop="openStudio('modelica')"
              >
                Inspect in Live WASM LSP →
              </button>
            </div>
          </div>
        </transition>
      </div>

      <!-- Lazily loaded in-place WASM LSP Workbench (loaded strictly on studioOpen) -->
      <LazyTurbineLspStudio
        v-if="studioOpen"
        :is-dark="isDark"
        :view="studioView"
        :expanded="studioExpanded"
        :show-gdt="showGdt"
        :initial-artifact-id="studioInitialArtifact"
        :initial-search-hint="studioSearchHint"
        :highlighted-callout-id="highlightedGdtId"
        @update:view="(v) => (studioView = v)"
        @update:expanded="(v) => (studioExpanded = v)"
        @update:show-gdt="(v) => (showGdt = v)"
        @live-params="onStudioLiveParams"
        @compiled-step="onStudioCompiledStep"
        @step-wire="onStudioStepWire"
        @scad-meshes="onStudioScadMeshes"
        @stage-slot="onStageSlot"
        @close="closeStudio"
      />
    </div>

    <div v-if="!fallback && !studioOpen" class="turbine-toolbar" role="toolbar" aria-label="Engine model view">
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
        class="turbine-gdt-btn"
        :aria-pressed="showGdt"
        title="Toggle ASME Y14.5 GD&T 3D Feature Control Frames & Datums"
        @click="showGdt = !showGdt"
      >
        GD&amp;T
      </button>
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

.turbine.is-studio.is-expanded {
  position: fixed;
  inset: max(68px, 6vh) clamp(16px, 4vw, 64px) clamp(16px, 3vh, 44px);
  width: auto;
  height: auto;
  z-index: 65;
}

.turbine-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.56);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 0;
}

.turbine-frame {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  z-index: 1;
}

.turbine-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  touch-action: pan-y;
  cursor: grab;
  transition: opacity 0.18s ease;
}

.turbine-stage:active {
  cursor: grabbing;
}

.turbine-stage.is-studio-hidden {
  position: absolute !important;
  inset: 0 !important;
  opacity: 0;
  pointer-events: none;
  z-index: 0 !important;
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

/* ── Hover / Focus Studio CTA Pill ─────────────────────── */

.turbine-lsp-trigger {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 46%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-bg-elv) 86%, transparent);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: 0 8px 22px -6px rgba(2, 6, 23, 0.38);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-base);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.turbine:hover .turbine-lsp-trigger,
.turbine:focus-within .turbine-lsp-trigger,
.turbine-lsp-trigger:focus-visible {
  opacity: 1;
  transform: translateY(0);
}

.turbine-lsp-trigger:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 10px 26px -6px rgba(6, 182, 212, 0.42);
}

.tlt-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
}

.tlt-meta {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  padding-left: 6px;
  border-left: 1px solid var(--vp-c-divider);
}

@media (hover: none) {
  .turbine-lsp-trigger {
    opacity: 0.94;
    transform: none;
  }
}

/* ── Studio In-Stage 3D HUD ────────────────────────────── */

.turbine-stage-hud {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  z-index: 8;
}

.tls-hud-modes {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  border: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg-elv) 82%, transparent);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}

.tls-hud-chip {
  height: 20px;
  padding: 0 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.tls-hud-chip.is-active {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.tls-hud-hint {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  padding: 2px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--vp-c-bg-elv) 78%, transparent);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-3);
}

/* ── GD&T Overlay Layer ────────────────────────────────── */

.turbine-gdt-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 9;
  overflow: hidden;
}

.turbine-gdt-datum {
  position: absolute;
  top: 0;
  left: 0;
  width: 18px;
  height: 18px;
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid #f59e0b;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.88);
  color: #fbbf24;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}

.turbine-gdt-fcf {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, #38bdf8 55%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-bg-elv) 88%, transparent);
  backdrop-filter: blur(6px);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  pointer-events: none;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 4px 12px -4px rgba(2, 6, 23, 0.45);
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}

.turbine-gdt-fcf:hover,
.turbine-gdt-fcf.is-highlighted {
  border-color: #10b981;
  box-shadow: 0 6px 16px -4px rgba(16, 185, 129, 0.45);
}

.gdt-sym {
  color: #38bdf8;
  font-weight: 700;
}

.gdt-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

.gdt-status[data-status="MARGINAL"] {
  background: #f59e0b;
}

.gdt-status[data-status="FAIL"] {
  background: #ef4444;
}

.turbine-gdt-fcf[data-status="MARGINAL"] {
  border-color: rgba(245, 158, 11, 0.7);
}

.turbine-gdt-fcf[data-status="FAIL"] {
  border-color: rgba(239, 68, 68, 0.78);
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
  width: min(370px, calc(100% - 24px));
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 42%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-bg-elv) 94%, transparent);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: 0 16px 36px -12px rgba(2, 6, 23, 0.45);
  z-index: 9;
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

.ti-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.ti-link {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-2xs);
  font-weight: var(--ms-fw-semibold);
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.ti-link:hover {
  text-decoration: underline;
}

.ti-lsp-link {
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 45%, transparent);
  background: var(--ms-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.ti-lsp-link:hover {
  background: color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent);
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
.turbine-icon-btn,
.turbine-gdt-btn {
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

.turbine-gdt-btn {
  padding: 0 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
}

.turbine-gdt-btn[aria-pressed="true"] {
  color: var(--vp-c-brand-1);
  background: var(--ms-brand-soft);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 42%, transparent);
}

.turbine-icon-btn {
  width: 28px;
}

.turbine-seg-btn:hover,
.turbine-icon-btn:hover,
.turbine-gdt-btn:hover {
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
.turbine-icon-btn:focus-visible,
.turbine-gdt-btn:focus-visible {
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
  .tlt-meta,
  .tls-hud-hint {
    display: none;
  }
}
</style>
