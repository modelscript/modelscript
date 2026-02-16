// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ContentType,
  Context,
  decodeDataUrl,
  encodeDataUrl,
  type IDiagram,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaEntity,
  type ModelicaEquationSectionSyntaxNode,
} from "@modelscript/modelscript";
import {
  CodeIcon,
  LinkExternalIcon,
  MoonIcon,
  ShareAndroidIcon,
  SplitViewIcon,
  SunIcon,
  UnwrapIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Dialog, IconButton, PageHeader, SegmentedControl, useTheme } from "@primer/react";
import { editor } from "monaco-editor";
import { type DataUrl } from "parse-data-url";
import { useCallback, useEffect, useRef, useState } from "react";
import CodeEditor from "./code";
import DiagramEditor from "./diagram";
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
  const { colorMode, setColorMode } = useTheme();

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

  return (
    <>
      <title>Morsel | ModelScript.org</title>
      <div className="d-flex flex-column" style={{ height: "100vh" }}>
        <div className="border-bottom">
          <PageHeader className={props.embed ? "p-2" : "p-3"}>
            <PageHeader.TitleArea>
              <PageHeader.LeadingVisual>
                <img
                  src={colorMode === "dark" ? "/brand-dark.png" : "/brand.png"}
                  alt="Morsel"
                  title="Morsel"
                  style={{ cursor: props.embed ? "default" : "pointer" }}
                  onClick={() => {
                    if (!props.embed) {
                      window.location.href = "/";
                    }
                  }}
                />
              </PageHeader.LeadingVisual>
            </PageHeader.TitleArea>
            <PageHeader.Actions>
              <SegmentedControl size="small">
                <SegmentedControl.IconButton
                  icon={WorkflowIcon}
                  aria-label="Diagram"
                  title="Diagram View"
                  onClick={() => setView(View.DIAGRAM)}
                ></SegmentedControl.IconButton>
                <SegmentedControl.IconButton
                  icon={SplitViewIcon}
                  aria-label="Split View"
                  title="Split View"
                  defaultSelected
                  onClick={() => setView(View.SPLIT)}
                ></SegmentedControl.IconButton>
                <SegmentedControl.IconButton
                  icon={UnwrapIcon}
                  aria-label="Code View"
                  title="Code View"
                  onClick={() => setView(View.CODE)}
                ></SegmentedControl.IconButton>
              </SegmentedControl>
              <IconButton
                icon={ShareAndroidIcon}
                size="small"
                variant="invisible"
                aria-label="Share Morsel"
                ref={shareButtonRef}
                onClick={() => setShareDialogOpen(!isShareDialogOpen)}
              />
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
              <IconButton
                icon={colorMode === "dark" ? SunIcon : MoonIcon}
                size="small"
                variant="invisible"
                aria-label={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}
                onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
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
                  You have unsaved changes. Any unsaved changes will be lost if you switch without saving. Are you sure
                  you want to discard your changes?
                </Dialog>
              )}
              {props.embed && (
                <IconButton
                  icon={LinkExternalIcon}
                  size="small"
                  variant="invisible"
                  aria-label="Open Morsel"
                  onClick={() => window.open("/", "_blank")}
                />
              )}
            </PageHeader.Actions>
          </PageHeader>
        </div>
        <div className="d-flex flex-1" style={{ minHeight: 0 }}>
          <div
            className={[View.DIAGRAM, View.SPLIT].indexOf(view) === -1 ? "d-none" : "flex-1"}
            style={{ width: view == View.DIAGRAM ? "100%" : "50%" }}
          >
            <div className="d-flex flex-row height-full">
              <TreeWidget context={context} onSelect={handleTreeSelect} />
              <div className="border-left" />
              <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                <DiagramEditor
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

                    // Generate unique component name
                    const baseName = className.split(".").pop()?.toLowerCase() || "component";
                    let name = baseName;
                    let i = 1;
                    const existingNames = new Set(Array.from(classInstance.components).map((c) => c.name));
                    while (existingNames.has(name)) {
                      name = `${baseName}${i}`;
                      i++;
                    }

                    // Get diagram configuration
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

                    // Generate annotation with extent
                    const annotation = `annotation(Placement(transformation(origin={${Math.round(x)},${-Math.round(y)}}, extent={{-${w / 2},-${h / 2}},{${w / 2},${h / 2}}})))`;
                    const componentDecl = `  ${className} ${name} ${annotation};\n`;

                    // Insert into editor
                    const model = editor.getModel();
                    if (model) {
                      // Find insertion point (end of class)
                      const text = model.getValue();
                      // Simple heuristic: insert before the last "end"
                      const lastEndIndex = text.lastIndexOf("end");
                      if (lastEndIndex !== -1) {
                        const pos = model.getPositionAt(lastEndIndex);

                        // Insert before the last "end" line
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
                  onConnect={(source, target) => {
                    if (!classInstance || !editor) return;
                    isDiagramUpdate.current = true;

                    const connectEq = `  connect(${source}, ${target});\n`;
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
                  onMove={(name, x, y, width, height, rotation) => {
                    if (!classInstance || !editor) return;
                    isDiagramUpdate.current = true;
                    handlePlacementChange(name, x, y, width, height, rotation);
                  }}
                  onResize={(name, x, y, width, height, rotation) => {
                    if (!classInstance || !editor) return;
                    isDiagramUpdate.current = false;
                    handlePlacementChange(name, x, y, width, height, rotation);
                  }}
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
          <div className={[View.SPLIT].indexOf(view) === -1 ? "d-none" : "border-left"}></div>
          <div
            className={[View.CODE, View.SPLIT].indexOf(view) === -1 ? "d-none" : "flex-1"}
            style={{ width: view === View.CODE ? "100%" : "50%" }}
          >
            <CodeEditor
              embed={props.embed}
              setContext={setContext}
              setClassInstance={setClassInstance}
              setEditor={setEditor}
              content={content}
              theme={colorMode === "dark" ? "vs-dark" : "light"}
            />
          </div>
        </div>
      </div>
    </>
  );
}
