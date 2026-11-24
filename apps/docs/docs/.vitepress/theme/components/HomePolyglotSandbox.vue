<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useData } from "vitepress";
import { useAnsatzOrigin } from "../util/ansatz.js";
import {
  closeDocsLspBuffer,
  getCodeActionsDocsLsp,
  getDiagramDataDocsLsp,
  onLspDiagnostics,
  onLspStatus,
  syncDocsLspBuffer,
  verifyAllDocsLsp,
  type LspDiagnostic,
  type LspWorkerStatus,
} from "../util/docs-lsp-client.js";
import {
  buildMorselHandoffUrl,
  detectPolyglotLanguage,
  injectRealisticFault,
  type DetectedLanguageMatch,
} from "../util/polyglot-paste-detector.js";
import type { SandboxMonacoHandle } from "../util/sandbox-monaco.js";
import { hasDiagramElements, type SandboxDiagramHandle } from "../util/sandbox-diagram.js";
import languageExamplesUrl from "../data/language-examples.generated.json?url";
import languagesData from "../data/languages.generated.json";
import MsIcon from "./MsIcon.vue";

interface LanguageMeta {
  slug: string;
  name: string;
  ext: string;
  tier: string;
  group?: string;
  ruleCount?: number;
  role?: string;
}

interface SandboxTab {
  id: string;
  uri: string;
  langSlug: string;
  fileName: string;
  code: string;
}

interface ScopedDiagnosticEntry {
  tab: SandboxTab;
  diag: LspDiagnostic;
  key: string;
}

const GROUP_TITLES: Record<string, string> = {
  core: "Core Systems & Multi-Physics",
  integration: "Systems Exchange, Controls & ReqIF",
  geometry: "3D CAD, CAE Mesh & Metrology",
  electronics: "Electrical Circuits, RF & Semiconductors",
  power: "Power Grids & Energy Markets",
  aerospace: "Aerospace & Flight Dynamics",
  automotive: "Automotive & Autonomy",
  robotics: "Robotics & Biomechanics",
  rail: "Rail & Transit",
  marine: "Marine & Offshore",
  "oil-gas": "Subsurface, Oil & Gas",
  nuclear: "Nuclear & Thermal-Hydraulics",
  process: "Chemical Process & Water Infrastructure",
  buildings: "Buildings & HVAC",
  "life-sciences": "Chemistry, Systems Biology & Medical",
};

const { ansatzOrigin } = useAnsatzOrigin();

const allLanguages = computed(() =>
  [...(languagesData as LanguageMeta[])].sort((a, b) => a.name.localeCompare(b.name)),
);

const langFilter = ref("");
const filteredLanguages = computed(() => {
  const q = langFilter.value.trim().toLowerCase();
  if (!q) return allLanguages.value;
  return allLanguages.value.filter(
    (l) =>
      l.name.toLowerCase().includes(q) ||
      l.slug.toLowerCase().includes(q) ||
      l.ext.toLowerCase().includes(q) ||
      (l.role ?? "").toLowerCase().includes(q),
  );
});

const groupedFilteredLanguages = computed(() => {
  const byGroup = new Map<string, LanguageMeta[]>();
  for (const lang of filteredLanguages.value) {
    const g = lang.group || "core";
    const list = byGroup.get(g) ?? [];
    list.push(lang);
    byGroup.set(g, list);
  }
  return Array.from(byGroup.entries()).map(([group, items]) => ({
    group,
    title: GROUP_TITLES[group] ?? group,
    items,
  }));
});

interface LanguageExampleEntry {
  slug: string;
  ext: string;
  filename: string;
  code: string;
  svgDark?: string;
  svgLight?: string;
  viewLabel?: string;
}

const examplesBySlug = shallowRef(new Map<string, LanguageExampleEntry>());
let examplesLoadPromise: Promise<void> | null = null;

function ensureLanguageExamplesLoaded(): Promise<void> {
  if (examplesBySlug.value.size > 0) return Promise.resolve();
  if (!examplesLoadPromise) {
    examplesLoadPromise = fetch(languageExamplesUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<LanguageExampleEntry[]>;
      })
      .then((list) => {
        const nextMap = new Map<string, LanguageExampleEntry>();
        for (const ex of list) {
          nextMap.set(ex.slug, ex);
        }
        examplesBySlug.value = nextMap;
        // Populate any unedited placeholder tabs with the loaded example code
        for (let i = 0; i < tabs.value.length; i++) {
          const tab = tabs.value[i]!;
          if (!tab.code.startsWith("// Paste ")) continue;
          const ex = nextMap.get(tab.langSlug);
          if (!ex?.code) continue;
          const oldUri = tab.uri;
          tab.fileName = ex.filename || tab.fileName;
          tab.code = ex.code;
          tab.uri = `file:///sandbox/${i + 1}_${tab.fileName}`;
          if (monacoHandle) {
            if (oldUri !== tab.uri) monacoHandle.removeModel(oldUri);
            if (tab.id === activeTabId.value) {
              monacoHandle.switchTab(tab.uri, tab.code, tab.langSlug);
            }
          }
        }
        if (hasBooted) {
          void syncTabsAndLint();
        }
      })
      .catch(() => {
        examplesLoadPromise = null;
      });
  }
  return examplesLoadPromise;
}

function makePrimaryExt(rawExt: string): string {
  return (rawExt.split(",")[0] ?? ".txt").trim();
}

let nextTabSeq = 1;

function createTabForLang(slug: string, idx: number, customCode?: string, customFileName?: string): SandboxTab {
  const meta = allLanguages.value.find((l) => l.slug === slug) ?? allLanguages.value[0]!;
  const ex = examplesBySlug.value.get(meta.slug);
  const ext = makePrimaryExt(meta.ext);
  const fileName = customFileName || ex?.filename || `model_${idx}${ext}`;
  const code = customCode ?? ex?.code ?? `// Paste ${meta.name} (${ext}) model here\n`;
  return {
    id: `tab-${idx}-${nextTabSeq++}`,
    uri: `file:///sandbox/${idx}_${fileName}`,
    langSlug: meta.slug,
    fileName,
    code,
  };
}

function diagnosticKey(uri: string, d: LspDiagnostic): string {
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

const tabs = ref<SandboxTab[]>([createTabForLang("modelica", 1)]);
const activeTabId = ref<string>(tabs.value[0]!.id);
const diagnosticsByUri = ref<Record<string, LspDiagnostic[]>>({});
const quickFixByDiagKey = ref<Record<string, { title: string; changes: Record<string, any[]> }>>({});
const diagScope = ref<"all" | "active">("all");
const rightPaneView = ref<"both" | "diagnostics" | "diagram">("both");
const hasLiveDiagram = ref(false);
const liveDiagramMeta = ref<{ nodeCount: number; edgeCount: number } | null>(null);
const diagramLoading = ref(false);
const diagramContainerRef = ref<HTMLElement | null>(null);
let diagramHandle: SandboxDiagramHandle | null = null;
let diagramRequestToken = 0;
const showAllStages = ref(false);
const workerStatus = ref<LspWorkerStatus>({ state: "idle" });
const workerError = ref<string | null>(null);
const verifying = ref(false);
const verifyResult = ref<any>(null);
const detectedHint = ref<(DetectedLanguageMatch & { targetName: string }) | null>(null);
const faultBanner = ref<string | null>(null);
const { isDark } = useData();
const copiedLink = ref(false);
const isDragActive = ref(false);
const sandboxSectionRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const useMonacoMode = ref(true);
const monacoLoading = ref(false);
const monacoContainerRef = ref<HTMLElement | null>(null);
let monacoHandle: SandboxMonacoHandle | null = null;
let intersectionObserver: IntersectionObserver | null = null;
let hasBooted = false;

const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? tabs.value[0]!);
const activeLangMeta = computed(
  () => allLanguages.value.find((l) => l.slug === activeTab.value.langSlug) ?? allLanguages.value[0]!,
);
const activeDiagnostics = computed(() => diagnosticsByUri.value[activeTab.value.uri] ?? []);
const allScopedDiagnostics = computed<ScopedDiagnosticEntry[]>(() => {
  const out: ScopedDiagnosticEntry[] = [];
  for (const tab of tabs.value) {
    for (const diag of diagnosticsByUri.value[tab.uri] ?? []) {
      out.push({ tab, diag, key: diagnosticKey(tab.uri, diag) });
    }
  }
  return out;
});
const visibleDiagnostics = computed<ScopedDiagnosticEntry[]>(() =>
  diagScope.value === "active"
    ? activeDiagnostics.value.map((diag) => ({
        tab: activeTab.value,
        diag,
        key: diagnosticKey(activeTab.value.uri, diag),
      }))
    : allScopedDiagnostics.value,
);
const totalDiagCount = computed(() => allScopedDiagnostics.value.length);

const stageSummary = computed(() => {
  const stages = verifyResult.value?.stages as Record<string, any> | undefined;
  if (!stages) return null;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const st of Object.values(stages)) {
    if (st?.passed === false) failed++;
    else if (st?.status === "skipped") skipped++;
    else passed++;
  }
  return { passed, failed, skipped, total: passed + failed + skipped };
});

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let codeActionRefreshToken = 0;
let stopDiagListening: (() => void) | null = null;
let stopStatusListening: (() => void) | null = null;

async function initMonacoEditor(): Promise<void> {
  if (monacoHandle || monacoLoading.value) return;
  monacoLoading.value = true;
  try {
    await nextTick();
    if (!monacoContainerRef.value) return;
    const { mountSandboxMonaco } = await import("../util/sandbox-monaco.js");
    monacoHandle = await mountSandboxMonaco({
      container: monacoContainerRef.value,
      initialUri: activeTab.value.uri,
      initialCode: activeTab.value.code,
      langSlug: activeTab.value.langSlug,
      isDark: isDark.value,
      onChange: (nextCode) => onCodeInput(nextCode),
      onPaste: () => onEditorPaste(),
    });
    for (const tab of tabs.value) {
      const diags = diagnosticsByUri.value[tab.uri];
      if (diags) monacoHandle.setDiagnostics(tab.uri, diags);
    }
  } catch (err: any) {
    workerError.value = `Failed to load Monaco Editor: ${err?.message || String(err)}`;
    useMonacoMode.value = false;
  } finally {
    monacoLoading.value = false;
  }
}

const activeExampleMeta = computed(() => examplesBySlug.value.get(activeTab.value.langSlug));

async function refreshDiagramPreview(): Promise<void> {
  const tab = activeTab.value;
  const token = ++diagramRequestToken;
  diagramLoading.value = true;
  try {
    const data = await getDiagramDataDocsLsp(tab.uri, tab.langSlug, tab.code);
    if (token !== diagramRequestToken) return;
    if (!hasDiagramElements(data)) {
      hasLiveDiagram.value = false;
      liveDiagramMeta.value = null;
      return;
    }
    hasLiveDiagram.value = true;
    await nextTick();
    if (token !== diagramRequestToken) return;
    if (!diagramContainerRef.value) return;
    if (!diagramHandle) {
      const { mountSandboxDiagram } = await import("../util/sandbox-diagram.js");
      if (token !== diagramRequestToken || !diagramContainerRef.value) return;
      diagramHandle = await mountSandboxDiagram(diagramContainerRef.value, isDark.value);
    }
    liveDiagramMeta.value = diagramHandle.render(data, isDark.value, tab.langSlug);
  } catch {
    if (token === diagramRequestToken) {
      hasLiveDiagram.value = false;
      liveDiagramMeta.value = null;
    }
  } finally {
    if (token === diagramRequestToken) {
      diagramLoading.value = false;
    }
  }
}

watch(
  () => [activeTab.value.id, activeTab.value.uri, activeTab.value.langSlug] as const,
  ([, nextUri, nextSlug]) => {
    hasLiveDiagram.value = false;
    liveDiagramMeta.value = null;
    if (hasBooted) {
      void refreshDiagramPreview();
    }
    if (!monacoHandle) return;
    monacoHandle.switchTab(nextUri, activeTab.value.code, nextSlug);
    const diags = diagnosticsByUri.value[nextUri];
    if (diags) monacoHandle.setDiagnostics(nextUri, diags);
  },
);

watch(
  () => activeTab.value.code,
  (nextCode) => {
    if (!monacoHandle) return;
    monacoHandle.setValue(nextCode);
  },
);

watch(isDark, (dark) => {
  monacoHandle?.setTheme(dark);
  diagramHandle?.setTheme(dark);
});

watch(rightPaneView, async () => {
  await nextTick();
  diagramHandle?.resize();
});

async function refreshQuickFixesForUri(uri: string, diags: LspDiagnostic[]): Promise<void> {
  const token = ++codeActionRefreshToken;
  const nextFixes: Record<string, { title: string; changes: Record<string, any[]> }> = {};
  const uriPrefix = `${uri}:`;
  for (const [k, v] of Object.entries(quickFixByDiagKey.value)) {
    if (!k.startsWith(uriPrefix)) nextFixes[k] = v;
  }
  if (diags.length === 0) {
    quickFixByDiagKey.value = nextFixes;
    return;
  }
  for (const d of diags.slice(0, 8)) {
    const actions = await getCodeActionsDocsLsp(uri, d.range, [d]).catch(() => []);
    if (token !== codeActionRefreshToken) return;
    const fix = actions.find((a) => a?.edit?.changes);
    if (fix?.edit?.changes) {
      nextFixes[diagnosticKey(uri, d)] = {
        title: String(fix.title || "Apply QuickFix"),
        changes: fix.edit.changes,
      };
    }
  }
  quickFixByDiagKey.value = nextFixes;
}

function bootSandbox(): void {
  if (hasBooted) return;
  hasBooted = true;
  void ensureLanguageExamplesLoaded();
  void initMonacoEditor();
  void syncTabsAndLint();
}

onMounted(() => {
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

  if (typeof IntersectionObserver !== "undefined" && sandboxSectionRef.value) {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          bootSandbox();
          intersectionObserver?.disconnect();
          intersectionObserver = null;
        }
      },
      { rootMargin: "250px" },
    );
    intersectionObserver.observe(sandboxSectionRef.value);
  } else {
    bootSandbox();
  }
});

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  stopDiagListening?.();
  stopStatusListening?.();
  monacoHandle?.dispose();
  monacoHandle = null;
  diagramHandle?.dispose();
  diagramHandle = null;
});

async function syncTabsAndLint(): Promise<void> {
  workerError.value = null;
  try {
    for (const tab of tabs.value) {
      await syncDocsLspBuffer(tab.uri, tab.langSlug, tab.code);
    }
    monacoHandle?.refreshSemanticTokens();
    void refreshDiagramPreview();
  } catch (err: any) {
    workerError.value = err?.message || String(err);
  }
}

function scheduleLint(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void syncTabsAndLint();
  }, 300);
}

async function switchTabLanguage(tab: SandboxTab, newSlug: string, keepExistingCode: boolean): Promise<void> {
  const meta = allLanguages.value.find((l) => l.slug === newSlug);
  if (!meta) return;
  if (!keepExistingCode) {
    await ensureLanguageExamplesLoaded();
  }
  const oldUri = tab.uri;
  const ex = examplesBySlug.value.get(meta.slug);
  const ext = makePrimaryExt(meta.ext);
  const tabIdx = Math.max(0, tabs.value.indexOf(tab)) + 1;
  tab.langSlug = meta.slug;
  if (!keepExistingCode) {
    tab.fileName = ex?.filename || `model_${tabIdx}${ext}`;
    tab.code = ex?.code || `// Paste ${meta.name} (${ext}) model here\n`;
  } else {
    const stem = tab.fileName.includes(".") ? tab.fileName.slice(0, tab.fileName.lastIndexOf(".")) : tab.fileName;
    tab.fileName = `${stem}${ext}`;
  }
  tab.uri = `file:///sandbox/${tabIdx}_${tab.fileName}`;
  if (oldUri !== tab.uri) {
    monacoHandle?.removeModel(oldUri);
    await closeDocsLspBuffer(oldUri);
    const next = { ...diagnosticsByUri.value };
    delete next[oldUri];
    diagnosticsByUri.value = next;
  }
  verifyResult.value = null;
  detectedHint.value = null;
  faultBanner.value = null;
}

async function onLanguageChange(newSlug: string): Promise<void> {
  await switchTabLanguage(activeTab.value, newSlug, false);
  await syncTabsAndLint();
}

function onCodeInput(val: string): void {
  activeTab.value.code = val;
  faultBanner.value = null;
  scheduleLint();
}

function onEditorPaste(): void {
  setTimeout(() => {
    const code = activeTab.value.code;
    const match = detectPolyglotLanguage(code, activeTab.value.fileName);
    if (match && match.slug !== activeTab.value.langSlug) {
      const meta = allLanguages.value.find((l) => l.slug === match.slug);
      if (meta) {
        detectedHint.value = { ...match, targetName: meta.name };
      }
    } else {
      detectedHint.value = null;
    }
  }, 20);
}

async function acceptDetectedLanguage(): Promise<void> {
  if (!detectedHint.value) return;
  await switchTabLanguage(activeTab.value, detectedHint.value.slug, true);
  await runVerifyAll();
}

async function onDropFiles(ev: DragEvent): Promise<void> {
  isDragActive.value = false;
  const dropped = Array.from(ev.dataTransfer?.files ?? []);
  if (dropped.length === 0) return;

  const newTabs: SandboxTab[] = [];
  let idx = tabs.value.length + 1;
  for (const file of dropped.slice(0, 8)) {
    if (file.size > 1024 * 1024) continue;
    const text = await file.text();
    const match = detectPolyglotLanguage(text, file.name);
    const slug = match?.slug ?? activeTab.value.langSlug;
    newTabs.push(createTabForLang(slug, idx++, text, file.name));
  }
  if (newTabs.length > 0) {
    tabs.value.push(...newTabs);
    activeTabId.value = newTabs[0]!.id;
    await runVerifyAll();
  }
}

function addCrossFileTab(): void {
  const idx = tabs.value.length + 1;
  const nextSlug = tabs.value.some((t) => t.langSlug === "spice") ? "sysml2" : "spice";
  const tab = createTabForLang(nextSlug, idx);
  tabs.value.push(tab);
  activeTabId.value = tab.id;
  void syncTabsAndLint();
}

async function removeTab(tabId: string): Promise<void> {
  if (tabs.value.length <= 1) return;
  const idx = tabs.value.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  const [removed] = tabs.value.splice(idx, 1);
  if (removed) {
    monacoHandle?.removeModel(removed.uri);
    await closeDocsLspBuffer(removed.uri);
    const next = { ...diagnosticsByUri.value };
    delete next[removed.uri];
    diagnosticsByUri.value = next;
  }
  if (activeTabId.value === tabId) {
    activeTabId.value = tabs.value[Math.max(0, idx - 1)]!.id;
  }
  await runVerifyAll();
}

async function loadPolyglotTwinPreset(): Promise<void> {
  for (const t of tabs.value) {
    monacoHandle?.removeModel(t.uri);
    await closeDocsLspBuffer(t.uri);
  }
  diagnosticsByUri.value = {};
  verifyResult.value = null;
  detectedHint.value = null;
  faultBanner.value = null;
  const sysmlTab: SandboxTab = {
    id: `tab-sysml-${Date.now()}`,
    uri: "file:///sandbox/PowerSupply.sysml",
    langSlug: "sysml2",
    fileName: "PowerSupply.sysml",
    code: `package PowerSupply {
  part def FilterStage {
    attribute v_out = 5.0 [V];
    attribute r_series = 1000 [Ohm];
  }
}`,
  };
  const spiceTab: SandboxTab = {
    id: `tab-spice-${Date.now() + 1}`,
    uri: "file:///sandbox/FilterStage.sp",
    langSlug: "spice",
    fileName: "FilterStage.sp",
    code: `* @twin: v_out <-> PowerSupply::FilterStage.v_out
* @twin: R1 <-> PowerSupply::FilterStage.r_series
* @unit: v_out = mV
.param v_out=3300
V1 in 0 5
R1 in out 1k
R2 out 0 1k`,
  };
  tabs.value = [sysmlTab, spiceTab];
  activeTabId.value = spiceTab.id;
  await runVerifyAll();
}

async function onInjectFault(): Promise<void> {
  const res = injectRealisticFault(activeTab.value.langSlug, activeTab.value.code);
  activeTab.value.code = res.code;
  faultBanner.value = res.label;
  await runVerifyAll();
}

async function runVerifyAll(): Promise<void> {
  verifying.value = true;
  workerError.value = null;
  try {
    await syncTabsAndLint();
    verifyResult.value = await verifyAllDocsLsp(activeTab.value.uri);
  } catch (err: any) {
    if (err?.message !== "SUPERSEDED") {
      workerError.value = err?.message || String(err);
    }
  } finally {
    verifying.value = false;
  }
}

function applyLspWorkspaceChanges(changes: Record<string, any[]>): void {
  for (const [uri, textEdits] of Object.entries(changes)) {
    const targetTab = tabs.value.find((t) => t.uri === uri);
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
  }
}

async function applyDiagnosticQuickFix(changes: Record<string, any[]>): Promise<void> {
  applyLspWorkspaceChanges(changes);
  quickFixByDiagKey.value = {};
  await runVerifyAll();
}

async function applySuggestedQuickFix(): Promise<void> {
  const thread = verifyResult.value?.polyglotDigitalThread;
  const edits: Array<{ uri?: string; fileName?: string; startOffset?: number; endOffset?: number; newText: string }> =
    Array.isArray(thread?.suggestedEdits) ? thread.suggestedEdits : [];

  if (edits.length > 0) {
    // Group and sort descending by startOffset per tab so multiple edits in one file never shift offsets
    const grouped = new Map<SandboxTab, typeof edits>();
    for (const se of edits) {
      const targetTab = tabs.value.find((t) => t.uri === se.uri || t.fileName === se.fileName);
      if (targetTab && se.startOffset !== undefined && se.endOffset !== undefined) {
        const list = grouped.get(targetTab) ?? [];
        list.push(se);
        grouped.set(targetTab, list);
      }
    }
    for (const [targetTab, list] of grouped.entries()) {
      const sorted = [...list].sort((a, b) => b.startOffset! - a.startOffset!);
      let nextCode = targetTab.code;
      for (const se of sorted) {
        nextCode = nextCode.slice(0, se.startOffset!) + se.newText + nextCode.slice(se.endOffset!);
      }
      targetTab.code = nextCode;
    }
    await runVerifyAll();
    return;
  }

  const diags = activeDiagnostics.value;
  if (diags.length > 0) {
    const actions = await getCodeActionsDocsLsp(activeTab.value.uri, diags[0]!.range, diags);
    const fix = actions.find((a) => a?.edit?.changes);
    if (fix?.edit?.changes) {
      applyLspWorkspaceChanges(fix.edit.changes);
      await runVerifyAll();
    }
  }
}

async function revealDiagnosticLocation(entry: ScopedDiagnosticEntry): Promise<void> {
  if (activeTabId.value !== entry.tab.id) {
    activeTabId.value = entry.tab.id;
    await nextTick();
  }
  if (useMonacoMode.value && monacoHandle) {
    monacoHandle.revealRange(
      entry.diag.range.start.line,
      entry.diag.range.start.character,
      entry.diag.range.end.line,
      entry.diag.range.end.character,
    );
    return;
  }
  const el = textareaRef.value;
  if (!el) return;
  const code = entry.tab.code;
  let startOff = posToOffset(code, entry.diag.range.start);
  let endOff = posToOffset(code, entry.diag.range.end);
  if (endOff <= startOff) endOff = Math.min(code.length, startOff + 1);

  el.focus();
  el.setSelectionRange(startOff, endOff);
  const lineHeight = 19.5;
  el.scrollTop = Math.max(0, entry.diag.range.start.line * lineHeight - el.clientHeight / 3);
}

async function openInMorselWithState(): Promise<void> {
  const activeIdx = Math.max(0, tabs.value.findIndex((t) => t.id === activeTab.value.id));
  const url = await buildMorselHandoffUrl(ansatzOrigin.value, tabs.value, activeIdx);
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyMorselLink(): Promise<void> {
  const activeIdx = Math.max(0, tabs.value.findIndex((t) => t.id === activeTab.value.id));
  const url = await buildMorselHandoffUrl(ansatzOrigin.value, tabs.value, activeIdx);
  try {
    await navigator.clipboard?.writeText(url);
    copiedLink.value = true;
    setTimeout(() => {
      copiedLink.value = false;
    }, 2000);
  } catch {
    // Clipboard unavailable in insecure context
  }
}

function severityLabel(sev?: number): string {
  if (sev === 1) return "Error";
  if (sev === 2) return "Warning";
  return "Info";
}
</script>

<template>
  <section id="polyglot-sandbox" ref="sandboxSectionRef" class="sandbox-section">
    <div class="sandbox-container">
      <div class="sandbox-header">
        <div>
          <span class="sandbox-eyebrow">Live In-Browser WASM LSP · {{ allLanguages.length }} Languages · Runs 100% Locally</span>
          <h2 class="sandbox-title">Paste Any Engineering Model. Lint &amp; Verify in Your Browser.</h2>
          <p class="sandbox-subtitle">
            Powered by <code>@modelscript/lsp</code> WebAssembly GLR parsers, <code>CompilerLint</code> rules, and the
            cross-file <code>SemanticTheoryCoordinator</code> — your models never leave your browser.
          </p>
        </div>
        <div class="sandbox-header-actions">
          <button type="button" class="sb-btn sb-btn-ghost" @click="loadPolyglotTwinPreset">
            <MsIcon name="workflow" :size="14" />
            <span>Load SysML + SPICE Twin Demo</span>
          </button>
          <button type="button" class="sb-btn sb-btn-ghost" @click="copyMorselLink">
            <MsIcon name="copy" :size="14" />
            <span>{{ copiedLink ? "Copied Link!" : "Copy Share Link" }}</span>
          </button>
          <button type="button" class="sb-btn sb-btn-outline" @click="openInMorselWithState">
            <span>Open in Ansatz</span>
            <MsIcon name="arrow-up-right" :size="14" />
          </button>
        </div>
      </div>

      <div
        class="sandbox-card"
        :class="{ 'is-dragging': isDragActive }"
        @dragover.prevent="isDragActive = true"
        @dragleave.prevent="isDragActive = false"
        @drop.prevent="onDropFiles"
      >
        <!-- Toolbar -->
        <div class="sb-toolbar">
          <div class="sb-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              class="sb-tab"
              :class="{ active: tab.id === activeTab.id }"
              @click="activeTabId = tab.id"
            >
              <span class="sb-tab-name">{{ tab.fileName }}</span>
              <span
                v-if="(diagnosticsByUri[tab.uri]?.length ?? 0) > 0"
                class="sb-tab-badge"
              >
                {{ diagnosticsByUri[tab.uri]!.length }}
              </span>
              <span
                v-if="tabs.length > 1"
                class="sb-tab-close"
                role="button"
                aria-label="Close tab"
                @click.stop="removeTab(tab.id)"
              >×</span>
            </button>
            <button type="button" class="sb-tab sb-tab-add" @click="addCrossFileTab">
              + Add Cross-File Tab
            </button>
          </div>

          <div class="sb-controls">
            <div class="sb-lang-picker">
              <input
                v-model="langFilter"
                type="search"
                :placeholder="`Filter ${allLanguages.length} languages…`"
                aria-label="Filter languages"
                class="sb-filter-input"
              />
              <select
                :value="activeTab.langSlug"
                aria-label="Select engineering language"
                class="sb-select"
                @change="onLanguageChange(($event.target as HTMLSelectElement).value)"
              >
                <optgroup v-for="grp in groupedFilteredLanguages" :key="grp.group" :label="grp.title">
                  <option v-for="lang in grp.items" :key="lang.slug" :value="lang.slug">
                    {{ lang.name }} ({{ lang.ext.split(",")[0] }}) — {{ lang.tier }}
                  </option>
                </optgroup>
              </select>
            </div>
            <button type="button" class="sb-btn sb-btn-ghost" title="Inject a syntax or digital-thread fault" @click="onInjectFault">
              <span>Inject Fault</span>
            </button>
            <button type="button" class="sb-btn sb-btn-primary" :disabled="verifying" @click="runVerifyAll">
              <MsIcon name="shield" :size="14" />
              <span>{{ verifying ? "Verifying…" : "Lint & Verify All" }}</span>
            </button>
          </div>
        </div>

        <!-- Paste Auto-Detect or Fault Banner -->
        <div v-if="detectedHint" class="sb-hint-bar">
          <span>
            Detected <strong>{{ detectedHint.targetName }}</strong> ({{ detectedHint.reason }}).
          </span>
          <button type="button" class="sb-fix-btn" @click="acceptDetectedLanguage">
            Switch to {{ detectedHint.targetName }} &amp; Verify
          </button>
        </div>
        <div v-else-if="faultBanner" class="sb-hint-bar sb-hint-warn">
          <span>{{ faultBanner }}</span>
        </div>

        <!-- Split Editor + Verification Output -->
        <div class="sb-body">
          <div class="sb-editor-pane">
            <div class="sb-pane-meta">
              <span class="sb-meta-title">{{ activeLangMeta.name }} · {{ activeLangMeta.role }}</span>
              <div class="sb-pane-meta-right">
                <span>{{ activeLangMeta.ruleCount ?? 0 }} lint rules</span>
                <span class="sb-worker-pill" :class="`state-${workerStatus.state}`">
                  <span class="sb-worker-dot" />
                  {{ workerStatus.state }}
                </span>
              </div>
            </div>
            <div
              v-if="useMonacoMode"
              ref="monacoContainerRef"
              class="sb-monaco-host"
              aria-label="Monaco polyglot editor"
            >
              <div v-if="monacoLoading" class="sb-monaco-loading">Loading Monaco + WASM LSP…</div>
            </div>
            <textarea
              v-else
              ref="textareaRef"
              :value="activeTab.code"
              class="sb-textarea"
              spellcheck="false"
              aria-label="Polyglot model source code"
              @input="onCodeInput(($event.target as HTMLTextAreaElement).value)"
              @paste="onEditorPaste"
            />
          </div>

          <div class="sb-results-pane">
            <div class="sb-pane-meta">
              <div class="sb-results-heading">
                <div class="sb-scope-toggle" role="tablist" aria-label="Results pane view">
                  <button
                    type="button"
                    role="tab"
                    class="sb-scope-btn"
                    :class="{ active: rightPaneView === 'both' }"
                    :aria-selected="rightPaneView === 'both'"
                    @click="rightPaneView = 'both'"
                  >
                    Both
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="sb-scope-btn"
                    :class="{ active: rightPaneView === 'diagnostics' }"
                    :aria-selected="rightPaneView === 'diagnostics'"
                    @click="rightPaneView = 'diagnostics'"
                  >
                    Diagnostics ({{ totalDiagCount }})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="sb-scope-btn"
                    :class="{ active: rightPaneView === 'diagram' }"
                    :aria-selected="rightPaneView === 'diagram'"
                    @click="rightPaneView = 'diagram'"
                  >
                    Diagram
                  </button>
                </div>
                <div v-if="tabs.length > 1 && rightPaneView !== 'diagram'" class="sb-scope-toggle" role="group" aria-label="Diagnostic file scope">
                  <button
                    type="button"
                    class="sb-scope-btn"
                    :class="{ active: diagScope === 'all' }"
                    @click="diagScope = 'all'"
                  >
                    All Tabs ({{ totalDiagCount }})
                  </button>
                  <button
                    type="button"
                    class="sb-scope-btn"
                    :class="{ active: diagScope === 'active' }"
                    @click="diagScope = 'active'"
                  >
                    Active ({{ activeDiagnostics.length }})
                  </button>
                </div>
              </div>
              <button
                v-if="verifyResult?.polyglotDigitalThread?.suggestedEdits?.length"
                type="button"
                class="sb-fix-btn"
                :disabled="verifying"
                @click="applySuggestedQuickFix"
              >
                Apply Digital Thread QuickFix ({{ verifyResult.polyglotDigitalThread.suggestedEdits.length }})
              </button>
            </div>

            <div class="sb-results-scroll">
              <template v-if="rightPaneView !== 'diagram'">
                <div v-if="workerError" class="sb-alert sb-alert-err">
                  Worker error: {{ workerError }}
                </div>

                <div v-if="verifyResult?.polyglotDigitalThread" class="sb-thread-box" :class="verifyResult.polyglotDigitalThread.isSat ? 'is-sat' : 'is-unsat'">
                  <div class="sb-thread-top">
                    <strong>Digital Thread: {{ verifyResult.polyglotDigitalThread.status }}</strong>
                    <span>{{ verifyResult.polyglotDigitalThread.fileCount }} files · {{ (verifyResult.polyglotDigitalThread.domains || []).join(", ") }}</span>
                  </div>
                  <p class="sb-thread-summary">{{ verifyResult.polyglotDigitalThread.summaryText }}</p>
                  <ul v-if="verifyResult.polyglotDigitalThread.conflicts?.length" class="sb-conflict-list">
                    <li v-for="(c, idx) in verifyResult.polyglotDigitalThread.conflicts" :key="idx">
                      <strong>[{{ c.theoryName }}]</strong> {{ c.explanation }}
                    </li>
                  </ul>
                </div>

                <div v-if="visibleDiagnostics.length === 0 && !verifyResult && !hasLiveDiagram" class="sb-empty">
                  Edit or drop any model, click <strong>Inject Fault</strong>, or click <strong>Lint &amp; Verify All</strong> to run {{ allLanguages.length }}+ language WASM checks.
                </div>

                <div v-else-if="visibleDiagnostics.length === 0 && (verifyResult || workerStatus.state === 'ready')" class="sb-alert sb-alert-ok">
                  No syntax or semantic lint errors in <code>{{ diagScope === "all" ? "open tabs" : activeTab.fileName }}</code>.
                </div>

                <ul v-else-if="visibleDiagnostics.length > 0" class="sb-diag-list">
                  <li
                    v-for="(entry, idx) in visibleDiagnostics"
                    :key="entry.key + ':' + idx"
                    class="sb-diag-item"
                    :class="`sev-${entry.diag.severity ?? 1}`"
                    title="Click to jump to diagnostic location"
                    @click="revealDiagnosticLocation(entry)"
                  >
                    <div class="sb-diag-head">
                      <span class="sb-diag-badge">{{ severityLabel(entry.diag.severity) }}</span>
                      <span v-if="tabs.length > 1" class="sb-diag-file">{{ entry.tab.fileName }}</span>
                      <code v-if="entry.diag.code" class="sb-diag-code">{{ entry.diag.code }}</code>
                      <span class="sb-diag-loc">L{{ entry.diag.range.start.line + 1 }}:{{ entry.diag.range.start.character + 1 }}</span>
                      <button
                        v-if="quickFixByDiagKey[entry.key]"
                        type="button"
                        class="sb-inline-fix"
                        @click.stop="applyDiagnosticQuickFix(quickFixByDiagKey[entry.key]!.changes)"
                      >
                        {{ quickFixByDiagKey[entry.key]!.title }}
                      </button>
                    </div>
                    <span class="sb-diag-msg">{{ entry.diag.message }}</span>
                  </li>
                </ul>

                <div v-if="verifyResult?.stages && stageSummary" class="sb-stages-wrap">
                  <button type="button" class="sb-stages-toggle" @click="showAllStages = !showAllStages">
                    <span>
                      Verification stages:
                      <strong class="st-pass">{{ stageSummary.passed }} passed</strong>
                      <template v-if="stageSummary.failed > 0">
                        · <strong class="st-fail">{{ stageSummary.failed }} failed</strong>
                      </template>
                      <template v-if="stageSummary.skipped > 0">
                        · <span class="st-skip">{{ stageSummary.skipped }} skipped</span>
                      </template>
                    </span>
                    <span>{{ showAllStages ? "Hide ▴" : "Details ▾" }}</span>
                  </button>
                  <div v-if="showAllStages" class="sb-stages">
                    <div
                      v-for="(st, name) in verifyResult.stages"
                      :key="name"
                      class="sb-stage-pill"
                      :class="st?.passed === false ? 'fail' : st?.status === 'skipped' ? 'skip' : 'pass'"
                    >
                      <span>{{ name }}</span>
                      <span>{{ st?.status ?? (st?.passed === false ? "failed" : "passed") }}</span>
                    </div>
                  </div>
                </div>
              </template>

              <div
                v-if="rightPaneView === 'diagram' || (rightPaneView === 'both' && (hasLiveDiagram || diagramLoading))"
                class="sb-diagram-card"
                :class="{ 'is-full': rightPaneView === 'diagram' }"
              >
                <div class="sb-diagram-head">
                  <span class="sb-diagram-title">{{ activeExampleMeta?.viewLabel || `${activeLangMeta.name} Diagram` }}</span>
                  <div class="sb-diagram-actions">
                    <span v-if="diagramLoading" class="sb-diagram-meta">Rendering…</span>
                    <span v-else-if="liveDiagramMeta" class="sb-diagram-meta">
                      {{ liveDiagramMeta.nodeCount }} nodes · {{ liveDiagramMeta.edgeCount }} edges
                    </span>
                    <button
                      v-if="hasLiveDiagram"
                      type="button"
                      class="sb-scope-btn"
                      title="Fit diagram to view"
                      @click="diagramHandle?.zoomToFit()"
                    >
                      Fit
                    </button>
                  </div>
                </div>
                <div v-show="hasLiveDiagram" ref="diagramContainerRef" class="sb-diagram-stage" />
                <div v-if="!hasLiveDiagram" class="sb-empty">
                  {{ diagramLoading ? "Rendering live diagram from WASM LSP…" : `No graphical diagram elements in ${activeTab.fileName}.` }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sandbox-section {
  padding: 56px 24px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.sandbox-container {
  max-width: 1200px;
  margin: 0 auto;
}
.sandbox-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 24px;
}
.sandbox-eyebrow {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-brand-1);
  margin-bottom: 6px;
}
.sandbox-title {
  margin: 0 0 8px;
  font-size: 28px;
  line-height: 1.2;
}
.sandbox-subtitle {
  margin: 0;
  color: var(--vp-c-text-2);
  max-width: 680px;
}
.sandbox-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.sandbox-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  overflow: hidden;
  transition: border-color 0.15s ease;
}
.sandbox-card.is-dragging {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 2px var(--vp-c-brand-soft);
}
.sb-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}
.sb-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sb-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 13px;
  cursor: pointer;
}
.sb-tab.active {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.sb-tab-badge {
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.16);
  color: #ef4444;
  font-size: 11px;
}
.sb-tab-close {
  opacity: 0.7;
  padding-left: 2px;
}
.sb-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.sb-lang-picker {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  overflow: hidden;
}
.sb-filter-input {
  padding: 6px 10px;
  border: none;
  border-right: 1px solid var(--vp-c-divider);
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 13px;
  width: 170px;
  outline: none;
}
.sb-select {
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 13px;
  max-width: 235px;
  outline: none;
}
.sb-hint-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  background: var(--vp-c-brand-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}
.sb-hint-bar.sb-hint-warn {
  background: rgba(245, 158, 11, 0.12);
}
.sb-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  border: 1px solid transparent;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.sb-btn-primary {
  background: var(--ms-brand, #2563eb);
  color: #fff;
}
.sb-btn-primary:hover:not(:disabled) {
  background: var(--ms-brand-hover, #1d4ed8);
}
.sb-btn-primary:disabled {
  opacity: 0.65;
  cursor: wait;
}
.sb-btn-ghost {
  background: var(--vp-c-bg);
  border-color: var(--vp-c-divider);
  color: var(--vp-c-text-1);
}
.sb-btn-ghost:hover {
  border-color: var(--vp-c-brand-1);
}
.sb-btn-outline {
  background: transparent;
  border-color: var(--vp-c-divider);
  color: var(--vp-c-text-1);
}
.sb-btn-outline:hover {
  border-color: var(--vp-c-brand-1);
}
.sb-body {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  height: 460px;
}
.sb-editor-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--vp-c-divider);
}
.sb-results-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px 14px;
  gap: 10px;
}
.sb-results-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}
@media (max-width: 900px) {
  .sb-body {
    grid-template-columns: 1fr;
    height: auto;
  }
  .sb-editor-pane {
    border-right: none;
    border-bottom: 1px solid var(--vp-c-divider);
  }
  .sb-monaco-host {
    height: 340px;
  }
  .sb-results-pane {
    max-height: 420px;
  }
}
.sb-pane-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  flex-shrink: 0;
}
.sb-meta-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-results-pane .sb-pane-meta {
  padding: 0 0 8px;
}
.sb-textarea {
  flex: 1;
  width: 100%;
  min-height: 320px;
  padding: 12px 14px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.5;
}
.sb-fix-btn {
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.sb-thread-box {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  font-size: 13px;
}
.sb-thread-box.is-sat {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.08);
}
.sb-thread-box.is-unsat {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.08);
}
.sb-thread-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.sb-thread-summary {
  margin: 0;
  color: var(--vp-c-text-2);
}
.sb-conflict-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
}
.sb-diag-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-diag-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  font-size: 12px;
  cursor: pointer;
}
.sb-diag-item:hover {
  border-color: var(--vp-c-brand-1);
}
.sb-diag-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.sb-diag-msg {
  color: var(--vp-c-text-1);
  line-height: 1.4;
}
.sb-diag-badge {
  font-weight: 600;
  color: #ef4444;
}
.sb-diag-item.sev-2 .sb-diag-badge {
  color: #f59e0b;
}
.sb-diag-item.sev-3 .sb-diag-badge,
.sb-diag-item.sev-4 .sb-diag-badge {
  color: #38bdf8;
}
.sb-diag-loc {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}
.sb-alert {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.sb-alert-ok {
  background: rgba(34, 197, 94, 0.1);
  color: var(--vp-c-text-1);
}
.sb-alert-err {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}
.sb-empty {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.sb-stages-wrap {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--vp-c-divider);
}
.sb-stages-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 2px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 12px;
  cursor: pointer;
}
.sb-stages-toggle:hover {
  color: var(--vp-c-text-1);
}
.st-pass {
  color: #10b981;
}
.st-fail {
  color: #ef4444;
}
.st-skip {
  color: var(--vp-c-text-3);
}
.sb-stages {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.sb-stage-pill {
  display: inline-flex;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}
.sb-stage-pill.pass {
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.08);
  color: #34d399;
}
.sb-stage-pill.fail {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}
.sb-stage-pill.skip {
  opacity: 0.65;
}
.sb-results-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sb-scope-toggle {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
}
.sb-scope-btn {
  padding: 2px 8px;
  font-size: 11px;
  background: transparent;
  color: var(--vp-c-text-2);
  border: none;
  cursor: pointer;
}
.sb-scope-btn.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.sb-diag-file {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}
.sb-inline-fix {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.sb-inline-fix:hover {
  background: var(--ms-brand, #2563eb);
  border-color: var(--ms-brand, #2563eb);
  color: #fff;
}
.sb-pane-meta-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.sb-worker-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  font-size: 11px;
  text-transform: capitalize;
}
.sb-worker-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
}
.sb-worker-pill.state-ready .sb-worker-dot {
  background: #10b981;
}
.sb-worker-pill.state-booting .sb-worker-dot {
  background: #f59e0b;
}
.sb-worker-pill.state-error .sb-worker-dot {
  background: #ef4444;
}
.sb-monaco-host {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
}
.sb-monaco-loading {
  padding: 16px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
}
.sb-diagram-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg);
  flex-shrink: 0;
}
.sb-diagram-card.is-full {
  flex: 1;
  min-height: 0;
}
.sb-diagram-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.sb-diagram-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-diagram-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.sb-diagram-meta {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--vp-c-text-3);
}
.sb-diagram-stage {
  position: relative;
  width: 100%;
  height: 240px;
  overflow: hidden;
}
.sb-diagram-card.is-full .sb-diagram-stage {
  flex: 1;
  min-height: 280px;
  height: 100%;
}
</style>
