// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DynamicBindingConfig, GdtOverlayPayload } from "@modelscript/cad";
import type { ComponentPropertyData } from "@modelscript/diagram";
import {
  FlowchartIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PulseIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  StackIcon,
  TableIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import { Breadcrumbs, Button, IconButton, SegmentedControl, UnderlineNav } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useEditorCapabilities as useCapabilities,
  useEditorHost,
  useEditorFeatureFlag as useFeatureFlag,
} from "../../host";
import Spinner from "../../internal/Spinner";
import type {
  CadComponent,
  CommitAssemblyJointPayload,
  CommitDimensionPayload,
  CommitFaceTagPayload,
  GizmoCommitPayload,
} from "../cad-viewer";
import type { AnimationController } from "../cad-viewer/animation-controller";
import { getLanguageInfo } from "../constants";
import { CosimPanel, type HistorianSession } from "../CosimPanel";
import DiagramEditor, { type DiagramDataProp, type DiagramEditorHandle } from "../Diagram";
import PropertiesWidget from "../Properties";
import type { Translations } from "../util/i18n";
import { getDiagramPalette } from "../util/lsp-bridge";
import {
  buildRotundaCanvasDocument,
  type RotundaCadPartInput,
  type RotundaModelEntry,
  type RotundaModelKind,
} from "../vr-rotunda/types";
import { AmplOptimizationResults } from "./AmplOptimizationResults";
import { AnsatzCalibrationPanel } from "./AnsatzCalibrationPanel";
import { AnsatzDigitalThreadPanel } from "./AnsatzDigitalThreadPanel";
import type { MobileTab } from "./AnsatzMobileTabBar";
import { IconPrimitiveInspector } from "./inspectors/IconPrimitiveInspector";
import { PolyglotDomainPanel } from "./PolyglotDomainPanel";
import { PscadComponentWizardModal } from "./PscadComponentWizardModal";
import { AnsatzView } from "./types";

const CadViewerPanel = React.lazy(() => import("../cad-viewer").then((m) => ({ default: m.CadViewer })));
const EngineeringRotundaPanel = React.lazy(() => import("../vr-rotunda/EngineeringRotunda"));
const SimulationResults = React.lazy(() =>
  import("../SimulationResults").then((m) => ({ default: m.SimulationResults })),
);
const AnsatzRtmContractsPanel = React.lazy(() =>
  import("./AnsatzRtmContractsPanel").then((m) => ({ default: m.AnsatzRtmContractsPanel })),
);
const AnsatzOptimizationUqPanel = React.lazy(() =>
  import("./AnsatzOptimizationUqPanel").then((m) => ({ default: m.AnsatzOptimizationUqPanel })),
);
const AnsatzReplPanel = React.lazy(() => import("./AnsatzReplPanel").then((m) => ({ default: m.AnsatzReplPanel })));

import { getDslStencilsForDialect } from "../util/LanguagePanelHost";

interface StencilItem {
  label: string;
  snippet: string;
  className?: string;
}

function getStencilsForDialect(dialect: string): StencilItem[] {
  const dslStencils = getDslStencilsForDialect(dialect);
  if (dslStencils && dslStencils.length > 0) {
    return dslStencils;
  }
  return [
    { label: "Parameter", snippet: "parameter Real k_new = 1.0;\n" },
    { label: "Component", snippet: "// Added element\n" },
  ];
}

function lookupProjectFileContent(files: Record<string, string> | undefined, artifactUri: string): string | null {
  if (!files) return null;
  const trimmed = artifactUri.trim();
  if (!trimmed) return null;
  const cleanPath = trimmed.split(/[?#]/)[0] ?? trimmed;
  if (Object.prototype.hasOwnProperty.call(files, trimmed)) {
    const val = files[trimmed];
    if (typeof val === "string") return val;
  }
  if (Object.prototype.hasOwnProperty.call(files, cleanPath)) {
    const val = files[cleanPath];
    if (typeof val === "string") return val;
  }
  const normalized = cleanPath.replace(/^(?:inmemory|file|workspace|modelica):\/\//i, "").replace(/^\.?\//, "");
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(files, normalized)) {
    const val = files[normalized];
    if (typeof val === "string") return val;
  }
  for (const [key, content] of Object.entries(files)) {
    if (typeof content !== "string") continue;
    const normKey = key.replace(/^\.?\//, "");
    if (normKey === normalized || normKey.endsWith(`/${normalized}`) || normalized.endsWith(`/${normKey}`)) {
      return content;
    }
  }
  return null;
}

function isFetchableArtifactUri(uri: string): boolean {
  return uri.startsWith("/") || uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("blob:");
}

export interface AnsatzVisualizerPaneProps {
  dialect?: string | undefined;
  diagramType?: string | undefined;
  setDiagramType?: ((type: string) => void) | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  editorValue?: string | undefined;
  drillDownPath?: string[] | undefined;
  onDrillUp?: ((index: number) => void) | undefined;
  onDrillRoot?: (() => void) | undefined;
  onNodeDoubleClick?: ((nodeId: string, nodeData?: unknown) => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  onInsertStencilSnippet?: ((snippet: string, className?: string) => void) | undefined;
  view: AnsatzView;
  isNarrow: boolean;
  mobileTab: MobileTab;
  splitRatio: number;
  nestedModels: Array<{ name: string; kind?: string }>;
  selectedModelIndex: number;
  setSelectedModelIndex: (i: number) => void;
  setSelectedTreeClassName: (name: string | null) => void;
  colorMode: "dark" | "light";
  translations: Translations;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  amplSolveResult?: React.ComponentProps<typeof AmplOptimizationResults>["result"];
  showCadView: boolean;
  setShowCadView: (v: boolean) => void;
  cadComponents: CadComponent[];
  animationMode: "stopped" | "playing" | "paused" | "live";
  animationControllerRef: React.RefObject<AnimationController | null>;
  diagramEditorRef?: React.RefObject<DiagramEditorHandle | null> | undefined;
  diagramData: DiagramDataProp;
  selectedTreeClassName: string | null;
  selectedComponent: string | null;
  setSelectedComponent: (comp: string | null) => void;
  isDiagramLoading: boolean;
  isLoadingModel?: boolean | undefined;
  setIsDiagramLoading: (loading: boolean) => void;
  handleSelectComponent: (name: string | null, cachedProps?: unknown, isLoading?: boolean) => void;
  enqueueDiagramAction: (action: Record<string, unknown>) => void;
  onResetSpatialCooldown?: (() => void) | undefined;
  onDiagramUndo?: (() => boolean) | undefined;
  onDiagramRedo?: (() => boolean) | undefined;
  editor: editor.ICodeEditor | null;
  editorRef: React.RefObject<editor.ICodeEditor | null>;
  isSpatialEditPending: React.MutableRefObject<boolean>;
  propertiesWidth: number;
  setPropertiesWidth: (w: number) => void;
  selectedComponentProperties: ComponentPropertyData | null;
  isPropertiesLoading: boolean;
  expectedComponentNameRef: React.MutableRefObject<string | null>;
  handleSaveCadBindings: (componentName: string, bindings: DynamicBindingConfig[]) => void;
  handleCommitCadGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  handleCommitCadDimensionDelta?: ((payload: CommitDimensionPayload) => void) | undefined;
  handleCommitCadFaceTag?: ((payload: CommitFaceTagPayload) => void) | undefined;
  handleCommitCadAssemblyJoint?: ((payload: CommitAssemblyJointPayload) => void) | undefined;
  simulationVariables: string[];
  selectedSimulationVariables: string[];
  onToggleSimulationVariable?: ((variable: string) => void) | undefined;
  cosimDataSource: "local" | "mqtt-live" | "historian-replay";
  setCosimDataSource: (ds: "local" | "mqtt-live" | "historian-replay") => void;
  handleReplaySession: (session: HistorianSession, speed: number) => void;
  localSimulationData: Record<string, number | string>[] | null;
  pscadComplianceReport?: unknown;
  pscadExports?: Record<string, unknown> | null | undefined;
  sweepResults: { value: number; y: number[][] }[] | null;
  simulationStatus: {
    status: "pending" | "processing" | "completed" | "failed" | "running" | "error" | "idle";
    error?: string | null | undefined;
    progress?: number | undefined;
    message?: string | undefined;
    jobId?: string | undefined;
  } | null;
  handleVariablesLoaded: (vars: string[]) => void;
  treeVisible?: boolean | undefined;
  setTreeVisible?: React.Dispatch<React.SetStateAction<boolean>> | undefined;
  setView?: ((v: AnsatzView) => void) | undefined;
  onAutoLayout?: (() => void) | undefined;
  onSimulate?: (() => void) | undefined;
  onOpenCloudModal?: (() => void) | undefined;
  onFlatten?: (() => void) | undefined;
  hideCenterFloatingToolbar?: boolean | undefined;
  showAnalysisView?: boolean | undefined;
  setShowAnalysisView?: ((v: boolean) => void) | undefined;
  documentUri?: string | undefined;
  loadingProgress?: number | undefined;
  onLoadStarterExample?:
    ((code: string, title?: string, files?: Record<string, string>, activeFile?: string) => void) | undefined;
  gdtOverlay?: GdtOverlayPayload | null | undefined;
  isSplitActive?: boolean | undefined;
  canSplit?: boolean | undefined;
  splitOrientation?: "columns" | "rows" | undefined;
  onSelectView?: ((target: "diagram" | "3d" | "simulation" | "inspector" | "code") => void) | undefined;
  onToggleSplit?: (() => void) | undefined;
  treeWidth?: number | undefined;
  diagnosticsBottomOffset?: number | undefined;
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  onSelectProjectFile?: ((fileName: string) => void) | undefined;
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  psseDiagramOptions?:
    | {
        focusBus?: number | undefined;
        kHops?: number | undefined;
        layoutMode?: "auto" | "geographic" | undefined;
      }
    | undefined;
  onPsseDiagramOptionsChange?:
    | React.Dispatch<
        React.SetStateAction<{
          focusBus?: number | undefined;
          kHops?: number | undefined;
          layoutMode?: "auto" | "geographic" | undefined;
        }>
      >
    | undefined;
}

const isSplit = (v: AnsatzView) => v === AnsatzView.SPLIT_COLUMNS || v === AnsatzView.SPLIT_ROWS;

export const AnsatzVisualizerPane: React.FC<AnsatzVisualizerPaneProps> = ({
  dialect = "modelica",
  diagramType = "diagram",
  setDiagramType,
  vtkBuffer,
  editorValue = "",
  drillDownPath = [],
  onDrillUp,
  onDrillRoot,
  onNodeDoubleClick,
  onRevealLine,
  onInsertStencilSnippet,
  view,
  isNarrow,
  mobileTab,
  splitRatio,
  nestedModels,
  selectedModelIndex,
  setSelectedModelIndex,
  setSelectedTreeClassName,
  colorMode,
  translations,
  showResultsView,
  setShowResultsView,
  amplSolveResult,
  showCadView,
  setShowCadView,
  cadComponents,
  gdtOverlay = null,
  animationMode,
  animationControllerRef,
  diagramEditorRef,
  diagramData,
  selectedTreeClassName,
  selectedComponent,
  setSelectedComponent,
  isDiagramLoading,
  isLoadingModel,
  setIsDiagramLoading,
  handleSelectComponent,
  enqueueDiagramAction,
  onResetSpatialCooldown,
  onDiagramUndo,
  onDiagramRedo,
  editor,
  editorRef,
  isSpatialEditPending,
  propertiesWidth,
  setPropertiesWidth,
  selectedComponentProperties,
  isPropertiesLoading,
  expectedComponentNameRef,
  handleSaveCadBindings,
  handleCommitCadGizmoDelta,
  handleCommitCadDimensionDelta,
  handleCommitCadFaceTag,
  handleCommitCadAssemblyJoint,
  simulationVariables,
  selectedSimulationVariables,
  onToggleSimulationVariable,
  cosimDataSource,
  setCosimDataSource,
  handleReplaySession,
  localSimulationData,
  pscadComplianceReport,
  pscadExports,
  sweepResults,
  simulationStatus,
  handleVariablesLoaded,
  treeVisible,
  setTreeVisible,
  setView: _setView,
  onAutoLayout,
  onSimulate,
  onOpenCloudModal: _onOpenCloudModal,
  onFlatten: _onFlatten,
  hideCenterFloatingToolbar = false,
  showAnalysisView: controlledShowAnalysisView,
  setShowAnalysisView: controlledSetShowAnalysisView,
  documentUri,
  loadingProgress,
  onLoadStarterExample,
  isSplitActive: _isSplitActive,
  canSplit: _canSplit = true,
  splitOrientation: _splitOrientation = "columns",
  onSelectView: _onSelectView,
  onToggleSplit: _onToggleSplit,
  treeWidth = 260,
  diagnosticsBottomOffset = 12,
  projectFiles,
  activeFileName,
  onSelectProjectFile,
  onUpdateProjectFile,
  psseDiagramOptions,
  onPsseDiagramOptionsChange,
}) => {
  const { hasCapability } = useCapabilities();
  const _isCaeComputeEnabled = useFeatureFlag("cae_cloud_solver");
  const isCosimMqttEnabled = hasCapability("cosimMqtt");
  const isTimescaleEnabled = hasCapability("timescaleHistorian");
  const showCosimSection = isCosimMqttEnabled || isTimescaleEnabled;
  const isDraggingProperties = useRef(false);
  const [isPropResizerHovered, setIsPropResizerHovered] = useState(false);
  const [isPropResizerDragging, setIsPropResizerDragging] = useState(false);
  const [isEmptyStateDismissed, setIsEmptyStateDismissed] = useState(false);
  const hasMultiFileProject = Boolean(projectFiles && Object.keys(projectFiles).length >= 2);
  const [inspectorSubtab, setInspectorSubtab] = useState<"domain" | "thread" | "calibrate" | "rtm" | "uq" | "repl">(
    "domain",
  );

  useEffect(() => {
    setIsEmptyStateDismissed(false);
  }, [dialect]);

  const [internalShowAnalysisView, setInternalShowAnalysisView] = useState(false);
  const showAnalysisView = controlledShowAnalysisView ?? internalShowAnalysisView;
  const setShowAnalysisView = controlledSetShowAnalysisView ?? setInternalShowAnalysisView;
  const [showVrRotunda, setShowVrRotunda] = useState(false);
  const [capturedDiagramSvgUrl, setCapturedDiagramSvgUrl] = useState<string | null>(null);
  const prevCenterPaneKeyRef = useRef(`${showResultsView ? 1 : 0}:${showCadView ? 1 : 0}:${showAnalysisView ? 1 : 0}`);
  useEffect(() => {
    const nextKey = `${showResultsView ? 1 : 0}:${showCadView ? 1 : 0}:${showAnalysisView ? 1 : 0}`;
    if (prevCenterPaneKeyRef.current !== nextKey) {
      prevCenterPaneKeyRef.current = nextKey;
      setShowVrRotunda(false);
    }
  }, [showResultsView, showCadView, showAnalysisView]);
  const [showPalette, setShowPalette] = useState(false);
  const [showComponentWizard, setShowComponentWizard] = useState(false);
  const [lspPaletteCategories, setLspPaletteCategories] = useState<
    { id: string; label: string; items: { type?: string; label: string; snippet?: string; className?: string }[] }[]
  >([]);
  const [activePaletteCategory, setActivePaletteCategory] = useState<string>("");
  const lastPaletteKeyRef = useRef<string>("");
  useEffect(() => {
    if (!showPalette) return;
    const paletteUri = documentUri || `inmemory://model.${dialect === "pscad" ? "pscx" : dialect}`;
    const paletteKey = `${dialect}|${paletteUri}`;
    if (lastPaletteKeyRef.current === paletteKey && lspPaletteCategories.length > 0) return;
    let cancelled = false;
    getDiagramPalette(paletteUri)
      .then((res) => {
        if (cancelled) return;
        lastPaletteKeyRef.current = paletteKey;
        if (!res?.categories?.length) {
          setLspPaletteCategories([]);
          return;
        }
        const cats = res.categories.map((c) => ({
          id: String(c.id || c.name || c.label || "General"),
          label: String(c.label || c.name || c.id || "General"),
          items: Array.isArray(c.items) ? c.items : [],
        }));
        setLspPaletteCategories(cats);
        if (cats[0]) setActivePaletteCategory(cats[0].id);
      })
      .catch(() => {
        if (!cancelled) setLspPaletteCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showPalette, dialect, documentUri, lspPaletteCategories.length]);
  const internalDiagramRef = useRef<DiagramEditorHandle>(null);
  const effectiveDiagramRef = diagramEditorRef ?? internalDiagramRef;
  const openVrRotunda = useCallback(() => {
    const svgUrl = effectiveDiagramRef.current?.exportSvgDataUrl?.() ?? null;
    setCapturedDiagramSvgUrl(svgUrl);
    setShowVrRotunda(true);
  }, [effectiveDiagramRef]);
  const toggleVrRotunda = useCallback(() => {
    if (showVrRotunda) {
      setShowVrRotunda(false);
    } else {
      openVrRotunda();
    }
  }, [showVrRotunda, openVrRotunda]);
  useEffect(() => {
    if (!showVrRotunda) return;
    if (isDiagramLoading || !diagramData || diagramData.isLoading) return;
    const timer = window.setTimeout(() => {
      const svgUrl = effectiveDiagramRef.current?.exportSvgDataUrl?.() ?? null;
      if (svgUrl) {
        setCapturedDiagramSvgUrl(svgUrl);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [showVrRotunda, isDiagramLoading, diagramData, effectiveDiagramRef]);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const [isMinimapActive, setIsMinimapActive] = useState(false);
  const [gridMode, setGridMode] = useState<"doubleMesh" | "dot" | "mesh" | "none">(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem("modelscript.diagram.gridMode");
      if (saved === "doubleMesh" || saved === "dot" || saved === "mesh" || saved === "none") {
        return saved;
      }
    }
    return "doubleMesh";
  });
  const [isSnapActive, setIsSnapActive] = useState(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem("modelscript.diagram.snapToGrid");
      if (saved !== null) {
        return saved === "true";
      }
    }
    return true;
  });
  const [showGridMenu, setShowGridMenu] = useState(false);
  const gridMenuRef = useRef<HTMLDivElement>(null);

  const toggleMinimapView = () => {
    const next = effectiveDiagramRef?.current?.toggleMinimap() ?? !isMinimapActive;
    setIsMinimapActive(next);
  };

  const handleGridModeChange = (mode: "doubleMesh" | "dot" | "mesh" | "none") => {
    setGridMode(mode);
    effectiveDiagramRef?.current?.setGridMode(mode);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("modelscript.diagram.gridMode", mode);
    }
  };

  const handleSnapToggle = () => {
    const next = !isSnapActive;
    setIsSnapActive(next);
    effectiveDiagramRef?.current?.setSnapToGrid(next);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("modelscript.diagram.snapToGrid", String(next));
    }
  };

  useEffect(() => {
    if (!isDiagramLoading && effectiveDiagramRef?.current) {
      effectiveDiagramRef.current.setGridMode(gridMode);
      effectiveDiagramRef.current.setSnapToGrid(isSnapActive);
    }
  }, [isDiagramLoading, gridMode, isSnapActive, colorMode]);

  const hasCenteredOnLoadRef = useRef(false);
  useEffect(() => {
    hasCenteredOnLoadRef.current = false;
  }, [dialect, selectedTreeClassName]);

  useEffect(() => {
    if (loadingProgress !== undefined && loadingProgress >= 100 && !hasCenteredOnLoadRef.current) {
      if (!isDiagramLoading && diagramData && !diagramData.isLoading) {
        hasCenteredOnLoadRef.current = true;
        const timer = setTimeout(() => {
          effectiveDiagramRef?.current?.zoomToFit();
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [loadingProgress, isDiagramLoading, diagramData, effectiveDiagramRef]);

  const handleUndo = () => {
    if (isSpatialEditPending) isSpatialEditPending.current = false;
    onResetSpatialCooldown?.();
    const shouldUndoText = onDiagramUndo ? onDiagramUndo() : true;
    if (!shouldUndoText) {
      setIsDiagramLoading(false);
      return;
    }
    editorRef?.current?.focus();
    const prev = editorRef?.current?.getValue();
    editorRef?.current?.trigger("diagram", "undo", null);
    if (prev !== editorRef?.current?.getValue()) {
      setIsDiagramLoading(true);
    }
  };

  const handleRedo = () => {
    if (isSpatialEditPending) isSpatialEditPending.current = false;
    onResetSpatialCooldown?.();
    const shouldRedoText = onDiagramRedo ? onDiagramRedo() : true;
    if (!shouldRedoText) {
      setIsDiagramLoading(false);
      return;
    }
    editorRef?.current?.focus();
    const prev = editorRef?.current?.getValue();
    editorRef?.current?.trigger("diagram", "redo", null);
    if (prev !== editorRef?.current?.getValue()) {
      setIsDiagramLoading(true);
    }
  };

  const tessellatedBlobUrlsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const urls = tessellatedBlobUrlsRef.current;
    return () => {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        for (const url of urls.values()) {
          URL.revokeObjectURL(url);
        }
      }
      urls.clear();
    };
  }, []);

  const handleFetchArtifactBytes = useCallback(
    async (artifactUri: string): Promise<Uint8Array | null> => {
      const trimmed = artifactUri.trim();
      if (!trimmed) return null;

      const workspaceContent = lookupProjectFileContent(projectFiles, trimmed);
      if (workspaceContent !== null) {
        const encoded = new TextEncoder().encode(workspaceContent);
        return encoded.byteLength > 0 ? encoded : null;
      }

      if (
        vtkBuffer &&
        vtkBuffer.byteLength > 0 &&
        ((documentUri && trimmed === documentUri) ||
          (activeFileName && (trimmed === activeFileName || trimmed.endsWith(`/${activeFileName}`))))
      ) {
        return vtkBuffer;
      }

      if (typeof fetch !== "function" || !isFetchableArtifactUri(trimmed)) {
        return null;
      }

      try {
        const res = await fetch(trimmed);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return buf.byteLength > 0 ? new Uint8Array(buf) : null;
      } catch {
        return null;
      }
    },
    [projectFiles, vtkBuffer, documentUri, activeFileName],
  );

  const handleTessellateStep = useCallback(
    async (artifactUri: string): Promise<string | Uint8Array | null> => {
      const trimmed = artifactUri.trim();
      if (!trimmed) return null;

      const qIdx = trimmed.search(/[?#]/);
      const basePath = qIdx >= 0 ? trimmed.slice(0, qIdx) : trimmed;
      const suffix = qIdx >= 0 ? trimmed.slice(qIdx) : "";
      const lowerPath = basePath.toLowerCase();

      if (lowerPath.endsWith(".glb") || lowerPath.endsWith(".gltf")) {
        return trimmed;
      }

      if (!lowerPath.endsWith(".step") && !lowerPath.endsWith(".stp")) {
        return null;
      }

      const stem = basePath.replace(/\.(step|stp)$/i, "");

      const siblingWorkspaceVtk =
        lookupProjectFileContent(projectFiles, `${stem}.vtu`) ?? lookupProjectFileContent(projectFiles, `${stem}.vtk`);
      if (siblingWorkspaceVtk !== null) {
        const encoded = new TextEncoder().encode(siblingWorkspaceVtk);
        if (encoded.byteLength > 0) return encoded;
      }

      if (typeof fetch !== "function") {
        return null;
      }

      if (basePath.startsWith("/") || basePath.startsWith("http://") || basePath.startsWith("https://")) {
        const siblingGlb = `${stem}.glb${suffix}`;
        try {
          const glbRes = await fetch(siblingGlb, { method: "HEAD" });
          const glbType = glbRes.headers?.get?.("content-type")?.toLowerCase() ?? "";
          if (glbRes.ok && !glbType.includes("text/html")) {
            return siblingGlb;
          }
        } catch {
          // Safe fallback to next candidate
        }

        const siblingVtu = `${stem}.vtu${suffix}`;
        try {
          const vtuRes = await fetch(siblingVtu);
          const vtuType = vtuRes.headers?.get?.("content-type")?.toLowerCase() ?? "";
          if (vtuRes.ok && !vtuType.includes("text/html")) {
            const buf = await vtuRes.arrayBuffer();
            if (buf.byteLength > 0) return new Uint8Array(buf);
          }
        } catch {
          // Safe fallback to tessellation API endpoint
        }
      }

      try {
        const endpoint = `/api/v1/cad/tessellate?uri=${encodeURIComponent(trimmed)}`;
        const apiRes = await fetch(endpoint);
        if (!apiRes.ok) return null;
        const contentType = apiRes.headers?.get?.("content-type")?.toLowerCase() ?? "";
        if (contentType.includes("text/html")) return null;

        if (contentType.includes("application/json")) {
          const payload = (await apiRes.json()) as Record<string, unknown> | null;
          if (payload && typeof payload === "object") {
            const meshUrl = payload["glbUrl"] ?? payload["meshUrl"] ?? payload["url"];
            if (typeof meshUrl === "string" && meshUrl.trim().length > 0) {
              return meshUrl.trim();
            }
          }
          return null;
        }

        if (
          contentType.includes("model/gltf") &&
          typeof URL !== "undefined" &&
          typeof URL.createObjectURL === "function"
        ) {
          const blob = await apiRes.blob();
          if (blob.size > 0) {
            const prevUrl = tessellatedBlobUrlsRef.current.get(trimmed);
            if (prevUrl && typeof URL.revokeObjectURL === "function") {
              URL.revokeObjectURL(prevUrl);
            }
            const objectUrl = URL.createObjectURL(blob);
            tessellatedBlobUrlsRef.current.set(trimmed, objectUrl);
            return objectUrl;
          }
          return null;
        }

        const buf = await apiRes.arrayBuffer();
        return buf.byteLength > 0 ? new Uint8Array(buf) : null;
      } catch {
        return null;
      }
    },
    [projectFiles],
  );

  useEffect(() => {
    if (!showZoomMenu && !showGridMenu) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showZoomMenu && zoomMenuRef.current && !zoomMenuRef.current.contains(target)) {
        setShowZoomMenu(false);
      }
      if (showGridMenu && gridMenuRef.current && !gridMenuRef.current.contains(target)) {
        setShowGridMenu(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showZoomMenu, showGridMenu]);

  const activeLangInfo = getLanguageInfo(dialect);
  const stencils = useMemo(() => getStencilsForDialect(dialect), [dialect]);
  const isAnsatzEditorRoute =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/editor") ||
      window.location.pathname.startsWith("/editor") ||
      window.location.pathname.startsWith("/sketch") ||
      window.location.pathname.startsWith("/ansatz"));

  const supports3dView = activeLangInfo.supports3d || cadComponents.length > 0 || Boolean(vtkBuffer);
  const centerViewTabs = useMemo(() => {
    const tabs: Array<{
      id: "diagram" | "simulation" | "3d" | "inspector";
      label: string;
      icon: React.ComponentType<{ size?: number }>;
    }> = [];
    if (activeLangInfo.supportsDiagram) {
      tabs.push({ id: "diagram", label: translations.diagram, icon: WorkflowIcon });
    }
    if (activeLangInfo.supportsSimulation) {
      tabs.push({ id: "simulation", label: translations.simulation, icon: PulseIcon });
    }
    if (supports3dView) {
      tabs.push({
        id: "3d",
        label: cadComponents.length > 0 || vtkBuffer ? `3D (${cadComponents.length || 1})` : "3D",
        icon: StackIcon,
      });
    }
    tabs.push({
      id: "inspector",
      label:
        activeLangInfo.id === "owl2"
          ? "Reasoner & Axioms"
          : activeLangInfo.id === "sysml2"
            ? "Requirements"
            : "Inspector",
      icon: TableIcon,
    });
    return tabs;
  }, [
    activeLangInfo.id,
    activeLangInfo.supportsDiagram,
    activeLangInfo.supportsSimulation,
    supports3dView,
    cadComponents.length,
    vtkBuffer,
    translations.diagram,
    translations.simulation,
  ]);

  const effectiveDiagramType = useMemo(() => {
    const opts = activeLangInfo.diagramTypes;
    if (!opts || opts.length === 0) return diagramType;
    if (opts.some((d) => d.id === diagramType)) return diagramType;
    return opts[0]!.id;
  }, [activeLangInfo.diagramTypes, diagramType]);

  useEffect(() => {
    const nextResults = activeLangInfo.supportsSimulation ? showResultsView : false;
    const nextCad = supports3dView ? showCadView : false;
    if (nextResults !== showResultsView) {
      setShowResultsView(nextResults);
    }
    if (nextCad !== showCadView) {
      setShowCadView(nextCad);
    }
    if (!activeLangInfo.supportsDiagram && !nextResults && !nextCad && !showAnalysisView) {
      if (supports3dView) {
        setShowCadView(true);
      } else if (activeLangInfo.supportsSimulation) {
        setShowResultsView(true);
      } else {
        setShowAnalysisView(true);
      }
    }
  }, [
    activeLangInfo.supportsDiagram,
    activeLangInfo.supportsSimulation,
    supports3dView,
    showResultsView,
    showCadView,
    showAnalysisView,
    setShowResultsView,
    setShowCadView,
    setShowAnalysisView,
  ]);

  const hasUserCode = useMemo(() => {
    if (!editorValue) return false;
    const stripped = editorValue.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").trim();
    return stripped.length > 0;
  }, [editorValue]);

  const showEmptyState =
    !hideCenterFloatingToolbar &&
    !hasUserCode &&
    !isEmptyStateDismissed &&
    (loadingProgress === undefined || loadingProgress >= 100) &&
    (!diagramData?.nodes || diagramData.nodes.length === 0) &&
    !isDiagramLoading &&
    !showResultsView &&
    !showCadView &&
    !showAnalysisView &&
    !showVrRotunda;

  const rotundaTitle = selectedTreeClassName || activeFileName || activeLangInfo.name || dialect || "Model";

  const rotundaParameters = useMemo(() => {
    const params: Array<{ name: string; value: string | number; unit?: string | undefined }> = [];
    const rawParams = selectedComponentProperties?.parameters;
    if (Array.isArray(rawParams)) {
      for (const p of rawParams) {
        if (!p || typeof p.name !== "string" || !p.name.trim()) continue;
        const rawVal = p.value !== undefined && p.value !== "" ? p.value : p.defaultValue;
        if (rawVal === undefined || rawVal === null || rawVal === "") continue;
        const val: string | number = typeof rawVal === "number" || typeof rawVal === "string" ? rawVal : String(rawVal);
        params.push({
          name: p.name,
          value: val,
          unit: typeof p.unit === "string" && p.unit.trim() ? p.unit : undefined,
        });
      }
    }
    if (
      params.length === 0 &&
      selectedComponentProperties?.values &&
      typeof selectedComponentProperties.values === "object"
    ) {
      for (const [k, v] of Object.entries(selectedComponentProperties.values as Record<string, unknown>)) {
        if (v === undefined || v === null || v === "") continue;
        const val: string | number = typeof v === "number" || typeof v === "string" ? v : String(v);
        params.push({ name: k, value: val });
      }
    }
    return params.length > 0 ? params : undefined;
  }, [selectedComponentProperties]);

  const rotundaSimulationSeries = useMemo(() => {
    if (!localSimulationData || localSimulationData.length < 2) return undefined;
    const sampleRow = localSimulationData[0];
    if (!sampleRow) return undefined;
    const timeKey = "time" in sampleRow ? "time" : "t" in sampleRow ? "t" : null;
    const candidateKeys = (
      selectedSimulationVariables.length > 0 ? selectedSimulationVariables : Object.keys(sampleRow)
    ).filter((k) => k !== timeKey && k !== "time" && k !== "t");
    const palette = ["#38bdf8", "#f97316", "#22c55e", "#a855f7"];
    const series: Array<{
      id: string;
      label: string;
      color?: string | undefined;
      x: number[];
      y: number[];
    }> = [];
    for (const key of candidateKeys.slice(0, 4)) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let idx = 0; idx < localSimulationData.length; idx += 1) {
        const row = localSimulationData[idx];
        if (!row) continue;
        const yNum = Number(row[key]);
        if (!Number.isFinite(yNum)) continue;
        const xRaw = timeKey ? Number(row[timeKey]) : idx;
        xs.push(Number.isFinite(xRaw) ? xRaw : idx);
        ys.push(yNum);
      }
      if (ys.length >= 2) {
        series.push({
          id: key,
          label: key,
          color: palette[series.length % palette.length],
          x: xs,
          y: ys,
        });
      }
    }
    return series.length > 0 ? series : undefined;
  }, [localSimulationData, selectedSimulationVariables]);

  const rotundaDocument = useMemo(() => {
    const doc = buildRotundaCanvasDocument({
      title: rotundaTitle,
      languageId: dialect || "modelica",
      artifactUri: activeFileName || documentUri,
      diagramData: diagramData && typeof diagramData === "object" ? (diagramData as Record<string, unknown>) : null,
      simulationSeries: rotundaSimulationSeries,
      parameters: rotundaParameters,
      vtkBuffer: vtkBuffer ?? null,
    });
    if (capturedDiagramSvgUrl) {
      const primaryTile = doc.tiles["tile_primary_schematic"];
      if (primaryTile) {
        doc.tiles["tile_primary_schematic"] = {
          ...primaryTile,
          viewState: {
            ...primaryTile.viewState,
            capturedSvgDataUrl: capturedDiagramSvgUrl,
          },
        };
      }
    }
    return doc;
  }, [
    rotundaTitle,
    dialect,
    activeFileName,
    documentUri,
    diagramData,
    rotundaSimulationSeries,
    rotundaParameters,
    vtkBuffer,
    capturedDiagramSvgUrl,
  ]);

  const rotundaModels = useMemo<RotundaModelEntry[]>(() => {
    const normalizedDialect = (dialect || "modelica").toLowerCase();
    const lowerFile = (activeFileName || "").toLowerCase();
    const primaryKind: RotundaModelKind =
      normalizedDialect === "fea" || lowerFile.endsWith(".inp") || lowerFile.endsWith(".bdf")
        ? "fea"
        : normalizedDialect === "cfd" || lowerFile.endsWith(".su2") || lowerFile.endsWith(".vtu")
          ? "cfd"
          : normalizedDialect === "urdf" || lowerFile.endsWith(".urdf") || lowerFile.endsWith(".sdf")
            ? "urdf"
            : normalizedDialect === "gcode" || lowerFile.endsWith(".gcode") || lowerFile.endsWith(".nc")
              ? "gcode"
              : normalizedDialect === "step" || lowerFile.endsWith(".step") || lowerFile.endsWith(".stp")
                ? "step"
                : normalizedDialect === "simpack" || normalizedDialect === "gensys" || normalizedDialect === "adams"
                  ? "multibody"
                  : vtkBuffer
                    ? "vtk"
                    : "cad";

    const mappedCadParts: RotundaCadPartInput[] | undefined =
      cadComponents.length > 0
        ? cadComponents.map((comp) => {
            const rgba = comp.proceduralMesh?.color ?? comp.sourceMetadata?.color;
            const colorHex =
              rgba && rgba.length >= 3
                ? (() => {
                    const needs255Norm = rgba[0]! > 1 || rgba[1]! > 1 || rgba[2]! > 1;
                    return `#${[rgba[0]!, rgba[1]!, rgba[2]!]
                      .map((c) =>
                        Math.max(0, Math.min(255, Math.round(needs255Norm ? c : c * 255)))
                          .toString(16)
                          .padStart(2, "0"),
                      )
                      .join("")}`;
                  })()
                : undefined;
            const isBakedCsgMesh = Boolean(
              comp.proceduralMesh && !comp.defaults && !comp.cad?.uri?.startsWith("procedural://msl"),
            );
            return {
              name: comp.name,
              shape: comp.shapeType ?? comp.sourceMetadata?.primitiveType,
              color: colorHex,
              position: comp.cad?.position,
              rotation: isBakedCsgMesh ? undefined : comp.cad?.rotation,
              scale: isBakedCsgMesh ? undefined : comp.cad?.scale,
              url: comp.cad?.uri,
              proceduralMesh: comp.proceduralMesh
                ? {
                    vertices: comp.proceduralMesh.vertices,
                    indices: comp.proceduralMesh.indices,
                    normals: comp.proceduralMesh.normals,
                    color: colorHex,
                  }
                : undefined,
            };
          })
        : undefined;

    const firstGltfUri = cadComponents.find((c) => {
      const u = (c.cad?.uri ?? "").trim().toLowerCase();
      if (u.startsWith("data:model/gltf")) return true;
      return (
        (u.startsWith("/") || u.startsWith("http") || u.startsWith("blob:")) &&
        (u.endsWith(".glb") || u.endsWith(".gltf"))
      );
    })?.cad.uri;

    const primaryAccent =
      primaryKind === "fea"
        ? "#f97316"
        : primaryKind === "cfd"
          ? "#06b6d4"
          : primaryKind === "urdf"
            ? "#a855f7"
            : primaryKind === "gcode"
              ? "#f59e0b"
              : "#38bdf8";

    const models: RotundaModelEntry[] = [
      {
        id: `editor-primary-${normalizedDialect}`,
        title: rotundaTitle,
        subtitle:
          cadComponents.length > 0
            ? `${cadComponents.length} Active 3D CAD ${cadComponents.length === 1 ? "Part" : "Parts"}`
            : vtkBuffer
              ? "Live VTK Volumetric Field"
              : `${activeLangInfo.name || normalizedDialect.toUpperCase()} 3D Digital Twin`,
        kind: primaryKind,
        artifactUri: firstGltfUri ?? activeFileName ?? documentUri,
        vtkBuffer: vtkBuffer ?? null,
        cadComponents: mappedCadParts,
        sourceTileId: "tile_primary_cad",
        accentColor: primaryAccent,
      },
    ];

    if (models.length < 2) {
      if (primaryKind !== "fea") {
        models.push({
          id: `editor-twin-fea-${normalizedDialect}`,
          title: `${rotundaTitle} — Structural FEA`,
          subtitle: "Von Mises Stress & Modal Deflection Twin",
          kind: "fea",
          sourceTileId: "tile_primary_cad",
          accentColor: "#f97316",
        });
      }
      if (primaryKind !== "cfd") {
        models.push({
          id: `editor-twin-cfd-${normalizedDialect}`,
          title: `${rotundaTitle} — Aero/Thermal CFD`,
          subtitle: "Velocity Streamlines & Thermal Field Twin",
          kind: "cfd",
          sourceTileId: "tile_primary_cad",
          accentColor: "#06b6d4",
        });
      }
      if (models.length < 3 && primaryKind !== "cad") {
        models.push({
          id: `editor-twin-cad-${normalizedDialect}`,
          title: `${rotundaTitle} — B-Rep Assembly`,
          subtitle: "Parametric 3D CAD Reference Twin",
          kind: "cad",
          sourceTileId: "tile_primary_cad",
          accentColor: "#38bdf8",
        });
      }
    }

    return models;
  }, [dialect, activeFileName, documentUri, rotundaTitle, activeLangInfo.name, cadComponents, vtkBuffer]);

  const editorHost = useEditorHost();
  const starterExamples = useMemo(() => {
    const heroExamples = editorHost.heroExamples ?? [];
    const matches = heroExamples.filter((ex) => ex["lang"] === dialect);
    return matches.length > 0 ? matches.slice(0, 3) : heroExamples.slice(0, 3);
  }, [dialect, editorHost.heroExamples]);

  useEffect(() => {
    if (!showEmptyState) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsEmptyStateDismissed(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showEmptyState]);

  const handleDuplicateSelected = React.useCallback(() => {
    if (!selectedComponent) return;
    if (dialect === "pscad") {
      enqueueDiagramAction({
        type: "copySelection",
        ids: [selectedComponent],
        dx: 40,
        dy: 40,
      } as Parameters<typeof enqueueDiagramAction>[0]);
      return;
    }
    const node = diagramData?.nodes?.find((n) => n.id === selectedComponent);
    if (node) {
      const nodeExt = node as unknown as {
        type?: string;
        className?: string;
        data?: { className?: string };
        x?: number;
        y?: number;
      };
      const className =
        nodeExt.type || nodeExt.className || nodeExt.data?.className || selectedComponentProperties?.className;
      if (className) {
        enqueueDiagramAction({
          type: "addComponent",
          className,
          x: (nodeExt.x ?? 100) + 40,
          y: (nodeExt.y ?? 100) + 40,
        });
      }
    }
  }, [dialect, selectedComponent, diagramData?.nodes, selectedComponentProperties, enqueueDiagramAction]);

  const handleDeleteSelected = React.useCallback(() => {
    if (!selectedComponent) return;
    enqueueDiagramAction({ type: "deleteComponents", names: [selectedComponent] });
    handleSelectComponent(null);
  }, [selectedComponent, enqueueDiagramAction, handleSelectComponent]);

  const handleInspectSelected = React.useCallback(() => {
    if (!selectedComponent) return;
    setPropertiesWidth(Math.max(300, propertiesWidth));
  }, [selectedComponent, propertiesWidth, setPropertiesWidth]);

  // Global Escape key shortcut to deselect component and close properties inspector, plus selection hotkeys
  useEffect(() => {
    if (!selectedComponent) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        if (e.key === "Escape") {
          target.blur();
        }
        return;
      }
      if (e.key === "Escape") {
        handleSelectComponent(null);
      } else if (e.key === "r" || e.key === "R") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          effectiveDiagramRef?.current?.rotateSelected(e.shiftKey ? -90 : 90);
        }
      } else if (e.key === "f" || e.key === "F") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          effectiveDiagramRef?.current?.flipSelected?.(e.shiftKey ? "y" : "x");
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (e.key === "i" || e.key === "I") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          handleInspectSelected();
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedComponent,
    handleSelectComponent,
    effectiveDiagramRef,
    handleDuplicateSelected,
    handleInspectSelected,
    handleDeleteSelected,
  ]);

  const [backendHistorianSessions, setBackendHistorianSessions] = useState<HistorianSession[]>([]);

  useEffect(() => {
    if (cosimDataSource !== "historian-replay") return;
    let cancelled = false;
    fetch("/api/v1/historian/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = Array.isArray(data.sessions) ? data.sessions : Array.isArray(data) ? data : [];
        if (list.length > 0) {
          setBackendHistorianSessions(list);
        }
      })
      .catch(() => {
        // Fallback to local simulation buffer when backend historian is unavailable
      });
    return () => {
      cancelled = true;
    };
  }, [cosimDataSource]);

  const recordedSessions = useMemo<HistorianSession[]>(() => {
    if (backendHistorianSessions.length > 0) {
      return backendHistorianSessions;
    }
    if (!localSimulationData || localSimulationData.length === 0) return [];
    const lastRow = localSimulationData[localSimulationData.length - 1];
    const durationSec = typeof lastRow?.time === "number" ? lastRow.time : localSimulationData.length * 0.01;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
    return [
      {
        id: `sim-${selectedTreeClassName || dialect}-latest`,
        name: `Local Simulation Buffer: ${selectedTreeClassName || activeLangInfo.name || dialect} (${localSimulationData.length} pts)`,
        recordedAt: nowStr,
        durationSeconds: Number(durationSec),
        participantCount: 1,
        signalCount: simulationVariables.length,
      },
    ];
  }, [
    backendHistorianSessions,
    localSimulationData,
    selectedTreeClassName,
    dialect,
    activeLangInfo.name,
    simulationVariables,
  ]);

  const isFullScreenSplitCanvas = !isNarrow && (hideCenterFloatingToolbar || isAnsatzEditorRoute) && isSplit(view);
  const isFloatingLayout =
    !isNarrow && (hideCenterFloatingToolbar || isAnsatzEditorRoute) && (!isSplit(view) || isFullScreenSplitCanvas);
  const floatingLeftOffset = treeVisible ? treeWidth + 24 : 12;

  const cadFitInsets = useMemo(
    () =>
      isFloatingLayout
        ? {
            top: 84,
            left: floatingLeftOffset + 12,
            right:
              24 +
              (isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                ? Math.round((1 - splitRatio) * (typeof window !== "undefined" ? window.innerWidth : 1200))
                : 0),
            bottom:
              56 +
              (isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
                ? Math.round((1 - splitRatio) * (typeof window !== "undefined" ? window.innerHeight : 800))
                : 0),
          }
        : undefined,
    [isFloatingLayout, floatingLeftOffset, isFullScreenSplitCanvas, view, splitRatio],
  );

  // When full-bleed VR Rotunda is active in Ansatz/floating mode, suppress
  // the global `html { overflow-y: scroll; scrollbar-gutter: stable }` strip so
  // the 3D canvas stretches literally 100% edge-to-edge behind the floating navbar.
  useEffect(() => {
    if (!showVrRotunda || !(isAnsatzEditorRoute || isFloatingLayout)) return;
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const body = document.body;
    const prevRootOverflow = root.style.overflow;
    const prevRootGutter = root.style.getPropertyValue("scrollbar-gutter");
    const prevBodyOverflow = body.style.overflow;

    root.style.overflow = "hidden";
    root.style.setProperty("scrollbar-gutter", "auto");
    body.style.overflow = "hidden";

    return () => {
      root.style.overflow = prevRootOverflow;
      if (prevRootGutter) {
        root.style.setProperty("scrollbar-gutter", prevRootGutter);
      } else {
        root.style.removeProperty("scrollbar-gutter");
      }
      body.style.overflow = prevBodyOverflow;
    };
  }, [showVrRotunda, isAnsatzEditorRoute, isFloatingLayout]);

  if (!((view === AnsatzView.DIAGRAM || isSplit(view)) && (!isNarrow || mobileTab !== "code"))) {
    return null;
  }

  const floatingCardShadow =
    colorMode === "dark"
      ? "0 12px 36px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.28)"
      : "0 10px 32px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.05)";

  return (
    <div
      style={{
        display: "flex",
        flex: isNarrow || isFullScreenSplitCanvas ? 1 : isSplit(view) ? "none" : 1,
        width:
          isNarrow || isFullScreenSplitCanvas
            ? "100%"
            : isSplit(view) && view === AnsatzView.SPLIT_COLUMNS
              ? `${splitRatio * 100}%`
              : isSplit(view)
                ? undefined
                : "100%",
        height:
          isNarrow || isFullScreenSplitCanvas
            ? "100%"
            : isSplit(view) && view === AnsatzView.SPLIT_ROWS
              ? `${splitRatio * 100}%`
              : "100%",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        backgroundColor: "var(--color-canvas-default, #ffffff)",
        borderRadius: isNarrow || isFloatingLayout ? 0 : 16,
        border: isNarrow || isFloatingLayout ? "none" : "1px solid var(--borderColor-muted, rgba(15, 23, 42, 0.08))",
        boxShadow:
          isSplit(view) && !isFullScreenSplitCanvas && !isNarrow && (hideCenterFloatingToolbar || isAnsatzEditorRoute)
            ? floatingCardShadow
            : undefined,
        overflow: "hidden",
      }}
    >
      {nestedModels.length > 1 && (
        <UnderlineNav
          aria-label="Models"
          style={{
            flexShrink: 0,
            backgroundColor: "var(--bgColor-muted, var(--ms-bg-elv))",
            borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
            minHeight: 38,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          {nestedModels.map((model, index) => (
            <UnderlineNav.Item
              key={model.name ?? index}
              aria-current={selectedModelIndex === index ? "page" : undefined}
              onSelect={(e) => {
                e.preventDefault();
                setSelectedModelIndex(index);
                setSelectedTreeClassName(model.name);
              }}
            >
              {model.name ?? `Model ${index + 1}`}
            </UnderlineNav.Item>
          ))}
        </UnderlineNav>
      )}

      {/* Floating View Switcher & Actions (Only in standalone embedded mode without top workbench navbar) */}
      {!hideCenterFloatingToolbar &&
        !isAnsatzEditorRoute &&
        (!isNarrow ||
          showVrRotunda ||
          (!showResultsView && !showCadView && !showAnalysisView) ||
          cadComponents.length > 0 ||
          (showCadView && Boolean(animationControllerRef.current?.hasData))) && (
          <div
            style={{
              position: "absolute",
              top: nestedModels.length > 1 ? "48px" : "12px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "max-content",
              maxWidth: "calc(100% - 24px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              zIndex: 100,
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "center",
                gap: 6,
                maxWidth: "100%",
                boxSizing: "border-box",
                padding: isNarrow ? "4px 8px" : "6px 10px",
                borderRadius: 12,
                backgroundColor: "var(--ms-surface-glass)",
                backdropFilter: "blur(12px)",
                boxShadow:
                  colorMode === "dark"
                    ? "0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))"
                    : "0 4px 24px rgba(0, 0, 0, 0.1), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))",
              }}
            >
              {isAnsatzEditorRoute && !isNarrow && setTreeVisible && (
                <>
                  <IconButton
                    icon={treeVisible ? SidebarExpandIcon : SidebarCollapseIcon}
                    size="small"
                    variant="invisible"
                    aria-label={translations.toggleTree}
                    title={translations.toggleTree}
                    onClick={() => setTreeVisible((prev) => !prev)}
                    style={
                      treeVisible
                        ? {
                            backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
                            borderRadius: 6,
                          }
                        : {}
                    }
                  />
                  <div
                    style={{ width: 1, height: 18, backgroundColor: "var(--ms-border, var(--color-border-default))" }}
                  />
                </>
              )}

              {!isNarrow && (
                <SegmentedControl
                  aria-label="Center Pane View"
                  size="small"
                  variant="default"
                  onChange={(i) => {
                    const targetTab = centerViewTabs[i];
                    if (!targetTab) return;
                    setShowVrRotunda(false);
                    if (targetTab.id === "diagram") {
                      setShowResultsView(false);
                      setShowCadView(false);
                      setShowAnalysisView(false);
                    } else if (targetTab.id === "simulation") {
                      setShowResultsView(true);
                      setShowCadView(false);
                      setShowAnalysisView(false);
                    } else if (targetTab.id === "3d") {
                      setShowResultsView(false);
                      setShowCadView(true);
                      setShowAnalysisView(false);
                    } else if (targetTab.id === "inspector") {
                      setShowResultsView(false);
                      setShowCadView(false);
                      setShowAnalysisView(true);
                    }
                  }}
                >
                  {centerViewTabs.map((tab) => {
                    const isSelected =
                      !showVrRotunda &&
                      (tab.id === "diagram"
                        ? !showResultsView && !showCadView && !showAnalysisView
                        : tab.id === "simulation"
                          ? showResultsView && !showAnalysisView
                          : tab.id === "3d"
                            ? showCadView && !showAnalysisView
                            : showAnalysisView);
                    return (
                      <SegmentedControl.Button key={tab.id} selected={isSelected} leadingVisual={tab.icon}>
                        {tab.label}
                      </SegmentedControl.Button>
                    );
                  })}
                </SegmentedControl>
              )}

              {!showVrRotunda &&
                !showResultsView &&
                !showCadView &&
                !showAnalysisView &&
                activeLangInfo.supportsDiagram &&
                activeLangInfo.diagramTypes &&
                activeLangInfo.diagramTypes.length > 1 &&
                setDiagramType && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      padding: 2,
                      borderRadius: 8,
                      backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                    }}
                  >
                    {activeLangInfo.diagramTypes.map((dt) => {
                      const isSelected = effectiveDiagramType === dt.id;
                      return (
                        <button
                          key={dt.id}
                          type="button"
                          onClick={() => setDiagramType(dt.id)}
                          style={{
                            border: "none",
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: isSelected ? 600 : 400,
                            cursor: "pointer",
                            backgroundColor: isSelected
                              ? "var(--ms-surface-hover, rgba(125, 125, 125, 0.14))"
                              : "transparent",
                            color: isSelected
                              ? "var(--ms-brand, var(--color-accent-fg))"
                              : "var(--ms-text-2, var(--color-fg-muted))",
                          }}
                        >
                          {dt.label}
                        </button>
                      );
                    })}
                  </div>
                )}

              {!showVrRotunda && !showResultsView && !showCadView && !showAnalysisView && (
                <button
                  type="button"
                  onClick={() => setShowPalette((v) => !v)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 999,
                    border: "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 40%, transparent)",
                    background: showPalette ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : "transparent",
                    color: colorMode === "dark" ? "var(--ms-link, #22d3ee)" : "var(--ms-brand, #0e7490)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  title="Open interactive element & stencil palette"
                >
                  <PlusIcon size={12} />
                  <span>Add Element</span>
                </button>
              )}

              {cadComponents.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowVrRotunda(false);
                    setShowResultsView(false);
                    setShowAnalysisView(false);
                    setShowCadView(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 20,
                    border: "1px solid rgba(6, 182, 212, 0.4)",
                    background: showCadView && !showVrRotunda ? "rgba(6, 182, 212, 0.2)" : "rgba(6, 182, 212, 0.08)",
                    color: "#06b6d4",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  title="Digital Thread CAD binding active. Click to view 3D assembly"
                >
                  <span style={{ fontSize: 13 }}>🧵</span>
                  <span>{cadComponents.length} CAD Twins</span>
                </button>
              )}

              <button
                type="button"
                data-testid="ansatz-vr-rotunda-toggle"
                onClick={toggleVrRotunda}
                aria-pressed={showVrRotunda}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  border: showVrRotunda ? "1px solid rgba(129, 140, 248, 0.85)" : "1px solid rgba(99, 102, 241, 0.45)",
                  background: showVrRotunda
                    ? "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)"
                    : colorMode === "dark"
                      ? "linear-gradient(135deg, rgba(99, 102, 241, 0.24) 0%, rgba(6, 182, 212, 0.18) 100%)"
                      : "linear-gradient(135deg, rgba(99, 102, 241, 0.14) 0%, rgba(6, 182, 212, 0.12) 100%)",
                  color: showVrRotunda ? "#ffffff" : colorMode === "dark" ? "#c7d2fe" : "#4338ca",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: showVrRotunda ? "0 4px 14px rgba(99, 102, 241, 0.35)" : "none",
                  transition: "all 0.15s ease",
                }}
                title="Open in Engineering VR Rotunda (45° Drafting Podium, 3D Plinth, CAE Overlays & WebXR VR/AR)"
              >
                <span aria-hidden="true" style={{ fontSize: 12 }}>
                  🥽
                </span>
                <span>VR Rotunda</span>
              </button>

              {showCadView && !showVrRotunda && animationControllerRef.current?.hasData && (
                <Button
                  variant="primary"
                  size="small"
                  leadingVisual={animationMode === "playing" ? PauseIcon : PlayIcon}
                  onClick={() => {
                    const ctrl = animationControllerRef.current;
                    if (!ctrl) return;
                    if (ctrl.mode === "playing") {
                      ctrl.pause();
                    } else {
                      ctrl.play();
                    }
                  }}
                  style={{
                    marginLeft: 8,
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  {animationMode === "playing" ? "Pause" : "Animate"}
                </Button>
              )}

              {isAnsatzEditorRoute && !isNarrow && onAutoLayout && activeLangInfo.supportsDiagram && (
                <>
                  <div
                    style={{ width: 1, height: 18, backgroundColor: "var(--ms-border, var(--color-border-default))" }}
                  />
                  <IconButton
                    icon={FlowchartIcon}
                    size="small"
                    variant="invisible"
                    aria-label={translations.autoLayout}
                    title={translations.autoLayout}
                    onClick={onAutoLayout}
                  />
                </>
              )}
            </div>

            {/* Collapsible Stencil Palette Bar */}
            {showPalette && !showVrRotunda && !showResultsView && !showCadView && !showAnalysisView && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 10,
                  backgroundColor: "var(--ms-surface-glass)",
                  backdropFilter: "blur(12px)",
                  boxShadow:
                    colorMode === "dark"
                      ? "0 4px 16px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))"
                      : "0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px var(--borderColor-muted, var(--ms-divider))",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--ms-text-2, var(--color-fg-muted))",
                    marginRight: 4,
                  }}
                >
                  {activeLangInfo.label} Palette:
                </span>
                {lspPaletteCategories.length > 0 ? (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginRight: 6 }}>
                      {dialect === "pscad" && (
                        <button
                          type="button"
                          onClick={() => setShowComponentWizard(true)}
                          style={{
                            border: "1px solid var(--ms-brand, #0891b2)",
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: "pointer",
                            backgroundColor: "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))",
                            color: "var(--ms-brand, #0891b2)",
                          }}
                          title="Open visual <Graphics>/<form> Component Definition Wizard"
                        >
                          + New Defn
                        </button>
                      )}
                      {lspPaletteCategories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setActivePaletteCategory(cat.id)}
                          style={{
                            border: "1px solid var(--ms-divider, rgba(125,125,125,0.25))",
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: "pointer",
                            backgroundColor:
                              activePaletteCategory === cat.id
                                ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.2))"
                                : "transparent",
                            color:
                              activePaletteCategory === cat.id
                                ? "var(--ms-brand, #0891b2)"
                                : "var(--ms-text-2, var(--color-fg-muted))",
                          }}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    {(
                      lspPaletteCategories.find((c) => c.id === activePaletteCategory)?.items ??
                      lspPaletteCategories[0]?.items ??
                      []
                    ).map((item) => (
                      <button
                        key={item.type || item.className || item.label}
                        type="button"
                        onClick={() => {
                          const defName = item.type || item.className || item.label;
                          const snippet =
                            item.snippet ||
                            (dialect === "pscad"
                              ? `    <User cmp="${defName}" name="${item.label}" id="${Date.now()}" x="200" y="200" />\n`
                              : "");
                          onInsertStencilSnippet?.(snippet, defName);
                        }}
                        style={{
                          border:
                            colorMode === "dark"
                              ? "1px solid rgba(255, 255, 255, 0.12)"
                              : "1px solid rgba(0, 0, 0, 0.12)",
                          borderRadius: 6,
                          padding: "3px 8px",
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: "pointer",
                          backgroundColor: "var(--ms-surface-hover, rgba(125, 125, 125, 0.08))",
                          color: "var(--ms-text-1, var(--color-fg-default))",
                        }}
                        title={`Insert ${item.label} (${item.type || "component"})`}
                      >
                        + {item.label}
                      </button>
                    ))}
                  </>
                ) : (
                  stencils.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        onInsertStencilSnippet?.(item.snippet, item.className);
                      }}
                      style={{
                        border:
                          colorMode === "dark"
                            ? "1px solid rgba(255, 255, 255, 0.12)"
                            : "1px solid rgba(0, 0, 0, 0.12)",
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: "pointer",
                        backgroundColor: "var(--ms-surface-hover, rgba(125, 125, 125, 0.08))",
                        color: "var(--ms-text-1, var(--color-fg-default))",
                      }}
                      title={`Insert ${item.label} into ${activeLangInfo.label} document`}
                    >
                      + {item.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

      <div style={{ position: "relative", flex: 1, flexDirection: "row", overflow: "hidden" }}>
        {/* Diagram Editor with Properties Drawer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "row",
            visibility: !showVrRotunda && !showResultsView && !showCadView && !showAnalysisView ? "visible" : "hidden",
            opacity: !showVrRotunda && !showResultsView && !showCadView && !showAnalysisView ? 1 : 0,
            pointerEvents: !showVrRotunda && !showResultsView && !showCadView && !showAnalysisView ? "auto" : "none",
            zIndex: !showVrRotunda && !showResultsView && !showCadView && !showAnalysisView ? 1 : 0,
          }}
        >
          {/* Hierarchical Drill-Down Breadcrumbs Bar */}
          {drillDownPath && drillDownPath.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: isFloatingLayout
                  ? showPalette
                    ? 116
                    : 70
                  : hideCenterFloatingToolbar
                    ? 10
                    : showPalette
                      ? 96
                      : 56,
                left: isFloatingLayout ? floatingLeftOffset : 12,
                zIndex: 90,
                display: "flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: 8,
                backgroundColor: "var(--ms-surface-glass)",
                border: "1px solid var(--borderColor-muted, var(--ms-divider))",
                backdropFilter: "blur(12px)",
              }}
            >
              <Breadcrumbs>
                <Breadcrumbs.Item
                  href="#root"
                  onClick={(e) => {
                    e.preventDefault();
                    onDrillRoot?.();
                  }}
                >
                  Root
                </Breadcrumbs.Item>
                {drillDownPath.map((seg, idx) => {
                  const segLabel =
                    typeof seg === "string"
                      ? seg
                      : (seg as { label?: string; id?: string }).label ||
                        (seg as { label?: string; id?: string }).id ||
                        String(idx);
                  return (
                    <Breadcrumbs.Item
                      key={`${segLabel}-${idx}`}
                      href={`#${segLabel}`}
                      selected={idx === drillDownPath.length - 1}
                      onClick={(e) => {
                        e.preventDefault();
                        onDrillUp?.(idx);
                      }}
                    >
                      {segLabel}
                    </Breadcrumbs.Item>
                  );
                })}
              </Breadcrumbs>
            </div>
          )}

          <div
            className="flex-1 overflow-hidden"
            style={{
              minWidth: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              height: "100%",
            }}
          >
            {/* Collapsible Stencil Palette Bar */}
            {(hideCenterFloatingToolbar || isAnsatzEditorRoute) && showPalette && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "6px 12px",
                  marginTop: isFloatingLayout ? 70 : 0,
                  marginLeft: isFloatingLayout ? floatingLeftOffset : 0,
                  marginRight:
                    isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                      ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                      : isFloatingLayout
                        ? 12
                        : 0,
                  borderRadius: isFloatingLayout ? 8 : 0,
                  border: isFloatingLayout ? "1px solid var(--borderColor-muted, rgba(15, 23, 42, 0.08))" : undefined,
                  borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
                  backgroundColor: isFloatingLayout
                    ? colorMode === "dark"
                      ? "rgba(24, 24, 27, 0.92)"
                      : "rgba(255, 255, 255, 0.94)"
                    : "var(--bgColor-muted, var(--ms-bg-elv))",
                  backdropFilter: "blur(12px)",
                  boxShadow: isFloatingLayout ? floatingCardShadow : undefined,
                  flexShrink: 0,
                  zIndex: 25,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--ms-text-2, var(--color-fg-muted))",
                    marginRight: 4,
                  }}
                >
                  {activeLangInfo.label || activeLangInfo.name} Palette:
                </span>
                {lspPaletteCategories.length > 0 ? (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginRight: 6 }}>
                      {dialect === "pscad" && (
                        <button
                          type="button"
                          onClick={() => setShowComponentWizard(true)}
                          style={{
                            border: "1px solid var(--ms-brand, #0891b2)",
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: "pointer",
                            backgroundColor: "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))",
                            color: "var(--ms-brand, #0891b2)",
                          }}
                          title="Open visual <Graphics>/<form> Component Definition Wizard"
                        >
                          + New Defn
                        </button>
                      )}
                      {lspPaletteCategories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setActivePaletteCategory(cat.id)}
                          style={{
                            border: "1px solid var(--ms-divider, rgba(125,125,125,0.25))",
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: "pointer",
                            backgroundColor:
                              activePaletteCategory === cat.id
                                ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.2))"
                                : "transparent",
                            color:
                              activePaletteCategory === cat.id
                                ? "var(--ms-brand, #0891b2)"
                                : "var(--ms-text-2, var(--color-fg-muted))",
                          }}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    {(
                      lspPaletteCategories.find((c) => c.id === activePaletteCategory)?.items ??
                      lspPaletteCategories[0]?.items ??
                      []
                    ).map((item) => (
                      <button
                        key={item.type || item.className || item.label}
                        type="button"
                        onClick={() => {
                          const defName = item.type || item.className || item.label;
                          const snippet =
                            item.snippet ||
                            (dialect === "pscad"
                              ? `    <User classid="UserCmp" defn="${defName}" name="${item.label}" id="${Date.now()}" x="200" y="200" />\n`
                              : "");
                          onInsertStencilSnippet?.(snippet, defName);
                        }}
                        style={{
                          border:
                            colorMode === "dark"
                              ? "1px solid rgba(255, 255, 255, 0.12)"
                              : "1px solid rgba(0, 0, 0, 0.12)",
                          borderRadius: 6,
                          padding: "3px 8px",
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: "pointer",
                          backgroundColor: "var(--ms-surface-hover, rgba(125, 125, 125, 0.08))",
                          color: "var(--ms-text-1, var(--color-fg-default))",
                        }}
                        title={`Insert ${item.label} (${item.type || "component"})`}
                      >
                        + {item.label}
                      </button>
                    ))}
                  </>
                ) : (
                  stencils.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        onInsertStencilSnippet?.(item.snippet, item.className);
                      }}
                      style={{
                        border:
                          colorMode === "dark"
                            ? "1px solid rgba(255, 255, 255, 0.12)"
                            : "1px solid rgba(0, 0, 0, 0.12)",
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: "pointer",
                        backgroundColor: "var(--ms-surface-hover, rgba(125, 125, 125, 0.08))",
                        color: "var(--ms-text-1, var(--color-fg-default))",
                      }}
                      title={`Insert ${item.label} into ${activeLangInfo.label || activeLangInfo.name} document`}
                    >
                      + {item.label}
                    </button>
                  ))
                )}
              </div>
            )}

            <div
              style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}
              onClick={() => {
                if (showEmptyState) {
                  setIsEmptyStateDismissed(true);
                }
              }}
            >
              {activeLangInfo.id === "psse" && onPsseDiagramOptionsChange && (
                <div
                  data-testid="psse-sld-tool-pill"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: 14,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 25,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 10px",
                    borderRadius: 999,
                    backgroundColor: "var(--ms-surface-glass, rgba(255, 255, 255, 0.9))",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid var(--ms-border, rgba(15, 23, 42, 0.14))",
                    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)",
                    fontSize: 11,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onPsseDiagramOptionsChange((prev) => ({
                        ...prev,
                        layoutMode: prev.layoutMode === "geographic" ? "auto" : "geographic",
                      }))
                    }
                    style={{
                      height: 24,
                      padding: "0 8px",
                      borderRadius: 999,
                      border: "1px solid var(--ms-border, rgba(15, 23, 42, 0.14))",
                      backgroundColor:
                        psseDiagramOptions?.layoutMode === "geographic"
                          ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.18))"
                          : "transparent",
                      color: "var(--ms-text-1, var(--color-fg-default))",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {psseDiagramOptions?.layoutMode === "geographic" ? "Geo Lat/Lon" : "Auto Layout"}
                  </button>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: "var(--ms-text-2, var(--color-fg-muted))",
                    }}
                  >
                    Focus Bus
                    <input
                      type="number"
                      placeholder="All"
                      value={psseDiagramOptions?.focusBus ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        onPsseDiagramOptionsChange((prev) => ({
                          ...prev,
                          focusBus: raw === "" ? undefined : Number(raw),
                        }));
                      }}
                      style={{
                        width: 56,
                        height: 22,
                        padding: "0 6px",
                        borderRadius: 6,
                        border: "1px solid var(--ms-border, rgba(15, 23, 42, 0.14))",
                        backgroundColor: "transparent",
                        color: "var(--ms-text-1, var(--color-fg-default))",
                        fontFamily: "monospace",
                        fontSize: 11,
                      }}
                    />
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: "var(--ms-text-2, var(--color-fg-muted))",
                    }}
                  >
                    k-Hop
                    <select
                      value={psseDiagramOptions?.kHops ?? 2}
                      onChange={(e) =>
                        onPsseDiagramOptionsChange((prev) => ({
                          ...prev,
                          kHops: Number(e.target.value),
                        }))
                      }
                      style={{
                        height: 22,
                        padding: "0 4px",
                        borderRadius: 6,
                        border: "1px solid var(--ms-border, rgba(15, 23, 42, 0.14))",
                        backgroundColor: "transparent",
                        color: "var(--ms-text-1, var(--color-fg-default))",
                        fontSize: 11,
                      }}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                    </select>
                  </label>
                </div>
              )}
              <Suspense fallback={null}>
                <DiagramEditor
                  ref={effectiveDiagramRef}
                  diagramData={diagramData}
                  diagramClassName={selectedTreeClassName}
                  selectedName={selectedComponent}
                  theme={colorMode === "dark" ? "vs-dark" : "light"}
                  isLoading={isDiagramLoading || Boolean(isLoadingModel)}
                  fitInsets={
                    isFloatingLayout
                      ? {
                          top: 84,
                          left: floatingLeftOffset + 12,
                          right:
                            (selectedComponent ? propertiesWidth + 28 : 24) +
                            (isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                              ? Math.round(
                                  (1 - splitRatio) * (typeof window !== "undefined" ? window.innerWidth : 1200),
                                )
                              : 0),
                          bottom:
                            Math.max(56, diagnosticsBottomOffset + 12) +
                            (isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
                              ? Math.round(
                                  (1 - splitRatio) * (typeof window !== "undefined" ? window.innerHeight : 800),
                                )
                              : 0),
                        }
                      : undefined
                  }
                  onRenderComplete={(data) => {
                    if (!data?.isLoading) {
                      setIsDiagramLoading(false);
                      if (!hasCenteredOnLoadRef.current && (loadingProgress === undefined || loadingProgress >= 100)) {
                        hasCenteredOnLoadRef.current = true;
                        setTimeout(() => {
                          effectiveDiagramRef?.current?.zoomToFit();
                        }, 50);
                      }
                    }
                  }}
                  onSelect={(name, cachedProps, isLoading) => {
                    if (showEmptyState) {
                      setIsEmptyStateDismissed(true);
                    }
                    handleSelectComponent(name, cachedProps, isLoading);
                  }}
                  onShowProperties={handleSelectComponent}
                  onNodeDoubleClick={onNodeDoubleClick}
                  onDrop={async (className, x, y) => {
                    setIsEmptyStateDismissed(true);
                    enqueueDiagramAction({ type: "addComponent", className, x, y });
                  }}
                  onConnect={async (source, target, points) => {
                    enqueueDiagramAction({ type: "connect", source, target, points });
                  }}
                  onMove={async (items) => {
                    enqueueDiagramAction({ type: "move", items });
                  }}
                  onResize={async (name, x, y, width, height, rotation, edges) => {
                    enqueueDiagramAction({
                      type: "resize",
                      item: { name, x, y, width, height, rotation, edges },
                    });
                  }}
                  onEdgeMove={async (edges) => {
                    enqueueDiagramAction({ type: "moveEdge", edges });
                  }}
                  onEdgeDelete={async (source, target) => {
                    enqueueDiagramAction({ type: "disconnect", source, target });
                  }}
                  onComponentDelete={async (name) => {
                    enqueueDiagramAction({ type: "deleteComponents", names: [name] });
                  }}
                  onComponentsDelete={async (names) => {
                    enqueueDiagramAction({ type: "deleteComponents", names });
                  }}
                  onInteractiveWrite={async (variableName, value, nodeId) => {
                    enqueueDiagramAction({
                      type: "updateParameter",
                      name: nodeId,
                      parameter: variableName,
                      value,
                    });
                  }}
                  onAction={enqueueDiagramAction}
                  onMessage={(rawMsg: unknown) => {
                    if (!rawMsg || typeof rawMsg !== "object") return;
                    const msg = rawMsg as { type?: string; startOffset?: number; endOffset?: number };
                    if (msg.type === "revealSource" && typeof msg.startOffset === "number") {
                      const ed = editorRef?.current;
                      const model = ed?.getModel();
                      if (ed && model) {
                        const startPos = model.getPositionAt(msg.startOffset);
                        const endPos = model.getPositionAt(msg.endOffset ?? msg.startOffset);
                        ed.revealRangeInCenter({
                          startLineNumber: startPos.lineNumber,
                          startColumn: startPos.column,
                          endLineNumber: endPos.lineNumber,
                          endColumn: endPos.column,
                        });
                        ed.setSelection({
                          startLineNumber: startPos.lineNumber,
                          startColumn: startPos.column,
                          endLineNumber: endPos.lineNumber,
                          endColumn: endPos.column,
                        });
                      }
                    } else if (msg.type === "navigateTo") {
                      if (msg.className !== undefined) setSelectedTreeClassName(msg.className);
                      if (msg.diagramType) setDiagramType?.(msg.diagramType);
                    } else if (msg.type === "changeDiagramType" && msg.diagramType) {
                      setDiagramType?.(msg.diagramType);
                    }
                  }}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onZoomChange={setCurrentZoom}
                  onAutoLayout={onAutoLayout}
                  onFetchArtifactBytes={handleFetchArtifactBytes}
                  onTessellateStep={handleTessellateStep}
                />
              </Suspense>

              {showEmptyState && (
                <div
                  role="dialog"
                  aria-label="Design your physical system"
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    maxWidth: "460px",
                    width: "calc(100% - 48px)",
                    padding: "28px 24px 22px 24px",
                    borderRadius: "16px",
                    background: "var(--ms-surface-glass)",
                    border: "1px solid var(--borderColor-default, var(--ms-border))",
                    backdropFilter: "blur(20px)",
                    boxShadow:
                      colorMode === "dark"
                        ? "0 20px 48px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)"
                        : "0 20px 48px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)",
                    pointerEvents: "auto",
                    zIndex: 10,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {/* Close Button */}
                  <button
                    type="button"
                    aria-label="Close"
                    title="Close (Esc)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEmptyStateDismissed(true);
                    }}
                    style={{
                      position: "absolute",
                      top: 14,
                      right: 14,
                      width: 28,
                      height: 28,
                      borderRadius: "6px",
                      border: "none",
                      background: "transparent",
                      color: "var(--color-fg-muted, #8b949e)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                      transition: "background 0.15s ease, color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        colorMode === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)";
                      e.currentTarget.style.color = "var(--color-fg-default, #c9d1d9)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--color-fg-muted, #8b949e)";
                    }}
                  >
                    <XIcon size={16} />
                  </button>

                  {/* Icon Badge */}
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 14,
                      background:
                        colorMode === "dark"
                          ? "linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(59, 130, 246, 0.15) 100%)"
                          : "linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)",
                      border:
                        colorMode === "dark" ? "1px solid rgba(6, 182, 212, 0.3)" : "1px solid rgba(6, 182, 212, 0.25)",
                      boxShadow: "0 4px 16px rgba(6, 182, 212, 0.15)",
                      color: "var(--color-accent-cyan, #06b6d4)",
                    }}
                  >
                    <WorkflowIcon size={24} />
                  </div>

                  {/* Title */}
                  <div
                    style={{
                      fontSize: "17px",
                      fontWeight: 700,
                      color: "var(--color-fg-default)",
                      letterSpacing: "-0.01em",
                      marginBottom: 8,
                    }}
                  >
                    Design your physical system
                  </div>

                  {/* Subtitle */}
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--color-fg-muted)",
                      lineHeight: 1.5,
                      marginBottom: 20,
                      maxWidth: "380px",
                    }}
                  >
                    Drag components from the library on the left, or kickstart with a curated multi-physics model:
                  </div>

                  {/* Curated Starters */}
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", marginBottom: 16 }}
                  >
                    {starterExamples.map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => {
                          setIsEmptyStateDismissed(true);
                          const exFiles =
                            ex["files"] && typeof ex["files"] === "object"
                              ? (ex["files"] as Record<string, string>)
                              : undefined;
                          const exActiveFile = typeof ex["activeFile"] === "string" ? ex["activeFile"] : undefined;
                          const exCode = typeof ex["code"] === "string" ? ex["code"] : "";
                          const exTitle = typeof ex["title"] === "string" ? ex["title"] : undefined;
                          if (onLoadStarterExample) {
                            onLoadStarterExample(exCode, exTitle, exFiles, exActiveFile);
                          } else if (editorRef.current) {
                            editorRef.current.setValue(exCode);
                          }
                        }}
                        onDoubleClick={() => {
                          setIsEmptyStateDismissed(true);
                          const exFiles =
                            ex["files"] && typeof ex["files"] === "object"
                              ? (ex["files"] as Record<string, string>)
                              : undefined;
                          const exActiveFile = typeof ex["activeFile"] === "string" ? ex["activeFile"] : undefined;
                          const exCode = typeof ex["code"] === "string" ? ex["code"] : "";
                          const exTitle = typeof ex["title"] === "string" ? ex["title"] : undefined;
                          if (onLoadStarterExample) {
                            onLoadStarterExample(exCode, exTitle, exFiles, exActiveFile);
                          } else if (editorRef.current) {
                            editorRef.current.setValue(exCode);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          borderRadius: "10px",
                          border: "1px solid var(--borderColor-default, var(--ms-border))",
                          background: "var(--bgColor-muted, var(--ms-bg-elv))",
                          color: "var(--fgColor-default, var(--ms-text-1))",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.15s ease",
                          width: "100%",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--ms-brand, var(--color-accent-fg))";
                          e.currentTarget.style.background =
                            colorMode === "dark" ? "rgba(33, 38, 45, 0.9)" : "rgba(255, 255, 255, 1)";
                          e.currentTarget.style.transform = "translateY(-1px)";
                          e.currentTarget.style.boxShadow =
                            colorMode === "dark" ? "0 4px 12px rgba(0, 0, 0, 0.3)" : "0 4px 12px rgba(0, 0, 0, 0.06)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor =
                            colorMode === "dark" ? "rgba(48, 54, 61, 0.8)" : "rgba(208, 215, 222, 0.9)";
                          e.currentTarget.style.background =
                            colorMode === "dark"
                              ? "var(--bgColor-muted, var(--ms-bg-elv))"
                              : "rgba(246, 248, 250, 0.8)";
                          e.currentTarget.style.transform = "none";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "16px", lineHeight: 1 }}>
                            {ex.category === "Electrical"
                              ? "⚡"
                              : ex.category === "Mechanics"
                                ? "⚙️"
                                : ex.category === "Nonlinear Dynamics"
                                  ? "🌀"
                                  : ex.category === "SysML v2"
                                    ? "📐"
                                    : "🚀"}
                          </span>
                          <span style={{ fontSize: "13px", fontWeight: 600 }}>{ex.title}</span>
                        </div>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            background: "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))",
                            color: "var(--ms-brand, var(--color-accent-fg))",
                          }}
                        >
                          {ex.category}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Footer Helper */}
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-fg-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      opacity: 0.85,
                    }}
                  >
                    <span>
                      Click canvas or press{" "}
                      <kbd
                        style={{
                          padding: "1px 5px",
                          fontSize: "10px",
                          borderRadius: "4px",
                          background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
                          border: "1px solid var(--ms-border, var(--color-border-default))",
                          fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace",
                        }}
                      >
                        Esc
                      </kbd>{" "}
                      to start with a blank canvas
                    </span>
                  </div>
                </div>
              )}

              {/* Floating Command Island (Center-Bottom) */}
              {activeLangInfo.supportsDiagram && !hideCenterFloatingToolbar && (
                <div
                  className="ansatz-command-island"
                  style={{
                    position: "absolute",
                    bottom: 16,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 25,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    height: 36,
                    padding: "0 6px",
                    borderRadius: "var(--ms-radius-pill, 999px)",
                    background:
                      colorMode === "dark"
                        ? "var(--ms-surface-glass, rgba(15, 23, 42, 0.85))"
                        : "rgba(255, 255, 255, 0.94)",
                    backdropFilter: "blur(16px)",
                    WebkitBackdropFilter: "blur(16px)",
                    border: "1px solid var(--ms-divider, rgba(255, 255, 255, 0.12))",
                    boxShadow: "var(--ms-shadow-card, 0 8px 28px -4px rgba(0, 0, 0, 0.3))",
                    userSelect: "none",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowPalette((v) => !v)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      height: 26,
                      padding: "0 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: "var(--ms-radius-pill, 999px)",
                      border: showPalette
                        ? "1px solid var(--ms-brand, #0891b2)"
                        : "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 30%, transparent)",
                      background: showPalette
                        ? "var(--ms-brand, #0891b2)"
                        : "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))",
                      color: showPalette
                        ? "#ffffff"
                        : colorMode === "dark"
                          ? "var(--ms-link, #22d3ee)"
                          : "var(--ms-brand, #0e7490)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      transition: "all 0.15s ease",
                      boxShadow: showPalette ? "0 0 12px var(--ms-glow-cyan, rgba(8, 145, 178, 0.4))" : "none",
                    }}
                    title="Open interactive element & stencil palette"
                  >
                    <PlusIcon size={13} />
                    <span>Add Element</span>
                  </button>

                  <div
                    style={{
                      width: 1,
                      height: 16,
                      backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
                      margin: "0 3px",
                    }}
                  />

                  {/* Undo / Redo */}
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                    <button
                      type="button"
                      className="ansatz-toolbar-btn"
                      onClick={handleUndo}
                      aria-label="Undo"
                      title="Undo (Ctrl+Z)"
                      style={{
                        border: "none",
                        background: "transparent",
                        borderRadius: "var(--ms-radius-pill, 999px)",
                        width: 26,
                        height: 26,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ms-text-2, var(--color-fg-muted))",
                        cursor: "pointer",
                        transition: "background-color 0.12s ease, color 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                        e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 7h7a4 4 0 0 1 4 4v1" />
                        <path d="M6 4L3 7l3 3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="ansatz-toolbar-btn"
                      onClick={handleRedo}
                      aria-label="Redo"
                      title="Redo (Ctrl+Y / Cmd+Shift+Z)"
                      style={{
                        border: "none",
                        background: "transparent",
                        borderRadius: "var(--ms-radius-pill, 999px)",
                        width: 26,
                        height: 26,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ms-text-2, var(--color-fg-muted))",
                        cursor: "pointer",
                        transition: "background-color 0.12s ease, color 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                        e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M13 7H6a4 4 0 0 0-4 4v1" />
                        <path d="M10 4l3 3-3 3" />
                      </svg>
                    </button>
                  </div>

                  <div
                    style={{
                      width: 1,
                      height: 16,
                      backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
                      margin: "0 3px",
                    }}
                  />

                  {/* Rotate 90° */}
                  <button
                    type="button"
                    className="ansatz-toolbar-btn"
                    onClick={() => effectiveDiagramRef?.current?.rotateSelected(90)}
                    aria-label="Rotate 90° Clockwise"
                    title="Rotate 90° Clockwise (R / Shift+R)"
                    style={{
                      border: "none",
                      background: "transparent",
                      borderRadius: "var(--ms-radius-pill, 999px)",
                      width: 26,
                      height: 26,
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--ms-text-2, var(--color-fg-muted))",
                      cursor: "pointer",
                      transition: "background-color 0.12s ease, color 0.12s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                      e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 7A6 6 0 1 1 8 2h4" />
                      <path d="M9 5l3-3-3-3" />
                    </svg>
                  </button>

                  {/* Auto-Layout */}
                  {onAutoLayout && (
                    <IconButton
                      icon={FlowchartIcon}
                      size="small"
                      variant="invisible"
                      aria-label={translations.autoLayout || "Auto-layout diagram"}
                      title={translations.autoLayout || "Auto-layout diagram"}
                      onClick={onAutoLayout}
                    />
                  )}
                </div>
              )}

              {/* Floating Viewport HUD (Bottom-Right) */}
              {activeLangInfo.supportsDiagram && (
                <div
                  className="ansatz-viewport-hud"
                  style={{
                    position: "absolute",
                    bottom:
                      isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
                        ? `calc(${(1 - splitRatio) * 100}% + 16px)`
                        : isFloatingLayout
                          ? Math.max(16, diagnosticsBottomOffset)
                          : 16,
                    right:
                      isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                        ? `calc(${(1 - splitRatio) * 100}% + ${selectedComponent ? propertiesWidth + 24 : 16}px)`
                        : isFloatingLayout && selectedComponent
                          ? propertiesWidth + 24
                          : 16,
                    zIndex: 25,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 2,
                    height: 36,
                    padding: "0 6px",
                    borderRadius: "var(--ms-radius-lg, 12px)",
                    background:
                      colorMode === "dark"
                        ? "var(--ms-surface-glass, rgba(24, 24, 27, 0.94))"
                        : "rgba(255, 255, 255, 0.96)",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    border: "1px solid var(--borderColor-muted, var(--ms-divider))",
                    boxShadow: "var(--ms-shadow-card, 0 8px 24px -4px rgba(0, 0, 0, 0.14))",
                    userSelect: "none",
                  }}
                >
                  {/* Zoom Controls */}
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                    <button
                      type="button"
                      className="ansatz-toolbar-btn"
                      onClick={() => effectiveDiagramRef?.current?.zoomOut()}
                      aria-label="Zoom Out"
                      title="Zoom Out (Ctrl+-)"
                      style={{
                        border: "none",
                        background: "transparent",
                        borderRadius: "var(--ms-radius-pill, 999px)",
                        width: 26,
                        height: 26,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ms-text-2, var(--color-fg-muted))",
                        cursor: "pointer",
                        transition: "background-color 0.12s ease, color 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                        e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="7" cy="7" r="5" />
                        <path d="M11 11l4 4" />
                        <path d="M4.5 7h5" />
                      </svg>
                    </button>

                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        className="ansatz-toolbar-btn-text"
                        onClick={() => setShowZoomMenu((v) => !v)}
                        aria-label={`Zoom level: ${Math.round(currentZoom * 100)}%`}
                        title="Zoom presets / Reset to 100% (Ctrl+0)"
                        style={{
                          border: "none",
                          background: "transparent",
                          borderRadius: 6,
                          padding: "2px 6px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--ms-text-1, var(--color-fg-default))",
                          cursor: "pointer",
                          minWidth: 46,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 3,
                          textAlign: "center",
                          fontVariantNumeric: "tabular-nums",
                          transition: "background-color 0.12s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <span>{Math.round(currentZoom * 100)}%</span>
                        <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.65 }}>
                          <path d="M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z" />
                        </svg>
                      </button>
                      {showZoomMenu && (
                        <div
                          ref={zoomMenuRef}
                          style={{
                            position: "absolute",
                            bottom: "calc(100% + 8px)",
                            right: 0,
                            zIndex: 100,
                            minWidth: 140,
                            padding: 5,
                            borderRadius: 10,
                            border: "1px solid var(--borderColor-default, var(--ms-border))",
                            backgroundColor: "var(--overlay-bgColor, var(--ms-bg-elv))",
                            boxShadow:
                              colorMode === "dark"
                                ? "0 12px 32px rgba(0, 0, 0, 0.45)"
                                : "0 12px 32px rgba(0, 0, 0, 0.15)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          {[
                            { label: "50%", scale: 0.5 },
                            { label: "75%", scale: 0.75 },
                            { label: "100%", scale: 1.0 },
                            { label: "125%", scale: 1.25 },
                            { label: "150%", scale: 1.5 },
                            { label: "200%", scale: 2.0 },
                          ].map((preset) => {
                            const isCurrent = Math.round(currentZoom * 100) === Math.round(preset.scale * 100);
                            return (
                              <button
                                key={preset.scale}
                                type="button"
                                className="ansatz-menu-item"
                                onClick={() => {
                                  effectiveDiagramRef?.current?.zoomTo(preset.scale);
                                  setShowZoomMenu(false);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "5px 8px",
                                  fontSize: 11,
                                  fontWeight: isCurrent ? 600 : 400,
                                  color: isCurrent
                                    ? "var(--ms-brand, #0891b2)"
                                    : "var(--ms-text-1, var(--color-fg-default))",
                                  background: "transparent",
                                  border: "none",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                  textAlign: "left",
                                  width: "100%",
                                  transition: "background-color 0.12s ease",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor =
                                    colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = "transparent";
                                }}
                              >
                                <span>{preset.label}</span>
                                {isCurrent && <span>✓</span>}
                              </button>
                            );
                          })}
                          <div
                            style={{
                              height: 1,
                              backgroundColor:
                                colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                              margin: "3px 0",
                            }}
                          />
                          <button
                            type="button"
                            className="ansatz-menu-item"
                            onClick={() => {
                              effectiveDiagramRef?.current?.zoomToFit();
                              setShowZoomMenu(false);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "5px 8px",
                              fontSize: 11,
                              fontWeight: 500,
                              color: "var(--ms-text-1, var(--color-fg-default))",
                              background: "transparent",
                              border: "none",
                              borderRadius: 6,
                              cursor: "pointer",
                              textAlign: "left",
                              width: "100%",
                              transition: "background-color 0.12s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor =
                                colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "transparent";
                            }}
                          >
                            Zoom to Fit (Shift+1)
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="ansatz-toolbar-btn"
                      onClick={() => effectiveDiagramRef?.current?.zoomIn()}
                      aria-label="Zoom In"
                      title="Zoom In (Ctrl+=)"
                      style={{
                        border: "none",
                        background: "transparent",
                        borderRadius: "var(--ms-radius-pill, 999px)",
                        width: 26,
                        height: 26,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ms-text-2, var(--color-fg-muted))",
                        cursor: "pointer",
                        transition: "background-color 0.12s ease, color 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                        e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="7" cy="7" r="5" />
                        <path d="M11 11l4 4" />
                        <path d="M7 4.5v5" />
                        <path d="M4.5 7h5" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="ansatz-toolbar-btn"
                      onClick={() => effectiveDiagramRef?.current?.zoomToFit()}
                      aria-label="Zoom to Fit"
                      title="Zoom to Fit (Shift+1)"
                      style={{
                        border: "none",
                        background: "transparent",
                        borderRadius: "var(--ms-radius-pill, 999px)",
                        width: 26,
                        height: 26,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ms-text-2, var(--color-fg-muted))",
                        cursor: "pointer",
                        transition: "background-color 0.12s ease, color 0.12s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                        e.currentTarget.style.color = "var(--ms-text-1, var(--color-fg-default))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = "var(--ms-text-2, var(--color-fg-muted))";
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 6V2h4" />
                        <path d="M14 6V2h-4" />
                        <path d="M2 10v4h4" />
                        <path d="M14 10v4h-4" />
                      </svg>
                    </button>
                  </div>

                  <div
                    style={{
                      width: 1,
                      height: 14,
                      backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
                      margin: "0 3px",
                    }}
                  />

                  {/* Grid & Snapping Popover */}
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setShowGridMenu((v) => !v)}
                      aria-label="Grid & Snapping Options"
                      title="Grid & Snapping Options"
                      style={{
                        border: "none",
                        background: showGridMenu ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.16))" : "transparent",
                        borderRadius: "var(--ms-radius-pill, 999px)",
                        width: 26,
                        height: 26,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: showGridMenu ? "var(--ms-brand, #0891b2)" : "var(--ms-text-2, var(--color-fg-muted))",
                        cursor: "pointer",
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 5h14M1 11h14M5 1v14M11 1v14" />
                      </svg>
                    </button>
                    {showGridMenu && (
                      <div
                        ref={gridMenuRef}
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 8px)",
                          right: 0,
                          zIndex: 100,
                          minWidth: 175,
                          padding: 6,
                          borderRadius: 10,
                          border: "1px solid var(--borderColor-default, var(--ms-border))",
                          backgroundColor: "var(--overlay-bgColor, var(--ms-bg-elv))",
                          boxShadow:
                            colorMode === "dark"
                              ? "0 12px 32px rgba(0, 0, 0, 0.45)"
                              : "0 12px 32px rgba(0, 0, 0, 0.15)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "var(--ms-text-2, #8b949e)",
                            textTransform: "uppercase",
                            padding: "3px 6px",
                          }}
                        >
                          Canvas Grid Style
                        </span>
                        {[
                          { label: "Double Mesh (CAD)", mode: "doubleMesh" as const },
                          { label: "Dot Matrix", mode: "dot" as const },
                          { label: "Fine Mesh", mode: "mesh" as const },
                          { label: "Blank (No Grid)", mode: "none" as const },
                        ].map((item) => (
                          <button
                            key={item.mode}
                            type="button"
                            className="ansatz-menu-item"
                            onClick={() => {
                              handleGridModeChange(item.mode);
                              setShowGridMenu(false);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "5px 8px",
                              fontSize: 11,
                              fontWeight: gridMode === item.mode ? 600 : 400,
                              color:
                                gridMode === item.mode
                                  ? "var(--ms-brand, #0891b2)"
                                  : "var(--ms-text-1, var(--color-fg-default))",
                              background: "transparent",
                              border: "none",
                              borderRadius: 6,
                              cursor: "pointer",
                              textAlign: "left",
                              width: "100%",
                              transition: "background-color 0.12s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor =
                                colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "transparent";
                            }}
                          >
                            <span>{item.label}</span>
                            {gridMode === item.mode && <span>✓</span>}
                          </button>
                        ))}
                        <div
                          style={{
                            height: 1,
                            backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
                            margin: "3px 0",
                          }}
                        />
                        <button
                          type="button"
                          className="ansatz-menu-item"
                          onClick={() => {
                            handleSnapToggle();
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "5px 8px",
                            fontSize: 11,
                            fontWeight: isSnapActive ? 600 : 400,
                            color: isSnapActive
                              ? "var(--ms-brand, #0891b2)"
                              : "var(--ms-text-1, var(--color-fg-default))",
                            background: "transparent",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            textAlign: "left",
                            width: "100%",
                            transition: "background-color 0.12s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              colorMode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                          }}
                        >
                          <span>Snap to Grid</span>
                          <span style={{ fontSize: 9, fontWeight: 700 }}>{isSnapActive ? "ON" : "OFF"}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Minimap Toggle */}
                  <button
                    type="button"
                    onClick={toggleMinimapView}
                    aria-label="Toggle Minimap"
                    title="Toggle Minimap (M)"
                    style={{
                      border: "none",
                      background: isMinimapActive ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.2))" : "transparent",
                      borderRadius: "var(--ms-radius-pill, 999px)",
                      width: 26,
                      height: 26,
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isMinimapActive ? "var(--ms-brand, #0891b2)" : "var(--ms-text-2, var(--color-fg-muted))",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="2" width="12" height="12" rx="2" />
                      <path d="M9 9h5v5H9z" />
                      <path d="M2 6h12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>

          {selectedComponent && (
            <div
              style={
                isFloatingLayout
                  ? {
                      position: "absolute",
                      top: 72,
                      right:
                        isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                          ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                          : 12,
                      bottom:
                        isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
                          ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                          : diagnosticsBottomOffset,
                      zIndex: 26,
                      display: "flex",
                      flexDirection: "row",
                      pointerEvents: "none",
                    }
                  : {
                      display: "contents",
                    }
              }
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={propertiesWidth}
                aria-valuemin={200}
                aria-valuemax={800}
                aria-label="Resize properties panel"
                tabIndex={0}
                style={{
                  width: 10,
                  marginLeft: -5,
                  marginRight: -5,
                  cursor: "col-resize",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  display: "flex",
                  position: "relative",
                  zIndex: 10,
                  backgroundColor: "transparent",
                  outline: "none",
                  userSelect: "none",
                  pointerEvents: "auto",
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setPropertiesWidth(Math.max(200, Math.min(800, propertiesWidth + 10)));
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    setPropertiesWidth(Math.max(200, Math.min(800, propertiesWidth - 10)));
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setPropertiesWidth(800);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    setPropertiesWidth(200);
                  }
                }}
                onDoubleClick={() => {
                  setPropertiesWidth(300);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isDraggingProperties.current = true;
                  setIsPropResizerDragging(true);
                  const startX = e.clientX;
                  const startWidth = propertiesWidth;
                  const onMouseMove = (ev: MouseEvent) => {
                    if (!isDraggingProperties.current) return;
                    const deltaX = startX - ev.clientX;
                    const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
                    setPropertiesWidth(newWidth);
                  };
                  const onMouseUp = () => {
                    isDraggingProperties.current = false;
                    setIsPropResizerDragging(false);
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup", onMouseUp);
                    document.body.style.cursor = "auto";
                    document.body.style.userSelect = "auto";
                  };
                  document.addEventListener("mousemove", onMouseMove);
                  document.addEventListener("mouseup", onMouseUp);
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  if (!touch) return;
                  isDraggingProperties.current = true;
                  setIsPropResizerDragging(true);
                  const startX = touch.clientX;
                  const startWidth = propertiesWidth;

                  const onTouchMove = (ev: TouchEvent) => {
                    if (!isDraggingProperties.current) return;
                    const t = ev.touches[0];
                    if (!t) return;
                    const deltaX = startX - t.clientX;
                    const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
                    setPropertiesWidth(newWidth);
                  };

                  const onTouchEnd = () => {
                    isDraggingProperties.current = false;
                    setIsPropResizerDragging(false);
                    document.removeEventListener("touchmove", onTouchMove);
                    document.removeEventListener("touchend", onTouchEnd);
                    document.body.style.userSelect = "auto";
                  };

                  document.addEventListener("touchmove", onTouchMove, { passive: true });
                  document.addEventListener("touchend", onTouchEnd);
                  document.body.style.userSelect = "none";
                }}
                onMouseEnter={() => setIsPropResizerHovered(true)}
                onMouseLeave={() => setIsPropResizerHovered(false)}
              >
                {/* Active highlight line centered on the border */}
                <div
                  style={{
                    width: 2,
                    height: "100%",
                    backgroundColor:
                      isPropResizerHovered || isPropResizerDragging ? "var(--ms-text-3, #6b7280)" : "transparent",
                    transition: "background-color 0.15s ease",
                  }}
                />
                {/* Subtle grab pill in the vertical center */}
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 4,
                    height: 28,
                    borderRadius: 999,
                    backgroundColor:
                      isPropResizerHovered || isPropResizerDragging ? "var(--ms-text-3, #6b7280)" : "transparent",
                    boxShadow:
                      isPropResizerHovered || isPropResizerDragging
                        ? "0 0 6px color-mix(in srgb, var(--ms-text-3, #6b7280) 40%, transparent)"
                        : "none",
                    opacity: isPropResizerHovered || isPropResizerDragging ? 1 : 0,
                    transition: "opacity 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
                    pointerEvents: "none",
                  }}
                />
              </div>
              <div style={{ pointerEvents: "auto", height: "100%", display: "flex" }}>
                {(() => {
                  const iconNode =
                    selectedComponent?.startsWith("__icon_gfx_") && Array.isArray(diagramData?.nodes)
                      ? diagramData.nodes.find((n: { id?: string }) => n?.id === selectedComponent)
                      : null;
                  const iconPrimitivesCount = Array.isArray(diagramData?.nodes)
                    ? diagramData.nodes.filter((n: { id?: string }) => String(n?.id ?? "").startsWith("__icon_gfx_"))
                        .length
                    : 0;
                  if (iconNode?.data?.primitive !== undefined) {
                    const idx = Number(iconNode.data.primitiveIndex ?? 0);
                    return (
                      <div
                        style={{
                          width: propertiesWidth,
                          height: "100%",
                          overflowY: "auto",
                          backgroundColor: isFloatingLayout
                            ? "var(--ms-surface-glass, rgba(255, 255, 255, 0.9))"
                            : "var(--ms-bg-elv, var(--color-canvas-subtle))",
                          backdropFilter: isFloatingLayout ? "blur(14px)" : undefined,
                          borderRadius: isFloatingLayout ? 12 : 0,
                          border: isFloatingLayout ? "1px solid var(--ms-border, rgba(15, 23, 42, 0.12))" : undefined,
                          borderLeft: isFloatingLayout
                            ? undefined
                            : "1px solid var(--ms-divider, rgba(15, 23, 42, 0.08))",
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 14px",
                            borderBottom: "1px solid var(--ms-divider, rgba(15, 23, 42, 0.08))",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          <span>Icon Graphic</span>
                          <IconButton
                            icon={XIcon}
                            size="small"
                            variant="invisible"
                            aria-label="Close inspector"
                            onClick={() => handleSelectComponent(null)}
                          />
                        </div>
                        <IconPrimitiveInspector
                          primitiveIndex={idx}
                          totalPrimitives={iconPrimitivesCount}
                          primitive={iconNode.data.primitive as Record<string, unknown>}
                          onUpdate={(primitiveIdx, patch) => {
                            enqueueDiagramAction({
                              type: "updateIconPrimitive",
                              index: primitiveIdx,
                              patch,
                            });
                          }}
                          onDelete={(primitiveIdx) => {
                            handleSelectComponent(null);
                            enqueueDiagramAction({
                              type: "deleteIconPrimitive",
                              index: primitiveIdx,
                            });
                          }}
                          onReorder={(fromIndex, toIndex) => {
                            enqueueDiagramAction({
                              type: "reorderIconPrimitive",
                              fromIndex,
                              toIndex,
                            });
                          }}
                        />
                      </div>
                    );
                  }
                  return (
                    <PropertiesWidget
                      properties={selectedComponentProperties}
                      isLoading={isPropertiesLoading}
                      width={propertiesWidth}
                      floating={isFloatingLayout}
                      translations={translations}
                      onClose={() => handleSelectComponent(null)}
                      onNameChange={async (newName) => {
                        if (!selectedComponent) return;
                        const oldName = selectedComponent;
                        if (expectedComponentNameRef) expectedComponentNameRef.current = newName;
                        setSelectedComponent(newName);
                        enqueueDiagramAction({ type: "updateName", oldName, newName });
                      }}
                      onDescriptionChange={async (newDescription) => {
                        if (!selectedComponent) return;
                        enqueueDiagramAction({
                          type: "updateDescription",
                          name: selectedComponent,
                          description: newDescription,
                        });
                      }}
                      onParameterChange={async (name, value) => {
                        if (!selectedComponent) return;
                        let effectiveValue = value;
                        const declaredType = (
                          selectedComponentProperties as
                            | (ComponentPropertyData & {
                                declaredType?: {
                                  elements?: Array<{
                                    name?: string;
                                    modification?: { expression?: { toJSON?: { toString(): string } } };
                                  }>;
                                };
                              })
                            | null
                        )?.declaredType;
                        if (declaredType && Array.isArray(declaredType.elements)) {
                          for (const el of declaredType.elements) {
                            if (el && el.name === name) {
                              const defaultExpr = el.modification?.expression?.toJSON?.toString();
                              if (defaultExpr !== undefined && defaultExpr === value) {
                                effectiveValue = "";
                              }
                              break;
                            }
                          }
                        }
                        enqueueDiagramAction({
                          type: "updateParameter",
                          name: selectedComponent,
                          parameter: name,
                          value: effectiveValue,
                        });
                      }}
                      onLocateComponent={(name) => {
                        effectiveDiagramRef.current?.centerCell?.(name);
                      }}
                      onGoToSource={(name) => {
                        onNodeDoubleClick?.(name);
                      }}
                      onDuplicateComponent={(name) => {
                        const node = diagramData?.nodes?.find((n) => n.id === name);
                        if (node) {
                          const nodeExt = node as unknown as {
                            type?: string;
                            className?: string;
                            data?: { className?: string };
                            x?: number;
                            y?: number;
                          };
                          const className =
                            nodeExt.type ||
                            nodeExt.className ||
                            nodeExt.data?.className ||
                            selectedComponentProperties?.className;
                          if (className) {
                            enqueueDiagramAction({
                              type: "addComponent",
                              className,
                              x: (nodeExt.x ?? 100) + 40,
                              y: (nodeExt.y ?? 100) + 40,
                            });
                          }
                        }
                      }}
                      onDeleteComponent={(name) => {
                        enqueueDiagramAction({ type: "deleteComponents", names: [name] });
                        handleSelectComponent(null);
                      }}
                    />
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* 3D CAD Viewer pane */}
        {showCadView && !showAnalysisView && !showVrRotunda && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minHeight: 0,
              zIndex: 2,
              backgroundColor: "var(--color-canvas-default)",
            }}
          >
            <Suspense fallback={null}>
              <CadViewerPanel
                components={cadComponents}
                selectedName={selectedComponent}
                onSelect={(name) => {
                  setSelectedComponent(name || null);
                }}
                dark={colorMode === "dark"}
                animationController={animationControllerRef.current}
                availableVariables={simulationVariables}
                onSaveBindings={handleSaveCadBindings}
                onCommitGizmoDelta={handleCommitCadGizmoDelta}
                onCommitDimensionDelta={handleCommitCadDimensionDelta}
                onCommitFaceTag={handleCommitCadFaceTag}
                onCommitAssemblyJoint={handleCommitCadAssemblyJoint}
                sourceCode={editorValue}
                vtkBuffer={vtkBuffer ?? undefined}
                gdtOverlay={gdtOverlay}
                caeSourceCode={
                  /\.(inp|bdf|dat|fem|su2|cfg|foam)$/i.test(activeFileName || "") || vtkBuffer ? editorValue : undefined
                }
                onRevealLine={onRevealLine}
                onInsertCaeSnippet={(snippet) => {
                  const targetEditor = editorRef.current ?? editor;
                  if (targetEditor) {
                    const nextCode = `${targetEditor.getValue().trimEnd()}\n${snippet.trimStart()}`;
                    targetEditor.setValue(nextCode);
                  }
                }}
                onOpenVrRotunda={openVrRotunda}
                fitInsets={cadFitInsets}
              />
            </Suspense>
          </div>
        )}

        {/* Engineering VR Rotunda Workstation Pane */}
        {showVrRotunda && (
          <div
            data-testid="ansatz-vr-rotunda-pane"
            style={
              isAnsatzEditorRoute || isFloatingLayout
                ? {
                    position: "fixed",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    minHeight: 0,
                    zIndex: 38,
                    backgroundColor: "#050914",
                  }
                : {
                    position: "absolute",
                    inset: 0,
                    paddingTop: hideCenterFloatingToolbar ? 0 : 56,
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    minHeight: 0,
                    zIndex: 35,
                    backgroundColor: "#050914",
                  }
            }
          >
            <Suspense
              fallback={
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#050914",
                  }}
                >
                  <Spinner />
                </div>
              }
            >
              <EngineeringRotundaPanel
                document={rotundaDocument}
                models={rotundaModels}
                mode="spatial-3d"
                title={rotundaTitle}
                animationController={animationControllerRef.current}
                topOverlayInset={isAnsatzEditorRoute || isFloatingLayout ? 72 : 12}
                onExitTo2D={() => setShowVrRotunda(false)}
              />
            </Suspense>
          </div>
        )}

        {/* Simulation Results and Cosimulation Pane */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            paddingTop: isFloatingLayout ? 70 : hideCenterFloatingToolbar ? 0 : 56,
            paddingLeft: isFloatingLayout ? floatingLeftOffset : 0,
            paddingRight:
              isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                : isFloatingLayout
                  ? 12
                  : 0,
            paddingBottom:
              isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
                ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                : isFloatingLayout
                  ? Math.max(12, diagnosticsBottomOffset)
                  : 0,
            boxSizing: "border-box",
            display: showResultsView && !showAnalysisView && !showVrRotunda ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showResultsView && !showAnalysisView && !showVrRotunda ? 2 : 0,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          {!hideCenterFloatingToolbar && showCosimSection && (
            <CosimPanel
              dataSource={cosimDataSource}
              onDataSourceChange={setCosimDataSource}
              colorMode={colorMode}
              onReplaySession={handleReplaySession}
              onPauseReplay={() => animationControllerRef.current?.pause()}
              onVariableSelected={(participantId, variable) => {
                const candidate = simulationVariables.includes(variable)
                  ? variable
                  : simulationVariables.includes(`${participantId}.${variable}`)
                    ? `${participantId}.${variable}`
                    : variable;
                if (!simulationVariables.includes(candidate)) {
                  handleVariablesLoaded([...simulationVariables, candidate]);
                }
                onToggleSimulationVariable?.(candidate);
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("ansatz:toggle-simulation-variable", {
                      detail: { participantId, variable: candidate },
                    }),
                  );
                }
                setShowVrRotunda(false);
                setShowResultsView(true);
                setShowCadView(false);
                setShowAnalysisView(false);
              }}
              sessions={recordedSessions}
              sessionId={selectedTreeClassName ? `live-${dialect}-${selectedTreeClassName}` : `live-${dialect}-default`}
            />
          )}
          {dialect.toLowerCase() === "ampl" ? (
            <AmplOptimizationResults
              result={amplSolveResult ?? null}
              status={simulationStatus}
              documentUri={documentUri}
              documentText={editorValue}
              projectFiles={projectFiles}
              activeFileName={activeFileName}
              onSolve={() => onSimulate?.()}
              onBackToInspector={() => setShowResultsView(false)}
            />
          ) : localSimulationData || simulationStatus?.status === "failed" ? (
            <Suspense fallback={null}>
              <SimulationResults
                localData={localSimulationData}
                complianceReport={pscadComplianceReport}
                pscadExports={pscadExports}
                sweepResults={sweepResults}
                simulationVariables={simulationVariables}
                selectedVariables={selectedSimulationVariables}
                onVariablesLoaded={handleVariablesLoaded}
                error={simulationStatus?.status === "failed" ? simulationStatus.error : null}
                colorMode={colorMode === "dark" ? "dark" : "light"}
                onRetry={onSimulate}
              />
            </Suspense>
          ) : (
            <div
              style={{
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--color-fg-muted)",
                gap: "12px",
              }}
            >
              {simulationStatus?.status === "pending" || simulationStatus?.status === "processing" ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                  <Spinner size="large" />
                  <div>Simulation in progress... please wait.</div>
                </div>
              ) : (
                <>
                  <div>Ready to simulate transient response.</div>
                  {onSimulate && (
                    <button
                      type="button"
                      onClick={onSimulate}
                      style={{
                        background: "var(--ms-brand, #0e7490)",
                        color: "#ffffff",
                        border: "1px solid var(--ms-brand, #0e7490)",
                        borderRadius: "6px",
                        padding: "6px 14px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      ▶ Run Simulation
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Secondary Domain Analytical Inspector Pane */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            paddingTop: isFloatingLayout ? 70 : hideCenterFloatingToolbar ? 0 : nestedModels.length > 1 ? 96 : 64,
            paddingLeft: isFloatingLayout ? floatingLeftOffset : 0,
            paddingRight:
              isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
                ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                : isFloatingLayout
                  ? 12
                  : 0,
            paddingBottom:
              isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
                ? `calc(${(1 - splitRatio) * 100}% + 12px)`
                : isFloatingLayout
                  ? Math.max(12, diagnosticsBottomOffset)
                  : 0,
            boxSizing: "border-box",
            display: showAnalysisView && !showVrRotunda ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showAnalysisView && !showVrRotunda ? 2 : 0,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          {(hasMultiFileProject || dialect.toLowerCase() === "modelica" || dialect.toLowerCase() === "comtrade") && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderBottom: `1px solid ${colorMode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"}`,
                flexShrink: 0,
              }}
            >
              <SegmentedControl
                aria-label="Inspector Mode"
                size="small"
                onChange={(idx) => {
                  const tabOrder: ("domain" | "thread" | "calibrate" | "rtm" | "uq" | "repl")[] = hasMultiFileProject
                    ? ["domain", "thread", "calibrate", "rtm", "uq", "repl"]
                    : ["domain", "calibrate", "rtm", "uq", "repl"];
                  setInspectorSubtab(tabOrder[idx] ?? "domain");
                }}
              >
                <SegmentedControl.Button selected={inspectorSubtab === "domain"}>
                  Domain Inspector
                </SegmentedControl.Button>
                {hasMultiFileProject && (
                  <SegmentedControl.Button selected={inspectorSubtab === "thread"}>
                    Digital Thread
                  </SegmentedControl.Button>
                )}
                <SegmentedControl.Button selected={inspectorSubtab === "calibrate"}>
                  Calibration
                </SegmentedControl.Button>
                <SegmentedControl.Button selected={inspectorSubtab === "rtm"}>
                  RTM &amp; Contracts
                </SegmentedControl.Button>
                <SegmentedControl.Button selected={inspectorSubtab === "uq"}>Opt / UQ</SegmentedControl.Button>
                <SegmentedControl.Button selected={inspectorSubtab === "repl"}>REPL</SegmentedControl.Button>
              </SegmentedControl>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {hasMultiFileProject && inspectorSubtab === "thread" ? (
              <AnsatzDigitalThreadPanel
                projectFiles={projectFiles}
                activeFileName={activeFileName}
                documentUri={documentUri}
                colorMode={colorMode}
                onSelectProjectFile={onSelectProjectFile}
                onUpdateProjectFile={onUpdateProjectFile}
                onRevealLine={onRevealLine}
              />
            ) : inspectorSubtab === "calibrate" ? (
              <AnsatzCalibrationPanel
                projectFiles={projectFiles}
                activeFileName={activeFileName}
                activeCode={editorValue}
                documentUri={documentUri}
                colorMode={colorMode}
                onUpdateProjectFile={onUpdateProjectFile}
                onCodeChange={(nextCode) => {
                  const targetEditor = editorRef.current ?? editor;
                  const model = targetEditor?.getModel?.();
                  if (targetEditor && model && targetEditor.getValue() !== nextCode) {
                    targetEditor.pushUndoStop();
                    targetEditor.executeEdits("calibration-apply", [
                      { range: model.getFullModelRange(), text: nextCode, forceMoveMarkers: true },
                    ]);
                    targetEditor.pushUndoStop();
                  }
                }}
              />
            ) : inspectorSubtab === "rtm" ? (
              <Suspense fallback={null}>
                <AnsatzRtmContractsPanel documentUri={documentUri} colorMode={colorMode} onRevealLine={onRevealLine} />
              </Suspense>
            ) : inspectorSubtab === "uq" ? (
              <Suspense fallback={null}>
                <AnsatzOptimizationUqPanel
                  documentUri={documentUri}
                  dialect={dialect}
                  selectedClassName={selectedTreeClassName ?? nestedModels[selectedModelIndex]?.name ?? undefined}
                  colorMode={colorMode}
                />
              </Suspense>
            ) : inspectorSubtab === "repl" ? (
              <Suspense fallback={null}>
                <AnsatzReplPanel documentUri={documentUri} dialect={dialect} colorMode={colorMode} />
              </Suspense>
            ) : (
              <PolyglotDomainPanel
                dialect={dialect}
                code={editorValue}
                colorMode={colorMode}
                isVisible={showAnalysisView && !showVrRotunda && inspectorSubtab === "domain"}
                documentUri={documentUri}
                activeClassName={selectedTreeClassName ?? nestedModels[selectedModelIndex]?.name ?? undefined}
                projectFiles={projectFiles}
                activeFileName={activeFileName}
                onUpdateProjectFile={onUpdateProjectFile}
                onRevealLine={onRevealLine}
                onCodeChange={(nextCode) => {
                  const targetEditor = editorRef.current ?? editor;
                  const model = targetEditor?.getModel?.();
                  if (targetEditor && model && targetEditor.getValue() !== nextCode) {
                    targetEditor.pushUndoStop();
                    targetEditor.executeEdits("pscad-authoring", [
                      { range: model.getFullModelRange(), text: nextCode, forceMoveMarkers: true },
                    ]);
                    targetEditor.pushUndoStop();
                  } else if (activeFileName && onUpdateProjectFile) {
                    onUpdateProjectFile(activeFileName, nextCode);
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
      {showComponentWizard && dialect === "pscad" && (
        <PscadComponentWizardModal
          code={editorValue}
          colorMode={colorMode}
          onApplyCode={(nextCode) => {
            const targetEditor = editorRef.current ?? editor;
            const model = targetEditor?.getModel?.();
            if (targetEditor && model && targetEditor.getValue() !== nextCode) {
              targetEditor.pushUndoStop();
              targetEditor.executeEdits("pscad-wizard", [
                { range: model.getFullModelRange(), text: nextCode, forceMoveMarkers: true },
              ]);
              targetEditor.pushUndoStop();
            } else if (activeFileName && onUpdateProjectFile) {
              onUpdateProjectFile(activeFileName, nextCode);
            }
          }}
          onClose={() => setShowComponentWizard(false)}
        />
      )}
    </div>
  );
};
