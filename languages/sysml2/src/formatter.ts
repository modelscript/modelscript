// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SysML v2 / KerML Document Formatter.
 *
 * Provides syntax-aware, comment-preserving indentation, keyword alignment,
 * and whitespace normalization for .sysml and .kerml files.
 */

export interface SysMLFormatOptions {
  /** Number of spaces per indentation level (default: 2) */
  tabSize?: number | undefined;
  /** Whether to use spaces (true) or tabs (false) */
  insertSpaces?: boolean | undefined;
  /** Range formatting: start line (0-indexed, inclusive) */
  startLine?: number | undefined;
  /** Range formatting: end line (0-indexed, inclusive) */
  endLine?: number | undefined;
}

export function formatSysmlSource(source: string, options: SysMLFormatOptions = {}): string {
  const tabSize = options.tabSize ?? 2;
  const indentStr = options.insertSpaces !== false ? " ".repeat(tabSize) : "\t";
  const lines = source.split(/\r?\n/);
  const formatted: string[] = [];

  let depth = 0;
  let inBlockComment = false;

  const start = options.startLine ?? 0;
  const end = options.endLine !== undefined ? Math.min(options.endLine, lines.length - 1) : lines.length - 1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;

    // Outside formatting range: keep verbatim
    if (i < start || i > end) {
      formatted.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();

    if (!trimmed) {
      formatted.push("");
      continue;
    }

    // Handle multi-line block comments
    if (inBlockComment) {
      formatted.push(indentStr.repeat(depth) + trimmed);
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      formatted.push(indentStr.repeat(depth) + trimmed);
      continue;
    }

    // Strip inline single-line comment for brace analysis
    let codePart = trimmed;
    const commentIdx = codePart.indexOf("//");
    let lineComment = "";
    if (commentIdx !== -1) {
      lineComment = codePart.slice(commentIdx);
      codePart = codePart.slice(0, commentIdx).trim();
    }

    // Dedent leading closing braces
    if (codePart.startsWith("}")) {
      depth = Math.max(0, depth - 1);
    }

    // Normalize spacing around keywords in codePart
    let normalizedCode = codePart;
    if (normalizedCode) {
      // Ensure space before opening brace '{'
      normalizedCode = normalizedCode.replace(/([^\s{])\{/g, "$1 {");
      // Space inside single-line braces: '{ expr }'
      normalizedCode = normalizedCode.replace(/\{([^\s}][^}\n]*?)\}/g, "{ $1 }");
      // Normalize space after single colons for typing (never split '::' namespace operator)
      normalizedCode = normalizedCode.replace(/(?<!:):(?!:)/g, " : ");
      // Normalize space around isolated '=' in bindings (never split '==', '<=', '>=', '!=')
      normalizedCode = normalizedCode.replace(/(?<![<>=!])=(?![=><])/g, " = ");
      // Normalize space before semicolons
      normalizedCode = normalizedCode.replace(/\s*;\s*$/g, ";");
      // Clean up multiple spaces
      normalizedCode = normalizedCode.replace(/\s{2,}/g, " ");
      // Ensure unit brackets have space before them: "24[V]" -> "24 [V]"
      normalizedCode = normalizedCode.replace(/(\d+)\s*\[([a-zA-Z0-9_/]+)\]/g, "$1 [$2]");
    }

    const fullLine = lineComment ? (normalizedCode ? `${normalizedCode} ${lineComment}` : lineComment) : normalizedCode;
    formatted.push(indentStr.repeat(depth) + fullLine);

    // Calculate depth change from braces not in comments
    const openCount = (codePart.match(/{/g) || []).length;
    const closeCount = (codePart.match(/}/g) || []).length;

    // If line started with `}`, we already decremented by 1 before writing
    const netChange = codePart.startsWith("}") ? openCount - (closeCount - 1) : openCount - closeCount;
    depth = Math.max(0, depth + netChange);
  }

  return formatted.join("\n");
}
