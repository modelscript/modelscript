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
  SysmlExprParser,
  tokenizeSysml,
} from "./flattener/cst-lowerer.js";

export { lowerSysmlExpr, prefixSysmlExpression, SysmlExprParser, tokenizeSysml };
export type { SysML2Token };

let cachedSysmlParser: any = null;
/**
 * Lazily loads and caches the synchronous WebAssembly GLR parser for SysML v2 (`parser.wasm`).
 *
 * @returns Initialized WASM parser instance or `null` if the binary is unavailable.
 */
export function getSysmlParser(): any {
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
      cachedSysmlParser = createWasmParserSync(wasmPath)?.parser;
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
  | { kind: "assign"; target: string; expr: string }
  | { kind: "while"; cond: string; body: ParsedAstStmt[] }
  | { kind: "if"; cond: string; thenBody: ParsedAstStmt[]; elseBody?: ParsedAstStmt[] | undefined }
  | { kind: "return"; expr?: string | undefined };

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
   * Lowers a complete SysML v2 Action or Calculation definition into a DAEBuilder.
   */
  public static async lowerAction(sysmlSource: string, existingArena?: DAEBuilder): Promise<LoweredActionDae> {
    try {
      await initBltWasm();
    } catch {}

    const arena = existingArena ?? new DAEBuilder();

    // Extract name
    const nameMatch = /(?:action|calc)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(sysmlSource);
    const name = nameMatch ? nameMatch[1]! : "AnonymousAction";

    const inputs: string[] = [];
    const outputs: string[] = [];
    const locals: string[] = [];

    // 1. Extract pins / parameters
    const pinRegex = /\b(in|out)\s+(?:item\s+|attribute\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_.]+))?/g;
    let pm: RegExpExecArray | null;
    while ((pm = pinRegex.exec(sysmlSource)) !== null) {
      const dir = pm[1];
      const pName = pm[2]!;
      const isInput = dir === "in";

      if (isInput) {
        inputs.push(pName);
        arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Input);
      } else {
        outputs.push(pName);
        arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Output);
      }
    }

    // Return parameter in calc def: return [name] : [type];
    const retParamMatch = /\breturn\s+(?:item\s+|attribute\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(sysmlSource);
    if (retParamMatch && !outputs.includes(retParamMatch[1]!)) {
      outputs.push(retParamMatch[1]!);
      arena.addVariable(retParamMatch[1]!, VarType.Real, Variability.Continuous, Causality.Output);
    }

    // 2. Extract action body
    const openBrace = sysmlSource.indexOf("{");
    const closeBrace = sysmlSource.lastIndexOf("}");
    const bodyText =
      openBrace !== -1 && closeBrace > openBrace ? sysmlSource.slice(openBrace + 1, closeBrace) : sysmlSource;

    const startStmtIdx = arena.stmtCount;

    // 3. Parse statements into structured AST
    const ast = this.parseStatementsToAst(bodyText);

    // 4. Lower AST to arena
    this.emitAstStatements(ast, arena, locals, outputs);

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

  /**
   * Parses imperative action/calculation statements (`while`, `if`/`else`, `return`, `assign`)
   * from a brace-delimited body string into a lightweight statement tree.
   */
  private static parseStatementsToAst(bodyText: string): ParsedAstStmt[] {
    const stmts: ParsedAstStmt[] = [];
    let pos = 0;

    while (pos < bodyText.length) {
      while (pos < bodyText.length && /\s/.test(bodyText[pos]!)) pos++;
      if (pos >= bodyText.length) break;

      const remaining = bodyText.slice(pos);

      // 1. While loop: while (...) { ... }
      if (/^while\b/.test(remaining)) {
        const condMatch = /^while\s*\(([^)]+)\)\s*\{/.exec(remaining);
        if (condMatch) {
          const cond = condMatch[1]!.trim();
          const openBrace = pos + condMatch[0].length - 1;
          const { body, endPos } = this.extractBraceBlock(bodyText, openBrace);
          const bodyAst = this.parseStatementsToAst(body);
          stmts.push({ kind: "while", cond, body: bodyAst });
          pos = endPos;
          continue;
        }
      }

      // 2. If statement: if (...) { ... } [else { ... }]
      if (/^if\b/.test(remaining)) {
        const condMatch = /^if\s*\(([^)]+)\)\s*\{/.exec(remaining);
        if (condMatch) {
          const cond = condMatch[1]!.trim();
          const openBrace = pos + condMatch[0].length - 1;
          const { body: thenBody, endPos: thenEnd } = this.extractBraceBlock(bodyText, openBrace);
          const thenAst = this.parseStatementsToAst(thenBody);

          let elseAst: ParsedAstStmt[] | undefined;
          let nextPos = thenEnd;
          const afterThen = bodyText.slice(thenEnd).trimStart();
          if (afterThen.startsWith("else")) {
            const elseOpen = bodyText.indexOf("{", thenEnd);
            if (elseOpen !== -1) {
              const { body: elseBody, endPos: elseEnd } = this.extractBraceBlock(bodyText, elseOpen);
              elseAst = this.parseStatementsToAst(elseBody);
              nextPos = elseEnd;
            }
          }

          stmts.push({ kind: "if", cond, thenBody: thenAst, elseBody: elseAst });
          pos = nextPos;
          continue;
        }
      }

      // 3. Return statement: return expr;
      if (/^return\b/.test(remaining)) {
        const semi = remaining.indexOf(";");
        if (semi !== -1) {
          const expr = remaining.slice(6, semi).trim();
          stmts.push({ kind: "return", expr });
          pos += semi + 1;
          continue;
        }
      }

      // 4. Assignments: assign x := expr; or x := expr; or x = expr;
      const assignMatch = /^(?:assign\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*([^;\s\r\n][^;\r\n]*);/.exec(remaining);
      if (assignMatch) {
        stmts.push({
          kind: "assign",
          target: assignMatch[1]!,
          expr: assignMatch[2]!.trim(),
        });
        pos += assignMatch[0].length;
        continue;
      }

      const nextSemi = remaining.indexOf(";");
      if (nextSemi !== -1) {
        pos += nextSemi + 1;
      } else {
        break;
      }
    }

    return stmts;
  }

  /**
   * Computes the total number of linear statement slots required by a statement block
   * so `While` and `If` headers can record exact jump offsets in `stmtData`.
   */
  private static countAstSlots(stmts: ParsedAstStmt[]): number {
    let count = 0;
    for (const s of stmts) {
      if (s.kind === "assign" || s.kind === "return") {
        count += 1;
      } else if (s.kind === "while") {
        count += 1 + this.countAstSlots(s.body);
      } else if (s.kind === "if") {
        count += 1 + this.countAstSlots(s.thenBody);
        if (s.elseBody && s.elseBody.length > 0) {
          count += 1 + this.countAstSlots(s.elseBody);
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
  ): void {
    for (const stmt of stmts) {
      if (stmt.kind === "assign") {
        const target = stmt.target;
        if (!locals.includes(target) && !outputs.includes(target)) {
          locals.push(target);
          arena.addVariable(target, VarType.Real, Variability.Continuous, Causality.Local);
        }

        const targetNameId = arena.interner.intern(target);
        const targetExprId = arena.addName(targetNameId);
        const srcExprId = this.lowerExpression(stmt.expr, arena);
        arena.addAssignmentStmt(targetExprId, srcExprId);
      } else if (stmt.kind === "while") {
        const condId = this.lowerExpression(stmt.cond, arena);
        const bodySlots = this.countAstSlots(stmt.body);
        arena.addStatement(StmtKind.While, condId, bodySlots);
        this.emitAstStatements(stmt.body, arena, locals, outputs);
      } else if (stmt.kind === "if") {
        const condId = this.lowerExpression(stmt.cond, arena);
        const thenSlots = this.countAstSlots(stmt.thenBody);
        const hasElse = Boolean(stmt.elseBody && stmt.elseBody.length > 0);
        const branchCount = hasElse ? 1 : 0;

        arena.addStatement(StmtKind.If, condId, thenSlots, branchCount);
        this.emitAstStatements(stmt.thenBody, arena, locals, outputs);

        if (hasElse && stmt.elseBody) {
          const elseSlots = this.countAstSlots(stmt.elseBody);
          arena.addStatement(StmtKind.Block, -1, elseSlots);
          this.emitAstStatements(stmt.elseBody, arena, locals, outputs);
        }
      } else if (stmt.kind === "return") {
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

    // Execute statements
    executeArenaStatements(arena, startStmtIdx, stmtCount, denseEnv);

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
    sourceOrRootNode: string | any,
    existingArena?: DAEBuilder,
    options?: { overrides?: Record<string, number> | undefined; rootComponentName?: string | undefined },
  ): LoweredConstraintDae & { rootName: string } {
    let root = sourceOrRootNode;
    let sourceText: string | undefined;
    if (typeof sourceOrRootNode === "string") {
      sourceText = sourceOrRootNode;
      const parser = getSysmlParser();
      if (!parser) throw new Error("SysML v2 parser not available");
      const tree = parser.parse(sourceOrRootNode);
      root = tree?.rootNode;
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
   * Universal entry point: lowers any SysML v2 source (Action, Calculation, Constraint, or Part) into a DAEBuilder.
   */
  public static async lowerSystem(sysmlSource: string, existingArena?: DAEBuilder): Promise<DAEBuilder> {
    if (
      /\b(?:constraint|assert\s+constraint|when)\b/.test(sysmlSource) ||
      /==/.test(sysmlSource) ||
      /\bder\s*\(/.test(sysmlSource) ||
      /\bport\s+def\b/.test(sysmlSource) ||
      /\bpart\s+def\b/.test(sysmlSource)
    ) {
      const res = await this.lowerConstraint(sysmlSource, existingArena);
      return res.arena;
    } else {
      const res = await this.lowerAction(sysmlSource, existingArena);
      return res.arena;
    }
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
