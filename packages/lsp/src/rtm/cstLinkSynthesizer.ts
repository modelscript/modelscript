// SPDX-License-Identifier: AGPL-3.0-or-later

import { findCstNodesByType } from "../utils/ast-utils.js";

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

/**
 * Finds the first regex match that starts at a valid code offset (not inside comments/strings).
 */
function findRegexInCode(text: string, regex: RegExp, startIndex = 0): RegExpExecArray | null {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  const r = new RegExp(regex.source, flags);
  r.lastIndex = startIndex;
  let match: RegExpExecArray | null;
  while ((match = r.exec(text)) !== null) {
    if (isOffsetInCode(text, match.index)) {
      return match;
    }
    if (match.index === r.lastIndex) r.lastIndex++;
  }
  return null;
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
    tree?: any,
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
      const root = tree.rootNode ?? tree;
      const declNodes = findCstNodesByType(root, "definition_element")
        .concat(findCstNodesByType(root, "usage_element"))
        .concat(findCstNodesByType(root, "part_def"))
        .concat(findCstNodesByType(root, "part_usage"))
        .concat(findCstNodesByType(root, "item_def"))
        .concat(findCstNodesByType(root, "item_usage"));
      for (const node of declNodes) {
        const idNode = node.children?.find(
          (c: any) => c.type === "IDENT" || c.type === "identifier" || c.type === "name",
        );
        const name = idNode ? (idNode.text ?? documentText.slice(idNode.startIndex, idNode.endIndex)) : "";
        if (name === sourceName) {
          const bodyNode = node.children?.find((c: any) => c.type === "body" || (c.text ?? "").startsWith("{"));
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
            const pos = this.offsetToPosition(documentText, bodyNode.startIndex + 1);
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
    const escapedSource = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const elemRegex = new RegExp(
      `\\b(part\\s+def|part|port\\s+def|port|action\\s+def|action|verification\\s+def|verification|hazard\\s+def|hazard|item\\s+def|item|requirement\\s+def|requirement|attribute\\s+def|attribute|connection\\s+def|connection|allocation\\s+def|allocation)\\s+${escapedSource}\\b([^;{]*)(;|\\{)`,
      "m",
    );

    const match = findRegexInCode(documentText, elemRegex);
    if (!match) {
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

    const fullMatchIndex = match.index;
    const delimiter = match[3];

    if (delimiter === "{") {
      const openBraceIndex = fullMatchIndex + match[0].length - 1;
      const pos = this.offsetToPosition(documentText, openBraceIndex + 1);
      return [
        {
          range: { start: pos, end: pos },
          newText: `\n  ${statement}`,
        },
      ];
    } else if (delimiter === ";") {
      const semicolonIndex = fullMatchIndex + match[0].length - 1;
      const startPos = this.offsetToPosition(documentText, semicolonIndex);
      const endPos = this.offsetToPosition(documentText, semicolonIndex + 1);
      return [
        {
          range: { start: startPos, end: endPos },
          newText: ` {\n  ${statement}\n}`,
        },
      ];
    }

    return null;
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
    tree?: any,
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
      const root = tree.rootNode ?? tree;
      const stmtNodes = findCstNodesByType(root, "satisfy_statement")
        .concat(findCstNodesByType(root, "verify_statement"))
        .concat(findCstNodesByType(root, "allocate_statement"))
        .concat(findCstNodesByType(root, "connection_statement"));
      for (const node of stmtNodes) {
        const text = node.text ?? documentText.slice(node.startIndex, node.endIndex);
        if (text.includes(targetName) && (!sourceName || text.includes(sourceName))) {
          let endIdx = node.endIndex;
          while (endIdx < documentText.length && (documentText[endIdx] === " " || documentText[endIdx] === "\t")) {
            endIdx++;
          }
          if (endIdx < documentText.length && documentText[endIdx] === ";") {
            endIdx++;
          }
          const fullRange = expandLineRange(documentText, node.startIndex, endIdx);
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

    const escapedTarget = targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (linkKind === "connect" && sourceName) {
      const escapedSource = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const connectRegex = new RegExp(
        `^[ \\t]*connect\\s+(${escapedSource}\\s+to\\s+${escapedTarget}|${escapedTarget}\\s+to\\s+${escapedSource})\\s*;[ \\t]*\\r?\\n?`,
        "m",
      );
      const match = findRegexInCode(documentText, connectRegex);
      if (match) {
        const startPos = this.offsetToPosition(documentText, match.index);
        const endPos = this.offsetToPosition(documentText, match.index + match[0].length);
        return [{ range: { start: startPos, end: endPos }, newText: "" }];
      }
    }

    if (linkKind === "allocate" && sourceName) {
      const escapedSource = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const allocRegex = new RegExp(
        `^[ \\t]*allocate\\s+${escapedSource}\\s+to\\s+${escapedTarget}\\s*;[ \\t]*\\r?\\n?`,
        "m",
      );
      const match = findRegexInCode(documentText, allocRegex);
      if (match) {
        const startPos = this.offsetToPosition(documentText, match.index);
        const endPos = this.offsetToPosition(documentText, match.index + match[0].length);
        return [{ range: { start: startPos, end: endPos }, newText: "" }];
      }
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
    const lineRegex = new RegExp(`^[ \\t]*${keyword}\\s+(to\\s+)?${escapedTarget}\\s*;[ \\t]*\\r?\\n?`, "m");
    const match = findRegexInCode(documentText, lineRegex);
    if (!match) return null;

    const startPos = this.offsetToPosition(documentText, match.index);
    const endPos = this.offsetToPosition(documentText, match.index + match[0].length);

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
    tree?: any,
  ): WorkspaceTextEdit[] | null {
    if (tree) {
      const root = tree.rootNode ?? tree;
      const classDefs = findCstNodesByType(root, "class_definition").concat(
        findCstNodesByType(root, "stored_definition"),
      );
      for (const node of classDefs) {
        const idNode = node.children?.find((c: any) => c.type === "IDENT" || c.type === "identifier");
        const name = idNode ? (idNode.text ?? documentText.slice(idNode.startIndex, idNode.endIndex)) : "";
        if (name === sourceClassName) {
          const endNode = node.children?.find(
            (c: any) => (c.text ?? documentText.slice(c.startIndex, c.endIndex)) === "end",
          );
          const insertOffset = endNode ? endNode.startIndex : node.endIndex;
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

    const escapedClass = sourceClassName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 1. Locate the class/model definition in code
    const classDefRegex = new RegExp(
      `\\b(model|block|class|record|package|connector|function|type)\\s+${escapedClass}\\b`,
      "m",
    );
    const defMatch = findRegexInCode(documentText, classDefRegex);
    const searchStart = defMatch ? defMatch.index : 0;

    // 2. Find the matching `end <sourceClassName>;` of the model outside comments/strings
    const endRegex = new RegExp(`\\bend\\s+${escapedClass}\\s*;`, "m");
    const match = findRegexInCode(documentText, endRegex, searchStart);
    if (!match) return null;

    const attrName = linkKind === "satisfy" ? "satisfies" : linkKind === "verify" ? "verifies" : "allocates";
    const annotationSnippet = `  annotation(__modelscript(${attrName}="${targetReqName}"));\n`;

    const pos = this.offsetToPosition(documentText, match.index);
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
  static removeModelicaTraceLink(documentText: string, targetReqName: string, tree?: any): WorkspaceTextEdit[] | null {
    if (tree) {
      const root = tree.rootNode ?? tree;
      const annotNodes = findCstNodesByType(root, "annotation");
      for (const node of annotNodes) {
        const text = node.text ?? documentText.slice(node.startIndex, node.endIndex);
        if (text.includes("__modelscript") && text.includes(`"${targetReqName}"`)) {
          let endIdx = node.endIndex;
          while (endIdx < documentText.length && (documentText[endIdx] === " " || documentText[endIdx] === "\t")) {
            endIdx++;
          }
          if (endIdx < documentText.length && documentText[endIdx] === ";") {
            endIdx++;
          }
          const fullRange = expandLineRange(documentText, node.startIndex, endIdx);
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

    // Scan for `annotation` outside comments and strings
    const annotKeywordRegex = /\bannotation\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = annotKeywordRegex.exec(documentText)) !== null) {
      if (!isOffsetInCode(documentText, match.index)) continue;

      const openParenIdx = documentText.indexOf("(", match.index);
      if (openParenIdx === -1) continue;

      const closeParenIdx = findMatchingParen(documentText, openParenIdx);
      if (closeParenIdx === -1) continue;

      let semiIdx = closeParenIdx + 1;
      while (semiIdx < documentText.length && /\s/.test(documentText[semiIdx]!)) {
        semiIdx++;
      }
      if (semiIdx >= documentText.length || documentText[semiIdx] !== ";") continue;

      const annotBody = documentText.slice(openParenIdx, closeParenIdx + 1);
      if (annotBody.includes("__modelscript") && annotBody.includes(`"${targetReqName}"`)) {
        const fullRange = expandLineRange(documentText, match.index, semiIdx + 1);
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

    return null;
  }
}
