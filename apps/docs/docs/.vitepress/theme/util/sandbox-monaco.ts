// SPDX-License-Identifier: AGPL-3.0-or-later

import monarchGrammarsJson from "../data/monarch-grammars.generated.json";
import {
  getCodeActionsDocsLsp,
  getCompletionDocsLsp,
  getDefinitionDocsLsp,
  getHoverDocsLsp,
  getSemanticTokensDocsLsp,
  type LspDiagnostic,
} from "./docs-lsp-client.js";

interface GeneratedMonarchSpec {
  keywords: string[];
  types: string[];
  lineComments: string[];
  blockComment?: string[];
}

const GENERATED_MONARCH_SPECS = monarchGrammarsJson as Record<string, GeneratedMonarchSpec>;

export interface SandboxMonacoHandle {
  switchTab(uri: string, code: string, langSlug: string, readOnly?: boolean): void;
  setReadOnly(readOnly: boolean): void;
  setValue(nextCode: string): void;
  setValueForUri(uri: string, nextCode: string, langSlug?: string): void;
  setLanguage(langSlug: string): void;
  setDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void;
  removeModel(uri: string): void;
  refreshSemanticTokens(): void;
  setTheme(isDark: boolean): void;
  revealRange(startLine: number, startCharacter: number, endLine?: number, endCharacter?: number): void;
  focus(): void;
  layout(): void;
  dispose(): void;
}

export interface MountSandboxMonacoOptions {
  container: HTMLElement;
  initialUri: string;
  initialCode: string;
  langSlug: string;
  isDark: boolean;
  readOnly?: boolean;
  onChange: (nextCode: string) => void;
  onPaste?: (pastedText: string) => void;
  onQuickFixApplied?: () => void;
}

const XML_DIALECTS = new Set([
  "urdf",
  "reqif",
  "autosar",
  "ssp",
  "sbml",
  "cellml",
  "sbol",
  "sedml",
  "opensim",
  "febio",
  "automationml",
  "opendrive",
  "openscenario",
  "pscad",
  "cgmes",
  "scl",
  "waterml",
  "three-mf",
  "jsbsim",
]);

function mapSlugToMonacoLang(slug: string): string {
  const s = slug.toLowerCase();
  if (s === "modelica") return "msx-modelica";
  if (s === "sysml2" || s === "sysml") return "msx-sysml";
  if (s === "spice") return "msx-spice";
  if (s === "modelscript") return "msx-modelscript";
  if (s === "ampl") return "msx-ampl";
  if (s === "fortran") return "msx-fortran";
  if (s === "scad") return "msx-scad";
  if (s === "fea") return "msx-fea";
  if (s === "cfd") return "msx-cfd";
  if (s === "step") return "msx-step";
  if (s === "qif") return "msx-qif";
  if (XML_DIALECTS.has(s)) return "xml";
  if (s === "c" || s === "verilog-a") return "c";
  if (s === "cantera") return "yaml";
  if (s === "epanet" || s === "swmm" || s === "ibis") return "ini";
  if (s === "plcopen") return "pascal";
  if (s in GENERATED_MONARCH_SPECS) return `msx-${s}`;
  return "msx-polyglot";
}

// Must match packages/lsp/src/providers/semanticTokensProvider.ts
const LSP_SEMANTIC_TOKEN_TYPES = [
  "keyword",
  "type",
  "class",
  "variable",
  "parameter",
  "function",
  "string",
  "number",
  "operator",
  "comment",
  "namespace",
  "enumMember",
];
const LSP_SEMANTIC_TOKEN_MODIFIERS = ["declaration", "readonly"];

const HANDCRAFTED_CUSTOM_LANG_IDS = new Set([
  "msx-modelica",
  "msx-sysml",
  "msx-spice",
  "msx-modelscript",
  "msx-ampl",
  "msx-fortran",
  "msx-scad",
  "msx-fea",
  "msx-cfd",
  "msx-step",
  "msx-qif",
  "msx-polyglot",
]);

const GENERATED_CUSTOM_SLUGS = Object.keys(GENERATED_MONARCH_SPECS).filter(
  (s) =>
    !HANDCRAFTED_CUSTOM_LANG_IDS.has(`msx-${s}`) &&
    s !== "sysml2" &&
    !XML_DIALECTS.has(s) &&
    !["c", "verilog-a", "cantera", "epanet", "swmm", "ibis", "plcopen"].includes(s),
);

const CUSTOM_LANG_IDS = [...HANDCRAFTED_CUSTOM_LANG_IDS, ...GENERATED_CUSTOM_SLUGS.map((s) => `msx-${s}`)];
const ALL_PROVIDER_LANG_IDS = [...CUSTOM_LANG_IDS, "xml", "c", "yaml", "ini", "pascal"];

let sandboxMonacoPromise: Promise<typeof import("monaco-editor")> | null = null;
let languagesRegistered = false;

// Active diagnostics cache per URI for hover & code-action enrichment
const diagnosticsCache = new Map<string, LspDiagnostic[]>();
const semanticTokensRefreshers = new Set<() => void>();

function registerLanguagesAndThemes(monaco: typeof import("monaco-editor")): void {
  if (languagesRegistered) return;
  languagesRegistered = true;

  for (const id of CUSTOM_LANG_IDS) {
    monaco.languages.register({ id });
  }

  monaco.languages.setMonarchTokensProvider("msx-modelica", {
    keywords: [
      "model",
      "end",
      "package",
      "class",
      "record",
      "block",
      "connector",
      "function",
      "type",
      "partial",
      "replaceable",
      "redeclare",
      "extends",
      "import",
      "parameter",
      "constant",
      "discrete",
      "input",
      "output",
      "flow",
      "stream",
      "equation",
      "initial",
      "algorithm",
      "public",
      "protected",
      "annotation",
      "connect",
      "if",
      "then",
      "else",
      "elseif",
      "for",
      "loop",
      "in",
      "while",
      "when",
      "elsewhen",
      "and",
      "or",
      "not",
      "true",
      "false",
    ],
    typeKeywords: ["Real", "Integer", "Boolean", "String", "Natural"],
    builtins: ["der", "abs", "sin", "cos", "tan", "sqrt", "exp", "log", "min", "max", "pre", "edge", "sample", "time"],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@builtins": "function",
              "@default": "identifier",
            },
          },
        ],
        [/[=+\-*/^<>!]=?|:=|\.\./, "operator"],
        [/[{}()[\],.;:]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider("msx-sysml", {
    keywords: [
      "package",
      "part",
      "def",
      "attribute",
      "port",
      "item",
      "action",
      "state",
      "requirement",
      "constraint",
      "connection",
      "connect",
      "to",
      "from",
      "import",
      "private",
      "public",
      "in",
      "out",
      "inout",
      "ref",
      "abstract",
      "specializes",
      "redefines",
      "subsets",
      "satisfy",
      "verify",
      "bind",
      "flow",
      "doc",
      "comment",
      "about",
    ],
    typeKeywords: ["Real", "Integer", "Boolean", "String", "ScalarValues"],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@default": "identifier",
            },
          },
        ],
        [/::|:>|->|=|[=+\-*/<>!]+/, "operator"],
        [/[{}()[\],.;:]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider("msx-spice", {
    ignoreCase: true,
    keywords: [
      ".param",
      ".model",
      ".subckt",
      ".ends",
      ".tran",
      ".ac",
      ".dc",
      ".op",
      ".include",
      ".lib",
      ".end",
      ".ic",
      ".nodeset",
      ".meas",
      ".measure",
      ".step",
      ".temp",
      ".options",
      ".plot",
      ".print",
    ],
    tokenizer: {
      root: [
        [/^\s*\*.*$/, "comment"],
        [/;.*$/, "comment"],
        [/@\w+/, "annotation"],
        [/\.[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "keyword" } }],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?(meg|mil|k|m|u|n|p|f|g|t)?\b/i, "number"],
        [/^[VRCLMQDXJEBGHK]\w*/i, "type"],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/[=+\-*/<>]/, "operator"],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider("msx-modelscript", {
    keywords: [
      "system",
      "model",
      "component",
      "entity",
      "port",
      "signal",
      "param",
      "let",
      "var",
      "const",
      "equation",
      "constraint",
      "contract",
      "requires",
      "ensures",
      "invariant",
      "connect",
      "import",
      "export",
      "end",
      "if",
      "else",
      "for",
      "in",
      "return",
    ],
    typeKeywords: ["Real", "Int", "Bool", "String", "Vec", "Mat"],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/#.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@default": "identifier",
            },
          },
        ],
        [/[=+\-*/^<>!]=?|->|<->/, "operator"],
        [/[{}()[\],.;:]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider("msx-ampl", {
    keywords: [
      "set",
      "param",
      "var",
      "minimize",
      "maximize",
      "subject",
      "to",
      "s.t.",
      "in",
      "sum",
      "prod",
      "if",
      "then",
      "else",
      "binary",
      "integer",
      "solve",
      "data",
      "model",
      "let",
      "display",
    ],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, "string"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
        [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/[=+\-*/^<>!]=?|:=/, "operator"],
        [/[{}()[\],.;:]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider("msx-polyglot", {
    tokenizer: {
      root: [
        [/\/\/.*$|#.*$|%.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, "string"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
        [
          /\b(model|end|package|module|function|class|struct|param|parameter|var|let|const|if|else|for|while|return|import|export|connect|equation)\b/,
          "keyword",
        ],
        [/\b(Real|Integer|Boolean|String|double|float|int|bool|void)\b/, "type"],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/[=+\-*/^<>!]=?/, "operator"],
        [/[{}()[\],.;:]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider("msx-fortran", {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/!.*$/, "comment"],
        [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, "string"],
        [/\d+(\.\d+)?([eEdD][+-]?\d+)?/, "number"],
        [
          /\b(program|end|subroutine|function|module|use|implicit|none|intent|in|out|inout|if|then|else|elseif|endif|do|enddo|while|call|return|contains|interface|parameter|allocatable|dimension|pure|elemental)\b/,
          "keyword",
        ],
        [/\b(real|integer|double|precision|logical|character|complex)\b/, "type"],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/\/\/|==|\/=|<=|>=|[=+\-*/<>]/, "operator"],
        [/[{}()[\],.:;]/, "delimiter"],
      ],
    },
  });

  const cadCaeTokenizer: import("monaco-editor").languages.IMonarchLanguage = {
    tokenizer: {
      root: [
        [/\/\/.*$|\*\*.*$|%.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/^\*[A-Z_][A-Z0-9_]*/, "keyword"],
        [/#\d+/, "variable"],
        [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, "string"],
        [/\d+(\.\d+)?([eEdD][+-]?\d+)?/, "number"],
        [
          /\b(ISO-10303-21|HEADER|DATA|ENDSEC|END-ISO-10303-21|module|function|union|difference|intersection|translate|rotate|cube|sphere|cylinder|if|else|for|let|true|false)\b/,
          "keyword",
        ],
        [/\b[A-Z][A-Z0-9_]{2,}\b(?=\s*\()/, "type"],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/[=+\-*/^<>!]=?/, "operator"],
        [/[{}()[\],.;:]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  };
  for (const id of ["msx-scad", "msx-fea", "msx-cfd", "msx-step"]) {
    monaco.languages.setMonarchTokensProvider(id, cadCaeTokenizer);
  }

  monaco.languages.setMonarchTokensProvider("msx-qif", {
    keywords: ["QIF", "FEATURE", "DATUM", "CHARACTERISTIC", "STEP", "ACTUAL", "RULE", "DEVICE", "DRF", "COMPOSITE"],
    typeKeywords: [
      "Plane",
      "Cylinder",
      "Circle",
      "Cone",
      "Sphere",
      "Slot",
      "Point",
      "Position",
      "Perpendicularity",
      "Parallelism",
      "Concentricity",
      "Flatness",
      "Cylindricity",
      "Circularity",
      "TotalRunout",
      "CircularRunout",
      "ProfileOfSurface",
      "ProfileOfLine",
      "MMC",
      "LMC",
      "RFS",
      "PASS",
      "FAIL",
      "MARGINAL",
      "CMM",
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/#.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/\b[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}\b/, "string"],
        [/\b\d+(\.\d+)?([eEdD][+-]?\d+)?\b/, "number"],
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
        [/[=+\-*/<>!]/, "operator"],
        [/[{}()[\],.;:]/, "delimiter"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });

  for (const slug of GENERATED_CUSTOM_SLUGS) {
    const spec = GENERATED_MONARCH_SPECS[slug];
    if (!spec) continue;
    const commentRules: import("monaco-editor").languages.IMonarchLanguageRule[] = [];
    for (const lc of spec.lineComments) {
      try {
        commentRules.push([new RegExp(lc), "comment"]);
      } catch {
        // skip invalid regex
      }
    }
    if (spec.blockComment?.[0] === "/*" && spec.blockComment?.[1] === "*/") {
      commentRules.push([/\/\*/, "comment", "@comment"]);
    }
    monaco.languages.setMonarchTokensProvider(`msx-${slug}`, {
      keywords: spec.keywords,
      typeKeywords: spec.types,
      tokenizer: {
        root: [
          ...commentRules,
          [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, "string"],
          [/\b0[xX][0-9a-fA-F]+\b|\b\d+(\.\d+)?([eEdD][+-]?\d+)?\b/, "number"],
          [
            /[a-zA-Z_][a-zA-Z0-9_.-]*/,
            {
              cases: {
                "@keywords": "keyword",
                "@typeKeywords": "type",
                "@default": "identifier",
              },
            },
          ],
          [/[=+\-*/^<>!]=?/, "operator"],
          [/[{}()[\],.;:]/, "delimiter"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
      },
    });
  }

  monaco.editor.defineTheme("msx-sandbox-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c084fc", fontStyle: "bold" },
      { token: "type", foreground: "38bdf8" },
      { token: "class", foreground: "67e8f9", fontStyle: "bold" },
      { token: "function", foreground: "93c5fd" },
      { token: "parameter", foreground: "fbbf24" },
      { token: "variable", foreground: "e2e8f0" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "f9a8d4" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "operator", foreground: "94a3b8" },
      { token: "annotation", foreground: "22d3ee" },
      { token: "namespace", foreground: "a5b4fc" },
      { token: "enumMember", foreground: "fda4af" },
    ],
    colors: {
      "editor.background": "#0b1120",
      "editor.foreground": "#e2e8f0",
      "editorLineNumber.foreground": "#475569",
      "editorLineNumber.activeForeground": "#94a3b8",
      "editor.lineHighlightBackground": "#1e293b55",
      "editorGutter.background": "#0b1120",
    },
  });

  monaco.editor.defineTheme("msx-sandbox-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "7c3aed", fontStyle: "bold" },
      { token: "type", foreground: "0284c7" },
      { token: "class", foreground: "0369a1", fontStyle: "bold" },
      { token: "function", foreground: "2563eb" },
      { token: "parameter", foreground: "b45309" },
      { token: "variable", foreground: "1e293b" },
      { token: "string", foreground: "15803d" },
      { token: "number", foreground: "be185d" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "operator", foreground: "475569" },
      { token: "annotation", foreground: "0891b2" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
    },
  });

  // Register LSP-backed providers across all supported Monaco languages
  const semanticLegend: import("monaco-editor").languages.SemanticTokensLegend = {
    tokenTypes: LSP_SEMANTIC_TOKEN_TYPES,
    tokenModifiers: LSP_SEMANTIC_TOKEN_MODIFIERS,
  };

  const semanticEmitter = new monaco.Emitter<void>();
  semanticTokensRefreshers.add(() => semanticEmitter.fire());

  for (const langId of ALL_PROVIDER_LANG_IDS) {
    monaco.languages.registerDocumentSemanticTokensProvider(langId, {
      getLegend: () => semanticLegend,
      onDidChange: semanticEmitter.event,
      async provideDocumentSemanticTokens(model) {
        try {
          const res = await getSemanticTokensDocsLsp(model.uri.toString());
          if (!res || !Array.isArray(res.data) || res.data.length === 0) return null;
          return {
            data: new Uint32Array(res.data),
            resultId: res.resultId,
          };
        } catch {
          return null;
        }
      },
      releaseDocumentSemanticTokens() {},
    });

    monaco.languages.registerHoverProvider(langId, {
      async provideHover(model, position) {
        const uri = model.uri.toString();
        const contents: import("monaco-editor").IMarkdownString[] = [];

        const markers = monaco.editor
          .getModelMarkers({ resource: model.uri })
          .filter(
            (m) =>
              position.lineNumber >= m.startLineNumber &&
              position.lineNumber <= m.endLineNumber &&
              position.column >= m.startColumn &&
              position.column <= m.endColumn,
          );
        for (const m of markers) {
          const sev =
            m.severity === monaco.MarkerSeverity.Error
              ? "Error"
              : m.severity === monaco.MarkerSeverity.Warning
                ? "Warning"
                : "Info";
          const codeStr = m.code ? ` \`${typeof m.code === "object" ? m.code.value : m.code}\`` : "";
          contents.push({ value: `**${sev}${codeStr}**: ${m.message}` });
        }

        try {
          const lspHover = await getHoverDocsLsp(uri, position.lineNumber - 1, position.column - 1);
          if (lspHover?.contents) {
            const raw = lspHover.contents;
            if (typeof raw === "string" && raw.trim()) {
              contents.push({ value: raw });
            } else if (raw?.value) {
              contents.push({ value: String(raw.value) });
            } else if (Array.isArray(raw)) {
              for (const item of raw) {
                const txt = typeof item === "string" ? item : item?.value;
                if (txt) contents.push({ value: String(txt) });
              }
            }
          }
        } catch {
          // Ignore transient hover errors
        }

        if (contents.length === 0) return null;
        return { contents };
      },
    });

    monaco.languages.registerCompletionItemProvider(langId, {
      triggerCharacters: [".", ":", "$", "@"],
      async provideCompletionItems(model, position) {
        try {
          const res = await getCompletionDocsLsp(model.uri.toString(), position.lineNumber - 1, position.column - 1);
          const rawItems = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
          if (rawItems.length === 0) return { suggestions: [] };

          const word = model.getWordUntilPosition(position);
          const defaultRange = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );

          const suggestions: import("monaco-editor").languages.CompletionItem[] = rawItems.slice(0, 80).map((it) => ({
            label: String(it.label ?? ""),
            kind: typeof it.kind === "number" ? it.kind : monaco.languages.CompletionItemKind.Text,
            detail: it.detail ? String(it.detail) : undefined,
            documentation:
              typeof it.documentation === "string"
                ? it.documentation
                : it.documentation?.value
                  ? String(it.documentation.value)
                  : undefined,
            insertText: String(it.insertText ?? it.label ?? ""),
            insertTextRules:
              it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            range: defaultRange,
          }));
          return { suggestions };
        } catch {
          return { suggestions: [] };
        }
      },
    });

    monaco.languages.registerDefinitionProvider(langId, {
      async provideDefinition(model, position) {
        try {
          const res = await getDefinitionDocsLsp(model.uri.toString(), position.lineNumber - 1, position.column - 1);
          if (!res) return null;
          const locs = Array.isArray(res) ? res : [res];
          return locs
            .filter((l) => l?.uri && l?.range)
            .map((l) => ({
              uri: monaco.Uri.parse(String(l.uri)),
              range: new monaco.Range(
                l.range.start.line + 1,
                l.range.start.character + 1,
                l.range.end.line + 1,
                l.range.end.character + 1,
              ),
            }));
        } catch {
          return null;
        }
      },
    });

    monaco.languages.registerCodeActionProvider(langId, {
      async provideCodeActions(model, range) {
        const uri = model.uri.toString();
        const diags = diagnosticsCache.get(uri) ?? [];
        const overlapping = diags.filter(
          (d) => d.range.end.line + 1 >= range.startLineNumber && d.range.start.line + 1 <= range.endLineNumber,
        );
        if (overlapping.length === 0) return { actions: [], dispose: () => {} };

        try {
          const lspActions = await getCodeActionsDocsLsp(
            uri,
            {
              start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
              end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
            },
            overlapping,
          );
          const actions: import("monaco-editor").languages.CodeAction[] = [];
          for (const a of lspActions ?? []) {
            const changes = a?.edit?.changes?.[uri];
            if (!Array.isArray(changes)) continue;
            actions.push({
              title: String(a.title || "Apply QuickFix"),
              kind: "quickfix",
              isPreferred: true,
              edit: {
                edits: changes.map((te: any) => ({
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: new monaco.Range(
                      te.range.start.line + 1,
                      te.range.start.character + 1,
                      te.range.end.line + 1,
                      te.range.end.character + 1,
                    ),
                    text: String(te.newText ?? ""),
                  },
                })),
              },
            });
          }
          return { actions, dispose: () => {} };
        } catch {
          return { actions: [], dispose: () => {} };
        }
      },
    });
  }
}

async function ensureMonacoLoaded(): Promise<typeof import("monaco-editor")> {
  if (typeof window === "undefined") {
    throw new Error("Monaco Editor can only be loaded in a browser environment.");
  }
  if (!sandboxMonacoPromise) {
    sandboxMonacoPromise = (async () => {
      const [workerMod, monaco] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.worker?worker").catch(() => null),
        import("monaco-editor"),
      ]);
      const g = globalThis as unknown as { MonacoEnvironment?: { getWorker: () => Worker } };
      if (!g.MonacoEnvironment) {
        g.MonacoEnvironment = {
          getWorker: () => {
            if (workerMod && typeof workerMod.default === "function") {
              return new workerMod.default();
            }
            const blob = new Blob(["self.onmessage = function() {};"], { type: "text/javascript" });
            return new Worker(URL.createObjectURL(blob));
          },
        };
      }
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
      registerLanguagesAndThemes(monaco);
      return monaco;
    })();
  }
  return sandboxMonacoPromise;
}

export async function mountSandboxMonaco(options: MountSandboxMonacoOptions): Promise<SandboxMonacoHandle> {
  const monaco = await ensureMonacoLoaded();
  const models = new Map<string, import("monaco-editor").editor.ITextModel>();
  const modelLangs = new Map<string, string>();
  let activeUri = options.initialUri;
  let suppressChange = false;

  function getOrCreateModel(uri: string, code: string, langSlug: string): import("monaco-editor").editor.ITextModel {
    const targetLang = mapSlugToMonacoLang(langSlug);
    const existing = models.get(uri) ?? monaco.editor.getModel(monaco.Uri.parse(uri));
    if (existing) {
      models.set(uri, existing);
      if (modelLangs.get(uri) !== targetLang) {
        monaco.editor.setModelLanguage(existing, targetLang);
        modelLangs.set(uri, targetLang);
      }
      return existing;
    }
    const created = monaco.editor.createModel(code, targetLang, monaco.Uri.parse(uri));
    models.set(uri, created);
    modelLangs.set(uri, targetLang);
    return created;
  }

  const initialModel = getOrCreateModel(options.initialUri, options.initialCode, options.langSlug);

  const editor = monaco.editor.create(options.container, {
    model: initialModel,
    theme: options.isDark ? "msx-sandbox-dark" : "msx-sandbox-light",
    readOnly: Boolean(options.readOnly),
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "var(--vp-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
    padding: { top: 10, bottom: 10 },
    wordWrap: "on",
    automaticLayout: true,
    renderValidationDecorations: "on",
    "semanticHighlighting.enabled": true,
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
    hover: { enabled: true, delay: 140 },
    quickSuggestions: { other: true, comments: false, strings: false },
  });

  const subChange = editor.onDidChangeModelContent(() => {
    if (suppressChange) return;
    const m = editor.getModel();
    if (m) options.onChange(m.getValue());
  });

  const subPaste = editor.onDidPaste((ev) => {
    if (!options.onPaste) return;
    const m = editor.getModel();
    if (!m) return;
    const text = m.getValueInRange(ev.range);
    if (text) options.onPaste(text);
  });

  function applyMarkersToModel(uri: string, diagnostics: LspDiagnostic[]): void {
    diagnosticsCache.set(uri, diagnostics);
    const model = models.get(uri) ?? monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;
    const markers: import("monaco-editor").editor.IMarkerData[] = diagnostics.map((d) => ({
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: Math.max(d.range.end.character + 1, d.range.start.character + 2),
      severity:
        d.severity === 2
          ? monaco.MarkerSeverity.Warning
          : d.severity === 3 || d.severity === 4
            ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Error,
      code: d.code !== undefined ? String(d.code) : undefined,
      message: d.message,
      source: d.source ?? "modelscript-lsp",
    }));
    monaco.editor.setModelMarkers(model, "modelscript-lsp", markers);
  }

  function writeModelText(model: import("monaco-editor").editor.ITextModel, nextCode: string): void {
    if (model.getValue() === nextCode) return;
    suppressChange = true;
    try {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: nextCode }], () => null);
    } finally {
      suppressChange = false;
    }
  }

  return {
    switchTab(uri: string, code: string, langSlug: string, readOnly = false): void {
      activeUri = uri;
      const model = getOrCreateModel(uri, code, langSlug);
      if (editor.getModel() !== model) {
        suppressChange = true;
        try {
          editor.setModel(model);
        } finally {
          suppressChange = false;
        }
      }
      writeModelText(model, code);
      editor.updateOptions({ readOnly });
      const cached = diagnosticsCache.get(uri);
      if (cached) applyMarkersToModel(uri, cached);
    },
    setReadOnly(readOnly: boolean): void {
      editor.updateOptions({ readOnly });
    },
    setValue(nextCode: string): void {
      const model = editor.getModel();
      if (!model) return;
      writeModelText(model, nextCode);
    },
    setValueForUri(uri: string, nextCode: string, langSlug?: string): void {
      const existing = models.get(uri);
      if (existing) {
        writeModelText(existing, nextCode);
      } else if (langSlug) {
        getOrCreateModel(uri, nextCode, langSlug);
      }
    },
    setLanguage(langSlug: string): void {
      const model = editor.getModel();
      if (!model) return;
      const targetLang = mapSlugToMonacoLang(langSlug);
      if (modelLangs.get(activeUri) === targetLang) return;
      monaco.editor.setModelLanguage(model, targetLang);
      modelLangs.set(activeUri, targetLang);
    },
    setDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void {
      applyMarkersToModel(uri, diagnostics);
    },
    removeModel(uri: string): void {
      diagnosticsCache.delete(uri);
      modelLangs.delete(uri);
      const model = models.get(uri);
      if (model) {
        models.delete(uri);
        model.dispose();
      }
    },
    refreshSemanticTokens(): void {
      for (const fn of semanticTokensRefreshers) {
        fn();
      }
    },
    setTheme(isDark: boolean): void {
      monaco.editor.setTheme(isDark ? "msx-sandbox-dark" : "msx-sandbox-light");
    },
    revealRange(startLine: number, startCharacter: number, endLine?: number, endCharacter?: number): void {
      const range = new monaco.Range(
        startLine + 1,
        startCharacter + 1,
        (endLine ?? startLine) + 1,
        Math.max((endCharacter ?? startCharacter) + 1, startCharacter + 2),
      );
      editor.focus();
      editor.revealRangeInCenter(range);
      editor.setSelection(range);
    },
    focus(): void {
      editor.focus();
    },
    layout(): void {
      editor.layout();
    },
    dispose(): void {
      subChange.dispose();
      subPaste.dispose();
      editor.dispose();
      for (const m of models.values()) {
        m.dispose();
      }
      models.clear();
      modelLangs.clear();
    },
  };
}
