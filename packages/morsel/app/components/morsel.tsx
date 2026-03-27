// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ContentType,
  Context,
  decodeDataUrl,
  encodeDataUrl,
  ModelicaClassInstance,
  ModelicaClassKind,
  ModelicaComponentClauseSyntaxNode,
  ModelicaComponentInstance,
  ModelicaDAE,
  ModelicaDAEPrinter,
  ModelicaEntity,
  ModelicaFlattener,
  ModelicaSimulator,
  StringWriter,
  type IDiagram,
  type ParameterInfo,
} from "@modelscript/core";
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
  TriangleDownIcon,
  UnwrapIcon,
  UploadIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  ActionList,
  ActionMenu,
  Dialog,
  IconButton,
  SegmentedControl,
  Spinner,
  TextInput,
  useTheme,
} from "@primer/react";
import { Zip } from "@zenfs/archives";
import { configure, InMemory } from "@zenfs/core";
import type { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Language, Parser } from "web-tree-sitter";
import { mountLibrary, WebFileSystem } from "~/util/filesystem";
import { getTranslations, uiLanguages } from "~/util/i18n";
import type { CodeEditorHandle } from "./code";
import ComponentList from "./component-list";
import type { DiagramEditorHandle } from "./diagram";
import OpenFileDropzone from "./open-file-dropzone";
import PropertiesWidget from "./properties";
import { SimulationParameters } from "./simulation-parameters";
import { Splash, type ModelData } from "./splash";
import TreeWidget from "./tree";
import { VariablesTree } from "./variables-tree";

import AddLibraryModal from "./add-library-modal";
const CodeEditor = React.lazy(() => import("./code"));
const DiagramEditor = React.lazy(() => import("./diagram"));
const SimulationResults = React.lazy(() =>
  import("./simulation-results").then((m) => ({ default: m.SimulationResults })),
);

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
  const [isSimulateDialogOpen, setSimulateDialogOpen] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<any>(null);
  const [simulationJobId, setSimulationJobId] = useState<string | null>(null);
  const [simulationMode, setSimulationMode] = useState<"server" | "local">("local");
  const [localSimulationData, setLocalSimulationData] = useState<Record<string, number | string>[] | null>(null);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const simulateAbortControllerRef = useRef<AbortController | null>(null);
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const [decodedContent] = decodeDataUrl(props.dataUrl ?? null);
  const content = decodedContent || "model Example\n\nend Example;";
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);
  const [classInstances, setClassInstances] = useState<ModelicaClassInstance[]>([]);
  const [context, setContext] = useState<Context | null>(null);
  const [view, setView] = useState<View>(View.SPLIT_COLUMNS);
  const [showResultsView, setShowResultsView] = useState(false);
  const [simulationVariables, setSimulationVariables] = useState<string[]>([]);
  const [selectedSimulationVariables, setSelectedSimulationVariables] = useState<string[]>([]);
  const [simulationParameters, setSimulationParameters] = useState<ParameterInfo[]>([]);
  const [parameterOverrides, setParameterOverrides] = useState<Map<string, number>>(new Map());
  const cachedSimulatorRef = useRef<ModelicaSimulator | null>(null);
  const [lastLoadedContent, setLastLoadedContent] = useState<string>("");
  const [isDirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<ModelicaClassInstance | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<ModelicaComponentInstance | null>(null);
  const [diagramClassInstance, setDiagramClassInstance] = useState<ModelicaClassInstance | null>(null);
  const [selectedTreeClassName, setSelectedTreeClassName] = useState<string | null>(null);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const isDiagramUpdate = useRef(false);
  const diagramEditorRef = useRef<DiagramEditorHandle>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Loading…");
  const [treeVisible, setTreeVisible] = useState(true);
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [splitRatio, setSplitRatio] = useState(0.5);
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
    if (classInstances.length === 0) return [];
    const models: ModelicaClassInstance[] = [];
    const collectNested = (instance: ModelicaClassInstance) => {
      for (const element of instance.elements) {
        if (element instanceof ModelicaClassInstance) {
          if (element.classKind === ModelicaClassKind.MODEL || element.classKind === ModelicaClassKind.BLOCK) {
            models.push(element);
          } else if (element.classKind === ModelicaClassKind.PACKAGE) {
            collectNested(element);
          }
        }
      }
    };
    for (const rootInstance of classInstances) {
      if (rootInstance.classKind === ModelicaClassKind.MODEL || rootInstance.classKind === ModelicaClassKind.BLOCK) {
        models.push(rootInstance);
      } else if (rootInstance.classKind === ModelicaClassKind.PACKAGE) {
        collectNested(rootInstance);
      }
    }
    return models;
  }, [classInstances]);

  useEffect(() => {
    if (!props.embed) {
      if (treeVisible) {
        document.body.classList.add("tree-visible");
      } else {
        document.body.classList.remove("tree-visible");
      }
    }
  }, [treeVisible, props.embed]);

  // Keep a ref so the main effect can read overrides without depending on them
  const parameterOverridesRef = useRef(parameterOverrides);
  parameterOverridesRef.current = parameterOverrides;

  // Main auto-simulate: full flatten + simulate when the model changes
  useEffect(() => {
    if (showResultsView && simulationMode === "local" && classInstances.length > 0) {
      const instance = diagramClassInstance ?? classInstances[0];
      if (!instance) return;

      simulateAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      simulateAbortControllerRef.current = abortController;

      const timer = setTimeout(async () => {
        if (!instance.instantiated) {
          instance.instantiate();
        }

        try {
          const dae = new ModelicaDAE(instance.name || "Model");
          const flattener = new ModelicaFlattener();
          instance.accept(flattener, ["", dae]);

          const simulator = new ModelicaSimulator(dae);
          simulator.prepare();
          cachedSimulatorRef.current = simulator;
          setSimulationParameters(simulator.getParameterInfo());
          const states = Array.from(simulator.stateVars);

          if (states.length === 0) {
            throw new Error(
              "No simulation variables are available to plot for this model. Ensure you have equations defining state variables or parameters.",
            );
          }

          const exp = dae.experiment;
          const startTime = exp.startTime ?? 0;
          const stopTime = exp.stopTime ?? 10;
          const step = exp.interval ?? (stopTime - startTime) / 1000;

          const result = await simulator.simulate(startTime, stopTime, step, {
            signal: abortController.signal,
            parameterOverrides: parameterOverridesRef.current,
          });

          const chartData = result.t.map((t: number, i: number) => {
            const row: Record<string, number | string> = { time: t };
            result.states?.forEach((state: string, vIndex: number) => {
              row[state] = result.y[i]?.[vIndex] ?? 0;
            });
            return row;
          });

          setLocalSimulationData(chartData);
          setSimulationStatus({ status: "completed" });
        } catch (e) {
          if ((e as Error).message === "Simulation aborted") return;
          setSimulationStatus({
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }, 1000);
      return () => {
        clearTimeout(timer);
        abortController.abort();
      };
    }
  }, [classInstances, showResultsView, simulationMode, diagramClassInstance]);

  // Lightweight re-simulate when only parameter overrides change (skip flattening)
  useEffect(() => {
    const simulator = cachedSimulatorRef.current;
    if (!simulator || !showResultsView || simulationMode !== "local") return;
    // Skip on first render — the main effect handles initial simulation
    if (parameterOverrides.size === 0) return;

    const abortController = new AbortController();
    const timer = setTimeout(async () => {
      try {
        simulator.prepare();
        const exp = simulator.dae.experiment;
        const startTime = exp.startTime ?? 0;
        const stopTime = exp.stopTime ?? 10;
        const step = exp.interval ?? (stopTime - startTime) / 1000;
        const result = await simulator.simulate(startTime, stopTime, step, {
          signal: abortController.signal,
          parameterOverrides,
        });

        const chartData = result.t.map((t: number, i: number) => {
          const row: Record<string, number | string> = { time: t };
          result.states?.forEach((state: string, vIndex: number) => {
            row[state] = result.y[i]?.[vIndex] ?? 0;
          });
          return row;
        });

        setLocalSimulationData(chartData);
      } catch (e) {
        if ((e as Error).message === "Simulation aborted") return;
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [parameterOverrides, showResultsView, simulationMode]);

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
      setLoadingMessage("Initializing parser…");
      await new Promise((r) => setTimeout(r, 0));
      await Parser.init();
      setLoadingProgress(25);
      setLoadingMessage("Loading Modelica grammar…");
      await new Promise((r) => setTimeout(r, 0));
      const Modelica = await Language.load("/tree-sitter-modelica.wasm");
      const parser = new Parser();
      parser.setLanguage(Modelica);
      Context.registerParser(".mo", parser);

      setLoadingProgress(40);
      setLoadingMessage("Fetching Modelica Standard Library…");
      await new Promise((r) => setTimeout(r, 0));
      try {
        const cache = await caches.open("modelscript-libraries");
        let ModelicaLibrary = await cache.match("/ModelicaStandardLibrary_v4.1.0.zip");
        if (!ModelicaLibrary) {
          ModelicaLibrary = await fetch("/ModelicaStandardLibrary_v4.1.0.zip");
          if (!ModelicaLibrary.ok) {
            ModelicaLibrary = await fetch(
              "https://github.com/modelica/ModelicaStandardLibrary/releases/download/v4.1.0/ModelicaStandardLibrary_v4.1.0.zip",
            );
          }
          if (ModelicaLibrary.ok) {
            await cache.put("/ModelicaStandardLibrary_v4.1.0.zip", ModelicaLibrary.clone());
          }
        }
        setLoadingProgress(60);
        setLoadingMessage("Configuring filesystem…");
        await new Promise((r) => setTimeout(r, 0));
        await configure({
          mounts: {
            "/lib": { backend: Zip, data: await ModelicaLibrary.arrayBuffer() },
            "/tmp": InMemory,
          },
        });
      } catch (e: any) {
        if (e?.message?.includes("Mount point is already in use")) {
          console.warn("ZenFS already configured, skipping...");
        } else {
          console.error("Failed to configure ZenFS:", e);
        }
      }

      setLoadingProgress(80);
      setLoadingMessage("Loading libraries…");
      await new Promise((r) => setTimeout(r, 0));
      const ctx = new Context(new WebFileSystem());
      try {
        const libEntries = ctx.fs.readdir("/lib");
        const hasPackage = libEntries.some((e) => e.name === "package.mo");
        if (hasPackage) {
          ctx.addLibrary("/lib");
        } else {
          for (const entry of libEntries) {
            if (entry.isDirectory()) {
              try {
                ctx.addLibrary(`/lib/${entry.name}`);
              } catch (e) {
                console.warn(`Failed to load library from /lib/${entry.name}:`, e);
              }
            }
          }
        }
      } catch (e) {
        console.error("Failed to scan /lib:", e);
      }

      // Refresh libraries explicitly
      ctx.listLibraries();
      const langs = [...new Set([...ctx.availableLanguages(), ...uiLanguages])].sort();
      setAvailableLanguages(langs);

      // Auto-detect browser language
      const browserLang = navigator.language?.split("-")[0];
      if (browserLang && browserLang !== "en" && langs.includes(browserLang)) {
        ctx.setLanguage(browserLang);
        setLanguage(browserLang);
      }

      setContext(ctx);

      // Load example models from the virtual filesystem
      // Find the Modelica library path dynamically (could be "Modelica 4.1.0" etc.)
      let modelicaLibPath: string | null = null;
      for (const lib of ctx.listLibraries()) {
        if (lib.name === "Modelica") {
          modelicaLibPath = lib.path;
          break;
        }
      }

      if (!modelicaLibPath) {
        // Fallback for case where library isn't yet in Context list
        try {
          const libEntries = ctx.fs.readdir("/lib");
          const mslEntry = libEntries.find((e) => e.name.startsWith("Modelica ") && e.isDirectory());
          if (mslEntry) {
            modelicaLibPath = `/lib/${mslEntry.name}`;
            ctx.addLibrary(modelicaLibPath);
          } else if (ctx.fs.stat("/lib/package.mo")?.isFile()) {
            modelicaLibPath = "/lib";
          }
        } catch (e) {
          console.error("Failed to fallback search MSL:", e);
        }
      }
      const examples: ModelData[] = modelicaLibPath
        ? (EXAMPLE_PATHS.map((ex) => {
            try {
              const fullPath = `${modelicaLibPath}/${ex.path}`;
              const content = ctx.fs.read(fullPath);
              return { id: ex.id, name: ex.name, content };
            } catch (e) {
              console.error(`Failed to load example ${ex.name}`, e);
              return null;
            }
          }).filter(Boolean) as ModelData[])
        : [];
      setExampleModels(examples);

      // Defer hiding the loading screen until the browser is idle,
      // so the diagram and other heavy UI components finish rendering first.
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
  }, []);

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
    const firstInstance = classInstances[0] ?? null;
    if (firstInstance && (selectedComponent || expectedComponentNameRef.current)) {
      const nameToFind = expectedComponentNameRef.current || selectedComponent?.name;
      // Search across all root instances for the component
      let next: ModelicaComponentInstance | null = null;
      for (const inst of classInstances) {
        const found = Array.from(inst.components).find((c: any) => c.name === nameToFind);
        if (found) {
          next = found as ModelicaComponentInstance;
          break;
        }
      }
      setSelectedComponent(next);
      expectedComponentNameRef.current = null;
    } else {
      setSelectedComponent(null);
    }

    // Build the models list using the same logic as nestedModels
    const models: ModelicaClassInstance[] = [];
    const collectModels = (instance: ModelicaClassInstance) => {
      for (const element of instance.elements) {
        if (element instanceof ModelicaClassInstance) {
          if (element.classKind === ModelicaClassKind.MODEL || element.classKind === ModelicaClassKind.BLOCK) {
            models.push(element);
          } else if (element.classKind === ModelicaClassKind.PACKAGE) {
            collectModels(element);
          }
        }
      }
    };
    for (const rootInstance of classInstances) {
      if (rootInstance.classKind === ModelicaClassKind.MODEL || rootInstance.classKind === ModelicaClassKind.BLOCK) {
        models.push(rootInstance);
      } else if (rootInstance.classKind === ModelicaClassKind.PACKAGE) {
        collectModels(rootInstance);
      }
    }

    if (!isDiagramUpdate.current) {
      let targetIndex = 0;
      if (pendingModelNameRef.current && models.length > 1) {
        const idx = models.findIndex((m) => m.compositeName === pendingModelNameRef.current);
        if (idx !== -1) targetIndex = idx;
      } else if (models.length > 1) {
        targetIndex = Math.min(selectedModelIndex, models.length - 1);
      }
      pendingModelNameRef.current = null;
      setSelectedModelIndex(targetIndex);

      if (models.length > 1) {
        models[targetIndex].instantiate();
        setDiagramClassInstance(models[targetIndex]);
      } else if (models.length === 1) {
        setDiagramClassInstance(models[0]);
      } else {
        setDiagramClassInstance(firstInstance);
      }
    } else {
      // Diagram-initiated edit: preserve tab selection
      if (models.length > 1) {
        const targetIndex = Math.min(selectedModelIndex, models.length - 1);
        models[targetIndex].instantiate();
        setDiagramClassInstance(models[targetIndex]);
      } else if (models.length === 1) {
        setDiagramClassInstance(models[0]);
      } else {
        setDiagramClassInstance(firstInstance);
      }
    }
    isDiagramUpdate.current = false;

    if (firstInstance?.name) {
      saveRecentModel(firstInstance.name, editor?.getValue() || lastLoadedContent);
    }
  }, [classInstances]);

  useEffect(() => {
    if (view === View.DIAGRAM || isSplit(view)) {
      setTimeout(() => {
        diagramEditorRef.current?.fitContent();
      }, 100);
    }
  }, [view, treeVisible]);

  const loadClass = (selectedClass: ModelicaClassInstance) => {
    // Store the name so the useEffect can auto-select the right tab
    if (selectedClass.classKind === ModelicaClassKind.MODEL || selectedClass.classKind === ModelicaClassKind.BLOCK) {
      pendingModelNameRef.current = selectedClass.compositeName ?? null;
    } else {
      pendingModelNameRef.current = null;
    }

    let entity: ModelicaEntity | null = null;
    if (selectedClass instanceof ModelicaEntity) {
      entity = selectedClass;
    } else {
      let p = selectedClass.parent;
      while (p) {
        if (p instanceof ModelicaEntity) {
          entity = p;
          break;
        }
        p = p.parent;
      }
    }

    if (entity) {
      const path = entity.path;
      let filePath = path;
      if (context?.fs.stat(path)?.isDirectory()) {
        filePath = context.fs.join(path, "package.mo");
      }
      if (context?.fs.stat(filePath)?.isFile()) {
        const content = context.fs.read(filePath);
        editor?.setValue(content);
        setLastLoadedContent(content);
        const node = selectedClass.abstractSyntaxNode;
        if (node?.sourceRange) {
          editor?.revealRange({
            startLineNumber: node.startPosition.row + 1,
            startColumn: node.startPosition.column + 1,
            endLineNumber: node.endPosition.row + 1,
            endColumn: node.endPosition.column + 1,
          });
          editor?.setSelection({
            startLineNumber: node.startPosition.row + 1,
            startColumn: node.startPosition.column + 1,
            endLineNumber: node.endPosition.row + 1,
            endColumn: node.endPosition.column + 1,
          });
        }
      }
    } else {
      const node = selectedClass.abstractSyntaxNode;
      if (node?.sourceRange) {
        editor?.revealRange({
          startLineNumber: node.startPosition.row + 1,
          startColumn: node.startPosition.column + 1,
          endLineNumber: node.endPosition.row + 1,
          endColumn: node.endPosition.column + 1,
        });
        editor?.setSelection({
          startLineNumber: node.startPosition.row + 1,
          startColumn: node.startPosition.column + 1,
          endLineNumber: node.endPosition.row + 1,
          endColumn: node.endPosition.column + 1,
        });
      }
    }
  };

  const editorRef = useRef(editor);
  const lastLoadedContentRef = useRef(lastLoadedContent);
  const loadClassRef = useRef(loadClass);
  editorRef.current = editor;
  lastLoadedContentRef.current = lastLoadedContent;
  loadClassRef.current = loadClass;

  const handleTreeSelect = useCallback((classInstance: ModelicaClassInstance) => {
    diagramEditorRef.current?.showLoading();
    if (editorRef.current?.getValue() !== lastLoadedContentRef.current) {
      setPendingSelection(classInstance);
      setDirtyDialogOpen(true);
    } else {
      loadClassRef.current(classInstance);
    }
  }, []);

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

  const getNameEdit = (oldName: string, newName: string): editor.IIdentifiedSingleEditOperation | null => {
    const instance = diagramClassInstance ?? classInstances[0] ?? null;
    if (!instance || !editor || !newName) return null;
    const component = Array.from(instance.components).find((c: any) => c.name === oldName);
    if (!component) return null;

    const abstractNode = (component as any).abstractSyntaxNode;
    const identNode = abstractNode?.declaration?.identifier;
    if (identNode?.sourceRange) {
      return {
        range: {
          startLineNumber: identNode.startPosition.row + 1,
          startColumn: identNode.startPosition.column + 1,
          endLineNumber: identNode.endPosition.row + 1,
          endColumn: identNode.endPosition.column + 1,
        },
        text: newName,
      };
    }
    return null;
  };

  const getDescriptionEdit = (
    componentName: string,
    newDescription: string,
  ): editor.IIdentifiedSingleEditOperation | null => {
    const instance = diagramClassInstance ?? classInstances[0] ?? null;
    if (!instance || !editor) return null;
    const component = Array.from(instance.components).find((c: any) => c.name === componentName);
    if (!component) return null;

    const abstractNode = (component as any).abstractSyntaxNode;
    const descriptionNode = abstractNode?.description;

    // Escape quotes for Modelica (double them)
    const escapedDescription = newDescription.replace(/"/g, '""');

    if (descriptionNode?.sourceRange) {
      if (newDescription === "") {
        // Remove the description AND any preceding whitespace
        const model = editor.getModel();
        const descStartLine = descriptionNode.startPosition.row + 1;
        const descStartCol = descriptionNode.startPosition.column + 1;
        const descEndLine = descriptionNode.endPosition.row + 1;
        const descEndCol = descriptionNode.endPosition.column + 1;
        // Look backwards from the description start to consume preceding whitespace
        let removeStartCol = descStartCol;
        if (model) {
          const lineContent = model.getLineContent(descStartLine);
          let col = descStartCol - 2; // 0-indexed position before description
          while (col >= 0 && (lineContent[col] === " " || lineContent[col] === "\t")) {
            col--;
          }
          removeStartCol = col + 2; // back to 1-indexed
        }
        return {
          range: {
            startLineNumber: descStartLine,
            startColumn: removeStartCol,
            endLineNumber: descEndLine,
            endColumn: descEndCol,
          },
          text: "",
        };
      }
      return {
        range: {
          startLineNumber: descriptionNode.startPosition.row + 1,
          startColumn: descriptionNode.startPosition.column + 1,
          endLineNumber: descriptionNode.endPosition.row + 1,
          endColumn: descriptionNode.endPosition.column + 1,
        },
        text: `"${escapedDescription}"`, // No leading space when replacing existing description
      };
    } else {
      // No existing description — nothing to remove
      if (newDescription === "") return null;
      // If no description exists, we need to insert it after the identifier/modification
      const identNode = abstractNode?.declaration?.identifier;
      const modificationNode = abstractNode?.declaration?.modification;
      const subscriptsNode = abstractNode?.declaration?.arraySubscripts;

      let pos = null;
      if (modificationNode?.sourceRange) {
        pos = modificationNode.endPosition;
      } else if (subscriptsNode?.sourceRange) {
        pos = subscriptsNode.endPosition;
      } else if (identNode?.sourceRange) {
        pos = identNode.endPosition;
      }

      if (pos) {
        return {
          range: {
            startLineNumber: pos.row + 1,
            startColumn: pos.column + 1,
            endLineNumber: pos.row + 1,
            endColumn: pos.column + 1,
          },
          text: ` "${escapedDescription}"`, // Include leading space only when inserting new description
        };
      }
    }
    return null;
  };

  const getParameterEdit = (
    componentName: string,
    parameterName: string,
    newValue: string,
  ): editor.IIdentifiedSingleEditOperation | null => {
    const instance = diagramClassInstance ?? classInstances[0] ?? null;
    if (!instance || !editor) return null;
    const component = Array.from(instance.components).find((c: any) => c.name === componentName);
    if (!component) return null;

    const abstractNode = (component as any).abstractSyntaxNode;
    if (!abstractNode) return null;

    const declNode = abstractNode.declaration;
    const modification = declNode?.modification;

    const shouldRemove = newValue === "";

    if (modification?.classModification) {
      const classMod = modification.classModification;
      const argIndex = classMod.modificationArguments.findIndex((arg: any) => {
        if (!arg.name) return false;
        const nameText = arg.name.parts.map((p: any) => p.text).join(".");
        return nameText === parameterName;
      });

      if (argIndex !== -1) {
        const existingArg = classMod.modificationArguments[argIndex];
        if (shouldRemove) {
          let startLine = existingArg.startPosition.row + 1;
          let startCol = existingArg.startPosition.column + 1;
          let endLine = existingArg.endPosition.row + 1;
          let endCol = existingArg.endPosition.column + 1;

          const nextArg = classMod.modificationArguments[argIndex + 1];
          if (nextArg) {
            endLine = nextArg.startPosition.row + 1;
            endCol = nextArg.startPosition.column + 1;
          } else if (argIndex > 0) {
            const prevArg = classMod.modificationArguments[argIndex - 1];
            startLine = prevArg.endPosition.row + 1;
            startCol = prevArg.endPosition.column + 1;
          } else {
            // Only argument — remove the entire class modification
            return {
              range: {
                startLineNumber: classMod.startPosition.row + 1,
                startColumn: classMod.startPosition.column + 1,
                endLineNumber: classMod.endPosition.row + 1,
                endColumn: classMod.endPosition.column + 1,
              },
              text: "",
            };
          }

          return {
            range: {
              startLineNumber: startLine,
              startColumn: startCol,
              endLineNumber: endLine,
              endColumn: endCol,
            },
            text: "",
          };
        }

        // Update existing argument value
        const existingMod = existingArg.modification;
        if (existingMod) {
          return {
            range: {
              startLineNumber: existingMod.startPosition.row + 1,
              startColumn: existingMod.startPosition.column + 1,
              endLineNumber: existingMod.endPosition.row + 1,
              endColumn: existingMod.endPosition.column + 1,
            },
            text: `=${newValue}`,
          };
        } else {
          return {
            range: {
              startLineNumber: existingArg.startPosition.row + 1,
              startColumn: existingArg.startPosition.column + 1,
              endLineNumber: existingArg.endPosition.row + 1,
              endColumn: existingArg.endPosition.column + 1,
            },
            text: `${parameterName}=${newValue}`,
          };
        }
      } else {
        // Add new argument to existing modification
        if (shouldRemove) return null;
        const hasArgs = classMod.modificationArguments.length > 0;
        // Insert before the closing paren — use the classModification's end position
        const endPos = classMod.endPosition;
        return {
          range: {
            startLineNumber: endPos.row + 1,
            startColumn: endPos.column, // before the closing paren
            endLineNumber: endPos.row + 1,
            endColumn: endPos.column,
          },
          text: `${hasArgs ? ", " : ""}${parameterName}=${newValue}`,
        };
      }
    } else {
      // No existing modification — insert after identifier
      if (shouldRemove) return null;
      const identNode = declNode?.identifier;
      const subscriptsNode = declNode?.arraySubscripts;
      let pos = null;
      if (subscriptsNode?.sourceRange) {
        pos = subscriptsNode.endPosition;
      } else if (identNode?.sourceRange) {
        pos = identNode.endPosition;
      }

      if (pos) {
        return {
          range: {
            startLineNumber: pos.row + 1,
            startColumn: pos.column + 1,
            endLineNumber: pos.row + 1,
            endColumn: pos.column + 1,
          },
          text: `(${parameterName}=${newValue})`,
        };
      }
    }
    return null;
  };

  const getPlacementEdit = (
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
  ): editor.IIdentifiedSingleEditOperation | null => {
    const instance = diagramClassInstance ?? classInstances[0] ?? null;
    if (!instance || !editor) return null;

    const component = instance.components ? Array.from(instance.components).find((c) => c.name === name) : null;

    if (!component) return null;
    const originX = Math.round(x + width / 2);
    const originY = Math.round(-(y + height / 2));
    const w = Math.round(width);
    const h = Math.round(height);
    const r = Math.round(-(rotation ?? 0));
    const abstractNode = (component as any).abstractSyntaxNode;
    if (abstractNode?.sourceRange) {
      const node = abstractNode;
      const startLine = node.startPosition.row + 1;
      const startCol = node.startPosition.column + 1;
      const endLine = node.endPosition.row + 1;
      const endCol = node.endPosition.column + 1;

      const range = {
        startLineNumber: startLine,
        startColumn: startCol,
        endLineNumber: endLine,
        endColumn: endCol,
      };

      const text = editor.getModel()?.getValueInRange(range) || "";

      // Validate extracted text contains the component name (guards against stale AST positions)
      if (!text.includes(name)) return null;

      const rotationPart = r !== 0 ? `, rotation=${r}` : "";
      // Detect flip from the original extent in the source text
      let flipX = false;
      let flipY = false;
      const extentMatch = text.match(
        /extent\s*=\s*\{\{\s*([^,]+)\s*,\s*([^}]+)\}\s*,\s*\{\s*([^,]+)\s*,\s*([^}]+)\}\}/,
      );
      if (extentMatch) {
        const [, x1s, y1s, x2s, y2s] = extentMatch;
        const ox1 = parseFloat(x1s);
        const oy1 = parseFloat(y1s);
        const ox2 = parseFloat(x2s);
        const oy2 = parseFloat(y2s);
        if (!isNaN(ox1) && !isNaN(ox2)) flipX = ox1 > ox2;
        if (!isNaN(oy1) && !isNaN(oy2)) flipY = oy1 > oy2;
      }
      const ex1 = flipX ? w / 2 : -(w / 2);
      const ex2 = flipX ? -(w / 2) : w / 2;
      const ey1 = flipY ? h / 2 : -(h / 2);
      const ey2 = flipY ? -(h / 2) : h / 2;
      const newTransformationCore = `origin={${originX},${originY}}, extent={{${ex1},${ey1}},{${ex2},${ey2}}}${rotationPart}`;
      const newPlacement = `Placement(transformation(${newTransformationCore}))`;

      const annotationMatch = text.match(/annotation\s*\(/);
      if (annotationMatch) {
        const annStart = annotationMatch.index!;
        const annContentStart = annStart + annotationMatch[0].length;
        let nesting = 0;
        let annEndIndex = -1;
        for (let i = annContentStart; i < text.length; i++) {
          if (text[i] === "(") nesting++;
          else if (text[i] === ")") {
            if (nesting === 0) {
              annEndIndex = i;
              break;
            }
            nesting--;
          }
        }

        if (annEndIndex !== -1) {
          let annotationContent = text.substring(annContentStart, annEndIndex);

          // Remove any existing Placement(...) from annotation content
          const placementMatch = annotationContent.match(/Placement\s*\(/);
          if (placementMatch) {
            const pStart = placementMatch.index!;
            const pInner = pStart + placementMatch[0].length;
            let pNesting = 0;
            let pEnd = -1;
            for (let i = pInner; i < annotationContent.length; i++) {
              if (annotationContent[i] === "(") pNesting++;
              else if (annotationContent[i] === ")") {
                if (pNesting === 0) {
                  pEnd = i;
                  break;
                }
                pNesting--;
              }
            }
            if (pEnd !== -1) {
              const before = annotationContent.substring(0, pStart);
              const after = annotationContent.substring(pEnd + 1);
              if (before.trimEnd().endsWith(",")) {
                annotationContent = before.trimEnd().slice(0, -1).trimEnd() + after;
              } else if (after.trimStart().startsWith(",")) {
                annotationContent = before + after.trimStart().slice(1).trimStart();
              } else {
                annotationContent = before + after;
              }
            }
          }

          // Re-insert Placement with new data
          const trimmed = annotationContent.trim();
          const separator = trimmed.length > 0 ? ", " : "";
          const newText =
            text.substring(0, annContentStart) + newPlacement + separator + trimmed + text.substring(annEndIndex);
          if (newText !== text) {
            return { range, text: newText };
          }
        }
      } else {
        const semiIndex = text.lastIndexOf(";");
        if (semiIndex !== -1) {
          const insert = ` annotation(${newPlacement})`;
          const newText = text.slice(0, semiIndex) + insert + text.slice(semiIndex);
          return { range, text: newText };
        } else {
          const insert = ` annotation(${newPlacement})`;
          const newText = text + insert;
          return { range, text: newText };
        }
      }
    }
    return null;
  };

  const getConnectEdits = (
    edges: { source: string; target: string; points: { x: number; y: number }[] }[],
  ): Map<string, editor.IIdentifiedSingleEditOperation> => {
    const edits = new Map<string, editor.IIdentifiedSingleEditOperation>();
    const instance = diagramClassInstance ?? classInstances[0] ?? null;
    if (!instance || !editor) return edits;

    for (const edge of edges) {
      const connectEq = Array.from(instance.connectEquations).find((ce: any) => {
        const c1 = ce.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        const c2 = ce.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        return (c1 === edge.source && c2 === edge.target) || (c1 === edge.target && c2 === edge.source);
      });

      if (!connectEq) continue;

      if (connectEq.sourceRange) {
        const node = connectEq;
        // Use a unique key for the map to avoid duplicates
        const key = `${node.startPosition.row}:${node.startPosition.column}`;
        if (edits.has(key)) continue;

        const startLine = node.startPosition.row + 1;
        const startCol = node.startPosition.column + 1;
        const endLine = node.endPosition.row + 1;
        const endCol = node.endPosition.column + 1;

        const range = {
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
        };

        const text = editor.getModel()?.getValueInRange(range) || "";

        // Validate the extracted text is actually a connect equation (guards against stale AST)
        if (!text.match(/^\s*connect\s*\(/)) continue;

        const pointsStr = `{${edge.points.map((p) => `{${p.x},${p.y}}`).join(", ")}}`;
        const newPointsCore = `points=${pointsStr}`;
        const colorCore = "color={0, 0, 255}";
        const newLineAnnotation = `Line(${newPointsCore}, ${colorCore})`;

        let newText = text;
        const annotationMatch = text.match(/annotation\s*\(/);
        if (annotationMatch) {
          // Find the annotation bounds
          const annStartIndex = annotationMatch.index!;
          const annContentStart = annStartIndex + annotationMatch[0].length;
          let nesting = 0;
          let annEndIndex = -1;
          for (let i = annContentStart; i < text.length; i++) {
            if (text[i] === "(") nesting++;
            else if (text[i] === ")") {
              if (nesting === 0) {
                annEndIndex = i;
                break;
              }
              nesting--;
            }
          }
          if (annEndIndex !== -1) {
            let annotationContent = text.substring(annContentStart, annEndIndex);
            // Remove any existing Line(...) from annotation content
            const lineMatch = annotationContent.match(/Line\s*\(/);
            if (lineMatch) {
              const lineStart = lineMatch.index!;
              const lineInner = lineStart + lineMatch[0].length;
              let lNesting = 0;
              let lineEnd = -1;
              for (let i = lineInner; i < annotationContent.length; i++) {
                if (annotationContent[i] === "(") lNesting++;
                else if (annotationContent[i] === ")") {
                  if (lNesting === 0) {
                    lineEnd = i;
                    break;
                  }
                  lNesting--;
                }
              }
              if (lineEnd !== -1) {
                // Remove the Line(...) and any leading/trailing comma+whitespace
                let removeStart = lineStart;
                let removeEnd = lineEnd + 1;
                // Remove leading comma+space
                const before = annotationContent.substring(0, removeStart);
                const after = annotationContent.substring(removeEnd);
                if (before.trimEnd().endsWith(",")) {
                  annotationContent = before.trimEnd().slice(0, -1).trimEnd() + after;
                } else if (after.trimStart().startsWith(",")) {
                  annotationContent = before + after.trimStart().slice(1).trimStart();
                } else {
                  annotationContent = before + after;
                }
              }
            }
            // Re-insert the Line with new data
            const trimmed = annotationContent.trim();
            const separator = trimmed.length > 0 ? ", " : "";
            newText =
              text.substring(0, annContentStart) +
              trimmed +
              separator +
              newLineAnnotation +
              text.substring(annEndIndex);
          }
        } else {
          // No annotation at all: insert before the semicolon
          const semiIndex = text.lastIndexOf(";");
          const insert = ` annotation(${newLineAnnotation})`;
          if (semiIndex !== -1) {
            newText = text.slice(0, semiIndex) + insert + text.slice(semiIndex);
          } else {
            newText = text + insert;
          }
        }

        if (newText !== text) {
          edits.set(key, { range, text: newText });
        }
      }
    }
    return edits;
  };

  const handleEdgeDelete = (source: string, target: string) => {
    const activeInstance = diagramClassInstance ?? classInstances[0];
    if (!activeInstance || !editor) return;
    const connectEq = Array.from(activeInstance.connectEquations).find((ce: any) => {
      const c1 = ce.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
      const c2 = ce.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
      return (c1 === source && c2 === target) || (c1 === target && c2 === source);
    });
    if (!connectEq) return;
    if (connectEq.sourceRange) {
      const node = connectEq;
      const startLine = node.startPosition.row + 1;
      const startCol = node.startPosition.column + 1;
      const endLine = node.endPosition.row + 1;
      const endCol = node.endPosition.column + 1;
      let range = {
        startLineNumber: startLine,
        startColumn: startCol,
        endLineNumber: endLine,
        endColumn: endCol,
      };

      const model = editor.getModel();
      if (model) {
        const startLineContent = model.getLineContent(startLine);
        const prefix = startLineContent.substring(0, startCol - 1).trim();
        const endLineContent = model.getLineContent(endLine);
        const suffix = endLineContent.substring(endCol - 1).trim();

        if (prefix === "" && suffix === "") {
          if (endLine < model.getLineCount()) {
            range = {
              startLineNumber: startLine,
              startColumn: 1,
              endLineNumber: endLine + 1,
              endColumn: 1,
            };
          } else {
            range = {
              startLineNumber: startLine,
              startColumn: 1,
              endLineNumber: endLine,
              endColumn: model.getLineMaxColumn(endLine),
            };
          }
        }
      }

      isDiagramUpdate.current = true;
      editor.pushUndoStop();
      editor.executeEdits("delete-connect", [{ range, text: "" }]);
      editor.pushUndoStop();
    }
  };

  const handleComponentDelete = (name: string) => {
    handleComponentsDelete([name]);
  };

  const handleComponentsDelete = (names: string[]) => {
    const activeInstance = diagramClassInstance ?? classInstances[0];
    if (!activeInstance || !editor) return;

    const edits: editor.IIdentifiedSingleEditOperation[] = [];
    const model = editor.getModel();
    const nameSet = new Set(names);

    if (model) {
      // Collect connect equation edits for all components
      Array.from(activeInstance.connectEquations).forEach((ce: any) => {
        const c1 = ce.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        const c2 = ce.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        const involvesComponent = [...nameSet].some(
          (name) => c1 === name || c1.startsWith(`${name}.`) || c2 === name || c2.startsWith(`${name}.`),
        );
        if (involvesComponent) {
          if (ce.sourceRange) {
            const node = ce;
            const startLine = node.startPosition.row + 1;
            const startCol = node.startPosition.column + 1;
            const endLine = node.endPosition.row + 1;
            const endCol = node.endPosition.column + 1;
            let range = {
              startLineNumber: startLine,
              startColumn: startCol,
              endLineNumber: endLine,
              endColumn: endCol,
            };
            const startLineContent = model.getLineContent(startLine);
            const prefix = startLineContent.substring(0, startCol - 1).trim();
            const endLineContent = model.getLineContent(endLine);
            const suffix = endLineContent.substring(endCol - 1).trim();
            if (prefix === "" && suffix === "") {
              if (endLine < model.getLineCount()) {
                range = {
                  startLineNumber: startLine,
                  startColumn: 1,
                  endLineNumber: endLine + 1,
                  endColumn: 1,
                };
              } else {
                range = {
                  startLineNumber: startLine,
                  startColumn: 1,
                  endLineNumber: endLine,
                  endColumn: model.getLineMaxColumn(endLine),
                };
              }
            }
            edits.push({ range, text: "" });
          }
        }
      });
    }

    // Collect component declaration edits for all components
    for (const name of names) {
      const component = Array.from(activeInstance.components).find((c) => c.name === name);
      if (!component) continue;
      const node = component.abstractSyntaxNode?.parent;
      if (node instanceof ModelicaComponentClauseSyntaxNode) {
        if (node.componentDeclarations.length <= 1 && node.sourceRange) {
          const startLine = node.startPosition.row + 1;
          const startCol = node.startPosition.column + 1;
          const endLine = node.endPosition.row + 1;
          const endCol = node.endPosition.column + 1;
          let range = {
            startLineNumber: startLine,
            startColumn: startCol,
            endLineNumber: endLine,
            endColumn: endCol,
          };
          if (model) {
            const startLineContent = model.getLineContent(startLine);
            const prefix = startLineContent.substring(0, startCol - 1).trim();
            const endLineContent = model.getLineContent(endLine);
            const suffix = endLineContent.substring(endCol - 1).trim();
            if (prefix === "" && suffix === "") {
              if (endLine < model.getLineCount()) {
                range = {
                  startLineNumber: startLine,
                  startColumn: 1,
                  endLineNumber: endLine + 1,
                  endColumn: 1,
                };
              } else {
                range = {
                  startLineNumber: startLine,
                  startColumn: 1,
                  endLineNumber: endLine,
                  endColumn: model.getLineMaxColumn(endLine),
                };
              }
            }
          }
          edits.push({ range, text: "" });
        } else if (node.componentDeclarations.length >= 1) {
          const index = node.componentDeclarations.findIndex((c) => c.declaration?.identifier?.text === name);
          const componentDeclaration = node.componentDeclarations[index];
          if (componentDeclaration?.sourceRange) {
            let startLine = componentDeclaration.startPosition.row + 1;
            let startCol = componentDeclaration.startPosition.column + 1;
            let endLine = componentDeclaration.endPosition.row + 1;
            let endCol = componentDeclaration.endPosition.column + 1;

            if (index > 0) {
              const prevDecl = node.componentDeclarations[index - 1];
              if (prevDecl.sourceRange) {
                startLine = prevDecl.endPosition.row + 1;
                startCol = prevDecl.endPosition.column + 1;
              }
            } else if (node.componentDeclarations.length > 1) {
              const nextDecl = node.componentDeclarations[1];
              if (nextDecl.sourceRange) {
                endLine = nextDecl.startPosition.row + 1;
                endCol = nextDecl.startPosition.column + 1;
              }
            }
            let range = {
              startLineNumber: startLine,
              startColumn: startCol,
              endLineNumber: endLine,
              endColumn: endCol,
            };
            if (model) {
              const startLineContent = model.getLineContent(startLine);
              const prefix = startLineContent.substring(0, startCol - 1).trim();
              const endLineContent = model.getLineContent(endLine);
              const suffix = endLineContent.substring(endCol - 1).trim();
              if (prefix === "" && suffix === "") {
                if (endLine < model.getLineCount()) {
                  range = {
                    startLineNumber: startLine,
                    startColumn: 1,
                    endLineNumber: endLine + 1,
                    endColumn: 1,
                  };
                } else {
                  range = {
                    startLineNumber: startLine,
                    startColumn: 1,
                    endLineNumber: endLine,
                    endColumn: model.getLineMaxColumn(endLine),
                  };
                }
              }
            }
            edits.push({ range, text: "" });
          }
        }
      }
    }
    if (edits.length > 0) {
      isDiagramUpdate.current = true;
      editor.pushUndoStop();
      editor.executeEdits("delete-component", edits);
      editor.pushUndoStop();
      // Force immediate re-parse to update classInstance and component list
      codeEditorRef.current?.sync();
    }
  };

  const handleFlatten = async () => {
    if (!codeEditorRef.current) return;
    const instances = await codeEditorRef.current.sync();
    // Filter to only MODEL/BLOCK instances, matching the nestedModels tab logic.
    // instances includes ALL classes (functions, packages, etc.), so we must filter
    // to select the correct model corresponding to the active tab.
    const models = instances.filter(
      (i) => i.classKind === ModelicaClassKind.MODEL || i.classKind === ModelicaClassKind.BLOCK,
    );
    const instance = models[selectedModelIndex] ?? models[0];
    if (!instance) return;

    if (!instance.instantiated) {
      instance.instantiate();
    }

    try {
      const dae = new ModelicaDAE(instance.name || "Model");
      const flattener = new ModelicaFlattener();
      instance.accept(flattener, ["", dae]);
      flattener.generateFlowBalanceEquations(dae);
      flattener.foldDAEConstants(dae);

      const writer = new StringWriter();
      const printer = new ModelicaDAEPrinter(writer);
      dae.accept(printer);

      setFlattenedCode(writer.toString());
      setFlattenDialogOpen(true);
    } catch (e) {
      console.error("Flattening failed:", e);
      alert("Failed to flatten model: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleSimulate = async (type: "server" | "local" = "server") => {
    if (!codeEditorRef.current || !context) return;
    const instances = await codeEditorRef.current.sync();
    const instance = diagramClassInstance ?? instances[0];
    if (!instance) return;

    if (!instance.instantiated) {
      instance.instantiate();
    }

    setSimulationStatus({ status: "pending", error: null });
    setSimulationJobId(null);
    setLocalSimulationData(null);
    setSimulationVariables([]);
    setSelectedSimulationVariables([]);

    if (type === "server") {
      setSimulateDialogOpen(true);
    }

    // We do NOT set showResultsView(false) here because if the user is typing
    // while in Local mode with Results view open, hiding and showing the results
    // would cause UI flicker AND an infinite React useEffect dependency loop!

    if (type === "local") {
      simulateAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      simulateAbortControllerRef.current = abortController;

      try {
        const dae = new ModelicaDAE(instance.name || "Model");
        const flattener = new ModelicaFlattener();
        instance.accept(flattener, ["", dae]);
        flattener.generateFlowBalanceEquations(dae);
        flattener.foldDAEConstants(dae);

        const simulator = new ModelicaSimulator(dae);
        simulator.prepare();
        cachedSimulatorRef.current = simulator;
        setSimulationParameters(simulator.getParameterInfo());
        setParameterOverrides(new Map());
        const states = Array.from(simulator.stateVars);

        if (states.length === 0) {
          throw new Error(
            "No simulation variables are available to plot for this model. Ensure you have equations defining state variables or parameters.",
          );
        }

        const exp2 = simulator.dae.experiment;
        const startTime2 = exp2.startTime ?? 0;
        const stopTime2 = exp2.stopTime ?? 10;
        const step2 = exp2.interval ?? (stopTime2 - startTime2) / 100;
        const result = await simulator.simulate(startTime2, stopTime2, step2, {
          signal: abortController.signal,
          parameterOverrides,
        });

        const chartData = result.t.map((t: number, i: number) => {
          const row: Record<string, number | string> = { time: t };
          result.states?.forEach((state: string, vIndex: number) => {
            row[state] = result.y[i]?.[vIndex] ?? 0;
          });
          return row;
        });

        setLocalSimulationData(chartData);
        setSimulationStatus({ status: "completed" });
        setSimulateDialogOpen(false);
        setShowResultsView(true);
        return;
      } catch (e: any) {
        if (e.message === "Simulation aborted") {
          return;
        }
        setSimulationStatus({ status: "failed", error: e instanceof Error ? e.message : String(e) });
        setShowResultsView(true);
        return;
      }
    }

    const dependencies = Array.from(context.listLibraries()).map((lib) => ({
      name: lib.name,
      version: lib.entity.annotation<string>("version") || "0.0.0", // Fallback version
    }));

    try {
      const response = await fetch("/api/v1/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: instance.compositeName || "Model",
          modelSource: editor?.getValue(),
          dependencies,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { jobId } = await response.json();
      setSimulationJobId(jobId);

      // Start polling
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/simulate/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            setSimulationStatus(data);
            if (data.status === "completed") {
              clearInterval(simulationIntervalRef.current!);
              setSimulateDialogOpen(false);
              setShowResultsView(true);
            } else if (data.status === "failed") {
              clearInterval(simulationIntervalRef.current!);
              alert(`Simulation failed: ${data.error}`);
            }
          } else if (res.status === 404) {
            setSimulationStatus({
              status: "failed",
              error: "Simulation job not found. The server may have been restarted.",
            });
            clearInterval(simulationIntervalRef.current!);
            alert("Simulation job not found. The server may have been restarted.");
          } else {
            // Handle other non-ok responses during polling
            const errorText = await res.text();
            setSimulationStatus({
              status: "failed",
              error: `Simulation polling failed: ${res.status} ${res.statusText} - ${errorText}`,
            });
            clearInterval(simulationIntervalRef.current!);
            alert(`Simulation polling failed: ${res.status} ${res.statusText} - ${errorText}`);
          }
        } catch (err) {
          console.error("Polling simulation status failed:", err);
          const error = `Simulation polling failed due to network error: ${err instanceof Error ? err.message : String(err)}`;
          setSimulationStatus({ status: "failed", error });
          clearInterval(simulationIntervalRef.current!);
          alert(error);
        }
      }, 1000) as any;
    } catch (e) {
      console.error("Simulation failed:", e);
      setSimulationStatus({ status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <title>
        {(nestedModels[selectedModelIndex] ?? nestedModels[0])?.name
          ? `${(nestedModels[selectedModelIndex] ?? nestedModels[0])?.name} - Morsel`
          : "Morsel"}
      </title>
      <div className="d-flex flex-column" style={{ height: "100vh", overflow: "hidden" }}>
        <div className="d-flex flex-1" style={{ minHeight: 0 }}>
          {treeVisible && (
            <>
              <div style={{ width: treeWidth, display: "flex", flexDirection: "column", minWidth: 200, maxWidth: 600 }}>
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
                        key={debouncedFilter ? "filtered" : "unfiltered"}
                        context={context}
                        onSelect={handleTreeSelect}
                        onHighlight={setSelectedTreeClassName}
                        width="100%"
                        filter={debouncedFilter}
                        version={contextVersion}
                        language={language}
                        selectedClassName={selectedTreeClassName}
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
                      classInstance={diagramClassInstance}
                      onSelect={(name) => {
                        if (!diagramClassInstance) return;
                        const component = Array.from(diagramClassInstance.components).find((c) => c.name === name);
                        setSelectedComponent(component || null);
                        if (name) {
                          codeEditorRef.current?.revealComponent(name, diagramClassInstance);
                        }
                      }}
                      selectedName={selectedComponent?.name}
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
                        key={model.compositeName ?? index}
                        onClick={() => {
                          setSelectedModelIndex(index);
                          model.instantiate();
                          setDiagramClassInstance(model);
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
                          {model.name ?? `Model ${index + 1}`}
                        </span>
                        <span style={{ gridArea: "1 / 1" }}>{model.name ?? `Model ${index + 1}`}</span>
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
                  <SegmentedControl aria-label="Center Pane View" onChange={(i) => setShowResultsView(i === 1)}>
                    <SegmentedControl.Button selected={!showResultsView} leadingVisual={WorkflowIcon}>
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
                      visibility: !showResultsView ? "visible" : "hidden",
                      opacity: !showResultsView ? 1 : 0,
                      pointerEvents: !showResultsView ? "auto" : "none",
                      zIndex: !showResultsView ? 1 : 0,
                    }}
                  >
                    <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                      <Suspense fallback={null}>
                        <DiagramEditor
                          ref={diagramEditorRef}
                          classInstance={diagramClassInstance}
                          selectedName={selectedComponent?.name}
                          theme={colorMode === "dark" ? "vs-dark" : "light"}
                          onSelect={(name) => {
                            if (!name) {
                              setSelectedComponent(null);
                            } else {
                              const searchInstance = diagramClassInstance ?? classInstances[0];
                              const component = searchInstance?.components
                                ? Array.from(searchInstance.components).find((c) => c.name === name)
                                : null;
                              setSelectedComponent(component || null);
                              codeEditorRef.current?.revealComponent(name, searchInstance);
                            }
                          }}
                          onDrop={(className, x, y) => {
                            const dropTarget = diagramClassInstance ?? classInstances[0];
                            if (!dropTarget || !editor) return;
                            isDiagramUpdate.current = true;

                            // Try to get the defaultComponentName annotation from the dropped class
                            const shortName = className.split(".").pop() || "component";
                            let baseName = shortName.toLowerCase();
                            try {
                              const droppedClass = context?.query(className);
                              if (droppedClass instanceof ModelicaClassInstance) {
                                const defaultName = droppedClass.annotation<string>("defaultComponentName");
                                if (defaultName) {
                                  baseName = droppedClass.translate(defaultName);
                                } else {
                                  baseName = droppedClass.localizedName.toLowerCase();
                                }
                              }
                            } catch {
                              // query may throw during lazy instantiation; proceed with default baseName
                            }

                            let name = baseName;
                            let i = 1;
                            const existingNames = new Set(Array.from(dropTarget.components).map((c) => c.name));
                            while (existingNames.has(name)) {
                              name = `${baseName}${i}`;
                              i++;
                            }

                            const diagram: IDiagram | null = dropTarget.annotation("Diagram");
                            const initialScale = diagram?.coordinateSystem?.initialScale ?? 0.1;
                            const extent = diagram?.coordinateSystem?.extent;

                            let width = 200;
                            let height = 200;

                            if (extent && extent.length >= 2) {
                              width = Math.abs(extent[1][0] - extent[0][0]);
                              height = Math.abs(extent[1][1] - extent[0][1]);
                            }

                            const w = width * initialScale;
                            const h = height * initialScale;

                            const annotation = `annotation(Placement(transformation(origin={${Math.round(x)},${-Math.round(y)}}, extent={{-${w / 2},-${h / 2}},{${w / 2},${h / 2}}})))`;
                            const componentDecl = `  ${className} ${name} ${annotation};\n`;

                            const model = editor.getModel();
                            if (model) {
                              // Scope the search to the target model's syntax range
                              const astNode = (dropTarget as any).abstractSyntaxNode;
                              const modelStartLine = astNode?.sourceRange ? astNode.startPosition.row : 0;
                              const modelEndLine = astNode?.sourceRange
                                ? astNode.endPosition.row
                                : model.getLineCount() - 1;

                              const keywords = [
                                "protected",
                                "initial equation",
                                "initial algorithm",
                                "equation",
                                "algorithm",
                                "end",
                              ];
                              let insertLine = -1;
                              const text = model.getValue();
                              const lines = text.split("\n");
                              for (let i = modelStartLine; i <= modelEndLine; i++) {
                                const line = lines[i].trim();
                                if (keywords.some((kw) => line.startsWith(kw))) {
                                  insertLine = i;
                                  break;
                                }
                              }
                              if (insertLine !== -1) {
                                let range = {
                                  startLineNumber: insertLine + 1,
                                  startColumn: 1,
                                  endLineNumber: insertLine + 1,
                                  endColumn: 1,
                                };
                                if (insertLine > modelStartLine && lines[insertLine - 1].trim() === "") {
                                  range.startLineNumber = insertLine;
                                  range.endLineNumber = insertLine + 1;
                                }
                                editor.pushUndoStop();
                                editor.executeEdits("dnd", [
                                  {
                                    range: range,
                                    text: componentDecl,
                                  },
                                ]);
                                editor.pushUndoStop();
                              } else {
                                // Find the last "end" within this model's range
                                const modelText = lines.slice(modelStartLine, modelEndLine + 1).join("\n");
                                const lastEndIndex = modelText.lastIndexOf("end");
                                if (lastEndIndex !== -1) {
                                  // Convert offset within modelText back to global line number
                                  const linesBeforeEnd = modelText.substring(0, lastEndIndex).split("\n").length - 1;
                                  const endLineNumber = modelStartLine + linesBeforeEnd + 1; // 1-indexed
                                  const endLineContent = lines[modelStartLine + linesBeforeEnd];
                                  const endCol = endLineContent.lastIndexOf("end");
                                  const beforeEnd = endLineContent.substring(0, endCol).trimEnd();

                                  if (beforeEnd !== "") {
                                    // Single-line model: insert at the "end" keyword column with newlines
                                    editor.pushUndoStop();
                                    editor.executeEdits("dnd", [
                                      {
                                        range: {
                                          startLineNumber: endLineNumber,
                                          startColumn: endCol + 1,
                                          endLineNumber: endLineNumber,
                                          endColumn: endCol + 1,
                                        },
                                        text: "\n" + componentDecl,
                                      },
                                    ]);
                                    editor.pushUndoStop();
                                  } else {
                                    let range = {
                                      startLineNumber: endLineNumber,
                                      startColumn: 1,
                                      endLineNumber: endLineNumber,
                                      endColumn: 1,
                                    };
                                    if (endLineNumber > 1) {
                                      const prevLineContent = model.getLineContent(endLineNumber - 1);
                                      if (prevLineContent.trim() === "") {
                                        range.startLineNumber = endLineNumber - 1;
                                        range.endLineNumber = endLineNumber;
                                      }
                                    }
                                    editor.pushUndoStop();
                                    editor.executeEdits("dnd", [
                                      {
                                        range: range,
                                        text: componentDecl,
                                      },
                                    ]);
                                    editor.pushUndoStop();
                                  }
                                }
                              }
                            }
                          }}
                          onConnect={(source, target, points) => {
                            const connectTarget = diagramClassInstance ?? classInstances[0];
                            if (!connectTarget || !editor) return;
                            isDiagramUpdate.current = true;

                            const annotation = points
                              ? ` annotation(Line(points={${points.map((p) => `{${p.x},${p.y}}`).join(", ")}}, color={0, 0, 255}))`
                              : " annotation(Line(color={0, 0, 255}))";
                            const connectEq = `  connect(${source}, ${target})${annotation};\n`;
                            const model = editor.getModel();
                            if (!model) return;

                            // Scope the search to the target model's syntax range
                            const astNode = (connectTarget as any).abstractSyntaxNode;
                            const modelStartLine = astNode?.sourceRange ? astNode.startPosition.row + 1 : 1;
                            const modelEndLine = astNode?.sourceRange
                              ? astNode.endPosition.row + 1
                              : model.getLineCount();
                            const searchRange = {
                              startLineNumber: modelStartLine,
                              startColumn: 1,
                              endLineNumber: modelEndLine,
                              endColumn: model.getLineMaxColumn(modelEndLine),
                            };

                            const equationMatches = model.findMatches("equation", searchRange, false, true, null, true);
                            if (equationMatches.length > 0) {
                              const startLine = equationMatches[0].range.startLineNumber;
                              const text = model.getValue();
                              const lines = text.split("\n");
                              let insertLine = -1;
                              for (let i = startLine; i < modelEndLine; i++) {
                                const line = lines[i].trim();
                                if (
                                  line.startsWith("public") ||
                                  line.startsWith("protected") ||
                                  line.startsWith("initial equation") ||
                                  line.startsWith("algorithm") ||
                                  line.startsWith("annotation") ||
                                  line.startsWith("end")
                                ) {
                                  insertLine = i;
                                  break;
                                }
                              }
                              if (insertLine !== -1) {
                                editor.pushUndoStop();
                                editor.executeEdits("connect", [
                                  {
                                    range: {
                                      startLineNumber: insertLine + 1,
                                      startColumn: 1,
                                      endLineNumber: insertLine + 1,
                                      endColumn: 1,
                                    },
                                    text: connectEq,
                                  },
                                ]);
                                editor.pushUndoStop();
                                return;
                              }
                            }
                            const endMatches = model.findMatches(
                              "^\\s*end\\s+[^;]+;",
                              searchRange,
                              true,
                              false,
                              null,
                              true,
                            );
                            if (endMatches.length > 0) {
                              const lastEnd = endMatches[endMatches.length - 1];
                              const text = model.getValue();
                              const lines = text.split("\n");
                              let insertLine = lastEnd.range.startLineNumber - 1;

                              // Look backwards for annotation before end
                              for (let i = insertLine - 1; i >= modelStartLine - 1; i--) {
                                const line = lines[i].trim();
                                if (line.startsWith("annotation")) {
                                  insertLine = i;
                                } else if (line !== "") {
                                  break;
                                }
                              }

                              const insertText = equationMatches.length === 0 ? `equation\n${connectEq}` : connectEq;
                              editor.pushUndoStop();
                              editor.executeEdits("connect", [
                                {
                                  range: {
                                    startLineNumber: insertLine + 1,
                                    startColumn: 1,
                                    endLineNumber: insertLine + 1,
                                    endColumn: 1,
                                  },
                                  text: insertText,
                                },
                              ]);
                              editor.pushUndoStop();
                              return;
                            }
                            // Fallback: find last "end" within model range
                            const text = model.getValue();
                            const lines = text.split("\n");
                            const modelLines = lines.slice(modelStartLine - 1, modelEndLine);
                            const modelText = modelLines.join("\n");
                            const lastEndIndex = modelText.lastIndexOf("end");
                            if (lastEndIndex !== -1) {
                              const linesBeforeEnd = modelText.substring(0, lastEndIndex).split("\n").length - 1;
                              const endLineNumber = modelStartLine + linesBeforeEnd;
                              const insertText = equationMatches.length === 0 ? `equation\n${connectEq}` : connectEq;
                              editor.pushUndoStop();
                              editor.executeEdits("connect", [
                                {
                                  range: {
                                    startLineNumber: endLineNumber,
                                    startColumn: 1,
                                    endLineNumber: endLineNumber,
                                    endColumn: 1,
                                  },
                                  text: insertText,
                                },
                              ]);
                              editor.pushUndoStop();
                            }
                          }}
                          onMove={(items) => {
                            if ((!diagramClassInstance && !classInstances[0]) || !editor) return;
                            isDiagramUpdate.current = true;
                            const edits: editor.IIdentifiedSingleEditOperation[] = [];
                            const allEdges: any[] = [];
                            items.forEach((item) => {
                              if (item.connectedOnly) {
                                // Only add placement for connected components that don't already have one
                                const instance = diagramClassInstance ?? classInstances[0] ?? null;
                                if (instance) {
                                  const component = instance.components
                                    ? Array.from(instance.components).find((c) => c.name === item.name)
                                    : null;
                                  if (component) {
                                    const abstractNode = (component as any).abstractSyntaxNode;
                                    if (abstractNode?.sourceRange) {
                                      const text =
                                        editor.getModel()?.getValueInRange({
                                          startLineNumber: abstractNode.startPosition.row + 1,
                                          startColumn: abstractNode.startPosition.column + 1,
                                          endLineNumber: abstractNode.endPosition.row + 1,
                                          endColumn: abstractNode.endPosition.column + 1,
                                        }) || "";
                                      if (/Placement\s*\(/.test(text)) return; // already has Placement
                                    }
                                  }
                                }
                                const edit = getPlacementEdit(
                                  item.name,
                                  item.x,
                                  item.y,
                                  item.width,
                                  item.height,
                                  item.rotation,
                                );
                                if (edit) edits.push(edit);
                              } else {
                                const edit = getPlacementEdit(
                                  item.name,
                                  item.x,
                                  item.y,
                                  item.width,
                                  item.height,
                                  item.rotation,
                                );
                                if (edit) edits.push(edit);
                                if (item.edges) allEdges.push(...item.edges);
                              }
                            });

                            if (allEdges.length > 0) {
                              const edgeEdits = getConnectEdits(allEdges);
                              edgeEdits.forEach((edit) => edits.push(edit));
                            }

                            if (edits.length > 0) {
                              // Sort edits by position (descending) and remove overlaps
                              edits.sort((a, b) => {
                                if (a.range.startLineNumber !== b.range.startLineNumber)
                                  return a.range.startLineNumber - b.range.startLineNumber;
                                return a.range.startColumn - b.range.startColumn;
                              });
                              const filtered = edits.filter((edit, i) => {
                                if (i === 0) return true;
                                const prev = edits[i - 1];
                                // Skip if this edit starts before the previous one ends
                                if (
                                  edit.range.startLineNumber < prev.range.endLineNumber ||
                                  (edit.range.startLineNumber === prev.range.endLineNumber &&
                                    edit.range.startColumn < prev.range.endColumn)
                                ) {
                                  return false;
                                }
                                return true;
                              });
                              if (filtered.length > 0) {
                                editor.pushUndoStop();
                                editor.executeEdits("move", filtered);
                                editor.pushUndoStop();
                              }
                            }
                          }}
                          onResize={(name, x, y, width, height, rotation, edges) => {
                            if ((!diagramClassInstance && !classInstances[0]) || !editor) return;
                            isDiagramUpdate.current = false;
                            const edits: editor.IIdentifiedSingleEditOperation[] = [];
                            const edit = getPlacementEdit(name, x, y, width, height, rotation);
                            if (edit) edits.push(edit);
                            if (edges) {
                              const edgeEdits = getConnectEdits(edges);
                              edgeEdits.forEach((edit) => edits.push(edit));
                            }
                            if (edits.length > 0) {
                              edits.sort((a, b) => {
                                if (a.range.startLineNumber !== b.range.startLineNumber)
                                  return a.range.startLineNumber - b.range.startLineNumber;
                                return a.range.startColumn - b.range.startColumn;
                              });
                              const filtered = edits.filter((edit, i) => {
                                if (i === 0) return true;
                                const prev = edits[i - 1];
                                if (
                                  edit.range.startLineNumber < prev.range.endLineNumber ||
                                  (edit.range.startLineNumber === prev.range.endLineNumber &&
                                    edit.range.startColumn < prev.range.endColumn)
                                ) {
                                  return false;
                                }
                                return true;
                              });
                              if (filtered.length > 0) {
                                editor.pushUndoStop();
                                editor.executeEdits("resize", filtered);
                                editor.pushUndoStop();
                              }
                            }
                          }}
                          onEdgeMove={(edges) => {
                            if ((!diagramClassInstance && !classInstances[0]) || !editor) return;
                            isDiagramUpdate.current = true;
                            const edgeEdits = getConnectEdits(edges);
                            if (edgeEdits.size > 0) {
                              editor.pushUndoStop();
                              editor.executeEdits("edge-move", Array.from(edgeEdits.values()));
                              editor.pushUndoStop();
                            }
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
                          key={selectedComponent.name || "none"}
                          component={selectedComponent}
                          context={context}
                          width={propertiesWidth}
                          translations={translations}
                          onNameChange={(newName) => {
                            if (!selectedComponent || !editor) return;
                            const edit = getNameEdit(selectedComponent.name!, newName);
                            if (edit) {
                              expectedComponentNameRef.current = newName;
                              editor.pushUndoStop();
                              editor.executeEdits("name-change", [edit]);
                              editor.pushUndoStop();
                            }
                          }}
                          onDescriptionChange={(newDescription) => {
                            if (!selectedComponent || !editor) return;
                            const edit = getDescriptionEdit(selectedComponent.name!, newDescription);
                            if (edit) {
                              editor.pushUndoStop();
                              editor.executeEdits("description-change", [edit]);
                              editor.pushUndoStop();
                            }
                          }}
                          onParameterChange={(name, value) => {
                            if (!selectedComponent || !editor) return;
                            // If the new value matches the parameter's default (from the
                            // declared type), remove the modifier entirely instead of
                            // keeping a redundant explicit override.
                            let effectiveValue = value;
                            const declaredType = selectedComponent.declaredType;
                            if (declaredType) {
                              for (const el of declaredType.elements) {
                                if (el instanceof ModelicaComponentInstance && el.name === name) {
                                  const defaultExpr = (el.modification?.expression as any)?.toJSON?.toString();
                                  if (defaultExpr !== undefined && defaultExpr === value) {
                                    effectiveValue = "";
                                  }
                                  break;
                                }
                              }
                            }
                            const edit = getParameterEdit(selectedComponent.name!, name, effectiveValue);
                            if (edit) {
                              editor.pushUndoStop();
                              editor.executeEdits("parameter-change", [edit]);
                              editor.pushUndoStop();
                              // Trigger immediate reparse so AST is fresh for next edit
                              codeEditorRef.current?.sync();
                            }
                          }}
                        />
                      </>
                    )}
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
                    {(simulationJobId && simulationStatus?.status === "completed") ||
                    localSimulationData ||
                    simulationStatus?.status === "failed" ? (
                      <Suspense fallback={null}>
                        <SimulationResults
                          jobId={simulationJobId}
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
                        {simulationStatus?.status === "pending" || simulationStatus?.status === "processing"
                          ? "Simulation in progress... please wait."
                          : "No simulation results available. Click 'Simulate' to generate results."}
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
                  ref={codeEditorRef}
                  embed={props.embed}
                  context={context}
                  setClassInstances={setClassInstances}
                  setEditor={setEditor}
                  content={content}
                  theme={colorMode === "dark" ? "vs-dark" : "light"}
                  onParseComplete={() => {
                    diagramEditorRef.current?.hideLoading();
                  }}
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
              let filename = classInstances[0]?.name ? `${classInstances[0].name}.mo` : "model.mo";
              if (codeEditorRef.current) {
                const syncedInstances = await codeEditorRef.current.sync();
                if (syncedInstances[0]?.name) {
                  filename = `${syncedInstances[0].name}.mo`;
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
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              border: `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}`,
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            <IconButton
              icon={PlayIcon}
              size="small"
              variant="invisible"
              aria-label={translations.simulateModel}
              title={
                simulationMode === "server"
                  ? `${translations.simulateModel} (OpenModelica)`
                  : `${translations.simulateModel} (math.js)`
              }
              onClick={() => handleSimulate(simulationMode)}
              style={{ borderRadius: 0, paddingRight: 4, paddingLeft: 6 }}
            />
            <div style={{ width: 1, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton
                  icon={TriangleDownIcon}
                  size="small"
                  variant="invisible"
                  aria-label="Simulation mode"
                  title="Simulation mode"
                  style={{ borderRadius: 0, paddingLeft: 4, paddingRight: 6 }}
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay align="end">
                <ActionList selectionVariant="single">
                  <ActionList.Item selected={simulationMode === "server"} onSelect={() => setSimulationMode("server")}>
                    Server Simulation (OpenModelica)
                  </ActionList.Item>
                  <ActionList.Item selected={simulationMode === "local"} onSelect={() => setSimulationMode("local")}>
                    Local Simulation (math.js)
                  </ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
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
                        context?.setLanguage(null);
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
                          context?.setLanguage(lang);
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
                    `${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}`,
                  );
                  alert(translations.copiedToClipboard);
                  setShareDialogOpen(false);
                },
              },
            ]}
          >
            <div
              style={{ wordBreak: "break-all" }}
            >{`${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}`}</div>
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
              if (!context) return;
              try {
                let path: string;
                let data: ArrayBuffer;
                if (type === "file" && item instanceof File) {
                  path = `/usr/${item.name.replace(/\.zip$/i, "")}`;
                  data = await item.arrayBuffer();
                } else if (type === "url") {
                  const url = item as string;
                  let response: Response | undefined;
                  const cache = await caches.open("modelscript-libraries");
                  response = await cache.match(url);

                  if (!response) {
                    try {
                      response = await fetch(url);
                      if (!response.ok) {
                        throw new Error("Direct fetch failed");
                      }
                    } catch (e) {
                      try {
                        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                        response = await fetch(proxyUrl);
                      } catch (proxyError) {
                        throw new Error(
                          `Failed to fetch library from ${url}: ${proxyError instanceof Error ? proxyError.message : String(proxyError)}`,
                          { cause: proxyError },
                        );
                      }
                    }
                    if (!response || !response.ok) {
                      throw new Error(
                        `Failed to fetch library: ${response?.status} ${response?.statusText || "Unknown Error"}`,
                      );
                    }
                    await cache.put(url, response.clone());
                  }
                  data = await response.arrayBuffer();
                  const fileName = url.split("/").pop() || "library.zip";
                  path = `/usr/${fileName.replace(/\.zip$/i, "")}`;
                } else {
                  return;
                }
                await mountLibrary(path, data);
                try {
                  const entries = context.fs.readdir(path);
                  const hasPackage = entries.some((e) => e.name === "package.mo");
                  if (hasPackage) {
                    context.addLibrary(path);
                  } else {
                    const dirs = entries.filter((e) => e.isDirectory());
                    if (dirs.length === 1) {
                      context.addLibrary(`${path}/${dirs[0].name}`);
                    } else {
                      for (const dir of dirs) {
                        const libName = dir.name.split(" ")[0];
                        const libPath = `${path}/${dir.name}`;
                        try {
                          const lib = context.addLibrary(libPath);
                          if (lib) {
                            console.log(`Loaded library: ${libName} from ${libPath}`);
                          }
                        } catch (libError) {
                          console.warn(`Failed to load library ${libName} from ${libPath}:`, libError);
                        }
                      }
                    }
                  }
                } catch (e) {
                  console.error("Failed to process mounted library:", e);
                }
                setContextVersion((v) => v + 1);
              } catch (error) {
                console.error(error);
                alert("Failed to add library: " + (error instanceof Error ? error.message : String(error)));
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
                  content={flattenedCode}
                  context={null}
                  setClassInstances={() => {}}
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
            onClose={() => setSplashVisible(false)}
            onSelect={handleModelSelect}
            recentModels={recentModels}
            exampleModels={exampleModels}
            context={context}
            colorMode={resolvedColorMode}
            onClearRecent={handleClearRecent}
            translations={translations}
          />
        )}
        {isSimulateDialogOpen && (
          <Dialog
            title="Simulation"
            onClose={() => {
              setSimulateDialogOpen(false);
              if (simulationIntervalRef.current) {
                clearInterval(simulationIntervalRef.current);
                simulationIntervalRef.current = null;
              }
            }}
          >
            <div style={{ padding: 20, textAlign: "center", minWidth: 300 }}>
              {simulationStatus?.status === "completed" ? (
                <>
                  <div style={{ marginBottom: 20, color: "#3fb950" }}>Simulation completed successfully!</div>
                  <IconButton
                    icon={DownloadIcon}
                    aria-label="Download Results"
                    onClick={() => {
                      if (simulationJobId) {
                        window.open(`/api/v1/simulate/${simulationJobId}/result`, "_blank");
                      }
                    }}
                  />
                  <div style={{ marginTop: 10 }}>Download Results (.mat)</div>
                </>
              ) : simulationStatus?.status === "failed" ? (
                <>
                  <div style={{ marginBottom: 20, color: "#f85149" }}>Simulation failed</div>
                  <div style={{ fontSize: 12, color: "#8b949e", maxWidth: 400, margin: "0 auto" }}>
                    {simulationStatus.error || "An unknown error occurred."}
                  </div>
                </>
              ) : (
                <>
                  <Spinner size="large" style={{ marginBottom: 20 }} />
                  <div>Simulating {simulationStatus?.status || "pending"}...</div>
                </>
              )}
            </div>
          </Dialog>
        )}
      </div>
    </>
  );
}
