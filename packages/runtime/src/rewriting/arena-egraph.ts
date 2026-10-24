// SPDX-License-Identifier: AGPL-3.0-or-later

import { simplifyArenaExpr } from "../analysis/wasm_egraph_simplifier.js";
import type { DAEBuilder } from "../dae/wasm_dae.js";
import { ExprKind } from "../dae/wasm_dae.js";
import { instantiatePattern, matchPattern, parsePattern, type PatternNode } from "./pattern-matcher.js";

/**
 * Definition of a term rewrite rule for the DAE arena.
 */
export interface RewriteRuleDefinition {
  /** Unique rule name. */
  name: string;
  /** Optional rule description. */
  description?: string;
  /** LHS pattern string (e.g. `"?x + 0"`). */
  pattern?: string;
  /** RHS replacement string (e.g. `"?x"`). */
  replacement?: string;
  /** Procedural matcher function (returns new ExprId or null). */
  match?: (arena: DAEBuilder, exprId: number) => number | null;
}

interface CompiledRule {
  name: string;
  patternAst?: PatternNode;
  replacementAst?: PatternNode;
  matchFn?: (arena: DAEBuilder, exprId: number) => number | null;
}

/**
 * Interactive equality-saturation and term-rewriting engine for DAE arenas.
 *
 * Allows registering custom algebraic or domain-specific rewrite rules
 * and applying them to arena expressions and equations without recompiling WASM grammars.
 */
export class ArenaEGraphRewriter {
  private rules: CompiledRule[] = [];

  constructor(public readonly arena: DAEBuilder) {}

  /**
   * Registers a rewrite rule.
   */
  addRule(rule: RewriteRuleDefinition): this {
    const compiled: CompiledRule = { name: rule.name };
    if (rule.pattern && rule.replacement) {
      compiled.patternAst = parsePattern(rule.pattern);
      compiled.replacementAst = parsePattern(rule.replacement);
    }
    if (rule.match) {
      compiled.matchFn = rule.match;
    }
    this.rules.push(compiled);
    return this;
  }

  /**
   * Registers multiple rewrite rules.
   */
  addRules(rules: RewriteRuleDefinition[]): this {
    for (const r of rules) this.addRule(r);
    return this;
  }

  /**
   * Registers standard algebraic identities (zero-annihilation, identity elements, cancellations).
   */
  addStandardAlgebraicRules(): this {
    this.addRule({ name: "add-zero-right", pattern: "?x + 0", replacement: "?x" });
    this.addRule({ name: "add-zero-left", pattern: "0 + ?x", replacement: "?x" });
    this.addRule({ name: "sub-zero", pattern: "?x - 0", replacement: "?x" });
    this.addRule({ name: "mul-one-right", pattern: "?x * 1", replacement: "?x" });
    this.addRule({ name: "mul-one-left", pattern: "1 * ?x", replacement: "?x" });
    this.addRule({ name: "mul-zero-right", pattern: "?x * 0", replacement: "0" });
    this.addRule({ name: "mul-zero-left", pattern: "0 * ?x", replacement: "0" });
    this.addRule({ name: "sub-self", pattern: "?x - ?x", replacement: "0" });
    this.addRule({ name: "neg-neg", pattern: "-(-?x)", replacement: "?x" });
    return this;
  }

  /**
   * Applies rewrite rules and canonical simplifications to an expression until a fixed point is reached.
   */
  rewriteExpr(exprId: number, maxIterations = 5): number {
    if (exprId < 0) return exprId;

    let current = exprId;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      const next = this.rewriteStep(current);
      // Run canonical AST simplifications (constant folding + identity normalization)
      const simplified = simplifyArenaExpr(this.arena, next);
      if (simplified === current) break;
      current = simplified;
    }

    return current;
  }

  private rewriteStep(exprId: number): number {
    if (exprId < 0) return exprId;
    const kind = this.arena.getExprKind(exprId);

    // 1. Rewrite children recursively
    let rewrittenId = exprId;
    if (kind === ExprKind.Binary) {
      const left = this.rewriteStep(this.arena.getExprLeft(exprId));
      const right = this.rewriteStep(this.arena.getExprRight(exprId));
      if (left !== this.arena.getExprLeft(exprId) || right !== this.arena.getExprRight(exprId)) {
        rewrittenId = this.arena.addBinaryExpr(this.arena.getExprData1(exprId), left, right);
      }
    } else if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      const inner = this.rewriteStep(this.arena.getExprLeft(exprId));
      if (inner !== this.arena.getExprLeft(exprId)) {
        rewrittenId =
          kind === ExprKind.Negate
            ? this.arena.addExpression(ExprKind.Negate, 0, inner)
            : this.arena.addUnaryExpr(this.arena.getExprData1(exprId), inner);
      }
    }

    // 2. Try applying top-level rules
    for (const rule of this.rules) {
      if (rule.matchFn) {
        const res = rule.matchFn(this.arena, rewrittenId);
        if (res !== null && res >= 0 && res !== rewrittenId) {
          return res;
        }
      }
      if (rule.patternAst && rule.replacementAst) {
        const bindings = new Map<string, number>();
        if (matchPattern(rule.patternAst, this.arena, rewrittenId, bindings)) {
          return instantiatePattern(rule.replacementAst, this.arena, bindings);
        }
      }
    }

    return rewrittenId;
  }

  /**
   * Rewrites both left- and right-hand sides of an arena equation.
   */
  rewriteEquation(eqId: number): boolean {
    if (this.arena.isEqRemoved(eqId)) return false;
    const oldLhs = this.arena.getEqLhs(eqId);
    const oldRhs = this.arena.getEqRhs(eqId);

    const newLhs = this.rewriteExpr(oldLhs);
    const newRhs = this.rewriteExpr(oldRhs);

    let changed = false;
    if (newLhs !== oldLhs) {
      this.arena.setEqLhs(eqId, newLhs);
      changed = true;
    }
    if (newRhs !== oldRhs) {
      this.arena.setEqRhs(eqId, newRhs);
      changed = true;
    }
    return changed;
  }

  /**
   * Walks all active equations in the arena and simplifies them.
   */
  rewriteAllEquations(): { modified: number } {
    let modified = 0;
    const count = this.arena.getEqCount();
    for (let i = 0; i < count; i++) {
      if (this.rewriteEquation(i)) {
        modified++;
      }
    }
    return { modified };
  }
}
