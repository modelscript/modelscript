/* eslint-disable @typescript-eslint/no-explicit-any */
import { Editor } from "@monaco-editor/react";
import { ChecklistIcon, PlusIcon, ShareAndroidIcon } from "@primer/octicons-react";
import { Button, Dialog, IconButton, PageHeader, PageLayout, useConfirm } from "@primer/react";
import { useCallback, useEffect, useRef, useState } from "react";
import pako from "pako";
import Parser from "web-tree-sitter";
import {
  Context,
  type FileSystem,
  type Dirent,
  type Stats,
  type Range,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaLinter,
  ModelicaClassInstance,
  ModelicaDAE,
  ModelicaFlattener,
  ModelicaDAEPrinter,
  StringWriter,
  renderDiagram,
  ModelicaLibrary,
} from "@modelscript/modelscript";

import { Graph } from "@antv/x6";

import { basename, extname, join, resolve, sep } from "@zenfs/core/path.js";
import { fs, configure, statSync, InMemory } from "@zenfs/core";

export function meta() {
  return [{ title: "ModelScript Morsel" }];
}

export class ZenFileSystem implements FileSystem {
  basename(path: string): string {
    return basename(path);
  }

  extname(path: string): string {
    return extname(path);
  }

  join(...paths: string[]): string {
    return join(...paths);
  }

  read(path: string): string {
    return fs.readFileSync(path, { encoding: "utf8" });
  }

  readdir(path: string): Dirent[] {
    return fs.readdirSync(path, { withFileTypes: true });
  }

  resolve(...paths: string[]): string {
    return resolve(...paths);
  }

  get sep(): string {
    return sep;
  }

  stat(path: string): Stats | null {
    return statSync(path) ?? null;
  }
}

export default function Modelica() {
  const [context, setContext] = useState<Context | null>(null);
  const [classInstance, setClassInstance] = useState<ModelicaClassInstance | null>(null);
  const [title, setTitle] = useState("");
  const [isShareDialogOpen, setShareDialogOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const onShareDialogClose = useCallback(() => setShareDialogOpen(false), []);
  const [isFlattenDialogOpen, setFlattenDialogOpen] = useState(false);
  const flattenButtonRef = useRef<HTMLButtonElement>(null);
  const onFlattenDialogClose = useCallback(() => setFlattenDialogOpen(false), []);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  useEffect(() => {
    document.title = title.length > 0 ? title : "ModelScript Morsel";
  }, [title]);
  useEffect(() => {
    const data = {
      nodes: [],
      edges: [],
    };
    const container = document.getElementById("container");
    if (container) {
      const graph = new Graph({
        container,
        autoResize: true,
        interacting: false,
        background: {
          color: "#fff",
        },
        grid: {
          size: 16,
          visible: true,
          type: "doubleMesh",
        },
      });
      graph.fromJSON(data);
    }
  }, []);
  const confirmNew = useConfirm();
  const onNewButtonClick = useCallback(async () => {
    if (
      await confirmNew({
        title: "New morsel",
        content: "This action will clear the contents of the existing morsel. Click OK to proceed.",
      })
    ) {
      setTitle("");
      if (editorRef.current) {
        editorRef.current.getModel().setValue("");
      }
    }
  }, [confirmNew]);
  const handleEditorWillMount = async (monaco: any) => {
    monacoRef.current = monaco;
    monaco.languages.register({
      id: "modelica",
    });
    monaco.languages.setMonarchTokensProvider("modelica", {
      keywords: [
        "annotation",
        "block",
        "class",
        "connect",
        "connector",
        "constant",
        "discrete",
        "each",
        "encapsulated",
        "end",
        "enumeration",
        "equation",
        "expandable",
        "extends",
        "false",
        "final",
        "flow",
        "function",
        "import",
        "impure",
        "inner",
        "input",
        "model",
        "operator",
        "outer",
        "output",
        "package",
        "parameter",
        "partial",
        "protected",
        "public",
        "pure",
        "record",
        "redeclare",
        "replaceable",
        "stream",
        "true",
        "type",
        "within",
      ],
      typeKeywords: ["Boolean", "Integer", "Real", "String"],
      tokenizer: {
        root: [
          [
            /([_a-zA-Z]([_a-zA-Z0-9])*|'([_a-zA-Z0-9!#$%&()*+,-./:;<>=?@^{}|~ "]|\[|\]|\\('|"|\?|\\|a|b|f|n|r|t|v))*')/,
            {
              cases: {
                "@typeKeywords": "keyword",
                "@keywords": "keyword",
                "@default": "identifier",
              },
            },
          ],
          { include: "@whitespace" },
          [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
          [/\d+/, "number"],
          [/"/, "string", "@string"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, "string", "@pop"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\/\*/, "comment", "@push"],
          ["\\*/", "comment", "@pop"],
          [/[\\/*]/, "comment"],
        ],
        whitespace: [
          [/[ \t\r\n]+/, "white"],
          [/\/\*/, "comment", "@comment"],
          [/\/\/.*$/, "comment"],
        ],
      },
    });
    await Parser.init();
    const Modelica = await Parser.Language.load("/tree-sitter-modelica.wasm");
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    await configure({
      mounts: {
        "/tmp": InMemory,
      },
    });
    setContext(new Context(new ZenFileSystem()));
  };
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    const url = new URL(window.location.href);
    const m = url.searchParams.get("m");
    if (m) {
      editorRef.current.setValue(decode(m));
    }
    const t = url.searchParams.get("t");
    if (t) {
      setTitle(decode(t));
    }
    url.search = "";
    history.replaceState({}, "", url.href);
  };
  const handleDidChangeContent = (value: string | undefined) => {
    if (!context) return;
    const parser = context.getParser(".mo");
    if (!parser || !value) return;
    const model = editorRef.current.getModel();
    const markers: any[] = [];
    const linter = new ModelicaLinter(
      (type: string, message: string, resource: string | null | undefined, range: Range | null | undefined) => {
        if (!range) return;
        markers.push({
          message,
          startLineNumber: range.startPosition.row + 1,
          startColumn: range.startPosition.column + 1,
          endLineNumber: range.endPosition.row + 1,
          endColumn: range.endPosition.column + 1,
        });
      },
    );
    const tree = parser.parse(value, undefined, { bufferSize: value.length * 2 });
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
    if (node == null) {
      linter.lint(tree);
    } else {
      linter.lint(tree);
      linter.lint(node);
      const instance = new ModelicaClassInstance(new ModelicaLibrary(context, ""), null, node.classDefinitions[0]);
      instance.instantiate();
      linter.lint(instance);
      setClassInstance(instance);
      const svg = renderDiagram(instance);
      if (svg) document.getElementById("svg")?.replaceChildren(svg.node);
    }
    monacoRef.current.editor.setModelMarkers(model, "owner", markers);
  };
  return (
    <>
      <div className="d-flex flex-column" style={{ height: "100vh" }}>
        <div className="border-bottom">
          <PageHeader className="p-3 container-lg ">
            <PageHeader.TitleArea>
              <PageHeader.LeadingVisual className="w-32 me-1 ">
                <img src="/brand.png" />
              </PageHeader.LeadingVisual>
              <PageHeader.Title
                children={
                  <input
                    type="text"
                    className="px-2"
                    minLength={1}
                    maxLength={20}
                    style={{
                      color: "var(--fgColor-accent)",
                      fontFamily: "var(--fontStack-monospace)",
                      fontWeight: "var(--base-text-weight-light)",
                    }}
                    placeholder="Enter title"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                    }}
                  />
                }
              ></PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Actions>
              <Button
                variant="primary"
                leadingVisual={ChecklistIcon}
                ref={flattenButtonRef}
                onClick={() => setFlattenDialogOpen(!isFlattenDialogOpen)}
              >
                Flatten
              </Button>
              <IconButton
                aria-label="Share Morsel"
                icon={ShareAndroidIcon}
                ref={shareButtonRef}
                onClick={() => setShareDialogOpen(!isShareDialogOpen)}
              />
              <IconButton aria-label="New morsel" icon={PlusIcon} onClick={onNewButtonClick} />
            </PageHeader.Actions>
          </PageHeader>
        </div>
        {isShareDialogOpen && (
          <Dialog
            title="Share morsel"
            subtitle={title}
            onClose={onShareDialogClose}
            returnFocusRef={shareButtonRef}
            footerButtons={[
              {
                buttonType: "normal",
                content: "Copy to clipboard",
                onClick: async () => {
                  await navigator.clipboard.writeText(url(editorRef, title));
                  alert("Copied to clipboard.");
                  onShareDialogClose();
                },
              },
            ]}
          >
            <div style={{ wordBreak: "break-all" }}>{url(editorRef, title)}</div>
          </Dialog>
        )}
        {isFlattenDialogOpen && (
          <Dialog
            title="Flatten morsel"
            subtitle={title}
            onClose={onFlattenDialogClose}
            returnFocusRef={flattenButtonRef}
            height="large"
          >
            <Dialog.Body style={{ height: "100%" }}>
              <Editor
                height="100%"
                defaultLanguage="modelica"
                value={flatten(classInstance)}
                options={{ lineNumbers: "off", minimap: { enabled: false }, readOnly: true }}
              ></Editor>
            </Dialog.Body>
          </Dialog>
        )}
        <PageLayout containerWidth="full" className="flex-1 bgColor-inset" style={{ height: "100%" }}>
          <PageLayout.Content className="bgColor-inset" style={{ height: "100%" }}>
            <div className="d-flex " style={{ height: "100%" }}>
              <div className="flex-1">
                <Editor
                  options={{ automaticLayout: true, minimap: { enabled: false } }}
                  beforeMount={handleEditorWillMount}
                  onMount={handleEditorDidMount}
                  onChange={handleDidChangeContent}
                  defaultLanguage="modelica"
                  className="border"
                ></Editor>
              </div>
              <div className="flex-1" id="svg"></div>
              <div className="flex-1">
                <div id="container" style={{ height: "100%", width: "100%" }}></div>
              </div>
            </div>
          </PageLayout.Content>
        </PageLayout>
      </div>
    </>
  );
}

function decode(base64url: string): string {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const buffer = Buffer.from(base64, "base64");
  return new TextDecoder().decode(pako.inflateRaw(buffer));
}

function encode(text: string): string {
  const buffer = pako.deflateRaw(Buffer.from(text, "utf8"));
  const base64 = Buffer.from(buffer).toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_");
}

function flatten(classInstance: ModelicaClassInstance | null): string {
  if (!classInstance) return "";
  const dae = new ModelicaDAE(classInstance.name ?? "DAE", classInstance.description);
  classInstance.accept(new ModelicaFlattener(), ["", dae]);
  const writer = new StringWriter();
  dae.accept(new ModelicaDAEPrinter(writer));
  return writer.toString();
}

function url(editorRef: any, title: any): string {
  const url = new URL(window.location.href);
  const m = encode(editorRef.current.getValue());
  const t = title.length === 0 ? encode("Untitled") : encode(title);
  return `${url.protocol}//${url.host}/modelica?m=${m}&t=${t}`;
}
