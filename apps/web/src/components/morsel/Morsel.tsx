// SPDX-License-Identifier: AGPL-3.0-or-later

import { decodeDataUrl } from "@modelscript/dsl/utils";
import type { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme as useSiteTheme } from "../../theme";
import type { CodeEditorHandle } from "./Code";
import type { DiagramEditorHandle } from "./Diagram";
import "./morsel.css";
import { getTranslations, uiLanguages } from "./util/i18n";
import {
  applyDiagramEdits,
  applyLspEdits,
  didOpen,
  getComponentProperties,
  getDiagramData,
  parseCode,
} from "./util/lsp-bridge";
import { startLsp } from "./util/lsp-worker";

import { useToast } from "../ToastContext";
import { useMorselEngine } from "./hooks";
import {
  MorselFloatingDock,
  MorselLeftSidebar,
  MorselMobileTabBar,
  MorselModals,
  MorselVisualizerPane,
  MorselView as View,
  type MobileTab,
} from "./panels";
import ParameterSliderRibbon from "./ParameterSliderRibbon";

const CodeEditor = React.lazy(() => import("./Code"));

/** URI used for the open document — must match the URI in CodeEditor and TreeWidget. */
const DOCUMENT_URI = "file:///document.mo";

export interface MorselEditorProps {
  dataUrl?: DataUrl | null | undefined;
  initialCode?: string | undefined;
  embed?: boolean | undefined;
  initialDialect?: string | undefined;
  initialView?: "split-columns" | "split-rows" | "code-only" | "diagram-only" | "cad-only" | "plot-only" | undefined;
  initialAnchor?: { elementId: string; kind?: string; line?: number; column?: number } | undefined;
  showParameterRibbon?: boolean | undefined;
  onCodeChange?: ((code: string) => void) | undefined;
  onSave?: ((code: string) => void) | undefined;
}

const isSplit = (v: View) => v === View.SPLIT_COLUMNS || v === View.SPLIT_ROWS;

export default function MorselEditor(props: MorselEditorProps) {
  const toast = useToast();
  const [isShareDialogOpen, setShareDialogOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const [isAddLibraryOpen, setIsAddLibraryOpen] = useState(false);
  const addLibraryButtonRef = useRef<HTMLButtonElement>(null);
  const [isOpenFileDialogOpen, setIsOpenFileDialogOpen] = useState(false);
  const openFileButtonRef = useRef<HTMLButtonElement>(null);
  const [isFlattenDialogOpen, setFlattenDialogOpen] = useState(false);
  const [flattenedCode, setFlattenedCode] = useState("");
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const [decodedContent] = decodeDataUrl(props.dataUrl ?? null);
  const content = props.initialCode ?? decodedContent ?? "model Example\n\nend Example;";
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);

  useEffect(() => {
    if (props.initialCode && editor && editor.getValue() !== props.initialCode) {
      editor.setValue(props.initialCode);
    }
  }, [props.initialCode, editor]);

  const initialIsCad =
    props.initialView === "cad-only" || props.initialDialect === "step" || props.initialDialect === "scad";
  const initialIsPlot = props.initialView === "plot-only";
  const initialViewMode =
    props.initialView === "code-only"
      ? View.CODE
      : props.initialView === "diagram-only" || initialIsCad || initialIsPlot
        ? View.DIAGRAM
        : props.initialView === "split-rows"
          ? View.SPLIT_ROWS
          : View.SPLIT_COLUMNS;

  const [view, setView] = useState<View>(initialViewMode);
  const [showResultsView, setShowResultsView] = useState(initialIsPlot);
  const [showCadView, setShowCadView] = useState(initialIsCad);
  const [mobileTab, setMobileTab] = useState<MobileTab>(
    initialIsCad ? "cad" : initialIsPlot ? "results" : initialViewMode === View.CODE ? "code" : "diagram",
  );
  const cachedSimulatorRef = useRef<any | null>(null);
  const [lastLoadedContent, setLastLoadedContent] = useState<string>("");
  const [isDirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(props.initialAnchor?.elementId ?? null);
  const [selectedComponent, setSelectedComponent] = useState<string | null>(props.initialAnchor?.elementId ?? null);
  const [selectedComponentProperties, setSelectedComponentProperties] = useState<any | null>(null);
  const [isPropertiesLoading, setIsPropertiesLoading] = useState(false);
  const [diagramData, setDiagramData] = useState<any>(null);
  const [selectedTreeClassName, setSelectedTreeClassName] = useState<string | null>(null);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [documentModels, setDocumentModels] = useState<{ name: string; kind: string }[]>([]);
  const isSpatialEditPending = useRef(false);
  const diagramEditorRef = useRef<DiagramEditorHandle>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  const [isDiagramLoading, setIsDiagramLoading] = useState(false);
  const [treeVisible, setTreeVisible] = useState(true);
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [splitRatio, setSplitRatio] = useState(0.5);

  const handleSelectComponent = useCallback(
    (name: string | null) => {
      if (!name || name === "__diagram_background__" || name === "__diagram_axes__") {
        setSelectedComponent(null);
        setSelectedComponentProperties(null);
        setIsPropertiesLoading(false);
        return;
      }
      setSelectedComponent(name);

      // Show lightweight properties immediately while full schema loads
      const initialProps = diagramData?.nodes?.find((n: any) => n.id === name)?.properties ?? null;
      setSelectedComponentProperties(initialProps);
      setIsPropertiesLoading(true);

      getComponentProperties(DOCUMENT_URI, selectedTreeClassName || undefined, name)
        .then((props) => {
          if (props) {
            setSelectedComponentProperties(props);
          }
        })
        .catch((e) => {
          console.error("[morsel] Error fetching component properties:", e);
        })
        .finally(() => {
          setIsPropertiesLoading(false);
        });
    },
    [diagramData, selectedTreeClassName],
  );

  const {
    simulationVariables,
    selectedSimulationVariables,
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
    setLocalSimulationData,
    cadComponents,
    animationControllerRef,
    animationMode,
    cosimDataSource,
    setCosimDataSource,
    ribbonParams,
    handleRibbonParamChange,
    handleRibbonParamReset,
    handleReplaySession,
    handleSaveCadBindings,
    handleSimulate,
  } = useMorselEngine({
    documentUri: DOCUMENT_URI,
    selectedTreeClassName,
    contextVersion,
    content,
    editor,
    showResultsView,
    setShowResultsView,
    isNarrow,
    setMobileTab,
    setTreeVisible,
    setView,
    viewDiagramEnum: View.DIAGRAM,
  });
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplit = useRef(false);
  const [treeWidth, setTreeWidth] = useState(300);
  const [propertiesWidth, setPropertiesWidth] = useState(300);
  const { theme, toggleTheme } = useSiteTheme();
  const isDark = theme === "dark";
  const colorMode = isDark ? "dark" : "light";
  const resolvedColorMode: "night" | "day" = isDark ? "night" : "day";
  const [libraryFilter, setLibraryFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [contextVersion, setContextVersion] = useState(0);
  const expectedComponentNameRef = useRef<string | null>(null);
  const pendingModelNameRef = useRef<string | null>(null);
  const [isSplashVisible, setSplashVisible] = useState(!props.dataUrl && !props.initialCode && !props.embed);
  const [pendingSplashVisible, setPendingSplashVisible] = useState(false);
  const isInitialized = useRef(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const translations = useMemo(() => getTranslations(language), [language]);

  const pendingDiagramActionsRef = useRef<any[]>([]);
  const diagramActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagramEditQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueDiagramAction = useCallback((action: any) => {
    if (!editorRef.current) return;
    pendingDiagramActionsRef.current.push(action);
    if (diagramActionTimerRef.current) clearTimeout(diagramActionTimerRef.current);

    const isSpatial = ["move", "resize", "rotate", "moveEdge"].includes(action.type);
    if (!isSpatial) setIsDiagramLoading(true);
    const delay = isSpatial ? 10 : 0; // reduced delay since diagram-core batches correctly now

    diagramActionTimerRef.current = setTimeout(() => {
      const actions = pendingDiagramActionsRef.current;
      pendingDiagramActionsRef.current = [];
      diagramActionTimerRef.current = null;
      if (actions.length > 0) {
        diagramEditQueueRef.current = diagramEditQueueRef.current
          .then(async () => {
            const response = await applyDiagramEdits(DOCUMENT_URI, actions, 1);
            if (response && response.edits && response.edits.length > 0 && editorRef.current) {
              if (response.renderHint === "none") {
                isSpatialEditPending.current = true;
              } else {
                isSpatialEditPending.current = false;
              }
              applyLspEdits(editorRef.current, response.edits, actions[0].type);
              // Yield to event loop to ensure didChange is sent to LSP before next edit is computed
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          })
          .catch((err) => {
            console.error("Failed to apply diagram edit batch:", err);
          });
      }
    }, delay);
  }, []);

  // Collect all displayable models/blocks defined in current document
  const nestedModels = documentModels;

  // Extract models/blocks defined in the current document for model tabs
  useEffect(() => {
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
            setSelectedTreeClassName((prev) => {
              if (prev && res.classes.some((c) => c.name === prev)) return prev;
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
  }, [contextVersion, content]);

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
  }, [treeVisible, props.embed]);

  useEffect(() => {
    const init = async () => {
      if (isInitialized.current) return;
      isInitialized.current = true;

      setLoadingProgress(10);
      setLoadingMessage("Starting language server…");

      try {
        const conn = await startLsp();
        conn.onNotification("modelscript/projectTreeChanged", () => {
          console.log("[Morsel] Received modelscript/projectTreeChanged");
          if (isSpatialEditPending.current) {
            isSpatialEditPending.current = false;
            setIsDiagramLoading(false);
          } else {
            setContextVersion((v) => v + 1);
          }
        });
        conn.onNotification("modelscript/status", (params: any) => {
          console.log("[Morsel] Received modelscript/status:", params);
          if (params?.state === "ready") {
            setContextVersion((v) => v + 1);
          }
        });
      } catch (e) {
        console.error("Failed to start LSP:", e);
      }

      setLoadingProgress(80);
      setLoadingMessage("Loading workspace…");

      // Notify LSP of the initial file content
      didOpen(DOCUMENT_URI, content);

      // Force tree update by bumping version now that LSP is ready
      setContextVersion((v) => v + 1);

      setAvailableLanguages(uiLanguages);

      setExampleModels([
        {
          id: "injection-molding-cosim",
          name: "Injection Molding Co-Simulation",
          content: `package Manufacturing
  import Modelica.Fluid.Interfaces.FluidPort_a;
  import Modelica.Fluid.Sources.MassFlowSource_T;
  import ModelScript.Geometry;
  
  // 1. Define the 3D CAD Geometry
  shape SnesTopShell extends Geometry.Box
    parameter Real width = 150;
    parameter Real height = 60;
    parameter Real depth = 20;
    // ... CSG operations for buttons omitted for brevity
  end SnesTopShell;

  // 2. Define the 3D CFD Interface Block using a new 'field' class kind
  field InjectionCavity "A boundary node that proxies the 3D OpenFOAM solver"
    parameter Geometry.Shape geometry;
    parameter String material = "ABS";
    parameter Real moldTemp = 40.0;
    
    // The 1D port that connects to the rest of the Modelica system
    FluidPort_a gateInlet;
  equation
    // The pressure and flow equations are NOT defined here algebraically.
    // They are satisfied by the external OpenFOAM orchestrator.
  end InjectionCavity;

  // 3. Define the 1D System Dynamics (The Machine) using the 'model' class kind
  model HydraulicInjectionUnit "1D Lumped parameter model of the injection machine"
    parameter Real targetPressure = 150e6;
    parameter Real barrelTemp = 493.15;
    
    // Internal 1D physics components
    Modelica.Fluid.Sources.MassFlowSource_T ram(
      nPorts = 1,
      m_flow = 0.05,
      T = barrelTemp
    );
    
    // Expose the fluid port to the outside
    FluidPort_a fluidOut;
  equation
    connect(ram.ports[1], fluidOut);
  end HydraulicInjectionUnit;

  // 4. The Full System Orchestration using the 'process' class kind
  process SnesMoldProcess
    // Instantiate the 1D Machine (model)
    HydraulicInjectionUnit injectionMachine(targetPressure = 150e6);
    
    // Instantiate the 3D CFD Domain (field)
    InjectionCavity mold(
      geometry = SnesTopShell(), // Instantiate the 3D CAD (shape)
      material = "ABS",
      moldTemp = 40.0
    );
  equation
    // The crucial connection: 1D mass flow couples to the 3D boundary patch
    connect(injectionMachine.fluidOut, mold.gateInlet);
  end SnesMoldProcess;
end Manufacturing;`,
        },
      ]);

      // Defer hiding the loading screen until the browser is idle
      const hideLoading = () => {
        setLoadingProgress(100);
        setLoadingMessage("Ready");
      };
      if ("requestIdleCallback" in window) {
        requestIdleCallback(hideLoading, { timeout: 500 });
      } else {
        setTimeout(hideLoading, 300);
      }
    };
    init();
  }, [content]);

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

  const NARROW_BREAKPOINT = 768;
  const isNarrow = windowWidth < NARROW_BREAKPOINT;

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
      setTreeVisible(true);
      setView((prev) => (prev === View.CODE ? View.SPLIT_COLUMNS : prev));
    }
  }, [isNarrow, mobileTab]);

  useEffect(() => {
    if (content) {
      setLastLoadedContent(content);
    }
  }, [content]);

  useEffect(() => {
    // LSP handles class instance sync
  }, []);

  useEffect(() => {
    if (view === View.DIAGRAM || isSplit(view)) {
      setTimeout(() => {
        diagramEditorRef.current?.fitContent();
      }, 100);
    }
  }, [view, treeVisible]);

  const loadClass = async (className: string, kind?: string) => {
    // Store the name so the diagram tab auto-selects if it's a model/block
    if (kind === "model" || kind === "block") {
      pendingModelNameRef.current = className;
    } else {
      pendingModelNameRef.current = null;
    }

    if (view === View.DIAGRAM || isSplit(view)) {
      setTimeout(() => {
        diagramEditorRef.current?.fitContent();
      }, 100);
    }

    try {
      const { getClassSource } = await import("./util/lsp-bridge");
      const { content, error } = await getClassSource(className);
      if (content && editorRef.current) {
        editorRef.current.setValue(content);
        codeEditorRef.current?.sync();
      } else if (error) {
        console.warn(`Failed to fetch source for ${className}:`, error);
      }
    } catch (e) {
      console.error(`Error loading source for ${className}:`, e);
    }
  };

  const editorRef = useRef(editor);
  const lastLoadedContentRef = useRef(lastLoadedContent);
  const loadClassRef = useRef(loadClass);
  editorRef.current = editor;
  lastLoadedContentRef.current = lastLoadedContent;
  loadClassRef.current = loadClass;

  const handleTreeSelect = useCallback(
    (className: string, kind: string) => {
      if (editorRef.current?.getValue() !== lastLoadedContentRef.current && pendingSelection !== className) {
        setPendingSelection(className);
        setDirtyDialogOpen(true);
      } else {
        loadClassRef.current(className, kind);
      }
    },
    [pendingSelection],
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      return "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // Fetch diagram data via LSP when selected component or file changes
  useEffect(() => {
    if (!selectedTreeClassName) {
      setDiagramData(null);
      setIsDiagramLoading(false);
      return;
    }

    let cancelled = false;
    setIsDiagramLoading(true);

    getDiagramData(DOCUMENT_URI, selectedTreeClassName, "diagram")
      .then((data) => {
        if (cancelled) return;
        setDiagramData(data);
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
  }, [selectedTreeClassName, contextVersion]);

  const handleFlatten = async () => {
    try {
      const result = await (await import("./util/lsp-bridge")).flatten(selectedTreeClassName ?? "", DOCUMENT_URI);
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

  return (
    <>
      <title>{"Morsel"}</title>
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
        <MorselMobileTabBar
          isNarrow={isNarrow}
          mobileTab={mobileTab}
          setMobileTab={setMobileTab}
          setTreeVisible={setTreeVisible}
          setView={setView}
          setShowResultsView={setShowResultsView}
          setShowCadView={setShowCadView}
          onSimulate={handleSimulate}
          simulationStatus={simulationStatus}
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
          }}
        >
          <MorselLeftSidebar
            treeVisible={treeVisible}
            isNarrow={isNarrow}
            treeWidth={treeWidth}
            setTreeWidth={setTreeWidth}
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
            onOpenAddLibrary={() => setIsAddLibraryOpen(true)}
            documentUri={DOCUMENT_URI}
            debouncedFilter={debouncedFilter}
            onTreeSelect={handleTreeSelect}
            onTreeHighlight={handleTreeHighlight}
            contextVersion={contextVersion}
            language={language}
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
          />

          <div
            className={`d-flex flex-1 ${view === View.SPLIT_ROWS ? "flex-column" : ""}`}
            ref={splitContainerRef}
            style={{
              display: isNarrow && mobileTab === "params" ? "none" : "flex",
              flex: 1,
              flexDirection: view === View.SPLIT_ROWS ? "column" : "row",
              minHeight: 0,
              minWidth: 0,
              height: "100%",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <MorselVisualizerPane
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
              showResultsView={showResultsView}
              setShowResultsView={setShowResultsView}
              showCadView={showCadView}
              setShowCadView={setShowCadView}
              cadComponents={cadComponents}
              animationMode={animationMode}
              animationControllerRef={animationControllerRef}
              diagramEditorRef={diagramEditorRef}
              diagramData={diagramData}
              selectedTreeClassName={selectedTreeClassName}
              selectedComponent={selectedComponent}
              setSelectedComponent={setSelectedComponent}
              isDiagramLoading={isDiagramLoading}
              setIsDiagramLoading={setIsDiagramLoading}
              handleSelectComponent={handleSelectComponent}
              enqueueDiagramAction={enqueueDiagramAction}
              editor={editor}
              editorRef={editorRef}
              isSpatialEditPending={isSpatialEditPending}
              propertiesWidth={propertiesWidth}
              setPropertiesWidth={setPropertiesWidth}
              selectedComponentProperties={selectedComponentProperties}
              isPropertiesLoading={isPropertiesLoading}
              expectedComponentNameRef={expectedComponentNameRef}
              handleSaveCadBindings={handleSaveCadBindings}
              simulationVariables={simulationVariables || []}
              selectedSimulationVariables={selectedSimulationVariables}
              cosimDataSource={cosimDataSource}
              setCosimDataSource={setCosimDataSource}
              handleReplaySession={handleReplaySession}
              localSimulationData={localSimulationData}
              sweepResults={sweepResults}
              simulationStatus={simulationStatus}
              handleVariablesLoaded={handleVariablesLoaded}
            />

            {/* Split Resizer */}
            {isSplit(view) && !isNarrow && (
              <div
                style={{
                  width: view === View.SPLIT_COLUMNS ? 6 : "100%",
                  height: view === View.SPLIT_ROWS ? 6 : "100%",
                  cursor: view === View.SPLIT_COLUMNS ? "col-resize" : "row-resize",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  backgroundColor: "transparent",
                  display: "flex",
                  borderLeft:
                    view === View.SPLIT_COLUMNS ? `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}` : "none",
                  borderTop:
                    view === View.SPLIT_ROWS ? `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}` : "none",
                  transition: "background-color 0.15s",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isDraggingSplit.current = true;
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
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    colorMode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              />
            )}

            {/* Code Editor */}
            <div
              style={{
                display: (view === View.CODE || isSplit(view)) && (!isNarrow || mobileTab === "code") ? "flex" : "none",
                flex: isNarrow ? 1 : isSplit(view) ? "none" : 1,
                width: isNarrow
                  ? "100%"
                  : isSplit(view) && view === View.SPLIT_COLUMNS
                    ? `${(1 - splitRatio) * 100}%`
                    : isSplit(view)
                      ? undefined
                      : "100%",
                height: isNarrow
                  ? "100%"
                  : isSplit(view) && view === View.SPLIT_ROWS
                    ? `${(1 - splitRatio) * 100}%`
                    : "100%",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <Suspense fallback={null}>
                <CodeEditor
                  uri={DOCUMENT_URI}
                  ref={codeEditorRef}
                  embed={props.embed ?? false}
                  setEditor={setEditor}
                  content={content}
                  onChange={props.onCodeChange}
                  theme={colorMode === "dark" ? "vs-dark" : "light"}
                  externalErrors={
                    simulationStatus?.status === "failed" && simulationStatus.error ? [simulationStatus.error] : []
                  }
                />
              </Suspense>
            </div>
          </div>
        </div>

        {/* Floating dock */}
        <MorselFloatingDock
          colorMode={colorMode}
          treeVisible={treeVisible}
          setTreeVisible={setTreeVisible}
          translations={translations}
          onNewModel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (editorRef.current?.getValue() !== lastLoadedContentRef.current) {
              setPendingSplashVisible(true);
              setDirtyDialogOpen(true);
            } else {
              setSplashVisible(true);
            }
          }}
          openFileButtonRef={openFileButtonRef}
          onOpenFile={() => setIsOpenFileDialogOpen(true)}
          onSaveModel={async () => {
            const content = editor?.getValue() || "";
            let filename = "model.mo";
            if (codeEditorRef.current) {
              const synced = await codeEditorRef.current.sync();
              if ((synced as any)?.[0]?.name) {
                filename = `${(synced as any)[0].name}.mo`;
              }
            }
            const blob = new Blob([content], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
          onAutoLayout={() => {
            if (confirm(translations.autoLayoutConfirm)) {
              diagramEditorRef.current?.layout();
            }
          }}
          view={view}
          setView={setView}
          isNarrow={isNarrow}
          onSimulate={handleSimulate}
          onOpenCloudModal={() => setIsCloudModalOpen(true)}
          onFlatten={handleFlatten}
          shareButtonRef={shareButtonRef}
          isShareDialogOpen={isShareDialogOpen}
          setShareDialogOpen={setShareDialogOpen}
          availableLanguages={availableLanguages}
          language={language}
          setLanguage={setLanguage}
          setContextVersion={setContextVersion}
          isDark={isDark}
          toggleTheme={toggleTheme}
        />

        {/* Modals & Dialogs */}
        <MorselModals
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
          isDirtyDialogOpen={isDirtyDialogOpen}
          setDirtyDialogOpen={setDirtyDialogOpen}
          pendingSelection={pendingSelection}
          setPendingSelection={setPendingSelection}
          pendingSplashVisible={pendingSplashVisible}
          setPendingSplashVisible={setPendingSplashVisible}
          loadClass={loadClass}
          setSplashVisible={setSplashVisible}
          isOpenFileDialogOpen={isOpenFileDialogOpen}
          setIsOpenFileDialogOpen={setIsOpenFileDialogOpen}
          openFileButtonRef={openFileButtonRef}
          loadingProgress={loadingProgress}
          loadingMessage={loadingMessage}
          isAddLibraryOpen={isAddLibraryOpen}
          setIsAddLibraryOpen={setIsAddLibraryOpen}
          setContextVersion={setContextVersion}
          isFlattenDialogOpen={isFlattenDialogOpen}
          setFlattenDialogOpen={setFlattenDialogOpen}
          flattenedCode={flattenedCode}
          isCloudModalOpen={isCloudModalOpen}
          setIsCloudModalOpen={setIsCloudModalOpen}
          experimentOverrides={experimentOverrides}
          content={content}
          onCloudResultLoaded={(data) => {
            setLocalSimulationData(data.series);
            setShowResultsView(true);
            setSimulationStatus({ status: "success", error: null });
            setIsCloudModalOpen(false);
          }}
        />

        {(props.embed || props.showParameterRibbon) && ribbonParams.length > 0 && (
          <ParameterSliderRibbon
            parameters={ribbonParams}
            overrides={parameterOverrides}
            onChange={handleRibbonParamChange}
            onReset={handleRibbonParamReset}
            onSimulate={handleSimulate}
            isSimulating={simulationStatus?.status === "pending" || simulationStatus?.status === "processing"}
            dark={colorMode === "dark"}
          />
        )}
      </div>
    </>
  );
}
