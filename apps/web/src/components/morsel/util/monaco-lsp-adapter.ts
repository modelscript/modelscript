// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registers Monaco language feature providers that delegate to the
 * LSP WebWorker via `lsp-worker.ts`, and registers all 44 ModelScript
 * engineering languages with Monarch syntax highlighting.
 */

import type * as Monaco from "monaco-editor";
import { MORSEL_LANGUAGES, type MorselSyntaxFamily } from "../constants";
import { startLsp } from "./lsp-worker";

// ────────────────────────────────────────────────────────────────────
// Semantic token legend (must match server's legend in browserServerMain.ts)
// ────────────────────────────────────────────────────────────────────

const TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
];

const TOKEN_MODIFIERS = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
];

const SEMANTIC_LEGEND: Monaco.languages.SemanticTokensLegend = {
  tokenTypes: TOKEN_TYPES,
  tokenModifiers: TOKEN_MODIFIERS,
};

// ────────────────────────────────────────────────────────────────────
// Conversion helpers (LSP ↔ Monaco)
// ────────────────────────────────────────────────────────────────────

function lspRangeToMonaco(r: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): Monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

function monacoPositionToLsp(p: Monaco.Position): { line: number; character: number } {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

function monacoRangeToLsp(r: Monaco.IRange) {
  return {
    start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
    end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
  };
}

function lspSeverityToMonaco(monaco: typeof Monaco, severity?: number): Monaco.MarkerSeverity {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function lspCompletionKindToMonaco(monaco: typeof Monaco, kind?: number): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  const map: Record<number, Monaco.languages.CompletionItemKind> = {
    1: K.Text,
    2: K.Method,
    3: K.Function,
    4: K.Constructor,
    5: K.Field,
    6: K.Variable,
    7: K.Class,
    8: K.Interface,
    9: K.Module,
    10: K.Property,
    11: K.Unit,
    12: K.Value,
    13: K.Enum,
    14: K.Keyword,
    15: K.Snippet,
    16: K.Color,
    17: K.File,
    18: K.Reference,
    19: K.Folder,
    20: K.EnumMember,
    21: K.Constant,
    22: K.Struct,
    23: K.Event,
    24: K.Operator,
    25: K.TypeParameter,
  };
  return (kind !== undefined ? map[kind] : undefined) ?? K.Text;
}

function convertLocationOrLink(monaco: typeof Monaco, item: any): Monaco.languages.Location | null {
  if (!item) return null;
  if (item.targetUri && (item.targetSelectionRange || item.targetRange)) {
    return {
      uri: monaco.Uri.parse(item.targetUri),
      range: lspRangeToMonaco(item.targetSelectionRange ?? item.targetRange),
    };
  }
  if (item.uri && item.range) {
    return {
      uri: monaco.Uri.parse(item.uri),
      range: lspRangeToMonaco(item.range),
    };
  }
  return null;
}

function convertWorkspaceEdit(monaco: typeof Monaco, edit: any): Monaco.languages.WorkspaceEdit {
  const edits: Monaco.languages.IWorkspaceTextEdit[] = [];
  if (edit?.changes) {
    for (const [uri, textEdits] of Object.entries<any[]>(edit.changes)) {
      for (const te of textEdits ?? []) {
        edits.push({
          resource: monaco.Uri.parse(uri),
          textEdit: {
            range: lspRangeToMonaco(te.range),
            text: te.newText,
          },
          versionId: undefined,
        });
      }
    }
  }
  if (Array.isArray(edit?.documentChanges)) {
    for (const dc of edit.documentChanges) {
      if (dc?.textDocument?.uri && Array.isArray(dc.edits)) {
        for (const te of dc.edits) {
          edits.push({
            resource: monaco.Uri.parse(dc.textDocument.uri),
            textEdit: {
              range: lspRangeToMonaco(te.range),
              text: te.newText,
            },
            versionId: undefined,
          });
        }
      }
    }
  }
  return { edits };
}

// ────────────────────────────────────────────────────────────────────
// Monarch Tokenizers by Language Family
// ────────────────────────────────────────────────────────────────────

const MODELICA_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "algorithm",
    "and",
    "annotation",
    "block",
    "break",
    "class",
    "connect",
    "connector",
    "constant",
    "constrainedby",
    "der",
    "discrete",
    "each",
    "else",
    "elseif",
    "elsewhen",
    "encapsulated",
    "end",
    "enumeration",
    "equation",
    "expandable",
    "extends",
    "external",
    "false",
    "final",
    "flow",
    "for",
    "function",
    "if",
    "import",
    "impure",
    "in",
    "initial",
    "inner",
    "input",
    "loop",
    "model",
    "not",
    "operator",
    "or",
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
    "return",
    "stream",
    "then",
    "true",
    "type",
    "when",
    "while",
    "within",
  ],
  typeKeywords: ["Real", "Integer", "Boolean", "String", "StateSelect", "ExternalObject", "Clock"],
  builtins: [
    "abs",
    "acos",
    "actualStream",
    "asin",
    "atan",
    "atan2",
    "cardinality",
    "ceil",
    "change",
    "connections",
    "cos",
    "cosh",
    "delay",
    "diagonal",
    "div",
    "edge",
    "exp",
    "fill",
    "floor",
    "homotopy",
    "identity",
    " initial",
    "inStream",
    "integer",
    "isPresent",
    "linspace",
    "log",
    "log10",
    "matrix",
    "max",
    "min",
    "mod",
    "ndims",
    "noEvent",
    "ones",
    "outerProduct",
    "pre",
    "product",
    "reinit",
    "rem",
    " rooted",
    "Sample",
    "scalar",
    "semiLinear",
    "sign",
    "sin",
    "sinh",
    "size",
    "skew",
    "smooth",
    "spatialDistribution",
    "sqrt",
    "sum",
    "symmetric",
    "tan",
    "tanh",
    "terminal",
    "time",
    "transpose",
    "vector",
    "zeros",
  ],
  operators: ["=", ":=", "+", "-", "*", "/", "^", ".+", ".-", ".*", "./", ".^", "==", "<>", "<", ">", "<=", ">=", ":"],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  tokenizer: {
    root: [
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@typeKeywords": "type.identifier",
            "@keywords": "keyword",
            "@builtins": "predefined",
            "@default": "identifier",
          },
        },
      ],
      [/'(?:[^'\\]|\\.)+'/, "identifier"],
      { include: "@whitespace" },
      [/[{}()[\]]/, "@brackets"],
      [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
      [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/\d+([eE][-+]?\d+)/, "number.float"],
      [/\d+/, "number"],
      [/[;,.]/, "delimiter"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\/\*/, "comment", "@push"],
      ["\\*/", "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],
    whitespace: [
      [/[ \t\r\n]+/, "white"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],
  },
};

const SYSML2_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "package",
    "part",
    "def",
    "attribute",
    "port",
    "item",
    "action",
    "state",
    "constraint",
    "requirement",
    "calc",
    "connection",
    "interface",
    "allocation",
    "flow",
    "connect",
    "to",
    "in",
    "out",
    "inout",
    "import",
    "private",
    "public",
    "protected",
    "abstract",
    "variation",
    "variant",
    "enum",
    "doc",
    "satisfy",
    "verify",
    "assert",
    "assume",
    "require",
    "subject",
    "entry",
    "do",
    "exit",
    "transition",
    "first",
    "then",
    "accept",
    "if",
    "else",
    "true",
    "false",
  ],
  typeKeywords: ["Real", "Integer", "Boolean", "String", "ScalarValues", "ISQ"],
  tokenizer: {
    root: [
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@typeKeywords": "type.identifier",
            "@keywords": "keyword",
            "@default": "identifier",
          },
        },
      ],
      [/'(?:[^'\\]|\\.)+'/, "identifier"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/\d+/, "number"],
      [/"([^"\\]|\\.)*"/, "string"],
      [/[{}()[\];:,.]/, "delimiter"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      ["\\*/", "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};

const STEP_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "ISO-10303-21",
    "END-ISO-10303-21",
    "HEADER",
    "ENDSEC",
    "DATA",
    "FILE_DESCRIPTION",
    "FILE_NAME",
    "FILE_SCHEMA",
  ],
  tokenizer: {
    root: [
      [/#\d+/, "variable.name"],
      [/[A-Z_][A-Z0-9_-]*/, { cases: { "@keywords": "keyword", "@default": "type.identifier" } }],
      [/'([^']|'')*'/, "string"],
      [/\/\*/, "comment", "@comment"],
      [/-?\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/-?\d+/, "number"],
      [/\.[A-Z0-9_]+\./, "constant"],
      [/[()=,;$*]/, "delimiter"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      ["\\*/", "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};

const OWL2_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "Prefix",
    "Ontology",
    "Import",
    "Declaration",
    "Class",
    "ObjectProperty",
    "DataProperty",
    "AnnotationProperty",
    "NamedIndividual",
    "SubClassOf",
    "EquivalentClasses",
    "DisjointClasses",
    "ObjectIntersectionOf",
    "ObjectUnionOf",
    "ObjectSomeValuesFrom",
    "ObjectAllValuesFrom",
    "DataSomeValuesFrom",
    "ClassAssertion",
    "ObjectPropertyAssertion",
    "DataPropertyAssertion",
    "AnnotationAssertion",
  ],
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/\/\/.*$/, "comment"],
      [/<[^>]*>/, "string.link"],
      [/[a-zA-Z_][\w.-]*:[a-zA-Z_][\w.-]*/, "type.identifier"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/"([^"\\]|\\.)*"/, "string"],
      [/-?\d+(\.\d+)?/, "number"],
      [/[()=]/, "delimiter"],
    ],
  },
};

const SCAD_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "module",
    "function",
    "if",
    "else",
    "for",
    "let",
    "each",
    "true",
    "false",
    "undef",
    "include",
    "use",
    "union",
    "difference",
    "intersection",
    "translate",
    "rotate",
    "scale",
    "mirror",
    "color",
    "hull",
    "minkowski",
    "linear_extrude",
    "rotate_extrude",
    "cube",
    "sphere",
    "cylinder",
    "polyhedron",
    "circle",
    "square",
    "polygon",
  ],
  tokenizer: {
    root: [
      [/\$[a-zA-Z_]\w*/, "variable.predefined"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/"([^"\\]|\\.)*"/, "string"],
      [/-?\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/-?\d+/, "number"],
      [/[{}()[\];:,.=+\-*/<>!]/, "delimiter"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      ["\\*/", "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};

const C_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "auto",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "register",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
  ],
  tokenizer: {
    root: [
      [/#\s*\w+/, "keyword.directive"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/"([^"\\]|\\.)*"/, "string"],
      [/'([^'\\]|\\.)*'/, "string"],
      [/0[xX][0-9a-fA-F]+/, "number.hex"],
      [/\d*\.\d+([eE][-+]?\d+)?[fFlL]?/, "number.float"],
      [/\d+[uUlL]*/, "number"],
      [/[{}()[\];:,.=+\-*/&|<>!~^%?]/, "delimiter"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      ["\\*/", "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};

const FORTRAN_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: true,
  keywords: [
    "program",
    "end",
    "subroutine",
    "function",
    "module",
    "use",
    "implicit",
    "none",
    "real",
    "integer",
    "logical",
    "character",
    "complex",
    "parameter",
    "dimension",
    "allocatable",
    "intent",
    "in",
    "out",
    "inout",
    "do",
    "if",
    "then",
    "else",
    "elseif",
    "endif",
    "enddo",
    "call",
    "return",
    "contains",
  ],
  tokenizer: {
    root: [
      [/!.*$/, "comment"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/"([^"\\]|\\.)*"/, "string"],
      [/'([^'\\]|\\.)*'/, "string"],
      [/\d*\.\d+([dDeE][-+]?\d+)?/, "number.float"],
      [/\d+/, "number"],
      [/[()[\],:;=\-+*/]/, "delimiter"],
    ],
  },
};

const SPICE_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: true,
  keywords: [
    ".tran",
    ".ac",
    ".dc",
    ".op",
    ".model",
    ".subckt",
    ".ends",
    ".param",
    ".include",
    ".lib",
    ".end",
    "new",
    "clear",
    "solve",
    "sin",
    "pulse",
    "pwl",
  ],
  tokenizer: {
    root: [
      [/^\*.*$/, "comment"],
      [/[!;/].*$/, "comment"],
      [/\.[a-zA-Z_]\w*/, "keyword"],
      [/^[RCLVIEXGFIQMDJ][\w.]*/, "type.identifier"],
      [/[a-zA-Z_][\w.]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/'[^']*'/, "string"],
      [/"[^"]*"/, "string"],
      [/-?\d+(\.\d+)?([eE][-+]?\d+)?[TGMKmilunpfa]?/, "number"],
      [/[=(),]/, "delimiter"],
    ],
  },
};

const XML_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenizer: {
    root: [
      [/<!--/, "comment", "@comment"],
      [/<\?[\s\S]*?\?>/, "metatag"],
      [/<\/?[a-zA-Z_][\w:.-]*/, "tag"],
      [/\/?>/, "tag"],
      [/[a-zA-Z_][\w:.-]*(?=\s*=)/, "attribute.name"],
      [/"([^"]*)"/, "attribute.value"],
      [/'([^']*)'/, "attribute.value"],
      [/=/, "delimiter"],
    ],
    comment: [
      [/[^-]+/, "comment"],
      [/-->/, "comment", "@pop"],
      [/-/, "comment"],
    ],
  },
};

const INI_DECK_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: true,
  keywords: [
    "TITLE",
    "COMPONENT",
    "PARAMETER",
    "CONNECT",
    "MODULE",
    "OBJECT",
    "TASK",
    "PART",
    "MARKER",
    "JOINT",
    "FORCE",
    "ACCGRAV",
    "RUNSPEC",
    "DIMENS",
    "BRANCH",
    "GEOMETRY",
    "OPTIONS",
    "CASE",
    "BUILDING",
    "ZONE",
    "VERSION",
    "SOLVER",
    "END",
  ],
  tokenizer: {
    root: [
      [/^[!#%;$=].*$/, "comment"],
      [/--.*$/, "comment"],
      [/\/\/.*$/, "comment"],
      [/\[[^\]]+\]/, "metatag"],
      [/^\*[A-Z0-9_]+/, "keyword"],
      [/[a-zA-Z_][\w.]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/"([^"\\]|\\.)*"/, "string"],
      [/'([^'\\]|\\.)*'/, "string"],
      [/-?\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/-?\d+/, "number"],
      [/[{}()[\]=,:;/]/, "delimiter"],
    ],
  },
};

const CSV_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenizer: {
    root: [
      [/^[!#].*$/, "comment"],
      [/"([^"]|"")*"/, "string"],
      [/-?\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/-?\d+/, "number"],
      [/[,;\t]/, "delimiter"],
      [/[^,;\t\r\n"]+/, "identifier"],
    ],
  },
};

const VERILOG_A_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "module",
    "endmodule",
    "inout",
    "input",
    "output",
    "electrical",
    "thermal",
    "magnetic",
    "rotational",
    "translational",
    "discipline",
    "enddiscipline",
    "nature",
    "endnature",
    "parameter",
    "real",
    "integer",
    "analog",
    "begin",
    "end",
    "if",
    "else",
    "from",
    "exclude",
    "inf",
    "ddt",
    "idt",
    "white_noise",
    "flicker_noise",
    "laplace_nd",
  ],
  tokenizer: {
    root: [
      [/`\w+/, "keyword.directive"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/"([^"\\]|\\.)*"/, "string"],
      [/-?\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/-?\d+/, "number"],
      [/<\+/, "operator"],
      [/[()[\]{};:,.=+\-*/<>]/, "delimiter"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      ["\\*/", "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};

const PLCOPEN_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: true,
  keywords: [
    "PROGRAM",
    "END_PROGRAM",
    "FUNCTION",
    "END_FUNCTION",
    "FUNCTION_BLOCK",
    "END_FUNCTION_BLOCK",
    "VAR",
    "VAR_INPUT",
    "VAR_OUTPUT",
    "VAR_IN_OUT",
    "END_VAR",
    "IF",
    "THEN",
    "ELSIF",
    "ELSE",
    "END_IF",
    "CASE",
    "OF",
    "END_CASE",
    "FOR",
    "TO",
    "BY",
    "DO",
    "END_FOR",
    "WHILE",
    "END_WHILE",
    "REPEAT",
    "UNTIL",
    "END_REPEAT",
    "TRUE",
    "FALSE",
    "AND",
    "OR",
    "NOT",
    "XOR",
    "BOOL",
    "INT",
    "DINT",
    "REAL",
    "LREAL",
    "TIME",
    "STRING",
  ],
  tokenizer: {
    root: [
      [/\(\*[\s\S]*?\*\)/, "comment"],
      [/\/\/.*$/, "comment"],
      [/<!--[\s\S]*?-->/, "comment"],
      [/<\/?[a-zA-Z_][\w:.-]*\/?>/, "tag"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/"([^"]*)"/, "string"],
      [/'([^']*)'/, "string"],
      [/-?\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/-?\d+/, "number"],
      [/:=/, "operator"],
      [/[()[\];:,.=+\-*/<>]/, "delimiter"],
    ],
  },
};

const SIMULINK_MONARCH: Monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  keywords: [
    "Model",
    "System",
    "Block",
    "Line",
    "Branch",
    "Annotation",
    "BlockDefaults",
    "Name",
    "BlockType",
    "SrcBlock",
    "SrcPort",
    "DstBlock",
    "DstPort",
    "Position",
    "Numerator",
    "Denominator",
    "Gain",
    "InitialCondition",
  ],
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/<!--[\s\S]*?-->/, "comment"],
      [/<\/?[a-zA-Z_][\w:.-]*\/?>/, "tag"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/"([^"\\]|\\.)*"/, "string"],
      [/-?\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/-?\d+/, "number"],
      [/[{}[\]()]/, "delimiter"],
    ],
  },
};

function getMonarchForFamily(family: MorselSyntaxFamily): Monaco.languages.IMonarchLanguage {
  switch (family) {
    case "modelica":
      return MODELICA_MONARCH;
    case "sysml2":
      return SYSML2_MONARCH;
    case "step":
      return STEP_MONARCH;
    case "owl2":
      return OWL2_MONARCH;
    case "scad":
      return SCAD_MONARCH;
    case "c":
      return C_MONARCH;
    case "fortran":
      return FORTRAN_MONARCH;
    case "spice":
      return SPICE_MONARCH;
    case "xml":
      return XML_MONARCH;
    case "ini":
      return INI_DECK_MONARCH;
    case "csv":
      return CSV_MONARCH;
    case "verilog-a":
      return VERILOG_A_MONARCH;
    case "plcopen":
      return PLCOPEN_MONARCH;
    case "simulink":
      return SIMULINK_MONARCH;
  }
}

let allLanguagesRegistered = false;

/**
 * Registers all 44 ModelScript languages and Monarch tokenizers with Monaco.
 */
export function registerAllModelscriptLanguages(monaco: typeof Monaco): void {
  if (allLanguagesRegistered) return;
  allLanguagesRegistered = true;

  const existingIds = new Set(monaco.languages.getLanguages().map((l) => l.id));

  for (const lang of MORSEL_LANGUAGES) {
    if (!existingIds.has(lang.id)) {
      monaco.languages.register({
        id: lang.id,
        extensions: lang.extensions,
        aliases: [lang.name, lang.id],
      });
    }
    monaco.languages.setMonarchTokensProvider(lang.id, getMonarchForFamily(lang.family));
    monaco.languages.setLanguageConfiguration(lang.id, {
      comments:
        lang.family === "xml"
          ? { blockComment: ["<!--", "-->"] }
          : lang.family === "fortran"
            ? { lineComment: "!" }
            : lang.family === "spice"
              ? { lineComment: "*" }
              : { lineComment: "//", blockComment: ["/*", "*/"] },
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
        { open: "'", close: "'", notIn: ["string", "comment"] },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });
  }
}

/**
 * Legacy alias that registers all 44 ModelScript languages (including Modelica).
 */
export function registerModelicaLanguage(monaco: typeof Monaco): void {
  registerAllModelscriptLanguages(monaco);
}

// ────────────────────────────────────────────────────────────────────
// LSP Feature Providers
// ────────────────────────────────────────────────────────────────────

export interface MonacoLspAdapterCallbacks {
  onDiagnostics?: (uri: string, markers: Monaco.editor.IMarkerData[]) => void;
  onStatus?: (state: string, message: string) => void;
}

/**
 * Connect an existing LSP ProtocolConnection to Monaco's language services across all 44 languages.
 */
export function setupMonacoLspAdapter(
  monaco: typeof Monaco,
  connection: {
    onNotification: (method: string, handler: (params: any) => void) => Monaco.IDisposable;
    sendRequest: (method: string, params?: any) => Promise<any>;
  },
  _documentUri?: string,
  callbacks?: MonacoLspAdapterCallbacks,
): Monaco.IDisposable {
  registerAllModelscriptLanguages(monaco);

  const disposables: Monaco.IDisposable[] = [];
  const languageSelector = MORSEL_LANGUAGES.map((l) => l.id);

  // ── Status notifications ──
  if (callbacks?.onStatus) {
    const statusDisposable = connection.onNotification(
      "modelscript/status",
      (params: { state: string; message: string }) => {
        callbacks.onStatus?.(params.state, params.message);
      },
    );
    disposables.push(statusDisposable);
  }

  // ── Diagnostics (push from server) ──
  const diagDisposable = connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: {
      uri: string;
      diagnostics: {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        severity?: number;
        message: string;
        source?: string;
        code?: string | number;
      }[];
    }) => {
      const markers: Monaco.editor.IMarkerData[] = params.diagnostics.map((d) => {
        const marker: Monaco.editor.IMarkerData = {
          ...lspRangeToMonaco(d.range),
          severity: lspSeverityToMonaco(monaco, d.severity),
          message: d.message,
          source: d.source ?? "modelscript",
        };
        if (d.code !== undefined) {
          marker.code = String(d.code);
        }
        return marker;
      });
      callbacks?.onDiagnostics?.(params.uri, markers);

      const models = monaco.editor.getModels();
      const target = models.find((m) => m.uri.toString() === params.uri);
      if (!target) return;
      monaco.editor.setModelMarkers(target, "modelscript", markers);
    },
  );
  disposables.push(diagDisposable);

  // ── Completion ──
  disposables.push(
    monaco.languages.registerCompletionItemProvider(languageSelector, {
      triggerCharacters: [".", ":", "$", "@"],
      provideCompletionItems: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/completion", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          const items: any[] = Array.isArray(result) ? result : (result?.items ?? []);
          const word = model.getWordUntilPosition(position);
          const defaultRange: Monaco.IRange = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          };

          const suggestions: Monaco.languages.CompletionItem[] = items.map((item: any) => {
            const ci: Monaco.languages.CompletionItem = {
              label: item.label,
              kind: lspCompletionKindToMonaco(monaco, item.kind),
              detail: item.detail,
              documentation: item.documentation,
              insertText: item.insertText ?? item.label,
              range: item.textEdit?.range ? lspRangeToMonaco(item.textEdit.range) : defaultRange,
              sortText: item.sortText,
              filterText: item.filterText,
            };
            if (item.insertTextFormat === 2) {
              ci.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
            }
            return ci;
          });
          return { suggestions };
        } catch {
          return { suggestions: [] };
        }
      },
    }),
  );

  // ── Hover ──
  disposables.push(
    monaco.languages.registerHoverProvider(languageSelector, {
      provideHover: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          if (!result || !result.contents) return null;

          const contents: Monaco.IMarkdownString[] = [];
          if (typeof result.contents === "string") {
            contents.push({ value: result.contents });
          } else if (result.contents.value !== undefined) {
            contents.push({ value: result.contents.value });
          } else if (Array.isArray(result.contents)) {
            for (const c of result.contents) {
              contents.push({ value: typeof c === "string" ? c : c.value });
            }
          }

          const hover: Monaco.languages.Hover = { contents };
          if (result.range) {
            hover.range = lspRangeToMonaco(result.range);
          }
          return hover;
        } catch {
          return null;
        }
      },
    }),
  );

  // ── Semantic Tokens ──
  disposables.push(
    monaco.languages.registerDocumentSemanticTokensProvider(languageSelector, {
      getLegend: () => SEMANTIC_LEGEND,
      provideDocumentSemanticTokens: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/semanticTokens/full", {
            textDocument: { uri: model.uri.toString() },
          });
          if (!result?.data) return null;
          return { data: new Uint32Array(result.data) };
        } catch {
          return null;
        }
      },
      releaseDocumentSemanticTokens: () => {},
    }),
  );

  // ── Document Formatting ──
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider(languageSelector, {
      provideDocumentFormattingEdits: async (model, options) => {
        try {
          const result: any = await connection.sendRequest("textDocument/formatting", {
            textDocument: { uri: model.uri.toString() },
            options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
          });
          return (result ?? []).map((edit: any) => ({
            range: lspRangeToMonaco(edit.range),
            text: edit.newText,
          }));
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Color Provider ──
  disposables.push(
    monaco.languages.registerColorProvider(languageSelector, {
      provideDocumentColors: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/documentColor", {
            textDocument: { uri: model.uri.toString() },
          });
          return (result ?? []).map((ci: any) => ({
            range: lspRangeToMonaco(ci.range),
            color: ci.color,
          }));
        } catch {
          return [];
        }
      },
      provideColorPresentations: async (_model, colorInfo) => {
        try {
          const result: any = await connection.sendRequest("textDocument/colorPresentation", {
            textDocument: { uri: _model.uri.toString() },
            color: colorInfo.color,
            range: monacoRangeToLsp(colorInfo.range),
          });
          return (result ?? []).map((cp: any) => ({
            label: cp.label,
            textEdit: cp.textEdit
              ? { range: lspRangeToMonaco(cp.textEdit.range), text: cp.textEdit.newText }
              : undefined,
          }));
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Signature Help ──
  disposables.push(
    monaco.languages.registerSignatureHelpProvider(languageSelector, {
      signatureHelpTriggerCharacters: ["(", ","],
      provideSignatureHelp: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/signatureHelp", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          if (!result) return null;
          return {
            value: {
              signatures: result.signatures.map((s: any) => ({
                label: s.label,
                documentation: s.documentation,
                parameters: s.parameters?.map((p: any) => ({
                  label: p.label,
                  documentation: p.documentation,
                })),
              })),
              activeSignature: result.activeSignature ?? 0,
              activeParameter: result.activeParameter ?? 0,
            },
            dispose: () => {},
          };
        } catch {
          return null;
        }
      },
    }),
  );

  // ── Document Symbols ──
  disposables.push(
    monaco.languages.registerDocumentSymbolProvider(languageSelector, {
      provideDocumentSymbols: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/documentSymbol", {
            textDocument: { uri: model.uri.toString() },
          });
          const convertSymbol = (s: any): any => ({
            name: s.name,
            detail: s.detail ?? "",
            kind: s.kind,
            tags: s.tags ?? [],
            range: lspRangeToMonaco(s.range ?? s.location?.range),
            selectionRange: lspRangeToMonaco(s.selectionRange ?? s.range ?? s.location?.range),
            children: s.children?.map(convertSymbol),
          });
          return (result ?? []).map(convertSymbol);
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Document Highlights ──
  disposables.push(
    monaco.languages.registerDocumentHighlightProvider(languageSelector, {
      provideDocumentHighlights: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/documentHighlight", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          return (result ?? []).map((h: any) => ({
            range: lspRangeToMonaco(h.range),
            kind: h.kind,
          }));
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Definition ──
  disposables.push(
    monaco.languages.registerDefinitionProvider(languageSelector, {
      provideDefinition: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/definition", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          if (!result) return null;
          const items = Array.isArray(result) ? result : [result];
          return items
            .map((item) => convertLocationOrLink(monaco, item))
            .filter((loc): loc is Monaco.languages.Location => loc !== null);
        } catch {
          return null;
        }
      },
    }),
  );

  // ── Type Definition ──
  disposables.push(
    monaco.languages.registerTypeDefinitionProvider(languageSelector, {
      provideTypeDefinition: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/typeDefinition", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          if (!result) return null;
          const items = Array.isArray(result) ? result : [result];
          return items
            .map((item) => convertLocationOrLink(monaco, item))
            .filter((loc): loc is Monaco.languages.Location => loc !== null);
        } catch {
          return null;
        }
      },
    }),
  );

  // ── References ──
  disposables.push(
    monaco.languages.registerReferenceProvider(languageSelector, {
      provideReferences: async (model, position, context) => {
        try {
          const result: any = await connection.sendRequest("textDocument/references", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
            context: { includeDeclaration: context.includeDeclaration },
          });
          if (!Array.isArray(result)) return [];
          return result
            .map((item) => convertLocationOrLink(monaco, item))
            .filter((loc): loc is Monaco.languages.Location => loc !== null);
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Rename ──
  disposables.push(
    monaco.languages.registerRenameProvider(languageSelector, {
      provideRenameEdits: async (model, position, newName) => {
        try {
          const result: any = await connection.sendRequest("textDocument/rename", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
            newName,
          });
          if (!result) return null;
          return convertWorkspaceEdit(monaco, result);
        } catch {
          return null;
        }
      },
      resolveRenameLocation: async (model, position) => {
        try {
          const result: any = await connection.sendRequest("textDocument/prepareRename", {
            textDocument: { uri: model.uri.toString() },
            position: monacoPositionToLsp(position),
          });
          if (!result) {
            return {
              range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
              text: "",
              rejectReason: "Cannot rename this symbol",
            };
          }
          const range = lspRangeToMonaco(result.range ?? result);
          const text = result.placeholder ?? model.getValueInRange(range);
          return { range, text };
        } catch {
          return {
            range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            text: "",
            rejectReason: "Cannot rename this symbol",
          };
        }
      },
    }),
  );

  // ── Code Action ──
  disposables.push(
    monaco.languages.registerCodeActionProvider(languageSelector, {
      provideCodeActions: async (model, range, context) => {
        try {
          const result: any = await connection.sendRequest("textDocument/codeAction", {
            textDocument: { uri: model.uri.toString() },
            range: monacoRangeToLsp(range),
            context: {
              diagnostics: context.markers.map((m) => ({
                range: monacoRangeToLsp(m),
                message: m.message,
                severity: m.severity === monaco.MarkerSeverity.Error ? 1 : 2,
                code: typeof m.code === "object" ? m.code.value : m.code,
                source: m.source,
              })),
            },
          });
          const actions: Monaco.languages.CodeAction[] = (result ?? []).map((ca: any) => ({
            title: ca.title,
            kind: ca.kind,
            isPreferred: ca.isPreferred,
            edit: ca.edit ? convertWorkspaceEdit(monaco, ca.edit) : undefined,
          }));
          return { actions, dispose: () => {} };
        } catch {
          return { actions: [], dispose: () => {} };
        }
      },
    }),
  );

  // ── Code Lens ──
  disposables.push(
    monaco.languages.registerCodeLensProvider(languageSelector, {
      provideCodeLenses: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/codeLens", {
            textDocument: { uri: model.uri.toString() },
          });
          const lenses: Monaco.languages.CodeLens[] = (result ?? []).map((cl: any) => ({
            range: lspRangeToMonaco(cl.range),
            id: cl.data ? String(cl.data) : undefined,
            command: cl.command
              ? {
                  id: cl.command.command ?? "",
                  title: cl.command.title ?? "",
                  arguments: cl.command.arguments,
                }
              : undefined,
          }));
          return { lenses, dispose: () => {} };
        } catch {
          return { lenses: [], dispose: () => {} };
        }
      },
    }),
  );

  // ── Inlay Hints ──
  disposables.push(
    monaco.languages.registerInlayHintsProvider(languageSelector, {
      provideInlayHints: async (model, range) => {
        try {
          const result: any = await connection.sendRequest("textDocument/inlayHint", {
            textDocument: { uri: model.uri.toString() },
            range: monacoRangeToLsp(range),
          });
          const hints: Monaco.languages.InlayHint[] = (result ?? []).map((ih: any) => ({
            position: {
              lineNumber: (ih.position?.line ?? 0) + 1,
              column: (ih.position?.character ?? 0) + 1,
            },
            label:
              typeof ih.label === "string"
                ? ih.label
                : Array.isArray(ih.label)
                  ? ih.label.map((part: any) => part.value ?? "").join("")
                  : "",
            kind: ih.kind === 1 ? monaco.languages.InlayHintKind.Type : monaco.languages.InlayHintKind.Parameter,
            paddingLeft: ih.paddingLeft,
            paddingRight: ih.paddingRight,
          }));
          return { hints, dispose: () => {} };
        } catch {
          return { hints: [], dispose: () => {} };
        }
      },
    }),
  );

  // ── Folding Ranges ──
  disposables.push(
    monaco.languages.registerFoldingRangeProvider(languageSelector, {
      provideFoldingRanges: async (model) => {
        try {
          const result: any = await connection.sendRequest("textDocument/foldingRange", {
            textDocument: { uri: model.uri.toString() },
          });
          return (result ?? []).map((fr: any) => ({
            start: (fr.startLine ?? 0) + 1,
            end: (fr.endLine ?? 0) + 1,
            kind:
              fr.kind === "comment"
                ? monaco.languages.FoldingRangeKind.Comment
                : fr.kind === "imports"
                  ? monaco.languages.FoldingRangeKind.Imports
                  : monaco.languages.FoldingRangeKind.Region,
          }));
        } catch {
          return [];
        }
      },
    }),
  );

  // ── Selection Ranges ──
  disposables.push(
    monaco.languages.registerSelectionRangeProvider(languageSelector, {
      provideSelectionRanges: async (model, positions) => {
        try {
          const result: any = await connection.sendRequest("textDocument/selectionRange", {
            textDocument: { uri: model.uri.toString() },
            positions: positions.map(monacoPositionToLsp),
          });
          if (!Array.isArray(result)) return [];
          return result.map((sr: any) => {
            const list: Monaco.languages.SelectionRange[] = [];
            let curr = sr;
            while (curr && curr.range) {
              list.push({ range: lspRangeToMonaco(curr.range) });
              curr = curr.parent;
            }
            return list;
          });
        } catch {
          return [];
        }
      },
    }),
  );

  return {
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export async function registerMonacoLspProviders(
  monaco: typeof Monaco,
  initialLanguageId?: string,
  callbacks?: MonacoLspAdapterCallbacks,
): Promise<Monaco.IDisposable> {
  const connection = await startLsp(initialLanguageId);
  return setupMonacoLspAdapter(monaco, connection as any, undefined, callbacks);
}
