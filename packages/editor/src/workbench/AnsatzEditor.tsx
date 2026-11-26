// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applyOptimisticPropertyAction,
  DiagramActionQueue,
  isOptimisticDiagramActionBatch,
  SerializedDiagramEditRunner,
  type ComponentPropertyData,
} from "@modelscript/diagram";
import type { DiagramData, DiagramEditAction } from "@modelscript/diagram/protocol";
import { decodeDataUrl } from "@modelscript/dsl/utils";
import { detectPolyglotLanguage } from "@modelscript/lsp/utils/polyglot-detector.js";
import type { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorTheme as useSiteTheme } from "../host";
import "./ansatz-editor.css";
import type { CodeEditorHandle } from "./Code";
import {
  ANSATZ_LANGUAGES,
  getDefaultLanguageView,
  getLanguageExtension,
  getLanguageInfo,
  MODELICA_ICON_SHAPE_TOOLS,
  resolveCompanionFileLanguage,
} from "./constants";
import type { DiagramEditorHandle } from "./Diagram";
import { getTranslations, uiLanguages } from "./util/i18n";
import {
  applyDiagramEdits,
  applyLspEdits,
  applyLspTextEditsToString,
  didChange,
  didClose,
  didOpen,
  drillDownDiagram,
  extractPrimaryModelicaClassName,
  getComponentProperties,
  getDiagramData,
  parseCode,
  runFormalLints,
  setPreferredLspLanguageId,
  updateLspSettings,
  type AnsatzOnDemandLintMode,
} from "./util/lsp-bridge";
import { startLsp } from "./util/lsp-worker";

import {
  getEditorLanguageUi,
  useEditorModelingPreferences,
  useEditorFeatureFlag as useFeatureFlag,
  useEditorToast as useToast,
} from "../host";
import { useAnsatzHost } from "./AnsatzEditorHostContext";
import { useAnsatzEngine } from "./hooks";
import {
  AnsatzAiPanel,
  AnsatzDiagnosticsPanel,
  AnsatzFloatingDock,
  AnsatzLeftSidebar,
  AnsatzMobileTabBar,
  AnsatzModals,
  AnsatzResizeHandle,
  AnsatzVisualizerPane,
  COLLAPSED_DIAGNOSTICS_HEIGHT,
  AnsatzView as View,
  type MobileTab,
} from "./panels";
import { WorkspaceSymbolModal } from "./panels/WorkspaceSymbolModal";
import ParameterSliderRibbon from "./ParameterSliderRibbon";
import { formatMonacoMarkers, type AnsatzToolHost } from "./util/ansatz-tool-bridge";

const CodeEditor = React.lazy(() => import("./Code"));

let nextEmbedAnsatzId = 1;

export interface AnsatzEditorProps {
  dataUrl?: DataUrl | null | undefined;
  initialCode?: string | undefined;
  embed?: boolean | undefined;
  initialDialect?: string | undefined;
  initialLanguage?: string | undefined;
  initialView?: string | undefined;
  isSplit?: boolean | undefined;
  splitOrientation?: "columns" | "rows" | undefined;
  canSplit?: boolean | undefined;
  onViewChange?: ((view: "diagram" | "simulation" | "3d" | "inspector" | "code" | "split") => void) | undefined;
  onToggleSplit?: (() => void) | undefined;
  initialVisualizerSubview?: "diagram" | "simulation" | "3d" | "inspector" | undefined;
  initialSimulationVariables?: string[] | undefined;
  initialStartTime?: number | undefined;
  initialStopTime?: number | undefined;
  initialDiagramType?: string | undefined;
  diagramType?: string | undefined;
  onDiagramTypeChange?: ((diagramType: string) => void) | undefined;
  /** Modelica: class to select initially (otherwise the file's primary class). */
  initialClassName?: string | undefined;
  initialAnchor?:
    | {
        elementId?: string | undefined;
        kind?: string | undefined;
        line?: number | undefined;
        column?: number | undefined;
      }
    | undefined;
  showParameterRibbon?: boolean | undefined;
  hideFloatingDock?: boolean | undefined;
  hideCenterFloatingToolbar?: boolean | undefined;
  /** When true, the floating left sidebar starts at top: 12px (full height) instead of below a full-width top navbar. */
  sidebarFullHeight?: boolean | undefined;
  /** Fires whenever the left sidebar visibility or width changes so a host topbar can align seamlessly. */
  onSidebarLayoutChange?: ((layout: { visible: boolean; width: number }) => void) | undefined;
  defaultRibbonExpanded?: boolean | undefined;
  simulateTriggerCount?: number | undefined;
  externalParams?: Record<string, string | number | boolean> | undefined;
  onCodeChange?: ((code: string) => void) | undefined;
  onClassLoaded?:
    | ((code: string, className: string, dialect: string, files?: Record<string, string>, activeFile?: string) => void)
    | undefined;
  onDialectChange?: ((dialect: string) => void) | undefined;
  onAnchorClick?: ((anchor: { elementId: string; kind: "component" }) => void) | undefined;
  onSimulationStatus?: ((status: string, data?: unknown) => void) | undefined;
  onActiveViewChange?: ((view: "diagram" | "simulation" | "3d" | "inspector" | "code" | "split") => void) | undefined;
  onParametersChange?: ((params: Record<string, number>) => void) | undefined;
  onSave?: ((code: string) => void) | undefined;
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  onSelectProjectFile?: ((fileName: string) => void) | undefined;
  onAddProjectFile?: ((fileName: string) => void) | undefined;
  onOpenNewModelModal?: (() => void) | undefined;
  isLoadingModel?: boolean | undefined;
  onRemoveProjectFile?: ((fileName: string) => void) | undefined;
  onRenameProjectFile?: ((oldName: string, newName: string) => void) | undefined;
  onMoveProjectFile?: ((fileName: string, targetDir: string) => void) | undefined;
  dirtyFiles?: string[] | Set<string> | undefined;
  simulationResetKey?: number | undefined;
}

const isSplit = (v: View) => v === View.SPLIT_COLUMNS || v === View.SPLIT_ROWS;

export default function AnsatzEditor(props: AnsatzEditorProps) {
  const toast = useToast();
  const { preferences: modelingPrefs } = useEditorModelingPreferences();
  const [isLspReady, setIsLspReady] = useState(false);
  const [isWorkspaceSymbolOpen, setIsWorkspaceSymbolOpen] = useState(false);
  const resolvedInitialDialect = props.initialDialect ?? props.initialLanguage;
  const initialLangInfo = getLanguageInfo(resolvedInitialDialect);
  const [dialect, setDialectState] = useState<string>(initialLangInfo.id);
  const prevInitialDialectRef = useRef(props.initialDialect);
  if (props.initialDialect && props.initialDialect !== prevInitialDialectRef.current) {
    prevInitialDialectRef.current = props.initialDialect;
    const nextInfo = getLanguageInfo(props.initialDialect);
    if (dialect !== nextInfo.id) {
      setDialectState(nextInfo.id);
    }
  }
  setPreferredLspLanguageId(dialect);
  const [diagramType, setDiagramTypeState] = useState<string>(() => {
    const requested = props.diagramType ?? props.initialDiagramType;
    if (requested) {
      const match = initialLangInfo.diagramTypes?.find((dt) => dt.id.toLowerCase() === requested.toLowerCase());
      if (match) return match.id;
      return requested;
    }
    return initialLangInfo.diagramTypes?.[0]?.id ?? "diagram";
  });

  const setDiagramType = useCallback(
    (next: string) => {
      setDiagramTypeState(next);
      props.onDiagramTypeChange?.(next);
    },
    [props.onDiagramTypeChange],
  );

  useEffect(() => {
    const requested = props.diagramType ?? props.initialDiagramType;
    if (requested) {
      const match = initialLangInfo.diagramTypes?.find((dt) => dt.id.toLowerCase() === requested.toLowerCase());
      setDiagramTypeState(match ? match.id : requested);
    }
  }, [props.diagramType, props.initialDiagramType, initialLangInfo.diagramTypes]);
  const [sidecarContent, setSidecarContent] = useState<string | undefined>(undefined);
  const sidecarContentRef = useRef<string | undefined>(undefined);
  sidecarContentRef.current = sidecarContent;
  const sidecarHistoryRef = useRef<{
    undo: Array<{ prev: string | undefined; next: string | undefined; hadTextEdit: boolean }>;
    redo: Array<{ prev: string | undefined; next: string | undefined; hadTextEdit: boolean }>;
  }>({ undo: [], redo: [] });
  const instanceDocPrefix = useMemo(
    () => (props.embed ? `file:///embed_${nextEmbedAnsatzId++}_document` : "file:///document"),
    [props.embed],
  );
  const embedRootPrefix = useMemo(
    () => (props.embed ? `file:///embed_${nextEmbedAnsatzId++}` : "file://"),
    [props.embed],
  );
  const documentUri = useMemo(() => {
    if (props.activeFileName) {
      const cleanName = props.activeFileName.replace(/^\/+/, "");
      return `${embedRootPrefix}/${cleanName}`;
    }
    return `${instanceDocPrefix}.${getLanguageExtension(dialect)}`;
  }, [embedRootPrefix, instanceDocPrefix, dialect, props.activeFileName]);
  const documentUriRef = useRef(documentUri);
  documentUriRef.current = documentUri;
  const activeFileNameRef = useRef(props.activeFileName);
  activeFileNameRef.current = props.activeFileName;
  const projectFilesRef = useRef(props.projectFiles);
  projectFilesRef.current = props.projectFiles;
  const onUpdateProjectFileRef = useRef(props.onUpdateProjectFile);
  onUpdateProjectFileRef.current = props.onUpdateProjectFile;

  const persistSidecarToProjectFiles = useCallback((nextContent: string | undefined) => {
    const activeName = activeFileNameRef.current;
    const updater = onUpdateProjectFileRef.current;
    if (!activeName || !updater) return;
    const primaryKey = `${activeName}.layout`;
    const dotIdx = activeName.lastIndexOf(".");
    const legacyKey = dotIdx > 0 ? `${activeName.slice(0, dotIdx)}.layout` : undefined;
    const files = projectFilesRef.current;
    const targetKey =
      files && primaryKey in files ? primaryKey : files && legacyKey && legacyKey in files ? legacyKey : primaryKey;
    updater(targetKey, nextContent ?? "{}");
  }, []);

  useEffect(() => {
    sidecarHistoryRef.current = { undo: [], redo: [] };
    const activeName = activeFileNameRef.current;
    const files = projectFilesRef.current;
    let initialSidecar: string | undefined = undefined;
    if (files && activeName) {
      const primaryKey = `${activeName}.layout`;
      const dotIdx = activeName.lastIndexOf(".");
      const legacyKey = dotIdx > 0 ? `${activeName.slice(0, dotIdx)}.layout` : undefined;
      initialSidecar = files[primaryKey] ?? (legacyKey ? files[legacyKey] : undefined);
    }
    setSidecarContent(initialSidecar);
  }, [documentUri]);

  const syncedProjectFilesRef = useRef<Map<string, { uri: string; text: string }>>(new Map());
  useEffect(() => {
    const files = props.projectFiles;
    const synced = syncedProjectFilesRef.current;

    if (!files) {
      for (const [key, entry] of synced.entries()) {
        didClose(entry.uri);
        synced.delete(key);
      }
      return;
    }

    const inferLang = (fileName: string): string => resolveCompanionFileLanguage(fileName, dialect);

    for (const [fileName, text] of Object.entries(files)) {
      if (fileName === props.activeFileName || fileName.toLowerCase().endsWith(".layout")) {
        synced.delete(fileName);
        continue;
      }
      const cleanName = fileName.replace(/^\/+/, "");
      const uri = `${embedRootPrefix}/${cleanName}`;
      const prev = synced.get(fileName);
      if (!prev || prev.uri !== uri) {
        if (prev) didClose(prev.uri);
        void didOpen(uri, text, inferLang(fileName));
        synced.set(fileName, { uri, text });
      } else if (prev.text !== text) {
        void didChange(uri, text);
        synced.set(fileName, { uri, text });
      }
    }

    for (const [fileName, entry] of synced.entries()) {
      if (!(fileName in files) && fileName !== props.activeFileName) {
        didClose(entry.uri);
        synced.delete(fileName);
      }
    }
  }, [props.projectFiles, props.activeFileName, embedRootPrefix, dialect]);

  useEffect(() => {
    return () => {
      for (const entry of syncedProjectFilesRef.current.values()) {
        didClose(entry.uri);
      }
      syncedProjectFilesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!props.embed) return;
    const uriOnMount = documentUriRef.current;
    return () => {
      didClose(uriOnMount);
    };
  }, [props.embed]);

  const [isShareDialogOpen, setShareDialogOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const [isAddLibraryOpen, setIsAddLibraryOpen] = useState(false);
  const [addLibraryViewMode, setAddLibraryViewMode] = useState<"components" | "libraries" | "import">("components");
  const addLibraryButtonRef = useRef<HTMLButtonElement>(null);
  const [isOpenFileDialogOpen, setIsOpenFileDialogOpen] = useState(false);
  const openFileButtonRef = useRef<HTMLButtonElement>(null);
  const [isFlattenDialogOpen, setFlattenDialogOpen] = useState(false);
  const [flattenedCode, setFlattenedCode] = useState("");
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | undefined>(undefined);
  const hasAnsatzAi = useFeatureFlag("ansatz_ai");
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const [decodedContent] = decodeDataUrl(props.dataUrl ?? null);
  const baseContent = props.initialCode ?? decodedContent ?? initialLangInfo.defaultCode;
  const [loadedCodeOverride, setLoadedCodeOverride] = useState<string | null>(null);
  const content = loadedCodeOverride ?? baseContent;
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);

  const defaultLangView = getDefaultLanguageView(initialLangInfo);
  const hasExplicitSingleView =
    props.initialView === "code-only" ||
    props.initialView === "code" ||
    props.initialView === "diagram-only" ||
    props.initialView === "diagram" ||
    props.initialView === "cad-only" ||
    props.initialView === "cad" ||
    props.initialView === "3d" ||
    props.initialView === "plot-only" ||
    props.initialView === "plot" ||
    props.initialView === "simulation" ||
    props.initialView === "inspector";

  const isSplitInit =
    props.isSplit !== undefined
      ? Boolean(props.isSplit)
      : props.initialView === "split" || props.initialView === "split-columns" || props.initialView === "split-rows"
        ? true
        : hasExplicitSingleView
          ? false
          : defaultLangView.isSplit;

  const resolvedInitialSubview =
    props.initialVisualizerSubview ??
    (props.initialView === "cad-only" || props.initialView === "cad" || props.initialView === "3d"
      ? "3d"
      : props.initialView === "plot-only" || props.initialView === "plot" || props.initialView === "simulation"
        ? "simulation"
        : props.initialView === "inspector"
          ? "inspector"
          : props.initialView === "diagram-only" || props.initialView === "diagram"
            ? "diagram"
            : defaultLangView.view);

  const initialIsCad = resolvedInitialSubview === "3d";
  const initialIsPlot = resolvedInitialSubview === "simulation";
  const initialIsInspector = resolvedInitialSubview === "inspector";
  const initialViewMode =
    props.initialView === "code-only" ||
    props.initialView === "code" ||
    (!props.initialView && props.isSplit === undefined && defaultLangView.view === "code")
      ? View.CODE
      : isSplitInit
        ? props.initialView === "split-rows"
          ? View.SPLIT_ROWS
          : View.SPLIT_COLUMNS
        : View.DIAGRAM;

  const [view, setView] = useState<View>(initialViewMode);
  const [showResultsView, setShowResultsView] = useState(initialIsPlot);
  const [showCadView, setShowCadView] = useState(initialIsCad);
  const [showAnalysisView, setShowAnalysisView] = useState(initialIsInspector);
  const [mobileTab, setMobileTab] = useState<MobileTab>(
    initialIsCad ? "cad" : initialIsPlot ? "results" : initialViewMode === View.CODE ? "code" : "diagram",
  );
  const [lastLoadedContent, setLastLoadedContent] = useState<string>(baseContent);
  const lastSyncedCodeRef = useRef<string | null>(null);
  const loadingClassRef = useRef<string | null>(null);
  const [isDirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(props.initialAnchor?.elementId ?? null);
  const [selectedComponent, setSelectedComponent] = useState<string | null>(props.initialAnchor?.elementId ?? null);
  const [selectedComponentProperties, setSelectedComponentProperties] = useState<ComponentPropertyData | null>(null);
  const selectedComponentRef = useRef<string | null>(selectedComponent);
  selectedComponentRef.current = selectedComponent;
  const selectedComponentPropertiesRef = useRef<ComponentPropertyData | null>(selectedComponentProperties);
  selectedComponentPropertiesRef.current = selectedComponentProperties;
  const [isPropertiesLoading, setIsPropertiesLoading] = useState(false);
  const [diagramData, setDiagramData] = useState<(DiagramData & { isLoading?: boolean }) | null>(null);
  const [selectedTreeClassName, setSelectedTreeClassName] = useState<string | null>(() =>
    dialect === "modelica" || !dialect ? (props.initialClassName ?? extractPrimaryModelicaClassName(content)) : null,
  );
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [documentModels, setDocumentModels] = useState<{ name: string; kind: string }[]>([]);
  const [drillDownPath, setDrillDownPath] = useState<string[]>([]);
  const [psseDiagramOptions, setPsseDiagramOptions] = useState<{
    focusBus?: number | undefined;
    kHops?: number | undefined;
    layoutMode?: "auto" | "geographic" | undefined;
  }>({});
  const isSpatialEditPending = useRef(false);
  const lastDiagramEditTimeRef = useRef(0);
  const diagramDataRef = useRef<(DiagramData & { isLoading?: boolean }) | null>(null);
  diagramDataRef.current = diagramData;
  const lastDiagramTargetKeyRef = useRef<string>("");
  const diagramEditorRef = useRef<DiagramEditorHandle>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  const [isDiagramLoading, setIsDiagramLoading] = useState(false);
  const [treeVisible, setTreeVisible] = useState(!props.embed);
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [windowHeight, setWindowHeight] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  const DEFAULT_SPLIT_RATIO = 0.62;
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
  const [contextVersion, setContextVersion] = useState(0);
  const [editorDiagnostics, setEditorDiagnostics] = useState<editor.IMarkerData[]>([]);
  const [diagnosticsByUri, setDiagnosticsByUri] = useState<Map<string, editor.IMarkerData[]>>(() => new Map());
  const [onDemandMarkersByUri, setOnDemandMarkersByUri] = useState<Map<string, editor.IMarkerData[]>>(() => new Map());
  const [isRunningOnDemandLints, setIsRunningOnDemandLints] = useState(false);
  const [isDiagnosticsExpanded, setIsDiagnosticsExpanded] = useState(false);
  const [diagnosticsPanelHeight, setDiagnosticsPanelHeight] = useState(160);
  const userToggledDiagnosticsRef = useRef(false);

  const handleDiagnosticsChange = useCallback((markers: editor.IMarkerData[], uri?: string) => {
    const targetUri = uri || documentUriRef.current;
    const markersEqual = (a: editor.IMarkerData[], b: editor.IMarkerData[]) =>
      a.length === b.length &&
      a.every(
        (m, i) =>
          m.message === b[i]!.message &&
          m.severity === b[i]!.severity &&
          m.startLineNumber === b[i]!.startLineNumber &&
          m.startColumn === b[i]!.startColumn &&
          m.code === b[i]!.code,
      );

    setDiagnosticsByUri((prev) => {
      const existing = prev.get(targetUri);
      if (existing ? markersEqual(existing, markers) : markers.length === 0) {
        return prev;
      }
      const next = new Map(prev);
      if (markers.length === 0) {
        next.delete(targetUri);
      } else {
        next.set(targetUri, markers);
      }
      return next;
    });
    if (!uri || uri === documentUriRef.current) {
      setEditorDiagnostics((prev) => (markersEqual(prev, markers) ? prev : markers));
    }
    if (!userToggledDiagnosticsRef.current && markers.length > 0) {
      setIsDiagnosticsExpanded(true);
    }
  }, []);

  useEffect(() => {
    setEditorDiagnostics(diagnosticsByUri.get(documentUri) ?? []);
  }, [documentUri, diagnosticsByUri]);

  const activeOnDemandMarkers = useMemo(
    () => onDemandMarkersByUri.get(documentUri) ?? [],
    [documentUri, onDemandMarkersByUri],
  );

  const mergedEditorDiagnostics = useMemo(() => {
    if (activeOnDemandMarkers.length === 0) return editorDiagnostics;
    const seen = new Set<string>();
    const out: editor.IMarkerData[] = [];
    for (const m of editorDiagnostics) {
      const codeVal = typeof m.code === "object" && m.code !== null ? m.code.value : (m.code ?? "");
      seen.add(`${m.startLineNumber}:${m.startColumn}:${codeVal}:${m.message}`);
      out.push(m);
    }
    for (const m of activeOnDemandMarkers) {
      const codeVal = typeof m.code === "object" && m.code !== null ? m.code.value : (m.code ?? "");
      const key = `${m.startLineNumber}:${m.startColumn}:${codeVal}:${m.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    }
    return out;
  }, [editorDiagnostics, activeOnDemandMarkers]);

  const handleClearOnDemandLints = useCallback(() => {
    const targetUri = documentUriRef.current;
    setOnDemandMarkersByUri((prev) => {
      if (!prev.has(targetUri)) return prev;
      const next = new Map(prev);
      next.delete(targetUri);
      return next;
    });
  }, []);

  const handleRunOnDemandLints = useCallback(
    async (mode: AnsatzOnDemandLintMode = "all") => {
      const targetUri = documentUriRef.current;
      const currentCode = editor?.getValue() ?? content;
      setIsRunningOnDemandLints(true);
      try {
        await didOpen(targetUri, currentCode, dialect);
        const res = await runFormalLints(targetUri, {
          includeFormal: mode === "all" || mode === "formal",
          includeCompilerLints: mode === "all" || mode === "compiler",
        });
        if (!res.ok) {
          toast.error(res.error || "On-demand verification failed.");
          return;
        }
        const converted: editor.IMarkerData[] = (res.diagnostics ?? []).map((d) => ({
          startLineNumber: (d.range?.start?.line ?? 0) + 1,
          startColumn: (d.range?.start?.character ?? 0) + 1,
          endLineNumber: (d.range?.end?.line ?? 0) + 1,
          endColumn: Math.max((d.range?.end?.character ?? 0) + 1, (d.range?.start?.character ?? 0) + 2),
          severity: d.severity === 1 ? 8 : d.severity === 2 ? 4 : 2,
          message: d.message,
          ...(d.code !== undefined ? { code: String(d.code) } : {}),
          source: d.source ?? "modelscript-formal",
        }));
        setOnDemandMarkersByUri((prev) => {
          const next = new Map(prev);
          if (converted.length === 0) {
            next.delete(targetUri);
          } else {
            next.set(targetUri, converted);
          }
          return next;
        });
        const modeLabel =
          mode === "formal"
            ? "Formal verification"
            : mode === "compiler"
              ? "WASM compiler lints"
              : "Formal & compiler verification";
        if (converted.length === 0) {
          toast.success(`${modeLabel} passed with no diagnostics.`);
        } else {
          setIsDiagnosticsExpanded(true);
          toast.warning(
            `${modeLabel} found ${converted.length} diagnostic(s) (${res.formalCount ?? 0} formal, ${res.compilerCount ?? 0} compiler).`,
          );
        }
      } catch (err) {
        toast.error(`Failed to run on-demand verification: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsRunningOnDemandLints(false);
      }
    },
    [editor, content, dialect, toast],
  );

  const projectDiagnostics = useMemo(() => {
    if (!props.projectFiles) return undefined;
    const result: Array<{ fileName: string; uri: string; markers: editor.IMarkerData[] }> = [];
    for (const fileName of Object.keys(props.projectFiles)) {
      const cleanName = fileName.replace(/^\/+/, "");
      const uri = `${embedRootPrefix}/${cleanName}`;
      const baseMarkers = diagnosticsByUri.get(uri) ?? [];
      const extraMarkers = onDemandMarkersByUri.get(uri) ?? [];
      const markers = extraMarkers.length > 0 ? [...baseMarkers, ...extraMarkers] : baseMarkers;
      if (markers && markers.length > 0) {
        result.push({ fileName, uri, markers });
      }
    }
    return result;
  }, [props.projectFiles, embedRootPrefix, diagnosticsByUri, onDemandMarkersByUri]);

  const fileDiagnosticCounts = useMemo(() => {
    if (!props.projectFiles) return undefined;
    const counts: Record<string, { errors: number; warnings: number }> = {};
    for (const fileName of Object.keys(props.projectFiles)) {
      const cleanName = fileName.replace(/^\/+/, "");
      const uri = `${embedRootPrefix}/${cleanName}`;
      const baseMarkers = diagnosticsByUri.get(uri) ?? [];
      const extraMarkers = onDemandMarkersByUri.get(uri) ?? [];
      const markers = extraMarkers.length > 0 ? [...baseMarkers, ...extraMarkers] : baseMarkers;
      if (markers && markers.length > 0) {
        let errors = 0;
        let warnings = 0;
        for (const m of markers) {
          if (m.severity >= 8) errors++;
          else if (m.severity >= 4) warnings++;
        }
        if (errors > 0 || warnings > 0) {
          counts[fileName] = { errors, warnings };
        }
      }
    }
    return counts;
  }, [props.projectFiles, embedRootPrefix, diagnosticsByUri, onDemandMarkersByUri]);

  const handleToggleDiagnostics = useCallback(() => {
    userToggledDiagnosticsRef.current = true;
    setIsDiagnosticsExpanded((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleToggle = () => {
      setTreeVisible((v) => {
        const next = !v;
        if (typeof window !== "undefined") {
          queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent("ansatz:sidebar-changed", { detail: { open: next } }));
          });
        }
        return next;
      });
    };
    window.addEventListener("ansatz:toggle-sidebar", handleToggle);
    return () => window.removeEventListener("ansatz:toggle-sidebar", handleToggle);
  }, []);

  const applyViewMode = useCallback(
    (targetView: string, splitOverride?: boolean) => {
      const activeSplit = splitOverride !== undefined ? splitOverride : Boolean(props.isSplit);
      const splitMode =
        props.splitOrientation === "rows" ||
        (props.splitOrientation !== "columns" && windowWidth < 960 && windowHeight >= 560)
          ? View.SPLIT_ROWS
          : View.SPLIT_COLUMNS;

      if (targetView === "code-only" || targetView === "code") {
        setView(View.CODE);
        setShowCadView(false);
        setShowResultsView(false);
        setShowAnalysisView(false);
      } else if (targetView === "diagram-only" || targetView === "diagram") {
        setView(activeSplit ? splitMode : View.DIAGRAM);
        setShowCadView(false);
        setShowResultsView(false);
        setShowAnalysisView(false);
      } else if (targetView === "cad-only" || targetView === "cad" || targetView === "3d") {
        setView(activeSplit ? splitMode : View.DIAGRAM);
        setShowCadView(true);
        setShowResultsView(false);
        setShowAnalysisView(false);
      } else if (targetView === "plot-only" || targetView === "plot" || targetView === "simulation") {
        setView(activeSplit ? splitMode : View.DIAGRAM);
        setShowCadView(false);
        setShowResultsView(true);
        setShowAnalysisView(false);
      } else if (targetView === "inspector") {
        setView(activeSplit ? splitMode : View.DIAGRAM);
        setShowCadView(false);
        setShowResultsView(false);
        setShowAnalysisView(true);
      } else if (targetView === "split" || targetView === "split-columns") {
        setView(targetView === "split" ? splitMode : View.SPLIT_COLUMNS);
        setShowCadView(props.initialVisualizerSubview === "3d");
        setShowResultsView(props.initialVisualizerSubview === "simulation");
        setShowAnalysisView(props.initialVisualizerSubview === "inspector");
      } else if (targetView === "split-rows") {
        setView(View.SPLIT_ROWS);
        setShowCadView(props.initialVisualizerSubview === "3d");
        setShowResultsView(props.initialVisualizerSubview === "simulation");
        setShowAnalysisView(props.initialVisualizerSubview === "inspector");
      }
    },
    [props.isSplit, props.splitOrientation, props.initialVisualizerSubview, windowWidth, windowHeight],
  );

  useEffect(() => {
    if (!props.initialView && props.isSplit === undefined && props.splitOrientation === undefined) return;
    const effectiveView =
      props.initialView ||
      (showCadView ? "3d" : showResultsView ? "simulation" : showAnalysisView ? "inspector" : "diagram");
    applyViewMode(effectiveView, props.isSplit);
  }, [props.initialView, props.isSplit, props.splitOrientation, applyViewMode]);

  useEffect(() => {
    if (!isSplit(view)) return;
    const targetSplitMode =
      props.splitOrientation === "rows" ||
      (props.splitOrientation !== "columns" && windowWidth < 960 && windowHeight >= 560)
        ? View.SPLIT_ROWS
        : View.SPLIT_COLUMNS;
    if (view !== targetSplitMode) {
      setView(targetSplitMode);
    }
  }, [view, props.splitOrientation, windowWidth, windowHeight]);

  useEffect(() => {
    if (props.initialAnchor?.elementId) {
      setPendingSelection(props.initialAnchor.elementId);
      setSelectedComponent(props.initialAnchor.elementId);
    }
  }, [props.initialAnchor?.elementId]);

  const pendingCodeEchoesRef = useRef<string[]>([]);

  useEffect(() => {
    if (props.initialCode !== undefined) {
      if (loadedCodeOverride !== null && props.initialCode !== loadedCodeOverride) {
        setLoadedCodeOverride(null);
      }
      const targetCode =
        loadedCodeOverride !== null && props.initialCode === loadedCodeOverride
          ? loadedCodeOverride
          : props.initialCode;
      const echoIdx = pendingCodeEchoesRef.current.indexOf(targetCode);
      if (echoIdx !== -1) {
        pendingCodeEchoesRef.current.splice(0, echoIdx + 1);
        lastSyncedCodeRef.current = targetCode;
        return;
      }
      pendingCodeEchoesRef.current.length = 0;
      setLastLoadedContent(targetCode);
      const alreadyInEditor = Boolean(editor && editor.getValue() === targetCode);
      if (editor && !alreadyInEditor) {
        editor.setValue(targetCode);
      }
      if (alreadyInEditor) {
        lastSyncedCodeRef.current = targetCode;
      } else if (lastSyncedCodeRef.current !== targetCode) {
        lastSyncedCodeRef.current = targetCode;
        didOpen(documentUriRef.current, targetCode, dialect);
        codeEditorRef.current?.sync();
        const primary = dialect === "modelica" || !dialect ? extractPrimaryModelicaClassName(props.initialCode) : null;
        if (primary) {
          setSelectedTreeClassName(primary);
        }
        setContextVersion((v) => v + 1);
      }
    }
  }, [props.initialCode, editor, dialect, loadedCodeOverride]);

  const NARROW_BREAKPOINT = 768;
  const isNarrow = windowWidth < NARROW_BREAKPOINT;

  const handleSelectComponent = useCallback(
    (name: string | null, cachedProps?: unknown, isLoading?: boolean) => {
      if (!name || name === "__diagram_background__" || name === "__diagram_axes__") {
        setSelectedComponent(null);
        setSelectedComponentProperties(null);
        setIsPropertiesLoading(false);
        return;
      }
      setSelectedComponent(name);
      props.onAnchorClick?.({ elementId: name, kind: "component" });

      const cachedPropObj =
        cachedProps && typeof cachedProps === "object" ? (cachedProps as ComponentPropertyData) : undefined;
      const isRichProps = (p: ComponentPropertyData | null | undefined): boolean =>
        Boolean(p && (p.schema || p.values || (Array.isArray(p.parameters) && p.parameters.length > 0)));
      const isSameComponent = selectedComponentRef.current === name;
      const currentProps = selectedComponentPropertiesRef.current;
      const hasRichProps = isRichProps(currentProps);
      const isSkeleton = Boolean(cachedPropObj && !isRichProps(cachedPropObj));

      // Prevent skeleton downgrades from diagram re-renders when the same component is already loaded
      if (isSameComponent && hasRichProps && (cachedPropObj === undefined || isSkeleton)) {
        // Silently refresh in the background without clearing properties or flashing the loading spinner
        getComponentProperties(documentUri, selectedTreeClassName || undefined, name)
          .then((freshProps) => {
            if (freshProps && selectedComponentRef.current === name) {
              setSelectedComponentProperties((prev) => {
                if (!prev || prev.name !== name) return freshProps;
                return {
                  ...freshProps,
                  values: {
                    ...(freshProps.values || {}),
                    ...(prev.values || {}),
                  },
                };
              });
            }
          })
          .catch(() => {});
        return;
      }

      if (cachedPropObj !== undefined && (!isSkeleton || !hasRichProps)) {
        setSelectedComponentProperties(cachedPropObj);
        setIsPropertiesLoading(Boolean(isLoading) || isSkeleton);
        if (!isLoading && !isSkeleton) return;
      } else if (!hasRichProps) {
        // Show lightweight properties immediately while full schema loads
        const initialProps =
          (diagramData?.nodes?.find((n) => n.id === name)?.properties as ComponentPropertyData | undefined) ?? null;
        setSelectedComponentProperties(initialProps);
        setIsPropertiesLoading(true);
      }

      getComponentProperties(documentUri, selectedTreeClassName || undefined, name)
        .then((props) => {
          if (props && selectedComponentRef.current === name) {
            setSelectedComponentProperties(props);
          }
        })
        .catch((e) => {
          console.error("[ansatz] Error fetching component properties:", e);
        })
        .finally(() => {
          if (selectedComponentRef.current === name) {
            setIsPropertiesLoading(false);
          }
        });
    },
    [diagramData, documentUri, selectedTreeClassName, props.onAnchorClick],
  );

  const {
    simulationVariables,
    setSimulationVariables,
    selectedSimulationVariables,
    setSelectedSimulationVariables,
    handleToggleSimulationVariable,
    handleVariablesLoaded,
    simulationParameters,
    parameterOverrides,
    handleParameterChange,
    handleParameterReset,
    sweepState,
    setSweepState,
    sweepResults,
    experimentOverrides,
    handleExperimentOverrideChange,
    handleExperimentOverrideReset,
    cachedSimulator,
    simulationStatus,
    setSimulationStatus,
    localSimulationData,
    pscadComplianceReport,
    pscadExports,
    setLocalSimulationData,
    cadComponents,
    gdtOverlay,
    vtkBuffer,
    editorValue,
    animationControllerRef,
    animationMode,
    cosimDataSource,
    setCosimDataSource,
    ribbonParams,
    handleRibbonParamChange,
    handleRibbonParamReset,
    handleReplaySession,
    handleSaveCadBindings,
    handleCommitCadGizmoDelta,
    handleCommitCadDimensionDelta,
    handleCommitCadFaceTag,
    handleCommitCadAssemblyJoint,
    handleSimulate,
    amplSolveResult,
  } = useAnsatzEngine({
    dialect,
    documentUri,
    selectedTreeClassName,
    contextVersion,
    content,
    editor,
    showResultsView,
    setShowResultsView,
    showCadView,
    isNarrow,
    setMobileTab,
    setTreeVisible,
    setView,
    viewDiagramEnum: View.DIAGRAM,
    initialSimulationVariables: props.initialSimulationVariables,
    initialStartTime: props.initialStartTime,
    initialStopTime: props.initialStopTime,
    projectFiles: props.projectFiles,
    activeFileName: props.activeFileName,
    onUpdateProjectFile: props.onUpdateProjectFile,
  });

  const lastSimulatedTriggerRef = useRef(0);
  useEffect(() => {
    if (
      props.simulateTriggerCount &&
      props.simulateTriggerCount > lastSimulatedTriggerRef.current &&
      contextVersion > 0
    ) {
      lastSimulatedTriggerRef.current = props.simulateTriggerCount;
      void handleSimulate();
    }
  }, [props.simulateTriggerCount, contextVersion, handleSimulate]);

  useEffect(() => {
    if (!props.externalParams) return;
    for (const [k, v] of Object.entries(props.externalParams)) {
      if (typeof v === "number" || typeof v === "string") {
        const num = typeof v === "number" ? v : parseFloat(v);
        if (!isNaN(num)) {
          handleParameterChange(k, num);
        }
      }
    }
  }, [props.externalParams, handleParameterChange]);

  useEffect(() => {
    if (simulationStatus && props.onSimulationStatus) {
      props.onSimulationStatus(simulationStatus, localSimulationData);
    }
  }, [simulationStatus, localSimulationData, props.onSimulationStatus]);

  useEffect(() => {
    if (!props.simulationResetKey) return;
    setLocalSimulationData(null);
    setSimulationStatus(null);
    setSimulationVariables([]);
    setSelectedSimulationVariables([]);
  }, [props.simulationResetKey]);

  useEffect(() => {
    props.onParametersChange?.(parameterOverrides);
  }, [parameterOverrides, props.onParametersChange]);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplit = useRef(false);
  const [isSplitResizerDragging, setIsSplitResizerDragging] = useState(false);
  const [treeWidth, setTreeWidth] = useState(300);
  const [propertiesWidth, setPropertiesWidth] = useState(props.embed ? 240 : 300);
  const ansatzHost = useAnsatzHost();
  const siteTheme = useSiteTheme();
  const theme = ansatzHost.lspTransport ? ansatzHost.theme : siteTheme.theme;
  const toggleTheme = ansatzHost.toggleTheme ?? siteTheme.toggleTheme;
  const isDark = theme === "dark";
  const colorMode = isDark ? "dark" : "light";
  const [libraryFilter, setLibraryFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expectedComponentNameRef = useRef<string | null>(null);
  const pendingModelNameRef = useRef<string | null>(null);
  const isInitialized = useRef(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const translations = useMemo(() => getTranslations(language), [language]);

  const diagramActionQueueRef = useRef<DiagramActionQueue<DiagramEditAction> | null>(null);
  const diagramEditRunnerRef = useRef<SerializedDiagramEditRunner>(new SerializedDiagramEditRunner());
  const selectedTreeClassNameRef = useRef<string | null>(selectedTreeClassName);
  selectedTreeClassNameRef.current = selectedTreeClassName;
  const onCodeChangeRef = useRef(props.onCodeChange);
  onCodeChangeRef.current = props.onCodeChange;

  const flushDiagramActionBatch = useCallback(
    (actions: DiagramEditAction[]) => {
      if (actions.length === 0) return;
      diagramEditRunnerRef.current.enqueue(
        async (seq) => {
          // Flush any pending/debounced live Monaco edits before computing LSP diagram TextEdits
          if (editorRef.current) {
            const liveCode = editorRef.current.getValue();
            if (liveCode !== lastLoadedContentRef.current) {
              setLastLoadedContent(liveCode);
              if (codeEditorRef.current) {
                await codeEditorRef.current.sync();
              } else {
                await didChange(documentUriRef.current, liveCode);
              }
            }
          }
          const response = await applyDiagramEdits(
            documentUriRef.current,
            actions,
            seq,
            selectedTreeClassNameRef.current ?? undefined,
          );
          if (response?.sidecarContent !== undefined) {
            if (response.sidecarContent !== sidecarContentRef.current) {
              const stack = sidecarHistoryRef.current;
              stack.undo.push({
                prev: sidecarContentRef.current,
                next: response.sidecarContent,
                hadTextEdit: Boolean(response?.edits && response.edits.length > 0),
              });
              if (stack.undo.length > 100) stack.undo.shift();
              stack.redo.length = 0;
              persistSidecarToProjectFiles(response.sidecarContent);
            }
            setSidecarContent(response.sidecarContent);
          }
          if (response && response.edits && response.edits.length > 0) {
            isSpatialEditPending.current = true;
            lastDiagramEditTimeRef.current = Date.now();
            if (editorRef.current) {
              applyLspEdits(editorRef.current, response.edits, actions[0]!.type);
              const updatedCode = editorRef.current.getValue();
              setLastLoadedContent(updatedCode);
              if (codeEditorRef.current) {
                await codeEditorRef.current.sync();
              } else {
                await didChange(documentUriRef.current, updatedCode);
              }
              onCodeChangeRef.current?.(updatedCode);
            } else {
              const baseText = lastLoadedContentRef.current || content;
              const updatedCode = applyLspTextEditsToString(baseText, response.edits);
              setLastLoadedContent(updatedCode);
              await didChange(documentUriRef.current, updatedCode);
              onCodeChangeRef.current?.(updatedCode);
            }
            if (response.renderHint === "none") {
              setIsDiagramLoading(false);
            } else {
              setContextVersion((v) => v + 1);
            }
          } else if (response?.sidecarContent !== undefined) {
            setIsDiagramLoading(false);
            setContextVersion((v) => v + 1);
          } else {
            setIsDiagramLoading(false);
          }
        },
        (err) => {
          console.error("Failed to apply diagram edit batch:", err);
          setIsDiagramLoading(false);
        },
      );
    },
    [content],
  );

  const flushDiagramActionBatchRef = useRef(flushDiagramActionBatch);
  flushDiagramActionBatchRef.current = flushDiagramActionBatch;

  useEffect(() => {
    const queue = new DiagramActionQueue<DiagramEditAction>({
      spatialDelayMs: 8,
      structuralDelayMs: 0,
      onFlush: (actions) => flushDiagramActionBatchRef.current(actions),
    });
    diagramActionQueueRef.current = queue;
    return () => {
      queue.dispose();
      diagramActionQueueRef.current = null;
    };
  }, []);

  const enqueueDiagramAction = useCallback((rawAction: DiagramEditAction | Record<string, unknown>) => {
    const action = rawAction as DiagramEditAction;
    // Optimistically update selectedComponentProperties so Property Panel stays in sync immediately
    if (
      action.type === "updateParameter" ||
      action.type === "updateProperty" ||
      action.type === "updateName" ||
      action.type === "updateDescription"
    ) {
      setSelectedComponentProperties((prev) => applyOptimisticPropertyAction(prev, action));
      if (action.type === "updateParameter" || action.type === "updateProperty") {
        const paramKey = action.type === "updateParameter" ? action.parameter : action.key;
        const paramVal = String(action.value ?? "");
        const oldVal = (action as { oldValue?: string }).oldValue ?? "";
        diagramEditorRef.current?.updateParameterText?.(action.name, paramKey, oldVal, paramVal);
      }
    }

    const isOptimisticOnly =
      isOptimisticDiagramActionBatch([action]) || action.type === "updateName" || action.type === "updateDescription";
    if (!isOptimisticOnly && !diagramDataRef.current) {
      setIsDiagramLoading(true);
    }

    if (diagramActionQueueRef.current) {
      diagramActionQueueRef.current.enqueue(action);
    } else {
      flushDiagramActionBatchRef.current([action]);
    }
  }, []);

  const handleRevealLine = useCallback((line: number, identifier?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;
    const safeLine = Math.max(1, Math.min(model.getLineCount(), line));
    const lineText = model.getLineContent(safeLine);
    let startCol = 1;
    let endCol = lineText.length + 1;
    if (identifier) {
      const idx = lineText.indexOf(identifier);
      if (idx !== -1) {
        startCol = idx + 1;
        endCol = idx + 1 + identifier.length;
      }
    }
    ed.revealLineInCenter(safeLine);
    ed.setSelection({
      startLineNumber: safeLine,
      startColumn: startCol,
      endLineNumber: safeLine,
      endColumn: endCol,
    });
    ed.focus();
  }, []);

  const handleSelectDiagnostic = useCallback(
    (marker: editor.IMarkerData) => {
      if (view !== View.CODE && !isSplit(view)) {
        const splitMode =
          props.splitOrientation === "rows" ||
          (props.splitOrientation !== "columns" && windowWidth < 960 && windowHeight >= 560)
            ? View.SPLIT_ROWS
            : View.SPLIT_COLUMNS;
        setView(splitMode);
      }
      const focusMarker = () => {
        const ed = editorRef.current;
        if (!ed) return;
        const range = {
          startLineNumber: Math.max(1, marker.startLineNumber),
          startColumn: Math.max(1, marker.startColumn),
          endLineNumber: Math.max(1, marker.endLineNumber || marker.startLineNumber),
          endColumn: Math.max(1, marker.endColumn || marker.startColumn),
        };
        ed.revealRangeInCenter(range);
        ed.setSelection(range);
        ed.focus();
      };
      requestAnimationFrame(focusMarker);
    },
    [view, props.splitOrientation, windowWidth, windowHeight],
  );

  const handleNodeDoubleClick = useCallback(
    (nodeId: string, nodeData?: unknown) => {
      if (!nodeId || nodeId === "__diagram_background__" || nodeId === "__diagram_axes__") return;
      const shortName = nodeId.split(".").pop() || nodeId;

      // 1. Reveal source line in Monaco editor
      const ed = editorRef.current;
      if (ed) {
        const model = ed.getModel();
        if (model) {
          const lines = model.getLinesContent();
          const escaped = shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const wordRe = new RegExp(`\\b${escaped}\\b`);
          let foundLine = -1;
          for (let i = 0; i < lines.length; i++) {
            if (wordRe.test(lines[i]!)) {
              foundLine = i + 1;
              break;
            }
          }
          if (foundLine !== -1) {
            handleRevealLine(foundLine, shortName);
          }
        }
      }

      // 2. Drill down into subsystem/class if applicable and update breadcrumbs
      const nodeEntry = diagramData?.nodes?.find((n) => n.id === nodeId) as
        { type?: string; className?: string; properties?: { typeName?: string } } | undefined;
      const nodeDataObj =
        nodeData && typeof nodeData === "object" ? (nodeData as { type?: string; className?: string }) : undefined;
      const candidateType =
        nodeEntry?.type ||
        nodeEntry?.className ||
        nodeEntry?.properties?.typeName ||
        nodeDataObj?.type ||
        nodeDataObj?.className;
      const matchedModel = documentModels.find(
        (m) =>
          m.name === candidateType ||
          m.name === shortName ||
          (typeof candidateType === "string" && candidateType.endsWith(`.${m.name}`)),
      );
      if (matchedModel) {
        setDrillDownPath((prev) => {
          const rootName = selectedTreeClassName || documentModels[0]?.name || dialect;
          const base = prev.length === 0 ? [rootName] : prev;
          if (base[base.length - 1] === matchedModel.name) return base;
          return [...base, matchedModel.name];
        });
        setSelectedTreeClassName(matchedModel.name);
      } else if (dialect === "pscad" && documentUri) {
        void drillDownDiagram(documentUri, nodeId || shortName, selectedTreeClassName || undefined).then((res) => {
          if (res?.targetClassName) {
            setDrillDownPath((prev) => {
              if (res.breadcrumbs && res.breadcrumbs.length > 0) return res.breadcrumbs;
              const rootName = selectedTreeClassName || "Main";
              const base = prev.length === 0 ? [rootName] : prev;
              if (base[base.length - 1] === res.targetClassName) return base;
              return [...base, res.targetClassName!];
            });
            setSelectedTreeClassName(res.targetClassName);
          }
        });
      } else {
        setDrillDownPath((prev) => {
          const rootName = selectedTreeClassName || documentModels[0]?.name || dialect;
          const base = prev.length === 0 ? [rootName] : prev;
          if (base[base.length - 1] === shortName) return base;
          return [...base, shortName];
        });
      }
    },
    [diagramData, documentModels, selectedTreeClassName, dialect, documentUri, handleRevealLine],
  );

  const handleDrillRoot = useCallback(() => {
    if (drillDownPath.length > 0) {
      const rootModel = documentModels.find((m) => m.name === drillDownPath[0]);
      if (rootModel) {
        setSelectedTreeClassName(rootModel.name);
      } else if (dialect === "pscad") {
        setSelectedTreeClassName(null);
      }
    }
    setDrillDownPath([]);
  }, [drillDownPath, documentModels, dialect]);

  const handleDrillUp = useCallback(
    (index: number) => {
      const targetName = drillDownPath[index];
      if (!targetName) return;
      const matched = documentModels.find((m) => m.name === targetName);
      if (matched) {
        setSelectedTreeClassName(matched.name);
      } else if (dialect === "pscad") {
        setSelectedTreeClassName(index === 0 ? null : targetName);
      }
      setDrillDownPath((prev) => prev.slice(0, index + 1));
    },
    [drillDownPath, documentModels, dialect],
  );

  const handleInsertStencilSnippet = useCallback(
    (snippet: string, className?: string) => {
      if (
        (dialect === "modelica" || dialect === "modelscript" || dialect === "pscad") &&
        className &&
        editorRef.current
      ) {
        enqueueDiagramAction({ type: "addComponent", className, x: 0, y: 0 });
        return;
      }
      const ed = editorRef.current;
      if (!ed) return;
      const currentText = ed.getValue();
      let nextText: string;
      if (dialect === "sysml2" && currentText.lastIndexOf("}") !== -1) {
        const idx = currentText.lastIndexOf("}");
        nextText = `${currentText.slice(0, idx)}${snippet}${currentText.slice(idx)}`;
      } else if (dialect === "owl2" && currentText.lastIndexOf(")") !== -1) {
        const idx = currentText.lastIndexOf(")");
        nextText = `${currentText.slice(0, idx)}  ${snippet}${currentText.slice(idx)}`;
      } else if (dialect === "urdf" && currentText.includes("</robot>")) {
        const idx = currentText.lastIndexOf("</robot>");
        nextText = `${currentText.slice(0, idx)}${snippet}${currentText.slice(idx)}`;
      } else {
        nextText = `${currentText.trimEnd()}\n${snippet}`;
      }
      ed.setValue(nextText);
      didOpen(documentUriRef.current, nextText, dialect);
      setContextVersion((v) => v + 1);
    },
    [dialect, enqueueDiagramAction],
  );

  // Collect all displayable models/blocks defined in current document
  const nestedModels = documentModels;

  // Extract models/blocks defined in the current document for model tabs
  useEffect(() => {
    if (dialect !== "modelica" && dialect !== "modelscript") {
      setDocumentModels([]);
      setSelectedTreeClassName(null);
      return;
    }
    let cancelled = false;
    const updateDocumentModels = async () => {
      try {
        const text = editorRef.current?.getValue() || content;
        if (!text) return;
        const res = await parseCode(text);
        if (cancelled) return;
        if (res && res.classes) {
          setDocumentModels(res.classes);
          if (res.classes.length > 0) {
            const preferredName = extractPrimaryModelicaClassName(text);
            setSelectedTreeClassName((prev) => {
              if (prev && res.classes.some((c) => c.name === prev)) return prev;
              if (preferredName && res.classes.some((c) => c.name === preferredName)) return preferredName;
              const simulatable = res.classes.filter((c) => {
                const k = (c.kind || "").toLowerCase();
                return k === "model" || k === "block" || k === "class";
              });
              if (simulatable.length > 0) return simulatable[simulatable.length - 1]!.name;
              return res.classes[0]!.name;
            });
          }
        }
      } catch {
        // ignore parse error during active typing
      }
    };
    updateDocumentModels();
    return () => {
      cancelled = true;
    };
  }, [contextVersion, content, dialect]);

  // Keep selectedModelIndex in sync with selectedTreeClassName
  useEffect(() => {
    if (!selectedTreeClassName || nestedModels.length === 0) return;
    const idx = nestedModels.findIndex((m) => m.name === selectedTreeClassName);
    if (idx !== -1 && idx !== selectedModelIndex) {
      setSelectedModelIndex(idx);
    }
  }, [selectedTreeClassName, nestedModels, selectedModelIndex]);

  useEffect(() => {
    if (!props.embed) {
      if (treeVisible) {
        document.body.classList.add("tree-visible");
      } else {
        document.body.classList.remove("tree-visible");
      }
    }
    return () => {
      document.body.classList.remove("tree-visible");
    };
  }, [treeVisible, props.embed]);

  useEffect(() => {
    const init = async () => {
      if (isInitialized.current) return;
      isInitialized.current = true;
      const isEmptyWorkspace =
        props.projectFiles !== undefined && Object.keys(props.projectFiles).length === 0 && !content.trim();
      if (isEmptyWorkspace) {
        setLoadingProgress(100);
        setLoadingMessage("Ready");
      } else {
        setLoadingProgress(10);
        setLoadingMessage("Initializing modeling & simulation engine…");
      }

      try {
        const conn = await startLsp(dialect);
        conn.onNotification("modelscript/projectTreeChanged", () => {
          if (
            isSpatialEditPending.current ||
            (lastDiagramEditTimeRef.current > 0 && Date.now() - lastDiagramEditTimeRef.current < 1000)
          ) {
            isSpatialEditPending.current = false;
            setIsDiagramLoading(false);
          } else {
            setContextVersion((v) => v + 1);
          }
        });
        conn.onNotification("modelscript/status", (params: { state?: string }) => {
          if (params?.state === "ready") {
            setContextVersion((v) => v + 1);
          }
        });
        setIsLspReady(true);
      } catch (e) {
        console.error("Failed to start LSP:", e);
      }

      if (!isEmptyWorkspace) {
        setLoadingProgress(80);
        setLoadingMessage("Loading modeling workspace…");

        // Notify LSP of the initial file content and ensure notification is sent before triggering simulation/tree update
        await didOpen(documentUri, content, dialect);

        // Force tree update by bumping version now that LSP is ready
        setContextVersion((v) => v + 1);
      }

      setAvailableLanguages(uiLanguages);

      if (!isEmptyWorkspace) {
        const hideLoading = () => {
          setLoadingProgress(100);
          setLoadingMessage("Ready");
          setTimeout(() => {
            diagramEditorRef.current?.zoomToFit();
          }, 80);
        };
        if ("requestIdleCallback" in window) {
          requestIdleCallback(hideLoading, { timeout: 500 });
        } else {
          setTimeout(hideLoading, 300);
        }
      }
    };
    init();
  }, [content, dialect, documentUri]);

  // Surface LSP window/showMessage errors & warnings via toast (deduplicated/throttled)
  const lspToastThrottleRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const THROTTLE_MS = 5000;
    const handleLspMessage = (ev: Event) => {
      const detail = (ev as CustomEvent<{ type?: number; message?: string } | undefined>).detail;
      if (!detail || typeof detail.message !== "string") return;
      const msg = detail.message.trim();
      if (!msg) return;
      if (detail.type !== 1 && detail.type !== 2) return;

      const now = Date.now();
      const cache = lspToastThrottleRef.current;
      const key = `${detail.type}:${msg}`;
      const lastShown = cache.get(key);
      if (lastShown !== undefined && now - lastShown < THROTTLE_MS) return;

      cache.set(key, now);
      if (cache.size > 50) {
        for (const [k, ts] of cache.entries()) {
          if (now - ts >= THROTTLE_MS) cache.delete(k);
        }
      }

      if (detail.type === 1) {
        toast.error(msg);
      } else {
        toast.warning(msg);
      }
    };

    window.addEventListener("modelscript:lsp-message", handleLspMessage);
    return () => {
      window.removeEventListener("modelscript:lsp-message", handleLspMessage);
    };
  }, [toast]);

  // Sync modeling preferences to LSP on startup and whenever preferences change
  useEffect(() => {
    if (!isLspReady) return;
    void updateLspSettings({
      editor: { ...modelingPrefs },
    }).catch(() => {
      // Ignore transient LSP errors while worker is shutting down or restarting
    });
  }, [isLspReady, modelingPrefs]);

  // Bind Ctrl+Shift+O / Cmd+Shift+O for Workspace Symbol Quick-Open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setIsWorkspaceSymbolOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleSelectWorkspaceSymbol = useCallback(
    (uri: string, line: number, symbolName?: string) => {
      const files = projectFilesRef.current;
      let targetFileName: string | undefined;

      if (files && uri) {
        const cleanUri = uri.split(/[?#]/)[0] ?? uri;
        const decodedUri = (() => {
          try {
            return decodeURIComponent(cleanUri);
          } catch {
            return cleanUri;
          }
        })();

        const stripped = decodedUri
          .replace(new RegExp(`^${embedRootPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`), "")
          .replace(/^file:\/\/\/?/, "")
          .replace(/^\/+/, "");

        const fileKeys = Object.keys(files);
        if (stripped in files) {
          targetFileName = stripped;
        } else {
          const exactMatch = fileKeys.find((k) => k.replace(/^\/+/, "") === stripped);
          if (exactMatch) {
            targetFileName = exactMatch;
          } else {
            const base = stripped.split("/").pop();
            if (base) {
              const baseMatches = fileKeys.filter((k) => k.split("/").pop() === base);
              if (baseMatches.length === 1) {
                targetFileName = baseMatches[0];
              }
            }
          }
        }
      }

      const switchedFile = Boolean(targetFileName && targetFileName !== activeFileNameRef.current);
      if (switchedFile && targetFileName) {
        props.onSelectProjectFile?.(targetFileName);
      }

      const switchedView = view !== View.CODE && !isSplit(view);
      if (switchedView) {
        const splitMode =
          props.splitOrientation === "rows" ||
          (props.splitOrientation !== "columns" && windowWidth < 960 && windowHeight >= 560)
            ? View.SPLIT_ROWS
            : View.SPLIT_COLUMNS;
        setView(splitMode);
      }

      const shortIdentifier = symbolName?.split(".").pop();
      if (switchedFile || switchedView) {
        window.setTimeout(() => {
          handleRevealLine(line, shortIdentifier);
        }, 120);
      } else {
        handleRevealLine(line, shortIdentifier);
      }
    },
    [
      embedRootPrefix,
      handleRevealLine,
      props.onSelectProjectFile,
      props.splitOrientation,
      view,
      windowHeight,
      windowWidth,
    ],
  );

  useEffect(() => {
    setIsSearching(true);
    const handler = setTimeout(() => {
      setDebouncedFilter(libraryFilter);
      setIsSearching(false);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [libraryFilter]);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
    };
    const handleOpenShareModal = () => setShareDialogOpen(true);
    const handleAnsatzCommand = (ev: Event) => {
      const detail = (ev as CustomEvent<{ action?: string } | undefined>).detail;
      if (!detail?.action) return;
      switch (detail.action) {
        case "simulate":
          void handleSimulate();
          break;
        case "view:diagram":
          applyViewMode("diagram");
          break;
        case "view:3d":
          applyViewMode("3d");
          break;
        case "view:simulation":
          applyViewMode("simulation");
          break;
        case "view:inspector":
          applyViewMode("inspector");
          break;
        case "view:code":
          applyViewMode("code");
          break;
        case "view:split":
          applyViewMode("split");
          break;
        case "share":
          setShareDialogOpen(true);
          break;
      }
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("modelscript:open-share-modal", handleOpenShareModal);
    window.addEventListener("modelscript:ansatz-command", handleAnsatzCommand);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("modelscript:open-share-modal", handleOpenShareModal);
      window.removeEventListener("modelscript:ansatz-command", handleAnsatzCommand);
    };
  }, [handleSimulate]);

  useEffect(() => {
    if (isNarrow) {
      if (mobileTab === "code") {
        setTreeVisible(false);
        setView(View.CODE);
      } else if (mobileTab === "params") {
        setTreeVisible(true);
      } else {
        setTreeVisible(false);
        setView(View.DIAGRAM);
      }
    } else {
      if (!props.embed) {
        setTreeVisible(true);
      }
      if (
        !props.initialView ||
        props.initialView === "split" ||
        props.initialView === "split-columns" ||
        props.initialView === "split-rows"
      ) {
        setView((prev) => (prev === View.CODE ? View.SPLIT_COLUMNS : prev));
      }
    }
  }, [isNarrow, mobileTab, props.embed, props.initialView]);

  const currentActiveView: "diagram" | "simulation" | "3d" | "inspector" | "code" | "split" = showResultsView
    ? "simulation"
    : showCadView
      ? "3d"
      : showAnalysisView
        ? "inspector"
        : view === View.CODE
          ? "code"
          : isSplit(view)
            ? "split"
            : "diagram";

  const lastNotifiedViewRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastNotifiedViewRef.current === currentActiveView) return;
    lastNotifiedViewRef.current = currentActiveView;
    props.onActiveViewChange?.(currentActiveView);
  }, [currentActiveView, props.onActiveViewChange]);

  useEffect(() => {
    if (content) {
      setLastLoadedContent(content);
    }
  }, [content]);

  useEffect(() => {
    if ((view === View.DIAGRAM || isSplit(view)) && (loadingProgress === undefined || loadingProgress >= 100)) {
      const timer = setTimeout(() => {
        diagramEditorRef.current?.zoomToFit();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [view, treeVisible, loadingProgress]);

  const handleSelectDialect = useCallback(
    (newDialectId: string) => {
      const nextInfo = getLanguageInfo(newDialectId);
      const prevInfo = getLanguageInfo(dialect);
      if (nextInfo.id === dialect) return;

      const prevUri = `${instanceDocPrefix}.${getLanguageExtension(dialect)}`;
      const nextUri = `${instanceDocPrefix}.${getLanguageExtension(nextInfo.id)}`;

      didClose(prevUri);
      setDialectState(nextInfo.id);
      setSidecarContent(undefined);
      setDrillDownPath([]);
      setDiagramType(nextInfo.diagramTypes?.[0]?.id ?? "diagram");

      if (!nextInfo.supportsSimulation) {
        setShowResultsView(false);
      }
      const nextDefaultView = getDefaultLanguageView(nextInfo);
      const keep3dView =
        nextInfo.supports3d && (showCadView || props.initialVisualizerSubview === "3d" || props.initialView === "3d");
      if (keep3dView || nextDefaultView.view === "3d") {
        setShowCadView(true);
        setShowResultsView(false);
        setShowAnalysisView(false);
      } else if (nextDefaultView.view === "diagram") {
        setShowCadView(false);
        setShowResultsView(false);
        setShowAnalysisView(false);
      } else if (nextDefaultView.view === "simulation") {
        setShowCadView(false);
        setShowResultsView(true);
        setShowAnalysisView(false);
      } else if (nextDefaultView.view === "inspector") {
        setShowCadView(false);
        setShowResultsView(false);
        setShowAnalysisView(true);
      } else if (nextDefaultView.view === "code") {
        setView(View.CODE);
        setShowCadView(false);
        setShowResultsView(false);
        setShowAnalysisView(false);
      }

      const currentVal = editorRef.current?.getValue() || props.initialCode || "";
      const isDefaultOrEmpty =
        !currentVal.trim() ||
        currentVal === prevInfo.defaultCode ||
        ANSATZ_LANGUAGES.some((l) => l.defaultCode === currentVal);
      const nextCode = isDefaultOrEmpty ? nextInfo.defaultCode : currentVal;

      if (editorRef.current && nextCode !== currentVal) {
        editorRef.current.setValue(nextCode);
      }
      setLastLoadedContent(nextCode);
      lastSyncedCodeRef.current = nextCode;
      didOpen(nextUri, nextCode, nextInfo.id);
      const primary = nextInfo.id === "modelica" || !nextInfo.id ? extractPrimaryModelicaClassName(nextCode) : null;
      if (primary) {
        setSelectedTreeClassName(primary);
      }
      setContextVersion((v) => v + 1);
      props.onDialectChange?.(nextInfo.id);
    },
    [
      dialect,
      instanceDocPrefix,
      props.initialCode,
      props.initialView,
      props.initialVisualizerSubview,
      props.onDialectChange,
      showCadView,
    ],
  );

  const [detectedDialectHint, setDetectedDialectHint] = useState<{
    slug: string;
    name: string;
    reason: string;
  } | null>(null);
  const [isEditorDragOver, setIsEditorDragOver] = useState(false);

  const handleEditorPaste = useCallback(
    (pastedText: string, fullText: string) => {
      if (pastedText.length < 24 && fullText.length < 40) return;
      const match = detectPolyglotLanguage(pastedText) ?? detectPolyglotLanguage(fullText);
      if (!match) return;
      const targetInfo = getLanguageInfo(match.slug);
      if (targetInfo.id !== dialect) {
        setDetectedDialectHint({
          slug: targetInfo.id,
          name: targetInfo.name,
          reason: match.reason,
        });
      } else {
        setDetectedDialectHint(null);
      }
    },
    [dialect],
  );

  const acceptDetectedDialect = useCallback(() => {
    if (!detectedDialectHint) return;
    const targetSlug = detectedDialectHint.slug;
    setDetectedDialectHint(null);
    handleSelectDialect(targetSlug);
  }, [detectedDialectHint, handleSelectDialect]);

  const handleEditorDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      setIsEditorDragOver(false);
      if (file.size > 2_000_000) {
        toast.warning("Dropped file is too large for inline editor preview (> 2 MB).");
        return;
      }
      try {
        const droppedText = await file.text();
        const match = detectPolyglotLanguage(droppedText, file.name);
        const targetInfo = getLanguageInfo(match?.slug ?? dialect);
        const targetUri = `${instanceDocPrefix}.${getLanguageExtension(targetInfo.id)}`;

        if (targetInfo.id !== dialect) {
          didClose(documentUriRef.current);
          setDialectState(targetInfo.id);
          setSidecarContent(undefined);
          setDrillDownPath([]);
          setDiagramType(targetInfo.diagramTypes?.[0]?.id ?? "diagram");
          if (targetInfo.defaultView === "3d" || (targetInfo.supports3d && !targetInfo.supportsDiagram)) {
            setShowCadView(true);
            setShowResultsView(false);
          } else if (targetInfo.supportsDiagram) {
            setShowCadView(false);
          }
          props.onDialectChange?.(targetInfo.id);
        }

        setLoadedCodeOverride(droppedText);
        if (editorRef.current) {
          editorRef.current.setValue(droppedText);
        }
        setLastLoadedContent(droppedText);
        lastSyncedCodeRef.current = droppedText;
        didOpen(targetUri, droppedText, targetInfo.id);
        setContextVersion((v) => v + 1);
        setDetectedDialectHint(null);
        props.onCodeChange?.(droppedText);
        toast.info(match ? `Loaded ${file.name} (${match.reason})` : `Loaded ${file.name}`);
      } catch (err: unknown) {
        toast.error(`Failed to read dropped file: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [dialect, instanceDocPrefix, props.onCodeChange, props.onDialectChange, toast],
  );

  useEffect(() => {
    if (!resolvedInitialDialect) return;
    const canonical = getLanguageInfo(resolvedInitialDialect).id;
    if (canonical !== dialect) {
      handleSelectDialect(canonical);
    }
  }, [resolvedInitialDialect, dialect, handleSelectDialect]);

  const loadClass = async (className: string, kind?: string) => {
    if (!className || className.startsWith("__") || kind === "package" || kind === "loading-package") {
      return;
    }

    // Fast path: if selecting a top-level class already defined in the active document, switch to it directly
    if (!className.includes(".") && documentModels.some((m) => m.name === className)) {
      setSelectedTreeClassName(className);
      setDrillDownPath([]);
      setSelectedComponent(null);
      setSelectedComponentProperties(null);
      setShowResultsView(false);
      if (view === View.DIAGRAM || isSplit(view)) {
        setTimeout(() => {
          diagramEditorRef.current?.fitContent();
        }, 100);
      }
      return;
    }

    if (loadingClassRef.current === className) {
      return;
    }
    loadingClassRef.current = className;

    // Store the name so the diagram tab auto-selects if it's a model/block
    if (kind === "model" || kind === "block") {
      pendingModelNameRef.current = className;
    } else {
      pendingModelNameRef.current = null;
    }

    try {
      const { getClassSource } = await import("./util/lsp-bridge");
      const { content: fetchedContent, uri: sourceUri, error } = await getClassSource(className);
      if (fetchedContent) {
        const lowerUri = (sourceUri || "").toLowerCase();
        const targetDialect =
          lowerUri.endsWith(".sysml") ||
          lowerUri.endsWith(".sysml2") ||
          lowerUri.endsWith(".kerml") ||
          lowerUri.startsWith("sysml2:")
            ? "sysml2"
            : "modelica";
        const targetUri = `${instanceDocPrefix}.${getLanguageExtension(targetDialect)}`;

        if (dialect !== targetDialect) {
          didClose(documentUriRef.current);
          setDialectState(targetDialect);
          setSidecarContent(undefined);
          setDiagramType(getLanguageInfo(targetDialect).diagramTypes?.[0]?.id ?? "diagram");
          props.onDialectChange?.(targetDialect);
        }

        setLoadedCodeOverride(fetchedContent);
        if (editorRef.current) {
          editorRef.current.setValue(fetchedContent);
        }
        setLastLoadedContent(fetchedContent);
        lastLoadedContentRef.current = fetchedContent;
        lastSyncedCodeRef.current = fetchedContent;
        setDrillDownPath([]);
        setSelectedComponent(null);
        setSelectedComponentProperties(null);
        setShowResultsView(false);

        didOpen(targetUri, fetchedContent, targetDialect);
        codeEditorRef.current?.sync();
        const primaryClassName =
          targetDialect === "modelica"
            ? extractPrimaryModelicaClassName(fetchedContent) || className.split(".").pop() || className
            : className.split(".").pop() || className;
        setSelectedTreeClassName(primaryClassName);
        setContextVersion((v) => v + 1);
        props.onClassLoaded?.(fetchedContent, className, targetDialect);
        props.onCodeChange?.(fetchedContent);

        if (view === View.DIAGRAM || isSplit(view)) {
          setTimeout(() => {
            diagramEditorRef.current?.fitContent();
          }, 150);
        }
      } else if (error) {
        console.warn("Failed to fetch source for %s:", className, error);
      }
    } catch (e) {
      console.error("Error loading source for %s:", className, e);
    } finally {
      if (loadingClassRef.current === className) {
        loadingClassRef.current = null;
      }
    }
  };

  const editorRef = useRef(editor);
  const lastLoadedContentRef = useRef(lastLoadedContent);
  const loadClassRef = useRef(loadClass);
  editorRef.current = editor;
  lastLoadedContentRef.current = lastLoadedContent;
  loadClassRef.current = loadClass;

  const handleLoadStarterExample = useCallback(
    (exampleCode: string, exampleTitle?: string, exampleFiles?: Record<string, string>, exampleActiveFile?: string) => {
      const resolvedActiveFile =
        exampleFiles && Object.keys(exampleFiles).length > 0
          ? (exampleActiveFile ?? Object.keys(exampleFiles)[0])
          : undefined;
      const resolvedCode =
        exampleFiles && resolvedActiveFile ? (exampleFiles[resolvedActiveFile] ?? exampleCode) : exampleCode;
      if (!resolvedCode) return;
      setLoadedCodeOverride(resolvedCode);
      if (editorRef.current) {
        editorRef.current.setValue(resolvedCode);
      }
      setLastLoadedContent(resolvedCode);
      lastLoadedContentRef.current = resolvedCode;
      lastSyncedCodeRef.current = resolvedCode;
      setDrillDownPath([]);
      setSelectedComponent(null);
      setSelectedComponentProperties(null);
      setShowResultsView(false);

      const targetUri = documentUriRef.current;
      didOpen(targetUri, resolvedCode, dialect);
      codeEditorRef.current?.sync();
      const primary =
        dialect === "modelica" || !dialect ? extractPrimaryModelicaClassName(resolvedCode) : (exampleTitle ?? null);
      if (primary) {
        setSelectedTreeClassName(primary);
      }
      setContextVersion((v) => v + 1);
      props.onClassLoaded?.(
        resolvedCode,
        exampleTitle || primary || "StarterModel",
        dialect,
        exampleFiles,
        resolvedActiveFile,
      );
      props.onCodeChange?.(resolvedCode);
    },
    [dialect, props.onClassLoaded, props.onCodeChange],
  );

  const handleTreeSelect = useCallback((className: string, kind?: string) => {
    if (!className || className.startsWith("__") || kind === "package" || kind === "loading-package") {
      return;
    }
    const currentEditorVal = editorRef.current?.getValue();
    const isDefaultOrEmpty =
      currentEditorVal === undefined ||
      !currentEditorVal.trim() ||
      ANSATZ_LANGUAGES.some((l) => l.defaultCode === currentEditorVal);
    const isBufferDirty =
      currentEditorVal !== undefined && !isDefaultOrEmpty && currentEditorVal !== lastLoadedContentRef.current;

    if (isBufferDirty) {
      setPendingSelection(className);
      setDirtyDialogOpen(true);
      return;
    }
    loadClassRef.current(className, kind);
  }, []);

  const handleTreeHighlight = useCallback((name: string | null) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ansatz:highlight-component", { detail: { name } }));
    }
  }, []);

  useEffect(() => {
    if (props.embed) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const currentVal = editorRef.current?.getValue();
      const baseline = props.initialCode ?? lastLoadedContentRef.current;
      if (currentVal !== undefined && baseline !== undefined && currentVal !== baseline) {
        event.preventDefault();
        return "";
      }
      return undefined;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [props.embed, props.initialCode]);

  // Fetch diagram data via LSP when selected component, diagram type, or file changes
  useEffect(() => {
    const langInfo = getLanguageInfo(dialect);
    const requiresClassName = dialect === "modelica" || dialect === "modelscript";
    const effectiveClassName = requiresClassName ? selectedTreeClassName : null;
    if (!langInfo.supportsDiagram || (requiresClassName && !effectiveClassName)) {
      setDiagramData(null);
      setIsDiagramLoading(false);
      return;
    }

    let cancelled = false;
    const targetKey = `${documentUri}|${dialect}|${effectiveClassName ?? ""}|${diagramType}`;
    const isTargetSwitch = lastDiagramTargetKeyRef.current !== targetKey;
    lastDiagramTargetKeyRef.current = targetKey;

    if (isTargetSwitch) {
      setDiagramData(null);
      setIsDiagramLoading(true);
    } else if (!diagramDataRef.current || diagramDataRef.current.isLoading) {
      setIsDiagramLoading(true);
    }

    const currentCode = editorRef.current?.getValue() ?? lastLoadedContentRef.current ?? content;
    getDiagramData(
      documentUri,
      effectiveClassName || undefined,
      diagramType,
      sidecarContent,
      currentCode,
      dialect === "psse" ? psseDiagramOptions : undefined,
    )
      .then((data) => {
        if (cancelled) return;
        setDiagramData(data);
        if (data?.isLoading) {
          setIsDiagramLoading(true);
          setTimeout(() => {
            if (!cancelled) {
              setContextVersion((v) => v + 1);
            }
          }, 600);
        } else {
          setIsDiagramLoading(false);
        }
      })
      .catch((e) => {
        console.error("Failed to fetch diagram data:", e);
        if (cancelled) return;
        setDiagramData(null);
        setIsDiagramLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentUri, dialect, selectedTreeClassName, diagramType, sidecarContent, contextVersion, psseDiagramOptions]);

  const handleFlatten = async () => {
    try {
      const result = await (await import("./util/lsp-bridge")).flatten(selectedTreeClassName ?? "", documentUri);
      if (result.text) {
        setFlattenedCode(result.text);
        setFlattenDialogOpen(true);
      } else if (result.error) {
        toast.error("Failed to flatten model: " + result.error);
      }
    } catch (e) {
      console.error("Flattening failed:", e);
      toast.error("Failed to flatten model: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleAutoLayout = useCallback(async () => {
    const applied = await diagramEditorRef.current?.layout();
    if (applied) {
      const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);
      toast.info(`Auto-layout applied (${isMac ? "⌘Z" : "Ctrl+Z"} to undo)`);
    }
  }, [toast]);

  useEffect(() => {
    const handleToolbarAction = (ev: Event) => {
      const detail = (
        ev as CustomEvent<
          | {
              button?: {
                id: string;
                label: string;
                command?: string;
                actionId?: string;
              };
              languageId?: string;
              view?: string;
            }
          | undefined
        >
      ).detail;
      const btn = detail?.button;
      if (!btn) return;

      switch (btn.command) {
        case "ansatz:autoLayout":
          void handleAutoLayout();
          return;
        case "ansatz:flatten":
          void handleFlatten();
          return;
        case "ansatz:runLints":
          void handleRunOnDemandLints("all");
          return;
        case "ansatz:runFormalLints":
          void handleRunOnDemandLints("formal");
          return;
        case "ansatz:runCompilerLints":
          void handleRunOnDemandLints("compiler");
          return;
        case "ansatz:simulate":
          void handleSimulate();
          return;
        case "ansatz:deleteIconPrimitive": {
          const match = /^__icon_gfx_(\d+)$/.exec(selectedComponent ?? "");
          if (!match) {
            toast.info("Select an icon shape first");
            return;
          }
          const idx = Number(match[1]);
          handleSelectComponent(null);
          enqueueDiagramAction({ type: "deleteIconPrimitive", index: idx });
          return;
        }
        default:
          if (btn.command?.startsWith("ansatz:addIconPrimitive:")) {
            const shapeId = btn.command.slice("ansatz:addIconPrimitive:".length);
            const tool = MODELICA_ICON_SHAPE_TOOLS.find((t) => t.id === shapeId);
            if (tool) {
              enqueueDiagramAction({
                type: "addIconPrimitive",
                primitive: tool.primitive,
              });
            }
            return;
          }
          if (btn.command?.startsWith("ansatz:reorderIconPrimitive:")) {
            const dir = btn.command.slice("ansatz:reorderIconPrimitive:".length);
            const match = /^__icon_gfx_(\d+)$/.exec(selectedComponent ?? "");
            if (!match) {
              toast.info("Select an icon shape first");
              return;
            }
            const fromIndex = Number(match[1]);
            const toIndex = dir === "forward" ? fromIndex + 1 : Math.max(0, fromIndex - 1);
            if (toIndex !== fromIndex) {
              enqueueDiagramAction({ type: "reorderIconPrimitive", fromIndex, toIndex });
            }
            return;
          }
          if (btn.command?.startsWith("ansatz:insertStencil:")) {
            const stencilLabel = btn.command.slice("ansatz:insertStencil:".length);
            const langId = detail?.languageId || dialect || "modelica";
            const stencils = getEditorLanguageUi().stencils[langId] ?? [];
            const match = stencils.find((s) => s.label === stencilLabel);
            if (match?.snippet) {
              handleInsertStencilSnippet(match.snippet, match.className);
            }
            return;
          }
          break;
      }

      if (btn.actionId === "flatten") {
        void handleFlatten();
        return;
      }
      if (btn.actionId && btn.actionId.startsWith("simulate")) {
        void handleSimulate();
        return;
      }
      if (btn.actionId) {
        const langId = detail?.languageId || dialect || "modelica";
        const actionId = btn.actionId;
        const label = btn.label || actionId;
        void (async () => {
          try {
            toast.info(`Running ${label}…`);
            const { executeLspAction } = await import("./util/lsp-bridge");
            const documentText = editorRef.current?.getValue() ?? lastLoadedContent;
            const res = await executeLspAction(actionId, langId, documentUri, { documentText });
            window.dispatchEvent(
              new CustomEvent("ansatz:toolbar-action-result", {
                detail: { button: btn, languageId: langId, actionId, result: res },
              }),
            );
            if (res && typeof res === "object" && "error" in res && res.error) {
              toast.error(`${label} failed: ${String(res.error)}`);
              return;
            }
            if (
              langId === "owl2" &&
              (actionId === "validate_consistency" || actionId === "explain_inferences" || actionId === "query_sparql")
            ) {
              setShowResultsView(false);
              setShowCadView(false);
              setShowAnalysisView(true);
              if (view === "code") setView("split");
              const rec = res && typeof res === "object" ? (res as Record<string, unknown>) : null;
              const summary =
                typeof rec?.["formattedSummary"] === "string" ? rec["formattedSummary"] : `${label} completed`;
              if (rec?.["consistent"] === false) {
                toast.error(summary);
              } else if (Array.isArray(rec?.["unsatisfiableClasses"]) && rec["unsatisfiableClasses"].length > 0) {
                toast.warning(summary);
              } else {
                toast.success(summary);
              }
              return;
            }
            const outputText =
              typeof res === "string"
                ? res
                : res && typeof res === "object"
                  ? typeof (res as Record<string, unknown>).text === "string"
                    ? ((res as Record<string, unknown>).text as string)
                    : typeof (res as Record<string, unknown>).report === "string"
                      ? ((res as Record<string, unknown>).report as string)
                      : typeof (res as Record<string, unknown>).output === "string"
                        ? ((res as Record<string, unknown>).output as string)
                        : JSON.stringify(res, null, 2)
                  : "";
            if (outputText) {
              setFlattenedCode(outputText);
              setFlattenDialogOpen(true);
              toast.success(`${label} completed`);
            } else {
              toast.success(`${label} completed`);
            }
          } catch (err) {
            console.error(`[Ansatz] Action '${actionId}' failed:`, err);
            toast.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
      }
    };

    window.addEventListener("ansatz:toolbar-action", handleToolbarAction);
    return () => window.removeEventListener("ansatz:toolbar-action", handleToolbarAction);
  }, [
    dialect,
    documentUri,
    enqueueDiagramAction,
    handleAutoLayout,
    handleInsertStencilSnippet,
    handleRunOnDemandLints,
    handleSelectComponent,
    handleSimulate,
    lastLoadedContent,
    selectedComponent,
    toast,
  ]);

  const handleNewModel = useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const defaultCode = getLanguageInfo(dialect).defaultCode;
      if (editorRef.current) {
        editorRef.current.setValue(defaultCode);
      }
      setLastLoadedContent(defaultCode);
      setSidecarContent(undefined);
      didOpen(documentUri, defaultCode, dialect);
      const primary = dialect === "modelica" || !dialect ? extractPrimaryModelicaClassName(defaultCode) : null;
      setSelectedTreeClassName(primary);
      setContextVersion((v) => v + 1);
    },
    [dialect, documentUri],
  );

  const handleSaveModel = useCallback(async () => {
    const currentContent = editor?.getValue() || "";
    props.onSave?.(currentContent);
    const ext = getLanguageExtension(dialect);
    let filename = `model.${ext}`;
    if ((dialect === "modelica" || dialect === "modelscript") && codeEditorRef.current) {
      const synced = await codeEditorRef.current.sync();
      const firstNamed = Array.isArray(synced) ? (synced[0] as { name?: string } | undefined) : undefined;
      if (firstNamed?.name) {
        filename = `${firstNamed.name}.${ext}`;
      }
    }
    if (filename === `model.${ext}`) {
      const nameMatch = /(?:model|package|block|class|connector|record|function)\s+([A-Za-z_]\w*)/.exec(currentContent);
      if (nameMatch?.[1]) {
        filename = `${nameMatch[1]}.${ext}`;
      }
    }
    const blob = new Blob([currentContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [editor, props, dialect]);

  const isParameterRibbonVisible = Boolean(
    (props.embed || props.showParameterRibbon) && ribbonParams.length > 0 && view !== View.CODE && !showAnalysisView,
  );

  const isAnsatzEditorRoute =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/editor") ||
      window.location.pathname.startsWith("/editor") ||
      window.location.pathname.startsWith("/sketch") ||
      window.location.pathname.startsWith("/ansatz"));
  const isFloatingWorkspace =
    !isNarrow && Boolean(props.embed || props.hideCenterFloatingToolbar || isAnsatzEditorRoute);
  const floatingTopOffset = props.embed ? 12 : 72;
  const isFullScreenSplitCanvas = isFloatingWorkspace && isSplit(view);
  const diagnosticsBottomOffset =
    !isNarrow && !props.embed
      ? 12 + (isDiagnosticsExpanded ? diagnosticsPanelHeight : COLLAPSED_DIAGNOSTICS_HEIGHT) + 12
      : 12;
  const aiPanelWidth = 380;
  const isAiDockedDesktop = hasAnsatzAi && !props.embed && isAiOpen && !isNarrow;
  const floatingRightOffset = isAiDockedDesktop ? 12 + aiPanelWidth + 12 : 12;
  const floatingCardShadow =
    colorMode === "dark"
      ? "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 16px 40px -8px rgba(0, 0, 0, 0.56)"
      : "0 1px 0 rgba(255, 255, 255, 0.8) inset, 0 10px 32px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.05)";

  return (
    <>
      <div
        className="d-flex flex-column"
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <AnsatzMobileTabBar
          isNarrow={isNarrow}
          mobileTab={mobileTab}
          setMobileTab={setMobileTab}
          setTreeVisible={setTreeVisible}
          setView={setView}
          setShowResultsView={setShowResultsView}
          setShowCadView={setShowCadView}
          setShowAnalysisView={setShowAnalysisView}
          onSimulate={handleSimulate}
          simulationStatus={simulationStatus}
          dialect={dialect}
          onSelectDialect={handleSelectDialect}
          onNewModel={!props.embed ? handleNewModel : undefined}
          onOpenFile={!props.embed ? () => setIsOpenFileDialogOpen(true) : undefined}
          onSaveModel={!props.embed ? handleSaveModel : undefined}
          onAutoLayout={handleAutoLayout}
          onFlatten={handleFlatten}
          onOpenCloudModal={!props.embed ? () => setIsCloudModalOpen(true) : undefined}
          hasParameterRibbon={isParameterRibbonVisible}
        />

        <div
          className="d-flex flex-1"
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "row",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            height: "100%",
            overflow: "hidden",
            position: "relative",
            padding: isNarrow || isFloatingWorkspace ? 0 : 8,
            gap: isNarrow || isFloatingWorkspace ? 0 : 8,
            backgroundColor: "var(--ms-bg-alt, var(--color-canvas-default, #ffffff))",
            boxSizing: "border-box",
          }}
        >
          <AnsatzLeftSidebar
            treeVisible={treeVisible}
            setTreeVisible={(next) => {
              setTreeVisible((prev) => {
                const resolved = typeof next === "function" ? next(prev) : next;
                props.onSidebarLayoutChange?.({ visible: resolved, width: treeWidth });
                return resolved;
              });
            }}
            isNarrow={isNarrow}
            treeWidth={treeWidth}
            setTreeWidth={(nextWidth) => {
              setTreeWidth(nextWidth);
              props.onSidebarLayoutChange?.({ visible: treeVisible, width: nextWidth });
            }}
            colorMode={colorMode}
            showResultsView={showResultsView}
            translations={translations}
            libraryFilter={libraryFilter}
            setLibraryFilter={setLibraryFilter}
            isSearchExpanded={isSearchExpanded}
            setIsSearchExpanded={setIsSearchExpanded}
            isSearching={isSearching}
            inputRef={inputRef}
            addLibraryButtonRef={addLibraryButtonRef}
            onOpenAddLibrary={() => {
              setAddLibraryViewMode("libraries");
              setIsAddLibraryOpen(true);
            }}
            onOpenAddComponent={() => {
              setAddLibraryViewMode("components");
              setIsAddLibraryOpen(true);
            }}
            documentUri={documentUri}
            debouncedFilter={debouncedFilter}
            onTreeSelect={handleTreeSelect}
            onTreeHighlight={handleTreeHighlight}
            contextVersion={contextVersion}
            language={dialect}
            diagramData={diagramData}
            selectedComponent={selectedComponent}
            onSelectComponent={handleSelectComponent}
            simulationVariables={simulationVariables}
            selectedSimulationVariables={selectedSimulationVariables}
            onToggleSimulationVariable={handleToggleSimulationVariable}
            simulationParameters={simulationParameters}
            parameterOverrides={parameterOverrides}
            onParameterChange={handleParameterChange}
            onParameterReset={handleParameterReset}
            sweepState={sweepState}
            onSweepChange={setSweepState}
            experimentOverrides={experimentOverrides}
            onExperimentOverrideChange={handleExperimentOverrideChange}
            onExperimentOverrideReset={handleExperimentOverrideReset}
            cachedSimulator={cachedSimulator}
            onSimulate={handleSimulate}
            onOpenCloud={() => setIsCloudModalOpen(true)}
            isSimulating={simulationStatus?.status === "pending" || simulationStatus?.status === "processing"}
            floating={isFloatingWorkspace}
            floatingTopOffset={props.sidebarFullHeight ? 12 : floatingTopOffset}
            projectFiles={
              props.projectFiles ?? { [`model.${getLanguageInfo(dialect || "modelica").ext || "mo"}`]: content }
            }
            activeFileName={props.activeFileName ?? `model.${getLanguageInfo(dialect || "modelica").ext || "mo"}`}
            onSelectProjectFile={props.onSelectProjectFile}
            onAddProjectFile={props.onAddProjectFile}
            onOpenNewModelModal={props.onOpenNewModelModal ?? (() => setIsOpenFileDialogOpen(true))}
            isLoadingModel={props.isLoadingModel}
            onRemoveProjectFile={props.onRemoveProjectFile}
            onRenameProjectFile={props.onRenameProjectFile}
            onMoveProjectFile={props.onMoveProjectFile}
            fileDiagnosticCounts={fileDiagnosticCounts}
            dirtyFiles={props.dirtyFiles}
          />

          <div
            style={
              isFloatingWorkspace
                ? {
                    display: "contents",
                  }
                : {
                    display: isNarrow && mobileTab === "params" ? "none" : "flex",
                    flex: 1,
                    flexDirection: "column",
                    minHeight: 0,
                    minWidth: 0,
                    height: "100%",
                    overflow: "hidden",
                    position: "relative",
                    gap: isNarrow ? 0 : 8,
                  }
            }
          >
            <div
              className={`d-flex flex-1 ${view === View.SPLIT_ROWS ? "flex-column" : ""}`}
              ref={splitContainerRef}
              style={
                isFloatingWorkspace && isSplit(view) && !isFullScreenSplitCanvas
                  ? {
                      display: "flex",
                      position: "absolute",
                      top: 72,
                      left: treeVisible ? treeWidth + 24 : 12,
                      right: floatingRightOffset,
                      bottom: diagnosticsBottomOffset,
                      flexDirection: view === View.SPLIT_ROWS ? "column" : "row",
                      minHeight: 0,
                      minWidth: 0,
                      overflow: "hidden",
                      gap: 12,
                    }
                  : {
                      display: isNarrow && mobileTab === "params" ? "none" : "flex",
                      flex: 1,
                      flexDirection: view === View.SPLIT_ROWS ? "column" : "row",
                      minHeight: 0,
                      minWidth: 0,
                      height: isFloatingWorkspace ? "100%" : undefined,
                      overflow: "hidden",
                      position: isFloatingWorkspace ? "absolute" : "relative",
                      inset: isFloatingWorkspace ? 0 : undefined,
                      gap: isNarrow ? 0 : isSplit(view) && !isFullScreenSplitCanvas ? 4 : 0,
                    }
              }
            >
              {/* Visualizer Pane (Diagram / 3D / Simulation / Inspector on the left in split view) */}
              <AnsatzVisualizerPane
                isLoadingModel={props.isLoadingModel}
                view={view}
                isNarrow={isNarrow}
                mobileTab={mobileTab}
                splitRatio={splitRatio}
                nestedModels={nestedModels}
                selectedModelIndex={selectedModelIndex}
                setSelectedModelIndex={setSelectedModelIndex}
                setSelectedTreeClassName={setSelectedTreeClassName}
                colorMode={colorMode}
                translations={translations}
                dialect={dialect}
                diagramType={diagramType}
                setDiagramType={setDiagramType}
                vtkBuffer={vtkBuffer}
                editorValue={editorValue}
                drillDownPath={drillDownPath}
                onDrillUp={handleDrillUp}
                onDrillRoot={handleDrillRoot}
                onNodeDoubleClick={handleNodeDoubleClick}
                onRevealLine={handleRevealLine}
                onInsertStencilSnippet={handleInsertStencilSnippet}
                showResultsView={showResultsView}
                setShowResultsView={setShowResultsView}
                showCadView={showCadView}
                setShowCadView={setShowCadView}
                cadComponents={cadComponents}
                gdtOverlay={gdtOverlay}
                animationMode={animationMode}
                animationControllerRef={animationControllerRef}
                diagramEditorRef={diagramEditorRef}
                diagramData={diagramData}
                psseDiagramOptions={psseDiagramOptions}
                onPsseDiagramOptionsChange={setPsseDiagramOptions}
                selectedTreeClassName={selectedTreeClassName}
                selectedComponent={selectedComponent}
                setSelectedComponent={setSelectedComponent}
                isDiagramLoading={isDiagramLoading}
                setIsDiagramLoading={setIsDiagramLoading}
                handleSelectComponent={handleSelectComponent}
                enqueueDiagramAction={enqueueDiagramAction}
                onResetSpatialCooldown={() => {
                  lastDiagramEditTimeRef.current = 0;
                  isSpatialEditPending.current = false;
                }}
                onDiagramUndo={() => {
                  lastDiagramEditTimeRef.current = 0;
                  isSpatialEditPending.current = false;
                  const entry = sidecarHistoryRef.current.undo.pop();
                  if (!entry) return true;
                  sidecarHistoryRef.current.redo.push(entry);
                  setSidecarContent(entry.prev);
                  persistSidecarToProjectFiles(entry.prev);
                  setContextVersion((v) => v + 1);
                  return entry.hadTextEdit;
                }}
                onDiagramRedo={() => {
                  lastDiagramEditTimeRef.current = 0;
                  isSpatialEditPending.current = false;
                  const entry = sidecarHistoryRef.current.redo.pop();
                  if (!entry) return true;
                  sidecarHistoryRef.current.undo.push(entry);
                  setSidecarContent(entry.next);
                  persistSidecarToProjectFiles(entry.next);
                  setContextVersion((v) => v + 1);
                  return entry.hadTextEdit;
                }}
                editor={editor}
                editorRef={editorRef}
                isSpatialEditPending={isSpatialEditPending}
                propertiesWidth={propertiesWidth}
                setPropertiesWidth={setPropertiesWidth}
                selectedComponentProperties={selectedComponentProperties}
                isPropertiesLoading={isPropertiesLoading}
                diagnosticsBottomOffset={diagnosticsBottomOffset}
                expectedComponentNameRef={expectedComponentNameRef}
                handleSaveCadBindings={handleSaveCadBindings}
                handleCommitCadGizmoDelta={handleCommitCadGizmoDelta}
                handleCommitCadDimensionDelta={handleCommitCadDimensionDelta}
                handleCommitCadFaceTag={handleCommitCadFaceTag}
                handleCommitCadAssemblyJoint={handleCommitCadAssemblyJoint}
                simulationVariables={simulationVariables || []}
                selectedSimulationVariables={selectedSimulationVariables}
                cosimDataSource={cosimDataSource}
                setCosimDataSource={setCosimDataSource}
                handleReplaySession={handleReplaySession}
                localSimulationData={localSimulationData}
                pscadComplianceReport={pscadComplianceReport}
                pscadExports={pscadExports}
                sweepResults={sweepResults}
                simulationStatus={simulationStatus}
                amplSolveResult={amplSolveResult}
                handleVariablesLoaded={handleVariablesLoaded}
                treeVisible={treeVisible}
                setTreeVisible={setTreeVisible}
                setView={setView}
                onAutoLayout={handleAutoLayout}
                onSimulate={handleSimulate}
                onOpenCloudModal={() => setIsCloudModalOpen(true)}
                onFlatten={handleFlatten}
                hideCenterFloatingToolbar={props.hideCenterFloatingToolbar}
                showAnalysisView={showAnalysisView}
                setShowAnalysisView={setShowAnalysisView}
                documentUri={documentUri}
                projectFiles={props.projectFiles}
                activeFileName={props.activeFileName}
                onSelectProjectFile={props.onSelectProjectFile}
                onUpdateProjectFile={props.onUpdateProjectFile}
                loadingProgress={loadingProgress}
                onLoadStarterExample={handleLoadStarterExample}
                isSplitActive={isSplit(view)}
                canSplit={props.canSplit ?? true}
                splitOrientation={props.splitOrientation}
                treeWidth={treeWidth}
                onSelectView={(target) => {
                  if (props.onViewChange) {
                    props.onViewChange(target);
                  } else {
                    applyViewMode(target);
                  }
                }}
                onToggleSplit={
                  props.onToggleSplit ??
                  (() => {
                    if (isSplit(view)) {
                      setView(View.DIAGRAM);
                    } else {
                      const splitMode =
                        props.splitOrientation === "rows" ||
                        (props.splitOrientation !== "columns" && windowWidth < 960 && windowHeight >= 560)
                          ? View.SPLIT_ROWS
                          : View.SPLIT_COLUMNS;
                      setView(splitMode);
                    }
                  })
                }
              />

              {/* Split Resizer */}
              {isSplit(view) && !isNarrow && (
                <AnsatzResizeHandle
                  orientation={view === View.SPLIT_COLUMNS ? "vertical" : "horizontal"}
                  ariaLabel="Resize split panes"
                  ariaValueNow={Math.round(splitRatio * 100)}
                  ariaValueMin={20}
                  ariaValueMax={80}
                  isDragging={isSplitResizerDragging}
                  style={{
                    width: view === View.SPLIT_COLUMNS ? 8 : isFullScreenSplitCanvas ? "auto" : "100%",
                    height: view === View.SPLIT_ROWS ? 8 : isFullScreenSplitCanvas ? "auto" : "100%",
                    marginLeft: view === View.SPLIT_COLUMNS && !isFullScreenSplitCanvas ? -4 : 0,
                    marginRight: view === View.SPLIT_COLUMNS && !isFullScreenSplitCanvas ? -4 : 0,
                    marginTop: view === View.SPLIT_ROWS && !isFullScreenSplitCanvas ? -4 : 0,
                    marginBottom: view === View.SPLIT_ROWS && !isFullScreenSplitCanvas ? -4 : 0,
                    position: isFullScreenSplitCanvas ? "absolute" : "relative",
                    ...(isFullScreenSplitCanvas && view === View.SPLIT_COLUMNS
                      ? {
                          top: floatingTopOffset,
                          bottom: diagnosticsBottomOffset,
                          left: `max(${treeVisible ? treeWidth + 24 - 4 : 8}px, calc(${splitRatio * 100}% - 4px))`,
                        }
                      : isFullScreenSplitCanvas && view === View.SPLIT_ROWS
                        ? {
                            left: treeVisible ? treeWidth + 24 : 12,
                            right: floatingRightOffset,
                            top: `max(${Math.max(8, floatingTopOffset - 4)}px, calc(${splitRatio * 100}% - 4px))`,
                          }
                        : {}),
                    zIndex: isFullScreenSplitCanvas ? 25 : 10,
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setSplitRatio((prev) => Math.max(0.2, Number((prev - 0.05).toFixed(2))));
                    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                      e.preventDefault();
                      setSplitRatio((prev) => Math.min(0.8, Number((prev + 0.05).toFixed(2))));
                    } else if (e.key === "Home") {
                      e.preventDefault();
                      setSplitRatio(0.2);
                    } else if (e.key === "End") {
                      e.preventDefault();
                      setSplitRatio(0.8);
                    }
                  }}
                  onDoubleClick={() => {
                    setSplitRatio(DEFAULT_SPLIT_RATIO);
                  }}
                  onTouchStart={() => {
                    isDraggingSplit.current = true;
                    setIsSplitResizerDragging(true);
                    document.body.style.userSelect = "none";
                  }}
                  onTouchMove={(e) => {
                    if (!isDraggingSplit.current || !splitContainerRef.current) return;
                    const touch = e.touches[0];
                    if (!touch) return;
                    const rect = splitContainerRef.current.getBoundingClientRect();
                    if (view === View.SPLIT_COLUMNS) {
                      const x = touch.clientX - rect.left;
                      const ratio = Math.min(0.8, Math.max(0.2, x / rect.width));
                      setSplitRatio(ratio);
                    } else {
                      const y = touch.clientY - rect.top;
                      const ratio = Math.min(0.8, Math.max(0.2, y / rect.height));
                      setSplitRatio(ratio);
                    }
                  }}
                  onTouchEnd={() => {
                    isDraggingSplit.current = false;
                    setIsSplitResizerDragging(false);
                    document.body.style.userSelect = "";
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    isDraggingSplit.current = true;
                    setIsSplitResizerDragging(true);
                    const onMouseMove = (ev: MouseEvent) => {
                      if (!isDraggingSplit.current || !splitContainerRef.current) return;
                      const rect = splitContainerRef.current.getBoundingClientRect();
                      if (view === View.SPLIT_COLUMNS) {
                        const x = ev.clientX - rect.left;
                        const ratio = Math.min(0.8, Math.max(0.2, x / rect.width));
                        setSplitRatio(ratio);
                      } else {
                        const y = ev.clientY - rect.top;
                        const ratio = Math.min(0.8, Math.max(0.2, y / rect.height));
                        setSplitRatio(ratio);
                      }
                    };
                    const onMouseUp = () => {
                      isDraggingSplit.current = false;
                      setIsSplitResizerDragging(false);
                      document.removeEventListener("mousemove", onMouseMove);
                      document.removeEventListener("mouseup", onMouseUp);
                      document.body.style.cursor = "";
                      document.body.style.userSelect = "";
                    };
                    document.addEventListener("mousemove", onMouseMove);
                    document.addEventListener("mouseup", onMouseUp);
                    document.body.style.cursor = view === View.SPLIT_COLUMNS ? "col-resize" : "row-resize";
                    document.body.style.userSelect = "none";
                  }}
                />
              )}

              {/* Code Editor (on the right in split view) */}
              <div
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes("Files")) {
                    e.preventDefault();
                    setIsEditorDragOver(true);
                  }
                }}
                onDragLeave={() => setIsEditorDragOver(false)}
                onDrop={handleEditorDrop}
                style={{
                  display:
                    (view === View.CODE || isSplit(view)) && (!isNarrow || mobileTab === "code") ? "flex" : "none",
                  flex: isNarrow ? 1 : isSplit(view) ? "none" : 1,
                  position:
                    (isFloatingWorkspace && view === View.CODE) || isFullScreenSplitCanvas ? "absolute" : undefined,
                  zIndex: isFullScreenSplitCanvas ? 20 : undefined,
                  top:
                    (isFloatingWorkspace && view === View.CODE) ||
                    (isFullScreenSplitCanvas && view === View.SPLIT_COLUMNS)
                      ? floatingTopOffset
                      : isFullScreenSplitCanvas && view === View.SPLIT_ROWS
                        ? `max(${floatingTopOffset}px, calc(${splitRatio * 100}% + 6px))`
                        : undefined,
                  left:
                    (isFloatingWorkspace && view === View.CODE) || (isFullScreenSplitCanvas && view === View.SPLIT_ROWS)
                      ? treeVisible
                        ? treeWidth + 24
                        : 12
                      : isFullScreenSplitCanvas && view === View.SPLIT_COLUMNS
                        ? `max(${treeVisible ? treeWidth + 24 : 12}px, calc(${splitRatio * 100}% + 6px))`
                        : undefined,
                  right:
                    (isFloatingWorkspace && view === View.CODE) || isFullScreenSplitCanvas
                      ? floatingRightOffset
                      : undefined,
                  bottom:
                    (isFloatingWorkspace && view === View.CODE) || isFullScreenSplitCanvas
                      ? diagnosticsBottomOffset
                      : undefined,
                  width:
                    (isFloatingWorkspace && view === View.CODE) || isFullScreenSplitCanvas
                      ? "auto"
                      : isNarrow
                        ? "100%"
                        : isSplit(view) && view === View.SPLIT_COLUMNS
                          ? `${(1 - splitRatio) * 100}%`
                          : isSplit(view)
                            ? undefined
                            : "100%",
                  height:
                    (isFloatingWorkspace && view === View.CODE) || isFullScreenSplitCanvas
                      ? "auto"
                      : isNarrow
                        ? "100%"
                        : isSplit(view) && view === View.SPLIT_ROWS
                          ? `${(1 - splitRatio) * 100}%`
                          : "100%",
                  flexDirection: "column",
                  minWidth: 0,
                  minHeight: 0,
                  outline: isEditorDragOver ? "2px dashed var(--ms-brand, #0891b2)" : "none",
                  outlineOffset: -2,
                  borderRadius: isNarrow ? 0 : 8,
                  border: isNarrow
                    ? "none"
                    : isFloatingWorkspace
                      ? "1px solid var(--ms-border, rgba(15, 23, 42, 0.12))"
                      : "1px solid var(--borderColor-muted, var(--ms-divider))",
                  boxShadow: isFloatingWorkspace ? floatingCardShadow : undefined,
                  overflow: "hidden",
                  backgroundColor: "var(--ms-bg, var(--color-canvas-default, #ffffff))",
                }}
              >
                {detectedDialectHint && (
                  <div
                    role="status"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      background: colorMode === "dark" ? "rgba(8, 145, 178, 0.16)" : "rgba(8, 145, 178, 0.1)",
                      borderBottom: `1px solid ${colorMode === "dark" ? "rgba(56, 189, 248, 0.35)" : "rgba(8, 145, 178, 0.3)"}`,
                      color: colorMode === "dark" ? "#e2e8f0" : "#0f172a",
                    }}
                  >
                    <span>
                      Detected <strong>{detectedDialectHint.name}</strong> ({detectedDialectHint.reason}).
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={acceptDetectedDialect}
                        style={{
                          padding: "3px 9px",
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 6,
                          border: "none",
                          cursor: "pointer",
                          background: "var(--ms-brand, #0891b2)",
                          color: "#ffffff",
                        }}
                      >
                        Switch to {detectedDialectHint.name}
                      </button>
                      <button
                        type="button"
                        aria-label="Dismiss dialect suggestion"
                        onClick={() => setDetectedDialectHint(null)}
                        style={{
                          padding: "2px 6px",
                          fontSize: 13,
                          lineHeight: 1,
                          borderRadius: 4,
                          border: "none",
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                          opacity: 0.75,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}
                <Suspense fallback={null}>
                  <CodeEditor
                    uri={documentUri}
                    languageId={dialect}
                    ref={codeEditorRef}
                    embed={props.embed ?? false}
                    setEditor={setEditor}
                    content={content}
                    onChange={(nextText) => {
                      handleClearOnDemandLints();
                      pendingCodeEchoesRef.current.push(nextText);
                      if (pendingCodeEchoesRef.current.length > 64) {
                        pendingCodeEchoesRef.current.shift();
                      }
                      props.onCodeChange?.(nextText);
                    }}
                    onParsed={() => {
                      if (dialect !== "modelica" && dialect !== "modelscript") {
                        setContextVersion((v) => v + 1);
                      }
                    }}
                    onPaste={handleEditorPaste}
                    onDiagnostics={handleDiagnosticsChange}
                    onSimulate={handleSimulate}
                    theme={colorMode === "dark" ? "vs-dark" : "light"}
                    externalErrors={
                      simulationStatus?.status === "failed" && simulationStatus.error ? [simulationStatus.error] : []
                    }
                    externalMarkers={activeOnDemandMarkers}
                  />
                </Suspense>
              </div>
            </div>
            {!isNarrow && !props.embed && (
              <AnsatzDiagnosticsPanel
                diagnostics={mergedEditorDiagnostics}
                projectDiagnostics={projectDiagnostics}
                activeFileName={props.activeFileName}
                colorMode={colorMode}
                isFloatingWorkspace={isFloatingWorkspace}
                treeVisible={treeVisible}
                treeWidth={treeWidth}
                isExpanded={isDiagnosticsExpanded}
                onToggleExpand={handleToggleDiagnostics}
                panelHeight={diagnosticsPanelHeight}
                onResizeHeight={setDiagnosticsPanelHeight}
                onSelectDiagnostic={handleSelectDiagnostic}
                onRunOnDemandLints={handleRunOnDemandLints}
                onClearOnDemandLints={handleClearOnDemandLints}
                isRunningOnDemandLints={isRunningOnDemandLints}
                hasOnDemandResults={activeOnDemandMarkers.length > 0}
                onSelectProjectDiagnostic={(fileName, marker) => {
                  if (fileName !== props.activeFileName) {
                    props.onSelectProjectFile?.(fileName);
                    setTimeout(() => handleSelectDiagnostic(marker), 80);
                  } else {
                    handleSelectDiagnostic(marker);
                  }
                }}
                onFixWithAi={
                  hasAnsatzAi
                    ? (marker, fileName) => {
                        setAiInitialPrompt(
                          `Please fix this diagnostic in ${fileName || props.activeFileName || "the active file"} at line ${marker.startLineNumber}: ${marker.message}`,
                        );
                        setIsAiOpen(true);
                      }
                    : undefined
                }
              />
            )}
          </div>

          {hasAnsatzAi && !props.embed && (
            <AnsatzAiPanel
              isOpen={isAiOpen}
              onClose={() => setIsAiOpen(false)}
              colorMode={colorMode}
              floating={isFloatingWorkspace}
              topOffset={floatingTopOffset}
              bottomOffset={diagnosticsBottomOffset}
              isNarrow={isNarrow}
              width={aiPanelWidth}
              fileName={props.activeFileName || `model.${getLanguageExtension(dialect)}`}
              dialect={dialect}
              diagnostics={formatMonacoMarkers(mergedEditorDiagnostics)}
              initialPrompt={aiInitialPrompt}
              onConsumeInitialPrompt={() => setAiInitialPrompt(undefined)}
              toolHost={
                {
                  getFileName: () => props.activeFileName || `model.${getLanguageExtension(dialect)}`,
                  getDialect: () => dialect,
                  getCode: () => editor?.getValue() ?? content,
                  getDiagnostics: () => formatMonacoMarkers(mergedEditorDiagnostics),
                  getSelectedComponent: () => selectedTreeClassName || undefined,
                  applyCodeEdit: (nextCode, description) => {
                    const model = editor?.getModel();
                    if (!editor || !model) {
                      setLoadedCodeOverride(nextCode);
                      props.onCodeChange?.(nextCode);
                      return true;
                    }
                    editor.executeEdits(description || "ansatz-ai", [
                      { range: model.getFullModelRange(), text: nextCode, forceMoveMarkers: true },
                    ]);
                    return true;
                  },
                  runFlatten: async () => {
                    await handleFlatten();
                    return { ok: true, output: flattenedCode || "Flatten triggered in Ansatz." };
                  },
                  runSimulate: async () => {
                    await handleSimulate();
                    return {
                      ok: simulationStatus?.status !== "failed",
                      output: simulationStatus?.error
                        ? `Simulation failed: ${simulationStatus.error}`
                        : `Simulation status: ${simulationStatus?.status ?? "completed"}`,
                    };
                  },
                  switchView: (nextView) => setView(nextView as View),
                  getDiagramSummary: async () => {
                    const diagram = await getDiagramData(documentUri, selectedTreeClassName || undefined);
                    return JSON.stringify(diagram ?? {});
                  },
                } satisfies AnsatzToolHost
              }
            />
          )}
        </div>

        {/* Floating dock */}
        {!props.embed && !props.hideFloatingDock && (
          <AnsatzFloatingDock
            colorMode={colorMode}
            treeVisible={treeVisible}
            setTreeVisible={setTreeVisible}
            translations={translations}
            dialect={dialect}
            onSelectDialect={handleSelectDialect}
            onNewModel={handleNewModel}
            openFileButtonRef={openFileButtonRef}
            onOpenFile={() => setIsOpenFileDialogOpen(true)}
            onSaveModel={handleSaveModel}
            onAutoLayout={handleAutoLayout}
            view={view}
            setView={setView}
            isNarrow={isNarrow}
            onSimulate={handleSimulate}
            onOpenCloudModal={() => setIsCloudModalOpen(true)}
            onFlatten={handleFlatten}
            onRunOnDemandLints={handleRunOnDemandLints}
            isRunningOnDemandLints={isRunningOnDemandLints}
            shareButtonRef={shareButtonRef}
            isShareDialogOpen={isShareDialogOpen}
            setShareDialogOpen={setShareDialogOpen}
            availableLanguages={availableLanguages}
            language={language}
            setLanguage={setLanguage}
            setContextVersion={setContextVersion}
            isDark={isDark}
            toggleTheme={toggleTheme}
            isAiOpen={isAiOpen}
            onToggleAi={() => setIsAiOpen((v) => !v)}
          />
        )}

        {/* Modals & Dialogs */}
        <AnsatzModals
          isShareDialogOpen={isShareDialogOpen}
          setShareDialogOpen={setShareDialogOpen}
          shareButtonRef={shareButtonRef}
          documentModels={documentModels}
          selectedModelIndex={selectedModelIndex}
          selectedTreeClassName={selectedTreeClassName}
          editor={editor}
          translations={translations}
          toast={toast}
          colorMode={colorMode}
          dialect={dialect}
          documentUri={documentUri}
          onSelectDialect={handleSelectDialect}
          onSelectTreeClassName={setSelectedTreeClassName}
          onPlaceComponent={handleInsertStencilSnippet}
          setLastLoadedContent={setLastLoadedContent}
          parameterOverrides={parameterOverrides}
          isDirtyDialogOpen={isDirtyDialogOpen}
          setDirtyDialogOpen={setDirtyDialogOpen}
          pendingSelection={pendingSelection}
          setPendingSelection={setPendingSelection}
          loadClass={loadClass}
          isOpenFileDialogOpen={isOpenFileDialogOpen}
          setIsOpenFileDialogOpen={setIsOpenFileDialogOpen}
          openFileButtonRef={openFileButtonRef}
          loadingProgress={loadingProgress}
          loadingMessage={loadingMessage}
          isAddLibraryOpen={isAddLibraryOpen}
          setIsAddLibraryOpen={setIsAddLibraryOpen}
          addLibraryInitialViewMode={addLibraryViewMode}
          setContextVersion={setContextVersion}
          isFlattenDialogOpen={isFlattenDialogOpen}
          setFlattenDialogOpen={setFlattenDialogOpen}
          flattenedCode={flattenedCode}
          isCloudModalOpen={isCloudModalOpen}
          setIsCloudModalOpen={setIsCloudModalOpen}
          experimentOverrides={experimentOverrides}
          content={content}
          onCloudResultLoaded={(data) => {
            if (Array.isArray(data?.t) && Array.isArray(data?.y)) {
              const states: string[] = Array.isArray(data.states) ? data.states : [];
              const rowMajorY = data.t.map((_: number, tIdx: number) =>
                data.y.map((col: number[]) => col?.[tIdx] ?? 0),
              );
              const chartRows: Record<string, number | string>[] = data.t.map((tVal: number, tIdx: number) => {
                const row: Record<string, number | string> = { time: tVal };
                states.forEach((st: string, sIdx: number) => {
                  row[st] = rowMajorY[tIdx]?.[sIdx] ?? 0;
                });
                return row;
              });
              const varNames = states.filter((s: string) => s !== "time");
              setSimulationVariables(varNames);
              setSelectedSimulationVariables(varNames.slice(0, 6));
              setLocalSimulationData(chartRows);
            } else if (Array.isArray(data?.series)) {
              setLocalSimulationData(data.series);
            }
            setShowResultsView(true);
            setSimulationStatus({ status: "completed", error: null });
            setIsCloudModalOpen(false);
          }}
        />

        <WorkspaceSymbolModal
          isOpen={isWorkspaceSymbolOpen}
          onClose={() => setIsWorkspaceSymbolOpen(false)}
          onSelectSymbol={handleSelectWorkspaceSymbol}
          colorMode={colorMode}
        />

        {(props.embed || props.showParameterRibbon) &&
          ribbonParams.length > 0 &&
          view !== View.CODE &&
          !showAnalysisView && (
            <ParameterSliderRibbon
              parameters={ribbonParams}
              overrides={parameterOverrides}
              onChange={handleRibbonParamChange}
              onReset={handleRibbonParamReset}
              onSimulate={handleSimulate}
              isSimulating={simulationStatus?.status === "pending" || simulationStatus?.status === "processing"}
              dark={colorMode === "dark"}
              defaultExpanded={props.defaultRibbonExpanded ?? !props.hideCenterFloatingToolbar}
              fullWidth={Boolean(props.hideCenterFloatingToolbar)}
              hasFloatingDock={
                !props.embed &&
                !props.hideFloatingDock &&
                !isNarrow &&
                !(typeof window !== "undefined" && window.location.pathname.startsWith("/editor"))
              }
            />
          )}
      </div>
    </>
  );
}
