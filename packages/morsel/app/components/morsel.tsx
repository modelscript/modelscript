// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ContentType,
  Context,
  decodeDataUrl,
  encodeDataUrl,
  type IDiagram,
  ModelicaClassInstance,
  ModelicaComponentClauseSyntaxNode,
  ModelicaComponentInstance,
  ModelicaEntity,
  type ModelicaEquationSectionSyntaxNode,
} from "@modelscript/modelscript";
import {
  CodeIcon,
  ListUnorderedIcon,
  MoonIcon,
  ShareAndroidIcon,
  SplitViewIcon,
  SunIcon,
  UnwrapIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Dialog, IconButton, useTheme } from "@primer/react";
import { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import { useCallback, useEffect, useRef, useState } from "react";
import CodeEditor from "./code";
import DiagramEditor, { type DiagramEditorHandle } from "./diagram";
import PropertiesWidget from "./properties";
import TreeWidget from "./tree";

interface MorselEditorProps {
  dataUrl: DataUrl | null;
  embed: boolean;
}

enum View {
  CODE,
  DIAGRAM,
  SPLIT,
}

export default function MorselEditor(props: MorselEditorProps) {
  const [isShareDialogOpen, setShareDialogOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const [isEmbedDialogOpen, setEmbedDialogOpen] = useState(false);
  const embedButtonRef = useRef<HTMLButtonElement>(null);
  const [decodedContent] = decodeDataUrl(props.dataUrl ?? null);
  const content = decodedContent || "model Example\n\nend Example;";
  const [editor, setEditor] = useState<editor.ICodeEditor | null>(null);
  const [classInstance, setClassInstance] = useState<ModelicaClassInstance | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [view, setView] = useState<View>(View.SPLIT);
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
  const { colorMode, setColorMode } = useTheme();

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
      setView((prev) => (prev === View.SPLIT ? View.DIAGRAM : prev));
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
    setSelectedComponent(null);
    if (!isDiagramUpdate.current) {
      setDiagramClassInstance(classInstance);
    }
    isDiagramUpdate.current = false;
  }, [classInstance]);

  useEffect(() => {
    if (view === View.DIAGRAM || view === View.SPLIT) {
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

  const handlePlacementChange = (
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
  ) => {
    if (!classInstance || !editor) return;

    const component = classInstance.components
      ? Array.from(classInstance.components).find((c) => c.name === name)
      : null;

    if (!component) return;
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
                    editor.executeEdits("move", [{ range, text: newText }]);
                  }
                }
              } else {
                const insert = `transformation(${newTransformationCore})`;
                const prefix = placementContent.trim().length > 0 ? ", " : "";
                const newText = text.substring(0, placementEndAbs) + prefix + insert + text.substring(placementEndAbs);
                editor.executeEdits("move", [{ range, text: newText }]);
              }
            }
          } else {
            const insert = `Placement(transformation(${newTransformationCore}))`;
            const innerContent = annotationContent.trim();
            const prefix = innerContent.length > 0 ? ", " : "";
            const newText = text.substring(0, endIndex) + prefix + insert + text.substring(endIndex);
            editor.executeEdits("move", [{ range, text: newText }]);
          }
        }
      } else {
        const semiIndex = text.lastIndexOf(";");
        if (semiIndex !== -1) {
          const insert = ` annotation(Placement(transformation(${newTransformationCore})))`;
          const newText = text.slice(0, semiIndex) + insert + text.slice(semiIndex);
          editor.executeEdits("move", [{ range, text: newText }]);
        } else {
          const insert = ` annotation(Placement(transformation(${newTransformationCore})))`;
          const newText = text + insert;
          editor.executeEdits("move", [{ range, text: newText }]);
        }
      }
    }
  };

  const handleConnectUpdate = (edges: { source: string; target: string; points: { x: number; y: number }[] }[]) => {
    if (!classInstance || !editor) return;

    for (const edge of edges) {
      const connectEq = Array.from(classInstance.connectEquations).find((ce: any) => {
        const c1 = ce.componentReference1?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        const c2 = ce.componentReference2?.parts.map((c: any) => c.identifier?.text ?? "").join(".");
        return (c1 === edge.source && c2 === edge.target) || (c1 === edge.target && c2 === edge.source);
      });

      if (!connectEq) continue;

      const node = connectEq.concreteSyntaxNode;
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
          editor.executeEdits("update-connect", [{ range, text: newText }]);
        }
      }
    }
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
      const range = {
        startLineNumber: startLine,
        startColumn: startCol,
        endLineNumber: endLine,
        endColumn: endCol,
      };
      isDiagramUpdate.current = true;
      editor.executeEdits("delete-connect", [{ range, text: "" }]);
    }
  };

  const handleComponentDelete = (name: string) => {
    if (!classInstance || !editor) return;
    const component = Array.from(classInstance.components).find((c) => c.name === name);
    if (!component) return;
    const node = component.abstractSyntaxNode?.parent;
    if (node instanceof ModelicaComponentClauseSyntaxNode) {
      if (node.componentDeclarations.length <= 1 && node.concreteSyntaxNode) {
        const startLine = node.concreteSyntaxNode.startPosition.row + 1;
        const startCol = node.concreteSyntaxNode.startPosition.column + 1;
        const endLine = node.concreteSyntaxNode.endPosition.row + 1;
        const endCol = node.concreteSyntaxNode.endPosition.column + 1;
        const range = {
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
        };
        isDiagramUpdate.current = true;
        editor.executeEdits("delete-component", [{ range, text: "" }]);
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
          const range = {
            startLineNumber: startLine,
            startColumn: startCol,
            endLineNumber: endLine,
            endColumn: endCol,
          };
          isDiagramUpdate.current = true;
          editor.executeEdits("delete-component", [{ range, text: "" }]);
        }
      }
    }
  };

  return (
    <>
      <title>Morsel | ModelScript.org</title>
      <div className="d-flex flex-column" style={{ height: "100vh", overflow: "hidden" }}>
        <div className="d-flex flex-1" style={{ minHeight: 0 }}>
          {treeVisible && (
            <>
              <TreeWidget context={context} onSelect={handleTreeSelect} width={treeWidth} />
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
            className="d-flex flex-1"
            ref={splitContainerRef}
            style={{ minHeight: 0, overflow: "hidden", position: "relative" }}
          >
            <div
              style={{
                display: [View.DIAGRAM, View.SPLIT].indexOf(view) === -1 ? "none" : "flex",
                flex: view === View.SPLIT ? "none" : 1,
                width: view === View.SPLIT ? `${splitRatio * 100}%` : undefined,
                flexDirection: "column",
                minWidth: 0,
              }}
            >
              <div className="d-flex flex-row height-full">
                <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                  <DiagramEditor
                    ref={diagramEditorRef}
                    classInstance={diagramClassInstance}
                    theme={colorMode === "dark" ? "vs-dark" : "light"}
                    onSelect={(name) => {
                      if (!name) {
                        setSelectedComponent(null);
                      } else {
                        const component = classInstance?.components
                          ? Array.from(classInstance.components).find((c) => c.name === name)
                          : null;
                        setSelectedComponent(component || null);
                      }
                    }}
                    onDrop={(className, x, y) => {
                      if (!classInstance || !editor) return;
                      const baseName = className.split(".").pop()?.toLowerCase() || "component";
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
                        const text = model.getValue();
                        const lastEndIndex = text.lastIndexOf("end");
                        if (lastEndIndex !== -1) {
                          const pos = model.getPositionAt(lastEndIndex);
                          editor.executeEdits("dnd", [
                            {
                              range: {
                                startLineNumber: pos.lineNumber,
                                startColumn: 1,
                                endLineNumber: pos.lineNumber,
                                endColumn: 1,
                              },
                              text: componentDecl,
                            },
                          ]);
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

                      let equationSection: ModelicaEquationSectionSyntaxNode | null = null;
                      const sections = (classInstance.abstractSyntaxNode as any)?.sections;

                      if (sections) {
                        for (const section of sections) {
                          if (section["@type"] === "EquationSection") {
                            equationSection = section as ModelicaEquationSectionSyntaxNode;
                          }
                        }
                      }

                      if (equationSection && equationSection.concreteSyntaxNode) {
                        const endPos = equationSection.concreteSyntaxNode.endPosition;
                        editor.executeEdits("connect", [
                          {
                            range: {
                              startLineNumber: endPos.row + 1,
                              startColumn: 1,
                              endLineNumber: endPos.row + 1,
                              endColumn: endPos.column + 1,
                            },
                            text: connectEq,
                          },
                        ]);
                      } else {
                        const text = model.getValue();
                        const lastEndIndex = text.lastIndexOf("end");
                        if (lastEndIndex !== -1) {
                          const pos = model.getPositionAt(lastEndIndex);
                          editor.executeEdits("connect", [
                            {
                              range: {
                                startLineNumber: pos.lineNumber,
                                startColumn: 1,
                                endLineNumber: pos.lineNumber,
                                endColumn: 1,
                              },
                              text: `equation\n${connectEq}`,
                            },
                          ]);
                        }
                      }
                    }}
                    onMove={(name, x, y, width, height, rotation, edges) => {
                      if (!classInstance || !editor) return;
                      isDiagramUpdate.current = true;
                      handlePlacementChange(name, x, y, width, height, rotation);
                      if (edges) handleConnectUpdate(edges);
                    }}
                    onResize={(name, x, y, width, height, rotation, edges) => {
                      if (!classInstance || !editor) return;
                      isDiagramUpdate.current = false;
                      handlePlacementChange(name, x, y, width, height, rotation);
                      if (edges) handleConnectUpdate(edges);
                    }}
                    onEdgeMove={(edges) => {
                      if (!classInstance || !editor) return;
                      isDiagramUpdate.current = true;
                      handleConnectUpdate(edges);
                    }}
                    onEdgeDelete={handleEdgeDelete}
                    onComponentDelete={handleComponentDelete}
                  />
                </div>
                {selectedComponent && (
                  <>
                    <div className="border-left" />
                    <PropertiesWidget component={selectedComponent} />
                  </>
                )}
              </div>
            </div>
            {/* Draggable split divider */}
            <div
              style={{
                display: view === View.SPLIT ? "flex" : "none",
                width: 6,
                cursor: "col-resize",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                backgroundColor: "transparent",
                borderLeft: `1px solid ${colorMode === "dark" ? "#30363d" : "#d0d7de"}`,
                transition: "background-color 0.15s",
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                isDraggingSplit.current = true;
                const onMouseMove = (ev: MouseEvent) => {
                  if (!isDraggingSplit.current || !splitContainerRef.current) return;
                  const rect = splitContainerRef.current.getBoundingClientRect();
                  const x = ev.clientX - rect.left;
                  const ratio = Math.min(0.8, Math.max(0.2, x / rect.width));
                  setSplitRatio(ratio);
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
            <div
              style={{
                display: [View.CODE, View.SPLIT].indexOf(view) === -1 ? "none" : "flex",
                flex: view === View.SPLIT ? "none" : 1,
                width: view === View.SPLIT ? `${(1 - splitRatio) * 100}%` : undefined,
                flexDirection: "column",
                minWidth: 0,
              }}
            >
              <CodeEditor
                embed={props.embed}
                setContext={setContext}
                setClassInstance={setClassInstance}
                setEditor={setEditor}
                content={content}
                theme={colorMode === "dark" ? "vs-dark" : "light"}
                onProgress={(progress, message) => {
                  setLoadingProgress(progress);
                  setLoadingMessage(message);
                }}
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
          <img
            src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
            alt="Morsel"
            style={{ height: 20, cursor: "pointer" }}
            onClick={() => (window.location.href = "/")}
          />
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={ListUnorderedIcon}
            size="small"
            variant="invisible"
            aria-label="Toggle Tree"
            title="Toggle Tree"
            onClick={() => setTreeVisible((prev) => !prev)}
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
              aria-label="Diagram View"
              title="Diagram View"
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
              <IconButton
                icon={SplitViewIcon}
                size="small"
                variant="invisible"
                aria-label="Split View"
                title="Split View"
                onClick={() => setView(View.SPLIT)}
                style={
                  view === View.SPLIT
                    ? {
                        backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.8)",
                        borderRadius: 6,
                      }
                    : {}
                }
              />
            )}
            <IconButton
              icon={UnwrapIcon}
              size="small"
              variant="invisible"
              aria-label="Code View"
              title="Code View"
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
            icon={ShareAndroidIcon}
            size="small"
            variant="invisible"
            aria-label="Share Morsel"
            ref={shareButtonRef}
            onClick={() => setShareDialogOpen(!isShareDialogOpen)}
          />
          {!props.embed && (
            <IconButton
              icon={CodeIcon}
              size="small"
              variant="invisible"
              aria-label="Embed Morsel"
              ref={embedButtonRef}
              onClick={() => setEmbedDialogOpen(!isEmbedDialogOpen)}
            />
          )}
          <div style={{ width: 1, height: 20, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }} />
          <IconButton
            icon={colorMode === "dark" ? SunIcon : MoonIcon}
            size="small"
            variant="invisible"
            aria-label={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}
            onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
          />
        </div>
        {/* Dialogs */}
        {isShareDialogOpen && (
          <Dialog
            title="Share Morsel"
            onClose={() => setShareDialogOpen(false)}
            returnFocusRef={shareButtonRef}
            footerButtons={[
              {
                buttonType: "normal",
                content: "Copy to clipboard",
                onClick: async () => {
                  await navigator.clipboard.writeText(
                    `${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}`,
                  );
                  alert("Copied to clipboard.");
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
        {isEmbedDialogOpen && (
          <Dialog
            title="Embed Morsel"
            onClose={() => setEmbedDialogOpen(false)}
            returnFocusRef={embedButtonRef}
            footerButtons={[
              {
                buttonType: "normal",
                content: "Copy to clipboard",
                onClick: async () => {
                  await navigator.clipboard.writeText(
                    `<iframe width="600" height="400" src="${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}"></iframe>`,
                  );
                  alert("Copied to clipboard.");
                  setEmbedDialogOpen(false);
                },
              },
            ]}
          >
            <div
              style={{ wordBreak: "break-all" }}
            >{`<iframe width="600" height="400" src="${window.location.protocol}//${window.location.host}/#${encodeDataUrl(editor?.getValue() ?? "", ContentType.MODELICA)}"></iframe>`}</div>
          </Dialog>
        )}
        {isDirtyDialogOpen && (
          <Dialog
            title="Unsaved Changes"
            onClose={() => setDirtyDialogOpen(false)}
            footerButtons={[
              {
                buttonType: "normal",
                content: "Cancel",
                onClick: () => {
                  setDirtyDialogOpen(false);
                  setPendingSelection(null);
                },
              },
              {
                buttonType: "danger",
                content: "Discard Changes",
                onClick: () => {
                  setDirtyDialogOpen(false);
                  if (pendingSelection) {
                    loadClass(pendingSelection);
                    setPendingSelection(null);
                  }
                },
              },
            ]}
          >
            You have unsaved changes. Any unsaved changes will be lost if you switch without saving. Are you sure you
            want to discard your changes?
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
      </div>
    </>
  );
}
