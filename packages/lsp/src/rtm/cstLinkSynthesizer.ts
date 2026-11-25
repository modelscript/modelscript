// SPDX-License-Identifier: AGPL-3.0-or-later

import { findCstNodesByType, type CstNodeLike, type CstTreeLike } from "../utils/ast-utils.js";
import { isIdentContCode, isWsCode, readIdentAt, skipWs } from "../utils/lexical-utils.js";

export type CstTreeOrNode = CstTreeLike | CstNodeLike;

function resolveCstRoot(tree: CstTreeOrNode): CstNodeLike {
  return "rootNode" in tree ? tree.rootNode : tree;
}

function cstNodeStart(node: CstNodeLike): number {
  return node.startIndex ?? node.startOffset ?? 0;
}

function cstNodeEnd(node: CstNodeLike): number {
  return node.endIndex ?? node.endOffset ?? 0;
}

export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface WorkspaceTextEdit {
  range: TextRange;
  newText: string;
}

/**
 * Checks whether the character at `targetOffset` is in code (not within line/block comments or strings).
 */
function isOffsetInCode(text: string, targetOffset: number): boolean {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;

  for (let i = 0; i < targetOffset && i < text.length; i++) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1]! : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
  }

  return !inLineComment && !inBlockComment && !inString;
}

const SYSML_DECL_PREFIXES = new Set([
  "part",
  "port",
  "action",
  "verification",
  "hazard",
  "item",
  "requirement",
  "attribute",
  "connection",
  "allocation",
]);

function matchesNameAt(text: string, pos: number, name: string): number {
  if (!text.startsWith(name, pos)) return -1;
  const end = pos + name.length;
  if (end < text.length && isIdentContCode(text.charCodeAt(end))) return -1;
  return end;
}

function findSysmlDeclHeaderInCode(
  text: string,
  sourceName: string,
): { delimIndex: number; delimiter: ";" | "{" } | null {
  let i = 0;
  while (i < text.length) {
    const kw = readIdentAt(text, i);
    if (!kw) {
      i++;
      continue;
    }
    const prevOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
    if (prevOk && SYSML_DECL_PREFIXES.has(kw.token)) {
      let cur = skipWs(text, kw.next);
      if (cur > kw.next) {
        const maybeDef = readIdentAt(text, cur);
        if (maybeDef?.token === "def") {
          const afterDef = skipWs(text, maybeDef.next);
          if (afterDef > maybeDef.next) {
            cur = afterDef;
          }
        }
        const afterName = matchesNameAt(text, cur, sourceName);
        if (afterName !== -1 && isOffsetInCode(text, i)) {
          let delimIdx = afterName;
          while (delimIdx < text.length && text[delimIdx] !== ";" && text[delimIdx] !== "{") {
            delimIdx++;
          }
          if (delimIdx < text.length) {
            return {
              delimIndex: delimIdx,
              delimiter: text[delimIdx] as ";" | "{",
            };
          }
        }
      }
    }
    i = kw.next;
  }
  return null;
}

function splitWsTokens(s: string): string[] {
  const out: string[] = [];
  let i = skipWs(s, 0);
  while (i < s.length) {
    let end = i;
    while (end < s.length && !isWsCode(s.charCodeAt(end))) end++;
    out.push(s.slice(i, end));
    i = skipWs(s, end);
  }
  return out;
}

function findSysmlLinkStmtSpanInCode(
  text: string,
  linkKind: "satisfy" | "verify" | "allocate" | "connect" | "mitigate" | "refine",
  targetName: string,
  sourceName?: string,
): { start: number; end: number } | null {
  const keyword =
    linkKind === "satisfy"
      ? "satisfy"
      : linkKind === "verify"
        ? "verify"
        : linkKind === "mitigate"
          ? "mitigate"
          : linkKind === "refine"
            ? "refine"
            : linkKind === "connect"
              ? "connect"
              : "allocate";

  let lineStart = 0;
  while (lineStart <= text.length) {
    const lf = text.indexOf("\n", lineStart);
    const contentEnd = lf === -1 ? text.length : lf > lineStart && text[lf - 1] === "\r" ? lf - 1 : lf;
    const lineEndWithNl = lf === -1 ? text.length : lf + 1;
    const line = text.slice(lineStart, contentEnd);

    let indentEnd = 0;
    while (indentEnd < line.length && (line[indentEnd] === " " || line[indentEnd] === "\t")) indentEnd++;
    const trimmedRight = line.trimEnd();
    if (trimmedRight.endsWith(";")) {
      const tokens = splitWsTokens(line.slice(indentEnd, trimmedRight.length - 1));
      let matched = false;
      if (linkKind === "connect" && sourceName) {
        matched =
          tokens.length === 4 &&
          tokens[0] === "connect" &&
          tokens[2] === "to" &&
          ((tokens[1] === sourceName && tokens[3] === targetName) ||
            (tokens[1] === targetName && tokens[3] === sourceName));
      } else if (linkKind === "allocate" && sourceName) {
        matched =
          tokens.length === 4 &&
          tokens[0] === "allocate" &&
          tokens[1] === sourceName &&
          tokens[2] === "to" &&
          tokens[3] === targetName;
      } else {
        matched =
          tokens[0] === keyword &&
          ((tokens.length === 2 && tokens[1] === targetName) ||
            (tokens.length === 3 && tokens[1] === "to" && tokens[2] === targetName));
      }
      if (matched && isOffsetInCode(text, lineStart + indentEnd)) {
        return { start: lineStart, end: lineEndWithNl };
      }
    }
    if (lf === -1) break;
    lineStart = lf + 1;
  }
  return null;
}

const MODELICA_TRACE_CLASS_KEYWORDS = new Set([
  "model",
  "block",
  "class",
  "record",
  "package",
  "connector",
  "function",
  "type",
]);

function findModelicaClassStartInCode(text: string, className: string): number {
  let i = 0;
  while (i < text.length) {
    const kw = readIdentAt(text, i);
    if (!kw) {
      i++;
      continue;
    }
    const prevOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
    if (prevOk && MODELICA_TRACE_CLASS_KEYWORDS.has(kw.token)) {
      const ws = skipWs(text, kw.next);
      if (ws > kw.next && matchesNameAt(text, ws, className) !== -1 && isOffsetInCode(text, i)) {
        return i;
      }
    }
    i = kw.next;
  }
  return -1;
}

function findModelicaEndInCode(text: string, className: string, searchStart: number): number {
  let i = searchStart;
  while (i < text.length) {
    const kw = readIdentAt(text, i);
    if (!kw) {
      i++;
      continue;
    }
    const prevOk = i === 0 || !isIdentContCode(text.charCodeAt(i - 1));
    if (prevOk && kw.token === "end") {
      const ws = skipWs(text, kw.next);
      const afterName = ws > kw.next ? matchesNameAt(text, ws, className) : -1;
      if (afterName !== -1) {
        const semiPos = skipWs(text, afterName);
        if (text[semiPos] === ";" && isOffsetInCode(text, i)) {
          return i;
        }
      }
    }
    i = kw.next;
  }
  return -1;
}

/**
 * Finds the matching closing parenthesis `)` for an open parenthesis `(` at `openParenIdx`,
 * skipping comments and strings.
 */
function findMatchingParen(text: string, openParenIdx: number): number {
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;

  for (let i = openParenIdx; i < text.length; i++) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1]! : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Expands a matched span to include leading indentation and trailing newline if it occupies a full line.
 */
function expandLineRange(text: string, start: number, end: number): { start: number; end: number } {
  let lineStart = start;
  while (lineStart > 0 && text[lineStart - 1] !== "\n" && text[lineStart - 1] !== "\r") {
    if (text[lineStart - 1] !== " " && text[lineStart - 1] !== "\t") {
      lineStart = start;
      break;
    }
    lineStart--;
  }

  let lineEnd = end;
  while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") {
    if (text[lineEnd] !== " " && text[lineEnd] !== "\t") {
      return { start: lineStart, end };
    }
    lineEnd++;
  }
  if (lineEnd < text.length && text[lineEnd] === "\r") lineEnd++;
  if (lineEnd < text.length && text[lineEnd] === "\n") lineEnd++;

  return { start: lineStart, end: lineEnd };
}

/**
 * Computes source code text edits to bi-directionally insert or delete
 * traceability links in SysML v2 and Modelica documents.
 */
export class CstLinkSynthesizer {
  /**
   * Helper to convert byte offset to 0-indexed line and character.
   */
  static offsetToPosition(text: string, offset: number): TextPosition {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    let character = 0;
    for (let i = 0; i < clamped; i++) {
      const code = text.charCodeAt(i);
      if (code === 13) {
        if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
          if (i + 1 < clamped) {
            i++;
            line++;
            character = 0;
          }
        } else {
          line++;
          character = 0;
        }
      } else if (code === 10) {
        line++;
        character = 0;
      } else {
        character++;
      }
    }
    return { line, character };
  }

  /**
   * Synthesizes a trace link (satisfy / verify / allocate / connect / mitigate / refine) in a SysML v2 file.
   */
  static synthesizeSysMLTraceLink(
    documentText: string,
    sourceName: string,
    targetName: string,
    linkKind: "satisfy" | "verify" | "allocate" | "connect" | "mitigate" | "refine" = "satisfy",
    tree?: CstTreeOrNode,
  ): WorkspaceTextEdit[] | null {
    if (linkKind === "connect") {
      let lastBraceIndex = -1;
      for (let i = documentText.length - 1; i >= 0; i--) {
        if (documentText[i] === "}" && isOffsetInCode(documentText, i)) {
          lastBraceIndex = i;
          break;
        }
      }

      if (lastBraceIndex !== -1) {
        const pos = this.offsetToPosition(documentText, lastBraceIndex);
        return [
          {
            range: { start: pos, end: pos },
            newText: `  connect ${sourceName} to ${targetName};\n`,
          },
        ];
      } else {
        const endPos = this.offsetToPosition(documentText, documentText.length);
        return [
          {
            range: { start: endPos, end: endPos },
            newText: `\nconnect ${sourceName} to ${targetName};\n`,
          },
        ];
      }
    }

    if (tree) {
      const root = resolveCstRoot(tree);
      const declNodes = findCstNodesByType(root, "definition_element")
        .concat(findCstNodesByType(root, "usage_element"))
        .concat(findCstNodesByType(root, "part_def"))
        .concat(findCstNodesByType(root, "part_usage"))
        .concat(findCstNodesByType(root, "item_def"))
        .concat(findCstNodesByType(root, "item_usage"));
      for (const node of declNodes) {
        const idNode = node.children?.find(
          (c: CstNodeLike) => c.type === "IDENT" || c.type === "identifier" || c.type === "name",
        );
        const name = idNode ? (idNode.text ?? documentText.slice(cstNodeStart(idNode), cstNodeEnd(idNode))) : "";
        if (name === sourceName) {
          const bodyNode = node.children?.find((c: CstNodeLike) => c.type === "body" || (c.text ?? "").startsWith("{"));
          const keyword =
            linkKind === "satisfy"
              ? "satisfy"
              : linkKind === "verify"
                ? "verify"
                : linkKind === "mitigate"
                  ? "mitigate"
                  : linkKind === "refine"
                    ? "refine"
                    : "allocate";
          if (bodyNode) {
            const pos = this.offsetToPosition(documentText, cstNodeStart(bodyNode) + 1);
            return [
              {
                range: { start: pos, end: pos },
                newText: `\n  ${keyword} ${targetName};`,
              },
            ];
          }
        }
      }
    }

    // 1. Locate the source element declaration in documentText outside comments and strings
    const declMatch = findSysmlDeclHeaderInCode(documentText, sourceName);
    if (!declMatch) {
      if (linkKind === "allocate") {
        let lastBraceIndex = -1;
        for (let i = documentText.length - 1; i >= 0; i--) {
          if (documentText[i] === "}" && isOffsetInCode(documentText, i)) {
            lastBraceIndex = i;
            break;
          }
        }
        if (lastBraceIndex !== -1) {
          const pos = this.offsetToPosition(documentText, lastBraceIndex);
          return [
            {
              range: { start: pos, end: pos },
              newText: `  allocate ${sourceName} to ${targetName};\n`,
            },
          ];
        }
      }
      return null;
    }

    const keyword =
      linkKind === "satisfy"
        ? "satisfy"
        : linkKind === "verify"
          ? "verify"
          : linkKind === "mitigate"
            ? "mitigate"
            : linkKind === "refine"
              ? "refine"
              : "allocate";
    const statement = linkKind === "allocate" ? `allocate to ${targetName};` : `${keyword} ${targetName};`;

    if (declMatch.delimiter === "{") {
      const pos = this.offsetToPosition(documentText, declMatch.delimIndex + 1);
      return [
        {
          range: { start: pos, end: pos },
          newText: `\n  ${statement}`,
        },
      ];
    } else {
      const startPos = this.offsetToPosition(documentText, declMatch.delimIndex);
      const endPos = this.offsetToPosition(documentText, declMatch.delimIndex + 1);
      return [
        {
          range: { start: startPos, end: endPos },
          newText: ` {\n  ${statement}\n}`,
        },
      ];
    }
  }

  /**
   * Deletes an existing trace link statement from a SysML v2 document.
   */
  static removeSysMLTraceLink(
    documentText: string,
    targetName: string,
    linkKind: "satisfy" | "verify" | "allocate" | "connect" | "mitigate" | "refine" = "satisfy",
    declarationRange?: [number, number],
    sourceName?: string,
    tree?: CstTreeOrNode,
  ): WorkspaceTextEdit[] | null {
    if (declarationRange && declarationRange[1] > declarationRange[0]) {
      const startPos = this.offsetToPosition(documentText, declarationRange[0]);
      const endPos = this.offsetToPosition(documentText, declarationRange[1]);
      return [
        {
          range: { start: startPos, end: endPos },
          newText: "",
        },
      ];
    }

    if (tree) {
      const root = resolveCstRoot(tree);
      const stmtNodes = findCstNodesByType(root, "satisfy_statement")
        .concat(findCstNodesByType(root, "verify_statement"))
        .concat(findCstNodesByType(root, "allocate_statement"))
        .concat(findCstNodesByType(root, "connection_statement"));
      for (const node of stmtNodes) {
        const nodeStart = cstNodeStart(node);
        const nodeEnd = cstNodeEnd(node);
        const text = node.text ?? documentText.slice(nodeStart, nodeEnd);
        if (text.includes(targetName) && (!sourceName || text.includes(sourceName))) {
          let endIdx = nodeEnd;
          while (endIdx < documentText.length && (documentText[endIdx] === " " || documentText[endIdx] === "\t")) {
            endIdx++;
          }
          if (endIdx < documentText.length && documentText[endIdx] === ";") {
            endIdx++;
          }
          const fullRange = expandLineRange(documentText, nodeStart, endIdx);
          const startPos = this.offsetToPosition(documentText, fullRange.start);
          const endPos = this.offsetToPosition(documentText, fullRange.end);
          return [
            {
              range: { start: startPos, end: endPos },
              newText: "",
            },
          ];
        }
      }
    }

    const span = findSysmlLinkStmtSpanInCode(documentText, linkKind, targetName, sourceName);
    if (!span) return null;

    const startPos = this.offsetToPosition(documentText, span.start);
    const endPos = this.offsetToPosition(documentText, span.end);

    return [
      {
        range: { start: startPos, end: endPos },
        newText: "",
      },
    ];
  }

  /**
   * Synthesizes a traceability annotation into a Modelica model.
   */
  static synthesizeModelicaTraceLink(
    documentText: string,
    sourceClassName: string,
    targetReqName: string,
    linkKind: "satisfy" | "verify" | "allocate" = "satisfy",
    tree?: CstTreeOrNode,
  ): WorkspaceTextEdit[] | null {
    if (tree) {
      const root = resolveCstRoot(tree);
      const classDefs = findCstNodesByType(root, "class_definition").concat(
        findCstNodesByType(root, "stored_definition"),
      );
      for (const node of classDefs) {
        const idNode = node.children?.find((c: CstNodeLike) => c.type === "IDENT" || c.type === "identifier");
        const name = idNode ? (idNode.text ?? documentText.slice(cstNodeStart(idNode), cstNodeEnd(idNode))) : "";
        if (name === sourceClassName) {
          const endNode = node.children?.find(
            (c: CstNodeLike) => (c.text ?? documentText.slice(cstNodeStart(c), cstNodeEnd(c))) === "end",
          );
          const insertOffset = endNode ? cstNodeStart(endNode) : cstNodeEnd(node);
          const attrName = linkKind === "satisfy" ? "satisfies" : linkKind === "verify" ? "verifies" : "allocates";
          const annotationSnippet = `  annotation(__modelscript(${attrName}="${targetReqName}"));\n`;
          const pos = this.offsetToPosition(documentText, insertOffset);
          return [
            {
              range: { start: pos, end: pos },
              newText: annotationSnippet,
            },
          ];
        }
      }
    }

    // 1. Locate the class/model definition in code
    const defOffset = findModelicaClassStartInCode(documentText, sourceClassName);
    const searchStart = defOffset >= 0 ? defOffset : 0;

    // 2. Find the matching `end <sourceClassName>;` of the model outside comments/strings
    const endOffset = findModelicaEndInCode(documentText, sourceClassName, searchStart);
    if (endOffset < 0) return null;

    const attrName = linkKind === "satisfy" ? "satisfies" : linkKind === "verify" ? "verifies" : "allocates";
    const annotationSnippet = `  annotation(__modelscript(${attrName}="${targetReqName}"));\n`;

    const pos = this.offsetToPosition(documentText, endOffset);
    return [
      {
        range: { start: pos, end: pos },
        newText: annotationSnippet,
      },
    ];
  }

  /**
   * Removes a traceability annotation from a Modelica model.
   */
  static removeModelicaTraceLink(
    documentText: string,
    targetReqName: string,
    tree?: CstTreeOrNode,
  ): WorkspaceTextEdit[] | null {
    if (tree) {
      const root = resolveCstRoot(tree);
      const annotNodes = findCstNodesByType(root, "annotation_clause").concat(findCstNodesByType(root, "annotation"));
      for (const node of annotNodes) {
        const nodeStart = cstNodeStart(node);
        const nodeEnd = cstNodeEnd(node);
        const text = node.text ?? documentText.slice(nodeStart, nodeEnd);
        if (text.includes("__modelscript") && text.includes(`"${targetReqName}"`)) {
          let endIdx = nodeEnd;
          while (endIdx < documentText.length && (documentText[endIdx] === " " || documentText[endIdx] === "\t")) {
            endIdx++;
          }
          if (endIdx < documentText.length && documentText[endIdx] === ";") {
            endIdx++;
          }
          const fullRange = expandLineRange(documentText, nodeStart, endIdx);
          const startPos = this.offsetToPosition(documentText, fullRange.start);
          const endPos = this.offsetToPosition(documentText, fullRange.end);
          return [
            {
              range: { start: startPos, end: endPos },
              newText: "",
            },
          ];
        }
      }
    }

    // Scan for `annotation(` outside comments and strings
    let scanPos = 0;
    while (scanPos < documentText.length) {
      const idx = documentText.indexOf("annotation", scanPos);
      if (idx === -1) break;
      const prevOk = idx === 0 || !isIdentContCode(documentText.charCodeAt(idx - 1));
      const nextPos = idx + 10;
      const openParenIdx = skipWs(documentText, nextPos);
      if (
        prevOk &&
        !isIdentContCode(documentText.charCodeAt(nextPos)) &&
        documentText[openParenIdx] === "(" &&
        isOffsetInCode(documentText, idx)
      ) {
        const closeParenIdx = findMatchingParen(documentText, openParenIdx);
        if (closeParenIdx !== -1) {
          const semiIdx = skipWs(documentText, closeParenIdx + 1);
          if (semiIdx < documentText.length && documentText[semiIdx] === ";") {
            const annotBody = documentText.slice(openParenIdx, closeParenIdx + 1);
            if (annotBody.includes("__modelscript") && annotBody.includes(`"${targetReqName}"`)) {
              const fullRange = expandLineRange(documentText, idx, semiIdx + 1);
              const startPos = this.offsetToPosition(documentText, fullRange.start);
              const endPos = this.offsetToPosition(documentText, fullRange.end);
              return [
                {
                  range: { start: startPos, end: endPos },
                  newText: "",
                },
              ];
            }
          }
        }
      }
      scanPos = nextPos;
    }

    return null;
  }
}
