// SPDX-License-Identifier: AGPL-3.0-or-later

import { BasicBlock, CFGEdgeKind, GenericCFG, UnifiedWorkspace } from "@modelscript/runtime";
import {
  isAsciiIdentContinue,
  isAsciiIdentStart,
  isAsciiIdentifier,
  isAsciiWhitespaceCode,
  parseNamedCallArgsFromText,
} from "../flattener/expressions/cst-utils.js";

export interface ModelicaStatement {
  kind: "assignment" | "if" | "for" | "while" | "when" | "return" | "break" | "call";
  targetVar?: string | undefined;
  valExpr?: string | undefined;
  condExpr?: string | undefined;
  loopVar?: string | undefined;
  rangeExpr?: string | undefined;
  rangeStart?: string | undefined;
  rangeEnd?: string | undefined;
  rangeStep?: string | undefined;
  thenStmts?: ModelicaStatement[] | undefined;
  elseStmts?: ModelicaStatement[] | undefined;
  elseIfs?: { condExpr: string; stmts: ModelicaStatement[] }[] | undefined;
  loopBody?: ModelicaStatement[] | undefined;
  whileBody?: ModelicaStatement[] | undefined;
  whenBody?: ModelicaStatement[] | undefined;
  callFn?: string | undefined;
  callArgs?: string[] | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  rawText?: string | undefined;
}

function trimSemicolons(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === ";") start++;
  while (end > start && s[end - 1] === ";") end--;
  return s.slice(start, end);
}

function readIdentLength(s: string, pos: number): number {
  if (pos >= s.length || !isAsciiIdentStart(s.charCodeAt(pos))) return 0;
  let j = pos + 1;
  while (j < s.length && isAsciiIdentContinue(s.charCodeAt(j))) j++;
  return j - pos;
}

function hasWordAt(s: string, pos: number, word: string): boolean {
  if (!s.startsWith(word, pos)) return false;
  if (pos > 0 && isAsciiIdentContinue(s.charCodeAt(pos - 1))) return false;
  const end = pos + word.length;
  if (end < s.length && isAsciiIdentContinue(s.charCodeAt(end))) return false;
  return true;
}

function skipStringOrComment(s: string, i: number): number {
  const ch = s[i];
  if (ch === '"' || ch === "'") {
    const q = ch;
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === "\\" && j + 1 < s.length) {
        j += 2;
        continue;
      }
      if (s[j] === q) return j + 1;
      j++;
    }
    return s.length;
  }
  if (ch === "/" && s[i + 1] === "/") {
    let j = i + 2;
    while (j < s.length && s[j] !== "\n") j++;
    return j;
  }
  if (ch === "/" && s[i + 1] === "*") {
    const closeIdx = s.indexOf("*/", i + 2);
    return closeIdx >= 0 ? closeIdx + 2 : s.length;
  }
  return -1;
}

function skipAlgorithmSectionPrefix(algText: string): number {
  let i = 0;
  while (i < algText.length && isAsciiWhitespaceCode(algText.charCodeAt(i))) i++;
  if (hasWordAt(algText, i, "initial")) {
    let j = i + 7;
    while (j < algText.length && isAsciiWhitespaceCode(algText.charCodeAt(j))) j++;
    if (hasWordAt(algText, j, "algorithm")) return j + 9;
  }
  if (hasWordAt(algText, i, "algorithm")) return i + 9;
  return 0;
}

function hasCstSyntaxError(node: any): boolean {
  if (!node) return false;
  if (node.isError || node.type === "ERROR") return true;
  if (Array.isArray(node.children)) {
    for (const ch of node.children) {
      if (hasCstSyntaxError(ch)) return true;
    }
  }
  return false;
}

function shiftStatementOffsets(stmt: ModelicaStatement, delta: number, minOffset: number): ModelicaStatement {
  const clamp = (v: number | undefined): number | undefined =>
    v !== undefined ? Math.max(minOffset, v + delta) : undefined;
  return {
    ...stmt,
    startOffset: clamp(stmt.startOffset),
    endOffset: clamp(stmt.endOffset),
    thenStmts: stmt.thenStmts?.map((s) => shiftStatementOffsets(s, delta, minOffset)),
    elseStmts: stmt.elseStmts?.map((s) => shiftStatementOffsets(s, delta, minOffset)),
    elseIfs: stmt.elseIfs?.map((ei) => ({
      condExpr: ei.condExpr,
      stmts: ei.stmts.map((s) => shiftStatementOffsets(s, delta, minOffset)),
    })),
    loopBody: stmt.loopBody?.map((s) => shiftStatementOffsets(s, delta, minOffset)),
    whileBody: stmt.whileBody?.map((s) => shiftStatementOffsets(s, delta, minOffset)),
    whenBody: stmt.whenBody?.map((s) => shiftStatementOffsets(s, delta, minOffset)),
  };
}

function matchEndKwAt(s: string, pos: number, kw: string): number {
  if (!hasWordAt(s, pos, "end")) return -1;
  let j = pos + 3;
  if (j >= s.length || !isAsciiWhitespaceCode(s.charCodeAt(j))) return -1;
  while (j < s.length && isAsciiWhitespaceCode(s.charCodeAt(j))) j++;
  if (!hasWordAt(s, j, kw)) return -1;
  return j + kw.length;
}

function findBlockEndPos(body: string, start: number, kw: string): number {
  let depth = 1;
  let j = start + kw.length;
  while (j < body.length && depth > 0) {
    const skipped = skipStringOrComment(body, j);
    if (skipped >= 0) {
      j = skipped;
      continue;
    }
    const endPos = matchEndKwAt(body, j, kw);
    if (endPos >= 0) {
      depth--;
      j = endPos;
      if (depth === 0) {
        while (j < body.length && (body[j] === ";" || isAsciiWhitespaceCode(body.charCodeAt(j)))) {
          if (body[j] === ";") {
            j++;
            break;
          }
          j++;
        }
        return j;
      }
      continue;
    }
    if (hasWordAt(body, j, kw)) {
      depth++;
      j += kw.length;
      continue;
    }
    j++;
  }
  return j;
}

function findWordOutsideQuotes(s: string, start: number, word: string, respectBlocks = false): number {
  let parenDepth = 0;
  let blockDepth = 0;
  let i = start;
  while (i < s.length) {
    const skipped = skipStringOrComment(s, i);
    if (skipped >= 0) {
      i = skipped;
      continue;
    }
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (parenDepth > 0) parenDepth--;
      i++;
      continue;
    }
    if (respectBlocks && parenDepth === 0) {
      let matchedEndBlock = false;
      for (const bkw of ["if", "for", "while", "when"]) {
        const endPos = matchEndKwAt(s, i, bkw);
        if (endPos >= 0) {
          if (blockDepth > 0) blockDepth--;
          i = endPos;
          matchedEndBlock = true;
          break;
        }
      }
      if (matchedEndBlock) continue;
      if (blockDepth === 0 && hasWordAt(s, i, word)) return i;
      if (hasWordAt(s, i, "if") || hasWordAt(s, i, "for") || hasWordAt(s, i, "while") || hasWordAt(s, i, "when")) {
        blockDepth++;
        i += hasWordAt(s, i, "if") ? 2 : hasWordAt(s, i, "for") ? 3 : hasWordAt(s, i, "when") ? 4 : 5;
        continue;
      }
    } else if (parenDepth === 0 && blockDepth === 0 && hasWordAt(s, i, word)) {
      return i;
    }
    i++;
  }
  return -1;
}

function stripTrailingEndKw(s: string, kw: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    const endPos = matchEndKwAt(s, i, kw);
    if (endPos >= 0) {
      return s.slice(0, i);
    }
  }
  return s;
}

function splitHeaderAndBody(
  blockText: string,
  openKw: string,
  midKw: string,
  endKw: string,
): { header: string; body: string } | null {
  if (!hasWordAt(blockText, 0, openKw)) return null;
  const midIdx = findWordOutsideQuotes(blockText, openKw.length, midKw, true);
  if (midIdx < 0) return null;
  const header = blockText.slice(openKw.length, midIdx);
  const body = stripTrailingEndKw(blockText.slice(midIdx + midKw.length), endKw);
  return { header, body };
}

function splitIfBranchesDeterministic(
  ifText: string,
): { cond: string; thenBody: string; elseIfs: { cond: string; body: string }[]; elseBody?: string } | null {
  if (!hasWordAt(ifText, 0, "if")) return null;
  const firstThen = findWordOutsideQuotes(ifText, 2, "then", true);
  if (firstThen < 0) return null;
  const cond = ifText.slice(2, firstThen).trim();
  const afterThen = stripTrailingEndKw(ifText.slice(firstThen + 4), "if");

  const splitMarkers: { pos: number; kind: "elseif" | "else" }[] = [];
  let scanPos = 0;
  while (scanPos < afterThen.length) {
    const nextElseIf = findWordOutsideQuotes(afterThen, scanPos, "elseif", true);
    const nextElse = findWordOutsideQuotes(afterThen, scanPos, "else", true);
    if (nextElseIf < 0 && nextElse < 0) break;
    if (nextElseIf >= 0 && (nextElse < 0 || nextElseIf < nextElse)) {
      splitMarkers.push({ pos: nextElseIf, kind: "elseif" });
      scanPos = nextElseIf + 6;
    } else {
      splitMarkers.push({ pos: nextElse, kind: "else" });
      break;
    }
  }

  const thenBody = splitMarkers.length > 0 ? afterThen.slice(0, splitMarkers[0]!.pos) : afterThen;
  const elseIfs: { cond: string; body: string }[] = [];
  let elseBody: string | undefined;

  for (let m = 0; m < splitMarkers.length; m++) {
    const cur = splitMarkers[m]!;
    const segEnd = m + 1 < splitMarkers.length ? splitMarkers[m + 1]!.pos : afterThen.length;
    if (cur.kind === "elseif") {
      const seg = afterThen.slice(cur.pos + 6, segEnd);
      const tIdx = findWordOutsideQuotes(seg, 0, "then", true);
      if (tIdx >= 0) {
        elseIfs.push({ cond: seg.slice(0, tIdx).trim(), body: seg.slice(tIdx + 4) });
      }
    } else {
      elseBody = afterThen.slice(cur.pos + 4);
    }
  }

  return elseBody !== undefined ? { cond, thenBody, elseIfs, elseBody } : { cond, thenBody, elseIfs };
}

function findTopLevelSemicolon(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const skipped = skipStringOrComment(s, i);
    if (skipped >= 0) {
      i = skipped;
      continue;
    }
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0) depth--;
    } else if (ch === ";" && depth === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Lowers structured Modelica statements into a language-agnostic GenericCFG.
 */
export class ModelicaCFGLowerer {
  private cfg: GenericCFG;
  private loopExitStack: number[] = [];
  private loopHeaderStack: number[] = [];
  private exitBlock: BasicBlock;

  constructor() {
    this.cfg = new GenericCFG();
    this.exitBlock = this.cfg.createBlock("exit");
    this.cfg.exitBlockIds.add(this.exitBlock.id);
  }

  /**
   * Parses raw Modelica algorithmic source text via the native WASM CST parser when available,
   * falling back to a deterministic keyword scanner when running without a registered parser.
   */
  static parseStatements(algText: string, defaultStartByte: number = 0): ModelicaStatement[] {
    const parser = UnifiedWorkspace.getGlobalParser(".mo") as { parse?: (s: string) => any } | undefined;
    if (parser && typeof parser.parse === "function" && algText.trim().length > 0) {
      const algPrefixLen = skipAlgorithmSectionPrefix(algText);
      const needsHeader = algPrefixLen === 0;
      const wrapperPrefix = needsHeader ? "model _CfgTmp\nalgorithm\n" : "model _CfgTmp\n";
      try {
        const tree = parser.parse(`${wrapperPrefix}${algText}\nend _CfgTmp;`);
        const root = tree?.rootNode ?? tree;
        if (root && !hasCstSyntaxError(root)) {
          const algNode = findCstNodesByType(root, "algorithm_section")[0];
          if (algNode) {
            const stmts = this.extractStatementsFromCst(algNode, 0);
            const delta = defaultStartByte - wrapperPrefix.length;
            return stmts.map((s) => shiftStatementOffsets(s, delta, defaultStartByte));
          }
          return [];
        }
      } catch {
        // Fall through to deterministic scanner if standalone parser throws on partial snippet.
      }
    }
    return this.parseStatementsFallback(algText, defaultStartByte);
  }

  private static parseStatementsFallback(algText: string, defaultStartByte: number = 0): ModelicaStatement[] {
    const statements: ModelicaStatement[] = [];
    const offset = skipAlgorithmSectionPrefix(algText);
    const body = algText.slice(offset);

    let i = 0;
    while (i < body.length) {
      while (i < body.length && isAsciiWhitespaceCode(body.charCodeAt(i))) i++;
      if (i >= body.length) break;

      if (hasWordAt(body, i, "if")) {
        const blockEnd = findBlockEndPos(body, i, "if");
        const ifText = body.slice(i, blockEnd);
        const startOffset = defaultStartByte + offset + i;
        const endOffset = defaultStartByte + offset + blockEnd;
        const parsedIf = splitIfBranchesDeterministic(ifText);
        const thenRel = parsedIf ? ifText.indexOf(parsedIf.thenBody) : -1;
        const thenStmts = parsedIf
          ? ModelicaCFGLowerer.parseStatementsFallback(parsedIf.thenBody, startOffset + (thenRel >= 0 ? thenRel : 0))
          : [];
        const elseIfs = (parsedIf?.elseIfs ?? []).map((ei) => {
          const eRel = ifText.indexOf(ei.body);
          return {
            condExpr: ei.cond,
            stmts: ModelicaCFGLowerer.parseStatementsFallback(ei.body, startOffset + (eRel >= 0 ? eRel : 0)),
          };
        });
        let elseStmts: ModelicaStatement[] | undefined;
        if (parsedIf?.elseBody !== undefined) {
          const elseRel = ifText.indexOf(parsedIf.elseBody);
          elseStmts = ModelicaCFGLowerer.parseStatementsFallback(
            parsedIf.elseBody,
            startOffset + (elseRel >= 0 ? elseRel : 0),
          );
        }
        statements.push({
          kind: "if",
          condExpr: parsedIf?.cond ?? "",
          thenStmts,
          elseIfs,
          elseStmts,
          rawText: ifText,
          startOffset,
          endOffset,
        });
        i = blockEnd;
        continue;
      }

      if (hasWordAt(body, i, "for")) {
        const blockEnd = findBlockEndPos(body, i, "for");
        const forText = body.slice(i, blockEnd);
        const startOffset = defaultStartByte + offset + i;
        const endOffset = defaultStartByte + offset + blockEnd;
        const split = splitHeaderAndBody(forText, "for", "loop", "for");
        const header = split?.header ?? "";
        const forBodyText = split?.body ?? "";
        const trimmedHeader = header.trimStart();
        const idEnd = readIdentLength(trimmedHeader, 0);
        const loopVar = idEnd > 0 ? trimmedHeader.slice(0, idEnd) : "i";
        const inIdx = findWordOutsideQuotes(header, 0, "in");
        const rangeExpr = inIdx >= 0 ? header.slice(inIdx + 2).trim() : "";
        let rangeStart = "1";
        let rangeEnd = "10";
        let rangeStep = "1";
        if (rangeExpr) {
          const parts = rangeExpr.split(":");
          if (parts.length === 2) {
            rangeStart = parts[0]?.trim() || "1";
            rangeEnd = parts[1]?.trim() || "10";
          } else if (parts.length === 3) {
            rangeStart = parts[0]?.trim() || "1";
            rangeStep = parts[1]?.trim() || "1";
            rangeEnd = parts[2]?.trim() || "10";
          }
        }
        const bodyRel = split ? forText.indexOf(forBodyText) : 0;
        const loopBodyStart = startOffset + (bodyRel >= 0 ? bodyRel : 0);
        statements.push({
          kind: "for",
          loopVar,
          rangeExpr: rangeExpr || undefined,
          rangeStart,
          rangeEnd,
          rangeStep,
          loopBody: ModelicaCFGLowerer.parseStatementsFallback(forBodyText, loopBodyStart),
          rawText: forText,
          startOffset,
          endOffset,
        });
        i = blockEnd;
        continue;
      }

      if (hasWordAt(body, i, "while") || hasWordAt(body, i, "when")) {
        const kw = hasWordAt(body, i, "while") ? "while" : "when";
        const midKw = kw === "while" ? "loop" : "then";
        const blockEnd = findBlockEndPos(body, i, kw);
        const blockText = body.slice(i, blockEnd);
        const startOffset = defaultStartByte + offset + i;
        const endOffset = defaultStartByte + offset + blockEnd;
        const split = splitHeaderAndBody(blockText, kw, midKw, kw);
        const condExpr = split?.header.trim() ?? "";
        const innerBody = split?.body.trim() ?? "";
        const bodyRel = split ? blockText.indexOf(innerBody) : 0;
        const parsedInner = ModelicaCFGLowerer.parseStatementsFallback(
          innerBody,
          startOffset + (bodyRel >= 0 ? bodyRel : 0),
        );
        if (kw === "while") {
          statements.push({
            kind: "while",
            condExpr,
            whileBody: parsedInner,
            rawText: blockText,
            startOffset,
            endOffset,
          });
        } else {
          statements.push({
            kind: "when",
            condExpr,
            whenBody: parsedInner,
            rawText: blockText,
            startOffset,
            endOffset,
          });
        }
        i = blockEnd;
        continue;
      }

      const semiIdx = findTopLevelSemicolon(body, i);
      if (semiIdx === -1) break;

      const stmtText = body.slice(i, semiIdx).trim();
      const startOffset = defaultStartByte + offset + i;
      const endOffset = defaultStartByte + offset + semiIdx + 1;

      if (stmtText === "return" || stmtText.startsWith("return ") || stmtText.startsWith("return(")) {
        const retVal = stmtText.slice(6).trim();
        statements.push({ kind: "return", valExpr: retVal || undefined, rawText: stmtText, startOffset, endOffset });
      } else if (stmtText === "break") {
        statements.push({ kind: "break", rawText: stmtText, startOffset, endOffset });
      } else if (stmtText.includes(":=")) {
        const parts = stmtText.split(":=");
        const targetVar = parts[0]?.trim() || "";
        const valExpr = parts.slice(1).join(":=").trim();
        statements.push({ kind: "assignment", targetVar, valExpr, rawText: stmtText, startOffset, endOffset });
      } else {
        const parsedCall = parseNamedCallArgsFromText(stmtText);
        if (parsedCall && isAsciiIdentifier(parsedCall.callee)) {
          const callArgs = parsedCall.argsText ? parsedCall.argsText.split(",").map((s) => s.trim()) : [];
          statements.push({
            kind: "call",
            callFn: parsedCall.callee,
            callArgs,
            rawText: stmtText,
            startOffset,
            endOffset,
          });
        }
      }

      i = semiIdx + 1;
    }

    return statements;
  }

  /**
   * Lowers structured ModelicaStatement nodes directly from an algorithm_section CST node.
   */
  static extractStatementsFromCst(algNode: any, defaultStartByte: number = 0): ModelicaStatement[] {
    if (!algNode) return [];
    if (!algNode.children || algNode.children.length === 0) {
      if (algNode.text) {
        return this.parseStatementsFallback(algNode.text, algNode.startIndex ?? defaultStartByte);
      }
      return [];
    }

    const statements: ModelicaStatement[] = [];
    for (const child of algNode.children) {
      const type = normCstType(child.type);
      if (type === "statement") {
        const stmt = this.extractSingleStatementFromCst(child);
        if (stmt) statements.push(stmt);
      } else if (type === "statementlist" || type === "statements") {
        statements.push(...this.extractStatementsFromCst(child, child.startIndex ?? defaultStartByte));
      }
    }

    if (statements.length === 0 && hasCstSyntaxError(algNode) && algNode.text) {
      return this.parseStatementsFallback(algNode.text, algNode.startIndex ?? defaultStartByte);
    }

    return statements;
  }

  private static extractSingleStatementFromCst(stmtNode: any): ModelicaStatement | null {
    if (!stmtNode) return null;
    const rawText = stmtNode.text || "";
    const startOffset = stmtNode.startIndex ?? 0;
    const endOffset = stmtNode.endIndex ?? startOffset + rawText.length;

    const findChild = (node: any, t: string) => node.children?.find((c: any) => normCstType(c.type) === t);
    const findDescendants = (node: any, t: string) => {
      const res: any[] = [];
      const walk = (n: any) => {
        if (!n) return;
        if (normCstType(n.type) === t) res.push(n);
        if (n.children) {
          for (const c of n.children) walk(c);
        }
      };
      walk(node);
      return res;
    };

    // 1. If statement
    const ifNode =
      findChild(stmtNode, "ifstatement") ??
      findChild(stmtNode, "if_statement") ??
      (normCstType(stmtNode.type) === "ifstatement" || normCstType(stmtNode.type) === "if_statement" ? stmtNode : null);
    if (ifNode) {
      let currentMode: "init" | "if_cond" | "then" | "elseif_cond" | "elseif_body" | "else_body" = "init";
      let curElseIf: { condExpr: string; stmts: ModelicaStatement[] } | null = null;
      let condExpr = "";
      const thenStmts: ModelicaStatement[] = [];
      const elseStmts: ModelicaStatement[] = [];
      const elseIfs: { condExpr: string; stmts: ModelicaStatement[] }[] = [];

      for (const ch of ifNode.children || []) {
        const t = normCstType(ch.type);
        const txt = (ch.text || "").trim();
        if (txt === "if") {
          currentMode = "if_cond";
        } else if (txt === "elseif") {
          curElseIf = { condExpr: "", stmts: [] };
          elseIfs.push(curElseIf);
          currentMode = "elseif_cond";
        } else if (txt === "then") {
          currentMode = curElseIf ? "elseif_body" : "then";
        } else if (txt === "else") {
          curElseIf = null;
          currentMode = "else_body";
        } else if (txt === "end if" || txt === "endif" || txt === "end") {
          break;
        } else if (t === "expression" && (currentMode === "if_cond" || currentMode === "init")) {
          condExpr = ch.text?.trim() || "";
          currentMode = "then";
        } else if (t === "expression" && currentMode === "elseif_cond" && curElseIf) {
          curElseIf.condExpr = ch.text?.trim() || "";
          currentMode = "elseif_body";
        } else if (t === "statement") {
          const s = this.extractSingleStatementFromCst(ch);
          if (s) {
            if (currentMode === "else_body") {
              elseStmts.push(s);
            } else if (currentMode === "elseif_body" && curElseIf) {
              curElseIf.stmts.push(s);
            } else {
              thenStmts.push(s);
            }
          }
        }
      }

      if (!condExpr) {
        const exprNodes = findDescendants(ifNode, "expression");
        condExpr = exprNodes[0]?.text?.trim() || "";
      }

      if (thenStmts.length === 0 && elseStmts.length === 0 && rawText) {
        const parsed = this.parseStatementsFallback(rawText, startOffset);
        if (parsed.length > 0) return parsed[0]!;
      }

      return {
        kind: "if",
        condExpr,
        thenStmts,
        elseStmts,
        elseIfs,
        rawText,
        startOffset,
        endOffset,
      };
    }

    // 2. For statement
    const forNode =
      findChild(stmtNode, "forstatement") ??
      findChild(stmtNode, "for_statement") ??
      (normCstType(stmtNode.type) === "forstatement" || normCstType(stmtNode.type) === "for_statement"
        ? stmtNode
        : null);
    if (forNode) {
      let loopVar = "";
      let rangeText = "";
      const indicesNode = findChild(forNode, "forindices") ?? findChild(forNode, "for_indices");
      const indexNodes = indicesNode
        ? findDescendants(indicesNode, "forindex").concat(findDescendants(indicesNode, "for_index"))
        : findDescendants(forNode, "forindex").concat(findDescendants(forNode, "for_index"));

      if (indexNodes.length > 0) {
        const idNode = findDescendants(indexNodes[0], "identifier")[0];
        loopVar = idNode?.text?.trim() || "";
        const exprNode = findDescendants(indexNodes[0], "expression")[0];
        rangeText = exprNode?.text?.trim() || "";
      } else {
        const idNode = findDescendants(forNode, "identifier")[0];
        loopVar = idNode?.text?.trim() || "";
        const exprNodes = findDescendants(forNode, "expression");
        rangeText = exprNodes[0]?.text?.trim() || "";
      }

      let rangeStart = "1";
      let rangeEnd = "1";
      let rangeStep = "1";
      if (rangeText.includes(":")) {
        const parts = rangeText.split(":");
        if (parts.length === 2) {
          rangeStart = parts[0]!.trim();
          rangeEnd = parts[1]!.trim();
        } else if (parts.length === 3) {
          rangeStart = parts[0]!.trim();
          rangeStep = parts[1]!.trim();
          rangeEnd = parts[2]!.trim();
        }
      }

      const loopBody: ModelicaStatement[] = [];
      const childStmts = (forNode.children || []).filter((c: any) => normCstType(c.type) === "statement");
      for (const ch of childStmts) {
        const s = this.extractSingleStatementFromCst(ch);
        if (s) loopBody.push(s);
      }

      if (loopBody.length === 0 && rawText) {
        const parsed = this.parseStatementsFallback(rawText, startOffset);
        if (parsed.length > 0) return parsed[0]!;
      }

      return {
        kind: "for",
        loopVar: loopVar || "i",
        rangeStart,
        rangeEnd,
        rangeStep,
        loopBody,
        rawText,
        startOffset,
        endOffset,
      };
    }

    // 3. While statement
    const whileNode =
      findChild(stmtNode, "whilestatement") ??
      findChild(stmtNode, "while_statement") ??
      (normCstType(stmtNode.type) === "whilestatement" || normCstType(stmtNode.type) === "while_statement"
        ? stmtNode
        : null);
    if (whileNode) {
      const exprNodes = findDescendants(whileNode, "expression");
      const condExpr = exprNodes[0]?.text?.trim() || "";
      const whileBody: ModelicaStatement[] = [];
      const childStmts = (whileNode.children || []).filter((c: any) => normCstType(c.type) === "statement");
      for (const ch of childStmts) {
        const s = this.extractSingleStatementFromCst(ch);
        if (s) whileBody.push(s);
      }

      if (whileBody.length === 0 && rawText) {
        const parsed = this.parseStatementsFallback(rawText, startOffset);
        if (parsed.length > 0) return parsed[0]!;
      }

      return {
        kind: "while",
        condExpr,
        whileBody,
        rawText,
        startOffset,
        endOffset,
      };
    }

    // 4. When statement
    const whenNode =
      findChild(stmtNode, "whenstatement") ??
      findChild(stmtNode, "when_statement") ??
      (normCstType(stmtNode.type) === "whenstatement" || normCstType(stmtNode.type) === "when_statement"
        ? stmtNode
        : null);
    if (whenNode) {
      const exprNodes = findDescendants(whenNode, "expression");
      const condExpr = exprNodes[0]?.text?.trim() || "";
      const whenBody: ModelicaStatement[] = [];
      const childStmts = (whenNode.children || []).filter((c: any) => normCstType(c.type) === "statement");
      for (const ch of childStmts) {
        const s = this.extractSingleStatementFromCst(ch);
        if (s) whenBody.push(s);
      }

      if (whenBody.length === 0 && rawText) {
        const parsed = this.parseStatementsFallback(rawText, startOffset);
        if (parsed.length > 0) return parsed[0]!;
      }

      return {
        kind: "when",
        condExpr,
        whenBody,
        rawText,
        startOffset,
        endOffset,
      };
    }

    // 5. Assignment statement
    const assignNode =
      findChild(stmtNode, "assignmentstatement") ??
      findChild(stmtNode, "assignment_statement") ??
      (normCstType(stmtNode.type) === "assignmentstatement" || normCstType(stmtNode.type) === "assignment_statement"
        ? stmtNode
        : null);

    if (assignNode || rawText.includes(":=")) {
      let targetVar = "";
      let valExpr = "";
      if (assignNode) {
        const compRef = findChild(assignNode, "componentreference") ?? findChild(assignNode, "component_reference");
        const exprNode = findChild(assignNode, "expression");
        targetVar = compRef?.text?.trim() || "";
        valExpr = exprNode?.text?.trim() || "";
      }
      if (!targetVar && rawText.includes(":=")) {
        const parts = rawText.split(":=");
        targetVar = trimSemicolons(parts[0]?.trim() || "");
        valExpr = trimSemicolons(parts.slice(1).join(":=").trim());
      }

      return {
        kind: "assignment",
        targetVar,
        valExpr,
        rawText,
        startOffset,
        endOffset,
      };
    }

    // 6. Return / Break
    const rawTrimmed = rawText.trim();
    const trimmed = rawTrimmed.endsWith(";") ? rawTrimmed.slice(0, -1) : rawTrimmed;
    if (trimmed === "return" || trimmed.startsWith("return ") || trimmed.startsWith("return(")) {
      return { kind: "return", rawText, startOffset, endOffset };
    }
    if (trimmed === "break") {
      return { kind: "break", rawText, startOffset, endOffset };
    }

    // 7. Function call
    const parsedCall = parseNamedCallArgsFromText(trimmed);
    if (parsedCall && isAsciiIdentifier(parsedCall.callee)) {
      const callFn = parsedCall.callee;
      const callArgs = parsedCall.argsText ? parsedCall.argsText.split(",").map((s) => s.trim()) : [];
      return { kind: "call", callFn, callArgs, rawText, startOffset, endOffset };
    }

    return null;
  }

  /**
   * Lowers algorithmic sections of a class directly from linear CST / CodeGraph.
   */
  static lowerAlgorithmFromCst(db: any, classId: any): GenericCFG {
    if (!db || classId === undefined || classId === null) {
      return new GenericCFG();
    }
    const cst = typeof db.cstNode === "function" ? db.cstNode(classId) : (db.rootNode ?? db);
    if (!cst) {
      return new GenericCFG();
    }
    return this.lowerAlgorithmFromClassCst(cst);
  }

  /**
   * Lowers algorithmic sections directly from a class_definition CST node.
   */
  static lowerAlgorithmFromClassCst(classCst: any): GenericCFG {
    const algSections = findCstNodesByType(classCst, "algorithm_section");
    if (algSections.length === 0) {
      return new GenericCFG();
    }

    const allStatements: ModelicaStatement[] = [];
    for (const alg of algSections) {
      const stmts = ModelicaCFGLowerer.extractStatementsFromCst(alg, alg.startIndex ?? 0);
      allStatements.push(...stmts);
    }

    return new ModelicaCFGLowerer().lower(allStatements);
  }

  /**
   * Lowers an algorithm_section CST node directly into a GenericCFG.
   */
  static lowerCst(algNode: any, defaultStartByte: number = 0): GenericCFG {
    const stmts = ModelicaCFGLowerer.extractStatementsFromCst(algNode, defaultStartByte);
    return new ModelicaCFGLowerer().lower(stmts);
  }

  /**
   * Lowers raw Modelica algorithmic source text directly into a GenericCFG.
   */
  static lowerText(algText: string, defaultStartByte: number = 0): GenericCFG {
    const stmts = ModelicaCFGLowerer.parseStatements(algText, defaultStartByte);
    return new ModelicaCFGLowerer().lower(stmts);
  }

  lower(statements: ModelicaStatement[]): GenericCFG {
    const entryBlock = this.cfg.createBlock("entry");
    this.cfg.entryBlockId = entryBlock.id;

    const finalBlock = this.lowerStatements(statements, entryBlock);
    if (finalBlock && finalBlock.id !== this.exitBlock.id) {
      this.cfg.addEdge(finalBlock.id, this.exitBlock.id, CFGEdgeKind.Normal);
    }

    return this.cfg;
  }

  private lowerStatements(statements: ModelicaStatement[], currentBlock: BasicBlock): BasicBlock {
    let curr = currentBlock;

    for (const stmt of statements) {
      curr = this.lowerSingleStatement(stmt, curr);
    }

    return curr;
  }

  private lowerSingleStatement(stmt: ModelicaStatement, curr: BasicBlock): BasicBlock {
    switch (stmt.kind) {
      case "assignment": {
        const target = stmt.targetVar ?? "";
        // Check if target is array element assignment: arr[idx] or arr[i, j]
        const openBracket = target.indexOf("[");
        if (openBracket > 0 && target.endsWith("]")) {
          const arrName = target.slice(0, openBracket);
          if (isAsciiIdentifier(arrName)) {
            const idxExpr = target.slice(openBracket + 1, -1);
            const inst = this.cfg.createInstruction("ASSIGN_ARRAY", arrName, [idxExpr, stmt.valExpr ?? "0"], {
              startOffset: stmt.startOffset,
              endOffset: stmt.endOffset,
              rawText: stmt.rawText,
            });
            curr.addInstruction(inst);
            return curr;
          }
        }

        const inst = this.cfg.createInstruction("ASSIGN", stmt.targetVar, stmt.valExpr ? [stmt.valExpr] : [], {
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
          rawText: stmt.rawText,
        });
        curr.addInstruction(inst);
        return curr;
      }

      case "call": {
        const inst = this.cfg.createInstruction("CALL", stmt.callFn, stmt.callArgs ?? [], {
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
          rawText: stmt.rawText,
        });
        curr.addInstruction(inst);
        return curr;
      }

      case "return": {
        const inst = this.cfg.createInstruction("RETURN", undefined, stmt.valExpr ? [stmt.valExpr] : [], {
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
        });
        curr.addInstruction(inst);
        this.cfg.addEdge(curr.id, this.exitBlock.id, CFGEdgeKind.Return);
        return this.cfg.createBlock("unreachable_after_return");
      }

      case "break": {
        const inst = this.cfg.createInstruction("BREAK", undefined, undefined, {
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
        });
        curr.addInstruction(inst);
        const exitId = this.loopExitStack[this.loopExitStack.length - 1];
        if (exitId !== undefined) {
          this.cfg.addEdge(curr.id, exitId, CFGEdgeKind.Normal);
        }
        return this.cfg.createBlock("unreachable_after_break");
      }

      case "if": {
        const mergeBlock = this.cfg.createBlock("if_merge");
        let currentCondBlock = curr;
        let currentCondExpr = stmt.condExpr ?? "true";

        // 1. Then branch
        const thenEntry = this.cfg.createBlock("then_entry");
        this.cfg.addEdge(currentCondBlock.id, thenEntry.id, CFGEdgeKind.TrueBranch, currentCondExpr);
        const thenEnd = this.lowerStatements(stmt.thenStmts ?? [], thenEntry);
        this.cfg.addEdge(thenEnd.id, mergeBlock.id, CFGEdgeKind.Normal);

        // 2. ElseIf branches
        for (const elseIf of stmt.elseIfs ?? []) {
          const nextCondBlock = this.cfg.createBlock("elseif_cond");
          this.cfg.addEdge(currentCondBlock.id, nextCondBlock.id, CFGEdgeKind.FalseBranch, `not (${currentCondExpr})`);

          const elseIfEntry = this.cfg.createBlock("elseif_entry");
          this.cfg.addEdge(nextCondBlock.id, elseIfEntry.id, CFGEdgeKind.TrueBranch, elseIf.condExpr);
          const elseIfEnd = this.lowerStatements(elseIf.stmts, elseIfEntry);
          this.cfg.addEdge(elseIfEnd.id, mergeBlock.id, CFGEdgeKind.Normal);

          currentCondBlock = nextCondBlock;
          currentCondExpr = elseIf.condExpr;
        }

        // 3. Else branch
        if (stmt.elseStmts && stmt.elseStmts.length > 0) {
          const elseEntry = this.cfg.createBlock("else_entry");
          this.cfg.addEdge(currentCondBlock.id, elseEntry.id, CFGEdgeKind.FalseBranch, `not (${currentCondExpr})`);
          const elseEnd = this.lowerStatements(stmt.elseStmts, elseEntry);
          this.cfg.addEdge(elseEnd.id, mergeBlock.id, CFGEdgeKind.Normal);
        } else {
          this.cfg.addEdge(currentCondBlock.id, mergeBlock.id, CFGEdgeKind.FalseBranch, `not (${currentCondExpr})`);
        }

        return mergeBlock;
      }

      case "when": {
        const mergeBlock = this.cfg.createBlock("when_merge");
        const whenEntry = this.cfg.createBlock("when_entry");
        const condExpr = stmt.condExpr ?? "true";

        this.cfg.addEdge(curr.id, whenEntry.id, CFGEdgeKind.TrueBranch, condExpr);
        this.cfg.addEdge(curr.id, mergeBlock.id, CFGEdgeKind.FalseBranch, `not (${condExpr})`);

        const whenEnd = this.lowerStatements(stmt.whenBody ?? [], whenEntry);
        this.cfg.addEdge(whenEnd.id, mergeBlock.id, CFGEdgeKind.Normal);

        return mergeBlock;
      }

      case "while": {
        const headerBlock = this.cfg.createBlock("while_header");
        const bodyBlock = this.cfg.createBlock("while_body");
        const exitBlock = this.cfg.createBlock("while_exit");

        this.cfg.addEdge(curr.id, headerBlock.id, CFGEdgeKind.Normal);
        this.cfg.addEdge(headerBlock.id, bodyBlock.id, CFGEdgeKind.TrueBranch, stmt.condExpr);
        this.cfg.addEdge(headerBlock.id, exitBlock.id, CFGEdgeKind.FalseBranch, `not (${stmt.condExpr})`);

        this.loopHeaderStack.push(headerBlock.id);
        this.loopExitStack.push(exitBlock.id);

        const bodyEnd = this.lowerStatements(stmt.whileBody ?? [], bodyBlock);
        this.cfg.addEdge(bodyEnd.id, headerBlock.id, CFGEdgeKind.Normal); // Loop back-edge

        this.loopHeaderStack.pop();
        this.loopExitStack.pop();

        return exitBlock;
      }

      case "for": {
        const loopVar = stmt.loopVar ?? "i";
        const startVal = stmt.rangeStart ?? "1";
        const endVal = stmt.rangeEnd ?? "10";
        const stepVal = stmt.rangeStep ?? "1";

        // Initialize loop variable in pre-header
        curr.addInstruction(this.cfg.createInstruction("ASSIGN", loopVar, [startVal]));

        const headerBlock = this.cfg.createBlock("for_header");
        const bodyBlock = this.cfg.createBlock("for_body");
        const exitBlock = this.cfg.createBlock("for_exit");

        const loopHeaderEnd = (stmt.startOffset ?? 0) + (stmt.rawText ? stmt.rawText.indexOf("loop") + 4 : 20);
        headerBlock.addInstruction(
          this.cfg.createInstruction("ASSUME", loopVar, [`${loopVar} <= ${endVal}`], {
            startOffset: stmt.startOffset,
            endOffset: loopHeaderEnd,
          }),
        );

        const condExpr = `${loopVar} <= ${endVal}`;
        this.cfg.addEdge(curr.id, headerBlock.id, CFGEdgeKind.Normal);
        this.cfg.addEdge(headerBlock.id, bodyBlock.id, CFGEdgeKind.TrueBranch, condExpr);
        this.cfg.addEdge(headerBlock.id, exitBlock.id, CFGEdgeKind.FalseBranch, `not (${condExpr})`);

        this.loopHeaderStack.push(headerBlock.id);
        this.loopExitStack.push(exitBlock.id);

        let bodyEnd = this.lowerStatements(stmt.loopBody ?? [], bodyBlock);

        // Increment loop variable: i := i + step
        bodyEnd.addInstruction(this.cfg.createInstruction("ASSIGN", loopVar, [`${loopVar} + ${stepVal}`]));

        this.cfg.addEdge(bodyEnd.id, headerBlock.id, CFGEdgeKind.Normal); // Loop back-edge

        this.loopHeaderStack.pop();
        this.loopExitStack.pop();

        return exitBlock;
      }

      default: {
        return curr;
      }
    }
  }
}

function normCstType(t: string | undefined): string {
  if (!t) return "";
  let out = "";
  const lower = t.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      out += lower[i]!;
    }
  }
  return out;
}

export function findCstNodesByType(root: any, typeName: string): any[] {
  const results: any[] = [];
  const target = normCstType(typeName);

  function walk(node: any) {
    if (!node) return;
    if (normCstType(node.type) === target) {
      results.push(node);
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return results;
}
