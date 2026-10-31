// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Direct Lowering of SysML v2 Calculations and Action Scripts
 * into the linear-memory DAEBuilder arena.
 *
 * Compiles SysML v2 imperative behaviors (action assignments, while loops, if-else,
 * calculations) directly into `DAEBuilder` integer IDs (ExprId, StmtId), enabling:
 *   1. Zero-GC execution via `executeArenaStatements`.
 *   2. Seamless integration into the continuous/discrete hybrid simulation pipeline.
 *   3. Expression autodiff tape construction.
 */

import {
  Causality,
  DAEBuilder,
  executeArenaStatements,
  initBltWasm,
  StmtKind,
  Variability,
  VarType,
} from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParserSync } from "../src-gen/bindings.js";
import {
  lowerSysmlExpr,
  prefixSysmlExpression,
  SysML2CstFlattener,
  type SysML2Token,
  type SysmlCstNode,
  SysmlExprParser,
  tokenizeSysml,
} from "./flattener/cst-lowerer.js";

export { lowerSysmlExpr, prefixSysmlExpression, SysmlExprParser, tokenizeSysml };
export type { SysML2Token };

export type SysmlWasmParser = NonNullable<ReturnType<typeof createWasmParserSync>>["parser"] & {
  parse(text: string): { rootNode?: SysmlCstNode | null | undefined } | null | undefined;
};

let cachedSysmlParser: SysmlWasmParser | null = null;
/**
 * Lazily loads and caches the synchronous WebAssembly GLR parser for SysML v2 (`parser.wasm`).
 *
 * @returns Initialized WASM parser instance or `null` if the binary is unavailable.
 */
export function getSysmlParser(): SysmlWasmParser | null {
  if (cachedSysmlParser) return cachedSysmlParser;
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
      path.resolve(currentDir, "../dist/parser.wasm"),
      path.resolve(currentDir, "../parser.wasm"),
      path.resolve(currentDir, "../../dist/parser.wasm"),
      path.resolve(currentDir, "../../parser.wasm"),
    ];
    const wasmPath = candidatePaths.find((p) => fs.existsSync(p));
    if (wasmPath) {
      cachedSysmlParser = (createWasmParserSync(wasmPath)?.parser as SysmlWasmParser | undefined) ?? null;
    }
  } catch {
    // Parser fallback
  }
  return cachedSysmlParser;
}

/**
 * Result of lowering an imperative SysML v2 `action` or `calc` block into `DAEBuilder` statements.
 */
export interface LoweredActionDae {
  /** Linear-memory `DAEBuilder` arena containing variables, expressions, and statements. */
  arena: DAEBuilder;
  /** Declared action or calculation name. */
  name: string;
  /** Ordered list of `in` pin/parameter names. */
  inputs: string[];
  /** Ordered list of `out` or `return` parameter names. */
  outputs: string[];
  /** Intermediate local variables synthesized from assignments. */
  locals: string[];
  /** Starting statement index inside `arena` for this action's body. */
  startStmtIdx: number;
  /** Total number of statement slots emitted for this action. */
  stmtCount: number;
}

/**
 * Result of lowering a declarative SysML v2 `constraint` or `part` model into `DAEBuilder` equations.
 */
export interface LoweredConstraintDae {
  /** Linear-memory `DAEBuilder` arena containing variables and DAE equations. */
  arena: DAEBuilder;
  /** Resolved root model or constraint definition name. */
  name: string;
  /** Flattened parameter names. */
  parameters: string[];
  /** Flattened continuous state and algebraic variable names. */
  states: string[];
  /** Time-derivative expressions (`der(x)`) present in the equations. */
  derivatives: string[];
  /** Number of equations added to `arena`. */
  eqCount: number;
}

type ParsedAstStmt =
  | { kind: "assign"; target: string; exprTokens: SysML2Token[] }
  | { kind: "while"; condTokens: SysML2Token[]; body: ParsedAstStmt[] }
  | { kind: "if"; condTokens: SysML2Token[]; thenBody: ParsedAstStmt[]; elseBody?: ParsedAstStmt[] | undefined }
  | { kind: "return"; exprTokens?: SysML2Token[] | undefined };

/**
 * Compiles SysML v2 calculations, action scripts, and physical part/constraint equations
 * directly into linear-memory `DAEBuilder` arenas for zero-GC execution and DAE simulation.
 */
export class SysML2DaeLowerer {
  /**
   * Lowers an expression string into an arena ExprId.
   */
  public static lowerExpression(exprText: string, arena: DAEBuilder): number {
    return lowerSysmlExpr(exprText, arena);
  }

  /**
   * Lowers a pre-tokenized expression into an arena ExprId.
   */
  private static lowerTokens(tokens: SysML2Token[], arena: DAEBuilder): number {
    if (tokens.length === 0) return arena.addRealLiteral(0);
    const parser = new SysmlExprParser(tokens, arena);
    return parser.parse();
  }

  /**
   * Lowers a complete SysML v2 Action or Calculation definition (or all action/calc blocks
   * embedded in a hybrid model) into a DAEBuilder.
   */
  public static async lowerAction(sysmlSource: string, existingArena?: DAEBuilder): Promise<LoweredActionDae> {
    try {
      await initBltWasm();
    } catch {}

    const arena = existingArena ?? new DAEBuilder();

    // Extract all action/calc blocks in the source (supports standalone or embedded in part/package)
    const blockHeaderRegex = /\b(?:action|calc)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
    const actionBlocks: { name: string; bodyText: string }[] = [];
    let bm: RegExpExecArray | null;
    while ((bm = blockHeaderRegex.exec(sysmlSource)) !== null) {
      const blockName = bm[1]!;
      const openBrace = sysmlSource.indexOf("{", bm.index);
      if (openBrace !== -1) {
        const { body, endPos } = this.extractBraceBlock(sysmlSource, openBrace);
        actionBlocks.push({ name: blockName, bodyText: body });
        blockHeaderRegex.lastIndex = endPos;
      }
    }

    if (actionBlocks.length === 0) {
      const nameMatch = /(?:action|calc)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(sysmlSource);
      const fallbackName = nameMatch ? nameMatch[1]! : "AnonymousAction";
      const openBrace = sysmlSource.indexOf("{");
      const closeBrace = sysmlSource.lastIndexOf("}");
      const bodyText =
        openBrace !== -1 && closeBrace > openBrace ? sysmlSource.slice(openBrace + 1, closeBrace) : sysmlSource;
      actionBlocks.push({ name: fallbackName, bodyText });
    }

    const name = actionBlocks[0]!.name;
    const inputs: string[] = [];
    const outputs: string[] = [];
    const locals: string[] = [];

    const startStmtIdx = arena.stmtCount;

    for (const block of actionBlocks) {
      const { bodyText } = block;

      // 1. Extract pins / parameters from this action/calc block
      const pinRegex = /\b(in|out)\s+(?:item\s+|attribute\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_.:]+))?/g;
      let pm: RegExpExecArray | null;
      while ((pm = pinRegex.exec(bodyText)) !== null) {
        const dir = pm[1];
        const pName = pm[2]!;
        const isInput = dir === "in";

        if (isInput) {
          if (!inputs.includes(pName)) inputs.push(pName);
          if (arena.lookupVariable(pName) === -1) {
            arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Input);
          }
        } else {
          if (!outputs.includes(pName)) outputs.push(pName);
          if (arena.lookupVariable(pName) === -1) {
            arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Output);
          }
        }
      }

      // Return parameter declaration in calc def: return [item|attribute] <name> : <type>;
      const retParamRegex =
        /\breturn\s+(?:(?:item|attribute)\s+([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[A-Za-z_][A-Za-z0-9_.:]*)/g;
      let rpm: RegExpExecArray | null;
      while ((rpm = retParamRegex.exec(bodyText)) !== null) {
        const retName = (rpm[1] ?? rpm[2])!;
        if (!outputs.includes(retName)) {
          outputs.push(retName);
        }
        if (arena.lookupVariable(retName) === -1) {
          arena.addVariable(retName, VarType.Real, Variability.Continuous, Causality.Output);
        }
      }

      // 2. Parse statements into structured AST via recursive descent
      const ast = this.parseStatementsToAst(bodyText);

      // If a calc/action has a return expression (e.g. `return a + b;`) without a declared output pin,
      // synthesize a default output variable so `execute` can return the computed value.
      if (outputs.length === 0 && this.hasValuedReturn(ast)) {
        const defaultOut = "result";
        outputs.push(defaultOut);
        if (arena.lookupVariable(defaultOut) === -1) {
          arena.addVariable(defaultOut, VarType.Real, Variability.Continuous, Causality.Output);
        }
      }

      // 3. Lower AST to arena
      this.emitAstStatements(ast, arena, locals, outputs, inputs);
    }

    const stmtCount = arena.stmtCount - startStmtIdx;

    return {
      arena,
      name,
      inputs,
      outputs,
      locals,
      startStmtIdx,
      stmtCount,
    };
  }

  private static hasValuedReturn(stmts: ParsedAstStmt[]): boolean {
    for (const s of stmts) {
      if (s.kind === "return" && s.exprTokens && s.exprTokens.length > 0) return true;
      if (s.kind === "while" && this.hasValuedReturn(s.body)) return true;
      if (s.kind === "if") {
        if (this.hasValuedReturn(s.thenBody)) return true;
        if (s.elseBody && this.hasValuedReturn(s.elseBody)) return true;
      }
    }
    return false;
  }

  /**
   * Parses imperative action/calculation statements (`while`, `if`/`else`, `return`, `assign`)
   * from a body string into a structured statement AST using recursive-descent over tokens.
   */
  private static parseStatementsToAst(bodyText: string): ParsedAstStmt[] {
    const tokens = tokenizeSysml(bodyText);
    const { stmts } = this.parseBlockStatements(tokens, 0, false);
    return stmts;
  }

  /**
   * Recursive-descent block statement parser over `SysML2Token[]`.
   */
  private static parseBlockStatements(
    tokens: SysML2Token[],
    startPos: number,
    stopAtCloseBrace: boolean,
  ): { stmts: ParsedAstStmt[]; nextPos: number } {
    const stmts: ParsedAstStmt[] = [];
    let pos = startPos;
    const len = tokens.length;

    while (pos < len) {
      const t = tokens[pos]!;

      // Skip stray semicolons
      if (t.type === "semi") {
        pos++;
        continue;
      }

      // End of nested block
      if (t.type === "paren" && t.val === "}") {
        if (stopAtCloseBrace) {
          return { stmts, nextPos: pos + 1 };
        }
        pos++;
        continue;
      }

      // Skip pin declarations: `in ...;` or `out ...;`
      if (t.type === "kw" && (t.val === "in" || t.val === "out")) {
        while (pos < len && tokens[pos]!.type !== "semi") pos++;
        if (pos < len && tokens[pos]!.type === "semi") pos++;
        continue;
      }

      // 1. While statement: `while (cond) { ... }` or `while cond { ... }`
      if (t.type === "kw" && (t.val === "while" || t.val === "loop")) {
        pos++;
        if (pos < len && tokens[pos]!.type === "kw" && tokens[pos]!.val === "while") {
          pos++;
        }
        const { condTokens, nextPos: afterCond } = this.parseConditionTokens(tokens, pos);
        pos = afterCond;
        const { body, nextPos: afterBody } = this.parseBodyBlockOrSingleStmt(tokens, pos);
        pos = afterBody;
        stmts.push({ kind: "while", condTokens, body });
        continue;
      }

      // 2. If / Else-If / Else statement: `if (cond) { ... } [else if (...) { ... }] [else { ... }]`
      if (t.type === "kw" && t.val === "if") {
        const { stmt, nextPos } = this.parseIfStatement(tokens, pos);
        stmts.push(stmt);
        pos = nextPos;
        continue;
      }

      // 3. Return statement or return parameter declaration
      if (t.type === "kw" && t.val === "return") {
        pos++;
        let hadDeclPrefix = false;
        if (
          pos < len &&
          tokens[pos]!.type === "kw" &&
          (tokens[pos]!.val === "item" || tokens[pos]!.val === "attribute")
        ) {
          hadDeclPrefix = true;
          pos++;
        }

        // Check if this is `return <name> : <Type> [= <expr>];`
        if (
          pos < len &&
          tokens[pos]!.type === "ident" &&
          (hadDeclPrefix || (pos + 1 < len && tokens[pos + 1]!.type === "op" && tokens[pos + 1]!.val === ":"))
        ) {
          const retVarName = tokens[pos]!.val;
          pos++;
          if (pos < len && tokens[pos]!.type === "op" && tokens[pos]!.val === ":") {
            pos++;
            // Skip type specifier tokens (includingPkg::Type)
            while (
              pos < len &&
              tokens[pos]!.type !== "semi" &&
              !(tokens[pos]!.type === "op" && (tokens[pos]!.val === "=" || tokens[pos]!.val === ":="))
            ) {
              pos++;
            }
          }
          if (pos < len && tokens[pos]!.type === "op" && (tokens[pos]!.val === "=" || tokens[pos]!.val === ":=")) {
            pos++;
            const { exprTokens, nextPos: afterExpr } = this.collectExprTokensUntilSemiOrBrace(tokens, pos);
            pos = afterExpr;
            if (exprTokens.length > 0) {
              stmts.push({ kind: "assign", target: retVarName, exprTokens });
            }
          } else if (pos < len && tokens[pos]!.type === "semi") {
            pos++;
          }
          continue;
        }

        // Value return: `return <expr>;` or `return;`
        const { exprTokens, nextPos: afterRet } = this.collectExprTokensUntilSemiOrBrace(tokens, pos);
        pos = afterRet;
        stmts.push({
          kind: "return",
          exprTokens: exprTokens.length > 0 ? exprTokens : undefined,
        });
        continue;
      }

      // 4. Assignment or local attribute/item binding:
      //    `[assign | attribute | item] <ident> [: <Type>] (:= | =) <expr>;`
      let scanPos = pos;
      let hasAssignPrefix = false;
      if (
        tokens[scanPos]!.type === "kw" &&
        (tokens[scanPos]!.val === "assign" || tokens[scanPos]!.val === "attribute" || tokens[scanPos]!.val === "item")
      ) {
        hasAssignPrefix = true;
        scanPos++;
        if (
          scanPos < len &&
          tokens[scanPos]!.type === "kw" &&
          (tokens[scanPos]!.val === "attribute" || tokens[scanPos]!.val === "item")
        ) {
          scanPos++;
        }
      }

      if (scanPos < len && tokens[scanPos]!.type === "ident") {
        const targetName = tokens[scanPos]!.val;
        let afterTarget = scanPos + 1;

        // Optional `: Type` annotation
        if (afterTarget < len && tokens[afterTarget]!.type === "op" && tokens[afterTarget]!.val === ":") {
          afterTarget++;
          while (
            afterTarget < len &&
            tokens[afterTarget]!.type !== "semi" &&
            !(
              tokens[afterTarget]!.type === "op" &&
              (tokens[afterTarget]!.val === "=" || tokens[afterTarget]!.val === ":=")
            )
          ) {
            afterTarget++;
          }
        }

        if (
          afterTarget < len &&
          tokens[afterTarget]!.type === "op" &&
          (tokens[afterTarget]!.val === ":=" || tokens[afterTarget]!.val === "=")
        ) {
          const exprStart = afterTarget + 1;
          const { exprTokens, nextPos: afterExpr } = this.collectExprTokensUntilSemiOrBrace(tokens, exprStart);
          if (exprTokens.length > 0) {
            stmts.push({ kind: "assign", target: targetName, exprTokens });
          }
          pos = afterExpr;
          continue;
        } else if (hasAssignPrefix) {
          // Local attribute/item declaration without initializer; skip to `;`
          while (afterTarget < len && tokens[afterTarget]!.type !== "semi") afterTarget++;
          if (afterTarget < len && tokens[afterTarget]!.type === "semi") afterTarget++;
          pos = afterTarget;
          continue;
        }
      }

      // 5. Fallback: skip to next semicolon or closing brace so parser always makes progress
      const { exprTokens, nextPos: nextAfter } = this.collectExprTokensUntilSemiOrBrace(tokens, pos);
      if (nextAfter > pos) {
        // If this is a trailing bare result expression at the end of a calc block, treat as return
        const isAtBlockEnd =
          nextAfter >= len || (tokens[nextAfter]?.type === "paren" && tokens[nextAfter]?.val === "}");
        if (isAtBlockEnd && exprTokens.length > 0) {
          stmts.push({ kind: "return", exprTokens });
        }
        pos = nextAfter;
      } else {
        pos++;
      }
    }

    return { stmts, nextPos: pos };
  }

  /**
   * Parses an `if (cond) { ... } [else if (...) { ... } | else { ... }]` construct recursively.
   */
  private static parseIfStatement(tokens: SysML2Token[], ifPos: number): { stmt: ParsedAstStmt; nextPos: number } {
    let pos = ifPos + 1; // consume 'if'
    const { condTokens, nextPos: afterCond } = this.parseConditionTokens(tokens, pos);
    pos = afterCond;

    // Optional 'then' keyword in KerML/SysML conditional statements
    if (pos < tokens.length && tokens[pos]!.type === "ident" && tokens[pos]!.val === "then") {
      pos++;
    }

    const { body: thenBody, nextPos: afterThen } = this.parseBodyBlockOrSingleStmt(tokens, pos);
    pos = afterThen;

    let elseBody: ParsedAstStmt[] | undefined;
    if (pos < tokens.length && tokens[pos]!.type === "kw" && tokens[pos]!.val === "else") {
      pos++; // consume 'else'
      if (pos < tokens.length && tokens[pos]!.type === "kw" && tokens[pos]!.val === "if") {
        // Chained `else if (...) { ... }`
        const { stmt: nestedIf, nextPos: afterNestedIf } = this.parseIfStatement(tokens, pos);
        elseBody = [nestedIf];
        pos = afterNestedIf;
      } else {
        const { body: parsedElse, nextPos: afterElse } = this.parseBodyBlockOrSingleStmt(tokens, pos);
        elseBody = parsedElse;
        pos = afterElse;
      }
    }

    return {
      stmt: { kind: "if", condTokens, thenBody, elseBody },
      nextPos: pos,
    };
  }

  /**
   * Extracts condition expression tokens from `( ... )` or up to `{` / `then`.
   */
  private static parseConditionTokens(
    tokens: SysML2Token[],
    startPos: number,
  ): { condTokens: SysML2Token[]; nextPos: number } {
    const condTokens: SysML2Token[] = [];
    let pos = startPos;
    const len = tokens.length;

    if (pos < len && tokens[pos]!.type === "paren" && tokens[pos]!.val === "(") {
      let depth = 1;
      pos++; // consume outer '('
      while (pos < len && depth > 0) {
        const tk = tokens[pos]!;
        if (tk.type === "paren" && tk.val === "(") {
          depth++;
          condTokens.push(tk);
        } else if (tk.type === "paren" && tk.val === ")") {
          depth--;
          if (depth > 0) condTokens.push(tk);
        } else {
          condTokens.push(tk);
        }
        pos++;
      }
      // If additional boolean operators follow `( ... )` before `{`, e.g. `(a > 0) && (b > 0) {`
      while (
        pos < len &&
        !(tokens[pos]!.type === "paren" && tokens[pos]!.val === "{") &&
        !(tokens[pos]!.type === "ident" && tokens[pos]!.val === "then")
      ) {
        condTokens.push(tokens[pos]!);
        pos++;
      }
      return { condTokens, nextPos: pos };
    }

    while (
      pos < len &&
      !(tokens[pos]!.type === "paren" && tokens[pos]!.val === "{") &&
      !(tokens[pos]!.type === "ident" && tokens[pos]!.val === "then") &&
      tokens[pos]!.type !== "semi"
    ) {
      condTokens.push(tokens[pos]!);
      pos++;
    }
    return { condTokens, nextPos: pos };
  }

  /**
   * Parses a `{ ... }` brace-delimited statement block or a single statement if unbraced.
   */
  private static parseBodyBlockOrSingleStmt(
    tokens: SysML2Token[],
    startPos: number,
  ): { body: ParsedAstStmt[]; nextPos: number } {
    let pos = startPos;
    const len = tokens.length;
    if (pos < len && tokens[pos]!.type === "paren" && tokens[pos]!.val === "{") {
      pos++; // consume '{'
      const { stmts, nextPos } = this.parseBlockStatements(tokens, pos, true);
      return { body: stmts, nextPos };
    }
    // Single statement fallback
    const { stmts, nextPos } = this.parseBlockStatements(
      tokens.slice(0, this.findSingleStmtEnd(tokens, pos)),
      pos,
      false,
    );
    return { body: stmts, nextPos };
  }

  private static findSingleStmtEnd(tokens: SysML2Token[], startPos: number): number {
    let pos = startPos;
    let parenDepth = 0;
    while (pos < tokens.length) {
      const tk = tokens[pos]!;
      if (tk.type === "paren" && (tk.val === "(" || tk.val === "{")) parenDepth++;
      else if (tk.type === "paren" && (tk.val === ")" || tk.val === "}")) {
        if (parenDepth === 0) return pos;
        parenDepth--;
      } else if (tk.type === "semi" && parenDepth === 0) {
        return pos + 1;
      }
      pos++;
    }
    return pos;
  }

  /**
   * Collects expression tokens until a top-level `;` or closing `}`.
   */
  private static collectExprTokensUntilSemiOrBrace(
    tokens: SysML2Token[],
    startPos: number,
  ): { exprTokens: SysML2Token[]; nextPos: number } {
    const exprTokens: SysML2Token[] = [];
    let pos = startPos;
    let parenDepth = 0;
    const len = tokens.length;

    while (pos < len) {
      const tk = tokens[pos]!;
      if (tk.type === "paren" && tk.val === "(") {
        parenDepth++;
        exprTokens.push(tk);
        pos++;
      } else if (tk.type === "paren" && tk.val === ")") {
        if (parenDepth > 0) parenDepth--;
        exprTokens.push(tk);
        pos++;
      } else if (tk.type === "semi" && parenDepth === 0) {
        pos++; // consume ';'
        break;
      } else if (tk.type === "paren" && (tk.val === "}" || tk.val === "{") && parenDepth === 0) {
        break;
      } else {
        exprTokens.push(tk);
        pos++;
      }
    }

    return { exprTokens, nextPos: pos };
  }

  /**
   * Computes the number of direct logical statements emitted by `emitAstStatements` for a block.
   * Note: `executeArenaStatements` (`skipArenaStatement` / `countArenaStatementSlots`) expects
   * `StmtKind.While`, `StmtKind.If`, and `StmtKind.Block` headers to store the count of direct
   * logical child statements in that block (each nested `If` or `While` counts as 1 logical
   * statement because `skipArenaStatement` skips its entire nested subtree in one step).
   */
  private static countDirectStatements(stmts: ParsedAstStmt[], outputs: string[]): number {
    let count = 0;
    for (const s of stmts) {
      if (s.kind === "assign" || s.kind === "while" || s.kind === "if") {
        count += 1;
      } else if (s.kind === "return") {
        if (s.exprTokens && s.exprTokens.length > 0 && outputs.length > 0) {
          // Valued return emits an assignment to the output variable followed by Return
          count += 2;
        } else {
          count += 1;
        }
      }
    }
    return count;
  }

  /**
   * Emits parsed statements into `DAEBuilder`'s linear statement table (`stmtData`).
   */
  private static emitAstStatements(
    stmts: ParsedAstStmt[],
    arena: DAEBuilder,
    locals: string[],
    outputs: string[],
    inputs: string[] = [],
  ): void {
    for (const stmt of stmts) {
      if (stmt.kind === "assign") {
        const target = stmt.target;
        if (!locals.includes(target) && !outputs.includes(target) && !inputs.includes(target)) {
          locals.push(target);
        }
        if (arena.lookupVariable(target) === -1) {
          arena.addVariable(target, VarType.Real, Variability.Continuous, Causality.Local);
        }

        const targetNameId = arena.interner.intern(target);
        const targetExprId = arena.addName(targetNameId);
        const srcExprId = this.lowerTokens(stmt.exprTokens, arena);
        arena.addAssignmentStmt(targetExprId, srcExprId);
      } else if (stmt.kind === "while") {
        const condId = this.lowerTokens(stmt.condTokens, arena);
        const bodyCount = this.countDirectStatements(stmt.body, outputs);
        arena.addStatement(StmtKind.While, condId, bodyCount);
        this.emitAstStatements(stmt.body, arena, locals, outputs, inputs);
      } else if (stmt.kind === "if") {
        const condId = this.lowerTokens(stmt.condTokens, arena);
        const thenCount = this.countDirectStatements(stmt.thenBody, outputs);
        const hasElse = Boolean(stmt.elseBody && stmt.elseBody.length > 0);
        const branchCount = hasElse ? 1 : 0;

        arena.addStatement(StmtKind.If, condId, thenCount, branchCount);
        this.emitAstStatements(stmt.thenBody, arena, locals, outputs, inputs);

        if (hasElse && stmt.elseBody) {
          const elseCount = this.countDirectStatements(stmt.elseBody, outputs);
          arena.addStatement(StmtKind.Block, -1, elseCount);
          this.emitAstStatements(stmt.elseBody, arena, locals, outputs, inputs);
        }
      } else if (stmt.kind === "return") {
        if (stmt.exprTokens && stmt.exprTokens.length > 0 && outputs.length > 0) {
          const outTarget = outputs[outputs.length - 1]!;
          const targetNameId = arena.interner.intern(outTarget);
          const targetExprId = arena.addName(targetNameId);
          const retExprId = this.lowerTokens(stmt.exprTokens, arena);
          arena.addAssignmentStmt(targetExprId, retExprId);
        }
        arena.addReturnStmt();
      }
    }
  }

  /**
   * Extracts the substring enclosed by matching `{` and `}` braces starting at `openBracePos`.
   */
  private static extractBraceBlock(str: string, openBracePos: number): { body: string; endPos: number } {
    let depth = 1;
    let i = openBracePos + 1;
    while (i < str.length && depth > 0) {
      if (str[i] === "{") depth++;
      else if (str[i] === "}") depth--;
      i++;
    }
    return {
      body: str.slice(openBracePos + 1, i - 1),
      endPos: i,
    };
  }

  /**
   * Executes a lowered SysML v2 Action/Calculation via the WebAssembly statement executor.
   */
  public static execute(lowered: LoweredActionDae, inputValues: Record<string, number>): Record<string, number> {
    const { arena, startStmtIdx, stmtCount, outputs } = lowered;

    // Allocate dense environment vector
    const envSize = Math.max(256, arena.interner.size + 32);
    const denseEnv = new Float64Array(envSize);

    // Initialize inputs in dense vector
    for (const [inName, val] of Object.entries(inputValues)) {
      const nameId = arena.interner.intern(inName);
      denseEnv[nameId] = val;
    }

    // Execute statements (catching ArenaReturnSignal on early `return`)
    try {
      executeArenaStatements(arena, startStmtIdx, stmtCount, denseEnv);
    } catch (err: unknown) {
      if (
        !(
          err &&
          typeof err === "object" &&
          "__brand" in err &&
          (err as { __brand?: string }).__brand === "ArenaReturnSignal"
        )
      ) {
        throw err;
      }
    }

    // Gather outputs
    const result: Record<string, number> = {};
    for (const outName of outputs) {
      const nameId = arena.interner.intern(outName);
      result[outName] = denseEnv[nameId] ?? 0;
    }

    return result;
  }

  /**
   * Helper to prefix local variable and port identifiers in an equation or expression string.
   */
  public static prefixExpression(exprText: string, prefix: string, localNames: Set<string>): string {
    return prefixSysmlExpression(exprText, prefix, localNames);
  }

  /**
   * Lowers a parsed CST root node or source string directly into the DAE arena via SysML2CstFlattener.
   */
  public static lowerCst(
    sourceOrRootNode: string | SysmlCstNode,
    existingArena?: DAEBuilder,
    options?: { overrides?: Record<string, number> | undefined; rootComponentName?: string | undefined },
  ): LoweredConstraintDae & { rootName: string } {
    let root: SysmlCstNode;
    let sourceText: string | undefined;
    if (typeof sourceOrRootNode === "string") {
      sourceText = sourceOrRootNode;
      const parser = getSysmlParser();
      if (!parser) throw new Error("SysML v2 parser not available");
      const tree = parser.parse(sourceOrRootNode);
      if (!tree?.rootNode) throw new Error("Failed to parse SysML v2 source");
      root = tree.rootNode;
    } else {
      root = sourceOrRootNode;
    }
    const arena = existingArena ?? new DAEBuilder();
    const flattener = new SysML2CstFlattener({
      arena,
      sourceText,
      overrides: options?.overrides,
      rootComponentName: options?.rootComponentName,
    });
    const res = flattener.flatten(root);
    return {
      arena: res.arena,
      name: res.rootName,
      rootName: res.rootName,
      parameters: res.parameters,
      states: res.states,
      derivatives: res.derivatives,
      eqCount: res.eqCount,
    };
  }

  /**
   * Lowers a physical SysML v2 Constraint or Part definition with differential and algebraic equations into a DAEBuilder.
   */
  public static async lowerConstraint(sysmlSource: string, existingArena?: DAEBuilder): Promise<LoweredConstraintDae> {
    try {
      await initBltWasm();
    } catch {}

    const arena = existingArena ?? new DAEBuilder();
    return this.lowerCst(sysmlSource, arena);
  }

  /**
   * Universal entry point: lowers any SysML v2 source (Action, Calculation, Constraint, Part,
   * or hybrid continuous-discrete system combining both) into a unified DAEBuilder arena.
   */
  public static async lowerSystem(sysmlSource: string, existingArena?: DAEBuilder): Promise<DAEBuilder> {
    const arena = existingArena ?? new DAEBuilder();
    const hasDeclarative =
      /\b(?:constraint|assert\s+constraint|when)\b/.test(sysmlSource) ||
      /\bder\s*\(/.test(sysmlSource) ||
      /\bport\s+def\b/.test(sysmlSource) ||
      /\bpart\s+def\b/.test(sysmlSource) ||
      /\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:/.test(sysmlSource);
    const hasImperative = /\b(?:action|calc)\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(sysmlSource);

    if (hasDeclarative && hasImperative) {
      await this.lowerConstraint(sysmlSource, arena);
      await this.lowerAction(sysmlSource, arena);
      return arena;
    }
    if (hasDeclarative || (!hasImperative && /==/.test(sysmlSource))) {
      await this.lowerConstraint(sysmlSource, arena);
      return arena;
    }
    await this.lowerAction(sysmlSource, arena);
    return arena;
  }

  /**
   * Simulates a SysML v2 specification directly using the arena-native numerical solver.
   */
  public static async simulate(
    sysmlSource: string,
    options: import("@modelscript/simulate").ArenaSimulateOptions = {},
  ): Promise<import("@modelscript/simulate").ArenaSimulationResult> {
    const { simulateArenaAsync } = await import("@modelscript/simulate");
    const arena = await this.lowerSystem(sysmlSource);
    return simulateArenaAsync(arena, options);
  }
}
