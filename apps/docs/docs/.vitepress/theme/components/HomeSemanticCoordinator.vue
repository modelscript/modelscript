<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import {
  COORDINATOR_SCENARIOS,
  evaluateCoordinatorScenario,
  type Cfd3DVisualData,
  type CoordinatorEvaluationResult,
  type CoordinatorPaneSpec,
  type CoordinatorScenario,
  type Fea3DVisualData,
  type ModelicaDaeVisualData,
  type Scad3DVisualData,
  type StepGdtVisualData,
  type SysmlBddVisualData,
  type Urdf3DVisualData,
  type Visual3DTriangle,
} from "../util/semantic-coordinator-engine";
import { highlightWorkflowCode } from "../util/workflow-highlighter";
import type { WorkflowMonacoInstance } from "../util/workflow-monaco";
import MsIcon from "./MsIcon.vue";

type PaneViewMode = "code" | "visual" | "csg";

const activeScenarioIdx = ref(0);
const activePresetId = ref("nominal");
const copied = ref(false);
const tabRefs = ref<HTMLButtonElement[]>([]);
const showHypergraphDetails = ref(false);

// Per-pane active tab: 'code' | 'visual' | 'csg'
const paneViewModes = ref<[PaneViewMode, PaneViewMode, PaneViewMode, PaneViewMode]>([
  "code",
  "code",
  "code",
  "code",
]);

// Interactive 3D Orbit Camera state per pane (yaw, pitch in degrees)
const paneCameras = reactive<
  Record<number, { yaw: number; pitch: number; dragging: boolean; lastX: number; lastY: number }>
>({
  0: { yaw: -36, pitch: 26, dragging: false, lastX: 0, lastY: 0 },
  1: { yaw: -34, pitch: 24, dragging: false, lastX: 0, lastY: 0 },
  2: { yaw: -38, pitch: 28, dragging: false, lastX: 0, lastY: 0 },
  3: { yaw: -35, pitch: 25, dragging: false, lastX: 0, lastY: 0 },
});

// Interactive CAE controls
const feaShowWireframe = ref(true);
const cfdFieldMode = ref<"velocity" | "temperature" | "pressure">("velocity");

const currentScenario = computed<CoordinatorScenario>(
  () => COORDINATOR_SCENARIOS[activeScenarioIdx.value] ?? COORDINATOR_SCENARIOS[0]!,
);

// Live code for each of the 4 panes
const paneCodes = ref<[string, string, string, string]>([
  COORDINATOR_SCENARIOS[0]!.panes[0].defaultCode,
  COORDINATOR_SCENARIOS[0]!.panes[1].defaultCode,
  COORDINATOR_SCENARIOS[0]!.panes[2].defaultCode,
  COORDINATOR_SCENARIOS[0]!.panes[3].defaultCode,
]);

const lastEditedPaneIdx = ref<number>(0);

// Per-scenario state cache
const scenarioCodeCache = new Map<string, [string, string, string, string]>();
const scenarioPresetCache = new Map<string, string>();

const evalResult = ref<CoordinatorEvaluationResult>(
  evaluateCoordinatorScenario(COORDINATOR_SCENARIOS[0]!.id, paneCodes.value, 0),
);

// Two-Prong Editor State (Prong 1 Static SSR Semantic Tokens -> Prong 2 Live 4-Pane Monaco)
const monacoActive = ref(false);
const monacoLoading = ref(false);
const monacoContainers = ref<(HTMLElement | null)[]>([null, null, null, null]);
const monacoInstances: (WorkflowMonacoInstance | null)[] = [null, null, null, null];
let suppressMonacoOnChange = false;
let themeObserver: MutationObserver | null = null;

const isModified = computed(() => {
  const defaults = currentScenario.value.panes.map((p) => p.defaultCode);
  return paneCodes.value.some((c, idx) => c !== defaults[idx]);
});

const allVisualActive = computed(() =>
  paneViewModes.value.every((m) => m !== "code"),
);

const highlightedPanes = computed<[string[], string[], string[], string[]]>(() => {
  const p = currentScenario.value.panes;
  return [
    highlightWorkflowCode(paneCodes.value[0], p[0].lang),
    highlightWorkflowCode(paneCodes.value[1], p[1].lang),
    highlightWorkflowCode(paneCodes.value[2], p[2].lang),
    highlightWorkflowCode(paneCodes.value[3], p[3].lang),
  ];
});

const allDiagnostics = computed(() => {
  const p = currentScenario.value.panes;
  return evalResult.value.paneDiagnostics.flatMap((diags, idx) =>
    diags.map((d) => ({
      ...d,
      paneLabel: p[idx]?.formatLabel ?? `Pane ${idx + 1}`,
      fileName: p[idx]?.fileName ?? "",
    })),
  );
});

function getPaneVisualLabel(pane: CoordinatorPaneSpec): string {
  switch (pane.lang) {
    case "sysml":
      return "Diagram (BDD)";
    case "modelica":
      return "Diagram (1D DAE)";
    case "scad":
      return "3D CAD & Ports";
    case "fea":
      return "3D CAE Mesh";
    case "cfd":
      return "3D CFD Field";
    case "xml":
      return "3D Kinematics";
    case "step":
      return "3D GD&T Fit";
    default:
      return "Diagram";
  }
}

function setPaneViewMode(paneIdx: number, mode: PaneViewMode): void {
  const next: [PaneViewMode, PaneViewMode, PaneViewMode, PaneViewMode] = [
    ...paneViewModes.value,
  ];
  next[paneIdx] = mode;
  paneViewModes.value = next;
}

function toggleAllPanesVisual(toVisual: boolean): void {
  paneViewModes.value = toVisual
    ? ["visual", "visual", "visual", "visual"]
    : ["code", "code", "code", "code"];
}

function setCameraPreset(paneIdx: number, preset: "iso" | "top" | "front"): void {
  const cam = paneCameras[paneIdx];
  if (!cam) return;
  if (preset === "iso") {
    cam.yaw = -36;
    cam.pitch = 26;
  } else if (preset === "top") {
    cam.yaw = 0;
    cam.pitch = 82;
  } else {
    cam.yaw = 0;
    cam.pitch = 6;
  }
}

function onOrbitPointerDown(paneIdx: number, e: PointerEvent): void {
  const cam = paneCameras[paneIdx];
  if (!cam) return;
  cam.dragging = true;
  cam.lastX = e.clientX;
  cam.lastY = e.clientY;
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
}

function onOrbitPointerMove(paneIdx: number, e: PointerEvent): void {
  const cam = paneCameras[paneIdx];
  if (!cam || !cam.dragging) return;
  const dx = e.clientX - cam.lastX;
  const dy = e.clientY - cam.lastY;
  cam.lastX = e.clientX;
  cam.lastY = e.clientY;
  cam.yaw = ((cam.yaw + dx * 0.7 + 180) % 360) - 180;
  cam.pitch = Math.max(-75, Math.min(85, cam.pitch + dy * 0.6));
}

function onOrbitPointerUp(paneIdx: number, e: PointerEvent): void {
  const cam = paneCameras[paneIdx];
  if (!cam) return;
  cam.dragging = false;
  (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
}

interface ProjectedPolygon {
  points: string;
  depth: number;
  fill: string;
  stroke: string;
  opacity: number;
  tag?: string;
}

function projectPoint3D(
  pt: [number, number, number],
  center: [number, number, number],
  scale: number,
  yawDeg: number,
  pitchDeg: number,
  svgCx: number,
  svgCy: number,
): { x: number; y: number; z: number } {
  const x0 = (pt[0] - center[0]) * scale;
  const y0 = (pt[1] - center[1]) * scale;
  const z0 = (pt[2] - center[2]) * scale;

  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const x1 = x0 * cy - y0 * sy;
  const y1 = x0 * sy + y0 * cy;
  const z1 = z0;

  const x2 = x1;
  const y2 = y1 * sp - z1 * cp;
  const z2 = y1 * cp + z1 * sp;

  return {
    x: Number((svgCx + x2).toFixed(1)),
    y: Number((svgCy + y2).toFixed(1)),
    z: z2,
  };
}

function getPortTagColor(tag?: string): { fill: string; stroke: string } {
  switch (tag) {
    case "fixed_root":
      return { fill: "rgba(99, 102, 241, 0.72)", stroke: "#818cf8" };
    case "clevis_lug":
      return { fill: "rgba(236, 72, 153, 0.78)", stroke: "#f472b6" };
    case "coolant_inlet":
      return { fill: "rgba(56, 189, 248, 0.78)", stroke: "#38bdf8" };
    case "fluid_core":
      return { fill: "rgba(16, 185, 129, 0.74)", stroke: "#34d399" };
    case "coolant_outlet":
      return { fill: "rgba(245, 158, 11, 0.78)", stroke: "#fbbf24" };
    default:
      return { fill: "rgba(148, 163, 184, 0.45)", stroke: "#94a3b8" };
  }
}

function stressToColor(stressMpa: number, maxAllowableMpa: number): { fill: string; stroke: string } {
  const ratio = Math.max(0, Math.min(1.25, stressMpa / Math.max(1, maxAllowableMpa)));
  if (ratio < 0.45) {
    return { fill: "rgba(56, 189, 248, 0.74)", stroke: "#0284c7" };
  }
  if (ratio < 0.75) {
    return { fill: "rgba(16, 185, 129, 0.78)", stroke: "#059669" };
  }
  if (ratio <= 1.0) {
    return { fill: "rgba(245, 158, 11, 0.82)", stroke: "#d97706" };
  }
  return { fill: "rgba(239, 68, 68, 0.88)", stroke: "#dc2626" };
}

function projectScadMesh(vis: Scad3DVisualData, paneIdx: number): {
  polygons: ProjectedPolygon[];
  portPins: {
    portName: string;
    portType: string;
    boundToCae: boolean;
    caeTarget: string;
    x: number;
    y: number;
    nx: number;
    ny: number;
    color: string;
  }[];
} {
  const cam = paneCameras[paneIdx] ?? { yaw: -36, pitch: 26 };
  const cx = (vis.bboxMin[0] + vis.bboxMax[0]) / 2;
  const cy = (vis.bboxMin[1] + vis.bboxMax[1]) / 2;
  const cz = (vis.bboxMin[2] + vis.bboxMax[2]) / 2;
  const spanX = Math.max(1, vis.bboxMax[0] - vis.bboxMin[0]);
  const spanY = Math.max(1, vis.bboxMax[1] - vis.bboxMin[1]);
  const spanZ = Math.max(1, vis.bboxMax[2] - vis.bboxMin[2]);
  const maxSpan = Math.max(spanX, spanY, spanZ);
  const scale = 150 / maxSpan;
  const center: [number, number, number] = [cx, cy, cz];

  const polygons: ProjectedPolygon[] = vis.triangles.map((tri: Visual3DTriangle) => {
    const p0 = projectPoint3D(tri.v0, center, scale, cam.yaw, cam.pitch, 185, 106);
    const p1 = projectPoint3D(tri.v1, center, scale, cam.yaw, cam.pitch, 185, 106);
    const p2 = projectPoint3D(tri.v2, center, scale, cam.yaw, cam.pitch, 185, 106);
    const col = getPortTagColor(tri.tag);
    return {
      points: `${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`,
      depth: (p0.z + p1.z + p2.z) / 3,
      fill: col.fill,
      stroke: col.stroke,
      opacity: 0.9,
      tag: tri.tag,
    };
  });
  polygons.sort((a, b) => a.depth - b.depth);

  const portPins = vis.ports.map((p) => {
    const pt = projectPoint3D(p.anchor, center, scale, cam.yaw, cam.pitch, 185, 106);
    const tip = projectPoint3D(
      [
        p.anchor[0] + p.normal[0] * (maxSpan * 0.14),
        p.anchor[1] + p.normal[1] * (maxSpan * 0.14),
        p.anchor[2] + p.normal[2] * (maxSpan * 0.14),
      ],
      center,
      scale,
      cam.yaw,
      cam.pitch,
      185,
      106,
    );
    return {
      portName: p.portName,
      portType: p.portType,
      boundToCae: p.boundToCae,
      caeTarget: p.caeTarget,
      x: pt.x,
      y: pt.y,
      nx: tip.x,
      ny: tip.y,
      color: getPortTagColor(p.portName).stroke,
    };
  });

  return { polygons, portPins };
}

function projectFeaMesh(vis: Fea3DVisualData, paneIdx: number): {
  undeformedPolys: string[];
  deformedPolys: ProjectedPolygon[];
  pins: { x: number; y: number }[];
  arrows: { x1: number; y1: number; x2: number; y2: number }[];
} {
  const cam = paneCameras[paneIdx] ?? { yaw: -35, pitch: 25 };
  const cx = (vis.bboxMin[0] + vis.bboxMax[0]) / 2;
  const cy = (vis.bboxMin[1] + vis.bboxMax[1]) / 2;
  const cz = (vis.bboxMin[2] + vis.bboxMax[2]) / 2;
  const maxSpan = Math.max(
    1,
    vis.bboxMax[0] - vis.bboxMin[0],
    vis.bboxMax[1] - vis.bboxMin[1],
    vis.bboxMax[2] - vis.bboxMin[2],
  );
  const scale = 148 / maxSpan;
  const center: [number, number, number] = [cx, cy, cz];

  const undeformedPolys = vis.undeformedTriangles.map((tri) => {
    const p0 = projectPoint3D(tri.v0, center, scale, cam.yaw, cam.pitch, 180, 108);
    const p1 = projectPoint3D(tri.v1, center, scale, cam.yaw, cam.pitch, 180, 108);
    const p2 = projectPoint3D(tri.v2, center, scale, cam.yaw, cam.pitch, 180, 108);
    return `${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
  });

  const deformedPolys: ProjectedPolygon[] = vis.deformedTriangles.map((tri) => {
    const p0 = projectPoint3D(tri.v0, center, scale, cam.yaw, cam.pitch, 180, 108);
    const p1 = projectPoint3D(tri.v1, center, scale, cam.yaw, cam.pitch, 180, 108);
    const p2 = projectPoint3D(tri.v2, center, scale, cam.yaw, cam.pitch, 180, 108);
    const col = stressToColor(tri.scalar ?? vis.maxVonMisesMpa * 0.7, vis.allowableVonMisesMpa);
    return {
      points: `${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`,
      depth: (p0.z + p1.z + p2.z) / 3,
      fill: col.fill,
      stroke: col.stroke,
      opacity: 0.88,
    };
  });
  deformedPolys.sort((a, b) => a.depth - b.depth);

  const pins = vis.fixedPinCoords.map((pt) => {
    const p = projectPoint3D(pt, center, scale, cam.yaw, cam.pitch, 180, 108);
    return { x: p.x, y: p.y };
  });

  const arrows = vis.loadArrowCoords.map((a) => {
    const p1 = projectPoint3D(
      [a.origin[0], a.origin[1], a.origin[2] + maxSpan * 0.22],
      center,
      scale,
      cam.yaw,
      cam.pitch,
      180,
      108,
    );
    const p2 = projectPoint3D(a.origin, center, scale, cam.yaw, cam.pitch, 180, 108);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  });

  return { undeformedPolys, deformedPolys, pins, arrows };
}

function getCfdCellColor(
  cell: Cfd3DVisualData["cells"][number],
  vis: Cfd3DVisualData,
  mode: "velocity" | "temperature" | "pressure",
): string {
  if (cell.isSolid) {
    return "rgba(71, 85, 105, 0.88)";
  }
  if (mode === "velocity") {
    const r = Math.min(1, cell.velocityMagMs / Math.max(0.5, vis.maxVelocityMs));
    const g = Math.round(110 + r * 125);
    const b = Math.round(235 - r * 70);
    return `rgba(16, ${g}, ${b}, 0.82)`;
  }
  if (mode === "temperature") {
    const r = Math.min(1, Math.max(0, (cell.tempK - 298.15) / 28.0));
    const red = Math.round(56 + r * 195);
    const green = Math.round(189 - r * 120);
    const blue = Math.round(248 - r * 200);
    return `rgba(${red}, ${green}, ${blue}, 0.84)`;
  }
  const r = Math.min(1, Math.max(0, cell.pressureKpa / Math.max(5, vis.pressureDropKpa)));
  const red = Math.round(129 + r * 110);
  const green = Math.round(140 - r * 55);
  return `rgba(${red}, ${green}, 248, 0.82)`;
}

function asSysmlVis(v: unknown): SysmlBddVisualData {
  return v as SysmlBddVisualData;
}
function asModelicaVis(v: unknown): ModelicaDaeVisualData {
  return v as ModelicaDaeVisualData;
}
function asScadVis(v: unknown): Scad3DVisualData {
  return v as Scad3DVisualData;
}
function asFeaVis(v: unknown): Fea3DVisualData {
  return v as Fea3DVisualData;
}
function asCfdVis(v: unknown): Cfd3DVisualData {
  return v as Cfd3DVisualData;
}
function asUrdfVis(v: unknown): Urdf3DVisualData {
  return v as Urdf3DVisualData;
}
function asStepVis(v: unknown): StepGdtVisualData {
  return v as StepGdtVisualData;
}

function setMonacoContainerRef(idx: number, el: Element | null): void {
  monacoContainers.value[idx] = el as HTMLElement | null;
}

function syncMonacoPanes(skipPaneIdx?: number): void {
  suppressMonacoOnChange = true;
  try {
    for (let i = 0; i < 4; i++) {
      const inst = monacoInstances[i];
      if (!inst) continue;
      if (i !== skipPaneIdx) {
        inst.setValue(paneCodes.value[i]!);
      }
      inst.setDiagnostics(evalResult.value.paneDiagnostics[i] ?? []);
    }
  } finally {
    suppressMonacoOnChange = false;
  }
}

function runCoordinatorEvaluation(editedIdx: number): void {
  lastEditedPaneIdx.value = editedIdx;
  const res = evaluateCoordinatorScenario(
    currentScenario.value.id,
    paneCodes.value,
    editedIdx,
  );
  evalResult.value = res;
  paneCodes.value = [...res.updatedCodes];
  scenarioCodeCache.set(currentScenario.value.id, [...res.updatedCodes]);
  syncMonacoPanes(editedIdx);
}

function onPaneEdited(paneIdx: number, nextCode: string): void {
  if (suppressMonacoOnChange) return;
  const updated: [string, string, string, string] = [...paneCodes.value];
  updated[paneIdx] = nextCode;
  paneCodes.value = updated;
  activePresetId.value = "custom";
  scenarioPresetCache.set(currentScenario.value.id, "custom");
  runCoordinatorEvaluation(paneIdx);
}

function applyPreset(presetId: string): void {
  const s = currentScenario.value;
  const preset = s.presets.find((p) => p.id === presetId);
  if (!preset) return;
  activePresetId.value = presetId;
  scenarioPresetCache.set(s.id, presetId);
  const defaults: [string, string, string, string] = [
    s.panes[0].defaultCode,
    s.panes[1].defaultCode,
    s.panes[2].defaultCode,
    s.panes[3].defaultCode,
  ];
  const { codes, editedPaneIndex } = preset.apply(defaults);
  paneCodes.value = [...codes];
  runCoordinatorEvaluation(editedPaneIndex);
  syncMonacoPanes();
}

function resetScenario(): void {
  applyPreset("nominal");
}

function selectScenario(idx: number): void {
  activeScenarioIdx.value = idx;
  const s = COORDINATOR_SCENARIOS[idx]!;
  const cachedCodes = scenarioCodeCache.get(s.id);
  const cachedPreset = scenarioPresetCache.get(s.id) ?? "nominal";
  activePresetId.value = cachedPreset;

  // Reset any 'csg' tab if switching to a scenario where pane 2 isn't scad
  if (paneViewModes.value[2] === "csg" && s.panes[2].lang !== "scad") {
    setPaneViewMode(2, "visual");
  }

  if (cachedCodes) {
    paneCodes.value = [...cachedCodes];
  } else {
    paneCodes.value = [
      s.panes[0].defaultCode,
      s.panes[1].defaultCode,
      s.panes[2].defaultCode,
      s.panes[3].defaultCode,
    ];
  }

  const res = evaluateCoordinatorScenario(s.id, paneCodes.value, 0);
  evalResult.value = res;
  paneCodes.value = [...res.updatedCodes];

  suppressMonacoOnChange = true;
  try {
    for (let i = 0; i < 4; i++) {
      const inst = monacoInstances[i];
      if (!inst) continue;
      inst.setLanguage(s.panes[i]!.lang);
      inst.setValue(paneCodes.value[i]!);
      inst.setDiagnostics(res.paneDiagnostics[i] ?? []);
    }
  } finally {
    suppressMonacoOnChange = false;
  }
}

function onScenarioTabKeydown(e: KeyboardEvent, idx: number): void {
  const total = COORDINATOR_SCENARIOS.length;
  let next = idx;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    next = (idx + 1) % total;
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    next = (idx - 1 + total) % total;
  } else if (e.key === "Home") {
    next = 0;
  } else if (e.key === "End") {
    next = total - 1;
  } else {
    return;
  }
  e.preventDefault();
  selectScenario(next);
  tabRefs.value[next]?.focus();
}

async function activateMonacoEditors(focusPaneIdx: number = 0): Promise<void> {
  setPaneViewMode(focusPaneIdx, "code");
  if (monacoActive.value || monacoLoading.value) {
    monacoInstances[focusPaneIdx]?.focus();
    return;
  }

  monacoLoading.value = true;
  monacoActive.value = true;
  await nextTick();

  try {
    const { mountWorkflowMonacoPane } = await import("../util/workflow-monaco");
    const isDark =
      typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const s = currentScenario.value;

    for (let i = 0; i < 4; i++) {
      const container = monacoContainers.value[i];
      if (container && !monacoInstances[i]) {
        const paneIdx = i;
        monacoInstances[i] = await mountWorkflowMonacoPane({
          container,
          initialCode: paneCodes.value[i]!,
          lang: s.panes[i]!.lang,
          isDark,
          ariaLabel: `Editable ${s.panes[i]!.formatLabel} model (${s.panes[i]!.fileName})`,
          onChange: (nextCode) => onPaneEdited(paneIdx, nextCode),
        });
      }
    }

    syncMonacoPanes();

    if (typeof document !== "undefined" && !themeObserver) {
      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        for (const inst of monacoInstances) {
          inst?.setTheme(dark);
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    monacoInstances[focusPaneIdx]?.focus();
  } finally {
    monacoLoading.value = false;
  }
}

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentScenario.value.command);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    /* clipboard fallback */
  }
}

onMounted(() => {
  runCoordinatorEvaluation(0);
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  for (const inst of monacoInstances) {
    inst?.dispose();
  }
});
</script>

<template>
  <section
    class="ms-section ms-section-alt home-semantic-coordinator"
    aria-label="Continuously Validated Multi-Language Digital Thread"
  >
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">Continuously Validated Digital Thread</span>
        <h2 class="ms-h2">Coordinate &amp; Verify Across 4 Languages Simultaneously</h2>
        <p class="ms-lead">
          Not every model translates 1-to-1 into another — requirements in <strong>SysML v2</strong>, 1D dynamics in
          <strong>Modelica</strong>, 3D geometry in <strong>CAD</strong>, and stress, thermal, or tolerance decks in
          <strong>FEA, CFD, and STEP AP242</strong> represent complementary physics of the same system. ModelScript’s
          Nelson-Oppen <code>SemanticTheoryCoordinator</code> and <code>DigitalThreadHypergraph</code> bind shared
          variables and 3D boundary ports across all four languages and verify global satisfiability as you type.
        </p>
      </header>

      <!-- Scenario Tabs -->
      <div class="scenario-tabs" role="tablist" aria-label="Multi-domain digital thread scenarios">
        <button
          v-for="(s, idx) in COORDINATOR_SCENARIOS"
          :key="s.id"
          :id="`coord-tab-${s.id}`"
          :ref="(el) => { if (el) tabRefs[idx] = el as HTMLButtonElement }"
          type="button"
          role="tab"
          class="scenario-tab"
          :class="{ active: activeScenarioIdx === idx }"
          :aria-selected="activeScenarioIdx === idx"
          :aria-controls="`coord-panel-${s.id}`"
          :tabindex="activeScenarioIdx === idx ? 0 : -1"
          :style="{ '--tab-accent': s.accent }"
          @click="selectScenario(idx)"
          @keydown="onScenarioTabKeydown($event, idx)"
        >
          <div class="tab-top">
            <span class="tab-icon"><MsIcon :name="s.icon" :size="18" :duotone="true" /></span>
            <span class="tab-domain">{{ s.domain }}</span>
          </div>
          <div class="tab-title">{{ s.shortTitle }}</div>
          <div class="tab-langs">
            <span v-for="(p, pIdx) in s.panes" :key="p.id" class="tab-lang-chip">
              {{ p.formatLabel }}<span v-if="pIdx < 3" class="chip-sep">↔</span>
            </span>
          </div>
        </button>
      </div>

      <!-- Main Coordinator Workbench Card -->
      <div
        :id="`coord-panel-${currentScenario.id}`"
        role="tabpanel"
        :aria-labelledby="`coord-tab-${currentScenario.id}`"
        class="coordinator-card"
        :class="{ 'is-unsat': !evalResult.isSat }"
        :style="{ '--active-accent': currentScenario.accent }"
      >
        <div class="card-glow" aria-hidden="true" />

        <!-- Card Top Header -->
        <div class="card-header">
          <div class="header-left">
            <div class="header-badges">
              <span class="domain-pill">
                <MsIcon :name="currentScenario.icon" :size="16" :duotone="true" />
                {{ currentScenario.domain }}
              </span>
              <span class="hypergraph-pill">
                4-Way <code>DigitalThreadHypergraph</code>
              </span>
              <span
                class="verdict-pill"
                :class="evalResult.isSat ? 'verdict-sat' : 'verdict-unsat'"
                role="status"
              >
                <span class="verdict-dot" />
                {{ evalResult.isSat ? "NELSON-OPPEN: SAT (ALL 4 ORACLES VERIFIED)" : `NELSON-OPPEN: UNSAT (${evalResult.conflicts.length} CONFLICT${evalResult.conflicts.length === 1 ? "" : "S"})` }}
              </span>
            </div>
            <h3 class="card-title">{{ currentScenario.title }}</h3>
          </div>

          <div class="header-actions">
            <div class="global-view-toggle" role="group" aria-label="Switch all 4 editors between Code and Visual Diagram/3D/CAE views">
              <button
                type="button"
                class="gvt-btn"
                :class="{ active: !allVisualActive }"
                @click="toggleAllPanesVisual(false)"
              >
                <MsIcon name="code" :size="13" />
                <span>All Code</span>
              </button>
              <button
                type="button"
                class="gvt-btn"
                :class="{ active: allVisualActive }"
                @click="toggleAllPanesVisual(true)"
              >
                <MsIcon name="layers" :size="13" />
                <span>All Visual (Diagram / 3D / CAE)</span>
              </button>
            </div>
            <button
              v-if="!monacoActive"
              type="button"
              class="activate-monaco-btn"
              title="Activate interactive 4-pane Monaco Editor with live Nelson-Oppen cross-language propagation"
              @click="activateMonacoEditors(0)"
            >
              <MsIcon name="code" :size="14" />
              <span>Activate 4-Pane Live Monaco</span>
            </button>
            <button
              v-if="isModified"
              type="button"
              class="reset-btn"
              @click="resetScenario"
            >
              Restore SAT Baseline
            </button>
          </div>
        </div>

        <p class="card-description">{{ currentScenario.description }}</p>

        <!-- Interactive What-If / Cross-Domain Perturbation Bar -->
        <div class="presets-toolbar" role="region" aria-label="Cross-domain perturbation scenarios">
          <div class="presets-left">
            <span class="presets-label">Test Cross-Domain Coupling:</span>
            <div class="presets-buttons">
              <button
                v-for="pr in currentScenario.presets"
                :key="pr.id"
                type="button"
                class="preset-btn"
                :class="{
                  active: activePresetId === pr.id,
                  'is-fault-btn': pr.isFault,
                  'is-nominal-btn': !pr.isFault,
                }"
                :title="pr.description"
                @click="applyPreset(pr.id)"
              >
                <span class="preset-indicator" :class="pr.isFault ? 'fault-dot' : 'sat-dot'" />
                {{ pr.label }}
              </button>
            </div>
          </div>
          <button
            type="button"
            class="inspect-bus-btn"
            :aria-expanded="showHypergraphDetails"
            @click="showHypergraphDetails = !showHypergraphDetails"
          >
            <MsIcon name="workflow" :size="13" />
            <span>{{ showHypergraphDetails ? "Hide Link & Port Manifest" : "Inspect Link & Port Manifest" }}</span>
          </button>
        </div>

        <!-- Nelson-Oppen Shared Equality & FQN Binding Bus Strip -->
        <div class="equality-bus-panel" role="region" aria-label="Nelson-Oppen Shared Equalities and Per-Language FQN Bindings">
          <div class="bus-header">
            <div class="bus-title-group">
              <span class="bus-badge">Nelson-Oppen FQN &amp; Port Bus</span>
              <span class="bus-summary">{{ evalResult.summaryText }}</span>
            </div>
            <div class="hypergraph-nodes-strip" aria-label="DigitalThreadHypergraph domain slot statuses">
              <span
                v-for="node in evalResult.hypergraphNodes"
                :key="node.paneIndex"
                class="hg-node-chip"
                :class="`hg-${node.status.toLowerCase()}`"
                :title="`${node.formatLabel} (${node.namespaceFqn}) — Oracle: ${node.oracleName} — Status: ${node.status}`"
              >
                <span class="hg-dot" />
                <strong>{{ node.formatLabel }}</strong>
                <code class="hg-status-tag">{{ node.status }}</code>
              </span>
            </div>
          </div>

          <!-- 4 Shared Variable FQN Link Cards -->
          <div class="variable-links-grid">
            <div
              v-for="link in evalResult.variableLinks"
              :key="link.symbol"
              class="var-link-card"
              :class="link.status === 'SAT' ? 'link-sat' : 'link-unsat'"
            >
              <div class="var-link-top">
                <span class="var-label">{{ link.label }}</span>
                <span class="var-status-pill" :class="link.status === 'SAT' ? 'is-sat' : 'is-unsat'">
                  {{ link.status }}
                </span>
              </div>
              <div class="var-canonical-row" :title="`Canonical Digital Thread Hub FQN: ${link.canonicalFqn}`">
                <span class="canonical-tag">Hub FQN</span>
                <code class="var-symbol">{{ link.canonicalFqn }}</code>
              </div>
              <div class="var-mech-row" :title="`In-code cross-language binding construct: ${link.bindingMechanism}`">
                <span class="mech-label">Bind:</span>
                <code class="var-mech-code">{{ link.bindingMechanism }}</code>
              </div>
              <div class="var-values-row">
                <span class="var-actual">{{ link.valueFormatted }}</span>
                <span class="var-bound">Contract: <code>{{ link.boundsFormatted }}</code></span>
              </div>
              <div class="var-domain-fqns" aria-label="Per-language FQN resolution table">
                <div
                  v-for="db in link.domainBindings"
                  :key="db.fqn"
                  class="domain-fqn-row"
                  :title="`${db.domainLabel} binding syntax: ${db.bindingSyntax}`"
                >
                  <span class="dfqn-lang">{{ db.domainLabel }}</span>
                  <code class="dfqn-path">{{ db.fqn }}</code>
                  <span class="dfqn-val">{{ db.valueText }}</span>
                </div>
              </div>
              <div class="var-footer-row">
                <code class="oracle-tag">{{ link.oracleName }}</code>
                <span class="margin-text">{{ link.marginText }}</span>
              </div>
            </div>
          </div>

          <!-- Collapsible Explicit Digital Thread Link, Port & Equation Manifest -->
          <div v-if="showHypergraphDetails" class="oracle-architecture-drawer">
            <div class="drawer-head">
              <strong>Explicit Digital Thread Link, CAD↔CAE Port &amp; Symbolic Equation Manifest</strong>
              <span>
                Every cross-language link, 3D mesh import (<code>*INCLUDE</code> / <code>geometry</code>), boundary patch binding (<code>tag_port(...)</code> ↔ <code>*BOUNDARY</code> / <code>*CLOAD</code> / <code>boundaryField</code>), and equation is parsed directly from the 4 source files above — zero hardcoded formulas or hidden links.
              </span>
            </div>

            <!-- CAD tag_port <-> CAE Boundary Patch Verification Table -->
            <div v-if="evalResult.parsedMetadata.portBindings.length > 0" class="manifest-subsection">
              <div class="manifest-sub-title">
                <span>3D CAD <code>tag_port(...)</code> ↔ CAE Boundary Patch Bindings (<code>{{ evalResult.parsedMetadata.meshSourceSummary }}</code>)</span>
              </div>
              <div class="port-manifest-grid">
                <div
                  v-for="pb in evalResult.parsedMetadata.portBindings"
                  :key="pb.portName"
                  class="port-manifest-card"
                  :class="pb.isBound ? 'port-bound' : 'port-unbound'"
                >
                  <div class="pm-top">
                    <code>tag_port("{{ pb.portName }}", "{{ pb.cadPortType }}")</code>
                    <span class="pm-badge" :class="pb.isBound ? 'is-bound' : 'is-unbound'">
                      {{ pb.isBound ? "BOUND" : "UNBOUND" }}
                    </span>
                  </div>
                  <div class="pm-row">
                    <span class="pm-file">{{ pb.cadFileName }}:L{{ pb.cadLine }}</span>
                    <span class="pm-arrow">→</span>
                    <span class="pm-file">{{ pb.caeFileName }}:L{{ pb.caeLine }}</span>
                  </div>
                  <div class="pm-spec">
                    <code>{{ pb.caePatchSpec }}</code>
                  </div>
                </div>
              </div>
            </div>

            <!-- Evaluated Symbolic Equations Table -->
            <div v-if="evalResult.parsedMetadata.evaluatedEquations.length > 0" class="manifest-subsection">
              <div class="manifest-sub-title">
                <span>Live Evaluated Symbolic Equations (<code>evaluateScad</code> &amp; <code>evaluateCfdExpression</code>)</span>
              </div>
              <div class="eq-manifest-list">
                <div
                  v-for="eq in evalResult.parsedMetadata.evaluatedEquations"
                  :key="`${eq.fileName}-${eq.lhs}`"
                  class="eq-manifest-item"
                >
                  <span class="eq-file-tag">{{ eq.fileName }} ({{ eq.language }})</span>
                  <code class="eq-formula">{{ eq.lhs }} = {{ eq.rhsExpression }}</code>
                  <span class="eq-val-pill">= {{ eq.evaluatedValue }} {{ eq.unit }}</span>
                </div>
              </div>
            </div>

            <!-- Parsed Source Directives List -->
            <div class="manifest-subsection">
              <div class="manifest-sub-title">
                <span>Parsed Cross-Language Directives ({{ evalResult.parsedMetadata.directiveLinks.length }} active links)</span>
              </div>
              <div class="directive-manifest-grid">
                <div
                  v-for="(dl, dIdx) in evalResult.parsedMetadata.directiveLinks"
                  :key="dIdx"
                  class="directive-manifest-row"
                >
                  <span class="dm-loc">{{ dl.fileName }}:L{{ dl.line }}</span>
                  <code class="dm-kind">{{ dl.directiveKind }}</code>
                  <code class="dm-expr">{{ dl.sourceExpr }} {{ dl.direction }} {{ dl.targetExpr }}</code>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 2x2 Multi-Language Synchronized Editor + Visual Diagram/3D/CAE Grid -->
        <div class="four-pane-grid">
          <div
            v-for="(pane, pIdx) in currentScenario.panes"
            :key="pane.id"
            class="coord-pane"
            :class="{
              'pane-has-error': (evalResult.paneDiagnostics[pIdx] ?? []).some((d) => d.severity === 'error'),
              'pane-has-warn':
                !(evalResult.paneDiagnostics[pIdx] ?? []).some((d) => d.severity === 'error') &&
                (evalResult.paneDiagnostics[pIdx] ?? []).length > 0,
            }"
            :style="{ '--pane-accent': pane.accent }"
          >
            <!-- Pane Header Bar with Per-Editor Code | Diagram/3D/CAE Tabs -->
            <div class="pane-bar">
              <div class="pane-bar-left">
                <span class="pane-index-badge">0{{ pIdx + 1 }}</span>
                <span class="pane-fmt-tag">{{ pane.formatLabel }}</span>
                <span class="pane-file-name">{{ pane.fileName }}</span>
                <code class="pane-namespace-fqn" :title="`Root Namespace FQN: ${pane.namespaceFqn} (${pane.fqnSyntaxNote})`">
                  {{ pane.namespaceFqn }}
                </code>
              </div>

              <div class="pane-bar-right">
                <!-- Per-Pane Mode Tabs: Code | Diagram / 3D CAD / 3D CAE | CSG Tree -->
                <div class="pane-mode-tabs" role="tablist" :aria-label="`${pane.formatLabel} view mode`">
                  <button
                    type="button"
                    role="tab"
                    class="pane-mode-tab"
                    :class="{ active: paneViewModes[pIdx] === 'code' }"
                    :aria-selected="paneViewModes[pIdx] === 'code'"
                    @click="setPaneViewMode(pIdx, 'code')"
                  >
                    Code
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="pane-mode-tab"
                    :class="{ active: paneViewModes[pIdx] === 'visual' }"
                    :aria-selected="paneViewModes[pIdx] === 'visual'"
                    @click="setPaneViewMode(pIdx, 'visual')"
                  >
                    {{ getPaneVisualLabel(pane) }}
                  </button>
                  <button
                    v-if="pane.lang === 'scad'"
                    type="button"
                    role="tab"
                    class="pane-mode-tab"
                    :class="{ active: paneViewModes[pIdx] === 'csg' }"
                    :aria-selected="paneViewModes[pIdx] === 'csg'"
                    @click="setPaneViewMode(pIdx, 'csg')"
                  >
                    CSG Tree
                  </button>
                </div>

                <span
                  v-if="(evalResult.paneDiagnostics[pIdx] ?? []).length > 0"
                  class="pane-diag-badge"
                  :class="
                    (evalResult.paneDiagnostics[pIdx] ?? []).some((d) => d.severity === 'error')
                      ? 'is-error'
                      : 'is-warn'
                  "
                >
                  {{ (evalResult.paneDiagnostics[pIdx] ?? []).length }}
                  {{ (evalResult.paneDiagnostics[pIdx] ?? []).length === 1 ? "conflict" : "conflicts" }}
                </span>
                <a :href="pane.docLink" class="pane-doc-link" :title="`Explore ${pane.formatLabel} documentation`">
                  Docs →
                </a>
              </div>
            </div>

            <!-- CODE TAB: Static SSR Semantic Tokens or Live Monaco -->
            <div v-show="paneViewModes[pIdx] === 'code'" class="pane-code-wrapper">
              <div
                v-if="!monacoActive"
                class="editor-body static-semantic-view"
                role="button"
                tabindex="0"
                :aria-label="`Click to edit ${pane.formatLabel} (${pane.fileName}) in live Monaco editor`"
                @click="activateMonacoEditors(pIdx)"
                @keydown.enter.prevent="activateMonacoEditors(pIdx)"
                @keydown.space.prevent="activateMonacoEditors(pIdx)"
              >
                <div class="line-numbers" aria-hidden="true">
                  <span v-for="(_, lineIdx) in highlightedPanes[pIdx]" :key="lineIdx">{{ lineIdx + 1 }}</span>
                </div>
                <pre class="pane-code semantic-code"><code v-html="highlightedPanes[pIdx].join('\n')" /></pre>

                <div class="editor-activation-overlay">
                  <div class="overlay-glass-pill">
                    <span class="overlay-icon"><MsIcon name="code" :size="14" /></span>
                    <div class="overlay-text">
                      <span class="overlay-title">Click to Edit {{ pane.formatLabel }} Live</span>
                      <span class="overlay-sub">Propagates across all 4 domains via {{ pane.oracleName }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="editor-body monaco-editor-body">
                <div v-if="monacoLoading" class="monaco-loading-overlay">
                  <span>Mounting 4-Pane Monaco &amp; Nelson-Oppen Coordinator…</span>
                </div>
                <div :ref="(el) => setMonacoContainerRef(pIdx, el)" class="monaco-mount-node" />
              </div>
            </div>

            <!-- VISUAL TAB: Per-Language Diagram / 3D CAD / 3D CAE / GD&T -->
            <div v-if="paneViewModes[pIdx] !== 'code'" class="pane-visual-body">
              <!-- 1. SYSML V2 BLOCK DEFINITION & REQUIREMENT DIAGRAM -->
              <template v-if="evalResult.paneVisuals[pIdx]?.kind === 'sysml-bdd'">
                <div class="visual-stage sysml-bdd-stage">
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">SysML v2 BDD · <code>«package» {{ asSysmlVis(evalResult.paneVisuals[pIdx]).packageName }}</code></span>
                    <span class="vo-hint">Live CST Requirement &amp; Subject Graph</span>
                  </div>
                  <svg viewBox="0 0 420 205" class="pane-svg-canvas" role="img" :aria-label="`SysML v2 BDD diagram for ${pane.fileName}`">
                    <!-- Part Def Block -->
                    <rect x="12" y="18" width="176" height="172" rx="8" class="svg-box-part" />
                    <text x="22" y="35" class="svg-stereo">«part def»</text>
                    <text x="22" y="51" class="svg-block-title">{{ asSysmlVis(evalResult.paneVisuals[pIdx]).partName }}</text>
                    <line x1="12" y1="59" x2="188" y2="59" class="svg-divider" />
                    <g
                      v-for="(attr, aIdx) in asSysmlVis(evalResult.paneVisuals[pIdx]).partAttributes"
                      :key="attr.name"
                      :transform="`translate(20, ${77 + aIdx * 28})`"
                    >
                      <text x="0" y="0" class="svg-attr-name">{{ attr.name }} :</text>
                      <text x="156" y="0" text-anchor="end" class="svg-attr-val">{{ attr.value }} {{ attr.unit }}</text>
                      <text x="0" y="11" class="svg-attr-hint">{{ attr.sourceHint }}</text>
                    </g>

                    <!-- Subject Binding Arrow -->
                    <line x1="232" y1="54" x2="190" y2="54" stroke="#818cf8" stroke-width="1.8" stroke-dasharray="4 2" />
                    <polygon points="190,54 197,50 197,58" fill="#818cf8" />
                    <text x="211" y="47" text-anchor="middle" class="svg-edge-label">«subject»</text>

                    <!-- Requirement Def Block -->
                    <rect x="232" y="18" width="176" height="172" rx="8" class="svg-box-req" />
                    <text x="242" y="35" class="svg-stereo">«requirement def»</text>
                    <text x="242" y="51" class="svg-block-title">{{ asSysmlVis(evalResult.paneVisuals[pIdx]).requirementId }}</text>
                    <line x1="232" y1="59" x2="408" y2="59" class="svg-divider" />
                    <g
                      v-for="(c, cIdx) in asSysmlVis(evalResult.paneVisuals[pIdx]).constraints"
                      :key="c.expression"
                      :transform="`translate(240, ${74 + cIdx * 36})`"
                    >
                      <rect
                        x="0"
                        y="-10"
                        width="160"
                        height="29"
                        rx="5"
                        :fill="c.isSat ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.16)'"
                        :stroke="c.isSat ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.6)'"
                      />
                      <text x="6" y="2" class="svg-req-expr">{{ c.expression }}</text>
                      <text x="6" y="14" class="svg-req-sub">{{ c.actualText }} ({{ c.limitText }})</text>
                      <text
                        x="154"
                        y="8"
                        text-anchor="end"
                        class="svg-req-verdict"
                        :fill="c.isSat ? '#10b981' : '#f87171'"
                      >
                        {{ c.isSat ? "SAT" : "UNSAT" }}
                      </text>
                    </g>
                  </svg>
                </div>
              </template>

              <!-- 2. MODELICA 1D DAE BLOCK & SIGNAL SCHEMATIC -->
              <template v-else-if="evalResult.paneVisuals[pIdx]?.kind === 'modelica-dae'">
                <div class="visual-stage modelica-dae-stage">
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">1D DAE Schematic · <code>{{ asModelicaVis(evalResult.paneVisuals[pIdx]).withinPkg }}.{{ asModelicaVis(evalResult.paneVisuals[pIdx]).modelName }}</code></span>
                    <span class="vo-hint">Evaluated via <code>evaluateCfdExpression</code></span>
                  </div>
                  <svg viewBox="0 0 420 205" class="pane-svg-canvas" role="img" :aria-label="`Modelica 1D DAE schematic for ${pane.fileName}`">
                    <!-- Parameter Blocks on Left -->
                    <g
                      v-for="(param, pIndex) in asModelicaVis(evalResult.paneVisuals[pIdx]).parameters"
                      :key="param.name"
                      :transform="`translate(12, ${18 + pIndex * 43})`"
                    >
                      <rect
                        x="0"
                        y="0"
                        width="134"
                        height="35"
                        rx="6"
                        :fill="param.twinFqn ? 'rgba(56, 189, 248, 0.13)' : 'rgba(30, 41, 59, 0.85)'"
                        :stroke="param.twinFqn ? '#38bdf8' : '#475569'"
                      />
                      <text x="8" y="14" class="svg-attr-name">{{ param.name }}</text>
                      <text x="126" y="14" text-anchor="end" class="svg-attr-val">{{ param.value }} {{ param.unit }}</text>
                      <text x="8" y="27" class="svg-attr-hint">
                        {{ param.twinFqn ? `twin: ${param.twinFqn.split("::").pop()}` : "parameter Real" }}
                      </text>
                      <line x1="134" y1="17" x2="168" y2="102" stroke="#38bdf8" stroke-width="1.4" />
                    </g>

                    <!-- Central Symbolic Equation Operator Block -->
                    <rect x="168" y="54" width="124" height="96" rx="10" fill="rgba(15, 23, 42, 0.95)" stroke="#38bdf8" stroke-width="1.8" />
                    <text x="230" y="74" text-anchor="middle" class="svg-stereo">«equation»</text>
                    <text x="230" y="92" text-anchor="middle" class="svg-block-title">
                      {{ asModelicaVis(evalResult.paneVisuals[pIdx]).equations[0]?.lhs }}
                    </text>
                    <foreignObject x="174" y="98" width="112" height="46">
                      <div xmlns="http://www.w3.org/1999/xhtml" class="dae-eq-formula-box">
                        = {{ asModelicaVis(evalResult.paneVisuals[pIdx]).equations[0]?.rhs }}
                      </div>
                    </foreignObject>

                    <!-- Output Signal & Twin Port on Right -->
                    <line x1="292" y1="102" x2="316" y2="102" stroke="#10b981" stroke-width="2.2" />
                    <polygon points="316,102 309,98 309,106" fill="#10b981" />
                    <rect x="316" y="64" width="92" height="76" rx="8" fill="rgba(16, 185, 129, 0.14)" stroke="#10b981" stroke-width="1.6" />
                    <text x="362" y="83" text-anchor="middle" class="svg-stereo">output Real</text>
                    <text x="362" y="104" text-anchor="middle" class="svg-out-big">
                      {{ asModelicaVis(evalResult.paneVisuals[pIdx]).equations[0]?.resultText }}
                    </text>
                    <text x="362" y="124" text-anchor="middle" class="svg-attr-hint">annotation(twin)</text>
                  </svg>
                </div>
              </template>

              <!-- 3. OPENSCAD 3D MANIFOLD MESH & TAGGED PORTS OR CSG TREE -->
              <template v-else-if="evalResult.paneVisuals[pIdx]?.kind === 'scad-3d'">
                <!-- 3A. CSG Tree View -->
                <div v-if="paneViewModes[pIdx] === 'csg'" class="visual-stage csg-tree-stage">
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">OpenSCAD CSG AST · <code>module {{ asScadVis(evalResult.paneVisuals[pIdx]).moduleName }}()</code></span>
                    <span class="vo-hint">{{ asScadVis(evalResult.paneVisuals[pIdx]).triangles.length }} tessellated triangles</span>
                  </div>
                  <div class="csg-tree-list">
                    <div
                      v-for="node in asScadVis(evalResult.paneVisuals[pIdx]).csgTree"
                      :key="node.id"
                      class="csg-tree-row"
                      :style="{ paddingLeft: `${12 + node.depth * 18}px` }"
                    >
                      <span class="csg-branch-glyph">├─</span>
                      <code class="csg-node-label" :class="`csg-kind-${node.kind}`">{{ node.label }}</code>
                      <span class="csg-node-detail">{{ node.detail }}</span>
                      <span v-if="node.tag" class="csg-port-pill" :style="{ borderColor: getPortTagColor(node.tag).stroke }">
                        port: {{ node.tag }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- 3B. Interactive 3D B-Rep Mesh & Boundary Ports View -->
                <div
                  v-else
                  class="visual-stage scad-3d-stage"
                  @pointerdown="onOrbitPointerDown(pIdx, $event)"
                  @pointermove="onOrbitPointerMove(pIdx, $event)"
                  @pointerup="onOrbitPointerUp(pIdx, $event)"
                >
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">
                      3D Manifold Mesh · <code>{{ asScadVis(evalResult.paneVisuals[pIdx]).triangles.length }} tris</code> ·
                      <code>Vol={{ (asScadVis(evalResult.paneVisuals[pIdx]).volumeMm3 / 1000).toFixed(1) }} cm³</code>
                    </span>
                    <div class="cam-preset-btns" @pointerdown.stop>
                      <button type="button" class="cam-btn" @click="setCameraPreset(pIdx, 'iso')">Iso</button>
                      <button type="button" class="cam-btn" @click="setCameraPreset(pIdx, 'top')">Top</button>
                      <button type="button" class="cam-btn" @click="setCameraPreset(pIdx, 'front')">Front</button>
                    </div>
                  </div>

                  <svg viewBox="0 0 380 205" class="pane-svg-canvas interactive-3d-svg" role="img" :aria-label="`3D OpenSCAD mesh for ${pane.fileName}`">
                    <!-- 3D Projected Triangles from evaluateScad(code).mesh -->
                    <polygon
                      v-for="(poly, idx) in projectScadMesh(asScadVis(evalResult.paneVisuals[pIdx]), pIdx).polygons"
                      :key="idx"
                      :points="poly.points"
                      :fill="poly.fill"
                      :stroke="poly.stroke"
                      stroke-width="0.65"
                    />
                    <!-- Tagged Boundary Port Callout Pins & Normal Vectors -->
                    <g
                      v-for="pin in projectScadMesh(asScadVis(evalResult.paneVisuals[pIdx]), pIdx).portPins"
                      :key="pin.portName"
                    >
                      <line :x1="pin.x" :y1="pin.y" :x2="pin.nx" :y2="pin.ny" :stroke="pin.color" stroke-width="2" />
                      <circle :cx="pin.x" :cy="pin.y" r="4.5" :fill="pin.color" stroke="#0f172a" stroke-width="1.5" />
                      <rect
                        :x="pin.nx - 42"
                        :y="pin.ny - 18"
                        width="84"
                        height="15"
                        rx="4"
                        fill="rgba(15, 23, 42, 0.88)"
                        :stroke="pin.color"
                        stroke-width="1"
                      />
                      <text :x="pin.nx" :y="pin.ny - 8" text-anchor="middle" class="svg-pin-label" :fill="pin.color">
                        {{ pin.portName }}
                      </text>
                    </g>
                  </svg>

                  <div class="visual-bottom-legend" @pointerdown.stop>
                    <span
                      v-for="p in asScadVis(evalResult.paneVisuals[pIdx]).ports"
                      :key="p.portName"
                      class="vbl-item"
                      :title="`Connected to ${p.caeTarget}`"
                    >
                      <span class="vbl-dot" :style="{ background: getPortTagColor(p.portName).stroke }" />
                      <code>{{ p.portName }}</code> → <span>{{ p.caeTarget }}</span>
                    </span>
                    <span class="vbl-drag-hint">Drag to orbit 3D</span>
                  </div>
                </div>
              </template>

              <!-- 4. CALCULIX 3D TET4 FEA MESH & VON MISES CONTOUR -->
              <template v-else-if="evalResult.paneVisuals[pIdx]?.kind === 'fea-3d'">
                <div
                  class="visual-stage fea-3d-stage"
                  @pointerdown="onOrbitPointerDown(pIdx, $event)"
                  @pointermove="onOrbitPointerMove(pIdx, $event)"
                  @pointerup="onOrbitPointerUp(pIdx, $event)"
                >
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">
                      <code>Tet4Mesher</code> ({{ asFeaVis(evalResult.paneVisuals[pIdx]).numNodes }} nodes / {{ asFeaVis(evalResult.paneVisuals[pIdx]).numElements }} C3D4) ·
                      <code>σ_vm = {{ asFeaVis(evalResult.paneVisuals[pIdx]).maxVonMisesMpa.toFixed(1) }} MPa</code>
                    </span>
                    <div class="cam-preset-btns" @pointerdown.stop>
                      <button
                        type="button"
                        class="cam-btn"
                        :class="{ active: feaShowWireframe }"
                        @click="feaShowWireframe = !feaShowWireframe"
                      >
                        Ref Mesh
                      </button>
                      <button type="button" class="cam-btn" @click="setCameraPreset(pIdx, 'iso')">Iso</button>
                      <button type="button" class="cam-btn" @click="setCameraPreset(pIdx, 'front')">Side</button>
                    </div>
                  </div>

                  <svg viewBox="0 0 380 205" class="pane-svg-canvas interactive-3d-svg" role="img" :aria-label="`3D CalculiX FEA stress contour for ${pane.fileName}`">
                    <!-- Undeformed Wireframe Overlay -->
                    <g v-if="feaShowWireframe">
                      <polygon
                        v-for="(pts, uIdx) in projectFeaMesh(asFeaVis(evalResult.paneVisuals[pIdx]), pIdx).undeformedPolys"
                        :key="`u-${uIdx}`"
                        :points="pts"
                        fill="none"
                        stroke="rgba(148, 163, 184, 0.25)"
                        stroke-width="0.6"
                        stroke-dasharray="2 2"
                      />
                    </g>

                    <!-- Deformed 3D Boundary Faces Colored by Element von Mises Stress -->
                    <polygon
                      v-for="(poly, dIdx) in projectFeaMesh(asFeaVis(evalResult.paneVisuals[pIdx]), pIdx).deformedPolys"
                      :key="`d-${dIdx}`"
                      :points="poly.points"
                      :fill="poly.fill"
                      :stroke="poly.stroke"
                      stroke-width="0.75"
                    />

                    <!-- Fixed Root Boundary Condition Pins (*BOUNDARY fixed_root, 1..6) -->
                    <g
                      v-for="(pin, pIndex) in projectFeaMesh(asFeaVis(evalResult.paneVisuals[pIdx]), pIdx).pins"
                      :key="`pin-${pIndex}`"
                    >
                      <polygon
                        :points="`${pin.x},${pin.y} ${pin.x - 6},${pin.y + 9} ${pin.x + 6},${pin.y + 9}`"
                        fill="#818cf8"
                        stroke="#0f172a"
                        stroke-width="1"
                      />
                    </g>

                    <!-- Clevis Lug Applied Force Arrows (*CLOAD clevis_lug, 3) -->
                    <g
                      v-for="(arr, aIndex) in projectFeaMesh(asFeaVis(evalResult.paneVisuals[pIdx]), pIdx).arrows"
                      :key="`arr-${aIndex}`"
                    >
                      <line :x1="arr.x1" :y1="arr.y1" :x2="arr.x2" :y2="arr.y2" stroke="#f43f5e" stroke-width="2.2" />
                      <polygon
                        :points="`${arr.x2},${arr.y2} ${arr.x2 - 4},${arr.y2 - 8} ${arr.x2 + 4},${arr.y2 - 8}`"
                        fill="#f43f5e"
                      />
                    </g>
                  </svg>

                  <div class="visual-bottom-legend" @pointerdown.stop>
                    <span class="vbl-item"><span class="vbl-dot" style="background: #818cf8" /><code>fixed_root</code> (6-DOF)</span>
                    <span class="vbl-item"><span class="vbl-dot" style="background: #f43f5e" /><code>clevis_lug</code> ({{ (asFeaVis(evalResult.paneVisuals[pIdx]).appliedLoadN / 1000).toFixed(1) }} kN)</span>
                    <span class="vbl-item"><code>U3_MAX = {{ asFeaVis(evalResult.paneVisuals[pIdx]).maxDeflectionMm.toFixed(2) }} mm</code> (18× scale)</span>
                  </div>
                </div>
              </template>

              <!-- 5. OPENFOAM 3D D3Q19 LATTICE-BOLTZMANN CFD FIELD & BOUNDARY PATCHES -->
              <template v-else-if="evalResult.paneVisuals[pIdx]?.kind === 'cfd-3d'">
                <div class="visual-stage cfd-3d-stage">
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">
                      <code>WebGPULbmRunner</code> ({{ asCfdVis(evalResult.paneVisuals[pIdx]).nx }}×{{ asCfdVis(evalResult.paneVisuals[pIdx]).ny }}×{{ asCfdVis(evalResult.paneVisuals[pIdx]).nz }} D3Q19) ·
                      <code>T_max={{ asCfdVis(evalResult.paneVisuals[pIdx]).maxSurfaceTempK.toFixed(1) }} K</code>
                    </span>
                    <div class="cam-preset-btns">
                      <button
                        type="button"
                        class="cam-btn"
                        :class="{ active: cfdFieldMode === 'velocity' }"
                        @click="cfdFieldMode = 'velocity'"
                      >
                        |u| ({{ asCfdVis(evalResult.paneVisuals[pIdx]).maxVelocityMs }} m/s)
                      </button>
                      <button
                        type="button"
                        class="cam-btn"
                        :class="{ active: cfdFieldMode === 'temperature' }"
                        @click="cfdFieldMode = 'temperature'"
                      >
                        T (K)
                      </button>
                      <button
                        type="button"
                        class="cam-btn"
                        :class="{ active: cfdFieldMode === 'pressure' }"
                        @click="cfdFieldMode = 'pressure'"
                      >
                        ΔP ({{ asCfdVis(evalResult.paneVisuals[pIdx]).pressureDropKpa }} kPa)
                      </button>
                    </div>
                  </div>

                  <svg viewBox="0 0 400 205" class="pane-svg-canvas" role="img" :aria-label="`OpenFOAM D3Q19 LBM CFD field for ${pane.fileName}`">
                    <!-- Inlet Patch Bar (coolant_inlet) -->
                    <rect x="16" y="22" width="12" height="140" rx="3" fill="rgba(56, 189, 248, 0.28)" stroke="#38bdf8" stroke-width="1.5" />
                    <text x="22" y="16" text-anchor="middle" class="svg-pin-label" fill="#38bdf8">coolant_inlet</text>

                    <!-- 20x10 D3Q19 Lattice Voxel Slice + Velocity Stream Vectors -->
                    <g
                      v-for="cell in asCfdVis(evalResult.paneVisuals[pIdx]).cells"
                      :key="`${cell.ix}-${cell.iy}`"
                      :transform="`translate(${32 + cell.ix * 16.5}, ${22 + cell.iy * 14})`"
                    >
                      <rect
                        x="0"
                        y="0"
                        width="15.5"
                        height="13"
                        rx="1.5"
                        :fill="getCfdCellColor(cell, asCfdVis(evalResult.paneVisuals[pIdx]), cfdFieldMode)"
                      />
                      <line
                        v-if="!cell.isSolid"
                        x1="3"
                        y1="6.5"
                        x2="12.5"
                        y2="6.5"
                        stroke="rgba(248, 250, 252, 0.78)"
                        stroke-width="1.1"
                      />
                      <polygon
                        v-if="!cell.isSolid"
                        points="12.5,6.5 9.5,4.7 9.5,8.3"
                        fill="rgba(248, 250, 252, 0.78)"
                      />
                    </g>

                    <!-- Conjugate Wall Patch Frame (fluid_core) -->
                    <rect
                      x="32"
                      y="22"
                      width="330"
                      height="140"
                      rx="4"
                      fill="none"
                      stroke="#10b981"
                      stroke-width="1.5"
                      stroke-dasharray="5 3"
                    />
                    <text x="197" y="16" text-anchor="middle" class="svg-pin-label" fill="#34d399">
                      fluid_core ← ColdPlateChannels.scad (D_h={{ asCfdVis(evalResult.paneVisuals[pIdx]).hydraulicDiaMm.toFixed(2) }} mm, Q={{ asCfdVis(evalResult.paneVisuals[pIdx]).wallHeatLoadW.toFixed(0) }} W)
                    </text>

                    <!-- Outlet Patch Bar (coolant_outlet) -->
                    <rect x="366" y="22" width="12" height="140" rx="3" fill="rgba(245, 158, 11, 0.28)" stroke="#fbbf24" stroke-width="1.5" />
                    <text x="372" y="16" text-anchor="middle" class="svg-pin-label" fill="#fbbf24">coolant_outlet</text>

                    <!-- Patch Binding Footnotes -->
                    <g
                      v-for="(patch, idx) in asCfdVis(evalResult.paneVisuals[pIdx]).patches"
                      :key="patch.name"
                      :transform="`translate(${16 + idx * 126}, 172)`"
                    >
                      <rect
                        x="0"
                        y="0"
                        width="120"
                        height="26"
                        rx="5"
                        :fill="patch.isBound ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.2)'"
                        :stroke="patch.isBound ? 'rgba(16, 185, 129, 0.45)' : '#ef4444'"
                      />
                      <text x="6" y="11" class="svg-req-expr">{{ patch.name }} ({{ patch.cadPortType }})</text>
                      <text x="6" y="21" class="svg-attr-hint">{{ patch.summary }}</text>
                    </g>
                  </svg>
                </div>
              </template>

              <!-- 6. ROS 2 URDF 3D KINEMATIC CHAIN & JOINT EFFORT DIAGRAM -->
              <template v-else-if="evalResult.paneVisuals[pIdx]?.kind === 'urdf-3d'">
                <div class="visual-stage urdf-3d-stage">
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">URDF Kinematic Tree · <code>robot="{{ asUrdfVis(evalResult.paneVisuals[pIdx]).robotName }}"</code></span>
                    <span class="vo-hint">Parsed via <code>parseUrdf</code></span>
                  </div>
                  <svg viewBox="0 0 400 205" class="pane-svg-canvas" role="img" :aria-label="`URDF kinematic chain for ${pane.fileName}`">
                    <!-- Base Column Link -->
                    <rect x="48" y="128" width="54" height="52" rx="6" fill="rgba(71, 85, 105, 0.65)" stroke="#94a3b8" stroke-width="1.6" />
                    <text x="75" y="152" text-anchor="middle" class="svg-attr-name">base_column</text>
                    <text x="75" y="166" text-anchor="middle" class="svg-attr-hint">fixed base</text>

                    <!-- Revolute Joint shoulder_pitch + Limit Arc -->
                    <path d="M 45 118 A 34 34 0 0 1 105 118" fill="none" stroke="rgba(245, 158, 11, 0.55)" stroke-width="2" stroke-dasharray="3 2" />
                    <circle
                      cx="75"
                      cy="118"
                      r="16"
                      :fill="
                        (asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.actualTorqueNm ?? 0) <=
                        (asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.effortLimitNm ?? 140)
                          ? 'rgba(16, 185, 129, 0.25)'
                          : 'rgba(239, 68, 68, 0.32)'
                      "
                      :stroke="
                        (asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.actualTorqueNm ?? 0) <=
                        (asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.effortLimitNm ?? 140)
                          ? '#10b981'
                          : '#ef4444'
                      "
                      stroke-width="2.2"
                    />
                    <circle cx="75" cy="118" r="4" fill="#f59e0b" />

                    <!-- Upper Arm Link Beam -->
                    <line x1="88" y1="110" x2="238" y2="54" stroke="#f59e0b" stroke-width="11" stroke-linecap="round" />
                    <line x1="88" y1="110" x2="238" y2="54" stroke="#fde68a" stroke-width="2.5" stroke-linecap="round" />

                    <!-- CoM Inertia Marker on upper_arm -->
                    <circle cx="163" cy="82" r="9" fill="#0f172a" stroke="#38bdf8" stroke-width="2" />
                    <text x="163" y="65" text-anchor="middle" class="svg-pin-label" fill="#38bdf8">
                      upper_arm: {{ asUrdfVis(evalResult.paneVisuals[pIdx]).links[1]?.massKg.toFixed(1) ?? "2.8" }} kg
                    </text>

                    <!-- End-Effector Payload Mass -->
                    <circle cx="244" cy="52" r="14" fill="rgba(236, 72, 153, 0.25)" stroke="#f472b6" stroke-width="2" />
                    <text x="244" y="55" text-anchor="middle" class="svg-pin-label" fill="#f472b6">
                      {{ asUrdfVis(evalResult.paneVisuals[pIdx]).payloadMassKg.toFixed(1) }}kg
                    </text>

                    <!-- Joint Telemetry Card -->
                    <rect x="258" y="92" width="130" height="90" rx="8" fill="rgba(15, 23, 42, 0.92)" stroke="#475569" />
                    <text x="268" y="110" class="svg-stereo">joint: shoulder_pitch</text>
                    <text x="268" y="126" class="svg-req-expr">
                      range: [{{ asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.lowerRad }}, {{ asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.upperRad }}] rad
                    </text>
                    <text x="268" y="142" class="svg-req-expr">
                      effort limit: {{ asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.effortLimitNm.toFixed(1) }} N·m
                    </text>
                    <text
                      x="268"
                      y="162"
                      class="svg-block-title"
                      :fill="
                        (asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.actualTorqueNm ?? 0) <=
                        (asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.effortLimitNm ?? 140)
                          ? '#10b981'
                          : '#f87171'
                      "
                    >
                      τ_actual = {{ asUrdfVis(evalResult.paneVisuals[pIdx]).joints[0]?.actualTorqueNm.toFixed(1) }} N·m
                    </text>
                  </svg>
                </div>
              </template>

              <!-- 7. STEP AP242 COAXIAL GD&T BEARING FIT & TOLERANCE STACK -->
              <template v-else-if="evalResult.paneVisuals[pIdx]?.kind === 'step-gdt'">
                <div class="visual-stage step-gdt-stage">
                  <div class="visual-overlay-bar">
                    <span class="vo-chip">
                      ISO 10303-242 PMI · <code>{{ asStepVis(evalResult.paneVisuals[pIdx]).entityCount }} entities</code> ·
                      <code>ToleranceStackVerifier</code>
                    </span>
                    <span
                      class="vo-verdict"
                      :class="asStepVis(evalResult.paneVisuals[pIdx]).isSat ? 'is-sat' : 'is-unsat'"
                    >
                      {{ asStepVis(evalResult.paneVisuals[pIdx]).isSat ? "FIT SAT" : "FIT CONFLICT" }}
                    </span>
                  </div>
                  <svg viewBox="0 0 410 205" class="pane-svg-canvas" role="img" :aria-label="`STEP AP242 coaxial bearing fit and tolerance stack for ${pane.fileName}`">
                    <!-- Left: Coaxial Bore (#10/#11/#12) & Shaft (#20/#21/#22) Cross-Section -->
                    <circle cx="88" cy="106" r="64" fill="rgba(168, 85, 247, 0.12)" stroke="#a855f7" stroke-width="2" />
                    <circle cx="88" cy="106" r="46" fill="rgba(15, 23, 42, 0.95)" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 2" />
                    <circle
                      cx="88"
                      cy="106"
                      r="36"
                      :fill="asStepVis(evalResult.paneVisuals[pIdx]).wcMinMm < 0 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.22)'"
                      :stroke="asStepVis(evalResult.paneVisuals[pIdx]).wcMinMm < 0 ? '#ef4444' : '#10b981'"
                      stroke-width="2"
                    />
                    <text x="88" y="34" text-anchor="middle" class="svg-pin-label" fill="#c084fc">
                      #10 Bore Ø{{ asStepVis(evalResult.paneVisuals[pIdx]).boreNominalMm.toFixed(3) }} ±{{ asStepVis(evalResult.paneVisuals[pIdx]).boreTolMm.toFixed(3) }}
                    </text>
                    <text x="88" y="109" text-anchor="middle" class="svg-pin-label" fill="#34d399">
                      #20 Shaft Ø{{ asStepVis(evalResult.paneVisuals[pIdx]).shaftNominalMm.toFixed(3) }}
                    </text>
                    <text x="88" y="185" text-anchor="middle" class="svg-attr-hint">
                      ±{{ asStepVis(evalResult.paneVisuals[pIdx]).shaftTolMm.toFixed(3) }} mm (#22)
                    </text>

                    <!-- Right: #30 Clearance Stack Interval Chart (Worst-Case & 3-Sigma RSS vs Contract) -->
                    <rect x="174" y="24" width="222" height="162" rx="8" fill="rgba(15, 23, 42, 0.9)" stroke="#334155" />
                    <text x="184" y="43" class="svg-stereo">#30 EVALUATED_CLEARANCE_ENVELOPE</text>

                    <!-- Allowed Contract Window [0.015, 0.080] mm -->
                    <rect x="210" y="56" width="140" height="84" fill="rgba(16, 185, 129, 0.09)" stroke="rgba(16, 185, 129, 0.4)" stroke-dasharray="3 2" />
                    <text x="210" y="152" text-anchor="middle" class="svg-attr-hint">
                      min {{ asStepVis(evalResult.paneVisuals[pIdx]).allowableMinMm.toFixed(3) }}
                    </text>
                    <text x="350" y="152" text-anchor="middle" class="svg-attr-hint">
                      max {{ asStepVis(evalResult.paneVisuals[pIdx]).allowableMaxMm.toFixed(3) }}
                    </text>

                    <!-- Worst-Case Bar -->
                    <text x="184" y="76" class="svg-attr-name">Worst-Case:</text>
                    <rect
                      :x="Math.max(182, Math.min(375, 210 + ((asStepVis(evalResult.paneVisuals[pIdx]).wcMinMm - 0.015) / 0.065) * 140))"
                      y="82"
                      :width="Math.max(12, Math.min(200, ((asStepVis(evalResult.paneVisuals[pIdx]).wcMaxMm - asStepVis(evalResult.paneVisuals[pIdx]).wcMinMm) / 0.065) * 140))"
                      height="16"
                      rx="4"
                      :fill="asStepVis(evalResult.paneVisuals[pIdx]).isSat ? '#10b981' : '#ef4444'"
                    />
                    <text x="388" y="76" text-anchor="end" class="svg-attr-val">
                      [{{ asStepVis(evalResult.paneVisuals[pIdx]).wcMinMm.toFixed(3) }}, {{ asStepVis(evalResult.paneVisuals[pIdx]).wcMaxMm.toFixed(3) }}] mm
                    </text>

                    <!-- 3-Sigma RSS Statistical Bar -->
                    <text x="184" y="114" class="svg-attr-name">3σ RSS Stack:</text>
                    <rect
                      :x="Math.max(182, Math.min(375, 210 + ((asStepVis(evalResult.paneVisuals[pIdx]).rssMinMm - 0.015) / 0.065) * 140))"
                      y="120"
                      :width="Math.max(12, Math.min(200, ((asStepVis(evalResult.paneVisuals[pIdx]).rssMaxMm - asStepVis(evalResult.paneVisuals[pIdx]).rssMinMm) / 0.065) * 140))"
                      height="14"
                      rx="4"
                      fill="#38bdf8"
                    />
                    <text x="388" y="114" text-anchor="end" class="svg-attr-val">
                      [{{ asStepVis(evalResult.paneVisuals[pIdx]).rssMinMm.toFixed(3) }}, {{ asStepVis(evalResult.paneVisuals[pIdx]).rssMaxMm.toFixed(3) }}] mm
                    </text>

                    <text x="184" y="174" class="svg-attr-hint">
                      Bound to SysML2::REQ_HARMONIC_03
                    </text>
                  </svg>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Cross-Domain Conflict Clause & Blast Radius Tray (when UNSAT) -->
        <div
          v-if="!evalResult.isSat || allDiagnostics.length > 0"
          class="conflict-diagnostics-tray"
          role="alert"
          aria-label="Cross-domain theory conflict clauses"
        >
          <div class="conflict-tray-header">
            <div class="conflict-tray-title">
              <span class="conflict-badge">UNSAT CONFLICT CLAUSE</span>
              <strong>Cross-Domain Violation Detected Across DigitalThreadHypergraph</strong>
            </div>
            <button type="button" class="resolve-conflict-btn" @click="resetScenario">
              Restore Satisfiable Baseline
            </button>
          </div>

          <div class="conflict-list">
            <div
              v-for="(c, cIdx) in evalResult.conflicts"
              :key="cIdx"
              class="conflict-item"
            >
              <div class="conflict-item-main">
                <code class="conflict-oracle">{{ c.theoryName }}</code>
                <span class="conflict-explanation">{{ c.explanation }}</span>
              </div>
              <div class="conflict-culprits">
                <span class="culprit-label">Impacted Blast Radius Entities:</span>
                <code v-for="ent in c.culpritEntities" :key="ent" class="culprit-chip">{{ ent }}</code>
              </div>
            </div>
          </div>
        </div>

        <!-- Terminal CLI Verification Bar -->
        <div class="terminal-bar">
          <div class="terminal-prefix">
            <MsIcon name="terminal" :size="16" />
            <span class="t-prompt">$</span>
          </div>
          <code class="terminal-command">{{ currentScenario.command }}</code>
          <button
            type="button"
            class="copy-btn"
            :class="{ copied }"
            :aria-label="copied ? 'Copied to clipboard' : 'Copy command'"
            @click="copyCommand"
          >
            <MsIcon :name="copied ? 'check' : 'copy'" :size="15" />
            <span class="copy-label">{{ copied ? "Copied" : "Copy" }}</span>
          </button>
        </div>

        <!-- Badges Strip -->
        <div class="badges-strip">
          <span v-for="b in currentScenario.badges" :key="b" class="feature-badge">
            <MsIcon name="check" :size="13" :stroke="2.5" class="badge-check" />
            {{ b }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-semantic-coordinator {
  position: relative;
  z-index: 1;
}

/* Scenario Selector Tabs */
.scenario-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 24px;
}

.scenario-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 14px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.scenario-tab:hover {
  border-color: color-mix(in srgb, var(--tab-accent) 45%, var(--vp-c-border));
  transform: translateY(-1px);
}

.scenario-tab.active {
  border-color: var(--tab-accent);
  box-shadow: 0 8px 24px -6px color-mix(in srgb, var(--tab-accent) 28%, transparent);
}

.scenario-tab.active::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--tab-accent);
}

.tab-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab-icon {
  color: var(--tab-accent);
  display: inline-flex;
}

.tab-domain {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vp-c-text-3);
}

.tab-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.tab-langs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}

.tab-lang-chip {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.chip-sep {
  margin-left: 4px;
  color: var(--tab-accent);
  font-weight: 700;
}

/* Main Coordinator Card */
.coordinator-card {
  position: relative;
  border-radius: 20px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  padding: 28px;
  box-shadow: var(--ms-shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.12));
  overflow: hidden;
  transition: border-color 0.25s ease;
}

.coordinator-card.is-unsat {
  border-color: rgba(239, 68, 68, 0.45);
}

.card-glow {
  position: absolute;
  top: -120px;
  right: -120px;
  width: 380px;
  height: 380px;
  background: radial-gradient(circle, var(--active-accent) 0%, transparent 70%);
  opacity: 0.08;
  pointer-events: none;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.header-badges {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.domain-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--active-accent);
}

.hypergraph-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
}

.hypergraph-pill code {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-1);
}

.verdict-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 11px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}

.verdict-sat {
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.32);
}

.verdict-unsat {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.38);
}

.verdict-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.card-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0;
  line-height: 1.3;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.global-view-toggle {
  display: inline-flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-soft);
}

.gvt-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.gvt-btn.active {
  color: var(--vp-c-text-1);
  background: color-mix(in srgb, var(--active-accent) 20%, var(--vp-c-bg));
}

.activate-monaco-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 13px;
  border-radius: 8px;
  color: var(--vp-c-text-1);
  background: color-mix(in srgb, var(--active-accent) 14%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--active-accent) 42%, var(--vp-c-border));
  cursor: pointer;
  transition: all 0.15s ease;
}

.activate-monaco-btn:hover {
  background: color-mix(in srgb, var(--active-accent) 24%, var(--vp-c-bg-soft));
  border-color: var(--active-accent);
}

.reset-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 7px 12px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
  cursor: pointer;
}

.reset-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--active-accent);
}

.card-description {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 16px 0;
  max-width: 960px;
}

/* What-If Perturbation Presets Bar */
.presets-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 14px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  flex-wrap: wrap;
}

.presets-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.presets-label {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
}

.presets-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 11px;
  border-radius: 8px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--active-accent);
}

.preset-btn.active.is-nominal-btn {
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.5);
  background: rgba(16, 185, 129, 0.1);
}

.preset-btn.active.is-fault-btn {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.12);
}

.preset-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.sat-dot {
  background: #10b981;
}

.fault-dot {
  background: #f59e0b;
}

.inspect-bus-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  cursor: pointer;
}

.inspect-bus-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--active-accent);
}

/* Nelson-Oppen Shared Equality & Interval Bus Panel */
.equality-bus-panel {
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  padding: 14px 16px;
  margin-bottom: 18px;
}

.bus-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.bus-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.bus-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--active-accent) 16%, transparent);
  color: var(--active-accent);
  border: 1px solid color-mix(in srgb, var(--active-accent) 35%, transparent);
}

.bus-summary {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.hypergraph-nodes-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.hg-node-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
}

.hg-node-chip.hg-synced {
  border-color: rgba(16, 185, 129, 0.35);
}

.hg-node-chip.hg-conflict {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.08);
  color: #f87171;
}

.hg-node-chip.hg-stale {
  border-color: rgba(245, 158, 11, 0.45);
}

.hg-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

.hg-conflict .hg-dot {
  background: #ef4444;
}

.hg-stale .hg-dot {
  background: #f59e0b;
}

.hg-status-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.12);
}

/* 4 Variable Link Cards */
.variable-links-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.var-link-card {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color 0.2s ease;
}

.var-link-card.link-sat {
  border-color: rgba(16, 185, 129, 0.28);
}

.var-link-card.link-unsat {
  border-color: rgba(239, 68, 68, 0.6);
  background: rgba(239, 68, 68, 0.05);
}

.var-link-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.var-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.var-canonical-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.canonical-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--active-accent) 16%, transparent);
  color: var(--active-accent);
  flex-shrink: 0;
}

.var-symbol {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.var-mech-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.mech-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.var-mech-code {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  padding: 1px 5px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.var-status-pill {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
}

.var-status-pill.is-sat {
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
}

.var-status-pill.is-unsat {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.18);
}

.var-values-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.var-actual {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.link-unsat .var-actual {
  color: #f87171;
}

.var-bound {
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.var-bound code {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.var-domain-fqns {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 2px;
  padding: 5px 6px;
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
}

.domain-fqn-row {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) auto;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}

.dfqn-lang {
  font-weight: 700;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dfqn-path {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  color: var(--vp-c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dfqn-val {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

.var-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px dashed var(--vp-c-border);
}

.oracle-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--vp-c-text-3);
}

.margin-text {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.link-unsat .margin-text {
  color: #f87171;
}

/* Collapsible Explicit Link, Port & Equation Manifest Drawer */
.oracle-architecture-drawer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drawer-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.drawer-head strong {
  color: var(--vp-c-text-1);
}

.manifest-subsection {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.manifest-sub-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.port-manifest-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.port-manifest-card {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.port-manifest-card.port-bound {
  border-color: rgba(16, 185, 129, 0.4);
}

.port-manifest-card.port-unbound {
  border-color: rgba(239, 68, 68, 0.65);
  background: rgba(239, 68, 68, 0.06);
}

.pm-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
}

.pm-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
}

.pm-badge.is-bound {
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
}

.pm-badge.is-unbound {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.2);
}

.pm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--vp-c-text-2);
}

.pm-spec code {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--vp-c-text-3);
}

.eq-manifest-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.eq-manifest-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 7px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  font-size: 11px;
  flex-wrap: wrap;
}

.eq-file-tag {
  font-weight: 700;
  color: var(--vp-c-text-2);
}

.eq-formula {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-1);
}

.eq-val-pill {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  color: #10b981;
}

.directive-manifest-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}

.directive-manifest-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  font-size: 10px;
  min-width: 0;
}

.dm-loc {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.dm-kind {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  color: var(--active-accent);
  flex-shrink: 0;
}

.dm-expr {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 2x2 Four-Language Synchronized Editor Grid */
.four-pane-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.coord-pane {
  border-radius: 14px;
  background: var(--vp-c-bg-alt, #0d1117);
  border: 1px solid var(--vp-c-border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.coord-pane:hover {
  border-color: color-mix(in srgb, var(--pane-accent) 50%, var(--vp-c-border));
}

.coord-pane.pane-has-error {
  border-color: rgba(239, 68, 68, 0.65);
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.2);
}

.coord-pane.pane-has-warn {
  border-color: rgba(245, 158, 11, 0.55);
}

.pane-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-border);
  flex-wrap: wrap;
}

.pane-bar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pane-index-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--pane-accent) 18%, transparent);
  color: var(--pane-accent);
}

.pane-fmt-tag {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.pane-file-name {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.pane-namespace-fqn {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--pane-accent) 12%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--pane-accent) 30%, var(--vp-c-border));
  color: var(--pane-accent);
}

.pane-bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Per-Pane Code | Diagram / 3D / CAE Mode Tabs */
.pane-mode-tabs {
  display: inline-flex;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg);
}

.pane-mode-tab {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 8px;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pane-mode-tab:hover {
  color: var(--vp-c-text-1);
}

.pane-mode-tab.active {
  color: var(--pane-accent);
  background: color-mix(in srgb, var(--pane-accent) 18%, transparent);
}

.pane-diag-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
}

.pane-diag-badge.is-error {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.16);
  border: 1px solid rgba(239, 68, 68, 0.38);
}

.pane-diag-badge.is-warn {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid rgba(245, 158, 11, 0.38);
}

.pane-doc-link {
  font-size: 11px;
  font-weight: 600;
  color: var(--pane-accent);
  text-decoration: none;
}

.pane-doc-link:hover {
  text-decoration: underline;
}

.editor-body {
  position: relative;
  min-height: 245px;
  max-height: 295px;
  display: flex;
  overflow: auto;
}

.static-semantic-view {
  cursor: pointer;
  user-select: text;
}

.line-numbers {
  display: flex;
  flex-direction: column;
  padding: 12px 8px 12px 12px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--vp-c-text-3);
  text-align: right;
  user-select: none;
  opacity: 0.6;
}

.pane-code {
  margin: 0;
  padding: 12px 14px 12px 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
  overflow-x: auto;
  flex: 1;
}

.pane-code code {
  font-family: inherit;
  background: transparent;
  padding: 0;
  white-space: pre;
}

/* Visual Diagram / 3D CAD / 3D CAE Stage inside Pane */
.pane-visual-body {
  height: 255px;
  background: #090d16;
  color: #e2e8f0;
  display: flex;
  flex-direction: column;
}

.visual-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}

.scad-3d-stage,
.fea-3d-stage {
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.scad-3d-stage:active,
.fea-3d-stage:active {
  cursor: grabbing;
}

.visual-overlay-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.85);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 10.5px;
  z-index: 2;
}

.vo-chip code {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: #38bdf8;
}

.vo-hint {
  font-size: 10px;
  color: #94a3b8;
}

.vo-verdict {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}

.vo-verdict.is-sat {
  color: #10b981;
  background: rgba(16, 185, 129, 0.16);
}

.vo-verdict.is-unsat {
  color: #f87171;
  background: rgba(239, 68, 68, 0.2);
}

.cam-preset-btns {
  display: inline-flex;
  gap: 4px;
}

.cam-btn {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #cbd5e1;
  cursor: pointer;
}

.cam-btn.active,
.cam-btn:hover {
  border-color: var(--pane-accent);
  color: #ffffff;
}

.pane-svg-canvas {
  width: 100%;
  flex: 1;
  min-height: 0;
}

.visual-bottom-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  background: rgba(15, 23, 42, 0.88);
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  font-size: 10px;
  flex-wrap: wrap;
}

.vbl-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #cbd5e1;
}

.vbl-item code {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  color: #f8fafc;
}

.vbl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.vbl-drag-hint {
  font-size: 9.5px;
  color: #64748b;
  margin-left: auto;
}

/* SVG Diagram Typography */
.svg-box-part {
  fill: rgba(15, 23, 42, 0.92);
  stroke: #818cf8;
  stroke-width: 1.5;
}

.svg-box-req {
  fill: rgba(15, 23, 42, 0.92);
  stroke: #38bdf8;
  stroke-width: 1.5;
}

.svg-divider {
  stroke: rgba(148, 163, 184, 0.25);
  stroke-width: 1;
}

.svg-stereo {
  font-family: var(--vp-font-family-mono);
  font-size: 8.5px;
  fill: #94a3b8;
}

.svg-block-title {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  fill: #f8fafc;
}

.svg-attr-name {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  fill: #cbd5e1;
}

.svg-attr-val {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 700;
  fill: #fbbf24;
}

.svg-attr-hint {
  font-family: var(--vp-font-family-mono);
  font-size: 8px;
  fill: #64748b;
}

.svg-edge-label {
  font-family: var(--vp-font-family-mono);
  font-size: 8.5px;
  fill: #a5b4fc;
}

.svg-req-expr {
  font-family: var(--vp-font-family-mono);
  font-size: 8.5px;
  font-weight: 600;
  fill: #e2e8f0;
}

.svg-req-sub {
  font-family: var(--vp-font-family-mono);
  font-size: 8px;
  fill: #94a3b8;
}

.svg-req-verdict {
  font-family: var(--vp-font-family-mono);
  font-size: 8.5px;
  font-weight: 700;
}

.svg-out-big {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 700;
  fill: #34d399;
}

.svg-pin-label {
  font-family: var(--vp-font-family-mono);
  font-size: 8.5px;
  font-weight: 700;
}

.dae-eq-formula-box {
  font-family: var(--vp-font-family-mono);
  font-size: 8.5px;
  line-height: 1.35;
  color: #cbd5e1;
  text-align: center;
  word-break: break-word;
}

/* CSG Tree List */
.csg-tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.csg-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.csg-branch-glyph {
  font-family: var(--vp-font-family-mono);
  color: #64748b;
}

.csg-node-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  color: #f59e0b;
}

.csg-kind-tag_port {
  color: #38bdf8;
}

.csg-node-detail {
  font-size: 10.5px;
  color: #94a3b8;
}

.csg-port-pill {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid;
  color: #e2e8f0;
}

/* Semantic Token Highlighting Colors */
.semantic-code :deep(.tok-keyword) {
  color: #c084fc;
  font-weight: 600;
}
.semantic-code :deep(.tok-type) {
  color: #38bdf8;
}
.semantic-code :deep(.tok-builtin) {
  color: #60a5fa;
}
.semantic-code :deep(.tok-semantic-class) {
  color: #2dd4bf;
  font-weight: 600;
}
.semantic-code :deep(.tok-semantic-param) {
  color: #fb923c;
}
.semantic-code :deep(.tok-semantic-port) {
  color: #38bdf8;
}
.semantic-code :deep(.tok-semantic-state) {
  color: #f472b6;
  font-style: italic;
}
.semantic-code :deep(.tok-semantic-component) {
  color: #a78bfa;
}
.semantic-code :deep(.tok-tag) {
  color: #f472b6;
}
.semantic-code :deep(.tok-attr-name) {
  color: #93c5fd;
}
.semantic-code :deep(.tok-attr-val),
.semantic-code :deep(.tok-string) {
  color: #86efac;
}
.semantic-code :deep(.tok-number) {
  color: #fbbf24;
}
.semantic-code :deep(.tok-comment) {
  color: #64748b;
  font-style: italic;
}
.semantic-code :deep(.tok-op) {
  color: #94a3b8;
}
.semantic-code :deep(.tok-pass) {
  color: #34d399;
  font-weight: 700;
}
.semantic-code :deep(.tok-fail) {
  color: #f87171;
  font-weight: 700;
}

:root:not(.dark) .semantic-code :deep(.tok-keyword) {
  color: #7c3aed;
}
:root:not(.dark) .semantic-code :deep(.tok-type) {
  color: #0284c7;
}
:root:not(.dark) .semantic-code :deep(.tok-semantic-class) {
  color: #0d9488;
}
:root:not(.dark) .semantic-code :deep(.tok-semantic-param) {
  color: #c2410c;
}
:root:not(.dark) .semantic-code :deep(.tok-semantic-port) {
  color: #0369a1;
}
:root:not(.dark) .semantic-code :deep(.tok-attr-val),
:root:not(.dark) .semantic-code :deep(.tok-string) {
  color: #15803d;
}
:root:not(.dark) .semantic-code :deep(.tok-number) {
  color: #b45309;
}

/* Activation Overlay */
.editor-activation-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 10px 12px;
  background: linear-gradient(180deg, transparent 55%, rgba(2, 6, 23, 0.38) 100%);
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
}

.static-semantic-view:hover .editor-activation-overlay,
.static-semantic-view:focus-visible .editor-activation-overlay {
  opacity: 1;
}

.overlay-glass-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: #f8fafc;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
}

.overlay-icon {
  color: var(--pane-accent);
  display: inline-flex;
}

.overlay-text {
  display: flex;
  flex-direction: column;
}

.overlay-title {
  font-size: 11.5px;
  font-weight: 700;
}

.overlay-sub {
  font-size: 10px;
  color: #cbd5e1;
}

.monaco-editor-body {
  height: 245px;
}

.monaco-mount-node {
  width: 100%;
  height: 100%;
}

.monaco-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  z-index: 2;
}

/* Conflict Diagnostics Tray */
.conflict-diagnostics-tray {
  margin-bottom: 18px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.42);
}

.conflict-tray-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.conflict-tray-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--vp-c-text-1);
}

.conflict-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  background: #ef4444;
  color: #ffffff;
}

.resolve-conflict-btn {
  font-size: 11.5px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--vp-c-bg);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: #f87171;
  cursor: pointer;
}

.resolve-conflict-btn:hover {
  background: rgba(239, 68, 68, 0.15);
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-item {
  padding: 8px 11px;
  border-radius: 8px;
  background: var(--vp-c-bg);
  border: 1px solid rgba(239, 68, 68, 0.28);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.conflict-item-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.conflict-oracle {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  color: #f87171;
  flex-shrink: 0;
}

.conflict-explanation {
  color: var(--vp-c-text-1);
}

.conflict-culprits {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.culprit-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-3);
}

.culprit-chip {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

/* Terminal Command Bar */
.terminal-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-radius: 12px;
  background: #0a0f1c;
  border: 1px solid rgba(148, 163, 184, 0.2);
  margin-bottom: 16px;
}

.terminal-prefix {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #2dd4bf;
}

.t-prompt {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
}

.terminal-command {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  color: #e2e8f0;
  overflow-x: auto;
  white-space: nowrap;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
}

.copy-btn.copied {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.4);
}

/* Feature Badges */
.badges-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feature-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-2);
}

.badge-check {
  color: var(--active-accent);
}

@media (max-width: 1024px) {
  .scenario-tabs {
    grid-template-columns: 1fr;
  }
  .variable-links-grid,
  .directive-manifest-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .four-pane-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .coordinator-card {
    padding: 18px;
  }
  .variable-links-grid,
  .directive-manifest-grid {
    grid-template-columns: 1fr;
  }
}
</style>
