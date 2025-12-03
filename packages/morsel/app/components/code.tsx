/* eslint-disable @typescript-eslint/no-explicit-any */

import { Editor } from "@monaco-editor/react";
import { useRef, useState } from "react";
import Parser from "web-tree-sitter";
import {
  Context,
  type Range,
  ModelicaLinter,
  ModelicaClassInstance,
  ModelicaLibrary,
  ModelicaStoredDefinitionSyntaxNode,
  decodeAndInflateBase64Url,
} from "@modelscript/modelscript";
import { configure, InMemory } from "@zenfs/core";
import { WebFileSystem } from "~/util/filesystem";
import { debounce } from "lodash";

export default function Code({
  setClassInstance,
}: {
  setClassInstance: (classInstance: ModelicaClassInstance) => void;
}) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [context, setContext] = useState<Context | null>(null);

  const handleEditorWillMount = async (monaco: any) => {
    monacoRef.current = monaco;
    monaco.languages.register({
      id: "modelica",
    });
    monaco.languages.setMonarchTokensProvider("modelica", modelicaTokensProvider);
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
    setContext(new Context(new WebFileSystem()));
  };
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    const url = new URL(window.location.href);
    const m = url.searchParams.get("m");
    if (m) {
      editorRef.current.setValue(decodeAndInflateBase64Url(m));
    }
    url.search = "";
    history.replaceState({}, "", url.href);
  };
  const handleDidChangeContent = debounce((value: string | undefined) => {
    console.log(1);
    if (!value || !context) return;
    const markers: any[] = [];
    const model = editorRef.current.getModel();
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
    linter.lint(tree);
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
    if (node) {
      linter.lint(node);
      const instance = new ModelicaClassInstance(new ModelicaLibrary(context, ""), null, node.classDefinitions[0]);
      instance.instantiate();
      linter.lint(instance);
      setClassInstance(instance);
    }
    monacoRef.current.editor.setModelMarkers(model, "owner", markers);
  }, 500);
  return (
    <Editor
      beforeMount={handleEditorWillMount}
      defaultLanguage="modelica"
      onChange={handleDidChangeContent}
      onMount={handleEditorDidMount}
      options={{
        automaticLayout: true,
        folding: false,
        glyphMargin: false,
        lineDecorationsWidth: 0,
        lineNumbers: "off",
        lineNumbersMinChars: 0,
        minimap: { enabled: false },
      }}
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
