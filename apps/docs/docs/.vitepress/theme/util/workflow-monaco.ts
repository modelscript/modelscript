// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Prong 2: On-Demand Browser Monaco Editor & In-Browser LSP Controller
 * for `HomeWorkflowPairs.vue`.
 *
 * Dynamically loads `monaco-editor` + `editor.worker` when the user clicks the
 * translucent activation overlay, registering full Morsel-grade language features:
 * 1. Monarch lexical grammars & language configurations (`msx-xml`, `msx-modelica`, `msx-sysml`, `msx-ieee2800`)
 * 2. `DocumentSemanticTokensProvider` for CST-backed semantic token coloring
 * 3. `CompletionItemProvider` for context-aware auto-complete (keywords, types, snippets,
 *    live CST symbols, and `.port` member completions)
 * 4. `SignatureHelpProvider` for parameter hints inside `connect()`, `der()`, `Parts.Body()`, etc.
 * 5. `HoverProvider` surfacing TGG Semantic Envelope metadata AND diagnostic details on hover
 * 6. `DefinitionProvider` & `DocumentHighlightProvider` for symbol navigation and occurrence highlighting
 * 7. `CodeActionProvider` offering 1-click Quick Fixes for syntax and `tggReconcilePhysics` lints
 * 8. Surgical narrow delta edits (`computeMinimalTextEdits` + `model.applyEdits`) so bidirectional
 *    updates splice only the modified characters without full-document replacement or flashing.
 */

import { parseModelicaCst } from "../../../../../../packages/runtime/src/interop/cst-polyglot-adapters";
import {
  buildSemanticSymbolMap,
  computeMinimalTextEdits,
  ensureBrowserWasmParsers,
  extractSemanticSpans,
  getTggTargetComponentMetadata,
  MODELICA_GRAMMAR_VOCAB,
  queryWasmLspIntelligence,
  SCAD_GRAMMAR_VOCAB,
  STEP_GRAMMAR_VOCAB,
  SYSML_GRAMMAR_VOCAB,
  type WorkflowDiagnostic,
  type WorkflowSemanticKind,
} from "./workflow-highlighter";

export interface WorkflowMonacoInstance {
  /** Applies narrow character/line delta edits without full-buffer replacement or flashing */
  setValue(nextCode: string): void;
  getValue(): string;
  setLanguage(lang: string): void;
  setDiagnostics(diagnostics: WorkflowDiagnostic[]): void;
  setTheme(isDark: boolean): void;
  focus(): void;
  layout(): void;
  dispose(): void;
}

export interface MountWorkflowMonacoOptions {
  container: HTMLElement;
  initialCode: string;
  lang: string;
  readOnly?: boolean;
  isDark: boolean;
  ariaLabel?: string;
  onChange: (nextCode: string) => void;
}

const SEMANTIC_TOKEN_TYPES: WorkflowSemanticKind[] = [
  "class",
  "parameter",
  "port",
  "state",
  "component",
  "keyword",
  "type",
  "function",
  "property",
  "string",
  "number",
  "comment",
  "operator",
];

const SEMANTIC_TOKEN_MODIFIERS = ["declaration", "readonly"];

function mapLangToMonacoId(lang: string): string {
  switch (lang) {
    case "modelica":
      return "msx-modelica";
    case "sysml":
    case "sysml2":
      return "msx-sysml";
    case "xml":
      return "msx-xml";
    case "scad":
      return "msx-scad";
    case "fea":
      return "msx-fea";
    case "cfd":
      return "msx-cfd";
    case "step":
      return "msx-step";
    default:
      return "msx-ieee2800";
  }
}

function mapMonacoIdToDialect(monacoLangId: string): string {
  switch (monacoLangId) {
    case "msx-modelica":
      return "modelica";
    case "msx-sysml":
      return "sysml";
    case "msx-xml":
      return "xml";
    case "msx-scad":
      return "scad";
    case "msx-fea":
      return "fea";
    case "msx-cfd":
      return "cfd";
    case "msx-step":
      return "step";
    default:
      return "text";
  }
}

let monacoModulePromise: Promise<typeof import("monaco-editor")> | null = null;
let providersRegistered = false;

async function loadMonaco(): Promise<typeof import("monaco-editor")> {
  if (typeof window === "undefined") {
    throw new Error("Monaco Editor can only be loaded in a browser environment.");
  }
  if (!monacoModulePromise) {
    monacoModulePromise = (async () => {
      const modelicaWasmUrl = new URL("../../../../../../languages/modelica/dist/parser.wasm", import.meta.url).href;
      const sysml2WasmUrl = new URL("../../../../../../languages/sysml2/dist/parser.wasm", import.meta.url).href;

      const [workerMod, monaco] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.worker?worker").catch(() => null),
        import("monaco-editor"),
        ensureBrowserWasmParsers(modelicaWasmUrl, sysml2WasmUrl).catch(() => {}),
      ]);

      const g = globalThis as unknown as {
        MonacoEnvironment?: { getWorker: () => Worker };
      };
      if (!g.MonacoEnvironment) {
        g.MonacoEnvironment = {
          getWorker: () => {
            if (workerMod && typeof workerMod.default === "function") {
              return new workerMod.default();
            }
            const blob = new Blob(["self.onmessage = function() {};"], {
              type: "text/javascript",
            });
            return new Worker(URL.createObjectURL(blob));
          },
        };
      }

      // Suppress benign Monaco internal cancellation rejections during rapid typing
      const win = window as unknown as { __msxMonacoCancelFilter?: boolean };
      if (!win.__msxMonacoCancelFilter) {
        win.__msxMonacoCancelFilter = true;
        window.addEventListener("unhandledrejection", (event) => {
          const reason = event.reason;
          if (
            reason &&
            (reason.name === "Canceled" || reason.message === "Canceled" || reason.name === "CancellationError")
          ) {
            event.preventDefault();
          }
        });
      }

      return monaco;
    })();
  }
  const monaco = await monacoModulePromise;
  registerWorkflowLanguagesAndThemes(monaco);
  return monaco;
}

function registerWorkflowLanguagesAndThemes(monaco: typeof import("monaco-editor")): void {
  if (providersRegistered) return;
  providersRegistered = true;

  // Define Morsel-grade Dark & Light themes with explicit semantic token rules
  monaco.editor.defineTheme("msx-workflow-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c084fc", fontStyle: "bold" },
      { token: "type", foreground: "38bdf8" },
      { token: "function", foreground: "60a5fa" },
      { token: "class", foreground: "2dd4bf", fontStyle: "bold" },
      { token: "parameter", foreground: "fb923c" },
      { token: "port", foreground: "38bdf8" },
      { token: "state", foreground: "f472b6", fontStyle: "italic" },
      { token: "component", foreground: "a78bfa" },
      { token: "property", foreground: "93c5fd" },
      { token: "tag", foreground: "f472b6" },
      { token: "attribute.name", foreground: "93c5fd" },
      { token: "attribute.value", foreground: "86efac" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "fbbf24" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "pass", foreground: "34d399", fontStyle: "bold" },
      { token: "fail", foreground: "f87171", fontStyle: "bold" },
    ],
    colors: {
      "editor.background": "#00000000",
      "editorGutter.background": "#00000000",
      "editorLineNumber.foreground": "#64748b",
      "editorLineNumber.activeForeground": "#e2e8f0",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorError.foreground": "#f87171",
      "editorWarning.foreground": "#fbbf24",
      "editorInfo.foreground": "#38bdf8",
    },
  });

  monaco.editor.defineTheme("msx-workflow-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "7c3aed", fontStyle: "bold" },
      { token: "type", foreground: "0284c7" },
      { token: "function", foreground: "2563eb" },
      { token: "class", foreground: "0d9488", fontStyle: "bold" },
      { token: "parameter", foreground: "c2410c" },
      { token: "port", foreground: "0369a1" },
      { token: "state", foreground: "be185d", fontStyle: "italic" },
      { token: "component", foreground: "6d28d9" },
      { token: "property", foreground: "1d4ed8" },
      { token: "tag", foreground: "be185d" },
      { token: "attribute.name", foreground: "1d4ed8" },
      { token: "attribute.value", foreground: "15803d" },
      { token: "string", foreground: "15803d" },
      { token: "number", foreground: "b45309" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "pass", foreground: "059669", fontStyle: "bold" },
      { token: "fail", foreground: "dc2626", fontStyle: "bold" },
    ],
    colors: {
      "editor.background": "#00000000",
      "editorGutter.background": "#00000000",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#334155",
      "editor.lineHighlightBackground": "#00000006",
      "editorError.foreground": "#dc2626",
      "editorWarning.foreground": "#d97706",
      "editorInfo.foreground": "#0284c7",
    },
  });

  const langIds = [
    "msx-modelica",
    "msx-sysml",
    "msx-xml",
    "msx-ieee2800",
    "msx-scad",
    "msx-fea",
    "msx-cfd",
    "msx-step",
  ];
  for (const id of langIds) {
    monaco.languages.register({ id });
  }

  // Language Configurations (brackets, auto-closing pairs, comments, word pattern)
  const codeLangConfig: import("monaco-editor").languages.LanguageConfiguration = {
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "/*", close: " */", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
    wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
  };

  monaco.languages.setLanguageConfiguration("msx-modelica", codeLangConfig);
  monaco.languages.setLanguageConfiguration("msx-sysml", codeLangConfig);
  monaco.languages.setLanguageConfiguration("msx-scad", codeLangConfig);
  monaco.languages.setLanguageConfiguration("msx-fea", codeLangConfig);
  monaco.languages.setLanguageConfiguration("msx-cfd", codeLangConfig);
  monaco.languages.setLanguageConfiguration("msx-step", codeLangConfig);
  monaco.languages.setLanguageConfiguration("msx-xml", {
    comments: { blockComment: ["<!--", "-->"] },
    brackets: [["<", ">"]],
    autoClosingPairs: [
      { open: "<", close: ">" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "<!--", close: "-->", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "<", close: ">" },
      { open: '"', close: '"' },
    ],
    wordPattern: /[A-Za-z_:][\w:.-]*/g,
  });
  monaco.languages.setLanguageConfiguration("msx-ieee2800", {
    brackets: [
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'" },
    ],
    wordPattern: /[A-Za-z0-9_%.]+/g,
  });

  // 1. Modelica Monarch Grammar (vocabulary derived from @modelscript/dsl SYNTAX_NAMES)
  monaco.languages.setMonarchTokensProvider("msx-modelica", {
    keywords: Array.from(MODELICA_GRAMMAR_VOCAB.keywords),
    typeKeywords: Array.from(MODELICA_GRAMMAR_VOCAB.typeKeywords),
    builtins: Array.from(MODELICA_GRAMMAR_VOCAB.builtinFunctions),
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/-?\d+\.\d+([eE][+-]?\d+)?/, "number"],
        [/-?\d+/, "number"],
        [
          /[A-Za-z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@builtins": "function",
              "@default": "identifier",
            },
          },
        ],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  // 2. SysML v2 Monarch Grammar (vocabulary derived from @modelscript/dsl SYNTAX_NAMES)
  monaco.languages.setMonarchTokensProvider("msx-sysml", {
    keywords: Array.from(SYSML_GRAMMAR_VOCAB.keywords),
    typeKeywords: Array.from(SYSML_GRAMMAR_VOCAB.typeKeywords),
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/-?\d+\.\d+([eE][+-]?\d+)?/, "number"],
        [/-?\d+/, "number"],
        [
          /[A-Za-z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@default": "identifier",
            },
          },
        ],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  // 3. XML Monarch Grammar
  monaco.languages.setMonarchTokensProvider("msx-xml", {
    tokenizer: {
      root: [
        [/<!--/, "comment", "@comment"],
        [/(<\/?)([A-Za-z_:][\w:.-]*)/, ["delimiter", { token: "tag", next: "@tag" }]],
        [/-?\d+\.\d+([eE][+-]?\d+)?/, "number"],
        [/-?\d+/, "number"],
      ],
      comment: [
        [/[^-]+/, "comment"],
        [/-->/, "comment", "@pop"],
        [/-/, "comment"],
      ],
      tag: [
        [/[ \t\r\n]+/, ""],
        [/([A-Za-z_:][\w:.-]*)(\s*=\s*)("[^"]*")/, ["attribute.name", "delimiter", "attribute.value"]],
        [/\/?>/, "delimiter", "@pop"],
      ],
    },
  });

  // 4. IEEE 2800 Verification Report Monarch Grammar
  monaco.languages.setMonarchTokensProvider("msx-ieee2800", {
    tokenizer: {
      root: [
        [/\[PASS\]/, "pass"],
        [/\[FAIL\]/, "fail"],
        [/\[Limit:[^\]]*\]/, "comment"],
        [/Clause\s+\d+(\.\d+)+/, "class"],
        [/\b(T_step|I_post|I_pre|V_sag|Kp_v|Ki_v)\b/, "parameter"],
        [/'[^']*'/, "string"],
        [/-?\d+(\.\d+)?(\s*%|\s*ms|\s*s|\s*pu)?/, "number"],
      ],
    },
  });

  // 4b. CAD / CAE / GD&T Monarch Grammars (scad, fea, cfd, step) — derived from SCAD_SYNTAX_NAMES & STEP_SYNTAX_NAMES
  const cadCaeTokenizer = {
    keywords: [...SCAD_GRAMMAR_VOCAB.keywords, ...STEP_GRAMMAR_VOCAB.keywords],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/^\s*\*\*.*$/, "comment"],
        [/\/\*[\s\S]*?\*\//, "comment"],
        [/^\s*\*[A-Za-z_][\w-]*/, "keyword"],
        [/#\d+/, "port"],
        [/\b[A-Z][A-Z0-9_]{3,}\b/, "class"],
        [/"[^"]*"|'[^']*'/, "string"],
        [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
        [/\b[A-Za-z_]\w*(?=\s*=)/, "parameter"],
        [
          /\b[A-Za-z_]\w*\b/,
          {
            cases: {
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],
      ],
    },
  } as unknown as import("monaco-editor").languages.IMonarchLanguage;
  monaco.languages.setMonarchTokensProvider("msx-scad", cadCaeTokenizer);
  monaco.languages.setMonarchTokensProvider("msx-fea", cadCaeTokenizer);
  monaco.languages.setMonarchTokensProvider("msx-cfd", cadCaeTokenizer);
  monaco.languages.setMonarchTokensProvider("msx-step", cadCaeTokenizer);

  // 5. Register Semantic Tokens, Hover, Auto-Complete, Signature Help, Definition, DocumentHighlight & CodeAction
  const legend: import("monaco-editor").languages.SemanticTokensLegend = {
    tokenTypes: SEMANTIC_TOKEN_TYPES,
    tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
  };
  const tggComponentMeta = getTggTargetComponentMetadata();

  for (const langId of langIds) {
    const dialect = mapMonacoIdToDialect(langId);

    // 5a. Semantic Tokens Provider
    monaco.languages.registerDocumentSemanticTokensProvider(langId, {
      getLegend: () => legend,
      provideDocumentSemanticTokens: (model) => {
        const spans = extractSemanticSpans(model.getValue(), dialect);
        spans.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.startCol - b.startCol));

        const data: number[] = [];
        let prevLine = 0;
        let prevChar = 0;

        for (const s of spans) {
          const typeIdx = SEMANTIC_TOKEN_TYPES.indexOf(s.kind);
          if (typeIdx === -1 || s.length <= 0) continue;
          const deltaLine = s.line - prevLine;
          const deltaStart = deltaLine === 0 ? s.startCol - prevChar : s.startCol;
          if (deltaStart < 0) continue;

          let modMask = 0;
          if (s.declaration) modMask |= 1;
          if (s.readonly) modMask |= 2;

          data.push(deltaLine, deltaStart, s.length, typeIdx, modMask);
          prevLine = s.line;
          prevChar = s.startCol;
        }

        return { data: new Uint32Array(data) };
      },
      releaseDocumentSemanticTokens: () => {},
    });

    // 5b. Hover Provider (surfaces both active diagnostics and TGG Semantic Envelope info)
    monaco.languages.registerHoverProvider(langId, {
      provideHover: (model, position) => {
        const contents: import("monaco-editor").IMarkdownString[] = [];
        const markers = monaco.editor.getModelMarkers({ resource: model.uri });
        for (const m of markers) {
          if (
            position.lineNumber >= m.startLineNumber &&
            position.lineNumber <= m.endLineNumber &&
            position.column >= m.startColumn &&
            position.column <= m.endColumn
          ) {
            const sevLabel =
              m.severity === monaco.MarkerSeverity.Error
                ? "Error"
                : m.severity === monaco.MarkerSeverity.Warning
                  ? "Warning"
                  : "Info";
            contents.push({
              value: `**${sevLabel}**: ${m.message}`,
            });
          }
        }

        const spans = extractSemanticSpans(model.getValue(), dialect);
        const targetLine = position.lineNumber - 1;
        const targetCol = position.column - 1;
        const hit = spans.find(
          (s) =>
            s.line === targetLine &&
            targetCol >= s.startCol &&
            targetCol <= s.startCol + s.length &&
            Boolean(s.hoverMarkdown),
        );
        if (hit?.hoverMarkdown) {
          contents.push({ value: hit.hoverMarkdown });
          contents.push({
            value: `*Semantic token:* \`${hit.kind}\` · *TGG Envelope verified*`,
          });
        }

        if (contents.length === 0) return null;
        return {
          range: hit
            ? new monaco.Range(targetLine + 1, hit.startCol + 1, targetLine + 1, hit.startCol + hit.length + 1)
            : new monaco.Range(
                position.lineNumber,
                Math.max(1, position.column - 1),
                position.lineNumber,
                position.column + 1,
              ),
          contents,
        };
      },
    });

    // 5c. Completion Item Provider (Auto-Complete / IntelliSense)
    monaco.languages.registerCompletionItemProvider(langId, {
      triggerCharacters: [".", "<", " ", '"', "=", ":", "("],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const code = model.getValue();
        const K = monaco.languages.CompletionItemKind;
        const InsertAsSnippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
        const suggestions: import("monaco-editor").languages.CompletionItem[] = [];

        if (dialect === "modelica") {
          const cst = parseModelicaCst(code);
          // Check if user just typed `<component>.` for port/modifier member completion derived from CST & TGG rules
          const dotMatch = /([A-Za-z_]\w*)\.[A-Za-z_0-9]*$/.exec(linePrefix);
          if (dotMatch) {
            const compName = dotMatch[1]!;
            const comp = cst.components.find((c) => c.name === compName);
            const memberMap = new Map<string, string>();

            // 1. Live CST modifier parameters on the component declaration
            for (const mod of comp?.modifierNodes ?? []) {
              memberMap.set(mod.name, `Component modifier ${mod.name} = ${mod.value}`);
            }

            // 2. Declarative TGG rule target pattern bindings for this component's type
            const shortType = comp?.typeSpecifier.split(".").pop() ?? "";
            const tggMeta =
              (comp ? tggComponentMeta.get(comp.typeSpecifier) : undefined) ?? tggComponentMeta.get(shortType);
            if (tggMeta) {
              for (const modName of tggMeta.modifiers) {
                const b = tggMeta.boundsByProp[modName];
                const boundNote = b ? ` [${b.min ?? "-∞"}, ${b.max ?? "∞"}]` : "";
                memberMap.set(modName, `TGG ${tggMeta.ruleName} parameter${boundNote}`);
              }
            }

            // 3. Connector ports referenced in `connect(compName.<port>, ...)` equations in the CST
            for (const conn of cst.connections) {
              for (const endpoint of [conn.from, conn.to]) {
                if (endpoint.startsWith(`${compName}.`)) {
                  const portName = endpoint.slice(compName.length + 1);
                  if (portName) {
                    memberMap.set(portName, `Connector port in connect() equation`);
                  }
                }
              }
            }

            // 4. Standard MultiBody / Causal Block connector ports by Modelica domain package
            if (
              comp?.typeSpecifier.includes("Body") ||
              comp?.typeSpecifier.includes("Revolute") ||
              compName === "world"
            ) {
              if (!memberMap.has("frame_a")) {
                memberMap.set("frame_a", "MultiBody coordinate frame connector A");
              }
              if (!memberMap.has("frame_b")) {
                memberMap.set("frame_b", "MultiBody coordinate frame connector B");
              }
            } else {
              if (!memberMap.has("u")) memberMap.set("u", "Causal block input port");
              if (!memberMap.has("y")) memberMap.set("y", "Causal block output port");
            }

            for (const [name, detail] of memberMap.entries()) {
              suggestions.push({
                label: name,
                kind: K.Field,
                detail,
                insertText: name,
                range,
              });
            }
            return { suggestions };
          }

          // Live CST components, parameters, ports, states
          for (const comp of cst.components) {
            suggestions.push({
              label: comp.name,
              kind:
                comp.causality === "parameter"
                  ? K.Constant
                  : comp.causality === "input" || comp.causality === "output"
                    ? K.Interface
                    : K.Variable,
              detail: `${comp.typePrefix ? `${comp.typePrefix} ` : ""}${comp.typeSpecifier}`,
              documentation: comp.description ?? `Declared Modelica ${comp.causality} '${comp.name}'`,
              insertText: comp.name,
              range,
            });
          }

          // Modelica keywords, types & snippets
          const snippets: { label: string; insert: string; detail: string }[] = [
            {
              label: "parameter Real",
              insert: 'parameter Real ${1:k} = ${2:1.0} "${3:Parameter description}";',
              detail: "Declare a TGG-mapped Real parameter",
            },
            {
              label: "input Real",
              insert: "input Real ${1:u};",
              detail: "Declare a causal Real input signal",
            },
            {
              label: "output Real",
              insert: "output Real ${1:y}(start = ${2:0.0});",
              detail: "Declare a causal Real output signal",
            },
            {
              label: "connect(a, b)",
              insert: "connect(${1:source.y}, ${2:target.u});",
              detail: "Connect two causal/acausal ports",
            },
            {
              label: "der(x)",
              insert: "der(${1:omega}) = ${2:0.0};",
              detail: "Time derivative ODE equation",
            },
            {
              label: "Parts.Body",
              insert: "Parts.Body ${1:link_name}(m = ${2:2.5}, I_11 = ${3:0.25}, I_22 = ${3:0.25}, I_33 = ${3:0.25});",
              detail: "Modelica.Mechanics.MultiBody.Parts.Body",
            },
            {
              label: "Joints.Revolute",
              insert: "Joints.Revolute ${1:joint_name}(n = {${2:0, 1, 0}});",
              detail: "Modelica.Mechanics.MultiBody.Joints.Revolute",
            },
            {
              label: "Modelica.Blocks.Discrete.TransferFunction",
              insert:
                "Modelica.Blocks.Discrete.TransferFunction ${1:Filter}(b={${2:0.1, -0.09}}, a={${3:1, -0.95}}, samplePeriod=${4:0.001});",
              detail: "Discrete-time transfer function block",
            },
          ];
          for (const s of snippets) {
            suggestions.push({
              label: s.label,
              kind: K.Snippet,
              detail: s.detail,
              insertText: s.insert,
              insertTextRules: InsertAsSnippet,
              range,
            });
          }
          // Native WASM LspFacade LR state-table expected tokens + @modelscript/dsl grammar vocabulary
          const wasmIntel = queryWasmLspIntelligence(code, "modelica", position.lineNumber - 1, position.column - 1);
          const seenKw = new Set<string>();
          for (const expected of wasmIntel.expectedTokens) {
            seenKw.add(expected);
            suggestions.push({
              label: expected,
              kind: K.Keyword,
              detail: "Expected by Modelica WASM GLR grammar state",
              insertText: expected,
              sortText: `0_${expected}`,
              range,
            });
          }
          for (const kw of MODELICA_GRAMMAR_VOCAB.keywords) {
            if (seenKw.has(kw)) continue;
            suggestions.push({
              label: kw,
              kind: K.Keyword,
              insertText: kw,
              range,
            });
          }
          for (const ty of MODELICA_GRAMMAR_VOCAB.typeKeywords) {
            if (seenKw.has(ty)) continue;
            suggestions.push({
              label: ty,
              kind: K.TypeParameter,
              insertText: ty,
              range,
            });
          }
        } else if (dialect === "sysml") {
          const symMap = buildSemanticSymbolMap(code, "sysml");
          for (const [name, info] of symMap.entries()) {
            suggestions.push({
              label: name,
              kind: info.kind === "class" ? K.Class : info.kind === "port" ? K.Interface : K.Property,
              detail: `SysML v2 ${info.kind}`,
              documentation: info.detail,
              insertText: name,
              range,
            });
          }
          const sysmlSnippets: { label: string; insert: string; detail: string }[] = [
            {
              label: "requirement def",
              insert:
                'requirement def ${1:REQ_01_Def} {\n  doc /* ${2:Requirement text} */\n  attribute asilLevel : String = "${3:ASIL-D}";\n  attribute ${4:braking_distance} : Scalar;\n  require constraint { ${4:braking_distance} <= ${5:35} }\n}',
              detail: "SysML v2 requirement definition block",
            },
            {
              label: "require constraint",
              insert: "require constraint { ${1:braking_distance} <= ${2:35} }",
              detail: "SysML v2 quantitative requirement constraint",
            },
            {
              label: "attribute",
              insert: 'attribute ${1:asilLevel} : ${2:String} = "${3:ASIL-D}";',
              detail: "SysML v2 attribute declaration",
            },
            {
              label: "in port",
              insert: "in port ${1:WheelAngleReq};",
              detail: "SysML v2 directed input port (maps to AUTOSAR R-PORT-PROTOTYPE)",
            },
            {
              label: "out port",
              insert: "out port ${1:MotorTorqueCmd};",
              detail: "SysML v2 directed output port (maps to AUTOSAR P-PORT-PROTOTYPE)",
            },
            {
              label: "action",
              insert: "action ${1:RE_ComputeTorque};",
              detail: "SysML v2 action (maps to AUTOSAR RUNNABLE-ENTITY)",
            },
            {
              label: "part def",
              insert:
                "part def ${1:Controller} {\n  in port ${2:SensorIn};\n  out port ${3:ActuatorOut};\n  action ${4:RE_Step};\n}",
              detail: "SysML v2 part definition",
            },
          ];
          for (const s of sysmlSnippets) {
            suggestions.push({
              label: s.label,
              kind: K.Snippet,
              detail: s.detail,
              insertText: s.insert,
              insertTextRules: InsertAsSnippet,
              range,
            });
          }
          const wasmIntel = queryWasmLspIntelligence(code, "sysml", position.lineNumber - 1, position.column - 1);
          const seenSysmlKw = new Set<string>();
          for (const expected of wasmIntel.expectedTokens) {
            seenSysmlKw.add(expected);
            suggestions.push({
              label: expected,
              kind: K.Keyword,
              detail: "Expected by SysML v2 WASM GLR grammar state",
              insertText: expected,
              sortText: `0_${expected}`,
              range,
            });
          }
          for (const kw of SYSML_GRAMMAR_VOCAB.keywords) {
            if (seenSysmlKw.has(kw)) continue;
            suggestions.push({
              label: kw,
              kind: K.Keyword,
              insertText: kw,
              range,
            });
          }
        } else if (dialect === "xml") {
          const xmlSnippets: { label: string; insert: string; detail: string }[] = [
            {
              label: "SPEC-OBJECT (ReqIF)",
              insert:
                '<SPEC-OBJECT IDENTIFIER="${1:REQ-BRAKE-01}" LONG-NAME="${2:Braking Distance}">\n  <VALUES>\n    <ATTRIBUTE-VALUE-STRING>\n      <THE-VALUE>Vehicle braking_distance must be &lt;= ${3:35} m. ${4:ASIL-D}.</THE-VALUE>\n    </ATTRIBUTE-VALUE-STRING>\n  </VALUES>\n</SPEC-OBJECT>',
              detail: "OMG ReqIF 1.2 SPEC-OBJECT requirement node",
            },
            {
              label: "Block DiscreteFilter (Simulink)",
              insert:
                '<Block BlockType="DiscreteFilter" Name="${1:LeadLag}">\n  <P Name="Numerator">[${2:0.1, -0.09}]</P>\n  <P Name="Denominator">[${3:1.0, -0.95}]</P>\n  <P Name="SampleTime">${4:0.001}</P>\n</Block>',
              detail: "Simulink discrete transfer function block",
            },
            {
              label: "Line (Simulink)",
              insert: '<Line><P Name="Src">${1:DamperError}#out:1</P><P Name="Dst">${2:LeadLag}#in:1</P></Line>',
              detail: "Simulink signal routing line",
            },
            {
              label: "R-PORT-PROTOTYPE (AUTOSAR)",
              insert: "<R-PORT-PROTOTYPE><SHORT-NAME>${1:WheelAngleReq}</SHORT-NAME></R-PORT-PROTOTYPE>",
              detail: "AUTOSAR required port prototype",
            },
            {
              label: "P-PORT-PROTOTYPE (AUTOSAR)",
              insert: "<P-PORT-PROTOTYPE><SHORT-NAME>${1:MotorTorqueCmd}</SHORT-NAME></P-PORT-PROTOTYPE>",
              detail: "AUTOSAR provided port prototype",
            },
            {
              label: "RUNNABLE-ENTITY (AUTOSAR)",
              insert: "<RUNNABLE-ENTITY><SHORT-NAME>${1:RE_ComputeTorque}</SHORT-NAME></RUNNABLE-ENTITY>",
              detail: "AUTOSAR internal behavior runnable entity",
            },
            {
              label: "link (URDF)",
              insert: '<link name="${1:wrist_link}"><inertial><mass value="${2:1.5}"/></inertial></link>',
              detail: "ROS URDF rigid body link with inertial mass",
            },
            {
              label: "joint (URDF)",
              insert:
                '<joint name="${1:elbow_flex}" type="revolute">\n  <parent link="${2:upper_arm}"/>\n  <child link="${3:forearm}"/>\n  <axis xyz="${4:0 1 0}"/>\n  <limit lower="${5:-2.09}" upper="${6:2.09}" effort="${7:150}" velocity="${8:3.14}"/>\n</joint>',
              detail: "ROS URDF revolute joint with physical limits",
            },
            {
              label: "param Kp_v / Ki_v (PSCAD)",
              insert: '<param name="${1|Kp_v,Ki_v,V_nom,P_rated,LVRT_mode|}" value="${2:2.5}"/>',
              detail: "PSCAD inverter control parameter",
            },
            {
              label: "Float64 (FMI 3.0)",
              insert:
                '<Float64 name="${1:v_in}" valueReference="${2:2}" causality="${3|input,output,parameter|}" variability="${4|continuous,fixed,discrete|}" start="${5:0}"/>',
              detail: "FMI 3.0 ModelVariables Float64 scalar variable",
            },
          ];
          for (const s of xmlSnippets) {
            suggestions.push({
              label: s.label,
              kind: K.Snippet,
              detail: s.detail,
              insertText: s.insert,
              insertTextRules: InsertAsSnippet,
              range,
            });
          }
        } else {
          // IEEE 2800 Report completions
          for (const item of [
            { label: "[PASS]", insert: "[PASS]", detail: "Clause compliant status" },
            { label: "[FAIL]", insert: "[FAIL]", detail: "Clause non-compliant status" },
            {
              label: "T_step = 20.0 ms",
              insert: "T_step = ${1:20.0} ms",
              detail: "Synthesize PSCAD Kp_v = 45 / T_step via inverse TGG law",
            },
            {
              label: "I_post / I_pre = 95.0%",
              insert: "I_post / I_pre = ${1:95.0}%",
              detail: "Synthesize PSCAD Ki_v = (Recov% - 90) * 4 via inverse TGG law",
            },
          ]) {
            suggestions.push({
              label: item.label,
              kind: K.Snippet,
              detail: item.detail,
              insertText: item.insert,
              insertTextRules: InsertAsSnippet,
              range,
            });
          }
        }

        return { suggestions };
      },
    });

    // 5d. Signature Help Provider (Parameter Hints derived from declarative TGG rules & live CST)
    if (dialect === "modelica") {
      monaco.languages.registerSignatureHelpProvider(langId, {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: (model, position) => {
          const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
          const callMatch = /\b([A-Za-z_][\w.]*)\s*\(([^)]*)$/.exec(linePrefix);
          if (!callMatch) return null;
          const rawCallee = callMatch[1]!;
          const shortFn = rawCallee.split(".").pop() ?? rawCallee;
          const argsSlice = callMatch[2]!;
          const activeParameter = (argsSlice.match(/,/g) ?? []).length;

          let sig: import("monaco-editor").languages.SignatureInformation | undefined;
          if (shortFn === "connect") {
            sig = {
              label: "connect(connectorA, connectorB)",
              documentation: "Bijective TGG connection equation linking two causal or acausal ports.",
              parameters: [
                {
                  label: "connectorA",
                  documentation: "Source or first connector port",
                },
                {
                  label: "connectorB",
                  documentation: "Target or second connector port",
                },
              ],
            };
          } else if (shortFn === "der") {
            sig = {
              label: "der(stateVariable)",
              documentation: "Continuous-time derivative dx/dt of state variable x.",
              parameters: [
                {
                  label: "stateVariable",
                  documentation: "Continuous state variable",
                },
              ],
            };
          } else {
            const cst = parseModelicaCst(model.getValue());
            const compByName = cst.components.find(
              (c) => c.name === rawCallee || c.typeSpecifier === rawCallee || c.typeSpecifier.endsWith(`.${shortFn}`),
            );
            const tggMeta =
              tggComponentMeta.get(rawCallee) ??
              tggComponentMeta.get(shortFn) ??
              (compByName ? tggComponentMeta.get(compByName.typeSpecifier) : undefined);

            if (tggMeta) {
              const params = tggMeta.modifiers.map((modName) => {
                const b = tggMeta.boundsByProp[modName];
                const boundStr = b ? ` (envelope [${b.min ?? "-∞"}, ${b.max ?? "∞"}])` : "";
                return {
                  label: `${modName}=...`,
                  documentation: `TGG ${tggMeta.ruleName} modifier '${modName}'${boundStr}`,
                };
              });
              sig = {
                label: `${tggMeta.typeName}(${params.map((p) => p.label).join(", ")})`,
                documentation: `Modelica component mapped via declarative TGG rule '${tggMeta.ruleName}'.`,
                parameters: params,
              };
            } else if (compByName && compByName.modifierNodes.length > 0) {
              const params = compByName.modifierNodes.map((m) => ({
                label: `${m.name}=${m.value}`,
                documentation: `Component modifier '${m.name}' on '${compByName.typeSpecifier}'`,
              }));
              sig = {
                label: `${compByName.typeSpecifier}(${params.map((p) => p.label).join(", ")})`,
                documentation: `Modelica component '${compByName.name}' (${compByName.typeSpecifier}).`,
                parameters: params,
              };
            }
          }

          if (!sig || sig.parameters.length === 0) return null;

          return {
            value: {
              signatures: [sig],
              activeSignature: 0,
              activeParameter: Math.min(activeParameter, sig.parameters.length - 1),
            },
            dispose: () => {},
          };
        },
      });
    }

    // 5e. Definition Provider & Document Highlight Provider (backed by WASM LspFacade getDefinition / getReferences)
    monaco.languages.registerDefinitionProvider(langId, {
      provideDefinition: (model, position) => {
        const code = model.getValue();
        if (dialect === "modelica" || dialect === "sysml") {
          const wasmIntel = queryWasmLspIntelligence(code, dialect, position.lineNumber - 1, position.column - 1);
          if (wasmIntel.definitionRange) {
            const d = wasmIntel.definitionRange;
            return {
              uri: model.uri,
              range: new monaco.Range(d.startLine, d.startCol, d.endLine, d.endCol),
            };
          }
        }
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const lines = code.split("\n");
        const escaped = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const declRe = new RegExp(`\\b${escaped}\\b`);
        for (let i = 0; i < lines.length; i++) {
          const m = declRe.exec(lines[i]!);
          if (m) {
            return {
              uri: model.uri,
              range: new monaco.Range(i + 1, m.index + 1, i + 1, m.index + 1 + word.word.length),
            };
          }
        }
        return null;
      },
    });

    monaco.languages.registerDocumentHighlightProvider(langId, {
      provideDocumentHighlights: (model, position) => {
        const code = model.getValue();
        if (dialect === "modelica" || dialect === "sysml") {
          const wasmIntel = queryWasmLspIntelligence(code, dialect, position.lineNumber - 1, position.column - 1);
          if (wasmIntel.referenceRanges.length > 0) {
            return wasmIntel.referenceRanges.map((r) => ({
              range: new monaco.Range(r.startLine, r.startCol, r.endLine, r.endCol),
              kind: monaco.languages.DocumentHighlightKind.Read,
            }));
          }
        }
        const word = model.getWordAtPosition(position);
        if (!word) return [];
        const lines = code.split("\n");
        const escaped = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${escaped}\\b`, "g");
        const highlights: import("monaco-editor").languages.DocumentHighlight[] = [];
        for (let i = 0; i < lines.length; i++) {
          let m: RegExpExecArray | null;
          while ((m = re.exec(lines[i]!)) !== null) {
            highlights.push({
              range: new monaco.Range(i + 1, m.index + 1, i + 1, m.index + 1 + word.word.length),
              kind: monaco.languages.DocumentHighlightKind.Read,
            });
          }
        }
        return highlights;
      },
    });

    // 5f. Code Action Provider (Quick Fixes derived from GLR expectedTokens & tggReconcilePhysics envelope bounds)
    monaco.languages.registerCodeActionProvider(langId, {
      provideCodeActions: (model, _range, context) => {
        const actions: import("monaco-editor").languages.CodeAction[] = [];
        for (const marker of context.markers) {
          const lineContent = model.getLineContent(marker.startLineNumber);
          if (
            marker.message.includes("Missing ';'") ||
            marker.message.includes("Missing semicolon ';'") ||
            marker.code === "M1002" ||
            marker.code === "SYSML-1002"
          ) {
            actions.push({
              title: "Insert missing semicolon ';'",
              kind: "quickfix",
              isPreferred: true,
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: new monaco.Range(
                        marker.startLineNumber,
                        lineContent.length + 1,
                        marker.startLineNumber,
                        lineContent.length + 1,
                      ),
                      text: ";",
                    },
                  },
                ],
              },
            });
          } else if (marker.message.includes("feasible envelope [")) {
            // Parse property name, current value, and [min, max] directly from the `tggReconcilePhysics` diagnostic
            const envMatch =
              /'([^']+)'\s*\((-?\d+(?:\.\d+)?)\)\s*is outside feasible envelope\s*\[\s*(-?\d+(?:\.\d+)?|-Infinity)\s*,\s*(-?\d+(?:\.\d+)?|Infinity)\s*\]/.exec(
                marker.message,
              );
            if (envMatch) {
              const propName = envMatch[1]!;
              const currentVal = Number(envMatch[2]);
              const minBound = envMatch[3] === "-Infinity" ? -Infinity : Number(envMatch[3]);
              const maxBound = envMatch[4] === "Infinity" ? Infinity : Number(envMatch[4]);
              const clampedVal =
                currentVal < minBound
                  ? Math.max(minBound, minBound <= 0.01 ? 0.5 : minBound)
                  : Math.min(maxBound, maxBound);
              const clampedStr = Number.isInteger(clampedVal) ? `${clampedVal}.0` : String(clampedVal);
              const fixedLine = lineContent.replace(/-?\d+(?:\.\d+)?/, clampedStr);
              if (fixedLine !== lineContent) {
                actions.push({
                  title: `Clamp '${propName}' to feasible tggReconcilePhysics envelope [${minBound}, ${maxBound}] (${clampedStr})`,
                  kind: "quickfix",
                  isPreferred: true,
                  edit: {
                    edits: [
                      {
                        resource: model.uri,
                        versionId: model.getVersionId(),
                        textEdit: {
                          range: new monaco.Range(
                            marker.startLineNumber,
                            1,
                            marker.startLineNumber,
                            lineContent.length + 1,
                          ),
                          text: fixedLine,
                        },
                      },
                    ],
                  },
                });
              }
            }
          }
        }
        return { actions, dispose: () => {} };
      },
    });
  }
}

/**
 * Mounts a full Monaco Editor instance into `options.container` with semantic
 * tokens, auto-complete, signature help, hover tooltips, quick-fix code actions,
 * live compiler/TGG envelope markers, and surgical narrow delta updates.
 */
export async function mountWorkflowMonacoPane(options: MountWorkflowMonacoOptions): Promise<WorkflowMonacoInstance> {
  const monaco = await loadMonaco();
  const monacoLangId = mapLangToMonacoId(options.lang);
  const model = monaco.editor.createModel(options.initialCode, monacoLangId);

  let suppressChange = false;

  const editor = monaco.editor.create(options.container, {
    model,
    theme: options.isDark ? "msx-workflow-dark" : "msx-workflow-light",
    readOnly: options.readOnly ?? false,
    ariaLabel: options.ariaLabel ?? "ModelScript Live Workflow Editor",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: false,
    renderLineHighlight: "line",
    fontSize: 12.5,
    lineHeight: 20,
    fontFamily: "var(--vp-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
    padding: { top: 12, bottom: 12 },
    wordWrap: "on",
    wrappingStrategy: "advanced",
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
      alwaysConsumeMouseWheel: false,
    },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    contextmenu: true,
    fixedOverflowWidgets: true,
    "semanticHighlighting.enabled": true,
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: "on",
    tabCompletion: "on",
    wordBasedSuggestions: "currentDocument",
    parameterHints: { enabled: true },
    hover: { enabled: true, delay: 150, sticky: true },
    bracketPairColorization: { enabled: true },
    tabSize: 2,
    automaticLayout: true,
  });

  const sub = model.onDidChangeContent(() => {
    if (suppressChange) return;
    options.onChange(model.getValue());
  });

  return {
    setValue(nextCode: string): void {
      const currentCode = model.getValue();
      if (currentCode === nextCode) return;

      const minimalEdits = computeMinimalTextEdits(currentCode, nextCode);
      if (minimalEdits.length === 0) return;

      suppressChange = true;
      try {
        const operations: import("monaco-editor").editor.IIdentifiedSingleEditOperation[] = minimalEdits.map((e) => ({
          range: new monaco.Range(e.startLine, e.startCol, e.endLine, e.endCol),
          text: e.text,
          forceMoveMarkers: true,
        }));
        model.applyEdits(operations);
      } finally {
        suppressChange = false;
      }
    },
    getValue(): string {
      return model.getValue();
    },
    setLanguage(lang: string): void {
      const nextId = mapLangToMonacoId(lang);
      monaco.editor.setModelLanguage(model, nextId);
    },
    setDiagnostics(diagnostics: WorkflowDiagnostic[]): void {
      const markers: import("monaco-editor").editor.IMarkerData[] = diagnostics.map((d) => ({
        startLineNumber: d.startLine,
        startColumn: d.startCol,
        endLineNumber: d.endLine,
        endColumn: d.endCol,
        severity:
          d.severity === "error"
            ? monaco.MarkerSeverity.Error
            : d.severity === "warning"
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
        code: d.code,
        message: `[${d.code}] ${d.message}`,
        source: "msx-tgg-envelope",
      }));
      monaco.editor.setModelMarkers(model, "msx-tgg-envelope", markers);
    },
    setTheme(isDark: boolean): void {
      monaco.editor.setTheme(isDark ? "msx-workflow-dark" : "msx-workflow-light");
    },
    focus(): void {
      editor.focus();
    },
    layout(): void {
      editor.layout();
    },
    dispose(): void {
      sub.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
