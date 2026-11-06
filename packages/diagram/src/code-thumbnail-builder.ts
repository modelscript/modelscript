// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CodeThumbnailOptions {
  dialect?: string | undefined;
  title?: string | undefined;
  className?: string | undefined;
  classKind?: string | undefined;
  isPartial?: boolean | undefined;
  maxLines?: number | undefined;
  theme?: "dark" | "light" | undefined;
}

export interface DialectMeta {
  badge: string;
  accent: string;
  commentRe: RegExp;
  keywords: Set<string>;
  types: Set<string>;
}

function escapeXml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const FORTRAN_KEYWORDS = new Set([
  "module",
  "endmodule",
  "program",
  "endprogram",
  "subroutine",
  "endsubroutine",
  "function",
  "endfunction",
  "contains",
  "use",
  "intrinsic",
  "only",
  "implicit",
  "none",
  "private",
  "public",
  "pure",
  "elemental",
  "impure",
  "recursive",
  "result",
  "end",
  "if",
  "then",
  "elseif",
  "else",
  "endif",
  "do",
  "enddo",
  "while",
  "select",
  "case",
  "return",
  "call",
  "interface",
  "type",
  "class",
  "intent",
  "in",
  "out",
  "inout",
  "parameter",
  "dimension",
  "allocatable",
  "allocate",
  "deallocate",
  "where",
  "elsewhere",
  "endwhere",
  "forall",
  "endforall",
  "exit",
  "cycle",
  "print",
  "write",
  "read",
  "format",
  "open",
  "close",
]);

const FORTRAN_TYPES = new Set([
  "real",
  "integer",
  "logical",
  "character",
  "complex",
  "double",
  "precision",
  "dp",
  "real64",
  "real32",
  "int32",
  "int64",
  "iso_fortran_env",
]);

const MODELICA_KEYWORDS = new Set([
  "model",
  "block",
  "connector",
  "record",
  "package",
  "type",
  "function",
  "class",
  "operator",
  "optimization",
  "end",
  "equation",
  "algorithm",
  "initial",
  "parameter",
  "constant",
  "discrete",
  "input",
  "output",
  "flow",
  "stream",
  "connect",
  "der",
  "when",
  "elsewhen",
  "if",
  "then",
  "else",
  "elseif",
  "for",
  "in",
  "loop",
  "while",
  "extends",
  "redeclare",
  "replaceable",
  "import",
  "within",
  "partial",
  "final",
  "encapsulated",
  "expandable",
  "pure",
  "impure",
  "break",
  "return",
  "true",
  "false",
  "and",
  "or",
  "not",
]);

const MODELICA_TYPES = new Set(["Real", "Integer", "Boolean", "String", "StateSelect", "ExternalObject"]);

const C_KEYWORDS = new Set([
  "include",
  "define",
  "struct",
  "union",
  "enum",
  "typedef",
  "const",
  "static",
  "extern",
  "inline",
  "volatile",
  "auto",
  "register",
  "sizeof",
  "if",
  "else",
  "switch",
  "case",
  "default",
  "while",
  "do",
  "for",
  "goto",
  "continue",
  "break",
  "return",
  "class",
  "template",
  "namespace",
  "public",
  "private",
  "protected",
  "virtual",
  "override",
  "constexpr",
]);

const C_TYPES = new Set([
  "void",
  "char",
  "short",
  "int",
  "long",
  "float",
  "double",
  "signed",
  "unsigned",
  "bool",
  "size_t",
  "int8_t",
  "int16_t",
  "int32_t",
  "int64_t",
  "uint8_t",
  "uint16_t",
  "uint32_t",
  "uint64_t",
]);

const GENERIC_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "elseif",
  "endif",
  "for",
  "while",
  "loop",
  "do",
  "end",
  "return",
  "def",
  "fn",
  "function",
  "subroutine",
  "procedure",
  "class",
  "struct",
  "module",
  "import",
  "export",
  "package",
  "const",
  "let",
  "var",
  "val",
  "true",
  "false",
  "null",
  "nil",
  "none",
  "and",
  "or",
  "not",
  "is",
  "as",
  "in",
]);

const GENERIC_TYPES = new Set([
  "Real",
  "Integer",
  "Boolean",
  "String",
  "Float",
  "Int",
  "Bool",
  "real",
  "integer",
  "logical",
  "character",
  "float",
  "double",
  "int",
  "char",
  "void",
]);

export function getDialectMeta(dialect = "modelica"): DialectMeta {
  const d = dialect.toLowerCase().trim();
  if (d === "fortran" || d === "f90" || d === "f95" || d === "f08" || d === "f18") {
    return {
      badge: "FORTRAN 90",
      accent: "#818cf8",
      commentRe: /^\s*(!|c\s|C\s)/,
      keywords: FORTRAN_KEYWORDS,
      types: FORTRAN_TYPES,
    };
  }
  if (d === "c" || d === "cpp" || d === "h" || d === "hpp") {
    return {
      badge: d.toUpperCase(),
      accent: "#38bdf8",
      commentRe: /^\s*(\/\/|\/\*)/,
      keywords: C_KEYWORDS,
      types: C_TYPES,
    };
  }
  if (d === "scad" || d === "csg") {
    return {
      badge: "OPENSCAD",
      accent: "#f59e0b",
      commentRe: /^\s*(\/\/|\/\*)/,
      keywords: new Set([
        "module",
        "function",
        "use",
        "include",
        "difference",
        "intersection",
        "union",
        "translate",
        "rotate",
        "scale",
        "cube",
        "sphere",
        "cylinder",
        "polyhedron",
        "for",
        "if",
        "else",
        "let",
      ]),
      types: new Set(["true", "false", "undef"]),
    };
  }
  if (d === "spice" || d === "cir") {
    return {
      badge: "SPICE",
      accent: "#ef4444",
      commentRe: /^\s*(\*|;)/,
      keywords: new Set([
        ".subckt",
        ".ends",
        ".model",
        ".tran",
        ".ac",
        ".dc",
        ".op",
        ".measure",
        ".param",
        ".include",
        ".lib",
        ".end",
      ]),
      types: new Set(["R", "C", "L", "V", "I", "D", "Q", "M", "X"]),
    };
  }
  if (d === "python" || d === "py") {
    return {
      badge: "PYTHON",
      accent: "#3b82f6",
      commentRe: /^\s*#/,
      keywords: new Set([
        "def",
        "class",
        "import",
        "from",
        "as",
        "return",
        "yield",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "break",
        "continue",
        "pass",
        "try",
        "except",
        "finally",
        "with",
        "lambda",
        "global",
        "nonlocal",
        "async",
        "await",
        "True",
        "False",
        "None",
        "and",
        "or",
        "not",
        "is",
        "in",
      ]),
      types: new Set(["int", "float", "str", "bool", "list", "dict", "set", "tuple"]),
    };
  }
  if (d === "julia" || d === "jl") {
    return {
      badge: "JULIA",
      accent: "#a855f7",
      commentRe: /^\s*#/,
      keywords: new Set([
        "function",
        "end",
        "struct",
        "mutable",
        "module",
        "using",
        "import",
        "export",
        "if",
        "elseif",
        "else",
        "for",
        "while",
        "return",
        "break",
        "continue",
        "const",
        "global",
        "local",
        "macro",
        "true",
        "false",
      ]),
      types: new Set(["Float64", "Float32", "Int64", "Int32", "Bool", "String", "Vector", "Matrix", "Array"]),
    };
  }
  if (d === "sysml" || d === "sysml2" || d === "kerml") {
    return {
      badge: "SYSML V2",
      accent: "#38bdf8",
      commentRe: /^\s*(\/\/|\/\*)/,
      keywords: new Set([
        "package",
        "part",
        "port",
        "item",
        "action",
        "state",
        "requirement",
        "connection",
        "interface",
        "attribute",
        "import",
        "private",
        "public",
        "def",
        "in",
        "out",
        "inout",
        "end",
      ]),
      types: new Set(["Real", "Integer", "Boolean", "String", "ScalarValues"]),
    };
  }
  if (d === "energyplus" || d === "idf") {
    return {
      badge: "ENERGYPLUS",
      accent: "#10b981",
      commentRe: /^\s*!/,
      keywords: new Set([
        "version",
        "building",
        "zone",
        "surface",
        "construction",
        "material",
        "schedule",
        "people",
        "lights",
      ]),
      types: new Set([]),
    };
  }
  if (d === "modelscript" || d === "msx") {
    return {
      badge: "MODELSCRIPT",
      accent: "#06b6d4",
      commentRe: /^\s*\/\//,
      keywords: MODELICA_KEYWORDS,
      types: MODELICA_TYPES,
    };
  }
  return {
    badge: d.toUpperCase(),
    accent: "#06b6d4",
    commentRe: /^\s*(\/\/|#|!|\*|;)/,
    keywords: GENERIC_KEYWORDS,
    types: GENERIC_TYPES,
  };
}

export function highlightCodeLineToSvgTspans(line: string, meta: DialectMeta): string {
  // Check full line comment
  if (meta.commentRe.test(line)) {
    return `<tspan fill="#8b949e" font-style="italic">${escapeXml(line)}</tspan>`;
  }

  // Inline comment splitting (detect //, !, #, or /*)
  let commentIdx = -1;
  const rawIdxSlash = line.indexOf("//");
  const rawIdxBang = line.indexOf("!");
  const rawIdxHash = line.indexOf("#");
  const candidates = [rawIdxSlash, rawIdxBang, rawIdxHash].filter((idx) => idx >= 0);
  if (candidates.length > 0) {
    commentIdx = Math.min(...candidates);
  }

  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : "";

  const tokenRe =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?(?:[eEdD][+-]?\d+)?(?:_[A-Za-z0-9_]+)?\b|[A-Za-z_][A-Za-z0-9_]*|[^\s"A-Za-z0-9_']+|\s+)/g;

  const spans: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(codePart)) !== null) {
    const tok = m[0];
    if (!tok) continue;

    if (/^\s+$/.test(tok)) {
      spans.push(escapeXml(tok));
    } else if (tok.startsWith('"') || tok.startsWith("'")) {
      spans.push(`<tspan fill="#a5d6ff">${escapeXml(tok)}</tspan>`);
    } else if (/^\d/.test(tok)) {
      spans.push(`<tspan fill="#d2a8ff">${escapeXml(tok)}</tspan>`);
    } else if (meta.keywords.has(tok) || meta.keywords.has(tok.toLowerCase())) {
      spans.push(`<tspan fill="#ff7b72" font-weight="600">${escapeXml(tok)}</tspan>`);
    } else if (meta.types.has(tok) || meta.types.has(tok.toLowerCase())) {
      spans.push(`<tspan fill="#79c0ff">${escapeXml(tok)}</tspan>`);
    } else if (/^(?:::|=>|->|:=|==|\/=|!=|<=|>=|<|>)$/.test(tok)) {
      spans.push(`<tspan fill="#6366f1" font-weight="600">${escapeXml(tok)}</tspan>`);
    } else {
      spans.push(`<tspan fill="#e6edf3">${escapeXml(tok)}</tspan>`);
    }
  }

  if (commentPart) {
    spans.push(`<tspan fill="#8b949e" font-style="italic">${escapeXml(commentPart)}</tspan>`);
  }

  return spans.join("");
}

export function detectPrimarySymbol(
  content: string,
  dialect = "modelica",
): { name: string; kind: string; isPartial: boolean } | null {
  const d = dialect.toLowerCase().trim();

  if (d === "fortran" || d === "f90" || d === "f95" || d === "f08" || d === "f18") {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const modMatch = /^\s*(module|program)\s+(?!procedure\b)([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
      if (modMatch?.[1] && modMatch[2]) {
        return { name: modMatch[2], kind: modMatch[1].toLowerCase(), isPartial: false };
      }
      const procMatch =
        /^\s*(?:(?:pure|elemental|impure|recursive|module)\s+)*(subroutine|function)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(
          line,
        );
      if (procMatch?.[1] && procMatch[2]) {
        return { name: procMatch[2], kind: procMatch[1].toLowerCase(), isPartial: false };
      }
    }
    return null;
  }

  // Modelica / SysML / Generic
  const headerMatch = content.match(
    /\b(partial\s+)?(model|class|block|connector|record|package|function|type|subroutine|module|program)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
  );
  if (headerMatch && headerMatch[3]) {
    return {
      name: headerMatch[3],
      kind: (headerMatch[2] || "model").toLowerCase(),
      isPartial: Boolean(headerMatch[1]),
    };
  }

  return null;
}

/**
 * Universal Code Thumbnail SVG Renderer
 * Renders an 800x450 syntax-highlighted editor card for any of ModelScript's 66 languages.
 */
export function renderUniversalCodeThumbnailSvg(code: string, options: CodeThumbnailOptions = {}): string {
  const dialect = options.dialect || "modelica";
  const meta = getDialectMeta(dialect);
  const detected = detectPrimarySymbol(code, dialect);

  const className = options.className || detected?.name || options.title || "Source";
  const classKind = (options.classKind || detected?.kind || "code").toUpperCase();
  const isPartial = options.isPartial ?? detected?.isPartial ?? false;
  const maxLines = options.maxLines ?? 16;

  const allLines = code.replace(/\r\n/g, "\n").split("\n");
  const visibleLines = allLines.slice(0, maxLines);

  const badgeText = `${isPartial ? "PARTIAL " : ""}${meta.badge} · ${classKind}`;
  const badgeWidth = Math.max(120, Math.min(220, badgeText.length * 7.5 + 24));
  const badgeTextX = 20 + badgeWidth / 2;
  const titleX = 20 + badgeWidth + 12;

  const lineEls = visibleLines.map((rawLine, idx) => {
    const y = 78 + idx * 21;
    const clipped = rawLine.length > 88 ? `${rawLine.slice(0, 85)}...` : rawLine;
    return `<g>
      <text x="48" y="${y}" text-anchor="end" fill="#484f58" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${idx + 1}</text>
      <text x="64" y="${y}" xml:space="preserve" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5">${highlightCodeLineToSvgTspans(clipped, meta)}</text>
    </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%" data-preview-mode="code" data-dialect="${escapeXml(dialect)}">
  <rect width="800" height="450" fill="#0d1117" rx="8"/>
  <g transform="translate(20, 14)">
    <rect x="0" y="0" width="${badgeWidth}" height="22" rx="4" fill="rgba(99, 102, 241, 0.12)" stroke="${meta.accent}" stroke-opacity="0.4"/>
    <text x="${badgeTextX - 20}" y="15" text-anchor="middle" fill="${meta.accent}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700">${escapeXml(badgeText)}</text>
    <text x="${titleX - 20}" y="16" fill="#f0f6fc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="700">${escapeXml(className)}</text>
    <text x="760" y="15" text-anchor="end" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${allLines.length} lines</text>
  </g>
  <rect x="20" y="46" width="760" height="384" rx="8" fill="#161b22" stroke="#30363d" stroke-width="1"/>
  <line x1="56" y1="46" x2="56" y2="430" stroke="#21262d" stroke-width="1"/>
  ${lineEls.join("\n  ")}
  ${
    allLines.length > maxLines
      ? `<text x="64" y="418" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">… +${allLines.length - maxLines} more lines</text>`
      : ""
  }
</svg>`;
}
