// SPDX-License-Identifier: AGPL-3.0-or-later

export interface GeneralCodeLanguageInfo {
  id: string;
  label: string;
  ext: string;
  defaultCode: string;
}

export const GENERAL_CODE_LANGUAGES: readonly GeneralCodeLanguageInfo[] = [
  {
    id: "typescript",
    label: "TypeScript",
    ext: "ts",
    defaultCode: `export interface SimulationConfig {\n  stopTime: number;\n  tolerance: number;\n}\n\nexport function runStep(t: number, dt: number): number {\n  return t + dt;\n}\n`,
  },
  {
    id: "python",
    label: "Python",
    ext: "py",
    defaultCode: `import numpy as np\n\ndef damped_oscillator(t: np.ndarray, omega: float = 2.0, zeta: float = 0.15) -> np.ndarray:\n    return np.exp(-zeta * omega * t) * np.cos(omega * np.sqrt(1 - zeta**2) * t)\n`,
  },
  {
    id: "rust",
    label: "Rust",
    ext: "rs",
    defaultCode: `pub struct State {\n    pub x: f64,\n    pub v: f64,\n}\n\npub fn step_euler(state: &mut State, k: f64, m: f64, dt: f64) {\n    let a = -k * state.x / m;\n    state.v += a * dt;\n    state.x += state.v * dt;\n}\n`,
  },
  {
    id: "cpp",
    label: "C++",
    ext: "cpp",
    defaultCode: `#include <cmath>\n\ndouble computeDampingForce(double c, double velocity) {\n  return -c * velocity;\n}\n`,
  },
  {
    id: "julia",
    label: "Julia",
    ext: "jl",
    defaultCode: `function harmonic_rhs!(du, u, p, t)\n    k, m, c = p\n    du[1] = u[2]\n    du[2] = -(k / m) * u[1] - (c / m) * u[2]\nend\n`,
  },
  {
    id: "matlab",
    label: "MATLAB",
    ext: "m",
    defaultCode: `function dydt = oscillator_ode(t, y, m, c, k)\n    dydt = [y(2); -(c/m)*y(2) - (k/m)*y(1)];\nend\n`,
  },
  {
    id: "json",
    label: "JSON",
    ext: "json",
    defaultCode: `{\n  "solver": "CVODE",\n  "stopTime": 10.0,\n  "tolerance": 1e-6\n}\n`,
  },
  {
    id: "bash",
    label: "Bash",
    ext: "sh",
    defaultCode: `#!/usr/bin/env bash\nmsx simulate DampedOscillator.mo --stop-time 10.0\n`,
  },
] as const;

export interface SnippetDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  quickFix?:
    | {
        label: string;
        replacementCode: string;
      }
    | undefined;
}

/**
 * Strips comments and string literals while preserving exact line breaks and character indices.
 */
function maskCommentsAndStrings(code: string, lang: string): string {
  const chars = code.split("");
  const len = chars.length;
  let i = 0;
  const usesHashComment =
    lang === "python" || lang === "bash" || lang === "sh" || lang === "julia" || lang === "yaml" || lang === "toml";
  const usesPercentComment = lang === "matlab";

  while (i < len) {
    const ch = chars[i];
    const next = i + 1 < len ? chars[i + 1] : "";

    // Line comment //
    if (!usesHashComment && !usesPercentComment && ch === "/" && next === "/") {
      while (i < len && chars[i] !== "\n") {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    // Hash comment #
    if (usesHashComment && ch === "#") {
      while (i < len && chars[i] !== "\n") {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    // Percent comment %
    if (usesPercentComment && ch === "%") {
      while (i < len && chars[i] !== "\n") {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    // Block comment /* ... */
    if (!usesHashComment && !usesPercentComment && ch === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < len) {
        if (chars[i] === "*" && i + 1 < len && chars[i + 1] === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          i += 2;
          break;
        }
        if (chars[i] !== "\n") {
          chars[i] = " ";
        }
        i++;
      }
      continue;
    }

    // Double-quoted string "..."
    if (ch === '"') {
      chars[i] = " ";
      i++;
      while (i < len && chars[i] !== '"') {
        if (chars[i] === "\\" && i + 1 < len) {
          if (chars[i] !== "\n") chars[i] = " ";
          i++;
        }
        if (chars[i] !== "\n") {
          chars[i] = " ";
        }
        i++;
      }
      if (i < len && chars[i] === '"') {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    i++;
  }

  return chars.join("");
}

function offsetToLineCol(code: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lastNewline = -1;
  const clamped = Math.max(0, Math.min(offset, code.length));
  for (let i = 0; i < clamped; i++) {
    if (code.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: clamped - lastNewline };
}

/**
 * Extracts primary construct kind & identifier (e.g. `model X`, `part def Vehicle`, `function runStep`).
 */
export function extractPrimaryConstructInfo(code: string, lang: string): { kind: string; name: string } | null {
  if (!code || !code.trim()) return null;
  const masked = maskCommentsAndStrings(code, lang);

  if (lang === "modelica" || lang === "modelscript") {
    const match = masked.match(
      /\b(?:partial\s+|expandable\s+|encapsulated\s+|pure\s+|impure\s+)*(model|block|class|package|connector|record|function|type)\s+([A-Za-z_]\w*)/,
    );
    if (match?.[1] && match[2]) {
      return { kind: match[1], name: match[2] };
    }
  }

  if (lang === "sysml2") {
    const match = masked.match(
      /\b(package|part\s+def|item\s+def|action\s+def|state\s+def|requirement\s+def)\s+([A-Za-z_]\w*)/,
    );
    if (match?.[1] && match[2]) {
      return { kind: match[1].replace(/\s+/g, " "), name: match[2] };
    }
  }

  const genericMatch = masked.match(
    /\b(model|package|class|struct|interface|function|def|fn|module|program|subroutine|Ontology)\s+([A-Za-z_]\w*)/,
  );
  if (genericMatch?.[1] && genericMatch[2]) {
    return { kind: genericMatch[1], name: genericMatch[2] };
  }

  return null;
}

/**
 * Infers a default filename (e.g. `X.mo`) from the code's primary declaration.
 */
export function inferSnippetFilename(code: string, lang: string, ext: string): string {
  const cleanExt = ext.replace(/^\./, "") || lang;
  const info = extractPrimaryConstructInfo(code, lang);
  if (info?.name) {
    return `${info.name}.${cleanExt}`;
  }
  return "";
}

/**
 * Resolves the effective filename for a snippet, appending `.${ext}` if the user typed a bare identifier like `Model1`.
 */
export function resolveSnippetFilename(userFilename: string, code: string, lang: string, ext: string): string {
  const cleanExt = ext.replace(/^\./, "") || lang;
  const trimmed = userFilename.trim();
  if (trimmed) {
    if (/\.[a-zA-Z0-9_]+$/.test(trimmed)) {
      return trimmed;
    }
    return `${trimmed}.${cleanExt}`;
  }
  return inferSnippetFilename(code, lang, cleanExt);
}

/**
 * Formats a language-appropriate file comment header (omitting for comment-less formats like JSON/CSV).
 */
export function formatLanguageFileHeader(filename: string, lang: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "";
  const lower = lang.toLowerCase();
  if (lower === "json" || lower === "csv" || lower === "tsv") {
    return "";
  }
  if (
    lower === "python" ||
    lower === "py" ||
    lower === "bash" ||
    lower === "sh" ||
    lower === "julia" ||
    lower === "jl" ||
    lower === "yaml" ||
    lower === "toml" ||
    lower === "r" ||
    lower === "ruby"
  ) {
    return `# File: ${trimmed}\n`;
  }
  if (lower === "matlab") {
    return `% File: ${trimmed}\n`;
  }
  if (lower === "fortran") {
    return `! File: ${trimmed}\n`;
  }
  if (lower === "sql" || lower === "lua" || lower === "vhdl") {
    return `-- File: ${trimmed}\n`;
  }
  if (lower === "xml" || lower === "html" || lower === "svg" || lower === "ssp" || lower === "tei") {
    return `<!-- File: ${trimmed} -->\n`;
  }
  if (lower === "spice") {
    return `* File: ${trimmed}\n`;
  }
  return `// File: ${trimmed}\n`;
}

/**
 * Extracts a leading `File: <name>` header comment (across `//`, `#`, `%`, `!`, `--`, `<!-- -->`) from a fenced block body.
 */
export function parseLanguageFileHeader(rawBody: string): { filename: string; body: string } {
  const match = rawBody.match(/^(?:\/\/|#|%|!|--|\*)\s*(?:File|Filename):\s*([^\n]+?)\n([\s\S]*)$/i);
  if (match) {
    return {
      filename: match[1]!.trim(),
      body: match[2] ?? "",
    };
  }
  const xmlMatch = rawBody.match(/^<!--\s*(?:File|Filename):\s*([^\n]+?)\s*-->\n([\s\S]*)$/i);
  if (xmlMatch) {
    return {
      filename: xmlMatch[1]!.trim(),
      body: xmlMatch[2] ?? "",
    };
  }
  return { filename: "", body: rawBody };
}

const CONTROL_FLOW_END_KEYWORDS = new Set(["if", "for", "while", "when"]);

/**
 * Performs synchronous syntax & semantic validation on a code snippet, returning structured diagnostics
 * with line/column positions and optional one-click quick fixes.
 */
export function analyzeSnippetDiagnostics(code: string, lang: string): SnippetDiagnostic[] {
  if (!code || !code.trim()) return [];
  const diagnostics: SnippetDiagnostic[] = [];
  const lowerLang = lang.toLowerCase();

  // 1. JSON validation
  if (lowerLang === "json") {
    try {
      JSON.parse(code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || "Invalid JSON syntax.");
      const posMatch = msg.match(/position\s+(\d+)/i);
      const pos = posMatch ? Number(posMatch[1]) : 0;
      const loc = offsetToLineCol(code, pos);
      diagnostics.push({
        code: "JSON001",
        severity: "error",
        message: msg,
        startLineNumber: loc.line,
        startColumn: loc.col,
        endLineNumber: loc.line,
        endColumn: loc.col + 1,
      });
    }
    return diagnostics;
  }

  const masked = maskCommentsAndStrings(code, lowerLang);

  // 2. Balanced delimiter check `(`, `[`, `{`
  const stack: { char: string; expected: string; offset: number }[] = [];
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "(") stack.push({ char: "(", expected: ")", offset: i });
    else if (ch === "[") stack.push({ char: "[", expected: "]", offset: i });
    else if (ch === "{") stack.push({ char: "{", expected: "}", offset: i });
    else if (ch === ")" || ch === "]" || ch === "}") {
      const top = stack[stack.length - 1];
      if (!top) {
        const loc = offsetToLineCol(code, i);
        diagnostics.push({
          code: "M1001",
          severity: "error",
          message: `Parse error: unexpected closing '${ch}'.`,
          startLineNumber: loc.line,
          startColumn: loc.col,
          endLineNumber: loc.line,
          endColumn: loc.col + 1,
        });
      } else if (top.expected !== ch) {
        const loc = offsetToLineCol(code, i);
        diagnostics.push({
          code: "M1001",
          severity: "error",
          message: `Parse error: expected '${top.expected}' to close '${top.char}', but found '${ch}'.`,
          startLineNumber: loc.line,
          startColumn: loc.col,
          endLineNumber: loc.line,
          endColumn: loc.col + 1,
        });
        stack.pop();
      } else {
        stack.pop();
      }
    }
  }
  for (const unclosed of stack) {
    const loc = offsetToLineCol(code, unclosed.offset);
    diagnostics.push({
      code: "M1002",
      severity: "error",
      message: `Parse error: '${unclosed.expected}' expected to close '${unclosed.char}'.`,
      startLineNumber: loc.line,
      startColumn: loc.col,
      endLineNumber: loc.line,
      endColumn: loc.col + 1,
    });
  }

  // 3. Modelica & ModelScript semantic / structural checks
  if (lowerLang === "modelica" || lowerLang === "modelscript") {
    // Check 3a: Start / End class identifier matching (M2005) & unclosed classes (M1002)
    const tokenRegex =
      /\b(?:(partial|expandable|encapsulated|pure|impure|operator)\s+)*(model|block|class|connector|record|package|function|type)\s+([A-Za-z_]\w*)(\s*=)?|\bend\s+([A-Za-z_]\w*)\s*;/g;

    const classStack: { kind: string; name: string; offset: number; nameOffset: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(masked)) !== null) {
      const classKind = match[2];
      const startIdent = match[3];
      const isShortClassDef = Boolean(match[4]);
      const endIdent = match[5];

      if (classKind && startIdent) {
        if (!isShortClassDef) {
          const nameOffset = match.index + match[0].indexOf(startIdent);
          classStack.push({
            kind: classKind,
            name: startIdent,
            offset: match.index,
            nameOffset,
          });
        }
      } else if (endIdent) {
        if (CONTROL_FLOW_END_KEYWORDS.has(endIdent)) {
          continue;
        }
        const endIdentOffset = match.index + match[0].indexOf(endIdent);
        const endLoc = offsetToLineCol(code, endIdentOffset);
        const top = classStack.pop();
        if (!top) {
          diagnostics.push({
            code: "M1001",
            severity: "error",
            message: `Parse error: unexpected 'end ${endIdent};' without matching class declaration.`,
            startLineNumber: endLoc.line,
            startColumn: endLoc.col,
            endLineNumber: endLoc.line,
            endColumn: endLoc.col + endIdent.length,
          });
        } else if (top.name !== endIdent) {
          const fixedCode = code.slice(0, endIdentOffset) + top.name + code.slice(endIdentOffset + endIdent.length);
          diagnostics.push({
            code: "M2005",
            severity: "error",
            message: `The identifier at start and end are different ('${top.name}' vs '${endIdent}').`,
            startLineNumber: endLoc.line,
            startColumn: endLoc.col,
            endLineNumber: endLoc.line,
            endColumn: endLoc.col + endIdent.length,
            quickFix: {
              label: `Change to 'end ${top.name};'`,
              replacementCode: fixedCode,
            },
          });
        }
      }
    }

    for (const unclosed of classStack) {
      const loc = offsetToLineCol(code, unclosed.nameOffset);
      diagnostics.push({
        code: "M1002",
        severity: "error",
        message: `Parse error: 'end ${unclosed.name};' expected.`,
        startLineNumber: loc.line,
        startColumn: loc.col,
        endLineNumber: loc.line,
        endColumn: loc.col + unclosed.name.length,
        quickFix: {
          label: `Append 'end ${unclosed.name};'`,
          replacementCode: `${code.trimEnd()}\nend ${unclosed.name};\n`,
        },
      });
    }

    // Check 3b: Empty array constructors `[]` or `{}` (M1003)
    const emptyArrayRegex = /=\s*(\[\s*\]|\{\s*\})/g;
    let emptyMatch: RegExpExecArray | null;
    while ((emptyMatch = emptyArrayRegex.exec(masked)) !== null) {
      const arrOffset = emptyMatch.index + emptyMatch[0].indexOf(emptyMatch[1]!);
      const loc = offsetToLineCol(code, arrOffset);
      diagnostics.push({
        code: "M1003",
        severity: "error",
        message: "Empty array constructor is not valid in Modelica.",
        startLineNumber: loc.line,
        startColumn: loc.col,
        endLineNumber: loc.line,
        endColumn: loc.col + emptyMatch[1]!.length,
      });
    }

    // Check 3c: Type mismatch in variable bindings (M3001)
    const declRegex =
      /\b(?:parameter\s+|constant\s+|discrete\s+|input\s+|output\s+)*(Real|Integer|Boolean|String)\s+([A-Za-z_]\w*)\s*(?:\([^;\n]*\))?\s*=\s*([^;\n]+);/g;
    let declMatch: RegExpExecArray | null;
    while ((declMatch = declRegex.exec(code)) !== null) {
      const declaredType = declMatch[1]!;
      const varName = declMatch[2]!;
      const rawExpr = declMatch[3]!.trim();
      const exprOffset = declMatch.index + declMatch[0].lastIndexOf(declMatch[3]!);
      const loc = offsetToLineCol(code, exprOffset);

      let inferredLiteralType: "Real" | "Integer" | "Boolean" | "String" | null = null;
      if (/^"[^"]*"$/.test(rawExpr)) {
        inferredLiteralType = "String";
      } else if (/^(true|false)$/.test(rawExpr)) {
        inferredLiteralType = "Boolean";
      } else if (/^[+-]?\d+$/.test(rawExpr)) {
        inferredLiteralType = "Integer";
      } else if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+[eE][+-]?\d+|\d+\.\d*[eE][+-]?\d+)$/.test(rawExpr)) {
        inferredLiteralType = "Real";
      }

      if (inferredLiteralType && inferredLiteralType !== declaredType) {
        // Note: Integer is coerced to Real in Modelica (`Real x = 1` is valid)
        const isValidCoercion = declaredType === "Real" && inferredLiteralType === "Integer";
        if (!isValidCoercion) {
          diagnostics.push({
            code: "M3001",
            severity: "error",
            message: `Type mismatch in binding ${varName} = ${rawExpr}, expected subtype of ${declaredType}, got type ${inferredLiteralType}.`,
            startLineNumber: loc.line,
            startColumn: loc.col,
            endLineNumber: loc.line,
            endColumn: loc.col + rawExpr.length,
          });
        }
      }
    }
  }

  return diagnostics;
}
