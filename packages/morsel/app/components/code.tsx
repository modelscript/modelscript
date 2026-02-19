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
import { debounce } from "lodash";
import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useEffect, useRef } from "react";
import Parser from "web-tree-sitter";
import { format } from "~/util/formatter";

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
  context: Context | null;
  setClassInstance: (classInstance: ModelicaClassInstance) => void;
  setEditor: (editor: editor.ICodeEditor) => void;
  onProgress?: (progress: number, message: string) => void;
  theme: Theme;
  embed: boolean;
}

export default function CodeEditor(props: CodeEditorProps) {
  const editorRef = useRef<editor.ICodeEditor>(null);
  const monacoRef = useRef<Monaco>(null);
  const contextRef = useRef<Context | null>(null);
  const classInstanceRef = useRef<ModelicaClassInstance | null>(null);
  const treeRef = useRef<Parser.Tree | null>(null);

  useEffect(() => {
    contextRef.current = props.context;
    // Re-lint or re-parse if context changes?
    // Maybe trigger a change to re-lint.
    if (editorRef.current && props.context) {
      handleDidChangeContent(editorRef.current.getValue());
    }
  }, [props.context]);

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

    monaco.languages.setLanguageConfiguration("modelica", {
      indentationRules: {
        increaseIndentPattern:
          /^\s*(model|class|record|block|connector|type|package|function|if|for|while|when|else|elseif|equation|algorithm|public|protected|initial equation|initial algorithm|enumeration)\b/,
        decreaseIndentPattern:
          /^\s*(end|else|elseif|equation|algorithm|public|protected|initial equation|initial algorithm)\b/,
      },
      onEnterRules: [
        {
          beforeText: /^\s*\/\//,
          action: { indentAction: monaco.languages.IndentAction.None, appendText: "// " },
        },
      ],
    });
    console.log("Modelica language configuration set");

    try {
      const Modelica = await Parser.Language.load("/tree-sitter-modelica.wasm");
      const parser = new Parser();
      parser.setLanguage(Modelica);
      Context.registerParser(".mo", parser);

      monaco.languages.registerDocumentFormattingEditProvider("modelica", {
        provideDocumentFormattingEdits: (
          model: editor.ITextModel,
          _options: monaco.languages.FormattingOptions,
          _token: monaco.CancellationToken,
        ) => {
          const text = model.getValue();
          const tree = parser.parse(text);
          const formatted = format(tree, text);
          tree.delete();
          return [
            {
              range: model.getFullModelRange(),
              text: formatted,
            },
          ];
        },
      });
    } catch (e) {
      console.error("Failed to setup formatter/parser in CodeEditor", e);
    }

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

    if (!monacoRef.current) return;

    const markers: Partial<editor.IMarker>[] = [];
    const model = editorRef.current?.getModel();
    if (!model) return;

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
              autoIndent: "full",
              tabSize: 2,
              insertSpaces: true,
              guides: {
                indentation: true,
              },
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
