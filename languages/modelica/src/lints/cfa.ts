// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/cfa
 *
 * Control Flow Analysis (CFA) and definite-assignment checker for Modelica
 * `algorithm` sections and `function` definitions (MLS §11.2, §12.2, §12.4.4).
 *
 * Detects:
 * - Unassigned function `output` variables on return or function exit (M5020)
 * - Reads of uninitialized local or output variables before assignment (M5021)
 * - Unreachable statements following unconditional `return`, `break`, or `assert(false, ...)` (M5022)
 */

import { error, warning, type CompilerLint, type LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { ModelicaErrorCode } from "../errors.js";
import {
  isAsciiIdentContinue,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
  tokenizeCommentStrippedWords,
} from "../flattener/expressions/cst-utils.js";
import { ModelicaCFGLowerer, type ModelicaStatement } from "../formal/modelica-cfg-lowerer.js";

function unwrapOuterParens(s: string): string {
  const start = s.startsWith("(") ? 1 : 0;
  const end = s.endsWith(")") && s.length > start ? s.length - 1 : s.length;
  return s.slice(start, end);
}

function extractBaseVarIdent(s: string): string {
  let end = s.length;
  const dotIdx = s.indexOf(".");
  if (dotIdx >= 0 && dotIdx < end) end = dotIdx;
  const bracketIdx = s.indexOf("[");
  if (bracketIdx >= 0 && bracketIdx < end) end = bracketIdx;
  return s.slice(0, end).trim();
}

function isAbortCallStatement(raw: string): boolean {
  const trimmed = raw.trimStart();
  const parenIdx = trimmed.indexOf("(");
  if (parenIdx < 0) return false;
  const callee = trimmed.slice(0, parenIdx).trimEnd();
  if (callee === "assert") {
    const afterParen = trimmed.slice(parenIdx + 1).trimStart();
    if (!afterParen.startsWith("false")) return false;
    const nextCh = afterParen.charCodeAt(5);
    return Number.isNaN(nextCh) || !isAsciiIdentContinue(nextCh);
  }
  return callee === "error" || callee === "Modelica.Utilities.Streams.error";
}

/**
 * Metadata for a declared function or algorithm variable tracked during CFA.
 */
interface VariableInfo {
  /** Simple identifier of the declared variable. */
  name: string;
  /** Whether the variable carries the `input` causality prefix. */
  isInput: boolean;
  /** Whether the variable carries the `output` causality prefix. */
  isOutput: boolean;
  /** Whether the variable has a declaration binding (`= expr`) or record field initializer. */
  hasDefault: boolean;
  /** Whether the variable is an array (element-wise assignments partially initialize it). */
  isArray?: boolean | undefined;
  /** Starting byte offset of the variable's identifier in the source file. */
  startOffset: number;
  /** Ending byte offset of the variable's identifier in the source file. */
  endOffset: number;
}

/**
 * Minimal structural interface for CST nodes inspected during Control Flow Analysis.
 * Compatible with WASM `SyntaxNode` instances and lightweight AST fixtures.
 */
interface CfaCstNode {
  readonly type?: string | undefined;
  readonly text?: string | undefined;
  readonly children?: readonly CfaCstNode[] | undefined;
  readonly startIndex?: number | undefined;
  readonly endIndex?: number | undefined;
  readonly isError?: boolean | undefined;
}

function isCfaCstNode(value: unknown): value is CfaCstNode {
  return typeof value === "object" && value !== null;
}

/**
 * Normalizes rule and node type names for case/underscore insensitive comparison.
 */
function normType(t: string | undefined): string {
  return (t || "").toLowerCase().replaceAll("_", "");
}

/**
 * Searches for all nodes matching a given type name.
 */
function findNodesByType(root: CfaCstNode, typeName: string): CfaCstNode[] {
  const results: CfaCstNode[] = [];
  const target = normType(typeName);

  function walk(node: CfaCstNode | null | undefined): void {
    if (!node) return;
    const nt = normType(node.type);
    if (node !== root && nt === "classdefinition") {
      return;
    }
    if (nt === target) {
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

/**
 * Computes set intersection between two Sets.
 */
function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const res = new Set<T>();
  for (const item of a) {
    if (b.has(item)) res.add(item);
  }
  return res;
}

/**
 * Represents a conditional `if` or `elseif` branch within a parsed statement tree.
 */
interface ParsedBranch {
  /** Raw source text of the branch guard condition expression. */
  condExpr?: string | undefined;
  /** Starting byte offset of the condition expression in the source document. */
  condStartByte?: number | undefined;
  /** Ordered sequence of statements inside the branch body. */
  stmts: ParsedStatement[];
}

/**
 * Lightweight control-flow representation of a statement inside an `algorithm` section.
 */
interface ParsedStatement {
  /** Discriminator indicating the statement's syntactic category. */
  kind: "assignment" | "if" | "for" | "while" | "when" | "return" | "break" | "other";
  /** Base variable names assigned on the LHS (supports tuple assignments `(a, b) := f()`). */
  targetVars?: string[] | undefined;
  /** Raw LHS target string for single-target assignments. */
  targetVar?: string | undefined;
  /** Raw RHS value expression text for assignments. */
  valExpr?: string | undefined;
  /** Starting byte offset of the RHS value expression. */
  valStartByte?: number | undefined;
  /** Condition expression text for `if`, `while`, or `when` statements. */
  condExpr?: string | undefined;
  /** Starting byte offset of `condExpr`. */
  condStartByte?: number | undefined;
  /** Complete raw source text of the statement. */
  rawText: string;
  /** Starting byte offset of the statement in the source document. */
  startOffset: number;
  /** Ending byte offset of the statement in the source document. */
  endOffset: number;
  /** Conditional branches (`if` and `elseif` clauses) for `if` statements. */
  branches?: ParsedBranch[] | undefined;
  /** Statements in the fallback `else` clause of an `if` statement, if present. */
  elseStmts?: ParsedStatement[] | undefined;
  /** Statements in the primary `then` branch of an `if` statement. */
  thenStmts?: ParsedStatement[] | undefined;
  /** Iterator variable names bound by a `for` loop header. */
  loopVars?: string[] | undefined;
  /** Iteration range expression text in a `for` loop header. */
  rangeExpr?: string | undefined;
  /** Starting byte offset of `rangeExpr`. */
  rangeStartByte?: number | undefined;
  /** Body statements inside a `for` loop. */
  loopBody?: ParsedStatement[] | undefined;
  /** Body statements inside a `while` loop. */
  whileBody?: ParsedStatement[] | undefined;
  /** Body statements inside a `when` statement. */
  whenBody?: ParsedStatement[] | undefined;
}

/**
 * Extracts parsed statements directly from a CST statement node.
 */
function extractStatementFromNode(stmtNode: CfaCstNode): ParsedStatement {
  const sStart = stmtNode.startIndex ?? 0;
  const sEnd = stmtNode.endIndex ?? sStart + (stmtNode.text?.length ?? 0);
  const rawText = stmtNode.text || "";

  // 1. If statement: if ... then ... [elseif ... then ...]* [else ...]? end if;
  const ifNode =
    normType(stmtNode.type) === "ifstatement"
      ? stmtNode
      : stmtNode.children?.find((c: CfaCstNode) => normType(c.type) === "ifstatement");

  if (ifNode) {
    let currentMode: "init" | "if_cond" | "then" | "elseif_cond" | "elseif_body" | "else_body" = "init";
    const branches: ParsedBranch[] = [];
    let elseStmts: ParsedStatement[] | undefined = undefined;
    let curBranch: ParsedBranch | null = null;

    for (const ch of ifNode.children || []) {
      const t = normType(ch.type);
      const txt = (ch.text || "").trim();
      if (txt === "if") {
        curBranch = { stmts: [] };
        branches.push(curBranch);
        currentMode = "if_cond";
      } else if (txt === "elseif") {
        curBranch = { stmts: [] };
        branches.push(curBranch);
        currentMode = "elseif_cond";
      } else if (txt === "then") {
        currentMode = curBranch === branches[0] ? "then" : "elseif_body";
      } else if (txt === "else") {
        elseStmts = [];
        curBranch = null;
        currentMode = "else_body";
      } else if (txt === "end if" || txt === "endif") {
        break;
      } else if (t === "expression" && (currentMode === "if_cond" || currentMode === "elseif_cond")) {
        if (curBranch) {
          curBranch.condExpr = ch.text || "";
          curBranch.condStartByte = ch.startIndex ?? sStart;
        }
      } else if (t === "statement") {
        const sub = extractStatementFromNode(ch);
        if (currentMode === "else_body") {
          elseStmts?.push(sub);
        } else if (curBranch) {
          curBranch.stmts.push(sub);
        }
      }
    }

    return {
      kind: "if",
      condExpr: branches[0]?.condExpr,
      condStartByte: branches[0]?.condStartByte,
      rawText,
      startOffset: sStart,
      endOffset: sEnd,
      branches,
      elseStmts,
      thenStmts: branches[0]?.stmts,
    };
  }

  // 2. For statement: for <indices> loop <body> end for;
  const forNode =
    normType(stmtNode.type) === "forstatement"
      ? stmtNode
      : stmtNode.children?.find((c: CfaCstNode) => normType(c.type) === "forstatement");

  if (forNode) {
    const loopVars: string[] = [];
    let rangeExpr: string | undefined;
    let rangeStartByte: number | undefined;
    const loopBody: ParsedStatement[] = [];

    const indicesNode = forNode.children?.find((c: CfaCstNode) => normType(c.type) === "forindices");
    const indexNodes = indicesNode ? findNodesByType(indicesNode, "for_index") : findNodesByType(forNode, "for_index");

    for (const idxNode of indexNodes) {
      const idNode = idxNode.children?.find((c: CfaCstNode) => normType(c.type) === "identifier");
      if (idNode && idNode.text) {
        loopVars.push(idNode.text.trim());
      }
      const exprNode = idxNode.children?.find((c: CfaCstNode) => normType(c.type) === "expression");
      if (exprNode) {
        rangeExpr = exprNode.text || "";
        rangeStartByte = exprNode.startIndex ?? sStart;
      }
    }

    for (const ch of forNode.children || []) {
      if (normType(ch.type) === "statement") {
        loopBody.push(extractStatementFromNode(ch));
      }
    }

    return {
      kind: "for",
      rawText,
      startOffset: sStart,
      endOffset: sEnd,
      loopVars,
      rangeExpr,
      rangeStartByte,
      loopBody,
    };
  }

  // 3. While statement: while <cond> loop <body> end while;
  const whileNode =
    normType(stmtNode.type) === "whilestatement"
      ? stmtNode
      : stmtNode.children?.find((c: CfaCstNode) => normType(c.type) === "whilestatement");

  if (whileNode) {
    let condExpr: string | undefined;
    let condStartByte: number | undefined;
    const whileBody: ParsedStatement[] = [];

    const exprNode = whileNode.children?.find((c: CfaCstNode) => normType(c.type) === "expression");
    if (exprNode) {
      condExpr = exprNode.text || "";
      condStartByte = exprNode.startIndex ?? sStart;
    }

    for (const ch of whileNode.children || []) {
      if (normType(ch.type) === "statement") {
        whileBody.push(extractStatementFromNode(ch));
      }
    }

    return {
      kind: "while",
      rawText,
      startOffset: sStart,
      endOffset: sEnd,
      condExpr,
      condStartByte,
      whileBody,
    };
  }

  // 4. When statement: when <cond> then <body> [elsewhen <cond> then <body>]* end when;
  const whenNode =
    normType(stmtNode.type) === "whenstatement"
      ? stmtNode
      : stmtNode.children?.find((c: CfaCstNode) => normType(c.type) === "whenstatement");

  if (whenNode) {
    const whenBranches: ParsedBranch[] = [];
    let curBranch: ParsedBranch = { condExpr: "", stmts: [] };
    let mode: "when_cond" | "when_body" | "elsewhen_cond" | "elsewhen_body" = "when_cond";

    const walkWhen = (n: CfaCstNode | null | undefined): void => {
      if (!n) return;
      const t = normType(n.type);
      const txt = n.text?.trim() ?? "";
      if (txt === "when" || txt === "end when") {
        if (txt === "when" && n !== whenNode) {
          mode = "when_cond";
        }
        return;
      }
      if (txt === "elsewhen") {
        whenBranches.push(curBranch);
        curBranch = { condExpr: "", stmts: [] };
        mode = "elsewhen_cond";
        return;
      }
      if (txt === "then") {
        mode = mode === "elsewhen_cond" ? "elsewhen_body" : "when_body";
        return;
      }
      if (t === "expression" && (mode === "when_cond" || mode === "elsewhen_cond")) {
        curBranch.condExpr = n.text || "";
        curBranch.condStartByte = n.startIndex ?? sStart;
        return;
      }
      if (t === "statement") {
        curBranch.stmts.push(extractStatementFromNode(n));
        return;
      }
      for (const ch of n.children || []) walkWhen(ch);
    };
    walkWhen(whenNode);
    whenBranches.push(curBranch);

    const firstBranch = whenBranches[0];
    return {
      kind: "when",
      rawText,
      startOffset: sStart,
      endOffset: sEnd,
      condExpr: firstBranch?.condExpr || undefined,
      condStartByte: firstBranch?.condStartByte,
      whenBody: firstBranch?.stmts ?? [],
      branches: whenBranches,
    };
  }

  // 5. Multi-output tuple assignment: (a, b) := f(...)
  const tupleMatch = findNodesByType(stmtNode, "output_expression_list");
  if (tupleMatch.length > 0) {
    const targetVars: string[] = [];
    const outList = tupleMatch[0];
    const exprs = outList?.children?.filter((c: CfaCstNode) => normType(c.type) === "expression") ?? [];
    for (const expr of exprs) {
      const varText = (expr.text || "").trim();
      if (varText) {
        const base = extractBaseVarIdent(varText);
        if (base) targetVars.push(base);
      }
    }

    const callNode =
      stmtNode.children?.find((c: CfaCstNode) => normType(c.type) === "functioncall") ||
      findNodesByType(stmtNode, "function_call")[0];
    const valExpr = callNode?.text || rawText.split(":=")[1]?.trim() || "";
    const valStartByte = callNode?.startIndex ?? sStart + Math.max(0, rawText.indexOf(":=") + 2);

    return {
      kind: "assignment",
      targetVars,
      valExpr,
      valStartByte,
      rawText,
      startOffset: sStart,
      endOffset: sEnd,
    };
  }

  // 6. Assignment statement: target := expr
  const assignNode =
    normType(stmtNode.type) === "assignmentstatement" ? stmtNode : findNodesByType(stmtNode, "assignment_statement")[0];

  if (assignNode) {
    const compRef = assignNode.children?.find((c: CfaCstNode) => normType(c.type) === "componentreference");
    const valNode = assignNode.children?.find((c: CfaCstNode) => normType(c.type) === "expression");
    const targetVar = compRef?.text || rawText.split(":=")[0]?.trim() || "";
    const valExpr = valNode?.text || rawText.split(":=")[1]?.trim() || "";
    const valStartByte = valNode?.startIndex ?? sStart + Math.max(0, rawText.indexOf(":=") + 2);

    const base = extractBaseVarIdent(targetVar);
    return {
      kind: "assignment",
      targetVars: base ? [base] : [],
      targetVar,
      valExpr,
      valStartByte,
      rawText,
      startOffset: sStart,
      endOffset: sEnd,
    };
  }

  // 7. Check return / break
  const trimmed = rawText.trim();
  if (
    trimmed === "return" ||
    trimmed.startsWith("return ") ||
    trimmed.startsWith("return(") ||
    trimmed.startsWith("return;")
  ) {
    return { kind: "return", rawText, startOffset: sStart, endOffset: sEnd };
  }
  if (trimmed === "break" || trimmed.startsWith("break;") || trimmed.startsWith("break ")) {
    return { kind: "break", rawText, startOffset: sStart, endOffset: sEnd };
  }

  // 8. Fallback: check if text has :=
  if (rawText.includes(":=")) {
    const parts = rawText.split(":=");
    const targetVar = parts[0]?.trim() || "";
    const valExpr = parts.slice(1).join(":=").trim();
    const baseVars = unwrapOuterParens(targetVar)
      .split(",")
      .map(extractBaseVarIdent)
      .filter((s): s is string => Boolean(s));

    return {
      kind: "assignment",
      targetVars: baseVars,
      targetVar,
      valExpr,
      valStartByte: sStart + rawText.indexOf(":=") + 2,
      rawText,
      startOffset: sStart,
      endOffset: sEnd,
    };
  }

  return {
    kind: "other",
    rawText,
    startOffset: sStart,
    endOffset: sEnd,
  };
}

/**
 * Extracts statements from an algorithm_section CST node.
 */
function extractStatementsFromCst(algNode: CfaCstNode | null | undefined, defaultStartByte: number): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  if (!algNode || !algNode.children || algNode.children.length === 0) {
    return parseStatementsFromText(algNode?.text || "", defaultStartByte);
  }

  let hasSyntaxError = Boolean(algNode.isError || algNode.type === "ERROR");
  const collectStmts = (node: CfaCstNode): void => {
    for (const child of node.children || []) {
      const nt = normType(child.type);
      if (child.isError || child.type === "ERROR") {
        hasSyntaxError = true;
      }
      if (nt === "statement") {
        statements.push(extractStatementFromNode(child));
      } else if (nt === "statementlist" || nt === "statements") {
        collectStmts(child);
      }
    }
  };
  collectStmts(algNode);

  if (statements.length === 0 && hasSyntaxError && algNode.text) {
    return parseStatementsFromText(algNode.text, defaultStartByte);
  }

  return statements;
}

/**
 * Replaces comments and string literal contents with spaces while preserving exact byte offsets.
 *
 * @param src - Raw source snippet to mask.
 * @returns Masked string with identical length and line breaks.
 */
function maskCommentsAndStringsPreservingLength(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "/" && src[i + 1] === "/") {
      out.push(" ", " ");
      i += 2;
      while (i < src.length && src[i] !== "\n") {
        out.push(src[i] === "\r" ? "\r" : " ");
        i++;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const closeIdx = src.indexOf("*/", i + 2);
      if (closeIdx >= 0) {
        const end = closeIdx + 2;
        for (let j = i; j < end; j++) {
          const c = src[j]!;
          out.push(c === "\r" || c === "\n" ? c : " ");
        }
        i = end;
        continue;
      }
    }
    if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === "\\" && j + 1 < src.length) {
          j += 2;
          continue;
        }
        if (src[j] === '"') {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        out.push('"');
        for (let k = i + 1; k < j - 1; k++) {
          out.push(" ");
        }
        out.push('"');
        i = j;
        continue;
      }
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

function toParsedStatement(stmt: ModelicaStatement, fallbackStart: number): ParsedStatement {
  const startOffset = stmt.startOffset ?? fallbackStart;
  const rawText = stmt.rawText ?? "";
  const endOffset = stmt.endOffset ?? startOffset + rawText.length;

  if (stmt.kind === "if") {
    const thenStmts = (stmt.thenStmts ?? []).map((s) => toParsedStatement(s, startOffset));
    const firstCondRel = stmt.condExpr && rawText ? rawText.indexOf(stmt.condExpr) : -1;
    const branches: ParsedBranch[] = [
      {
        condExpr: stmt.condExpr,
        condStartByte: startOffset + (firstCondRel >= 0 ? firstCondRel : 0),
        stmts: thenStmts,
      },
      ...(stmt.elseIfs ?? []).map((ei) => {
        const condRel = ei.condExpr && rawText ? rawText.indexOf(ei.condExpr) : -1;
        return {
          condExpr: ei.condExpr,
          condStartByte: startOffset + (condRel >= 0 ? condRel : 0),
          stmts: ei.stmts.map((s) => toParsedStatement(s, startOffset)),
        };
      }),
    ];
    const elseStmts = stmt.elseStmts?.map((s) => toParsedStatement(s, startOffset));
    return {
      kind: "if",
      condExpr: branches[0]?.condExpr,
      condStartByte: branches[0]?.condStartByte,
      rawText,
      startOffset,
      endOffset,
      branches,
      elseStmts,
      thenStmts: branches[0]?.stmts,
    };
  }

  if (stmt.kind === "for") {
    return {
      kind: "for",
      rawText,
      startOffset,
      endOffset,
      loopVars: stmt.loopVar ? [stmt.loopVar] : [],
      rangeExpr: stmt.rangeExpr,
      loopBody: (stmt.loopBody ?? []).map((s) => toParsedStatement(s, startOffset)),
    };
  }

  if (stmt.kind === "while") {
    return {
      kind: "while",
      condExpr: stmt.condExpr,
      rawText,
      startOffset,
      endOffset,
      whileBody: (stmt.whileBody ?? []).map((s) => toParsedStatement(s, startOffset)),
    };
  }

  if (stmt.kind === "when") {
    return {
      kind: "when",
      condExpr: stmt.condExpr,
      rawText,
      startOffset,
      endOffset,
      whenBody: (stmt.whenBody ?? []).map((s) => toParsedStatement(s, startOffset)),
    };
  }

  if (stmt.kind === "assignment") {
    const targetVar = stmt.targetVar ?? "";
    const baseVars = unwrapOuterParens(targetVar)
      .split(",")
      .map(extractBaseVarIdent)
      .filter((s): s is string => Boolean(s));
    const assignRel = rawText.indexOf(":=");
    return {
      kind: "assignment",
      targetVars: baseVars,
      targetVar,
      valExpr: stmt.valExpr ?? "",
      valStartByte: assignRel >= 0 ? startOffset + assignRel + 2 : startOffset,
      rawText,
      startOffset,
      endOffset,
    };
  }

  return {
    kind: stmt.kind === "call" ? "other" : stmt.kind,
    rawText,
    startOffset,
    endOffset,
  };
}

/**
 * Fallback parser for raw statement strings within an algorithm section,
 * delegating to the WASM CST-backed {@link ModelicaCFGLowerer.parseStatements}.
 */
function parseStatementsFromText(algText: string, algStartByte: number): ParsedStatement[] {
  return ModelicaCFGLowerer.parseStatements(algText, algStartByte).map((s) => toParsedStatement(s, algStartByte));
}

/**
 * Control Flow Analysis (CFA) implementation for Modelica classes and functions.
 *
 * Performs dataflow and definite-assignment analysis across `algorithm` sections
 * of non-partial functions to detect uninitialized reads (M5021), unassigned outputs (M5020),
 * and unreachable statements (M5022).
 *
 * @param _db - Salsa query database instance.
 * @param self - Symbol entry for the enclosing class or function definition.
 * @param cst - Root CST node of the class definition.
 * @returns Array of CFA lint diagnostics.
 */
export function runModelicaCfaAnalysis(_db: QueryDB, self: SymbolEntry, cst: unknown): LintResult[] {
  const results: LintResult[] = [];
  if (!isCfaCstNode(cst)) return results;

  const className: string = self.name || "Anonymous";

  // Check if class is a function
  const selfWithAttrs = self as SymbolEntry & { attributes?: Record<string, unknown> | undefined };
  const meta: Record<string, unknown> = self.metadata || selfWithAttrs.attributes || {};
  const words = tokenizeCommentStrippedWords(String(meta["classKind"] ?? meta["classPrefixes"] ?? ""));
  let isFunction = words.includes("function");
  let isPartial = words.includes("partial");

  if (cst) {
    for (const child of cst.children || []) {
      if (child.type === "class_prefixes") {
        const childWords = tokenizeCommentStrippedWords(child.text ?? "");
        if (childWords.includes("function")) {
          isFunction = true;
        }
        if (childWords.includes("partial")) {
          isPartial = true;
        }
      }
    }
    if (!isFunction || !isPartial) {
      const hdrWords = tokenizeCommentStrippedWords(cst.text ?? "");
      const optPrefixes = new Set(["encapsulated", "partial", "replaceable", "pure", "impure"]);
      let idx = 0;
      let sawPartial = false;
      while (idx < hdrWords.length && optPrefixes.has(hdrWords[idx]!)) {
        if (hdrWords[idx] === "partial") sawPartial = true;
        idx++;
      }
      if (hdrWords[idx] === "operator") idx++;
      const nextWord = hdrWords[idx] ?? "";
      const isFuncHeader = nextWord === "function" || nextWord.startsWith("function(");
      if (isFuncHeader) {
        if (!isFunction) isFunction = true;
        if (sawPartial) isPartial = true;
      }
    }
  }

  if (!isFunction || isPartial) return results;

  // 1. Extract variables (inputs, outputs, locals)
  const inputs = new Map<string, VariableInfo>();
  const outputs = new Map<string, VariableInfo>();
  const locals = new Map<string, VariableInfo>();

  const compClauses = findNodesByType(cst, "component_clause");
  for (const comp of compClauses) {
    const compText = comp.text || "";
    const typePrefixNode = (comp.children || []).find((c: CfaCstNode) => normType(c.type) === "typeprefix");
    const prefixWords = typePrefixNode
      ? tokenizeCommentStrippedWords(typePrefixNode.text || "")
      : tokenizeCommentStrippedWords(compText).slice(0, 6);
    const isInput = prefixWords.includes("input");
    const isOutput = prefixWords.includes("output");

    // Use CST component_declaration or declaration children to extract declared variable names.
    // Each component_declaration has an IDENT for the variable name.
    let compDecls = findNodesByType(comp, "component_declaration");
    if (compDecls.length === 0) {
      compDecls = findNodesByType(comp, "declaration");
    }
    const compStart = comp.startIndex ?? self.startOffset;

    if (compDecls.length > 0) {
      // CST-based extraction: reliable
      for (const decl of compDecls) {
        const declText = decl.text || "";
        // Find the first IDENT in the component_declaration
        let name: string | null = null;
        let nameStartByte = 0;
        let nameEndByte = 0;
        for (const child of decl.children || []) {
          const childType = normType(child.type);
          if (childType === "ident" || childType === "identifier") {
            name = child.text ?? null;
            nameStartByte = child.startIndex ?? decl.startIndex ?? compStart;
            nameEndByte = nameStartByte + (name?.length ?? 0);
            break;
          }
          if (childType === "declaration" && child.children) {
            for (const sub of child.children) {
              const subType = normType(sub.type);
              if (subType === "ident" || subType === "identifier") {
                name = sub.text ?? null;
                nameStartByte = sub.startIndex ?? child.startIndex ?? decl.startIndex ?? compStart;
                nameEndByte = nameStartByte + (name?.length ?? 0);
                break;
              }
            }
            if (name) break;
          }
        }
        // Fallback: extract first identifier from declaration text without regex
        if (!name) {
          let s = 0;
          while (s < declText.length && (declText[s] === " " || declText[s] === "\t")) s++;
          if (
            s < declText.length &&
            ((declText[s]! >= "a" && declText[s]! <= "z") ||
              (declText[s]! >= "A" && declText[s]! <= "Z") ||
              declText[s] === "_")
          ) {
            const idStart = s;
            s++;
            while (s < declText.length) {
              const c = declText[s]!;
              if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") {
                s++;
              } else {
                break;
              }
            }
            name = declText.slice(idStart, s);
            nameStartByte = (decl.startIndex ?? compStart) + idStart;
            nameEndByte = nameStartByte + (s - idStart);
          }
        }

        if (!name) continue;

        // Mask comments/strings so description strings containing '=', '(', or '[' do not
        // falsely register uninitialized scalar outputs as having defaults or arrays.
        const maskedDecl = maskCommentsAndStringsPreservingLength(declText);
        let hasDefault = false;
        let parenDepth = 0;
        for (let i = 0; i < maskedDecl.length; i++) {
          const ch = maskedDecl[i];
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          else if (
            ch === "=" &&
            parenDepth === 0 &&
            maskedDecl[i - 1] !== ":" &&
            maskedDecl[i - 1] !== "<" &&
            maskedDecl[i - 1] !== ">" &&
            maskedDecl[i - 1] !== "!"
          ) {
            hasDefault = true;
            break;
          }
        }
        // Also treat parenthesized modifiers as initialization (for record outputs)
        if (!hasDefault && maskedDecl.includes("(") && maskedDecl.includes("=")) {
          hasDefault = true;
        }

        const maskedComp = maskCommentsAndStringsPreservingLength(compText);
        const isArray = maskedDecl.includes("[") || maskedComp.includes("[");
        const info: VariableInfo = {
          name,
          isInput,
          isOutput,
          hasDefault: hasDefault || (isOutput && /\[\s*0\s*(?:,|\])/.test(compText)),
          isArray,
          startOffset: nameStartByte,
          endOffset: nameEndByte,
        };

        if (isInput) {
          inputs.set(name, info);
        } else if (isOutput) {
          outputs.set(name, info);
        } else {
          locals.set(name, info);
        }
      }
    } else {
      // Fallback: character scanner for when CST nodes aren't available.
      const maskedComp = maskCommentsAndStringsPreservingLength(compText);
      // Skip the type specifier by finding the first identifier after prefixes and type name.
      let seenTypeSpec = false;
      let pos = 0;
      const tLen = maskedComp.length;
      while (pos < tLen) {
        const ch = maskedComp[pos]!;
        if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
          const idStart = pos;
          pos++;
          while (pos < tLen) {
            const c = maskedComp[pos]!;
            if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") {
              pos++;
            } else {
              break;
            }
          }
          const name = maskedComp.slice(idStart, pos);
          if (
            name === "Real" ||
            name === "Integer" ||
            name === "Boolean" ||
            name === "String" ||
            name === "input" ||
            name === "output" ||
            name === "parameter" ||
            name === "constant"
          ) {
            continue;
          }

          // The first non-keyword identifier is the type specifier — skip it
          if (!seenTypeSpec) {
            seenTypeSpec = true;
            continue;
          }

          while (pos < tLen && (maskedComp[pos] === " " || maskedComp[pos] === "\t")) pos++;
          let isArray = false;
          if (pos < tLen && maskedComp[pos] === "[") {
            isArray = true;
            const closeBracket = maskedComp.indexOf("]", pos);
            pos = closeBracket !== -1 ? closeBracket + 1 : pos + 1;
          }
          while (pos < tLen && (maskedComp[pos] === " " || maskedComp[pos] === "\t")) pos++;
          let hasDefault = maskedComp.includes("=");
          if (pos < tLen && maskedComp[pos] === "=") {
            hasDefault = true;
            while (pos < tLen && maskedComp[pos] !== "," && maskedComp[pos] !== ";") pos++;
          }

          const startOffset = compStart + idStart;
          const endOffset = startOffset + name.length;
          const info: VariableInfo = {
            name,
            isInput,
            isOutput,
            hasDefault,
            isArray: isArray || maskedComp.includes("["),
            startOffset,
            endOffset,
          };

          if (isInput) {
            inputs.set(name, info);
          } else if (isOutput) {
            outputs.set(name, info);
          } else {
            locals.set(name, info);
          }
          continue;
        }
        pos++;
      }
    }
  }

  // 2. Find algorithm section(s)
  const algSections = findNodesByType(cst, "algorithm_section");

  if (algSections.length === 0) return results;

  // Track assigned variables
  const initialAssigned = new Set<string>();
  for (const inName of inputs.keys()) initialAssigned.add(inName);
  for (const [outName, outInfo] of outputs) {
    if (outInfo.hasDefault) initialAssigned.add(outName);
  }
  for (const [locName, locInfo] of locals) {
    if (locInfo.hasDefault) initialAssigned.add(locName);
  }

  // Set of all local & output variables whose reads must be checked for uninitialized access
  const monitoredVars = new Set<string>();
  for (const [name, info] of outputs) {
    if (!info.hasDefault) monitoredVars.add(name);
  }
  for (const [name, info] of locals) {
    if (!info.hasDefault) monitoredVars.add(name);
  }

  // Helper to check uninitialized reads in an expression string
  const checkExprReads = (
    expr: string,
    exprStartByte: number,
    currentAssigned: Set<string>,
    activeLoopVars: Set<string> = new Set(),
  ) => {
    const maskedExpr = maskCommentsAndStringsPreservingLength(expr);
    for (let idx = 0; idx < maskedExpr.length;) {
      if (!isAsciiIdentStart(maskedExpr.charCodeAt(idx))) {
        idx++;
        continue;
      }
      let end = idx + 1;
      while (end < maskedExpr.length && isAsciiIdentContinue(maskedExpr.charCodeAt(end))) {
        end++;
      }
      const varName = maskedExpr.slice(idx, end);
      let prevIdx = idx - 1;
      while (prevIdx >= 0 && isAsciiWhitespaceCode(maskedExpr.charCodeAt(prevIdx))) {
        prevIdx--;
      }
      let afterIdx = end;
      while (afterIdx < maskedExpr.length && isAsciiWhitespaceCode(maskedExpr.charCodeAt(afterIdx))) {
        afterIdx++;
      }
      const isMember = prevIdx >= 0 && maskedExpr[prevIdx] === ".";
      const isNamedArg =
        afterIdx < maskedExpr.length && maskedExpr[afterIdx] === "=" && maskedExpr[afterIdx + 1] !== "=";
      if (
        !activeLoopVars.has(varName) &&
        !isMember &&
        !isNamedArg &&
        monitoredVars.has(varName) &&
        !currentAssigned.has(varName)
      ) {
        const sByte = exprStartByte + idx;
        const eByte = exprStartByte + end;
        results.push(
          warning(ModelicaErrorCode.UNINITIALIZED_VARIABLE_READ.message(varName), {
            startOffset: sByte,
            endOffset: eByte,
            code: ModelicaErrorCode.UNINITIALIZED_VARIABLE_READ.code,
          }),
        );
      }
      idx = end;
    }
  };

  const allAssignedEver = new Set<string>();

  // CFA traversal
  /**
   * Dataflow state returned after analyzing a sequence of statements.
   *
   * Exits are tracked separately so that `break` (which leaves only the innermost loop) is not
   * conflated with `return`/abort (which leave the function):
   * - `endReachable`: some path falls through the end of the block.
   * - `breakStates`: must-assigned sets at each `break` that escapes this block (consumed by the
   *   innermost enclosing loop).
   * A block "always returns" iff `!endReachable && breakStates.length === 0`.
   */
  interface StmtAnalysis {
    /** Set of variables guaranteed to be assigned when control falls through the end of the block. */
    assigned: Set<string>;
    /** Whether at least one control-flow path reaches the end of the block normally. */
    endReachable: boolean;
    /** Must-assigned sets at every `break` escaping the block. */
    breakStates: Set<string>[];
  }

  const blockAlwaysReturns = (r: StmtAnalysis): boolean => !r.endReachable && r.breakStates.length === 0;

  const analyzeStatements = (
    stmts: ParsedStatement[],
    inAssigned: Set<string>,
    activeLoopVars: Set<string> = new Set(),
  ): StmtAnalysis => {
    let cur = new Set(inAssigned);
    let reachable = true;
    const breakStates: Set<string>[] = [];

    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i]!;

      if (!reachable) {
        // M5022: Unreachable statement — reported once, at the first unreachable statement of the block.
        results.push(
          warning(ModelicaErrorCode.UNREACHABLE_STATEMENT.message(), {
            startOffset: stmt.startOffset,
            endOffset: stmt.endOffset,
            code: ModelicaErrorCode.UNREACHABLE_STATEMENT.code,
          }),
        );
        break;
      }

      if (stmt.kind === "return") {
        // Check if all outputs are assigned at return point
        if (isFunction) {
          for (const [outName, outInfo] of outputs) {
            const isAssigned = cur.has(outName) || (outInfo.isArray && allAssignedEver.has(outName));
            if (!isAssigned) {
              results.push(
                error(ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.message(outName, className), {
                  startOffset: stmt.startOffset,
                  endOffset: stmt.endOffset,
                  code: ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.code,
                }),
              );
            }
          }
        }
        reachable = false;
      } else if (stmt.kind === "break") {
        breakStates.push(new Set(cur));
        reachable = false;
      } else if (stmt.kind === "assignment") {
        // Check reads on RHS first
        if (stmt.valExpr) {
          let fallbackStart = stmt.startOffset;
          const assignIdx = stmt.rawText.indexOf(":=");
          if (assignIdx >= 0) {
            let k = assignIdx + 2;
            while (k < stmt.rawText.length && isAsciiWhitespaceCode(stmt.rawText.charCodeAt(k))) {
              k++;
            }
            fallbackStart = stmt.startOffset + k;
          }
          checkExprReads(stmt.valExpr, stmt.valStartByte ?? fallbackStart, cur, activeLoopVars);
        }

        // Add targets to assigned
        if (stmt.targetVars && stmt.targetVars.length > 0) {
          for (const v of stmt.targetVars) {
            if (v) {
              cur.add(v);
              allAssignedEver.add(v);
            }
          }
        } else if (stmt.targetVar) {
          const baseIdent = extractBaseVarIdent(stmt.targetVar) || stmt.targetVar.trim();
          if (baseIdent) {
            cur.add(baseIdent);
            allAssignedEver.add(baseIdent);
          }
        }
      } else if (stmt.kind === "if") {
        const branches =
          stmt.branches && stmt.branches.length > 0
            ? stmt.branches
            : stmt.thenStmts
              ? [
                  {
                    condExpr: stmt.condExpr,
                    condStartByte: stmt.condStartByte ?? stmt.startOffset,
                    stmts: stmt.thenStmts,
                  },
                ]
              : [];
        const elseStmts = stmt.elseStmts;

        const branchResults: StmtAnalysis[] = [];
        let hasStaticallyTrueBranch = false;

        for (const branch of branches) {
          const cond = branch.condExpr?.trim();
          if (branch.condExpr) {
            checkExprReads(branch.condExpr, branch.condStartByte ?? stmt.startOffset, cur, activeLoopVars);
          }
          // A literal `false` guard can never be taken: its body contributes no paths.
          if (cond === "false") continue;
          if (cond === "true") hasStaticallyTrueBranch = true;
          branchResults.push(analyzeStatements(branch.stmts, cur, activeLoopVars));
          if (hasStaticallyTrueBranch) break;
        }

        if (elseStmts !== undefined && !hasStaticallyTrueBranch) {
          branchResults.push(analyzeStatements(elseStmts, cur, activeLoopVars));
        }
        // Without an else (or statically true guard) the implicit empty else falls through with `cur`.
        const hasImplicitElse = elseStmts === undefined && !hasStaticallyTrueBranch;

        for (const r of branchResults) breakStates.push(...r.breakStates);

        const fallThrough = branchResults.filter((r) => r.endReachable).map((r) => r.assigned);
        if (hasImplicitElse) fallThrough.push(cur);

        if (fallThrough.length === 0) {
          reachable = false;
        } else {
          let intersected = new Set(fallThrough[0]!);
          for (let k = 1; k < fallThrough.length; k++) {
            intersected = intersectSets(intersected, fallThrough[k]!);
          }
          cur = intersected;
        }
      } else if (stmt.kind === "for") {
        if (stmt.rangeExpr) {
          checkExprReads(stmt.rangeExpr, stmt.rangeStartByte ?? stmt.startOffset, cur, activeLoopVars);
        }
        const loopVars = new Set(activeLoopVars);
        if (stmt.loopVars) {
          for (const lv of stmt.loopVars) loopVars.add(lv);
        }
        // Detect provably empty literal ranges (`lo:hi` with `lo > hi` or `{}`): body never runs.
        const rawRange = (stmt.rangeExpr ?? "").trim();
        let isEmptyRange = rawRange === "{}";
        if (!isEmptyRange) {
          const rangeParts = rawRange.match(/^(-?\d+)\s*:\s*(-?\d+)$/);
          if (rangeParts) {
            const lo = Number(rangeParts[1]);
            const hi = Number(rangeParts[2]);
            if (Number.isFinite(lo) && Number.isFinite(hi) && lo > hi) {
              isEmptyRange = true;
            }
          }
        }
        const loopRes = analyzeStatements(stmt.loopBody || [], cur, loopVars);
        if (!isEmptyRange) {
          for (const a of loopRes.assigned) {
            if (!loopVars.has(a)) {
              cur.add(a);
              allAssignedEver.add(a);
            }
          }
        }
      } else if (stmt.kind === "while") {
        if (stmt.condExpr) {
          checkExprReads(stmt.condExpr, stmt.condStartByte ?? stmt.startOffset, cur, activeLoopVars);
        }
        const whileRes = analyzeStatements(stmt.whileBody || [], cur, activeLoopVars);
        for (const a of whileRes.assigned) allAssignedEver.add(a);
        for (const bs of whileRes.breakStates) for (const a of bs) allAssignedEver.add(a);

        if (stmt.condExpr?.trim() === "true") {
          // `while true` only exits through `break`; the state after the loop is the meet of all break states.
          if (whileRes.breakStates.length === 0) {
            reachable = false;
          } else {
            let intersected = new Set(whileRes.breakStates[0]!);
            for (let k = 1; k < whileRes.breakStates.length; k++) {
              intersected = intersectSets(intersected, whileRes.breakStates[k]!);
            }
            cur = intersected;
          }
        }
        // A general `while (cond)` loop may execute 0 times when `cond` starts false,
        // so body assignments are already recorded in `allAssignedEver` but not added to `cur`.
      } else if (stmt.kind === "when") {
        const branches =
          stmt.branches && stmt.branches.length > 0
            ? stmt.branches
            : [{ condExpr: stmt.condExpr ?? "", condStartByte: stmt.condStartByte, stmts: stmt.whenBody ?? [] }];
        for (const br of branches) {
          if (br.condExpr) {
            checkExprReads(br.condExpr, br.condStartByte ?? stmt.startOffset, cur, activeLoopVars);
          }
          const brRes = analyzeStatements(br.stmts, cur, activeLoopVars);
          for (const a of brRes.assigned) {
            cur.add(a);
            allAssignedEver.add(a);
          }
        }
      } else {
        // Other statement
        checkExprReads(stmt.rawText, stmt.startOffset, cur, activeLoopVars);
        if (isAbortCallStatement(stmt.rawText)) {
          reachable = false;
        }
      }
    }

    return { assigned: cur, endReachable: reachable, breakStates };
  };

  let currentAssigned = new Set(initialAssigned);
  let hasNonEmptySection = false;
  let alwaysReturns = false;

  for (const alg of algSections) {
    const algStart = alg.startIndex ?? self.startOffset;
    const stmts = extractStatementsFromCst(alg, algStart);
    if (stmts.length === 0) continue;
    hasNonEmptySection = true;
    const sectionRes = analyzeStatements(stmts, currentAssigned);
    currentAssigned = sectionRes.assigned;
    if (blockAlwaysReturns(sectionRes)) {
      alwaysReturns = true;
      break;
    }
  }

  // At the end of function execution: check all outputs. Array outputs are tracked coarsely
  // (element-wise assignment is not modelled), so any assignment to them counts.
  if (isFunction && hasNonEmptySection && !alwaysReturns) {
    for (const [outName, outInfo] of outputs) {
      const isAssigned = currentAssigned.has(outName) || (outInfo.isArray && allAssignedEver.has(outName));
      if (!isAssigned) {
        results.push(
          error(ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.message(outName, className), {
            startOffset: outInfo.startOffset,
            endOffset: outInfo.endOffset,
            code: ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.code,
          }),
        );
      }
    }
  }

  return results;
}

/**
 * Placeholder CST lint map for CFA rules (CFA diagnostics are executed via Salsa `lint__cfaAnalysis` query hook).
 */
export const modelicaCfaLints: Record<string, CompilerLint> = {};
