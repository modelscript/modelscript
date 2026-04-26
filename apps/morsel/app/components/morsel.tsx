// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ParameterInfo } from "@modelscript/simulator";
import { decodeDataUrl } from "@modelscript/utils";
import {
  ColumnsIcon,
  DownloadIcon,
  FileIcon,
  FlowchartIcon,
  GlobeIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  PulseIcon,
  RowsIcon,
  SearchIcon,
  ShareAndroidIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SponsorTiersIcon,
  StackIcon,
  SunIcon,
  UnwrapIcon,
  UploadIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  ActionList,
  ActionMenu,
  Button,
  Dialog,
  IconButton,
  SegmentedControl,
  Spinner,
  TextInput,
  useTheme,
} from "@primer/react";
import type { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTranslations, uiLanguages } from "~/util/i18n";
import {
  addComponent,
  addConnect,
  applyLspEdits,
  deleteComponents,
  didOpen,
  getDiagramData,
  removeConnect,
  simulate,
  updateComponentDescription,
  updateComponentName,
  updateComponentParameter,
  updateEdgePoints,
  updatePlacement,
} from "~/util/lsp-bridge";
import { startLsp } from "~/util/lsp-worker";
import type { CodeEditorHandle } from "./code";
import ComponentList from "./component-list";
import type { DiagramEditorHandle } from "./diagram";
import OpenFileDropzone from "./open-file-dropzone";
import PropertiesWidget from "./properties";
import { SimulationExperimentSettings, SimulationParameters, type ExperimentOverrides } from "./simulation-parameters";
import { Splash, type ModelData } from "./splash";
import TreeWidget from "./tree";
import { VariablesTree } from "./variables-tree";

import AddLibraryModal from "./add-library-modal";
import { type CadComponent } from "./cad-viewer";
const CodeEditor = React.lazy(() => import("./code"));
const DiagramEditor = React.lazy(() => import("./diagram"));
const SimulationResults = React.lazy(() =>
  import("./simulation-results").then((m) => ({ default: m.SimulationResults })),
);
const CadViewerPanel = React.lazy(() => import("./cad-viewer").then((m) => ({ default: m.CadViewer })));

/** URI used for the open document — must match the URI in CodeEditor and TreeWidget. */
const DOCUMENT_URI = "file:///document.mo";

const EXAMPLE_PATHS = [
  {
    id: "cauer-low-pass",
    name: "CauerLowPassAnalog",
    path: "Electrical/Analog/Examples/CauerLowPassAnalog.mo",
  },
  { id: "chua-circuit", name: "ChuaCircuit", path: "Electrical/Analog/Examples/ChuaCircuit.mo" },
  {
    id: "mos-inverter",
    name: "HeatingMOSInverter",
    path: "Electrical/Analog/Examples/HeatingMOSInverter.mo",
  },
  {
    id: "thyristor-test",
    name: "ThyristorBehaviourTest",
    path: "Electrical/Analog/Examples/ThyristorBehaviourTest.mo",
  },
  {
    id: "opamp-amplifier",
    name: "AmplifierWithOpAmpDetailed",
    path: "Electrical/Analog/Examples/AmplifierWithOpAmpDetailed.mo",
  },
  { id: "pump-dropout", name: "PumpDropOut", path: "Thermal/FluidHeatFlow/Examples/PumpDropOut.mo" },
  { id: "two-mass", name: "TwoMass", path: "Thermal/FluidHeatFlow/Examples/TwoMass.mo" },
  { id: "open-tank", name: "TestOpenTank", path: "Thermal/FluidHeatFlow/Examples/TestOpenTank.mo" },
  { id: "one-mass", name: "OneMass", path: "Thermal/FluidHeatFlow/Examples/OneMass.mo" },
  {
    id: "parallel-cooling",
    name: "ParallelCooling",
    path: "Thermal/FluidHeatFlow/Examples/ParallelCooling.mo",
  },
];

const LANGUAGE_NAMES: Record<string, string> = {
  ar: "العربية (Arabic)",
  de: "Deutsch (German)",
  en: "English",
  fr: "Français (French)",
  it: "Italiano (Italian)",
  ja: "日本語 (Japanese)",
  ko: "한국어 (Korean)",
  pt: "Português (Portuguese)",
  ru: "Русский (Russian)",
  tr: "Türkçe (Turkish)",
  zh: "中文 (Chinese)",
};

interface MorselEditorProps {
  dataUrl: DataUrl | null;
  embed: boolean;
}

enum View {
  CODE,
  DIAGRAM,
  SPLIT_COLUMNS,
  SPLIT_ROWS,
}

const isSplit = (v: View) => v === View.SPLIT_COLUMNS || v === View.SPLIT_ROWS;

export default function MorselEditor(props: MorselEditorProps) {
  const [isShareDialogOpen, setShareDialogOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const [isAddLibraryOpen, setIsAddLibraryOpen] = useState(false);
  const addLibraryButtonRef = useRef<HTMLButtonElement>(null);
  const [isOpenFileDialogOpen, setIsOpenFileDialogOpen] = useState(false);
  const openFileButtonRef = useRef<HTMLButtonElement>(null);
  const [isFlattenDialogOpen, setFlattenDialogOpen] = useState(false);
  const [flattenedCode, setFlattenedCode] = useState("");
  const [simulationStatus, setSimulationStatus] = useState<any>(null);
  const [cosimDataSource, setCosimDataSource] = useState<"local" | "mqtt-live" | "historian-replay">("local");
  const [localSimulationData, setLocalSimulationData] = useState<Record<string, number | string>[] | null>(null);
  const simulateAbortControllerRef = useRef<AbortController | null>(null);
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const [decodedContent] = decodeDataUrl(props.dataUrl ?? null);
  const content = decodedContent || "model Example\n\nend Example;";
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);
  const [view, setView] = useState<View>(View.SPLIT_COLUMNS);
  const [showResultsView, setShowResultsView] = useState(false);
  const [showCadView, setShowCadView] = useState(false);
  const [simulationVariables, setSimulationVariables] = useState<string[]>([]);
  const [selectedSimulationVariables, setSelectedSimulationVariables] = useState<string[]>([]);
  const [simulationParameters, setSimulationParameters] = useState<ParameterInfo[]>([]);
  const [parameterOverrides, setParameterOverrides] = useState<Map<string, number>>(new Map());
  const cachedSimulatorRef = useRef<any | null>(null);
  const [lastLoadedContent, setLastLoadedContent] = useState<string>("");

  const [experimentOverrides, setExperimentOverrides] = useState<ExperimentOverrides>({});
  const [isDirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [diagramData, setDiagramData] = useState<any>(null);
  const [selectedTreeClassName, setSelectedTreeClassName] = useState<string | null>(null);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const isDiagramUpdate = useRef(false);
  const diagramEditorRef = useRef<DiagramEditorHandle>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  const [isDiagramLoading, setIsDiagramLoading] = useState(false);
  const [treeVisible, setTreeVisible] = useState(true);
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [splitRatio, setSplitRatio] = useState(0.5);

  const cadComponents = useMemo<CadComponent[]>(() => {
    return [];
  }, [diagramData]);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplit = useRef(false);
  const [treeWidth, setTreeWidth] = useState(300);
  const isDraggingTree = useRef(false);
  const [propertiesWidth, setPropertiesWidth] = useState(300);
  const isDraggingProperties = useRef(false);
  const { colorMode, resolvedColorMode, setColorMode } = useTheme();
  const [libraryFilter, setLibraryFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [contextVersion, setContextVersion] = useState(0);
  const expectedComponentNameRef = useRef<string | null>(null);
  const pendingModelNameRef = useRef<string | null>(null);
  const [isSplashVisible, setSplashVisible] = useState(false);
  const [pendingSplashVisible, setPendingSplashVisible] = useState(false);
  const [recentModels, setRecentModels] = useState<ModelData[]>([]);
  const [exampleModels, setExampleModels] = useState<ModelData[]>([]);
  const isInitialized = useRef(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const translations = useMemo(() => getTranslations(language), [language]);

  // Collect all displayable models/blocks from root-level class instances
  // Supports multiple root-level models as well as nested models within a single root package
  const nestedModels = useMemo(() => {
    return [];
  }, []);

  useEffect(() => {
    if (!props.embed) {
      if (treeVisible) {
        document.body.classList.add("tree-visible");
      } else {
        document.body.classList.remove("tree-visible");
      }
    }
  }, [treeVisible, props.embed]);

  // Lightweight re-simulate when parameter overrides change
  useEffect(() => {
    if (!showResultsView || parameterOverrides.size === 0 || !selectedTreeClassName) return;

    const timer = setTimeout(async () => {
      try {
        const overrideObj = Object.fromEntries(parameterOverrides);
        const result = await simulate(DOCUMENT_URI, {
          className: selectedTreeClassName,
          parameterOverrides: overrideObj,
          startTime: experimentOverrides.startTime,
          stopTime: experimentOverrides.stopTime,
          interval: experimentOverrides.interval,
        });

        if (result.error) throw new Error(result.error);

        const states = result.states ?? [];
        const chartData = result.t.map((t: number, i: number) => {
          const row: Record<string, number | string> = { time: t };
          states.forEach((state: string, vIndex: number) => {
            row[state] = result.y[i]?.[vIndex] ?? 0;
          });
          return row;
        });

        setLocalSimulationData(chartData);
      } catch (e) {
        if ((e as Error).name === "AbortError" || (e as Error).message === "Simulation aborted") return;
        console.error("Re-simulation failed:", e);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [parameterOverrides, showResultsView, experimentOverrides, selectedTreeClassName]);

  useEffect(() => {
    const saved = localStorage.getItem("recentModels");
    if (saved) {
      try {
        setRecentModels(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse recent models", e);
      }
    }
  }, []);

  const saveRecentModel = useCallback((name: string, content: string) => {
    if (!name || name === "NewModel" || name === "Example") return;
    setRecentModels((prev: ModelData[]) => {
      const id = name.toLowerCase().replace(/\s+/g, "-");
      const model: ModelData = { id, name, content, lastModified: Date.now() };
      const next = [model, ...prev.filter((m: ModelData) => m.name !== name)].slice(0, 10);
      localStorage.setItem("recentModels", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleModelSelect = (model: ModelData) => {
    setSplashVisible(false);
    setLastLoadedContent(model.content);
    if (editor) {
      editor.setValue(model.content);
    }
  };

  const handleClearRecent = useCallback(() => {
    setRecentModels([]);
    localStorage.removeItem("recentModels");
  }, []);

  const handleVariablesLoaded = useCallback(
    (vars: string[]) => {
      setSimulationVariables(vars);

      if (selectedSimulationVariables.length === 0 && vars.length > 0) {
        // Don't auto-select any variables — let the user pick
      }
    },
    [selectedSimulationVariables.length],
  );

  useEffect(() => {
    const init = async () => {
      if (isInitialized.current) return;
      isInitialized.current = true;

      setLoadingProgress(10);
      setLoadingMessage("Starting language server…");

      try {
        const conn = await startLsp();
        conn.onNotification("modelscript/projectTreeChanged", () => {
          setContextVersion((v) => v + 1);
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

      setExampleModels([]); // Examples could be loaded via LSP, but for now we clear them to avoid fs errors

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
      setTreeVisible(false);
      setView((prev) => (isSplit(prev) ? View.DIAGRAM : prev));
    } else {
      setTreeVisible(true);
    }
  }, [isNarrow]);

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

  const loadClass = (className: string, kind?: string) => {
    // Store the name so the diagram tab auto-selects if it's a model/block
    if (kind === "model" || kind === "block") {
      pendingModelNameRef.current = className;
    } else {
      pendingModelNameRef.current = null;
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
      diagramEditorRef.current?.showLoading();
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
    setColorMode(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
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

  // ── Diagram edit helpers (delegated to LSP server via lsp-bridge) ──

  const handleEdgeDelete = async (source: string, target: string) => {
    if (!editor) return;
    isDiagramUpdate.current = true;
    const edits = await removeConnect(DOCUMENT_URI, source, target);
    applyLspEdits(editor, edits, "delete-connect");
  };

  const handleComponentDelete = async (name: string) => {
    if (!editor) return;
    isDiagramUpdate.current = true;
    const edits = await deleteComponents(DOCUMENT_URI, [name]);
    applyLspEdits(editor, edits, "delete-component");
    codeEditorRef.current?.sync();
  };

  const handleComponentsDelete = async (names: string[]) => {
    if (!editor) return;
    isDiagramUpdate.current = true;
    const edits = await deleteComponents(DOCUMENT_URI, names);
    applyLspEdits(editor, edits, "delete-component");
    codeEditorRef.current?.sync();
  };

  const handleFlatten = async () => {
    if (!selectedTreeClassName) return;
    try {
      const result = await (await import("~/util/lsp-bridge")).flatten(selectedTreeClassName);
      if (result.text) {
        setFlattenedCode(result.text);
        setFlattenDialogOpen(true);
      } else if (result.error) {
        alert("Failed to flatten model: " + result.error);
      }
    } catch (e) {
      console.error("Flattening failed:", e);
      alert("Failed to flatten model: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleSimulate = async () => {
    setSimulationStatus({ status: "pending", error: null });
    setLocalSimulationData(null);

    try {
      // Prepare parameters mapping
      const overrideObj = Object.fromEntries(parameterOverrides);

      // Call the LSP — if no class is selected in the tree, the LSP
      // will use the first class instance from the document.
      const result = await simulate(DOCUMENT_URI, {
        className: selectedTreeClassName ?? undefined,
        parameterOverrides: overrideObj,
        startTime: experimentOverrides.startTime,
        stopTime: experimentOverrides.stopTime,
        interval: experimentOverrides.interval,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setSimulationParameters((result.parameters as any) ?? []);

      const states = result.states ?? [];
      setSimulationVariables(states);

      const chartData = result.t.map((t: number, i: number) => {
        const row: Record<string, number | string> = { time: t };
        states.forEach((state: string, vIndex: number) => {
          row[state] = result.y[i]?.[vIndex] ?? 0;
        });
        return row;
      });

      setLocalSimulationData(chartData);
      setSimulationStatus({ status: "completed" });
      setShowResultsView(true);
    } catch (e: any) {
      if (e.message === "Simulation aborted") {
        return;
      }
      setSimulationStatus({ status: "failed", error: e instanceof Error ? e.message : String(e) });
      setShowResultsView(true);
    }
  };

  return (
    <>
      <title>{"Morsel"}</title>
      <div className="d-flex flex-column" style={{ height: "100vh", overflow: "hidden" }}>
        <div className="d-flex flex-1" style={{ minHeight: 0 }}>
          {treeVisible && (
            <>
              <div
                style={{
                  width: treeWidth,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  minWidth: 200,
                  maxWidth: 600,
                }}
              >
                {!showResultsView && (
                  <>
                    <div
                      className="text-bold px-3 py-2 border-bottom bg-canvas-subtle d-flex flex-items-center flex-justify-between"
                      style={{ gap: 8 }}
                    >
                      <div
                        className="d-flex flex-items-center"
                        style={{ display: isSearchExpanded || libraryFilter ? "none" : "flex" }}
                      >
                        {translations.libraries}
                      </div>
                      <div className="d-flex flex-items-center flex-1 flex-justify-end" style={{ minWidth: 0 }}>
                        <TextInput
                          ref={inputRef}
                          aria-label={translations.filterClasses}
                          placeholder={translations.filterClasses}
                          value={libraryFilter}
                          onChange={(e) => setLibraryFilter(e.target.value)}
                          onBlur={() => {
                            if (!libraryFilter) setIsSearchExpanded(false);
                          }}
                          trailingAction={
                            !isSearching && (isSearchExpanded || libraryFilter) ? (
                              <TextInput.Action
                                onClick={() => {
                                  if (libraryFilter) {
                                    setLibraryFilter("");
                                    inputRef.current?.focus();
                                  } else {
                                    setIsSearchExpanded(false);
                                  }
                                }}
                                icon={libraryFilter ? XIcon : SearchIcon}
                                aria-label={libraryFilter ? "Clear search" : "Close search"}
                              />
                            ) : undefined
                          }
                          trailingVisual={
                            isSearching && (isSearchExpanded || libraryFilter) ? (
                              <Spinner size="small" style={{ marginTop: "6px", marginInlineStart: "8px" }} />
                            ) : undefined
                          }
                          className={isSearchExpanded || libraryFilter ? "input-sm" : "input-sm border-0"}
                          style={{
                            width: isSearchExpanded || libraryFilter ? "100%" : "0px",
                            opacity: isSearchExpanded || libraryFilter ? 1 : 0,
                            padding: isSearchExpanded || libraryFilter ? undefined : "0px",
                            borderWidth: isSearchExpanded || libraryFilter ? undefined : "0px",
                            height: "28px",
                            transition: "all 0.2s ease-in-out",
                            overflow: "hidden",
                          }}
                        />
                        <IconButton
                          icon={SearchIcon}
                          aria-label={translations.filterClasses}
                          size="small"
                          variant="invisible"
                          onClick={() => {
                            setIsSearchExpanded(true);
                            setTimeout(() => inputRef.current?.focus(), 50);
                          }}
                          style={{
                            width: isSearchExpanded || libraryFilter ? "0px" : "28px",
                            opacity: isSearchExpanded || libraryFilter ? 0 : 1,
                            padding: isSearchExpanded || libraryFilter ? "0px" : undefined,
                            overflow: "hidden",
                            transition: "all 0.2s ease-in-out",
                          }}
                        />
                        <IconButton
                          icon={PlusIcon}
                          aria-label={translations.addLibrary}
                          size="small"
                          variant="invisible"
                          ref={addLibraryButtonRef}
                          onClick={() => setIsAddLibraryOpen(true)}
                        />
                      </div>
                    </div>
                    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                      <TreeWidget
                        uri={DOCUMENT_URI}
                        key={debouncedFilter ? "filtered" : "unfiltered"}
                        onSelect={handleTreeSelect}
                        onHighlight={setSelectedTreeClassName}
                        width="100%"
                        filter={debouncedFilter}
                        version={contextVersion}
                        language={language}
                      />
                    </div>
                  </>
                )}
                <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">
                  {showResultsView ? "Simulation Variables" : translations.components}
                </div>
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  {!showResultsView ? (
                    <ComponentList
                      components={diagramData?.nodes ?? null}
                      onSelect={(name) => {
                        setSelectedComponent(name || null);
                        if (name) {
                          codeEditorRef.current?.revealComponent(name);
                        }
                      }}
                      selectedName={selectedComponent}
                      language={language}
                      translations={translations}
                    />
                  ) : (
                    <VariablesTree
                      variables={simulationVariables}
                      selectedVariables={selectedSimulationVariables}
                      onToggleVariable={(v) => {
                        setSelectedSimulationVariables((current) =>
                          current.includes(v) ? current.filter((x) => x !== v) : [...current, v],
                        );
                      }}
                    />
                  )}
                </div>
                {showResultsView && simulationParameters.length > 0 && (
                  <>
                    <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">
                      Simulation Parameters
                    </div>
                    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                      <SimulationParameters
                        parameters={simulationParameters}
                        overrides={parameterOverrides}
                        onChange={(name, value) => {
                          setParameterOverrides((prev) => {
                            const next = new Map(prev);
                            next.set(name, value);
                            return next;
                          });
                        }}
                        onReset={(name) => {
                          setParameterOverrides((prev) => {
                            const next = new Map(prev);
                            next.delete(name);
                            return next;
                          });
                        }}
                      />
                    </div>
                  </>
                )}
                {showResultsView && (
                  <>
                    <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">
                      Simulation Settings
                    </div>
                    <div style={{ padding: "0" }}>
                      <SimulationExperimentSettings
                        experiment={cachedSimulatorRef.current?.dae?.experiment}
                        overrides={experimentOverrides}
                        onChange={(name, value) => setExperimentOverrides((prev) => ({ ...prev, [name]: value }))}
                        onReset={(name) => {
                          setExperimentOverrides((prev) => {
                            const next = { ...prev };
                            delete next[name];
                            return next;
                          });
                        }}
                      />
                      <div className="p-3">
                        <Button
                          variant="primary"
                          block
                          onClick={() => handleSimulate()}
                          disabled={simulationStatus?.status === "pending" || simulationStatus?.status === "processing"}
                        >
                          Simulate
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div
                style={{
                  width: 6,
                  cursor: "col-resize",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  backgroundColor: "transparent",
                  display: "flex",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isDraggingTree.current = true;
                  const startX = e.clientX;
                  const startWidth = treeWidth;

                  const onMouseMove = (e: MouseEvent) => {
                    if (!isDraggingTree.current) return;
                    const deltaX = e.clientX - startX;
                    const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
                    setTreeWidth(newWidth);
                  };

                  const onMouseUp = () => {
                    isDraggingTree.current = false;
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
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    colorMode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              />
              <div className="border-left" />
            </>
          )}
          <div
            className={`d-flex flex-1 ${view === View.SPLIT_ROWS ? "flex-column" : ""}`}
            ref={splitContainerRef}
            style={{ minHeight: 0, overflow: "hidden", position: "relative" }}
          >
            {(view === View.DIAGRAM || isSplit(view)) && (
              <div
                style={{
                  display: "flex",
                  flex: isSplit(view) ? "none" : 1,
                  width: isSplit(view) && view === View.SPLIT_COLUMNS ? `${splitRatio * 100}%` : undefined,
                  height: isSplit(view) && view === View.SPLIT_ROWS ? `${splitRatio * 100}%` : undefined,
                  flexDirection: "column",
                  minWidth: 0,
                  minHeight: 0,
                  position: "relative",
                  backgroundColor: "var(--color-canvas-default)",
                }}
              >
                {nestedModels.length > 1 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      gap: 0,
                      padding: "0 0",
                      overflowX: "auto",
                      flexShrink: 0,
                      borderBottom:
                        colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(0, 0, 0, 0.08)",
                      backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.6)" : "rgba(246, 248, 250, 0.8)",
                    }}
                  >
                    {nestedModels.map((model, index) => (
                      <button
                        key={(model as any).compositeName ?? index}
                        onClick={() => {
                          setSelectedModelIndex(index);
                          (model as any).instantiate?.();
                          setDiagramData(model as any);
                        }}
                        style={{
                          padding: "6px 16px",
                          fontSize: 13,
                          fontWeight: selectedModelIndex === index ? 600 : 400,
                          border: "none",
                          borderBottom:
                            selectedModelIndex === index
                              ? colorMode === "dark"
                                ? "2px solid #58a6ff"
                                : "2px solid #0969da"
                              : "2px solid transparent",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          backgroundColor: "transparent",
                          color:
                            selectedModelIndex === index
                              ? colorMode === "dark"
                                ? "#e6edf3"
                                : "#1f2328"
                              : colorMode === "dark"
                                ? "#8b949e"
                                : "#656d76",
                          transition: "all 0.15s ease",
                          display: "inline-grid",
                          justifyItems: "center",
                        }}
                        onMouseEnter={(e) => {
                          if (selectedModelIndex !== index) {
                            (e.currentTarget as HTMLElement).style.backgroundColor =
                              colorMode === "dark" ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedModelIndex !== index) {
                            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                          }
                        }}
                      >
                        {/* Hidden bold text to reserve the bold width and prevent layout shift */}
                        <span style={{ gridArea: "1 / 1", visibility: "hidden", fontWeight: 600 }} aria-hidden="true">
                          {(model as any).name ?? `Model ${index + 1}`}
                        </span>
                        <span style={{ gridArea: "1 / 1" }}>{(model as any).name ?? `Model ${index + 1}`}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div
                  style={{
                    position: "absolute",
                    top: nestedModels.length > 1 ? "48px" : "16px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    borderRadius: 12,
                    backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.9)" : "rgba(255, 255, 255, 0.9)",
                    backdropFilter: "blur(12px)",
                    boxShadow:
                      colorMode === "dark"
                        ? "0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)"
                        : "0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06)",
                    zIndex: 100,
                  }}
                >
                  <SegmentedControl
                    aria-label="Center Pane View"
                    onChange={(i) => {
                      setShowResultsView(i === 1);
                      setShowCadView(false);
                    }}
                  >
                    <SegmentedControl.Button selected={!showResultsView && !showCadView} leadingVisual={WorkflowIcon}>
                      {translations.diagram}
                    </SegmentedControl.Button>
                    <SegmentedControl.Button selected={showResultsView} leadingVisual={PulseIcon}>
                      {translations.simulation}
                    </SegmentedControl.Button>
                  </SegmentedControl>
                </div>
                <div style={{ position: "relative", flex: 1, flexDirection: "row", overflow: "hidden" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "row",
                      visibility: !showResultsView && !showCadView ? "visible" : "hidden",
                      opacity: !showResultsView && !showCadView ? 1 : 0,
                      pointerEvents: !showResultsView && !showCadView ? "auto" : "none",
                      zIndex: !showResultsView && !showCadView ? 1 : 0,
                    }}
                  >
                    <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                      <Suspense fallback={null}>
                        <DiagramEditor
                          ref={diagramEditorRef}
                          diagramData={diagramData}
                          diagramClassName={selectedTreeClassName}
                          selectedName={selectedComponent}
                          theme={colorMode === "dark" ? "vs-dark" : "light"}
                          isLoading={isDiagramLoading}
                          onRenderComplete={(data) => {
                            if (!data?.isLoading) {
                              setIsDiagramLoading(false);
                            }
                          }}
                          onSelect={(name) => {
                            setSelectedComponent(name);
                          }}
                          onDrop={async (className, x, y) => {
                            if (!editor) return;
                            isDiagramUpdate.current = true;
                            const edits = await addComponent(DOCUMENT_URI, className, x, y);
                            applyLspEdits(editor, edits, "dnd");
                            codeEditorRef.current?.sync();
                          }}
                          onConnect={async (source, target, points) => {
                            if (!editor) return;
                            isDiagramUpdate.current = true;
                            const edits = await addConnect(DOCUMENT_URI, source, target, points);
                            applyLspEdits(editor, edits, "connect");
                          }}
                          onMove={async (items) => {
                            if (!editor) return;
                            isDiagramUpdate.current = true;
                            const placementItems = items.map((item) => ({
                              name: item.name,
                              x: item.x,
                              y: item.y,
                              width: item.width,
                              height: item.height,
                              rotation: item.rotation,
                              edges: item.edges,
                            }));
                            const edits = await updatePlacement(DOCUMENT_URI, placementItems);
                            applyLspEdits(editor, edits, "move");
                          }}
                          onResize={async (name, x, y, width, height, rotation, edges) => {
                            if (!editor) return;
                            isDiagramUpdate.current = true;
                            const placementItems = [
                              {
                                name,
                                x,
                                y,
                                width,
                                height,
                                rotation,
                                edges,
                              },
                            ];
                            const edits = await updatePlacement(DOCUMENT_URI, placementItems);
                            applyLspEdits(editor, edits, "resize");
                          }}
                          onEdgeMove={async (edges) => {
                            if (!editor) return;
                            isDiagramUpdate.current = true;
                            const edits = await updateEdgePoints(DOCUMENT_URI, edges);
                            applyLspEdits(editor, edits, "edge-move");
                          }}
                          onEdgeDelete={handleEdgeDelete}
                          onComponentDelete={handleComponentDelete}
                          onComponentsDelete={handleComponentsDelete}
                          onUndo={() => {
                            isDiagramUpdate.current = true;
                            editorRef.current?.focus();
                            const prev = editorRef.current?.getValue();
                            editorRef.current?.trigger("diagram", "undo", null);
                            if (prev !== editorRef.current?.getValue()) {
                              diagramEditorRef.current?.showLoading();
                            }
                          }}
                          onRedo={() => {
                            isDiagramUpdate.current = true;
                            editorRef.current?.focus();
                            const prev = editorRef.current?.getValue();
                            editorRef.current?.trigger("diagram", "redo", null);
                            if (prev !== editorRef.current?.getValue()) {
                              diagramEditorRef.current?.showLoading();
                            }
                          }}
                        />
                      </Suspense>
                    </div>
                    {selectedComponent && (
                      <>
                        <div
                          style={{
                            width: 6,
                            cursor: "col-resize",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            backgroundColor: "transparent",
                            borderLeft: `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}`,
                            transition: "background-color 0.15s",
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            isDraggingProperties.current = true;
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
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.backgroundColor =
                              colorMode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                          }}
                        />
                        <PropertiesWidget
                          key={selectedComponent || "none"}
                          properties={
                            diagramData?.nodes?.find((n: any) => n.id === selectedComponent)?.properties ?? null
                          }
                          width={propertiesWidth}
                          translations={translations}
                          onNameChange={async (newName) => {
                            if (!selectedComponent || !editor) return;
                            expectedComponentNameRef.current = newName;
                            isDiagramUpdate.current = true;
                            const edits = await updateComponentName(DOCUMENT_URI, selectedComponent, newName);
                            applyLspEdits(editor, edits, "name-change");
                          }}
                          onDescriptionChange={async (newDescription) => {
                            if (!selectedComponent || !editor) return;
                            isDiagramUpdate.current = true;
                            const edits = await updateComponentDescription(
                              DOCUMENT_URI,
                              selectedComponent,
                              newDescription,
                            );
                            applyLspEdits(editor, edits, "description-change");
                          }}
                          onParameterChange={async (name, value) => {
                            if (!selectedComponent || !editor) return;
                            // If the new value matches the parameter's default (from the
                            // declared type), remove the modifier entirely instead of
                            // keeping a redundant explicit override.
                            let effectiveValue = value;
                            const declaredType = (selectedComponent as any)?.declaredType; // TODO properly type when properties panel is typed
                            if (declaredType) {
                              for (const el of declaredType.elements) {
                                if (el && (el as any).name === name) {
                                  const defaultExpr = (el.modification?.expression as any)?.toJSON?.toString();
                                  if (defaultExpr !== undefined && defaultExpr === value) {
                                    effectiveValue = "";
                                  }
                                  break;
                                }
                              }
                            }
                            isDiagramUpdate.current = true;
                            const edits = await updateComponentParameter(
                              DOCUMENT_URI,
                              selectedComponent,
                              name,
                              effectiveValue,
                            );
                            applyLspEdits(editor, edits, "parameter-change");
                            codeEditorRef.current?.sync();
                          }}
                        />
                      </>
                    )}
                  </div>

                  {/* 3D CAD Viewer pane */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: showCadView ? "flex" : "none",
                      flexDirection: "column",
                      overflow: "hidden",
                      minHeight: 0,
                      zIndex: showCadView ? 2 : 0,
                      backgroundColor: "var(--color-canvas-default)",
                    }}
                  >
                    <Suspense fallback={null}>
                      <CadViewerPanel
                        components={cadComponents}
                        selectedName={selectedComponent}
                        onSelect={(name) => {
                          if (!name) {
                            setSelectedComponent(null);
                          } else {
                            const searchInstance = (diagramData ?? null) as any;
                            const component = searchInstance?.components
                              ? Array.from(searchInstance.components).find((c: any) => c.name === name)
                              : null;
                            setSelectedComponent(name || null);
                          }
                        }}
                        dark={colorMode === "dark"}
                      />
                    </Suspense>
                  </div>

                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: showResultsView ? "flex" : "none",
                      flexDirection: "column",
                      overflow: "hidden",
                      minHeight: 0,
                      zIndex: showResultsView ? 2 : 0,
                      backgroundColor: "var(--color-canvas-default)",
                    }}
                  >
                    {localSimulationData || simulationStatus?.status === "failed" ? (
                      <Suspense fallback={null}>
                        <SimulationResults
                          localData={localSimulationData}
                          selectedVariables={selectedSimulationVariables}
                          onVariablesLoaded={handleVariablesLoaded}
                          error={simulationStatus?.status === "failed" ? simulationStatus.error : null}
                          colorMode={colorMode === "dark" ? "dark" : "light"}
                        />
                      </Suspense>
                    ) : (
                      <div
                        style={{
                          padding: "32px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: "100%",
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        {simulationStatus?.status === "pending" || simulationStatus?.status === "processing" ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                            <Spinner size="large" />
                            <div>Simulation in progress... please wait.</div>
                          </div>
                        ) : (
                          "No simulation results available. Click 'Simulate' to generate results."
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Draggable split divider */}
            <div
              style={{
                display: isSplit(view) ? "flex" : "none",
                width: view === View.SPLIT_COLUMNS ? 6 : "100%",
                height: view === View.SPLIT_ROWS ? 6 : "100%",
                cursor: view === View.SPLIT_COLUMNS ? "col-resize" : "row-resize",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                backgroundColor: "transparent",
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
            <div
              style={{
                display: view === View.CODE || isSplit(view) ? "flex" : "none",
                flex: isSplit(view) ? "none" : 1,
                width: isSplit(view) && view === View.SPLIT_COLUMNS ? `${(1 - splitRatio) * 100}%` : undefined,
                height: isSplit(view) && view === View.SPLIT_ROWS ? `${(1 - splitRatio) * 100}%` : undefined,
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <Suspense fallback={null}>
                <CodeEditor
                  uri={DOCUMENT_URI}
                  ref={codeEditorRef}
                  embed={props.embed}
                  setEditor={setEditor}
                  content={content}
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
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderRadius: 12,
            backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.9)" : "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(12px)",
            boxShadow:
              colorMode === "dark"
                ? "0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)"
                : "0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06)",
            zIndex: 1000,
          }}
        >
          <a
            href="https://github.com/modelscript/modelscript"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center" }}
          >
            <img src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"} alt="Morsel" style={{ height: 20 }} />
          </a>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
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
                    backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                    borderRadius: 6,
                  }
                : {}
            }
          />
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={FileIcon}
            size="small"
            variant="invisible"
            aria-label={translations.newModel}
            title={translations.newModel}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (editorRef.current?.getValue() !== lastLoadedContentRef.current) {
                setPendingSplashVisible(true);
                setDirtyDialogOpen(true);
              } else {
                setSplashVisible(true);
              }
            }}
          />
          <IconButton
            icon={UploadIcon}
            size="small"
            variant="invisible"
            aria-label={translations.openModel}
            title={translations.openModel}
            ref={openFileButtonRef}
            onClick={() => setIsOpenFileDialogOpen(true)}
          />
          <IconButton
            icon={DownloadIcon}
            size="small"
            variant="invisible"
            aria-label={translations.saveModel}
            title={translations.saveModel}
            onClick={async () => {
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
          />
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={FlowchartIcon}
            size="small"
            variant="invisible"
            aria-label={translations.autoLayout}
            title={translations.autoLayout}
            onClick={() => {
              if (confirm(translations.autoLayoutConfirm)) {
                diagramEditorRef.current?.layout();
              }
            }}
          />
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
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
            <IconButton
              icon={WorkflowIcon}
              size="small"
              variant="invisible"
              aria-label={translations.diagramView}
              title={translations.diagramView}
              onClick={() => setView(View.DIAGRAM)}
              style={
                view === View.DIAGRAM
                  ? {
                      backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                      borderRadius: 6,
                    }
                  : {}
              }
            />
            {!isNarrow && (
              <>
                <IconButton
                  icon={ColumnsIcon}
                  size="small"
                  variant="invisible"
                  aria-label={translations.splitViewColumns}
                  title={translations.splitViewColumns}
                  onClick={() => setView(View.SPLIT_COLUMNS)}
                  style={
                    view === View.SPLIT_COLUMNS
                      ? {
                          backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                          borderRadius: 6,
                        }
                      : {}
                  }
                />
                <IconButton
                  icon={RowsIcon}
                  size="small"
                  variant="invisible"
                  aria-label={translations.splitViewRows}
                  title={translations.splitViewRows}
                  onClick={() => setView(View.SPLIT_ROWS)}
                  style={
                    view === View.SPLIT_ROWS
                      ? {
                          backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                          borderRadius: 6,
                        }
                      : {}
                  }
                />
              </>
            )}
            <IconButton
              icon={UnwrapIcon}
              size="small"
              variant="invisible"
              aria-label={translations.codeView}
              title={translations.codeView}
              onClick={() => setView(View.CODE)}
              style={
                view === View.CODE
                  ? {
                      backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                      borderRadius: 6,
                    }
                  : {}
              }
            />
          </div>
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={PlayIcon}
            size="small"
            variant="invisible"
            aria-label={translations.simulateModel}
            title={translations.simulateModel}
            onClick={() => handleSimulate()}
          />
          <IconButton
            icon={StackIcon}
            size="small"
            variant="invisible"
            aria-label={translations.flattenModel}
            title={translations.flattenModel}
            onClick={handleFlatten}
          />
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={ShareAndroidIcon}
            size="small"
            variant="invisible"
            aria-label={translations.shareModel}
            ref={shareButtonRef}
            onClick={() => setShareDialogOpen(!isShareDialogOpen)}
          />
          <IconButton
            icon={SponsorTiersIcon}
            size="small"
            variant="invisible"
            aria-label={translations.sponsorMe}
            title={translations.sponsorMe}
            onClick={() => window.open("https://github.com/sponsors/nachawati", "_blank")}
          />
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          {availableLanguages.length > 0 && (
            <>
              <ActionMenu>
                <ActionMenu.Anchor>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <IconButton
                      icon={GlobeIcon}
                      size="small"
                      variant="invisible"
                      aria-label={translations.language}
                      title={
                        language
                          ? `${translations.language}: ${LANGUAGE_NAMES[language] || language}`
                          : `${translations.language}: ${translations.default}`
                      }
                    />
                    {language && (
                      <span style={{ fontSize: 10, color: "#8b949e", fontWeight: 600, letterSpacing: 0.5 }}>
                        {language.toUpperCase()}
                      </span>
                    )}
                  </div>
                </ActionMenu.Anchor>
                <ActionMenu.Overlay>
                  <ActionList selectionVariant="single">
                    <ActionList.Item
                      selected={language === null}
                      onSelect={() => {
                        (null as any) /* context */
                          ?.setLanguage(null);
                        setLanguage(null);
                        setContextVersion((v) => v + 1);
                      }}
                    >
                      {translations.default}
                    </ActionList.Item>
                    {availableLanguages.map((lang) => (
                      <ActionList.Item
                        key={lang}
                        selected={language === lang}
                        onSelect={() => {
                          (null as any) /* context */
                            ?.setLanguage(lang);
                          setLanguage(lang);
                          setContextVersion((v) => v + 1);
                        }}
                      >
                        {LANGUAGE_NAMES[lang] || lang}
                      </ActionList.Item>
                    ))}
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
              <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
            </>
          )}
          <IconButton
            icon={colorMode === "dark" ? SunIcon : MoonIcon}
            size="small"
            variant="invisible"
            aria-label={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}
            onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
          />
        </div>
        {isShareDialogOpen && (
          <Dialog
            title={translations.shareModelTitle}
            onClose={() => setShareDialogOpen(false)}
            returnFocusRef={shareButtonRef}
            footerButtons={[
              {
                buttonType: "normal",
                content: translations.copyToClipboard,
                onClick: async () => {
                  await navigator.clipboard.writeText(
                    `${window.location.protocol}//${window.location.host}/#modelica=${encodeURIComponent(editor?.getValue() ?? "")}`,
                  );
                  alert(translations.copiedToClipboard);
                  setShareDialogOpen(false);
                },
              },
            ]}
          >
            <div
              style={{ wordBreak: "break-all" }}
            >{`${window.location.protocol}//${window.location.host}/#modelica=${encodeURIComponent(editor?.getValue() ?? "")}`}</div>
          </Dialog>
        )}
        {isDirtyDialogOpen && (
          <Dialog
            title={translations.unsavedChanges}
            onClose={() => setDirtyDialogOpen(false)}
            footerButtons={[
              {
                buttonType: "normal",
                content: translations.cancel,
                onClick: () => {
                  setDirtyDialogOpen(false);
                  setPendingSelection(null);
                  setPendingSplashVisible(false);
                },
              },
              {
                buttonType: "danger",
                content: translations.discardChanges,
                onClick: () => {
                  setDirtyDialogOpen(false);
                  if (pendingSelection) {
                    loadClass(pendingSelection);
                    setPendingSelection(null);
                  }
                  if (pendingSplashVisible) {
                    setSplashVisible(true);
                    setPendingSplashVisible(false);
                  }
                },
              },
            ]}
          >
            {translations.unsavedChangesMessage}
          </Dialog>
        )}
        {isOpenFileDialogOpen && (
          <Dialog
            title={translations.openFile}
            onClose={() => setIsOpenFileDialogOpen(false)}
            returnFocusRef={openFileButtonRef}
          >
            <OpenFileDropzone
              translations={translations}
              onFileContent={(content) => {
                editor?.setValue(content);
                setIsOpenFileDialogOpen(false);
              }}
              colorMode={colorMode || "light"}
            />
          </Dialog>
        )}
        {loadingProgress < 100 && (
          <div
            id="morsel-app-loader"
            style={{
              position: "fixed",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colorMode === "dark" ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.85)",
              zIndex: 9999,
              gap: 12,
            }}
          >
            <a href="https://github.com/modelscript/modelscript" target="_blank" rel="noopener noreferrer">
              <img
                src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
                alt="Morsel"
                style={{ marginBottom: 8 }}
              />
            </a>
            <div
              style={{
                width: 300,
                height: 6,
                borderRadius: 3,
                backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${loadingProgress}%`,
                  height: "100%",
                  borderRadius: 3,
                  backgroundColor: "#1f6feb",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <span style={{ fontSize: 13, color: colorMode === "dark" ? "#8b949e" : "#656d76" }}>{loadingMessage}</span>
          </div>
        )}
        {isAddLibraryOpen && (
          <AddLibraryModal
            isOpen={isAddLibraryOpen}
            onDismiss={() => setIsAddLibraryOpen(false)}
            translations={translations}
            onAddLibrary={async (item, type) => {
              // Library loading is now handled by LSP
              return;
              try {
                let path: string;
                let data: ArrayBuffer;
                if (type === "file" && (item as any) instanceof File) {
                  path = `/usr/${(item as File).name.replace(/\.zip$/i, "")}`;
                  data = await (item as File).arrayBuffer();
                } else if (type === "url") {
                  const url = item as string;
                  let response: Response | undefined;
                  const cache = await caches.open("modelscript-libraries");
                  response = await cache.match(url);

                  if (!response) {
                    try {
                      response = await fetch(url);
                      if (!response!.ok) {
                        throw new Error("Direct fetch failed");
                      }
                    } catch (e) {
                      try {
                        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                        response = await fetch(proxyUrl);
                      } catch (proxyError) {
                        throw new Error(
                          `Failed to fetch library from ${url}: ${proxyError instanceof Error ? (proxyError as Error).message : String(proxyError)}`,
                          { cause: proxyError },
                        );
                      }
                    }
                    if (!response || !(response as Response).ok) {
                      throw new Error(
                        `Failed to fetch library: ${response?.status} ${response?.statusText || "Unknown Error"}`,
                      );
                    }
                    await cache.put(url, response!.clone());
                  }
                  data = await response!.arrayBuffer();
                  const fileName = url.split("/").pop() || "library.zip";
                  path = `/usr/${fileName.replace(/\.zip$/i, "")}`;
                } else {
                  return;
                }
                // await mountLibrary(path, data);
                // Library filesystem access is handled by LSP
                setContextVersion((v) => v + 1);
              } catch (error) {
                console.error(error);
                alert("Failed to add library: " + ((error as any)?.message ?? String(error)));
              }
            }}
          />
        )}
        {isFlattenDialogOpen && (
          <Dialog
            title="Flattened Model"
            onClose={() => setFlattenDialogOpen(false)}
            width="xlarge"
            footerButtons={[
              {
                buttonType: "normal",
                content: "Copy to clipboard",
                onClick: async () => {
                  await navigator.clipboard.writeText(flattenedCode);
                  alert("Copied to clipboard.");
                },
              },
              {
                buttonType: "normal",
                content: "Close",
                onClick: () => setFlattenDialogOpen(false),
              },
            ]}
          >
            <div style={{ height: "60vh", border: "1px solid " + (colorMode === "dark" ? "#30363d" : "#d0d7de") }}>
              <Suspense fallback={null}>
                <CodeEditor
                  uri={"flattened.mo"}
                  content={flattenedCode}
                  setEditor={() => {}}
                  theme={colorMode === "dark" ? "vs-dark" : "light"}
                  embed={false}
                  readOnly={true}
                />
              </Suspense>
            </div>
          </Dialog>
        )}
        {isSplashVisible && (
          <Splash
            context={null}
            onClose={() => setSplashVisible(false)}
            onSelect={handleModelSelect}
            recentModels={recentModels}
            exampleModels={exampleModels}
            colorMode={resolvedColorMode}
            onClearRecent={handleClearRecent}
            translations={translations}
          />
        )}
      </div>
    </>
  );
}
