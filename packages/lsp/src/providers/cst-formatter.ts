// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode, Tree } from "../utils/cst-facade.js";

export interface WasmCstFormatOptions {
  tabSize?: number;
  insertSpaces?: boolean;
  languageId?: string;
  uri?: string;
}

const FIXED_COLUMN_LANGUAGES = new Set(["fortran", "f77", "fixed-fortran", "psse", "nastran", "bdf", "las"]);

const FIXED_COLUMN_EXT_RE = /\.(?:f|for|f77|ftn|raw|dyr|bdf|nas|las)$/i;

const BLOCK_NODE_INCLUDE_RE =
  /(?:def|definition|decl|declaration|module|package|function|subckt|block|class|model|record|struct|interface|component|section|if|for|while|switch|case|loop|try|catch|with|usage|architecture|entity|process|procedure|subroutine|task|macro|equation|algorithm)/i;

const BLOCK_NODE_EXCLUDE_RE =
  /(?:file|program|root|document|unit|compilation|translation|list|items|body|statements|source|comment|string|literal|ident|name|ref|expr|call)/i;

const EXPLICIT_CLOSER_RE = /^(?:end\b|end_|end[a-z]+$|\.ends\b|\}|\]|\)|<\/)/i;

const MAX_CST_WALK_NODES = 100_000;

function isCommentNodeType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("comment") || t === "documentation" || t === "doc_comment";
}

function isStringNodeType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("string") || t.includes("heredoc") || t.includes("verbatim");
}

function isFixedColumnContext(root: SyntaxNode, options?: WasmCstFormatOptions): boolean {
  const langId = options?.languageId?.toLowerCase().trim();
  if (langId && FIXED_COLUMN_LANGUAGES.has(langId)) return true;

  if (options?.uri) {
    const cleanPath = options.uri.split(/[?#]/, 1)[0] ?? options.uri;
    if (FIXED_COLUMN_EXT_RE.test(cleanPath)) return true;
  }

  const rootType = (root.type ?? "").toLowerCase();
  for (const fc of FIXED_COLUMN_LANGUAGES) {
    if (rootType.includes(fc)) return true;
  }
  return false;
}

function hasRootErrorNode(root: SyntaxNode): boolean {
  if (root.isError || root.type === "ERROR") return true;
  const count = typeof root.childCount === "number" ? root.childCount : (root.children?.length ?? 0);
  for (let i = 0; i < count; i++) {
    const child = typeof root.child === "function" ? root.child(i) : root.children?.[i];
    if (child && (child.isError || child.type === "ERROR")) {
      return true;
    }
  }
  return false;
}

function getChildren(node: SyntaxNode): SyntaxNode[] {
  if (Array.isArray(node.children)) return node.children;
  const out: SyntaxNode[] = [];
  const count = typeof node.childCount === "number" ? node.childCount : 0;
  for (let i = 0; i < count; i++) {
    const ch = node.child?.(i);
    if (ch) out.push(ch);
  }
  return out;
}

interface BlockSpan {
  startRow: number;
  endRow: number;
  hasExplicitCloser: boolean;
}

/**
 * Formats any WASM CST-backed document using purely CST-driven block and token structure.
 *
 * - Skips formatting if the language is fixed-column (Fortran, PSS/E, Nastran/BDF, LAS)
 *   or if the CST has ERROR nodes at the root.
 * - Never modifies interior lines of multiline string literals or breaks multiline comments.
 * - Normalizes indentation from CST brace/block depth, trims trailing whitespace,
 *   collapses 3+ consecutive blank lines to 1 blank line, and ensures a single trailing newline.
 */
export function formatWasmCstDocument(tree: Tree, text: string, options?: WasmCstFormatOptions): string {
  if (!text || !tree?.rootNode) return text;

  const root = tree.rootNode;
  if (isFixedColumnContext(root, options)) return text;
  if (hasRootErrorNode(root)) return text;

  const tabSize = Math.max(1, options?.tabSize ?? 2);
  const insertSpaces = options?.insertSpaces ?? true;
  const indentUnit = insertSpaces ? " ".repeat(tabSize) : "\t";

  const protectedStringLines = new Set<number>();
  const blockCommentInteriorLines = new Set<number>();
  const lineTokens = new Map<number, string[]>();
  const blockSpansByStartRow = new Map<number, BlockSpan>();
  let hasBraceBlocks = false;
  let visited = 0;

  const walk = (node: SyntaxNode, isRoot: boolean) => {
    if (++visited > MAX_CST_WALK_NODES) return;

    const nodeType = node.type ?? "";
    const startRow = node.startPosition?.row ?? 0;
    const endRow = node.endPosition?.row ?? startRow;

    if (isStringNodeType(nodeType)) {
      if (endRow > startRow) {
        for (let r = startRow + 1; r <= endRow; r++) {
          protectedStringLines.add(r);
        }
      }
      return;
    }

    if (isCommentNodeType(nodeType)) {
      if (endRow > startRow) {
        for (let r = startRow + 1; r <= endRow; r++) {
          blockCommentInteriorLines.add(r);
        }
      }
      return;
    }

    const children = getChildren(node);

    if (children.length === 0) {
      const tok = (node.text ?? "").trim();
      if (tok.length > 0) {
        let arr = lineTokens.get(startRow);
        if (!arr) {
          arr = [];
          lineTokens.set(startRow, arr);
        }
        arr.push(tok);
        if (tok === "{" || tok === "}") {
          hasBraceBlocks = true;
        }
      }
      return;
    }

    if (
      !isRoot &&
      node.isNamed !== false &&
      endRow > startRow &&
      BLOCK_NODE_INCLUDE_RE.test(nodeType) &&
      !BLOCK_NODE_EXCLUDE_RE.test(nodeType)
    ) {
      const existing = blockSpansByStartRow.get(startRow);
      if (!existing || endRow > existing.endRow) {
        blockSpansByStartRow.set(startRow, {
          startRow,
          endRow,
          hasExplicitCloser: false,
        });
      }
    }

    for (const child of children) {
      walk(child, false);
    }
  };

  walk(root, true);

  // Determine whether each non-brace block span ends on an explicit closing keyword/delimiter line
  const blockSpans: BlockSpan[] = [];
  if (!hasBraceBlocks) {
    for (const span of blockSpansByStartRow.values()) {
      const endTokens = lineTokens.get(span.endRow) ?? [];
      const firstEndTok = endTokens[0] ?? "";
      span.hasExplicitCloser = EXPLICIT_CLOSER_RE.test(firstEndTok);
      blockSpans.push(span);
    }
  }

  const rawLines = text.split(/\r?\n/);
  const formattedLines: string[] = [];
  let braceDepth = 0;

  for (let row = 0; row < rawLines.length; row++) {
    const rawLine = rawLines[row] ?? "";

    if (protectedStringLines.has(row)) {
      formattedLines.push(rawLine);
      continue;
    }

    if (blockCommentInteriorLines.has(row)) {
      formattedLines.push(rawLine.trimEnd());
      continue;
    }

    const trimmed = rawLine.trim();
    const tokens = lineTokens.get(row) ?? [];

    let depth = 0;
    if (hasBraceBlocks) {
      let leadingClosers = 0;
      for (const tok of tokens) {
        if (tok === "}") {
          leadingClosers++;
        } else {
          break;
        }
      }
      depth = Math.max(0, braceDepth - leadingClosers);

      let delta = 0;
      for (const tok of tokens) {
        if (tok === "{") delta++;
        else if (tok === "}") delta--;
      }
      braceDepth = Math.max(0, braceDepth + delta);
    } else {
      for (const span of blockSpans) {
        if (span.startRow < row && (span.hasExplicitCloser ? row < span.endRow : row <= span.endRow)) {
          depth++;
        }
      }
    }

    if (trimmed.length === 0) {
      formattedLines.push("");
    } else {
      formattedLines.push(`${indentUnit.repeat(depth)}${trimmed}`);
    }
  }

  // Collapse 3+ consecutive blank lines to 1 blank line (outside protected multiline strings)
  const collapsed: string[] = [];
  let blankRun = 0;
  for (let i = 0; i < formattedLines.length; i++) {
    const line = formattedLines[i]!;
    if (!protectedStringLines.has(i) && line === "") {
      blankRun++;
    } else {
      if (blankRun >= 3) {
        collapsed.push("");
      } else {
        for (let b = 0; b < blankRun; b++) collapsed.push("");
      }
      blankRun = 0;
      collapsed.push(line);
    }
  }

  // Strip leading blank lines? Preserve at most 0 trailing blank lines and ensure single trailing newline
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") {
    collapsed.pop();
  }

  if (collapsed.length === 0) {
    return "\n";
  }

  return `${collapsed.join("\n")}\n`;
}
