// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AmplOptimizationResults } from "@modelscript/ampl/ui/AmplOptimizationResults";
import type { DynamicBindingConfig, GdtOverlayPayload } from "@modelscript/cad";
import {
  computeCadSafeInsets,
  type CadComponent,
  type CommitAssemblyJointPayload,
  type CommitDimensionPayload,
  type CommitFaceTagPayload,
  type GizmoCommitPayload,
} from "@modelscript/cad-viewer";
import type { AnimationController } from "@modelscript/cad-viewer/animation-controller";
import type { ComponentPropertyData } from "@modelscript/diagram";
import { diagramPaletteToGalleryCatalog } from "@modelscript/rotunda/spatial-diagram-state";
import {
  buildRotundaCanvasDocument,
  type RotundaCadPartInput,
  type RotundaModelEntry,
  type RotundaModelKind,
} from "@modelscript/rotunda/types";
import { PulseIcon, StackIcon, TableIcon, WorkflowIcon, type Icon } from "@primer/octicons-react";
import { Breadcrumbs, UnderlineNav } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorCapabilities as useCapabilities, useEditorHost } from "../../host";
import { GALLERY_COMPONENTS } from "../componentGalleryCatalog";
import { getLanguageInfo } from "../constants";
import type { HistorianSession } from "../CosimPanel";
import DiagramEditor, { type DiagramDataProp, type DiagramEditorHandle } from "../Diagram";
import type { AnsatzXRayTokenHeat } from "../util/hypergraph-overlay";
import type { Translations } from "../util/i18n";
import {
  getClassIcon,
  getDiagramPalette,
  getDocumentParameters,
  getLibraryTree,
  getModelParameters,
  searchClasses,
  type AnsatzRelationalHypergraphRecord,
  type DocumentScalarParameter,
} from "../util/lsp-bridge";
import type {
  FaultGeneratorSpec,
  LinearConstraintSpec,
  ModalityPerturbationBudgets,
  ZonotopePendingOverride,
  ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state";
import type { TrainingStudioContextInfo } from "./AnsatzLifecycleStudioSections";
import type { MobileTab } from "./AnsatzMobileTabBar";
import type { ComputeDialPreset } from "./AnsatzTrainingStudioPanel";
import { getAvailableInspectorSubtabs, type InspectorSubtabId } from "./inspector-capabilities";
import { AnsatzView } from "./types";
import { Cad3DVisualizerSection } from "./visualizer/Cad3DVisualizerSection";
import { DiagramCanvasOverlays } from "./visualizer/DiagramCanvasOverlays";
import { StarterGalleryView } from "./visualizer/StarterGalleryView";
import { VisualizerFloatingToolbar } from "./visualizer/VisualizerFloatingToolbar";
import { VisualizerInspectorSection } from "./visualizer/VisualizerInspectorSection";
import { extractNodeDuplicateInfo, VisualizerPropertiesDrawer } from "./visualizer/VisualizerPropertiesDrawer";

const PscadComponentWizardModal = React.lazy(() =>
  import("@modelscript/pscad/ui/PscadComponentWizardModal").then((m) => ({
    default: m.PscadComponentWizardModal,
  })),
);

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
  onSelectView?: ((target: "diagram" | "3d" | "simulation" | "inspector" | "studio" | "code") => void) | undefined;
  onToggleSplit?: (() => void) | undefined;
  isVrMode?: boolean | undefined;
  onVrModeChange?: ((enabled: boolean) => void) | undefined;
  vrQuickEditOpen?: boolean | undefined;
  onToggleVrQuickEdit?: (() => void) | undefined;
  cadPartOverrides?:
    Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }> | undefined;
  onCadPartOverridesChange?:
    | React.Dispatch<
        React.SetStateAction<Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }>>
      >
    | undefined;
  diagnostics?:
    | readonly {
        readonly severity: "error" | "warning" | "info";
        readonly line: number;
        readonly message: string;
      }[]
    | undefined;
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
  showHypergraphOverlay?: boolean | undefined;
  onToggleHypergraphOverlay?: ((enabled: boolean) => void) | undefined;
  computeDial?: ComputeDialPreset | undefined;
  onChangeComputeDial?: ((preset: ComputeDialPreset) => void) | undefined;
  onXRayTokenHeatChange?: ((heat: AnsatzXRayTokenHeat[] | null) => void) | undefined;
  onLoadExampleSource?: ((source: string, dialect: string, uri?: string) => void) | undefined;
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onAddZonotopeConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  onToggleFaultGenerator?: ((spec: FaultGeneratorSpec) => void) | undefined;
  onUpdateZonotopeBudgets?: ((patch: Partial<ModalityPerturbationBudgets>) => void) | undefined;
  onClearPendingOverrides?: (() => void) | undefined;
  onWorstCaseXiChange?: ((xiMap: Record<number, number>) => void) | undefined;
  onStudioActiveChange?: ((active: boolean) => void) | undefined;
  requestedInspectorSubtab?: InspectorSubtabId | undefined;
  trainingStudioContext?: TrainingStudioContextInfo | undefined;
  zonotopeViolatingComponents?: string[] | undefined;
  onChangeCadToleranceFraction?: ((nextFraction: number) => void) | undefined;
  /** Optional sync group identifier to synchronize 3D CAD OrbitControls cameras across side-by-side panes. */
  cameraSyncGroup?: string | undefined;
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
  onOpenCloudModal,
  onFlatten: _onFlatten,
  hideCenterFloatingToolbar = false,
  showAnalysisView: controlledShowAnalysisView,
  setShowAnalysisView: controlledSetShowAnalysisView,
  documentUri,
  loadingProgress,
  onLoadStarterExample,
  isSplitActive,
  canSplit: _canSplit = true,
  splitOrientation: _splitOrientation = "columns",
  onSelectView,
  onToggleSplit,
  isVrMode: controlledIsVrMode,
  onVrModeChange,
  vrQuickEditOpen,
  onToggleVrQuickEdit,
  cadPartOverrides,
  onCadPartOverridesChange,
  diagnostics,
  treeWidth = 260,
  diagnosticsBottomOffset = 12,
  projectFiles,
  activeFileName,
  onSelectProjectFile,
  onUpdateProjectFile,
  psseDiagramOptions,
  onPsseDiagramOptionsChange,
  showHypergraphOverlay = false,
  onToggleHypergraphOverlay,
  computeDial = "auto-escalate",
  onChangeComputeDial,
  onXRayTokenHeatChange,
  onLoadExampleSource,
  zonotopeWorkbenchState,
  hypergraphRecord,
  onSelectZonotopeGroup,
  onAddZonotopeOverride,
  onAddZonotopeConstraint,
  onToggleFaultGenerator,
  onUpdateZonotopeBudgets,
  onClearPendingOverrides,
  onWorstCaseXiChange,
  onStudioActiveChange,
  requestedInspectorSubtab,
  trainingStudioContext,
  zonotopeViolatingComponents,
  onChangeCadToleranceFraction,
  cameraSyncGroup,
}) => {
  const { hasCapability } = useCapabilities();
  const isCosimMqttEnabled = hasCapability("cosimMqtt");
  const isTimescaleEnabled = hasCapability("timescaleHistorian");
  const showCosimSection = isCosimMqttEnabled || isTimescaleEnabled;
  const [isEmptyStateDismissed, setIsEmptyStateDismissed] = useState(false);
  const [createdCaeStudySource, setCreatedCaeStudySource] = useState<string | null>(null);
  const [companionCadComponents, setCompanionCadComponents] = useState<CadComponent[]>([]);
  useEffect(() => {
    if (cadComponents.length > 0) {
      setCompanionCadComponents(cadComponents);
    }
  }, [cadComponents]);
  const hasActiveCaeFile =
    /\.(inp|bdf|dat|fem|su2|cfg|foam)$/i.test(activeFileName || "") ||
    Boolean(createdCaeStudySource) ||
    Boolean(vtkBuffer);
  const hasMultiFileProject = Boolean(projectFiles && Object.keys(projectFiles).length >= 2);
  const availableInspectorSubtabs = useMemo(() => {
    const base = getAvailableInspectorSubtabs(dialect, projectFiles);
    if (onToggleHypergraphOverlay || onChangeComputeDial || onXRayTokenHeatChange || onLoadExampleSource) {
      return [...base, { id: "studio" as const, label: "RLVR Studio" }];
    }
    return base;
  }, [
    dialect,
    projectFiles,
    onToggleHypergraphOverlay,
    onChangeComputeDial,
    onXRayTokenHeatChange,
    onLoadExampleSource,
  ]);
  const [inspectorSubtab, setInspectorSubtab] = useState<InspectorSubtabId>(requestedInspectorSubtab ?? "domain");

  useEffect(() => {
    if (requestedInspectorSubtab) {
      setInspectorSubtab(requestedInspectorSubtab);
    }
  }, [requestedInspectorSubtab]);

  useEffect(() => {
    if (!availableInspectorSubtabs.some((t) => t.id === inspectorSubtab)) {
      setInspectorSubtab("domain");
    }
  }, [availableInspectorSubtabs, inspectorSubtab]);

  useEffect(() => {
    const handler = (event: Event) => {
      const subtab = (event as CustomEvent<{ subtab?: string }>).detail?.subtab;
      if (
        subtab === "domain" ||
        subtab === "thread" ||
        subtab === "calibrate" ||
        subtab === "rtm" ||
        subtab === "uq" ||
        subtab === "repl" ||
        subtab === "studio"
      ) {
        setInspectorSubtab(subtab);
      }
    };
    window.addEventListener("ansatz:select-inspector-subtab", handler);
    return () => window.removeEventListener("ansatz:select-inspector-subtab", handler);
  }, []);

  useEffect(() => {
    setIsEmptyStateDismissed(false);
  }, [dialect]);

  const [internalShowAnalysisView, setInternalShowAnalysisView] = useState(false);
  const showAnalysisView = controlledShowAnalysisView ?? internalShowAnalysisView;
  const setShowAnalysisView = controlledSetShowAnalysisView ?? setInternalShowAnalysisView;
  const [internalShowVrRotunda, setInternalShowVrRotunda] = useState(false);
  const showVrRotunda = controlledIsVrMode ?? internalShowVrRotunda;
  useEffect(() => {
    onStudioActiveChange?.(Boolean(showAnalysisView && !showVrRotunda && inspectorSubtab === "studio"));
  }, [onStudioActiveChange, showAnalysisView, showVrRotunda, inspectorSubtab]);
  const setShowVrRotunda = useCallback(
    (next: boolean) => {
      if (controlledIsVrMode === undefined) {
        setInternalShowVrRotunda(next);
      }
      onVrModeChange?.(next);
    },
    [controlledIsVrMode, onVrModeChange],
  );
  const [capturedDiagramSvgUrl, setCapturedDiagramSvgUrl] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [showComponentWizard, setShowComponentWizard] = useState(false);
  const [lspPaletteCategories, setLspPaletteCategories] = useState<
    { id: string; label: string; items: { type?: string; label: string; snippet?: string; className?: string }[] }[]
  >([]);
  const [activePaletteCategory, setActivePaletteCategory] = useState<string>("");
  const lastPaletteKeyRef = useRef<string>("");
  useEffect(() => {
    if (!showPalette && !showVrRotunda) return;
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
          items: Array.isArray(c.items)
            ? c.items
                .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === "object"))
                .map((it) => ({
                  ...(typeof it["type"] === "string" ? { type: it["type"] } : {}),
                  label: String(it["label"] ?? it["name"] ?? it["type"] ?? ""),
                  ...(typeof it["snippet"] === "string" ? { snippet: it["snippet"] } : {}),
                  ...(typeof it["className"] === "string" ? { className: it["className"] } : {}),
                  ...(typeof it["iconSvg"] === "string" ? { iconSvg: it["iconSvg"] } : {}),
                  ...(typeof it["description"] === "string" ? { description: it["description"] } : {}),
                }))
            : [],
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
    return undefined;
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
      icon: Icon;
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

  const [cstDocParameters, setCstDocParameters] = useState<DocumentScalarParameter[]>([]);

  useEffect(() => {
    if (!showVrRotunda || !documentUri || !editorValue?.trim()) {
      setCstDocParameters([]);
      return;
    }
    let cancelled = false;
    void getDocumentParameters(documentUri, editorValue)
      .then((list) => {
        if (!cancelled) {
          setCstDocParameters(Array.isArray(list) ? list : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCstDocParameters([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showVrRotunda, documentUri, editorValue]);

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
    if (params.length === 0 && cstDocParameters.length > 0) {
      for (const p of cstDocParameters.slice(0, 16)) {
        params.push({ name: p.name, value: p.value, unit: p.unit });
      }
    }
    return params.length > 0 ? params : undefined;
  }, [selectedComponentProperties, cstDocParameters]);

  const handleModifyRotundaParameter = useCallback(
    (paramName: string, nextValue: string) => {
      const hasComponentParam =
        Boolean(selectedComponent) &&
        Array.isArray(selectedComponentProperties?.parameters) &&
        selectedComponentProperties.parameters.some((p) => p?.name === paramName);
      if (hasComponentParam && selectedComponent) {
        enqueueDiagramAction({
          type: "updateParameter",
          name: selectedComponent,
          parameter: paramName,
          value: nextValue,
        });
        return;
      }
      const monacoEditor = editorRef?.current ?? editor;
      const model = monacoEditor?.getModel?.();
      if (!monacoEditor || !model) return;
      const cstParam = cstDocParameters.find((p) => p.name === paramName);
      if (!cstParam || cstParam.valueEndOffset < cstParam.valueStartOffset) return;
      const startPos = model.getPositionAt(cstParam.valueStartOffset);
      const endPos = model.getPositionAt(cstParam.valueEndOffset);
      monacoEditor.executeEdits("vr-inspector", [
        {
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          },
          text: nextValue,
          forceMoveMarkers: true,
        },
      ]);
    },
    [selectedComponent, selectedComponentProperties, enqueueDiagramAction, editorRef, editor, cstDocParameters],
  );

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

  const rotundaLibraryCatalog = useMemo(() => {
    if (lspPaletteCategories.length === 0) return GALLERY_COMPONENTS;
    return diagramPaletteToGalleryCatalog(
      {
        categories: lspPaletteCategories.map((c) => ({
          name: c.label,
          items: c.items
            .filter((it) => Boolean(it.className || it.type))
            .map((it) => ({
              label: it.label,
              className: it.className || it.type || it.label,
              iconSvg: (it as { iconSvg?: string }).iconSvg,
              description: (it as { description?: string }).description,
            })),
        })),
      },
      dialect || "modelica",
      GALLERY_COMPONENTS,
    );
  }, [lspPaletteCategories, dialect]);

  const rotundaLibraryProvider = useMemo(() => {
    if (!documentUri) return undefined;
    return {
      loadChildren: (parentId?: string) => getLibraryTree(documentUri, parentId),
      loadIcon: (className: string) => getClassIcon(className, documentUri),
      searchClasses: async (query: string, limit = 24) => {
        const res = await searchClasses(query, limit);
        return res.results;
      },
      loadParameters: async (className: string) => {
        const res = await getModelParameters(documentUri, className);
        return (res.parameters ?? []).slice(0, 4).map((name) => ({
          name,
          value: res.parameterValues?.[name] !== undefined ? String(res.parameterValues[name]) : undefined,
        }));
      },
    };
  }, [documentUri]);

  const rotundaDocument = useMemo(() => {
    const doc = buildRotundaCanvasDocument({
      title: rotundaTitle,
      languageId: dialect || "modelica",
      artifactUri: activeFileName || documentUri,
      diagramData: diagramData && typeof diagramData === "object" ? { ...diagramData } : null,
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
      const dup = extractNodeDuplicateInfo(node, selectedComponentProperties?.className);
      if (dup) {
        enqueueDiagramAction({
          type: "addComponent",
          className: dup.className,
          x: dup.x,
          y: dup.y,
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
    let authHeaders: Record<string, string> = {};
    try {
      const token =
        window.localStorage.getItem("modelscript-auth-token") ||
        window.localStorage.getItem("token") ||
        window.localStorage.getItem("auth_token");
      if (token) authHeaders = { Authorization: `Bearer ${token}` };
    } catch {
      // ignore storage errors
    }
    fetch("/api/v1/historian/sessions", { headers: authHeaders })
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

  const paneContainerRef = useRef<HTMLDivElement>(null);
  const [paneSize, setPaneSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const el = paneContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setPaneSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showCadView, view, showVrRotunda]);

  const isFullScreenSplitCanvas = !isNarrow && (hideCenterFloatingToolbar || isAnsatzEditorRoute) && isSplit(view);
  const isFloatingLayout =
    !isNarrow && (hideCenterFloatingToolbar || isAnsatzEditorRoute) && (!isSplit(view) || isFullScreenSplitCanvas);
  const floatingLeftOffset = treeVisible ? treeWidth + 24 : 12;

  const cadFitInsets = useMemo(
    () =>
      computeCadSafeInsets({
        isFloatingLayout,
        containerWidth: paneSize.width,
        containerHeight: paneSize.height,
        treeVisible: Boolean(treeVisible),
        treeWidth,
        isFullScreenSplitCanvas,
        splitDirection:
          view === AnsatzView.SPLIT_COLUMNS ? "columns" : view === AnsatzView.SPLIT_ROWS ? "rows" : "none",
        splitRatio,
        diagnosticsBottomOffset,
      }),
    [
      isFloatingLayout,
      paneSize.width,
      paneSize.height,
      treeVisible,
      treeWidth,
      isFullScreenSplitCanvas,
      view,
      splitRatio,
      diagnosticsBottomOffset,
    ],
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

  if (!showVrRotunda && !((view === AnsatzView.DIAGRAM || isSplit(view)) && (!isNarrow || mobileTab !== "code"))) {
    return null;
  }

  const floatingCardShadow =
    colorMode === "dark"
      ? "0 12px 36px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.28)"
      : "0 10px 32px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.05)";

  return (
    <div
      ref={paneContainerRef}
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
        <div
          style={{
            position: "relative",
            zIndex: 5,
            flexShrink: 0,
            backgroundColor: "var(--bgColor-muted, var(--ms-bg-elv))",
            borderBottom: "1px solid var(--borderColor-muted, var(--ms-divider))",
            minHeight: 38,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          <UnderlineNav aria-label="Models">
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
        </div>
      )}

      {/* Floating View Switcher & Actions (Only in standalone embedded mode without top workbench navbar) */}
      {!hideCenterFloatingToolbar &&
        !isAnsatzEditorRoute &&
        (!isNarrow ||
          showVrRotunda ||
          (!showResultsView && !showCadView && !showAnalysisView) ||
          cadComponents.length > 0 ||
          (showCadView && Boolean(animationControllerRef.current?.hasData))) && (
          <VisualizerFloatingToolbar
            colorMode={colorMode}
            isNarrow={isNarrow}
            isAnsatzEditorRoute={isAnsatzEditorRoute}
            nestedModelsCount={nestedModels.length}
            dialect={dialect}
            activeLangInfo={activeLangInfo}
            effectiveDiagramType={effectiveDiagramType}
            setDiagramType={setDiagramType}
            treeVisible={treeVisible}
            setTreeVisible={setTreeVisible}
            translations={translations}
            centerViewTabs={centerViewTabs}
            showVrRotunda={showVrRotunda}
            setShowVrRotunda={setShowVrRotunda}
            toggleVrRotunda={toggleVrRotunda}
            showResultsView={showResultsView}
            setShowResultsView={setShowResultsView}
            showCadView={showCadView}
            setShowCadView={setShowCadView}
            showAnalysisView={showAnalysisView}
            setShowAnalysisView={setShowAnalysisView}
            showPalette={showPalette}
            setShowPalette={setShowPalette}
            lspPaletteCategories={lspPaletteCategories}
            activePaletteCategory={activePaletteCategory}
            setActivePaletteCategory={setActivePaletteCategory}
            stencils={stencils}
            onInsertStencilSnippet={onInsertStencilSnippet}
            onOpenComponentWizard={() => setShowComponentWizard(true)}
            cadComponentsCount={cadComponents.length}
            animationMode={animationMode}
            animationControllerRef={animationControllerRef}
            onAutoLayout={onAutoLayout}
          />
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
                  language={dialect || "modelica"}
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
                  onSelect={(name) => {
                    if (showEmptyState) {
                      setIsEmptyStateDismissed(true);
                    }
                    handleSelectComponent(name);
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
                    const msg = rawMsg as {
                      type?: string;
                      startOffset?: number;
                      endOffset?: number;
                      className?: string;
                      diagramType?: string;
                    };
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
                  showZonotopeOverlay={showHypergraphOverlay}
                  zonotopeWorkbenchState={zonotopeWorkbenchState}
                  hypergraphRecord={hypergraphRecord}
                  onSelectZonotopeGroup={onSelectZonotopeGroup}
                  onAddZonotopeOverride={onAddZonotopeOverride}
                  onAddZonotopeConstraint={onAddZonotopeConstraint}
                  onToggleFaultGenerator={onToggleFaultGenerator}
                />
              </Suspense>

              {showEmptyState && (
                <StarterGalleryView
                  starterExamples={starterExamples}
                  colorMode={colorMode}
                  onDismiss={() => setIsEmptyStateDismissed(true)}
                  onLoadStarterExample={onLoadStarterExample}
                  editorRef={editorRef}
                />
              )}

              <DiagramCanvasOverlays
                supportsDiagram={Boolean(activeLangInfo.supportsDiagram)}
                hideCenterFloatingToolbar={hideCenterFloatingToolbar}
                colorMode={colorMode}
                showPalette={showPalette}
                setShowPalette={setShowPalette}
                handleUndo={handleUndo}
                handleRedo={handleRedo}
                effectiveDiagramRef={effectiveDiagramRef}
                onAutoLayout={onAutoLayout}
                translations={translations}
                isFullScreenSplitCanvas={isFullScreenSplitCanvas}
                view={view}
                splitRatio={splitRatio}
                isFloatingLayout={isFloatingLayout}
                diagnosticsBottomOffset={diagnosticsBottomOffset}
                selectedComponent={selectedComponent}
                propertiesWidth={propertiesWidth}
                currentZoom={currentZoom}
                showZoomMenu={showZoomMenu}
                setShowZoomMenu={setShowZoomMenu}
                zoomMenuRef={zoomMenuRef}
                showGridMenu={showGridMenu}
                setShowGridMenu={setShowGridMenu}
                gridMenuRef={gridMenuRef}
                gridMode={gridMode}
                handleGridModeChange={handleGridModeChange}
                isSnapActive={isSnapActive}
                handleSnapToggle={handleSnapToggle}
                isMinimapActive={isMinimapActive}
                toggleMinimapView={toggleMinimapView}
              />
            </div>
          </div>

          {selectedComponent && (
            <VisualizerPropertiesDrawer
              selectedComponent={selectedComponent}
              setSelectedComponent={setSelectedComponent}
              handleSelectComponent={handleSelectComponent}
              selectedComponentProperties={selectedComponentProperties}
              isPropertiesLoading={isPropertiesLoading}
              propertiesWidth={propertiesWidth}
              setPropertiesWidth={setPropertiesWidth}
              isFloatingLayout={isFloatingLayout}
              isFullScreenSplitCanvas={isFullScreenSplitCanvas}
              view={view}
              splitRatio={splitRatio}
              diagnosticsBottomOffset={diagnosticsBottomOffset}
              diagramData={diagramData}
              translations={translations}
              expectedComponentNameRef={expectedComponentNameRef}
              effectiveDiagramRef={effectiveDiagramRef}
              enqueueDiagramAction={enqueueDiagramAction}
              onNodeDoubleClick={onNodeDoubleClick}
            />
          )}
        </div>

        <Cad3DVisualizerSection
          dialect={dialect}
          diagramType={diagramType}
          setDiagramType={setDiagramType}
          view={view}
          showCadView={showCadView}
          setShowCadView={setShowCadView}
          showResultsView={showResultsView}
          setShowResultsView={setShowResultsView}
          showAnalysisView={showAnalysisView}
          setShowAnalysisView={setShowAnalysisView}
          showVrRotunda={showVrRotunda}
          setShowVrRotunda={setShowVrRotunda}
          openVrRotunda={openVrRotunda}
          cadComponents={cadComponents}
          companionCadComponents={companionCadComponents}
          setCompanionCadComponents={setCompanionCadComponents}
          hasActiveCaeFile={hasActiveCaeFile}
          createdCaeStudySource={createdCaeStudySource}
          setCreatedCaeStudySource={setCreatedCaeStudySource}
          selectedComponent={selectedComponent}
          setSelectedComponent={setSelectedComponent}
          handleSelectComponent={handleSelectComponent}
          selectedComponentProperties={selectedComponentProperties}
          colorMode={colorMode}
          animationControllerRef={animationControllerRef}
          simulationVariables={simulationVariables}
          selectedSimulationVariables={selectedSimulationVariables}
          onToggleSimulationVariable={onToggleSimulationVariable}
          localSimulationData={localSimulationData}
          simulationStatus={simulationStatus}
          handleSaveCadBindings={handleSaveCadBindings}
          handleCommitCadGizmoDelta={handleCommitCadGizmoDelta}
          handleCommitCadDimensionDelta={handleCommitCadDimensionDelta}
          handleCommitCadFaceTag={handleCommitCadFaceTag}
          handleCommitCadAssemblyJoint={handleCommitCadAssemblyJoint}
          editorValue={editorValue}
          editor={editor}
          editorRef={editorRef}
          activeFileName={activeFileName}
          projectFiles={projectFiles}
          onSelectProjectFile={onSelectProjectFile}
          onUpdateProjectFile={onUpdateProjectFile}
          vtkBuffer={vtkBuffer}
          gdtOverlay={gdtOverlay}
          onOpenCloudModal={onOpenCloudModal}
          onRevealLine={onRevealLine}
          hideCenterFloatingToolbar={hideCenterFloatingToolbar}
          isAnsatzEditorRoute={isAnsatzEditorRoute}
          isFloatingLayout={isFloatingLayout}
          cadFitInsets={cadFitInsets}
          cadPartOverrides={cadPartOverrides}
          onCadPartOverridesChange={onCadPartOverridesChange}
          cameraSyncGroup={cameraSyncGroup}
          showHypergraphOverlay={showHypergraphOverlay}
          zonotopeWorkbenchState={zonotopeWorkbenchState}
          hypergraphRecord={hypergraphRecord}
          onSelectZonotopeGroup={onSelectZonotopeGroup}
          onAddZonotopeOverride={onAddZonotopeOverride}
          onAddZonotopeConstraint={onAddZonotopeConstraint}
          zonotopeViolatingComponents={zonotopeViolatingComponents}
          onChangeCadToleranceFraction={onChangeCadToleranceFraction}
          activeLangInfo={activeLangInfo}
          isSplitActive={isSplitActive}
          onSelectView={onSelectView}
          onToggleSplit={onToggleSplit}
          vrQuickEditOpen={vrQuickEditOpen}
          onToggleVrQuickEdit={onToggleVrQuickEdit}
          rotundaDocument={rotundaDocument}
          rotundaModels={rotundaModels}
          rotundaTitle={rotundaTitle}
          rotundaParameters={rotundaParameters}
          handleModifyRotundaParameter={handleModifyRotundaParameter}
          rotundaLibraryCatalog={rotundaLibraryCatalog}
          rotundaLibraryProvider={rotundaLibraryProvider}
          diagnostics={diagnostics}
          enqueueDiagramAction={enqueueDiagramAction}
          handleUndo={handleUndo}
          handleRedo={handleRedo}
          onNodeDoubleClick={onNodeDoubleClick}
          diagramData={diagramData}
          onAutoLayout={onAutoLayout}
          onSimulate={onSimulate}
        />

        <VisualizerInspectorSection
          dialect={dialect}
          view={view}
          splitRatio={splitRatio}
          isFloatingLayout={isFloatingLayout}
          isFullScreenSplitCanvas={isFullScreenSplitCanvas}
          floatingLeftOffset={floatingLeftOffset}
          diagnosticsBottomOffset={diagnosticsBottomOffset}
          hideCenterFloatingToolbar={hideCenterFloatingToolbar}
          showResultsView={showResultsView}
          setShowResultsView={setShowResultsView}
          showCadView={showCadView}
          setShowCadView={setShowCadView}
          showAnalysisView={showAnalysisView}
          setShowAnalysisView={setShowAnalysisView}
          showVrRotunda={showVrRotunda}
          setShowVrRotunda={setShowVrRotunda}
          showCosimSection={showCosimSection}
          cosimDataSource={cosimDataSource}
          setCosimDataSource={setCosimDataSource}
          handleReplaySession={handleReplaySession}
          animationControllerRef={animationControllerRef}
          simulationVariables={simulationVariables}
          selectedSimulationVariables={selectedSimulationVariables}
          handleVariablesLoaded={handleVariablesLoaded}
          onToggleSimulationVariable={onToggleSimulationVariable}
          recordedSessions={recordedSessions}
          selectedTreeClassName={selectedTreeClassName}
          nestedModels={nestedModels}
          selectedModelIndex={selectedModelIndex}
          colorMode={colorMode}
          amplSolveResult={amplSolveResult}
          simulationStatus={simulationStatus}
          documentUri={documentUri}
          editorValue={editorValue}
          editor={editor}
          editorRef={editorRef}
          projectFiles={projectFiles}
          activeFileName={activeFileName}
          onSelectProjectFile={onSelectProjectFile}
          onUpdateProjectFile={onUpdateProjectFile}
          onSimulate={onSimulate}
          localSimulationData={localSimulationData}
          pscadComplianceReport={pscadComplianceReport}
          pscadExports={pscadExports}
          sweepResults={sweepResults}
          availableInspectorSubtabs={availableInspectorSubtabs}
          inspectorSubtab={inspectorSubtab}
          setInspectorSubtab={setInspectorSubtab}
          hasMultiFileProject={hasMultiFileProject}
          onRevealLine={onRevealLine}
          showHypergraphOverlay={showHypergraphOverlay}
          onToggleHypergraphOverlay={onToggleHypergraphOverlay}
          computeDial={computeDial}
          onChangeComputeDial={onChangeComputeDial}
          onXRayTokenHeatChange={onXRayTokenHeatChange}
          onLoadExampleSource={onLoadExampleSource}
          zonotopeWorkbenchState={zonotopeWorkbenchState}
          hypergraphRecord={hypergraphRecord}
          onUpdateZonotopeBudgets={onUpdateZonotopeBudgets}
          onAddZonotopeOverride={onAddZonotopeOverride}
          onSelectZonotopeGroup={onSelectZonotopeGroup}
          onClearPendingOverrides={onClearPendingOverrides}
          onWorstCaseXiChange={onWorstCaseXiChange}
          trainingStudioContext={trainingStudioContext}
        />
      </div>
      {showComponentWizard && dialect === "pscad" && (
        <React.Suspense fallback={null}>
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
        </React.Suspense>
      )}
    </div>
  );
};
