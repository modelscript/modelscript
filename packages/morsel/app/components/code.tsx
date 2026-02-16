// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Context,
  ModelicaClassInstance,
  ModelicaLinter,
  ModelicaNamedElement,
  ModelicaStoredDefinitionSyntaxNode,
  type Range,
} from "@modelscript/modelscript";
import { Editor, loader, type Monaco, type Theme } from "@monaco-editor/react";
import { Zip } from "@zenfs/archives";
import { configure, InMemory } from "@zenfs/core";
import { debounce } from "lodash";
import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useRef, useState } from "react";
import Parser from "web-tree-sitter";
import { WebFileSystem } from "~/util/filesystem";

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker: function () {
      return new editorWorker();
    },
  };
  loader.config({ monaco });
}

interface CodeEditorProps {
  content: string;
  setContext?: (context: Context) => void;
  setClassInstance: (classInstance: ModelicaClassInstance) => void;
  setEditor: (editor: editor.ICodeEditor) => void;
  onProgress?: (progress: number, message: string) => void;
  theme: Theme;
  embed: boolean;
}

export default function CodeEditor(props: CodeEditorProps) {
  const editorRef = useRef<editor.ICodeEditor>(null);
  const monacoRef = useRef<Monaco>(null);
  const [, setContext] = useState<Context | null>(null);
  const contextRef = useRef<Context | null>(null);
  const classInstanceRef = useRef<ModelicaClassInstance | null>(null);
  const treeRef = useRef<Parser.Tree | null>(null);

  const handleEditorWillMount = async (monaco: Monaco) => {
    monacoRef.current = monaco;
    monaco.languages.register({
      id: "modelica",
    });
    monaco.languages.setMonarchTokensProvider("modelica", modelicaTokensProvider);
    monaco.languages.registerCompletionItemProvider("modelica", {
      triggerCharacters: ["."],
      provideCompletionItems: (model: editor.ITextModel, position: monaco.Position) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const match = textUntilPosition.match(/([a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*)\.$/);
        if (match) {
          const path = match[1];
          const scope = classInstanceRef.current ?? contextRef.current;
          if (!scope) return { suggestions: [] };

          const element = scope.resolveName(path.split("."));
          if (element) {
            const suggestions: monaco.languages.CompletionItem[] = [];
            // eslint-disable-next-line @typescript-eslint/naming-convention
            for (const child of element.elements) {
              if (child instanceof ModelicaNamedElement && child.name) {
                suggestions.push({
                  label: child.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: child.name,
                  detail: child.description ?? undefined,
                  range,
                });
              }
            }
            return { suggestions };
          }
        }
        return { suggestions: [] };
      },
    });

    props.onProgress?.(10, "Initializing parser…");
    await Parser.init();
    props.onProgress?.(25, "Loading Modelica grammar…");
    const Modelica = await Parser.Language.load("/tree-sitter-modelica.wasm");
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    props.onProgress?.(40, "Fetching Modelica Standard Library…");
    try {
      const ModelicaLibrary = await fetch("/ModelicaStandardLibrary_v4.1.0.zip");
      props.onProgress?.(60, "Configuring filesystem…");
      await configure({
        mounts: {
          "/lib": { backend: Zip, data: await ModelicaLibrary.arrayBuffer() },
          "/tmp": InMemory,
        },
      });
    } catch (e) {
      console.error(e);
    }
    props.onProgress?.(80, "Loading libraries…");
    const context = new Context(new WebFileSystem());
    context.addLibrary("/lib/Modelica");
    setContext(context);
    contextRef.current = context;
    props.setContext?.(context);
    props.onProgress?.(100, "Ready");
  };
  const handleEditorDidMount = (editor: editor.ICodeEditor) => {
    editorRef.current = editor;
    props.setEditor(editor);
    setTimeout(() => {
      editor.setValue(editor.getValue());
    }, 100);
  };
  const handleDidChangeContent = debounce((value: string | undefined) => {
    if (!value || !contextRef.current) return;
    const context = contextRef.current;
    const markers: Partial<editor.IMarker>[] = [];
    const model = editorRef.current?.getModel();
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
    const tree = context.parse(".mo", value);
    treeRef.current = tree as any;
    linter.lint(tree);
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
    if (node) {
      linter.lint(node);
      const instance = new ModelicaClassInstance(context, node.classDefinitions[0]);
      instance.instantiate();
      linter.lint(instance);
      props.setClassInstance(instance);
      classInstanceRef.current = instance;
    }
    monacoRef.current.editor.setModelMarkers(model, "owner", markers);
  }, 500);
  return (
    <Editor
      theme={props.theme}
      defaultValue={props.content}
      beforeMount={handleEditorWillMount}
      defaultLanguage="modelica"
      onChange={handleDidChangeContent}
      onMount={handleEditorDidMount}
      options={
        !props.embed
          ? {
              automaticLayout: true,
            }
          : {
              automaticLayout: true,
              folding: false,
              glyphMargin: false,
              lineDecorationsWidth: 0,
              lineNumbers: "off",
              lineNumbersMinChars: 0,
              minimap: { enabled: false },
            }
      }
      height="100%"
      width="100%"
    ></Editor>
  );
}

const modelicaTokensProvider = {
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
};
