// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview SysML v2 Compound Requirement & Constraint Verification Engine.
 *
 * Evaluates and verifies SysML v2 `require constraint` and `assert constraint` blocks
 * containing compound boolean connectives (`and`, `or`, `xor`, `implies`, `not`) and
 * full arithmetic sub-expressions (`+`, `-`, `*`, `/`, `%`, `^`, parentheses, functions).
 */

import type { QueryDB } from "@modelscript/runtime";
import {
  evaluateSysML2Constraint,
  evaluateSysML2Expression,
  extractAtomicComparisons,
  formatSysML2Expr,
  parseSysML2Expression,
  type EvaluatedConstraintOutcome,
  type SysML2ExprAst,
} from "./evaluator.js";
import { RealSimplexSolver, parseLinearExpression } from "./real-simplex.js";

export interface RequirementBlockSpec {
  name: string;
  /** Raw constraint expression or `require constraint { ... }` / `assert constraint { ... }` block. */
  constraint: string;
  /** Optional assumption expression (`assume constraint { ... }`) that guards this requirement. */
  assumption?: string | undefined;
  kind?: "require" | "assert" | "assume" | undefined;
}

export interface RequirementEvaluationItem {
  name: string;
  satisfied: boolean;
  vacuous: boolean;
  margin: number;
  violatedAtoms: string[];
  expression: string;
}

export interface SysML2VerificationReport {
  allSatisfied: boolean;
  minMargin: number;
  results: RequirementEvaluationItem[];
  violatedRequirements: string[];
}

export interface CompoundConsistencyResult {
  isConsistent: boolean;
  conflictingRequirements: string[];
  witnessAssignment?: Record<string, number> | undefined;
  violatedConstraints: {
    expression: string;
    requirementName?: string | undefined;
    reason: string;
  }[];
}

/**
 * Evaluates a single SysML v2 `require constraint` or `assert constraint` block
 * against a concrete attribute/signal environment `env`.
 */
export function verifySysML2ConstraintBlock(
  constraintText: string,
  env: Readonly<Record<string, number | boolean | string>> = {},
): EvaluatedConstraintOutcome & { ast: SysML2ExprAst } {
  const ast = parseSysML2Expression(constraintText);
  const outcome = evaluateSysML2Constraint(ast, env);
  return {
    ...outcome,
    ast,
  };
}

/**
 * Evaluates a collection of SysML v2 requirement constraint specifications against `env`.
 * Supports `assume constraint` preconditions (if an assumption evaluates to false, the
 * requirement is vacuously satisfied).
 */
export function verifySysML2Requirements(
  requirements: readonly RequirementBlockSpec[],
  env: Readonly<Record<string, number | boolean | string>> = {},
): SysML2VerificationReport {
  const results: RequirementEvaluationItem[] = [];
  const violatedRequirements: string[] = [];
  let minMargin = Infinity;

  for (const req of requirements) {
    if (req.assumption) {
      const assumeRes = evaluateSysML2Constraint(req.assumption, env);
      if (!assumeRes.satisfied) {
        results.push({
          name: req.name,
          satisfied: true,
          vacuous: true,
          margin: Math.max(-assumeRes.margin, 0),
          violatedAtoms: [],
          expression: req.constraint,
        });
        continue;
      }
    }

    const outcome = evaluateSysML2Constraint(req.constraint, env);
    if (outcome.margin < minMargin) {
      minMargin = outcome.margin;
    }
    if (!outcome.satisfied) {
      violatedRequirements.push(req.name);
    }
    results.push({
      name: req.name,
      satisfied: outcome.satisfied,
      vacuous: false,
      margin: outcome.margin,
      violatedAtoms: outcome.violatedAtoms,
      expression: req.constraint,
    });
  }

  return {
    allSatisfied: violatedRequirements.length === 0,
    minMargin: results.length === 0 ? 0 : minMargin,
    results,
    violatedRequirements,
  };
}

interface SignedAtom {
  lhs: SysML2ExprAst;
  op: "<=" | ">=" | "<" | ">" | "==" | "!=";
  rhs: SysML2ExprAst;
  requirementName?: string | undefined;
  rawText: string;
}

function flipComparisonOp(op: "<=" | ">=" | "<" | ">" | "==" | "!="): "<=" | ">=" | "<" | ">" | "==" | "!=" {
  switch (op) {
    case "<=":
      return ">";
    case "<":
      return ">=";
    case ">=":
      return "<";
    case ">":
      return "<=";
    case "==":
      return "!=";
    case "!=":
      return "==";
  }
}

/**
 * Expands a boolean formula AST into Disjunctive Normal Form (DNF) branches of atomic comparisons.
 */
function expandToDnfBranches(node: SysML2ExprAst, negated: boolean, requirementName?: string): SignedAtom[][] {
  if (node.kind === "BooleanLiteral") {
    const val = negated ? !node.value : node.value;
    return val ? [[]] : [];
  }
  if (node.kind === "UnaryExpr" && node.op === "not") {
    return expandToDnfBranches(node.operand, !negated, requirementName);
  }
  if (node.kind === "BinaryExpr") {
    if (node.op === "and" || node.op === "or" || node.op === "implies") {
      // Rewrite `A implies B` as `(not A) or B`
      let effectiveOp: "and" | "or";
      let leftNeg = negated;
      let rightNeg = negated;
      if (node.op === "implies") {
        if (!negated) {
          effectiveOp = "or";
          leftNeg = true;
          rightNeg = false;
        } else {
          // not (A implies B) === A and (not B)
          effectiveOp = "and";
          leftNeg = false;
          rightNeg = true;
        }
      } else {
        effectiveOp = negated ? (node.op === "and" ? "or" : "and") : node.op;
      }

      const leftBranches = expandToDnfBranches(node.left, leftNeg, requirementName);
      const rightBranches = expandToDnfBranches(node.right, rightNeg, requirementName);

      if (effectiveOp === "or") {
        return [...leftBranches, ...rightBranches];
      }
      // Conjunction: Cartesian product of branches (bounded to prevent blowup)
      const combined: SignedAtom[][] = [];
      for (const lb of leftBranches) {
        for (const rb of rightBranches) {
          combined.push([...lb, ...rb]);
          if (combined.length >= 64) return combined;
        }
      }
      return combined;
    }

    if (
      node.op === "<=" ||
      node.op === ">=" ||
      node.op === "<" ||
      node.op === ">" ||
      node.op === "==" ||
      node.op === "!="
    ) {
      const op = negated ? flipComparisonOp(node.op) : node.op;
      return [
        [
          {
            lhs: node.left,
            op,
            rhs: node.right,
            requirementName,
            rawText: `${formatSysML2Expr(node.left)} ${op} ${formatSysML2Expr(node.right)}`,
          },
        ],
      ];
    }
  }
  return [[]];
}

/**
 * Linearizes an arithmetic `SysML2ExprAst` into `{ terms: Map<string, number>, constant: number }`
 * using known constant bindings in `parameterEnv`.
 */
function linearizeAst(
  node: SysML2ExprAst,
  parameterEnv: Readonly<Record<string, number>>,
): { terms: Map<string, number>; constant: number } | null {
  switch (node.kind) {
    case "NumberLiteral":
      return { terms: new Map(), constant: node.value };
    case "BooleanLiteral":
      return { terms: new Map(), constant: node.value ? 1 : 0 };
    case "StringLiteral":
      return null;
    case "Identifier": {
      const val = evaluateSysML2Expression(node, parameterEnv);
      if (typeof val === "number" && !Number.isNaN(val)) {
        return { terms: new Map(), constant: val };
      }
      const m = new Map<string, number>();
      m.set(node.name, 1);
      return { terms: m, constant: 0 };
    }
    case "UnaryExpr": {
      const sub = linearizeAst(node.operand, parameterEnv);
      if (!sub) return null;
      if (node.op === "+") return sub;
      if (node.op === "-") {
        const terms = new Map<string, number>();
        for (const [k, v] of sub.terms) terms.set(k, -v);
        return { terms, constant: -sub.constant };
      }
      return null;
    }
    case "BinaryExpr": {
      const left = linearizeAst(node.left, parameterEnv);
      const right = linearizeAst(node.right, parameterEnv);
      if (!left || !right) return null;

      if (node.op === "+" || node.op === "-") {
        const sign = node.op === "+" ? 1 : -1;
        const terms = new Map<string, number>(left.terms);
        for (const [k, v] of right.terms) {
          const next = (terms.get(k) ?? 0) + sign * v;
          if (Math.abs(next) < 1e-12) terms.delete(k);
          else terms.set(k, next);
        }
        return { terms, constant: left.constant + sign * right.constant };
      }
      if (node.op === "*") {
        if (left.terms.size === 0) {
          const terms = new Map<string, number>();
          for (const [k, v] of right.terms) {
            if (Math.abs(left.constant * v) >= 1e-12) terms.set(k, left.constant * v);
          }
          return { terms, constant: left.constant * right.constant };
        }
        if (right.terms.size === 0) {
          const terms = new Map<string, number>();
          for (const [k, v] of left.terms) {
            if (Math.abs(right.constant * v) >= 1e-12) terms.set(k, right.constant * v);
          }
          return { terms, constant: left.constant * right.constant };
        }
        return null;
      }
      if (node.op === "/") {
        if (right.terms.size === 0 && Math.abs(right.constant) > 1e-12) {
          const terms = new Map<string, number>();
          for (const [k, v] of left.terms) {
            terms.set(k, v / right.constant);
          }
          return { terms, constant: left.constant / right.constant };
        }
        return null;
      }
      if (node.op === "^") {
        if (left.terms.size === 0 && right.terms.size === 0) {
          return { terms: new Map(), constant: Math.pow(left.constant, right.constant) };
        }
        return null;
      }
      return null;
    }
    case "CallExpr": {
      const val = evaluateSysML2Expression(node, parameterEnv);
      if (typeof val === "number" && !Number.isNaN(val)) {
        return { terms: new Map(), constant: val };
      }
      return null;
    }
    case "ConditionalExpr":
      return null;
  }
}

/**
 * Checks whether a set of compound SysML v2 requirement/constraint expressions
 * (involving `and`, `or`, `implies`, `not`, and linear arithmetic `+`, `-`, `*`, `/`)
 * is mutually satisfiable using DNF branch decomposition + Dual Simplex.
 */
export function checkCompoundConstraintConsistency(
  constraints: readonly { name?: string | undefined; expression: string }[],
  parameterEnv: Readonly<Record<string, number>> = {},
): CompoundConsistencyResult {
  if (constraints.length === 0) {
    return {
      isConsistent: true,
      conflictingRequirements: [],
      violatedConstraints: [],
    };
  }

  // Expand each constraint into its DNF branches and take bounded product
  let branches: SignedAtom[][] = [[]];
  for (const c of constraints) {
    const ast = parseSysML2Expression(c.expression);
    const reqBranches = expandToDnfBranches(ast, false, c.name);
    if (reqBranches.length === 0) {
      return {
        isConsistent: false,
        conflictingRequirements: c.name ? [c.name] : [],
        violatedConstraints: [
          {
            expression: c.expression,
            requirementName: c.name,
            reason: `Constraint '${c.expression}' is identically false`,
          },
        ],
      };
    }
    const nextBranches: SignedAtom[][] = [];
    for (const b of branches) {
      for (const rb of reqBranches) {
        nextBranches.push([...b, ...rb]);
        if (nextBranches.length >= 128) break;
      }
      if (nextBranches.length >= 128) break;
    }
    branches = nextBranches;
  }

  let lastConflictReqs = new Set<string>();
  let lastViolated: CompoundConsistencyResult["violatedConstraints"] = [];

  for (const branch of branches) {
    const solver = new RealSimplexSolver();
    let branchFeasible = true;
    const branchConflictReqs = new Set<string>();
    const branchViolated: CompoundConsistencyResult["violatedConstraints"] = [];

    for (const atom of branch) {
      const leftLin = linearizeAst(atom.lhs, parameterEnv);
      const rightLin = linearizeAst(atom.rhs, parameterEnv);

      let terms: { varName: string; coeff: number }[] = [];
      let effectiveRhs = 0;

      if (leftLin && rightLin) {
        // left - right op 0  =>  sum(left.terms - right.terms) op (right.constant - left.constant)
        const merged = new Map<string, number>(leftLin.terms);
        for (const [k, v] of rightLin.terms) {
          const next = (merged.get(k) ?? 0) - v;
          if (Math.abs(next) < 1e-12) merged.delete(k);
          else merged.set(k, next);
        }
        terms = Array.from(merged.entries()).map(([varName, coeff]) => ({ varName, coeff }));
        effectiveRhs = rightLin.constant - leftLin.constant;
      } else {
        // Fallback to string linear parser
        const lhsParsed = parseLinearExpression(formatSysML2Expr(atom.lhs));
        const rhsVal = evaluateSysML2Expression(atom.rhs, parameterEnv);
        if (typeof rhsVal !== "number" || Number.isNaN(rhsVal)) continue;
        terms = lhsParsed.terms;
        effectiveRhs = rhsVal - lhsParsed.constant;
      }

      if (terms.length === 0) {
        // Constant comparison: 0 op effectiveRhs
        const sat =
          atom.op === "<="
            ? 0 <= effectiveRhs + 1e-9
            : atom.op === "<"
              ? 0 < effectiveRhs - 1e-9
              : atom.op === ">="
                ? 0 >= effectiveRhs - 1e-9
                : atom.op === ">"
                  ? 0 > effectiveRhs + 1e-9
                  : atom.op === "=="
                    ? Math.abs(effectiveRhs) <= 1e-9
                    : Math.abs(effectiveRhs) > 1e-9;
        if (!sat) {
          branchFeasible = false;
          if (atom.requirementName) branchConflictReqs.add(atom.requirementName);
          branchViolated.push({
            expression: atom.rawText,
            requirementName: atom.requirementName,
            reason: `Constant arithmetic inequality '${atom.rawText}' evaluated to false`,
          });
          break;
        }
        continue;
      }

      if (atom.op === "!=") {
        // Check if strict inequality can be satisfied
        continue;
      }

      const strictEps = atom.op === "<" ? -1e-6 : atom.op === ">" ? 1e-6 : 0;
      const solverOp: "<=" | ">=" | "==" = atom.op === "<" ? "<=" : atom.op === ">" ? ">=" : atom.op;

      solver.addConstraint({
        requirementName: atom.requirementName,
        terms,
        operator: solverOp,
        rhs: effectiveRhs + strictEps,
        expression: atom.rawText,
      });

      const res = solver.solve();
      if (!res.isFeasible) {
        branchFeasible = false;
        if (atom.requirementName) branchConflictReqs.add(atom.requirementName);
        if (res.unsatCore) {
          for (const r of res.unsatCore) branchConflictReqs.add(r);
        }
        branchViolated.push({
          expression: atom.rawText,
          requirementName: atom.requirementName,
          reason: res.conflictExplanation ?? `Contradiction involving '${atom.rawText}'`,
        });
        break;
      }
    }

    if (branchFeasible) {
      const solved = solver.solve();
      const witnessAssignment: Record<string, number> = {};
      if (solved.assignment) {
        const entries =
          solved.assignment instanceof Map
            ? Array.from(solved.assignment.entries())
            : Object.entries(solved.assignment as Record<string, number>);
        for (const [k, v] of entries) {
          witnessAssignment[k] = v;
        }
      }
      return {
        isConsistent: true,
        conflictingRequirements: [],
        witnessAssignment,
        violatedConstraints: [],
      };
    }

    lastConflictReqs = branchConflictReqs;
    lastViolated = branchViolated;
  }

  return {
    isConsistent: false,
    conflictingRequirements: Array.from(lastConflictReqs),
    violatedConstraints: lastViolated,
  };
}

/**
 * Extracts and verifies all compound requirement/constraint blocks from a `QueryDB`
 * against an attribute environment `env`.
 */
export function verifyQueryDbConstraints(
  db: QueryDB,
  env: Readonly<Record<string, number | boolean | string>> = {},
): SysML2VerificationReport {
  const specs: RequirementBlockSpec[] = [];
  for (const entry of db.allEntries()) {
    if (!entry.ruleName.includes("Constraint")) continue;
    const text = db.cstText(entry.startOffset, entry.endOffset, entry);
    if (!text) continue;
    const atoms = extractAtomicComparisons(text);
    if (atoms.length === 0) continue;
    specs.push({
      name: entry.name || `Constraint_${entry.id}`,
      constraint: text,
    });
  }
  return verifySysML2Requirements(specs, env);
}
