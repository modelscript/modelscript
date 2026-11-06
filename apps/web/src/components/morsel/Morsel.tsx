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
  applyLspTextEditsToString,
  didChange,
  didClose,
  didOpen,
  extractPrimaryModelicaClassName,
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

let nextEmbedMorselId = 1;

export interface MorselEditorProps {
  dataUrl?: DataUrl | null | undefined;
  initialCode?: string | undefined;
  embed?: boolean | undefined;
  initialDialect?: string | undefined;
  initialLanguage?: string | undefined;
  initialView?: string | undefined;
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
  defaultRibbonExpanded?: boolean | undefined;
  simulateTriggerCount?: number | undefined;
  externalParams?: Record<string, string | number | boolean> | undefined;
  onCodeChange?: ((code: string) => void) | undefined;
  onDialectChange?: ((dialect: string) => void) | undefined;
  onAnchorClick?: ((anchor: { elementId: string; kind: "component" }) => void) | undefined;
  onSimulationStatus?: ((status: string, data?: unknown) => void) | undefined;
  onActiveViewChange?: ((view: "diagram" | "simulation" | "3d" | "inspector" | "code" | "split") => void) | undefined;
  onParametersChange?: ((params: Record<string, number>) => void) | undefined;
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
  const instanceDocPrefix = useMemo(
    () => (props.embed ? `file:///embed_${nextEmbedMorselId++}_document` : "file:///document"),
    [props.embed],
  );
  const documentUri = useMemo(
    () => `${instanceDocPrefix}.${getLanguageExtension(dialect)}`,
    [instanceDocPrefix, dialect],
  );
  const documentUriRef = useRef(documentUri);
  documentUriRef.current = documentUri;

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
    props.initialView === "cad-only" ||
    props.initialView === "cad" ||
    props.initialView === "3d" ||
    (initialLangInfo.supports3d && !initialLangInfo.supportsDiagram);
  const initialIsPlot =
    props.initialView === "plot-only" || props.initialView === "plot" || props.initialView === "simulation";
  const initialIsInspector = props.initialView === "inspector";
  const initialViewMode =
    props.initialView === "code-only" || props.initialView === "code"
      ? View.CODE
      : props.initialView === "diagram-only" ||
          props.initialView === "diagram" ||
          initialIsCad ||
          initialIsPlot ||
          initialIsInspector
        ? View.DIAGRAM
        : props.initialView === "split-rows"
          ? View.SPLIT_ROWS
          : View.SPLIT_COLUMNS;

  const [view, setView] = useState<View>(initialViewMode);
  const [showResultsView, setShowResultsView] = useState(initialIsPlot);
  const [showCadView, setShowCadView] = useState(initialIsCad);
  const [showAnalysisView, setShowAnalysisView] = useState(initialIsInspector);
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
  const [selectedTreeClassName, setSelectedTreeClassName] = useState<string | null>(() =>
    dialect === "modelica" || !dialect ? (props.initialClassName ?? extractPrimaryModelicaClassName(content)) : null,
  );
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [documentModels, setDocumentModels] = useState<{ name: string; kind: string }[]>([]);
  const [drillDownPath, setDrillDownPath] = useState<string[]>([]);
  const isSpatialEditPending = useRef(false);
  const lastDiagramEditTimeRef = useRef(0);
  const diagramDataRef = useRef<any>(null);
  diagramDataRef.current = diagramData;
  const lastDiagramTargetKeyRef = useRef<string>("");
  const diagramEditorRef = useRef<DiagramEditorHandle>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  const [isDiagramLoading, setIsDiagramLoading] = useState(false);
  const [treeVisible, setTreeVisible] = useState(!props.embed);
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [contextVersion, setContextVersion] = useState(0);

  useEffect(() => {
    const handleToggle = () => {
      setTreeVisible((v) => {
        const next = !v;
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("morsel:sidebar-changed", { detail: { open: next } }));
        }
        return next;
      });
    };
    window.addEventListener("morsel:toggle-sidebar", handleToggle);
    return () => window.removeEventListener("morsel:toggle-sidebar", handleToggle);
  }, []);

  const applyViewMode = useCallback((targetView: string) => {
    if (targetView === "code-only" || targetView === "code") {
      setView(View.CODE);
      setShowCadView(false);
      setShowResultsView(false);
      setShowAnalysisView(false);
    } else if (targetView === "diagram-only" || targetView === "diagram") {
      setView(View.DIAGRAM);
      setShowCadView(false);
      setShowResultsView(false);
      setShowAnalysisView(false);
    } else if (targetView === "cad-only" || targetView === "cad" || targetView === "3d") {
      setView(View.DIAGRAM);
      setShowCadView(true);
      setShowResultsView(false);
      setShowAnalysisView(false);
    } else if (targetView === "plot-only" || targetView === "plot" || targetView === "simulation") {
      setView(View.DIAGRAM);
      setShowCadView(false);
      setShowResultsView(true);
      setShowAnalysisView(false);
    } else if (targetView === "inspector") {
      setView(View.DIAGRAM);
      setShowCadView(false);
      setShowResultsView(false);
      setShowAnalysisView(true);
    } else if (targetView === "split" || targetView === "split-columns") {
      setView(View.SPLIT_COLUMNS);
      setShowCadView(false);
      setShowResultsView(false);
      setShowAnalysisView(false);
    } else if (targetView === "split-rows") {
      setView(View.SPLIT_ROWS);
      setShowCadView(false);
      setShowResultsView(false);
      setShowAnalysisView(false);
    }
  }, []);

  useEffect(() => {
    if (!props.initialView) return;
    applyViewMode(props.initialView);
  }, [props.initialView, applyViewMode]);

  useEffect(() => {
    if (props.initialAnchor?.elementId) {
      setPendingSelection(props.initialAnchor.elementId);
      setSelectedComponent(props.initialAnchor.elementId);
    }
  }, [props.initialAnchor?.elementId]);

  useEffect(() => {
    if (props.initialCode !== undefined) {
      setLastLoadedContent(props.initialCode);
      if (editor && editor.getValue() !== props.initialCode) {
        editor.setValue(props.initialCode);
        didOpen(documentUriRef.current, props.initialCode, dialect);
        codeEditorRef.current?.sync();
        const primary = dialect === "modelica" || !dialect ? extractPrimaryModelicaClassName(props.initialCode) : null;
        if (primary) {
          setSelectedTreeClassName(primary);
        }
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
      props.onAnchorClick?.({ elementId: name, kind: "component" });

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
    showCadView,
    isNarrow,
    setMobileTab,
    setTreeVisible,
    setView,
    viewDiagramEnum: View.DIAGRAM,
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
    props.onParametersChange?.(parameterOverrides);
  }, [parameterOverrides, props.onParametersChange]);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplit = useRef(false);
  const [isSplitResizerHovered, setIsSplitResizerHovered] = useState(false);
  const [isSplitResizerDragging, setIsSplitResizerDragging] = useState(false);
  const [treeWidth, setTreeWidth] = useState(300);
  const [propertiesWidth, setPropertiesWidth] = useState(props.embed ? 240 : 300);
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
  const onCodeChangeRef = useRef(props.onCodeChange);
  onCodeChangeRef.current = props.onCodeChange;

  const enqueueDiagramAction = useCallback(
    (action: any) => {
      pendingDiagramActionsRef.current.push(action);
      if (diagramActionTimerRef.current) clearTimeout(diagramActionTimerRef.current);

      // Optimistically update selectedComponentProperties so Property Panel stays in sync immediately
      if (action.type === "updateParameter" || action.type === "updateProperty") {
        const paramKey = action.type === "updateParameter" ? action.parameter : action.key;
        const paramVal = String(action.value ?? "");
        setSelectedComponentProperties((prev: any) => {
          if (!prev || prev.name !== action.name) return prev;
          return {
            ...prev,
            parameters: Array.isArray(prev.parameters)
              ? prev.parameters.map((p: any) => (p.name === paramKey ? { ...p, value: paramVal } : p))
              : prev.parameters,
            properties:
              prev.properties && typeof prev.properties === "object"
                ? { ...prev.properties, [paramKey]: action.value }
                : prev.properties,
          };
        });
      } else if (action.type === "updateName") {
        setSelectedComponentProperties((prev: any) =>
          prev && prev.name === action.oldName ? { ...prev, name: action.newName } : prev,
        );
      } else if (action.type === "updateDescription") {
        setSelectedComponentProperties((prev: any) =>
          prev && prev.name === action.name ? { ...prev, description: action.description } : prev,
        );
      }

      const isSpatial = ["move", "resize", "rotate", "moveEdge"].includes(action.type);
      const isOptimisticOnly =
        isSpatial ||
        action.type === "updateParameter" ||
        action.type === "updateProperty" ||
        action.type === "updateName" ||
        action.type === "updateDescription";
      if (!isOptimisticOnly && !diagramDataRef.current) {
        setIsDiagramLoading(true);
      }
      const delay = isSpatial ? 8 : 0;

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
              if (response && response.edits && response.edits.length > 0) {
                isSpatialEditPending.current = true;
                lastDiagramEditTimeRef.current = Date.now();
                if (editorRef.current) {
                  applyLspEdits(editorRef.current, response.edits, actions[0].type);
                  const updatedCode = editorRef.current.getValue();
                  setLastLoadedContent(updatedCode);
                  if (codeEditorRef.current) {
                    await codeEditorRef.current.sync();
                  } else {
                    didChange(documentUriRef.current, updatedCode);
                  }
                  onCodeChangeRef.current?.(updatedCode);
                } else {
                  const baseText = lastLoadedContentRef.current || content;
                  const updatedCode = applyLspTextEditsToString(baseText, response.edits);
                  setLastLoadedContent(updatedCode);
                  didChange(documentUriRef.current, updatedCode);
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
            })
            .catch((err) => {
              console.error("Failed to apply diagram edit batch:", err);
              setIsDiagramLoading(false);
            });
        }
      }, delay);
    },
    [content],
  );

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

      setLoadingProgress(10);
      setLoadingMessage("Initializing modeling & simulation engine…");

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
        conn.onNotification("modelscript/status", (params: any) => {
          if (params?.state === "ready") {
            setContextVersion((v) => v + 1);
          }
        });
      } catch (e) {
        console.error("Failed to start LSP:", e);
      }

      setLoadingProgress(80);
      setLoadingMessage("Loading modeling workspace…");

      // Notify LSP of the initial file content and ensure notification is sent before triggering simulation/tree update
      await didOpen(documentUri, content, dialect);

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
    const handleMorselCommand = (ev: Event) => {
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
    window.addEventListener("modelscript:morsel-command", handleMorselCommand);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("modelscript:open-share-modal", handleOpenShareModal);
      window.removeEventListener("modelscript:morsel-command", handleMorselCommand);
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

      const prevUri = `${instanceDocPrefix}.${getLanguageExtension(dialect)}`;
      const nextUri = `${instanceDocPrefix}.${getLanguageExtension(nextInfo.id)}`;

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
      const primary = nextInfo.id === "modelica" || !nextInfo.id ? extractPrimaryModelicaClassName(nextCode) : null;
      if (primary) {
        setSelectedTreeClassName(primary);
      }
      setContextVersion((v) => v + 1);
      props.onDialectChange?.(nextInfo.id);
    },
    [dialect, instanceDocPrefix, props.onDialectChange],
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
        didOpen(`${instanceDocPrefix}.mo`, fetchedContent, "modelica");
        codeEditorRef.current?.sync();
        const primaryClassName =
          extractPrimaryModelicaClassName(fetchedContent) || className.split(".").pop() || className;
        setSelectedTreeClassName(primaryClassName);
        setContextVersion((v) => v + 1);
        props.onCodeChange?.(fetchedContent);
      } else if (error) {
        console.warn("Failed to fetch source for %s:", className, error);
      }
    } catch (e) {
      console.error("Error loading source for %s:", className, e);
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

  const [highlightedComponent, setHighlightedComponent] = useState<string | null>(null);

  const handleTreeHighlight = useCallback((name: string | null) => {
    setHighlightedComponent(name);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("morsel:highlight-component", { detail: { name } }));
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
    if (!langInfo.supportsDiagram || (requiresClassName && !selectedTreeClassName)) {
      setDiagramData(null);
      setIsDiagramLoading(false);
      return;
    }

    let cancelled = false;
    const targetKey = `${documentUri}|${dialect}|${selectedTreeClassName ?? ""}|${diagramType}`;
    const isTargetSwitch = lastDiagramTargetKeyRef.current !== targetKey;
    lastDiagramTargetKeyRef.current = targetKey;

    if (isTargetSwitch || !diagramDataRef.current || diagramDataRef.current.isLoading) {
      setIsDiagramLoading(true);
    }

    getDiagramData(documentUri, selectedTreeClassName || undefined, diagramType, sidecarContent)
      .then((data) => {
        if (cancelled) return;
        setDiagramData(data);
        if (!data || (!data.isLoading && (!data.nodes || data.nodes.length === 0))) {
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

  const handleAutoLayout = useCallback(() => {
    diagramEditorRef.current?.layout();
    const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);
    toast.info(`Auto-layout applied (${isMac ? "⌘Z" : "Ctrl+Z"} to undo)`);
  }, [toast]);

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
        <MorselMobileTabBar
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
          }}
        >
          <MorselLeftSidebar
            treeVisible={treeVisible}
            setTreeVisible={setTreeVisible}
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
              selectedComponent={selectedComponent ?? highlightedComponent}
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
              loadingProgress={loadingProgress}
            />

            {/* Split Resizer */}
            {isSplit(view) && !isNarrow && (
              <div
                role="separator"
                aria-orientation={view === View.SPLIT_COLUMNS ? "vertical" : "horizontal"}
                aria-valuenow={Math.round(splitRatio * 100)}
                aria-valuemin={20}
                aria-valuemax={80}
                aria-label="Resize split panes"
                tabIndex={0}
                style={{
                  width: view === View.SPLIT_COLUMNS ? 10 : "100%",
                  height: view === View.SPLIT_ROWS ? 10 : "100%",
                  marginLeft: view === View.SPLIT_COLUMNS ? -5 : 0,
                  marginRight: view === View.SPLIT_COLUMNS ? -5 : 0,
                  marginTop: view === View.SPLIT_ROWS ? -5 : 0,
                  marginBottom: view === View.SPLIT_ROWS ? -5 : 0,
                  cursor: view === View.SPLIT_COLUMNS ? "col-resize" : "row-resize",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  backgroundColor: "transparent",
                  display: "flex",
                  position: "relative",
                  zIndex: 10,
                  outline: "none",
                  userSelect: "none",
                  borderLeft:
                    view === View.SPLIT_COLUMNS && !isSplitResizerHovered && !isSplitResizerDragging
                      ? `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}`
                      : "none",
                  borderTop:
                    view === View.SPLIT_ROWS && !isSplitResizerHovered && !isSplitResizerDragging
                      ? `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}`
                      : "none",
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
                  setSplitRatio(0.5);
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
                onMouseEnter={() => setIsSplitResizerHovered(true)}
                onMouseLeave={() => setIsSplitResizerHovered(false)}
              >
                {/* Active highlight line centered on the split */}
                <div
                  style={{
                    width: view === View.SPLIT_COLUMNS ? 2 : "100%",
                    height: view === View.SPLIT_ROWS ? 2 : "100%",
                    backgroundColor:
                      isSplitResizerHovered || isSplitResizerDragging ? "var(--ms-brand, #0891b2)" : "transparent",
                    transition: "background-color 0.15s ease",
                  }}
                />
                {/* Subtle grab pill in the center */}
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: view === View.SPLIT_COLUMNS ? 4 : 28,
                    height: view === View.SPLIT_COLUMNS ? 28 : 4,
                    borderRadius: 999,
                    backgroundColor:
                      isSplitResizerHovered || isSplitResizerDragging ? "var(--ms-brand, #0891b2)" : "transparent",
                    boxShadow:
                      isSplitResizerHovered || isSplitResizerDragging
                        ? "0 0 6px color-mix(in srgb, var(--ms-brand, #0891b2) 50%, transparent)"
                        : "none",
                    opacity: isSplitResizerHovered || isSplitResizerDragging ? 1 : 0,
                    transition: "opacity 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
                    pointerEvents: "none",
                  }}
                />
              </div>
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

        {(props.embed || props.showParameterRibbon) &&
          ribbonParams.length > 0 &&
          view !== View.CODE &&
          !showAnalysisView && (
            <ParameterSliderRibbon
              parameters={ribbonParams as any}
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
                !(typeof window !== "undefined" && window.location.pathname.startsWith("/playground"))
              }
            />
          )}
      </div>
    </>
  );
}
