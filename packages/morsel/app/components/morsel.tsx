// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ContentType,
  Context,
  decodeDataUrl,
  encodeDataUrl,
  ModelicaClassInstance,
  ModelicaComponentClauseSyntaxNode,
  ModelicaComponentInstance,
  ModelicaDAE,
  ModelicaDAEPrinter,
  ModelicaEntity,
  ModelicaFlattener,
  StringWriter,
  type IDiagram,
} from "@modelscript/modelscript";
import {
  ColumnsIcon,
  DownloadIcon,
  FileIcon,
  FlowchartIcon,
  GlobeIcon,
  MoonIcon,
  PlusIcon,
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
import { ActionList, ActionMenu, Dialog, IconButton, Spinner, TextInput, useTheme } from "@primer/react";
import { Zip } from "@zenfs/archives";
import { configure, InMemory } from "@zenfs/core";
import { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Parser from "web-tree-sitter";
import { mountLibrary, WebFileSystem } from "~/util/filesystem";
import { getTranslations, uiLanguages } from "~/util/i18n";
import AddLibraryModal from "./add-library-modal";
import CodeEditor, { type CodeEditorHandle } from "./code";
import ComponentList from "./component-list";
import DiagramEditor, { type DiagramEditorHandle } from "./diagram";
import OpenFileDropzone from "./open-file-dropzone";
import PropertiesWidget from "./properties";
import { Splash, type ModelData } from "./splash";
import TreeWidget from "./tree";

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
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const [decodedContent] = decodeDataUrl(props.dataUrl ?? null);
  const content = decodedContent || "model Example\n\nend Example;";
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);
  const [classInstance, setClassInstance] = useState<ModelicaClassInstance | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [view, setView] = useState<View>(View.SPLIT_COLUMNS);
  const [lastLoadedContent, setLastLoadedContent] = useState<string>("");
  const [isDirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<ModelicaClassInstance | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<ModelicaComponentInstance | null>(null);
  const [diagramClassInstance, setDiagramClassInstance] = useState<ModelicaClassInstance | null>(null);
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
  const [isSplashVisible, setSplashVisible] = useState(false);
  const [pendingSplashVisible, setPendingSplashVisible] = useState(false);
  const [recentModels, setRecentModels] = useState<ModelData[]>([]);
  const [exampleModels, setExampleModels] = useState<ModelData[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const translations = useMemo(() => getTranslations(language), [language]);

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

  useEffect(() => {
    const init = async () => {
      setLoadingProgress(10);
      setLoadingMessage("Initializing parser…");
      await Parser.init();
      setLoadingProgress(25);
      setLoadingMessage("Loading Modelica grammar…");
      const Modelica = await Parser.Language.load("/tree-sitter-modelica.wasm");
      const parser = new Parser();
      parser.setLanguage(Modelica);
      Context.registerParser(".mo", parser);

      setLoadingProgress(40);
      setLoadingMessage("Fetching Modelica Standard Library…");
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
        await configure({
          mounts: {
            "/lib": { backend: Zip, data: await ModelicaLibrary.arrayBuffer() },
            "/tmp": InMemory,
          },
        });
      } catch (e) {
        console.error(e);
      }

      setLoadingProgress(80);
      setLoadingMessage("Loading libraries…");
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

      setLoadingProgress(100);
      setLoadingMessage("Ready");
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
    if (classInstance && (selectedComponent || expectedComponentNameRef.current)) {
      const nameToFind = expectedComponentNameRef.current || selectedComponent?.name;
      const next = Array.from(classInstance.components).find((c: any) => c.name === nameToFind);
      setSelectedComponent((next as ModelicaComponentInstance) || null);
      expectedComponentNameRef.current = null;
    } else {
      setSelectedComponent(null);
    }

    if (!isDiagramUpdate.current) {
      setDiagramClassInstance(classInstance);
    }
    isDiagramUpdate.current = false;

    if (classInstance?.name) {
      saveRecentModel(classInstance.name, editor?.getValue() || lastLoadedContent);
    }
  }, [classInstance]);

  useEffect(() => {
    if (view === View.DIAGRAM || isSplit(view)) {
      setTimeout(() => {
        diagramEditorRef.current?.fitContent();
      }, 100);
    }
  }, [view, treeVisible]);

  const loadClass = (classInstance: ModelicaClassInstance) => {
    let entity: ModelicaEntity | null = null;
    if (classInstance instanceof ModelicaEntity) {
      entity = classInstance;
    } else {
      let p = classInstance.parent;
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
        const node = classInstance.abstractSyntaxNode?.concreteSyntaxNode as any;
        if (node) {
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
      const node = classInstance.abstractSyntaxNode?.concreteSyntaxNode as any;
      if (node) {
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
    if (!classInstance || !editor || !newName) return null;
    const component = Array.from(classInstance.components).find((c: any) => c.name === oldName);
    if (!component) return null;

    const abstractNode = (component as any).abstractSyntaxNode;
    const identNode = abstractNode?.declaration?.identifier?.concreteSyntaxNode;
    if (identNode) {
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
    if (!classInstance || !editor) return null;
    const component = Array.from(classInstance.components).find((c: any) => c.name === componentName);
    if (!component) return null;

    const abstractNode = (component as any).abstractSyntaxNode;
    const descriptionNode = abstractNode?.description?.concreteSyntaxNode;

    // Escape quotes for Modelica (double them)
    const escapedDescription = newDescription.replace(/"/g, '""');

    if (descriptionNode) {
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
      // If no description exists, we need to insert it after the identifier/modification
      const identNode = abstractNode?.declaration?.identifier?.concreteSyntaxNode;
      const modificationNode = abstractNode?.declaration?.modification?.concreteSyntaxNode;
      const subscriptsNode = abstractNode?.declaration?.arraySubscripts?.concreteSyntaxNode;

      let pos = null;
      if (modificationNode) {
        pos = modificationNode.endPosition;
      } else if (subscriptsNode) {
        pos = subscriptsNode.endPosition;
      } else if (identNode) {
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
    if (!classInstance || !editor) return null;
    const component = Array.from(classInstance.components).find((c: any) => c.name === componentName);
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
          const argNode = (existingArg as any).concreteSyntaxNode;
          if (!argNode) return null;

          let startLine = argNode.startPosition.row + 1;
          let startCol = argNode.startPosition.column + 1;
          let endLine = argNode.endPosition.row + 1;
          let endCol = argNode.endPosition.column + 1;

          const nextArg = classMod.modificationArguments[argIndex + 1];
          if (nextArg) {
            const nextNode = (nextArg as any).concreteSyntaxNode;
            if (nextNode) {
              endLine = nextNode.startPosition.row + 1;
              endCol = nextNode.startPosition.column + 1;
            }
          } else if (argIndex > 0) {
            const prevArg = classMod.modificationArguments[argIndex - 1];
            const prevNode = (prevArg as any).concreteSyntaxNode;
            if (prevNode) {
              startLine = prevNode.endPosition.row + 1;
              startCol = prevNode.endPosition.column + 1;
            }
          } else {
            const classModNode = classMod.concreteSyntaxNode;
            if (classModNode) {
              return {
                range: {
                  startLineNumber: classModNode.startPosition.row + 1,
                  startColumn: classModNode.startPosition.column + 1,
                  endLineNumber: classModNode.endPosition.row + 1,
                  endColumn: classModNode.endPosition.column + 1,
                },
                text: "",
              };
            }
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

        const modNode = (existingArg as any).modification?.concreteSyntaxNode;
        if (modNode) {
          return {
            range: {
              startLineNumber: modNode.startPosition.row + 1,
              startColumn: modNode.startPosition.column + 1,
              endLineNumber: modNode.endPosition.row + 1,
              endColumn: modNode.endPosition.column + 1,
            },
            text: `=${newValue}`,
          };
        } else {
          const argNode = (existingArg as any).concreteSyntaxNode;
          if (argNode) {
            return {
              range: {
                startLineNumber: argNode.startPosition.row + 1,
                startColumn: argNode.startPosition.column + 1,
                endLineNumber: argNode.endPosition.row + 1,
                endColumn: argNode.endPosition.column + 1,
              },
              text: `${parameterName}=${newValue}`,
            };
          }
        }
      } else {
        if (shouldRemove) return null;
        const classModNode = classMod.concreteSyntaxNode;
        if (classModNode) {
          const lastChild = classModNode.lastChild;
          if (lastChild && lastChild.text === ")") {
            const hasArgs = classMod.modificationArguments.length > 0;
            return {
              range: {
                startLineNumber: lastChild.startPosition.row + 1,
                startColumn: lastChild.startPosition.column + 1,
                endLineNumber: lastChild.startPosition.row + 1,
                endColumn: lastChild.startPosition.column + 1,
              },
              text: `${hasArgs ? ", " : ""}${parameterName}=${newValue}`,
            };
          }
        }
      }
    } else {
      if (shouldRemove) return null;
      const identNode = declNode?.identifier?.concreteSyntaxNode;
      const subscriptsNode = declNode?.arraySubscripts?.concreteSyntaxNode;
      let pos = null;
      if (subscriptsNode) {
        pos = subscriptsNode.endPosition;
      } else if (identNode) {
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
    if (!classInstance || !editor) return null;

    const component = classInstance.components
      ? Array.from(classInstance.components).find((c) => c.name === name)
      : null;

    if (!component) return null;
    const originX = Math.round(x + width / 2);
    const originY = Math.round(-(y + height / 2));
    const w = Math.round(width);
    const h = Math.round(height);
    const r = Math.round(-(rotation ?? 0));
    const abstractNode = (component as any).abstractSyntaxNode;
    const node = abstractNode?.concreteSyntaxNode;
    if (node) {
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
      const rotationPart = r !== 0 ? `, rotation=${r}` : "";
      const newTransformationCore = `origin={${originX},${originY}}, extent={{-${w / 2},-${h / 2}},{${w / 2},${h / 2}}}${rotationPart}`;

      const annotationMatch = text.match(/annotation\s*\(/);
      if (annotationMatch) {
        const startIndex = annotationMatch.index! + annotationMatch[0].length;
        let nesting = 0;
        let endIndex = -1;
        for (let i = startIndex; i < text.length; i++) {
          if (text[i] === "(") nesting++;
          else if (text[i] === ")") {
            if (nesting === 0) {
              endIndex = i;
              break;
            }
            nesting--;
          }
        }

        if (endIndex !== -1) {
          const annotationContent = text.substring(startIndex, endIndex);
          const placementMatch = annotationContent.match(/Placement\s*\(/);
          if (placementMatch) {
            const placementStartRel = placementMatch.index! + placementMatch[0].length;
            const placementStartAbs = startIndex + placementStartRel;
            let pNesting = 0;
            let placementEndAbs = -1;
            for (let i = placementStartAbs; i < text.length; i++) {
              if (text[i] === "(") pNesting++;
              else if (text[i] === ")") {
                if (pNesting === 0) {
                  placementEndAbs = i;
                  break;
                }
                pNesting--;
              }
            }
            if (placementEndAbs !== -1) {
              const placementContent = text.substring(placementStartAbs, placementEndAbs);
              const transformMatch = placementContent.match(/transformation\s*\(/);
              if (transformMatch) {
                const transformStartAbs = placementStartAbs + transformMatch.index! + transformMatch[0].length;
                let tNesting = 0;
                let transformEndAbs = -1;
                for (let i = transformStartAbs; i < text.length; i++) {
                  if (text[i] === "(") tNesting++;
                  else if (text[i] === ")") {
                    if (tNesting === 0) {
                      transformEndAbs = i;
                      break;
                    }
                    tNesting--;
                  }
                }
                if (transformEndAbs !== -1) {
                  const newText =
                    text.substring(0, transformStartAbs) + newTransformationCore + text.substring(transformEndAbs);
                  if (newText !== text) {
                    return { range, text: newText };
                  }
                } else {
                  const insert = `transformation(${newTransformationCore})`;
                  const prefix = placementContent.trim().length > 0 ? ", " : "";
                  const newText =
                    text.substring(0, placementEndAbs) + prefix + insert + text.substring(placementEndAbs);
                  return { range, text: newText };
                }
              } else {
                const insert = `transformation(${newTransformationCore})`;
                const prefix = placementContent.trim().length > 0 ? ", " : "";
                const newText = text.substring(0, placementEndAbs) + prefix + insert + text.substring(placementEndAbs);
                return { range, text: newText };
              }
            }
          } else {
            const insert = `Placement(transformation(${newTransformationCore}))`;
            const innerContent = annotationContent.trim();
            const prefix = innerContent.length > 0 ? ", " : "";
            const newText = text.substring(0, endIndex) + prefix + insert + text.substring(endIndex);
            return { range, text: newText };
          }
        }
      } else {
        const semiIndex = text.lastIndexOf(";");
        if (semiIndex !== -1) {
          const insert = ` annotation(Placement(transformation(${newTransformationCore})))`;
          const newText = text.slice(0, semiIndex) + insert + text.slice(semiIndex);
          return { range, text: newText };
        } else {
          const insert = ` annotation(Placement(transformation(${newTransformationCore})))`;
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
    if (!classInstance || !editor) return edits;

    for (const edge of edges) {
      const connectEq = Array.from(classInstance.connectEquations).find((ce: any) => {
        const c1 = ce.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        const c2 = ce.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        return (c1 === edge.source && c2 === edge.target) || (c1 === edge.target && c2 === edge.source);
      });

      if (!connectEq) continue;

      const node = connectEq.concreteSyntaxNode;
      if (node) {
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
        const pointsStr = `{${edge.points.map((p) => `{${p.x},${p.y}}`).join(", ")}}`;
        const newPointsCore = `points=${pointsStr}`;
        const colorCore = "color={0, 0, 255}";

        let newText = text;
        const lineMatch = text.match(/Line\s*\(/);
        if (lineMatch) {
          const startIndex = lineMatch.index! + lineMatch[0].length;
          let nesting = 0;
          let endIndex = -1;
          for (let i = startIndex; i < text.length; i++) {
            if (text[i] === "(") nesting++;
            else if (text[i] === ")") {
              if (nesting === 0) {
                endIndex = i;
                break;
              }
              nesting--;
            }
          }
          if (endIndex !== -1) {
            let lineContent = text.substring(startIndex, endIndex);
            const pointsMatch = lineContent.match(/points\s*=\s*\{/);
            if (pointsMatch) {
              const pStartRel = pointsMatch.index!;
              const pStartAbs = startIndex + pStartRel;
              let pNesting = 0;
              let pEndAbs = -1;
              for (let i = pStartAbs; i < text.length; i++) {
                if (text[i] === "{") pNesting++;
                else if (text[i] === "}") {
                  if (pNesting === 1) {
                    pEndAbs = i;
                    break;
                  }
                  pNesting--;
                }
              }
              if (pEndAbs !== -1) {
                lineContent =
                  text.substring(startIndex, pStartAbs) + newPointsCore + text.substring(pEndAbs + 1, endIndex);
              }
            } else {
              const prefix = lineContent.trim().length > 0 ? ", " : "";
              lineContent = lineContent + prefix + newPointsCore;
            }

            if (!lineContent.match(/color\s*=\s*\{/)) {
              const prefix = lineContent.trim().length > 0 ? ", " : "";
              lineContent = lineContent + prefix + colorCore;
            }

            newText = text.substring(0, startIndex) + lineContent + text.substring(endIndex);
          }
        } else {
          const annotationMatch = text.match(/annotation\s*\(/);
          if (annotationMatch) {
            const startIndex = annotationMatch.index! + annotationMatch[0].length;
            let nesting = 0;
            let endIndex = -1;
            for (let i = startIndex; i < text.length; i++) {
              if (text[i] === "(") nesting++;
              else if (text[i] === ")") {
                if (nesting === 0) {
                  endIndex = i;
                  break;
                }
                nesting--;
              }
            }
            if (endIndex !== -1) {
              const annotationContent = text.substring(startIndex, endIndex);
              const prefix = annotationContent.trim().length > 0 ? ", " : "";
              newText =
                text.substring(0, endIndex) +
                prefix +
                `Line(${newPointsCore}, ${colorCore})` +
                text.substring(endIndex);
            }
          } else {
            const semiIndex = text.lastIndexOf(";");
            const insert = ` annotation(Line(${newPointsCore}, ${colorCore}))`;
            if (semiIndex !== -1) {
              newText = text.slice(0, semiIndex) + insert + text.slice(semiIndex);
            } else {
              newText = text + insert;
            }
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
    if (!classInstance || !editor) return;
    const connectEq = Array.from(classInstance.connectEquations).find((ce: any) => {
      const c1 = ce.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
      const c2 = ce.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
      return (c1 === source && c2 === target) || (c1 === target && c2 === source);
    });
    if (!connectEq) return;
    const node = connectEq.concreteSyntaxNode;
    if (node) {
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
      editor.executeEdits("delete-connect", [{ range, text: "" }]);
    }
  };

  const handleComponentDelete = (name: string) => {
    handleComponentsDelete([name]);
  };

  const handleComponentsDelete = (names: string[]) => {
    if (!classInstance || !editor) return;

    const edits: editor.IIdentifiedSingleEditOperation[] = [];
    const model = editor.getModel();
    const nameSet = new Set(names);

    if (model) {
      // Collect connect equation edits for all components
      Array.from(classInstance.connectEquations).forEach((ce: any) => {
        const c1 = ce.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        const c2 = ce.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        const involvesComponent = [...nameSet].some(
          (name) => c1 === name || c1.startsWith(`${name}.`) || c2 === name || c2.startsWith(`${name}.`),
        );
        if (involvesComponent) {
          const node = ce.concreteSyntaxNode;
          if (node) {
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
      const component = Array.from(classInstance.components).find((c) => c.name === name);
      if (!component) continue;
      const node = component.abstractSyntaxNode?.parent;
      if (node instanceof ModelicaComponentClauseSyntaxNode) {
        if (node.componentDeclarations.length <= 1 && node.concreteSyntaxNode) {
          const startLine = node.concreteSyntaxNode.startPosition.row + 1;
          const startCol = node.concreteSyntaxNode.startPosition.column + 1;
          const endLine = node.concreteSyntaxNode.endPosition.row + 1;
          const endCol = node.concreteSyntaxNode.endPosition.column + 1;
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
          if (componentDeclaration?.concreteSyntaxNode) {
            let startLine = componentDeclaration.concreteSyntaxNode.startPosition.row + 1;
            let startCol = componentDeclaration.concreteSyntaxNode.startPosition.column + 1;
            let endLine = componentDeclaration.concreteSyntaxNode.endPosition.row + 1;
            let endCol = componentDeclaration.concreteSyntaxNode.endPosition.column + 1;

            if (index > 0) {
              const prevDecl = node.componentDeclarations[index - 1];
              if (prevDecl.concreteSyntaxNode) {
                startLine = prevDecl.concreteSyntaxNode.endPosition.row + 1;
                startCol = prevDecl.concreteSyntaxNode.endPosition.column + 1;
              }
            } else if (node.componentDeclarations.length > 1) {
              const nextDecl = node.componentDeclarations[1];
              if (nextDecl.concreteSyntaxNode) {
                endLine = nextDecl.concreteSyntaxNode.startPosition.row + 1;
                endCol = nextDecl.concreteSyntaxNode.startPosition.column + 1;
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
      editor.executeEdits("delete-component", edits);
    }
  };

  const handleFlatten = async () => {
    if (!codeEditorRef.current) return;
    const instance = await codeEditorRef.current.sync();
    if (!instance) return;

    try {
      const dae = new ModelicaDAE(instance.name || "Model");
      const flattener = new ModelicaFlattener();
      instance.accept(flattener, ["", dae]);

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

  return (
    <>
      <title>{classInstance?.name ? `${classInstance.name} - Morsel` : "Morsel"}</title>
      <div className="d-flex flex-column" style={{ height: "100vh", overflow: "hidden" }}>
        <div className="d-flex flex-1" style={{ minHeight: 0 }}>
          {treeVisible && (
            <>
              <div style={{ width: treeWidth, display: "flex", flexDirection: "column", minWidth: 200, maxWidth: 600 }}>
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
                    width="100%"
                    filter={debouncedFilter}
                    version={contextVersion}
                    language={language}
                  />
                </div>
                <div className="text-bold px-3 py-2 border-top border-bottom bg-canvas-subtle">
                  {translations.components}
                </div>
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  <ComponentList
                    classInstance={classInstance}
                    onSelect={(name) => {
                      if (!classInstance) return;
                      const component = Array.from(classInstance.components).find((c) => c.name === name);
                      setSelectedComponent(component || null);
                      if (name) {
                        codeEditorRef.current?.revealComponent(name);
                      }
                    }}
                    selectedName={selectedComponent?.name}
                    language={language}
                    translations={translations}
                  />
                </div>
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
            <div
              style={{
                display: view === View.DIAGRAM || isSplit(view) ? "flex" : "none",
                flex: isSplit(view) ? "none" : 1,
                width: isSplit(view) && view === View.SPLIT_COLUMNS ? `${splitRatio * 100}%` : undefined,
                height: isSplit(view) && view === View.SPLIT_ROWS ? `${splitRatio * 100}%` : undefined,
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <div className="d-flex flex-row height-full">
                <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                  <DiagramEditor
                    ref={diagramEditorRef}
                    classInstance={diagramClassInstance}
                    selectedName={selectedComponent?.name}
                    theme={colorMode === "dark" ? "vs-dark" : "light"}
                    onSelect={(name) => {
                      if (!name) {
                        setSelectedComponent(null);
                      } else {
                        const component = classInstance?.components
                          ? Array.from(classInstance.components).find((c) => c.name === name)
                          : null;
                        setSelectedComponent(component || null);
                        codeEditorRef.current?.revealComponent(name);
                      }
                    }}
                    onDrop={(className, x, y) => {
                      if (!classInstance || !editor) return;

                      // Try to get the defaultComponentName annotation from the dropped class
                      const shortName = className.split(".").pop() || "component";
                      let baseName = shortName.toLowerCase();
                      const droppedClass = context?.query(className);
                      if (droppedClass instanceof ModelicaClassInstance) {
                        const defaultName = droppedClass.annotation<string>("defaultComponentName");
                        if (defaultName) {
                          baseName = droppedClass.translate(defaultName);
                        } else {
                          baseName = droppedClass.localizedName.toLowerCase();
                        }
                      }

                      let name = baseName;
                      let i = 1;
                      const existingNames = new Set(Array.from(classInstance.components).map((c) => c.name));
                      while (existingNames.has(name)) {
                        name = `${baseName}${i}`;
                        i++;
                      }

                      const diagram: IDiagram | null = classInstance.annotation("Diagram");
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
                        for (let i = 0; i < lines.length; i++) {
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
                          if (insertLine > 0 && lines[insertLine - 1].trim() === "") {
                            range.startLineNumber = insertLine;
                            range.endLineNumber = insertLine + 1;
                          }
                          editor.executeEdits("dnd", [
                            {
                              range: range,
                              text: componentDecl,
                            },
                          ]);
                        } else {
                          const lastEndIndex = text.lastIndexOf("end");
                          if (lastEndIndex !== -1) {
                            const pos = model.getPositionAt(lastEndIndex);
                            let range = {
                              startLineNumber: pos.lineNumber,
                              startColumn: 1,
                              endLineNumber: pos.lineNumber,
                              endColumn: 1,
                            };
                            if (pos.lineNumber > 1) {
                              const prevLineContent = model.getLineContent(pos.lineNumber - 1);
                              if (prevLineContent.trim() === "") {
                                range.startLineNumber = pos.lineNumber - 1;
                                range.endLineNumber = pos.lineNumber;
                              }
                            }
                            editor.executeEdits("dnd", [
                              {
                                range: range,
                                text: componentDecl,
                              },
                            ]);
                          }
                        }
                      }
                    }}
                    onConnect={(source, target, points) => {
                      if (!classInstance || !editor) return;
                      isDiagramUpdate.current = true;

                      const annotation = points
                        ? ` annotation(Line(points={${points.map((p) => `{${p.x},${p.y}}`).join(", ")}}, color={0, 0, 255}))`
                        : " annotation(Line(color={0, 0, 255}))";
                      const connectEq = `  connect(${source}, ${target})${annotation};\n`;
                      const model = editor.getModel();
                      if (!model) return;
                      const equationMatches = model.findMatches("equation", false, false, true, null, true);
                      if (equationMatches.length > 0) {
                        const startLine = equationMatches[0].range.startLineNumber;
                        const text = model.getValue();
                        const lines = text.split("\n");
                        let insertLine = -1;
                        for (let i = startLine; i < lines.length; i++) {
                          const line = lines[i].trim();
                          if (
                            line.startsWith("public") ||
                            line.startsWith("protected") ||
                            line.startsWith("initial equation") ||
                            line.startsWith("algorithm") ||
                            line.startsWith("end")
                          ) {
                            insertLine = i;
                            break;
                          }
                        }
                        if (insertLine !== -1) {
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
                          return;
                        }
                      }
                      const endMatches = model.findMatches("^\\s*end\\s+[^;]+;", false, true, false, null, true);
                      if (endMatches.length > 0) {
                        const lastEnd = endMatches[endMatches.length - 1];
                        const insertText = equationMatches.length === 0 ? `equation\n${connectEq}` : connectEq;
                        editor.executeEdits("connect", [
                          {
                            range: {
                              startLineNumber: lastEnd.range.startLineNumber,
                              startColumn: 1,
                              endLineNumber: lastEnd.range.startLineNumber,
                              endColumn: 1,
                            },
                            text: insertText,
                          },
                        ]);
                        return;
                      }
                      const text = model.getValue();
                      const lastEndIndex = text.lastIndexOf("end");
                      if (lastEndIndex !== -1) {
                        const pos = model.getPositionAt(lastEndIndex);
                        const insertText = equationMatches.length === 0 ? `equation\n${connectEq}` : connectEq;
                        editor.executeEdits("connect", [
                          {
                            range: {
                              startLineNumber: pos.lineNumber,
                              startColumn: 1,
                              endLineNumber: pos.lineNumber,
                              endColumn: 1,
                            },
                            text: insertText,
                          },
                        ]);
                      }
                    }}
                    onMove={(items) => {
                      if (!classInstance || !editor) return;
                      isDiagramUpdate.current = true;
                      const edits: editor.IIdentifiedSingleEditOperation[] = [];
                      const allEdges: any[] = [];
                      items.forEach((item) => {
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
                      });

                      if (allEdges.length > 0) {
                        const edgeEdits = getConnectEdits(allEdges);
                        edgeEdits.forEach((edit) => edits.push(edit));
                      }

                      if (edits.length > 0) {
                        editor.executeEdits("move", edits);
                      }
                    }}
                    onResize={(name, x, y, width, height, rotation, edges) => {
                      if (!classInstance || !editor) return;
                      isDiagramUpdate.current = false;
                      const edits: editor.IIdentifiedSingleEditOperation[] = [];
                      const edit = getPlacementEdit(name, x, y, width, height, rotation);
                      if (edit) edits.push(edit);
                      if (edges) {
                        const edgeEdits = getConnectEdits(edges);
                        edgeEdits.forEach((edit) => edits.push(edit));
                      }
                      if (edits.length > 0) {
                        editor.executeEdits("resize", edits);
                      }
                    }}
                    onEdgeMove={(edges) => {
                      if (!classInstance || !editor) return;
                      isDiagramUpdate.current = true;
                      const edgeEdits = getConnectEdits(edges);
                      if (edgeEdits.size > 0) {
                        editor.executeEdits("edge-move", Array.from(edgeEdits.values()));
                      }
                    }}
                    onEdgeDelete={handleEdgeDelete}
                    onComponentDelete={handleComponentDelete}
                    onComponentsDelete={handleComponentsDelete}
                  />
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
                      width={propertiesWidth}
                      translations={translations}
                      onNameChange={(newName) => {
                        if (!selectedComponent || !editor) return;
                        const edit = getNameEdit(selectedComponent.name!, newName);
                        if (edit) {
                          expectedComponentNameRef.current = newName;
                          editor.executeEdits("name-change", [edit]);
                        }
                      }}
                      onDescriptionChange={(newDescription) => {
                        if (!selectedComponent || !editor) return;
                        const edit = getDescriptionEdit(selectedComponent.name!, newDescription);
                        if (edit) {
                          editor.executeEdits("description-change", [edit]);
                        }
                      }}
                      onParameterChange={(name, value) => {
                        if (!selectedComponent || !editor) return;
                        const edit = getParameterEdit(selectedComponent.name!, name, value);
                        if (edit) {
                          editor.executeEdits("parameter-change", [edit]);
                        }
                      }}
                    />
                  </>
                )}
              </div>
            </div>
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
              <CodeEditor
                ref={codeEditorRef}
                embed={props.embed}
                context={context}
                setClassInstance={setClassInstance}
                setEditor={setEditor}
                content={content}
                theme={colorMode === "dark" ? "vs-dark" : "light"}
              />
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
          <img src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"} alt="Morsel" style={{ height: 20 }} />
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
              let filename = classInstance?.name ? `${classInstance.name}.mo` : "model.mo";
              if (codeEditorRef.current) {
                const syncedInstance = await codeEditorRef.current.sync();
                if (syncedInstance?.name) {
                  filename = `${syncedInstance.name}.mo`;
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
            <img
              src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
              alt="Morsel"
              style={{ marginBottom: 8 }}
            />
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
              <CodeEditor
                content={flattenedCode}
                context={null}
                setClassInstance={() => {}}
                setEditor={() => {}}
                theme={colorMode === "dark" ? "vs-dark" : "light"}
                embed={false}
                readOnly={true}
              />
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
      </div>
    </>
  );
}
