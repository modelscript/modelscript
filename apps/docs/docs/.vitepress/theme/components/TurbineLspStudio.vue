<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAnsatzOrigin } from "../util/ansatz.js";
import {
  closeDocsLspBuffer,
  compileStepFromSourcesDocsLsp,
  getCodeActionsDocsLsp,
  getDiagramDataDocsLsp,
  getDiagramPreviewDocsLsp,
  getStepMeshesDocsLsp,
  onLspDiagnostics,
  onLspStatus,
  syncDocsLspBuffer,
  verifyAllDocsLsp,
  type CompileStepFromSourcesResult,
  type LspDiagnostic,
  type LspWorkerStatus,
  type SpoolKinematicsSpec,
  type StepGdtCalloutPayload,
  type StepGdtDatumPayload,
} from "../util/docs-lsp-client.js";
import { buildAnsatzHandoffUrl } from "../util/polyglot-paste-detector.js";
import { hasDiagramElements, type SandboxDiagramHandle } from "../util/sandbox-diagram.js";
import type { SandboxMonacoHandle } from "../util/sandbox-monaco.js";
import MsIcon from "./MsIcon.vue";
import { TURBINE_GDT_ITEMS } from "./turbine/gdt-callouts";
import {
  TURBINE_ARTIFACTS,
  extractTurbineLiveParams,
  type TurbineArtifactId,
  type TurbineArtifactSpec,
} from "./turbine/models";
import type { ScadOverlayMesh } from "./turbine/scene";

export type StudioView = "split" | "3d" | "code" | "diagram";

export interface CompiledStepPayload {
  meshes: ScadOverlayMesh[];
  spools: SpoolKinematicsSpec[];
  gdtOverlay: {
    datums: StepGdtDatumPayload[];
    callouts: StepGdtCalloutPayload[];
  };
  emptyStage?: boolean;
}

interface StudioArtifactState extends TurbineArtifactSpec {
  faulted: boolean;
}

interface ScopedDiagEntry {
  tab: StudioArtifactState;
  diag: LspDiagnostic;
  key: string;
}

const props = withDefaults(
  defineProps<{
    isDark: boolean;
    view: StudioView;
    expanded: boolean;
    showGdt: boolean;
    initialArtifactId?: TurbineArtifactId;
    initialSearchHint?: string | null;
    highlightedCalloutId?: string | null;
  }>(),
  {
    initialArtifactId: "modelica",
    initialSearchHint: null,
    highlightedCalloutId: null,
  },
);

const emit = defineEmits<{
  (e: "update:view", v: StudioView): void;
  (e: "update:expanded", v: boolean): void;
  (e: "update:showGdt", v: boolean): void;
  (e: "select-callout", id: string | null): void;
  (
    e: "live-params",
    params: { n1Rpm: number; n2Rpm: number; t04K: number; cutX: number | null; cutEdited: boolean },
  ): void;
  (e: "compiled-step", payload: CompiledStepPayload | null): void;
  (e: "step-wire", enabled: boolean): void;
  (e: "scad-meshes", meshes: ScadOverlayMesh[] | null): void;
  (e: "stage-slot", el: HTMLElement | null): void;
  (e: "close"): void;
}>();

const { ansatzOrigin } = useAnsatzOrigin();

const artifacts = ref<StudioArtifactState[]>(
  TURBINE_ARTIFACTS.map((spec) => ({
    ...spec,
    faulted: false,
  })),
);

const activeId = ref<TurbineArtifactId>(props.initialArtifactId);
const activeTab = computed(() => artifacts.value.find((a) => a.id === activeId.value) ?? artifacts.value[0]!);

const workerStatus = ref<LspWorkerStatus>({ state: "idle" });
const workerError = ref<string | null>(null);
const diagnosticsByUri = ref<Record<string, LspDiagnostic[]>>({});
const quickFixByDiagKey = ref<Record<string, { title: string; changes: Record<string, any[]> }>>({});
const problemsExpanded = ref(false);
const faultBanner = ref<string | null>(null);
const monacoLoading = ref(false);
const stepCompiling = ref(false);
const compiledMeshCount = ref(0);
const stepWireActive = ref(false);
const compiledSpools = ref<SpoolKinematicsSpec[]>([]);
const compiledFeatureAnchors = ref<CompileStepFromSourcesResult["featureAnchors"]>([]);
const compiledGdtOverlay = ref<CompiledStepPayload["gdtOverlay"] | null>(null);
const lastRpmEditSource = ref<"modelica" | "scad" | undefined>(undefined);
const diagramLoading = ref(false);
const hasX6Diagram = ref(false);
const diagramSvgMarkup = ref<string | null>(null);

const stageSlotRef = ref<HTMLElement | null>(null);
const monacoContainerRef = ref<HTMLElement | null>(null);
const diagramContainerRef = ref<HTMLElement | null>(null);

let monacoHandle: SandboxMonacoHandle | null = null;
let diagramHandle: SandboxDiagramHandle | null = null;
let stopDiagListening: (() => void) | null = null;
let stopStatusListening: (() => void) | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let stepCompileTimer: ReturnType<typeof setTimeout> | null = null;
let verifyAllTimer: ReturnType<typeof setTimeout> | null = null;
let codeActionToken = 0;
let diagramToken = 0;
let stepCompileToken = 0;
let initialCutEdited = false;
const INITIAL_CUT_X = 0;

function diagKey(uri: string, d: LspDiagnostic): string {
  return `${uri}:${d.range.start.line}:${d.range.start.character}:${d.code ?? ""}:${d.message}`;
}

function posToOffset(txt: string, pos: { line: number; character: number }): number {
  const lines = txt.split("\n");
  let off = 0;
  const targetLine = Math.max(0, Math.min(pos.line, lines.length - 1));
  for (let i = 0; i < targetLine; i++) {
    off += lines[i]!.length + 1;
  }
  return off + Math.max(0, Math.min(pos.character, lines[targetLine]?.length ?? 0));
}

const liveParams = computed(() => {
  const byId: Partial<Record<TurbineArtifactId, string>> = {};
  for (const a of artifacts.value) byId[a.id] = a.code;
  return extractTurbineLiveParams(byId, lastRpmEditSource.value);
});

const allProblems = computed<ScopedDiagEntry[]>(() => {
  const out: ScopedDiagEntry[] = [];
  for (const tab of artifacts.value) {
    for (const diag of diagnosticsByUri.value[tab.uri] ?? []) {
      if ((diag.severity ?? 1) > 2) continue;
      out.push({ tab, diag, key: diagKey(tab.uri, diag) });
    }
  }
  return out;
});

const errorCount = computed(() => allProblems.value.filter((p) => (p.diag.severity ?? 1) === 1).length);
const warningCount = computed(() => allProblems.value.filter((p) => p.diag.severity === 2).length);

function diagCountForTab(tab: StudioArtifactState): { errors: number; warnings: number } {
  const list = diagnosticsByUri.value[tab.uri] ?? [];
  let errors = 0;
  let warnings = 0;
  for (const d of list) {
    if ((d.severity ?? 1) === 1) errors++;
    else if (d.severity === 2) warnings++;
  }
  return { errors, warnings };
}

const statusLabel = computed(() => {
  const s = workerStatus.value;
  if (s.state === "ready") return "LSP Ready";
  if (s.state === "loading") return s.language ? `Loading ${s.language} WASM…` : "Loading WASM…";
  if (s.state === "error") return "Worker Error";
  return "Initializing…";
});

function emitTelemetry(): void {
  const p = liveParams.value;
  if (p.cutX !== null && Math.abs(p.cutX - INITIAL_CUT_X) > 1e-4) {
    initialCutEdited = true;
  }
  emit("live-params", {
    n1Rpm: p.n1Rpm,
    n2Rpm: p.n2Rpm,
    t04K: p.t04K,
    cutX: p.cutX,
    cutEdited: initialCutEdited,
  });
}

async function initMonaco(): Promise<void> {
  if (monacoHandle || monacoLoading.value) return;
  monacoLoading.value = true;
  try {
    await nextTick();
    if (!monacoContainerRef.value) return;
    const { mountSandboxMonaco } = await import("../util/sandbox-monaco.js");
    if (!monacoContainerRef.value) return;
    monacoHandle = await mountSandboxMonaco({
      container: monacoContainerRef.value,
      initialUri: activeTab.value.uri,
      initialCode: activeTab.value.code,
      langSlug: activeTab.value.langSlug,
      isDark: props.isDark,
      readOnly: Boolean(activeTab.value.readOnly),
      onChange: (nextCode) => onCodeChange(nextCode),
    });
    for (const tab of artifacts.value) {
      monacoHandle.setValueForUri(tab.uri, tab.code, tab.langSlug);
      const diags = diagnosticsByUri.value[tab.uri];
      if (diags) monacoHandle.setDiagnostics(tab.uri, diags);
    }
    if (props.initialSearchHint) {
      revealTokenInActiveTab(props.initialSearchHint);
    }
  } catch (err: any) {
    workerError.value = `Failed to load Monaco Editor: ${err?.message || String(err)}`;
  } finally {
    monacoLoading.value = false;
  }
}

function revealTokenInActiveTab(token: string): void {
  if (!monacoHandle || !token) return;
  const lines = activeTab.value.code.split("\n");
  const idx = lines.findIndex((l) => l.includes(token));
  if (idx >= 0) {
    const col = Math.max(0, lines[idx]!.indexOf(token));
    monacoHandle.revealRange(idx, col, idx, col + token.length);
  }
}

async function syncAllBuffers(options?: { skipStep?: boolean }): Promise<void> {
  workerError.value = null;
  try {
    for (const tab of artifacts.value) {
      if (options?.skipStep && tab.id === "step") continue;
      await syncDocsLspBuffer(tab.uri, tab.langSlug, tab.code);
    }
    monacoHandle?.refreshSemanticTokens();
    if (props.view === "diagram") {
      void refreshDiagramView();
    }
  } catch (err: any) {
    workerError.value = err?.message || String(err);
  }
}

function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncAllBuffers();
  }, 240);
}

function scheduleStepCompile(delay = 280): void {
  if (stepCompileTimer) clearTimeout(stepCompileTimer);
  stepCompileTimer = setTimeout(() => {
    void compileStepAndDrive3D(true);
  }, delay);
}

function scheduleVerifyAll(uri: string, delay = 900): void {
  if (verifyAllTimer) clearTimeout(verifyAllTimer);
  verifyAllTimer = setTimeout(() => {
    verifyAllTimer = null;
    void verifyAllDocsLsp(uri).catch(() => {});
  }, delay);
}

async function compileStepAndDrive3D(forceRecompile = false): Promise<void> {
  const scadTab = artifacts.value.find((a) => a.id === "scad");
  const qifTab = artifacts.value.find((a) => a.id === "qif");
  const stepTab = artifacts.value.find((a) => a.id === "step");
  const moTab = artifacts.value.find((a) => a.id === "modelica");
  if (!scadTab || !stepTab) return;
  if (!forceRecompile && stepTab.faulted) return;

  const token = ++stepCompileToken;
  stepCompiling.value = true;
  try {
    const compiled = await compileStepFromSourcesDocsLsp({
      scadText: scadTab.code,
      qifText: qifTab?.code ?? "",
      scadUri: scadTab.uri,
      ...(qifTab ? { qifUri: qifTab.uri } : {}),
      stepUri: stepTab.uri,
      ...(moTab ? { modelicaUri: moTab.uri } : {}),
      assemblyName: "Turbofan2Spool",
    });
    if (token !== stepCompileToken) return;
    if (compiled.error || !compiled.stepText) {
      const isEmptyScad =
        scadTab.code.trim().length === 0 ||
        compiled.error === "No top-level SCAD solids evaluated from source.";
      if (isEmptyScad) {
        stepTab.code = "";
        stepTab.faulted = false;
        monacoHandle?.setValueForUri(stepTab.uri, "", stepTab.langSlug);
        await syncDocsLspBuffer(stepTab.uri, stepTab.langSlug, "");
        compiledSpools.value = compiled.spools;
        compiledFeatureAnchors.value = [];
        compiledGdtOverlay.value = null;
        compiledMeshCount.value = 0;
        emit("compiled-step", {
          meshes: [],
          spools: [],
          gdtOverlay: { datums: [], callouts: [] },
          emptyStage: true,
        });
      }
      return;
    }

    stepTab.code = compiled.stepText;
    stepTab.faulted = false;
    monacoHandle?.setValueForUri(stepTab.uri, compiled.stepText, stepTab.langSlug);
    await syncDocsLspBuffer(stepTab.uri, stepTab.langSlug, compiled.stepText);
    monacoHandle?.refreshSemanticTokens();

    compiledSpools.value = compiled.spools;
    compiledFeatureAnchors.value = compiled.featureAnchors;
    compiledGdtOverlay.value = compiled.gdtOverlay;

    if (props.view === "code" || props.view === "diagram") {
      return;
    }

    const rawMeshes = await getStepMeshesDocsLsp(stepTab.uri, compiled.stepText);
    if (token !== stepCompileToken) return;

    const meshes: ScadOverlayMesh[] = [];
    for (const rm of rawMeshes) {
      if (Array.isArray(rm?.vertices) && Array.isArray(rm?.indices) && rm.vertices.length > 0 && rm.indices.length > 0) {
        meshes.push({
          name: rm.name,
          vertices: rm.vertices,
          indices: rm.indices,
          normals: rm.normals,
          color: rm.color,
          unit: rm.unit,
          fromOcct: rm.fromOcct,
        });
      }
    }
    compiledMeshCount.value = meshes.length;
    if (meshes.length > 0) {
      emit("compiled-step", {
        meshes,
        spools: compiled.spools,
        gdtOverlay: compiled.gdtOverlay,
      });
    }
  } catch (err: any) {
    if (token === stepCompileToken) {
      workerError.value = err?.message || String(err);
    }
  } finally {
    if (token === stepCompileToken) {
      stepCompiling.value = false;
    }
  }
}

async function toggleStepWire(): Promise<void> {
  stepWireActive.value = !stepWireActive.value;
  emit("step-wire", stepWireActive.value);
  if (compiledMeshCount.value === 0) {
    await compileStepAndDrive3D(true);
  }
}

let suppressCodeChange = false;

function onCodeChange(nextCode: string): void {
  if (suppressCodeChange) return;
  const tab = activeTab.value;
  if (tab.readOnly) return;
  tab.code = nextCode;
  if (tab.id === "modelica" || tab.id === "scad") {
    lastRpmEditSource.value = tab.id;
  }
  if (tab.faulted) {
    const cleanSpec = TURBINE_ARTIFACTS.find((a) => a.id === tab.id);
    if (cleanSpec && nextCode === cleanSpec.code) {
      tab.faulted = false;
      faultBanner.value = null;
    }
  }
  emitTelemetry();
  scheduleSync();
  if (tab.id === "scad" || tab.id === "qif") {
    scheduleStepCompile();
  }
}

async function refreshQuickFixesForUri(uri: string, diags: LspDiagnostic[]): Promise<void> {
  const token = ++codeActionToken;
  const nextFixes: Record<string, { title: string; changes: Record<string, any[]> }> = {};
  const prefix = `${uri}:`;
  for (const [k, v] of Object.entries(quickFixByDiagKey.value)) {
    if (!k.startsWith(prefix)) nextFixes[k] = v;
  }
  for (const d of diags.slice(0, 6)) {
    const actions = await getCodeActionsDocsLsp(uri, d.range, [d]).catch(() => []);
    if (token !== codeActionToken) return;
    const fix = actions.find((a) => a?.edit?.changes);
    if (fix?.edit?.changes) {
      nextFixes[diagKey(uri, d)] = {
        title: String(fix.title || "Apply QuickFix"),
        changes: fix.edit.changes,
      };
    }
  }
  quickFixByDiagKey.value = nextFixes;
}

function buildFallbackFixForProblem(entry: ScopedDiagEntry): { title: string; nextCode: string } | null {
  const { tab, diag } = entry;
  const msg = `${diag.code ?? ""} ${diag.message}`;
  if (tab.id === "modelica" && tab.code.includes("unknown_clearance_margin")) {
    return {
      title: "Remove undeclared 'unknown_clearance_margin' equation",
      nextCode: tab.code.replace("  unknown_clearance_margin = tip_clearance - 0.0001;\n", ""),
    };
  }
  if (tab.id === "scad" && tab.code.includes("broken_shroud_ring")) {
    return {
      title: "Restore valid positive radius r = 1.48 on shroud ring",
      nextCode: tab.code.replace(
        /\n?module broken_shroud_ring\(\)[\s\S]*?broken_shroud_ring\(\);\n?/,
        "\n",
      ),
    };
  }
  if (tab.id === "step" && tab.code.includes("#999")) {
    return {
      title: "Remove dangling DEFINITIONAL_REPRESENTATION (#999)",
      nextCode: tab.code.replace(/#\d+=DEFINITIONAL_REPRESENTATION\('FaultRef',\(#999\),#\d+\);\n?/, ""),
    };
  }
  if (tab.id === "qif" && (tab.code.includes("C_FAULT_PERP") || msg.includes("M8104"))) {
    return {
      title: "Change C_FAULT_PERP material modifier or remove fault",
      nextCode: tab.code.replace(
        /\n?CHARACTERISTIC C_FAULT_PERP[^\n]*\n?/,
        "\n",
      ),
    };
  }
  return null;
}

async function applyFixForProblem(entry: ScopedDiagEntry): Promise<void> {
  if (stepCompileTimer) {
    clearTimeout(stepCompileTimer);
    stepCompileTimer = null;
  }
  if (verifyAllTimer) {
    clearTimeout(verifyAllTimer);
    verifyAllTimer = null;
  }
  const lspFix = quickFixByDiagKey.value[entry.key];
  if (lspFix?.changes) {
    let touchedStep = false;
    let touchedCadSource = false;
    const nextDiags = { ...diagnosticsByUri.value };
    for (const [uri, textEdits] of Object.entries(lspFix.changes)) {
      const targetTab = artifacts.value.find((t) => t.uri === uri);
      if (!targetTab || !Array.isArray(textEdits)) continue;
      let nextCode = targetTab.code;
      const resolved = textEdits
        .map((te) => ({
          start: posToOffset(nextCode, te.range.start),
          end: posToOffset(nextCode, te.range.end),
          newText: String(te.newText ?? ""),
        }))
        .sort((a, b) => b.start - a.start);
      for (const r of resolved) {
        nextCode = nextCode.slice(0, r.start) + r.newText + nextCode.slice(r.end);
      }
      targetTab.code = nextCode;
      targetTab.faulted = false;
      nextDiags[targetTab.uri] = [];
      suppressCodeChange = true;
      try {
        monacoHandle?.setValueForUri(targetTab.uri, nextCode, targetTab.langSlug);
      } finally {
        suppressCodeChange = false;
      }
      if (targetTab.id === "step") {
        touchedStep = true;
      } else if (targetTab.id === "scad") {
        touchedCadSource = true;
      }
    }
    diagnosticsByUri.value = nextDiags;
    faultBanner.value = null;
    emitTelemetry();
    await syncAllBuffers({ skipStep: !touchedStep });
    await verifyAllDocsLsp(activeTab.value.uri).catch(() => {});
    if (touchedStep) {
      await compileStepAndDrive3D(true);
    } else if (touchedCadSource) {
      scheduleStepCompile(400);
    }
    return;
  }

  const fb = buildFallbackFixForProblem(entry);
  if (fb) {
    entry.tab.code = fb.nextCode;
    entry.tab.faulted = false;
    faultBanner.value = null;
    diagnosticsByUri.value = {
      ...diagnosticsByUri.value,
      [entry.tab.uri]: [],
    };
    suppressCodeChange = true;
    try {
      monacoHandle?.setValueForUri(entry.tab.uri, fb.nextCode, entry.tab.langSlug);
    } finally {
      suppressCodeChange = false;
    }
    emitTelemetry();
    await syncAllBuffers({ skipStep: entry.tab.id !== "step" });
    await verifyAllDocsLsp(activeTab.value.uri).catch(() => {});
    if (entry.tab.id === "step") {
      await compileStepAndDrive3D(true);
    } else if (entry.tab.id === "scad") {
      scheduleStepCompile(400);
    }
  }
}

async function toggleFaultOnActiveTab(): Promise<void> {
  const tab = activeTab.value;
  if (verifyAllTimer) {
    clearTimeout(verifyAllTimer);
    verifyAllTimer = null;
  }
  if (tab.faulted) {
    const clean = TURBINE_ARTIFACTS.find((a) => a.id === tab.id);
    if (clean) {
      tab.code = clean.code;
      tab.faulted = false;
      faultBanner.value = null;
      suppressCodeChange = true;
      try {
        monacoHandle?.setValueForUri(tab.uri, clean.code, tab.langSlug);
      } finally {
        suppressCodeChange = false;
      }
      emitTelemetry();
      await syncAllBuffers();
      if (tab.id === "scad" || tab.id === "step") {
        await compileStepAndDrive3D(true);
      }
      scheduleVerifyAll(tab.uri, 500);
    }
    return;
  }

  const res = tab.injectFault(tab.code);
  tab.code = res.code;
  tab.faulted = true;
  faultBanner.value = res.label;
  problemsExpanded.value = true;
  suppressCodeChange = true;
  try {
    monacoHandle?.setValueForUri(tab.uri, res.code, tab.langSlug);
  } finally {
    suppressCodeChange = false;
  }
  if (props.view === "3d" || props.view === "diagram") {
    emit("update:view", "split");
  }
  await syncAllBuffers();
  if (tab.id === "scad") {
    scheduleStepCompile(1500);
  }
  scheduleVerifyAll(tab.uri, 1100);
}

async function revealProblem(entry: ScopedDiagEntry): Promise<void> {
  activeId.value = entry.tab.id;
  if (props.view === "3d" || props.view === "diagram") {
    emit("update:view", "split");
  }
  await nextTick();
  monacoHandle?.layout();
  monacoHandle?.revealRange(
    entry.diag.range.start.line,
    entry.diag.range.start.character,
    entry.diag.range.end.line,
    entry.diag.range.end.character,
  );
}

async function openInAnsatzEditor(): Promise<void> {
  const activeIdx = Math.max(
    0,
    artifacts.value.findIndex((t) => t.id === activeId.value),
  );
  const url = await buildAnsatzHandoffUrl(ansatzOrigin.value, artifacts.value, activeIdx);
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function refreshDiagramView(): Promise<void> {
  if (props.view !== "diagram") return;
  const tab = activeTab.value;
  const token = ++diagramToken;
  diagramLoading.value = true;
  diagramSvgMarkup.value = null;
  hasX6Diagram.value = false;
  try {
    const data = await getDiagramDataDocsLsp(tab.uri, tab.langSlug, tab.code).catch(() => null);
    if (token !== diagramToken) return;
    if (hasDiagramElements(data)) {
      hasX6Diagram.value = true;
      await nextTick();
      if (token !== diagramToken || !diagramContainerRef.value) return;
      if (!diagramHandle) {
        const { mountSandboxDiagram } = await import("../util/sandbox-diagram.js");
        if (token !== diagramToken || !diagramContainerRef.value) return;
        diagramHandle = await mountSandboxDiagram(diagramContainerRef.value, props.isDark);
      }
      diagramHandle.render(data, props.isDark, tab.langSlug);
      return;
    }
    const preview = await getDiagramPreviewDocsLsp(tab.uri, tab.langSlug, tab.code, props.isDark).catch(() => null);
    if (token !== diagramToken) return;
    if (preview?.svg) {
      diagramSvgMarkup.value = preview.svg;
    }
  } finally {
    if (token === diagramToken) {
      diagramLoading.value = false;
    }
  }
}

// Derived data for clean architectural schematic fallback when an engineering format (QIF / AP242 / SCAD / DAE equations)
// does not declare Modelica-style graphical component connectors.
const schematicModelicaThrust = computed(() => {
  const p = liveParams.value;
  return (112.4 * Math.pow(p.n1Rpm / 3850, 2) * (1 + 0.18 * 9.2)).toFixed(1);
});

const CHAR_SYMBOLS: Record<string, string> = {
  TotalRunout: "⌰",
  CircularRunout: "↗",
  Position: "⌖",
  Cylindricity: "⌭",
  ProfileOfSurface: "⌒",
  Perpendicularity: "⊥",
  Flatness: "⏥",
  Parallelism: "∥",
  Concentricity: "◎",
  Straightness: "⎯",
};

const qifRows = computed(() => {
  const liveCallouts = compiledGdtOverlay.value?.callouts;
  if (liveCallouts && liveCallouts.length > 0) {
    return liveCallouts.map((c) => {
      const base = TURBINE_GDT_ITEMS.find((item) => item.qifCharacteristicId === c.id);
      const sym = base?.callout.symbol ?? CHAR_SYMBOLS[c.characteristic] ?? "⌖";
      const mod = c.materialCondition === "MMC" ? "Ⓜ" : c.materialCondition === "LMC" ? "Ⓛ" : "";
      const datumStr = c.datums.map((d) => d.label).join(" ");
      const fcf = [sym, c.tolerance.toFixed(3), mod, datumStr].filter(Boolean).join(" ");
      return {
        id: c.id,
        symbol: sym,
        fcf,
        label: base?.callout.label ?? c.characteristic,
        actual: c.measured !== undefined ? c.measured.toFixed(3) : (base?.actualDeviationMm.toFixed(3) ?? "—"),
        limit: c.tolerance.toFixed(3),
        status: c.status,
        section: base?.sectionId ?? "core",
      };
    });
  }
  return TURBINE_GDT_ITEMS.map((item) => ({
    id: item.qifCharacteristicId,
    symbol: item.callout.symbol,
    fcf: item.fcfText,
    label: item.callout.label,
    actual: item.actualDeviationMm.toFixed(3),
    limit: item.callout.tolerance.toFixed(3),
    status: item.callout.status ?? "PASS",
    section: item.sectionId,
  }));
});

watch(
  () => activeTab.value.id,
  async () => {
    await nextTick();
    if (monacoHandle) {
      monacoHandle.switchTab(
        activeTab.value.uri,
        activeTab.value.code,
        activeTab.value.langSlug,
        Boolean(activeTab.value.readOnly),
      );
      const diags = diagnosticsByUri.value[activeTab.value.uri];
      if (diags) monacoHandle.setDiagnostics(activeTab.value.uri, diags);
      monacoHandle.layout();
    }
    if (props.view === "diagram") {
      void refreshDiagramView();
    }
  },
);

watch(
  () => props.isDark,
  (dark) => {
    monacoHandle?.setTheme(dark);
    diagramHandle?.setTheme(dark);
    if (props.view === "diagram" && !hasX6Diagram.value) {
      void refreshDiagramView();
    }
  },
);

watch(
  () => [props.view, props.expanded] as const,
  async ([nextView]) => {
    await nextTick();
    emit("stage-slot", stageSlotRef.value);
    if (nextView === "split" || nextView === "code") {
      if (!monacoHandle) {
        void initMonaco();
      } else {
        monacoHandle.layout();
      }
    }
    if (nextView === "diagram") {
      void refreshDiagramView();
    }
  },
);

watch(
  () => props.initialArtifactId,
  (nextId) => {
    if (nextId && nextId !== activeId.value) {
      activeId.value = nextId;
    }
  },
);

watch(
  () => props.initialSearchHint,
  (hint) => {
    if (hint) {
      nextTick(() => revealTokenInActiveTab(hint));
    }
  },
);

onMounted(async () => {
  stopDiagListening = onLspDiagnostics((uri, diags) => {
    diagnosticsByUri.value = {
      ...diagnosticsByUri.value,
      [uri]: diags,
    };
    monacoHandle?.setDiagnostics(uri, diags);
    monacoHandle?.refreshSemanticTokens();
    if (uri === activeTab.value.uri) {
      void refreshQuickFixesForUri(uri, diags);
    }
  });

  stopStatusListening = onLspStatus((status) => {
    workerStatus.value = status;
    if (status.state === "ready") {
      monacoHandle?.refreshSemanticTokens();
    }
  });

  emit("stage-slot", stageSlotRef.value);
  emitTelemetry();

  if (props.view === "split" || props.view === "code") {
    void initMonaco();
  }
  await syncAllBuffers({ skipStep: true });
  await compileStepAndDrive3D(true);
  if (props.view === "diagram") {
    void refreshDiagramView();
  }
});

onBeforeUnmount(() => {
  if (syncTimer) clearTimeout(syncTimer);
  if (stepCompileTimer) clearTimeout(stepCompileTimer);
  if (verifyAllTimer) clearTimeout(verifyAllTimer);
  emit("stage-slot", null);
  emit("compiled-step", null);
  emit("step-wire", false);
  emit("scad-meshes", null);
  stopDiagListening?.();
  stopStatusListening?.();
  for (const tab of artifacts.value) {
    monacoHandle?.removeModel(tab.uri);
    void closeDocsLspBuffer(tab.uri).catch(() => {});
  }
  monacoHandle?.dispose();
  monacoHandle = null;
  diagramHandle?.dispose();
  diagramHandle = null;
});

function selectGdtRow(qifCharId: string): void {
  activeId.value = "qif";
  if (props.view === "3d" || props.view === "diagram") {
    emit("update:view", "split");
  }
  nextTick(() => revealTokenInActiveTab(qifCharId));
}
</script>

<template>
  <div class="tls-root" :class="{ 'is-expanded': expanded, 'is-dark': isDark }">
    <!-- Row 1: File tabs & View Switcher -->
    <div class="tls-topbar">
      <div class="tls-tabs" role="tablist" aria-label="Turbofan engineering artifacts">
        <button
          v-for="tab in artifacts"
          :key="tab.id"
          type="button"
          role="tab"
          class="tls-tab"
          :class="{ 'is-active': activeId === tab.id, 'is-readonly': tab.readOnly }"
          :aria-selected="activeId === tab.id"
          :title="tab.readOnly ? `${tab.label} (${tab.shortTag} · Read-only compiled artifact)` : `${tab.label} (${tab.shortTag})`"
          @click="activeId = tab.id"
        >
          <span class="tls-tab-lang" :data-lang="tab.id" aria-hidden="true" />
          <span class="tls-tab-name">{{ tab.fileName }}</span>
          <svg
            v-if="tab.readOnly"
            class="tls-tab-lock"
            viewBox="0 0 24 24"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            stroke-width="2.1"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-label="Read-only compiled artifact"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span
            v-if="diagCountForTab(tab).errors > 0"
            class="tls-tab-badge is-err"
            :aria-label="`${diagCountForTab(tab).errors} errors`"
          >
            {{ diagCountForTab(tab).errors }}
          </span>
          <span
            v-else-if="diagCountForTab(tab).warnings > 0"
            class="tls-tab-badge is-warn"
            :aria-label="`${diagCountForTab(tab).warnings} warnings`"
          >
            {{ diagCountForTab(tab).warnings }}
          </span>
        </button>
      </div>

      <div class="tls-controls">
        <div class="tls-view-group" role="group" aria-label="Studio workspace view">
          <button
            v-for="v in [
              { id: '3d', label: '3D' },
              { id: 'split', label: 'Split' },
              { id: 'code', label: 'Code' },
              { id: 'diagram', label: 'Diagram' },
            ] as const"
            :key="v.id"
            type="button"
            class="tls-view-btn"
            :class="{ 'is-active': view === v.id }"
            @click="emit('update:view', v.id)"
          >
            {{ v.label }}
          </button>
        </div>

        <button
          type="button"
          class="tls-pill-btn"
          :class="{ 'is-active': showGdt }"
          title="Toggle ASME Y14.5 GD&T 3D Feature Control Frames"
          @click="emit('update:showGdt', !showGdt)"
        >
          GD&amp;T
        </button>

        <button
          type="button"
          class="tls-icon-btn"
          :title="expanded ? 'Return to inline hero size (Esc)' : 'Expand workbench overlay'"
          :aria-label="expanded ? 'Collapse workbench' : 'Expand workbench'"
          @click="emit('update:expanded', !expanded)"
        >
          <svg
            v-if="!expanded"
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="m21 3-7 7" />
            <path d="m3 21 7-7" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 14h6v6" />
            <path d="M20 10h-6V4" />
            <path d="m14 10 7-7" />
            <path d="m3 21 7-7" />
          </svg>
        </button>

        <button
          type="button"
          class="tls-icon-btn is-close"
          title="Exit Live LSP Studio (Esc)"
          aria-label="Exit Live LSP Studio"
          @click="emit('close')"
        >
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2.1"
            stroke-linecap="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Row 2: Live LSP status, telemetry readout & action buttons -->
    <div class="tls-subbar">
      <div class="tls-status-cluster">
        <span class="tls-status-dot" :data-state="workerStatus.state" aria-hidden="true" />
        <span class="tls-status-text">{{ statusLabel }}</span>
        <span class="tls-telemetry" title="Live values parsed from Modelica/OpenSCAD editor buffers">
          N1 {{ Math.round(liveParams.n1Rpm) }} rpm · N2 {{ Math.round(liveParams.n2Rpm) }} · T04
          {{ Math.round(liveParams.t04K) }} K
        </span>
      </div>

      <div class="tls-action-cluster">
        <button
          v-if="view === '3d' || view === 'split'"
          type="button"
          class="tls-mini-btn"
          :class="{ 'is-active': stepWireActive }"
          :title="
            stepWireActive
              ? 'Hide compiled AP242 B-Rep wireframe edges on 3D viewport'
              : 'Show compiled ISO-10303-21 AP242 B-Rep wireframe edges on 3D viewport'
          "
          @click="toggleStepWire"
        >
          <span>{{
            stepCompiling
              ? "STEP…"
              : stepWireActive
                ? `Wire On (${compiledMeshCount})`
                : compiledMeshCount > 0
                  ? `STEP 3D (${compiledMeshCount})`
                  : "STEP 3D"
          }}</span>
        </button>

        <button
          type="button"
          class="tls-mini-btn"
          :class="{ 'is-danger': activeTab.faulted }"
          :title="activeTab.faultLabel"
          @click="toggleFaultOnActiveTab"
        >
          <span>{{ activeTab.faulted ? "↺ Restore" : "⚠ Inject Fault" }}</span>
        </button>

        <button
          type="button"
          class="tls-mini-btn is-primary"
          title="Export all 4 turbofan digital-thread files directly into Ansatz"
          @click="openInAnsatzEditor"
        >
          <span>Ansatz</span>
          <MsIcon name="arrow-up-right" :size="11" :stroke="2.1" />
        </button>
      </div>
    </div>

    <!-- Main Workspace Body -->
    <div class="tls-workspace" :data-view="view">
      <!-- Stage Slot: TurbineHero aligns the single persistent WebGL2 canvas container right over this element -->
      <div v-if="view === '3d' || view === 'split'" ref="stageSlotRef" class="tls-stage-slot" />

      <!-- Code Editor (Monaco) -->
      <div v-show="view === 'split' || view === 'code'" class="tls-editor-wrap">
        <div v-if="activeTab.readOnly" class="tls-ro-ribbon">
          <span>
            Read-only compiled artifact generated from
            <button type="button" class="tls-ro-link" @click="activeId = 'scad'">TurbofanCSG.scad</button>
            +
            <button type="button" class="tls-ro-link" @click="activeId = 'qif'">TurbofanMBD.qif</button>.
          </span>
        </div>
        <div v-if="monacoLoading" class="tls-loading">Initializing Monaco WASM LSP…</div>
        <div ref="monacoContainerRef" class="tls-monaco-host" />
      </div>

      <!-- Diagram / Digital Thread View -->
      <div v-if="view === 'diagram'" class="tls-diagram-wrap">
        <div v-if="diagramLoading" class="tls-loading">Generating structural schematic…</div>
        <div v-show="hasX6Diagram" ref="diagramContainerRef" class="tls-diagram-x6" />
        <div v-if="!hasX6Diagram && diagramSvgMarkup" class="tls-diagram-svg" v-html="diagramSvgMarkup" />
        <div v-else-if="!hasX6Diagram && !diagramLoading" class="tls-schematic-card">
          <div class="tls-schem-head">
            <span class="tls-schem-kicker">{{ activeTab.shortTag }} · Architectural Thread View</span>
            <span class="tls-schem-sub">{{ activeTab.fileName }}</span>
          </div>

          <!-- Modelica Thermo-Aero Spool Signal Flow -->
          <div v-if="activeTab.id === 'modelica'" class="tls-flow-grid">
            <div class="tls-flow-node">
              <span class="tls-fn-title">LP Spool (N1)</span>
              <span class="tls-fn-val">{{ Math.round(liveParams.n1Rpm) }} rpm</span>
              <span class="tls-fn-eq">Fan + 3-Stg LPT · Tip dR {{ (0.42).toFixed(2) }} mm</span>
            </div>
            <span class="tls-flow-arrow" aria-hidden="true">→</span>
            <div class="tls-flow-node is-accent">
              <span class="tls-fn-title">HP Core (N2)</span>
              <span class="tls-fn-val">{{ Math.round(liveParams.n2Rpm) }} rpm</span>
              <span class="tls-fn-eq">7-Stg HPC (OPR 38.4) + T04 {{ Math.round(liveParams.t04K) }} K</span>
            </div>
            <span class="tls-flow-arrow" aria-hidden="true">→</span>
            <div class="tls-flow-node">
              <span class="tls-fn-title">Installed Thrust</span>
              <span class="tls-fn-val">{{ schematicModelicaThrust }} kN</span>
              <span class="tls-fn-eq">BPR 9.2 · Balanced DAE (6 eq / 6 var)</span>
            </div>
          </div>

          <!-- SCAD CSG Boolean Tree -->
          <div v-else-if="activeTab.id === 'scad'" class="tls-tree-list">
            <div class="tls-tree-root">union() · TurbofanCSG.scad ($fn = 36, +X coaxial)</div>
            <div class="tls-tree-item">├─ intake_nacelle() → difference(cylinder r=1.60, r=1.50) + spinner</div>
            <div class="tls-tree-item">├─ fan_lp_stage() → 18× rotated titanium blade solids (r=1.48)</div>
            <div class="tls-tree-item">├─ hpc_core_drum() → 6× coaxial rotor drum stages</div>
            <div class="tls-tree-item">├─ combustor_liner() → annular liner (x=[0.45, 1.13])</div>
            <div class="tls-tree-item">└─ lpt_nozzle_stage() → Inconel nozzle &amp; cone</div>
          </div>

          <!-- STEP AP242 PMI Tree -->
          <div v-else-if="activeTab.id === 'step'" class="tls-tree-list">
            <div class="tls-tree-root">
              PRODUCT('Turbofan2Spool') · Compiled AP242 B-Rep + PMI ({{ compiledMeshCount }} solids,
              {{ compiledSpools.length }} spools)
            </div>
            <div v-for="sp in compiledSpools" :key="sp.part" class="tls-tree-item">
              ├─ @spool({{ sp.spool }}) → {{ sp.part }} axis=[{{ sp.axis.join(",") }}]
            </div>
            <div v-for="fa in compiledFeatureAnchors" :key="fa.name" class="tls-tree-item">
              ├─ ANCHOR '{{ fa.name }}' ({{ fa.portType }}) → ({{ fa.anchor.map((n) => n.toFixed(2)).join(", ") }})
            </div>
            <div v-for="c in compiledGdtOverlay?.callouts ?? []" :key="c.id" class="tls-tree-item">
              └─ {{ c.id }} {{ c.characteristic }} {{ c.tolerance.toFixed(3) }} [{{ c.status }}]
            </div>
          </div>

          <!-- QIF 3.0 MBD Inspection Chain -->
          <div v-else class="tls-qif-table">
            <div v-for="r in qifRows" :key="r.id" class="tls-qif-row" @click="selectGdtRow(r.id)">
              <span class="tls-qif-sym">{{ r.symbol }}</span>
              <span class="tls-qif-fcf">{{ r.fcf }}</span>
              <span class="tls-qif-lbl">{{ r.label }}</span>
              <span class="tls-qif-meas">{{ r.actual }} / {{ r.limit }} mm</span>
              <span class="tls-qif-pass" :data-status="r.status">{{ r.status }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Collapsible Problems & QuickFix Drawer -->
    <div class="tls-problems" :class="{ 'is-open': problemsExpanded }">
      <button
        type="button"
        class="tls-problems-bar"
        :aria-expanded="problemsExpanded"
        @click="problemsExpanded = !problemsExpanded"
      >
        <span class="tls-prob-summary">
          <span
            class="tls-prob-dot"
            :class="{
              'is-clean': errorCount === 0 && warningCount === 0,
              'is-err': errorCount > 0,
              'is-warn': errorCount === 0 && warningCount > 0,
            }"
          />
          <template v-if="allProblems.length === 0">0 Problems · All 4 digital-thread artifacts clean</template>
          <template v-else>
            {{ allProblems.length }} {{ allProblems.length === 1 ? "Problem" : "Problems" }} ({{ errorCount }}E /
            {{ warningCount }}W)
          </template>
        </span>
        <span v-if="faultBanner" class="tls-fault-banner">{{ faultBanner }}</span>
        <span v-else-if="workerError" class="tls-fault-banner">{{ workerError }}</span>
        <span class="tls-prob-chev" :class="{ 'is-open': problemsExpanded }">▾</span>
      </button>

      <div v-if="problemsExpanded" class="tls-problems-list">
        <div v-if="allProblems.length === 0" class="tls-prob-empty">
          No errors or warnings across Turbofan2Spool.mo, TurbofanCSG.scad, TurbofanAP242.step, and TurbofanMBD.qif. Use
          <strong>⚠ Inject Fault</strong> above to test live client-side WASM diagnostics &amp; quick fixes.
        </div>
        <div
          v-for="entry in allProblems"
          :key="entry.key"
          class="tls-prob-item"
          @click="revealProblem(entry)"
        >
          <span class="tls-prob-sev" :data-sev="entry.diag.severity ?? 1">
            {{ (entry.diag.severity ?? 1) === 1 ? "ERR" : entry.diag.severity === 2 ? "WRN" : "INF" }}
          </span>
          <span class="tls-prob-loc">
            {{ entry.tab.fileName }}:{{ entry.diag.range.start.line + 1 }}:{{ entry.diag.range.start.character + 1 }}
          </span>
          <span v-if="entry.diag.code" class="tls-prob-code">[{{ entry.diag.code }}]</span>
          <span class="tls-prob-msg">{{ entry.diag.message }}</span>
          <button
            v-if="quickFixByDiagKey[entry.key] || buildFallbackFixForProblem(entry)"
            type="button"
            class="tls-fix-btn"
            :title="quickFixByDiagKey[entry.key]?.title || buildFallbackFixForProblem(entry)?.title"
            @click.stop="applyFixForProblem(entry)"
          >
            Fix
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tls-root {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 36%, var(--vp-c-divider));
  background: color-mix(in srgb, var(--vp-c-bg-elv) 96%, transparent);
  backdrop-filter: blur(16px) saturate(1.35);
  -webkit-backdrop-filter: blur(16px) saturate(1.35);
  box-shadow:
    0 20px 44px -16px rgba(2, 6, 23, 0.45),
    0 0 0 1px color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
  overflow: hidden;
  font-family: var(--vp-font-family-base);
}

.tls-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg-alt) 85%, transparent);
  flex-shrink: 0;
  min-width: 0;
}

.tls-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  overflow-x: auto;
  scrollbar-width: none;
  min-width: 0;
}
.tls-tabs::-webkit-scrollbar {
  display: none;
}

.tls-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.tls-tab:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}

.tls-tab.is-active {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--vp-c-divider));
}

.tls-tab-lock {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  opacity: 0.85;
}

.tls-tab-lang {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}
.tls-tab-lang[data-lang="modelica"] {
  background: #38bdf8;
}
.tls-tab-lang[data-lang="scad"] {
  background: #f59e0b;
}
.tls-tab-lang[data-lang="step"] {
  background: #a78bfa;
}
.tls-tab-lang[data-lang="qif"] {
  background: #10b981;
}

.tls-tab-badge {
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 99px;
  font-size: 9.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tls-tab-badge.is-err {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}
.tls-tab-badge.is-warn {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}

.tls-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.tls-view-group {
  display: inline-flex;
  padding: 2px;
  border-radius: 7px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.tls-view-btn {
  height: 22px;
  padding: 0 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.tls-view-btn.is-active {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.tls-pill-btn,
.tls-icon-btn {
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tls-pill-btn {
  padding: 0 7px;
  font-family: var(--vp-font-family-mono);
}
.tls-pill-btn.is-active {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--ms-brand-soft);
}
.tls-icon-btn {
  width: 26px;
}
.tls-icon-btn:hover,
.tls-pill-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}
.tls-icon-btn.is-close:hover {
  border-color: rgba(239, 68, 68, 0.6);
  color: #f87171;
}

.tls-subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg) 90%, transparent);
  font-size: 11px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.tls-status-cluster,
.tls-action-cluster {
  display: flex;
  align-items: center;
  gap: 7px;
}

.tls-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
}
.tls-status-dot[data-state="ready"] {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}
.tls-status-dot[data-state="loading"] {
  background: #f59e0b;
}
.tls-status-dot[data-state="error"] {
  background: #ef4444;
}

.tls-status-text {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.tls-telemetry {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.tls-mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.tls-mini-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}
.tls-mini-btn.is-active {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--ms-brand-soft);
}
.tls-mini-btn.is-danger {
  border-color: rgba(239, 68, 68, 0.45);
  color: #f87171;
  background: rgba(239, 68, 68, 0.1);
}
.tls-mini-btn.is-primary {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 45%, transparent);
  color: var(--vp-c-brand-1);
  background: var(--ms-brand-soft);
}

.tls-workspace {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}
.tls-workspace[data-view="split"] {
  grid-template-rows: minmax(150px, 42%) minmax(0, 58%);
}
.tls-root.is-expanded .tls-workspace[data-view="split"] {
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: minmax(0, 48%) minmax(0, 52%);
}

.tls-stage-slot {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-bottom: 1px solid var(--vp-c-divider);
}
.tls-workspace[data-view="3d"] .tls-stage-slot {
  border-bottom: none;
}
.tls-root.is-expanded .tls-workspace[data-view="split"] .tls-stage-slot {
  border-bottom: none;
  border-right: 1px solid var(--vp-c-divider);
}

.tls-stage-hud {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  z-index: 4;
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

.tls-editor-wrap,
.tls-diagram-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--vp-c-bg);
}

.tls-editor-wrap {
  display: flex;
  flex-direction: column;
}

.tls-ro-ribbon {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  font-size: 11px;
  color: var(--vp-c-text-2);
  background: color-mix(in srgb, #a78bfa 10%, var(--vp-c-bg-alt));
  border-bottom: 1px solid color-mix(in srgb, #a78bfa 28%, var(--vp-c-divider));
  flex-shrink: 0;
}

.tls-ro-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.tls-monaco-host {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}

.tls-diagram-x6 {
  width: 100%;
  height: 100%;
}

.tls-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.tls-diagram-svg {
  width: 100%;
  height: 100%;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
.tls-diagram-svg :deep(svg) {
  max-width: 100%;
  max-height: 100%;
  height: auto;
}

.tls-schematic-card {
  height: 100%;
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tls-schem-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.tls-schem-kicker {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}
.tls-schem-sub {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.tls-flow-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}
.tls-flow-node {
  padding: 10px;
  border-radius: 9px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tls-flow-node.is-accent {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 48%, var(--vp-c-divider));
}
.tls-fn-title {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--vp-c-text-2);
}
.tls-fn-val {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.tls-fn-eq {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--vp-c-text-3);
}
.tls-flow-arrow {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.tls-tree-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px;
  border-radius: 9px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
}
.tls-tree-root {
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.tls-tree-item {
  color: var(--vp-c-text-2);
  padding-left: 4px;
}

.tls-qif-table {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tls-qif-row {
  display: grid;
  grid-template-columns: 20px auto 1fr auto minmax(44px, auto);
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  font-size: 11px;
  cursor: pointer;
}
.tls-qif-row:hover {
  border-color: var(--vp-c-brand-1);
}
.tls-qif-sym {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  color: var(--vp-c-brand-1);
}
.tls-qif-fcf,
.tls-qif-meas {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
}
.tls-qif-lbl {
  color: var(--vp-c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tls-qif-pass {
  text-align: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 700;
  background: rgba(16, 185, 129, 0.16);
  color: #10b981;
}
.tls-qif-pass[data-status="MARGINAL"] {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}
.tls-qif-pass[data-status="FAIL"] {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}

/* Collapsible Problems Drawer */
.tls-problems {
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  flex-shrink: 0;
}

.tls-problems-bar {
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--vp-c-text-2);
  cursor: pointer;
}
.tls-problems-bar:hover {
  background: var(--vp-c-default-soft);
}

.tls-prob-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
}

.tls-prob-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.tls-prob-dot.is-clean {
  background: #10b981;
}
.tls-prob-dot.is-err {
  background: #ef4444;
}
.tls-prob-dot.is-warn {
  background: #f59e0b;
}

.tls-fault-banner {
  font-size: 10.5px;
  color: #f59e0b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tls-prob-chev {
  font-size: 11px;
  transition: transform 0.16s ease;
}
.tls-prob-chev.is-open {
  transform: rotate(180deg);
}

.tls-problems-list {
  max-height: 128px;
  overflow-y: auto;
  border-top: 1px solid var(--vp-c-divider);
  padding: 4px 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tls-prob-empty {
  padding: 6px 4px;
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.tls-prob-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
}
.tls-prob-item:hover {
  background: var(--vp-c-bg-soft);
}

.tls-prob-sev {
  padding: 1px 4px;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 700;
  flex-shrink: 0;
}
.tls-prob-sev[data-sev="1"] {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}
.tls-prob-sev[data-sev="2"] {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}

.tls-prob-loc,
.tls-prob-code {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.tls-prob-msg {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--vp-c-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tls-fix-btn {
  padding: 1px 7px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 50%, transparent);
  background: var(--ms-brand-soft);
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .tls-telemetry,
  .tls-hud-hint {
    display: none;
  }
  .tls-flow-grid {
    grid-template-columns: 1fr;
  }
  .tls-flow-arrow {
    display: none;
  }
}
</style>
