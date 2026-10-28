// SPDX-License-Identifier: AGPL-3.0-or-later

import { decodeDataUrl } from "@modelscript/dsl/utils";
import type { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme as useSiteTheme } from "../../theme";
import type { CodeEditorHandle } from "./Code";
import { MORSEL_LANGUAGES, getLanguageExtension, getLanguageInfo } from "./constants";
import type { DiagramEditorHandle } from "./Diagram";
import "./morsel.css";
import { getTranslations, uiLanguages } from "./util/i18n";
import {
  applyDiagramEdits,
  applyLspEdits,
  didClose,
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

export interface MorselEditorProps {
  dataUrl?: DataUrl | null | undefined;
  initialCode?: string | undefined;
  embed?: boolean | undefined;
  initialDialect?: string | undefined;
  initialLanguage?: string | undefined;
  initialView?: string | undefined;
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
  onCodeChange?: ((code: string) => void) | undefined;
  onDialectChange?: ((dialect: string) => void) | undefined;
  onSave?: ((code: string) => void) | undefined;
}

const isSplit = (v: View) => v === View.SPLIT_COLUMNS || v === View.SPLIT_ROWS;

export default function MorselEditor(props: MorselEditorProps) {
  const toast = useToast();
  const resolvedInitialDialect = props.initialDialect ?? props.initialLanguage;
  const initialLangInfo = getLanguageInfo(resolvedInitialDialect);
  const [dialect, setDialectState] = useState<string>(initialLangInfo.id);
  const [diagramType, setDiagramType] = useState<string>(initialLangInfo.diagramTypes?.[0]?.id ?? "diagram");
  const [sidecarContent, setSidecarContent] = useState<string | undefined>(undefined);
  const documentUri = useMemo(() => `file:///document.${getLanguageExtension(dialect)}`, [dialect]);
  const documentUriRef = useRef(documentUri);
  documentUriRef.current = documentUri;

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
  const content = props.initialCode ?? decodedContent ?? initialLangInfo.defaultCode;
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);

  const initialIsCad =
    props.initialView === "cad-only" || (initialLangInfo.supports3d && !initialLangInfo.supportsDiagram);
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
  const [drillDownPath, setDrillDownPath] = useState<string[]>([]);
  const isSpatialEditPending = useRef(false);
  const diagramEditorRef = useRef<DiagramEditorHandle>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  const [isDiagramLoading, setIsDiagramLoading] = useState(false);
  const [treeVisible, setTreeVisible] = useState(true);
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [contextVersion, setContextVersion] = useState(0);

  useEffect(() => {
    if (props.initialCode !== undefined) {
      setLastLoadedContent(props.initialCode);
      if (editor && editor.getValue() !== props.initialCode) {
        editor.setValue(props.initialCode);
        didOpen(documentUriRef.current, props.initialCode, dialect);
        codeEditorRef.current?.sync();
        setContextVersion((v) => v + 1);
      }
    }
  }, [props.initialCode, editor, dialect]);

  const NARROW_BREAKPOINT = 768;
  const isNarrow = windowWidth < NARROW_BREAKPOINT;

  const handleSelectComponent = useCallback(
    (name: string | null, cachedProps?: any[], isLoading?: boolean) => {
      if (!name || name === "__diagram_background__" || name === "__diagram_axes__") {
        setSelectedComponent(null);
        setSelectedComponentProperties(null);
        setIsPropertiesLoading(false);
        return;
      }
      setSelectedComponent(name);

      if (cachedProps !== undefined) {
        setSelectedComponentProperties(cachedProps);
        setIsPropertiesLoading(Boolean(isLoading));
        return;
      }

      // Show lightweight properties immediately while full schema loads
      const initialProps = diagramData?.nodes?.find((n: any) => n.id === name)?.properties ?? null;
      setSelectedComponentProperties(initialProps);
      setIsPropertiesLoading(true);

      getComponentProperties(documentUri, selectedTreeClassName || undefined, name)
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
    [diagramData, documentUri, selectedTreeClassName],
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
    setLocalSimulationData,
    cadComponents,
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
    handleSimulate,
  } = useMorselEngine({
    dialect,
    documentUri,
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
            const response = await applyDiagramEdits(documentUriRef.current, actions, 1);
            if (response?.sidecarContent !== undefined) {
              setSidecarContent(response.sidecarContent);
            }
            if (response && response.edits && response.edits.length > 0 && editorRef.current) {
              if (response.renderHint === "none") {
                isSpatialEditPending.current = true;
              } else {
                isSpatialEditPending.current = false;
              }
              applyLspEdits(editorRef.current, response.edits, actions[0].type);
              // Yield to event loop to ensure didChange is sent to LSP before next edit is computed
              await new Promise((resolve) => setTimeout(resolve, 50));
            } else if (response?.sidecarContent !== undefined) {
              setIsDiagramLoading(false);
              setContextVersion((v) => v + 1);
            }
          })
          .catch((err) => {
            console.error("Failed to apply diagram edit batch:", err);
          });
      }
    }, delay);
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

  const handleNodeDoubleClick = useCallback(
    (nodeId: string, nodeData?: any) => {
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
      const nodeEntry = diagramData?.nodes?.find((n: any) => n.id === nodeId);
      const candidateType =
        nodeEntry?.type ||
        nodeEntry?.className ||
        nodeEntry?.properties?.typeName ||
        nodeData?.type ||
        nodeData?.className;
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
      } else {
        setDrillDownPath((prev) => {
          const rootName = selectedTreeClassName || documentModels[0]?.name || dialect;
          const base = prev.length === 0 ? [rootName] : prev;
          if (base[base.length - 1] === shortName) return base;
          return [...base, shortName];
        });
      }
    },
    [diagramData, documentModels, selectedTreeClassName, dialect, handleRevealLine],
  );

  const handleDrillRoot = useCallback(() => {
    if (drillDownPath.length > 0) {
      const rootModel = documentModels.find((m) => m.name === drillDownPath[0]);
      if (rootModel) {
        setSelectedTreeClassName(rootModel.name);
      }
    }
    setDrillDownPath([]);
  }, [drillDownPath, documentModels]);

  const handleDrillUp = useCallback(
    (index: number) => {
      const targetName = drillDownPath[index];
      if (!targetName) return;
      const matched = documentModels.find((m) => m.name === targetName);
      if (matched) {
        setSelectedTreeClassName(matched.name);
      }
      setDrillDownPath((prev) => prev.slice(0, index + 1));
    },
    [drillDownPath, documentModels],
  );

  const handleInsertStencilSnippet = useCallback(
    (snippet: string, className?: string) => {
      if ((dialect === "modelica" || dialect === "modelscript") && className && editorRef.current) {
        enqueueDiagramAction({ type: "addComponent", className, x: 0, y: 0 });
        return;
      }
      const ed = editorRef.current;
      if (!ed) return;
      const currentText = ed.getValue();
      let nextText = currentText;
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

      setLoadingProgress(10);
      setLoadingMessage("Initializing modeling & simulation engine…");

      try {
        const conn = await startLsp(dialect);
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
      setLoadingMessage("Loading modeling workspace…");

      // Notify LSP of the initial file content
      didOpen(documentUri, content, dialect);

      // Force tree update by bumping version now that LSP is ready
      setContextVersion((v) => v + 1);

      setAvailableLanguages(uiLanguages);

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
  }, [content, dialect, documentUri]);

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
    const handleResize = () => setWindowWidth(window.innerWidth);
    const handleOpenShareModal = () => setShareDialogOpen(true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("modelscript:open-share-modal", handleOpenShareModal);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("modelscript:open-share-modal", handleOpenShareModal);
    };
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
    if (view === View.DIAGRAM || isSplit(view)) {
      setTimeout(() => {
        diagramEditorRef.current?.fitContent();
      }, 100);
    }
  }, [view, treeVisible]);

  const handleSelectDialect = useCallback(
    (newDialectId: string) => {
      const nextInfo = getLanguageInfo(newDialectId);
      const prevInfo = getLanguageInfo(dialect);
      if (nextInfo.id === dialect) return;

      const prevUri = `file:///document.${getLanguageExtension(dialect)}`;
      const nextUri = `file:///document.${getLanguageExtension(nextInfo.id)}`;

      didClose(prevUri);
      setDialectState(nextInfo.id);
      setSidecarContent(undefined);
      setDrillDownPath([]);
      setDiagramType(nextInfo.diagramTypes?.[0]?.id ?? "diagram");

      if (nextInfo.supports3d && !nextInfo.supportsDiagram) {
        setShowCadView(true);
        setShowResultsView(false);
      } else if (nextInfo.supportsDiagram) {
        setShowCadView(false);
      }

      const currentVal = editorRef.current?.getValue() ?? "";
      const isDefaultOrEmpty =
        !currentVal.trim() ||
        currentVal === prevInfo.defaultCode ||
        MORSEL_LANGUAGES.some((l) => l.defaultCode === currentVal);
      const nextCode = isDefaultOrEmpty ? nextInfo.defaultCode : currentVal;

      if (editorRef.current && nextCode !== currentVal) {
        editorRef.current.setValue(nextCode);
      }
      setLastLoadedContent(nextCode);
      didOpen(nextUri, nextCode, nextInfo.id);
      setContextVersion((v) => v + 1);
      props.onDialectChange?.(nextInfo.id);
    },
    [dialect, props.onDialectChange],
  );

  useEffect(() => {
    if (resolvedInitialDialect && resolvedInitialDialect !== dialect) {
      handleSelectDialect(resolvedInitialDialect);
    }
  }, [resolvedInitialDialect, dialect, handleSelectDialect]);

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
      const { content: fetchedContent, error } = await getClassSource(className);
      if (fetchedContent && editorRef.current) {
        if (dialect !== "modelica") {
          didClose(documentUriRef.current);
          setDialectState("modelica");
          setSidecarContent(undefined);
          setDiagramType("diagram");
        }
        editorRef.current.setValue(fetchedContent);
        setLastLoadedContent(fetchedContent);
        didOpen("file:///document.mo", fetchedContent, "modelica");
        codeEditorRef.current?.sync();
        setContextVersion((v) => v + 1);
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
    (className: string, kind?: string) => {
      if (editorRef.current?.getValue() !== lastLoadedContentRef.current && pendingSelection !== className) {
        setPendingSelection(className);
        setDirtyDialogOpen(true);
      } else {
        loadClassRef.current(className, kind);
      }
    },
    [pendingSelection],
  );

  const handleTreeHighlight = useCallback((_name: string | null) => {}, []);

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
    if (!langInfo.supportsDiagram || (requiresClassName && !selectedTreeClassName)) {
      setDiagramData(null);
      setIsDiagramLoading(false);
      return;
    }

    let cancelled = false;
    setIsDiagramLoading(true);

    getDiagramData(documentUri, selectedTreeClassName || undefined, diagramType, sidecarContent)
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
  }, [documentUri, dialect, selectedTreeClassName, diagramType, sidecarContent, contextVersion]);

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
            documentUri={documentUri}
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
                  uri={documentUri}
                  languageId={dialect}
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
        {!props.embed && !props.hideFloatingDock && (
          <MorselFloatingDock
            colorMode={colorMode}
            treeVisible={treeVisible}
            setTreeVisible={setTreeVisible}
            translations={translations}
            dialect={dialect}
            onSelectDialect={handleSelectDialect}
            onNewModel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const defaultCode = getLanguageInfo(dialect).defaultCode;
              if (editorRef.current) {
                editorRef.current.setValue(defaultCode);
              }
              setLastLoadedContent(defaultCode);
              setSidecarContent(undefined);
              didOpen(documentUri, defaultCode, dialect);
              setContextVersion((v) => v + 1);
            }}
            openFileButtonRef={openFileButtonRef}
            onOpenFile={() => setIsOpenFileDialogOpen(true)}
            onSaveModel={async () => {
              const currentContent = editor?.getValue() || "";
              props.onSave?.(currentContent);
              const ext = getLanguageExtension(dialect);
              let filename = `model.${ext}`;
              if ((dialect === "modelica" || dialect === "modelscript") && codeEditorRef.current) {
                const synced = await codeEditorRef.current.sync();
                if ((synced as any)?.[0]?.name) {
                  filename = `${(synced as any)[0].name}.${ext}`;
                }
              }
              if (filename === `model.${ext}`) {
                const nameMatch = /(?:model|package|block|class|connector|record|function)\s+([A-Za-z_]\w*)/.exec(
                  currentContent,
                );
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
        )}

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
          dialect={dialect}
          documentUri={documentUri}
          onSelectDialect={handleSelectDialect}
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

        {(props.embed || props.showParameterRibbon) && ribbonParams.length > 0 && (
          <ParameterSliderRibbon
            parameters={ribbonParams as any}
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
