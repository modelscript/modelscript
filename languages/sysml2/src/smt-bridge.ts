// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { OCTAGON_INF, OCTAGON_INF_F64, OctagonDBM, OctagonDBMF64, Polynomial, Term } from "@modelscript/runtime";
import {
  extractSysML2FormulaBlocks,
  type ExtractedConstraint,
  type ExtractedFormulaBlock,
} from "./constraint-extractor.js";
import {
  evaluateSysML2Expression,
  formatSysML2Expr,
  parseSysML2Expression,
  sysmlAstSome,
  type SysML2ExprAst,
} from "./evaluator.js";
import { SysML2NRASolver, type NRAPolynomialConstraint, type NRAPredicateOp } from "./nra-solver.js";
import { RealSimplexSolver, type LinearTerm } from "./real-simplex.js";
export { parseLinearExpression, RealSimplexSolver, type LinearConstraint } from "./real-simplex.js";
export { OCTAGON_INF, OctagonDBMF64 };

/** Backward-compatible alias for the shared OctagonDBM class. */
export { OctagonDBM as SmtOctagonDBM };

/**
 * Result of SMT requirement consistency verification.
 */
export interface SMTRequirementCheckResult {
  /** True if all requirement constraints are mutually satisfiable. */
  isConsistent: boolean;
  /** Names of requirements participating in an unsatisfiable conflict core. */
  conflictingRequirements: string[];
  /** Detailed list of violated or contradictory constraint expressions. */
  violatedConstraints: {
    /** Original constraint expression text. */
    expression: string;
    /** Enclosing requirement name, if known. */
    requirementName?: string | undefined;
    /** Human-readable explanation of why the constraint is unsatisfiable. */
    reason: string;
  }[];
}

// ─────────────────────────────────────────────────────────────────────
// DNF Expansion & Multi-Theory Solver (OctagonDBMF64 + Simplex + NRA)
// ─────────────────────────────────────────────────────────────────────

type ComparisonOp = "<=" | "<" | ">=" | ">" | "==";

interface DnfAtom {
  lhsAst: SysML2ExprAst;
  op: ComparisonOp;
  rhsAst: SysML2ExprAst;
  lhsDisplay: string;
  rhsDisplay: string;
  expression: string;
  requirementName?: string | undefined;
}

const MAX_DNF_BRANCHES = 128;

function expandAstToDnf(node: SysML2ExprAst, negated: boolean, requirementName?: string): DnfAtom[][] {
  if (node.kind === "BooleanLiteral") {
    const val = negated ? !node.value : node.value;
    return val ? [[]] : [];
  }

  if (node.kind === "UnaryExpr" && node.op === "not") {
    return expandAstToDnf(node.operand, !negated, requirementName);
  }

  if (node.kind === "ConditionalExpr") {
    // `if C then T else E` === `(C and T) or (not C and E)`
    const asDisjunction: SysML2ExprAst = {
      kind: "BinaryExpr",
      op: "or",
      left: { kind: "BinaryExpr", op: "and", left: node.condition, right: node.thenExpr },
      right: {
        kind: "BinaryExpr",
        op: "and",
        left: { kind: "UnaryExpr", op: "not", operand: node.condition },
        right: node.elseExpr,
      },
    };
    return expandAstToDnf(asDisjunction, negated, requirementName);
  }

  if (node.kind === "BinaryExpr") {
    if (node.op === "and" || node.op === "or" || node.op === "implies" || node.op === "xor") {
      if (node.op === "xor") {
        // Positive: `(L and not R) or (not L and R)`; Negated: `(L and R) or (not L and not R)`
        const rewritten: SysML2ExprAst = !negated
          ? {
              kind: "BinaryExpr",
              op: "or",
              left: {
                kind: "BinaryExpr",
                op: "and",
                left: node.left,
                right: { kind: "UnaryExpr", op: "not", operand: node.right },
              },
              right: {
                kind: "BinaryExpr",
                op: "and",
                left: { kind: "UnaryExpr", op: "not", operand: node.left },
                right: node.right,
              },
            }
          : {
              kind: "BinaryExpr",
              op: "or",
              left: { kind: "BinaryExpr", op: "and", left: node.left, right: node.right },
              right: {
                kind: "BinaryExpr",
                op: "and",
                left: { kind: "UnaryExpr", op: "not", operand: node.left },
                right: { kind: "UnaryExpr", op: "not", operand: node.right },
              },
            };
        return expandAstToDnf(rewritten, false, requirementName);
      }

      let effectiveOp: "and" | "or";
      let leftNeg = negated;
      let rightNeg = negated;

      if (node.op === "implies") {
        if (!negated) {
          effectiveOp = "or";
          leftNeg = true;
          rightNeg = false;
        } else {
          effectiveOp = "and";
          leftNeg = false;
          rightNeg = true;
        }
      } else {
        effectiveOp = negated ? (node.op === "and" ? "or" : "and") : node.op;
      }

      const leftBranches = expandAstToDnf(node.left, leftNeg, requirementName);
      const rightBranches = expandAstToDnf(node.right, rightNeg, requirementName);

      if (effectiveOp === "or") {
        return [...leftBranches, ...rightBranches].slice(0, MAX_DNF_BRANCHES);
      }

      const product: DnfAtom[][] = [];
      for (const lb of leftBranches) {
        for (const rb of rightBranches) {
          product.push([...lb, ...rb]);
          if (product.length >= MAX_DNF_BRANCHES) return product;
        }
      }
      return product;
    }

    if (
      node.op === "<=" ||
      node.op === ">=" ||
      node.op === "<" ||
      node.op === ">" ||
      node.op === "==" ||
      node.op === "!="
    ) {
      let rawOp = node.op;
      if (negated) {
        rawOp =
          rawOp === "<="
            ? ">"
            : rawOp === "<"
              ? ">="
              : rawOp === ">="
                ? "<"
                : rawOp === ">"
                  ? "<="
                  : rawOp === "=="
                    ? "!="
                    : "==";
      }

      const lhsDisplay = formatSysML2Expr(node.left);
      const rhsDisplay = formatSysML2Expr(node.right);

      if (rawOp === "!=") {
        // Over reals, `lhs != rhs` <=> `(lhs < rhs) OR (lhs > rhs)`
        if (node.left.kind === "StringLiteral" || node.right.kind === "StringLiteral") {
          return [
            [
              {
                lhsAst: node.left,
                op: "<",
                rhsAst: node.right,
                lhsDisplay,
                rhsDisplay,
                expression: `${lhsDisplay} != ${rhsDisplay}`,
                requirementName,
              },
            ],
          ];
        }
        return [
          [
            {
              lhsAst: node.left,
              op: "<",
              rhsAst: node.right,
              lhsDisplay,
              rhsDisplay,
              expression: `${lhsDisplay} < ${rhsDisplay}`,
              requirementName,
            },
          ],
          [
            {
              lhsAst: node.left,
              op: ">",
              rhsAst: node.right,
              lhsDisplay,
              rhsDisplay,
              expression: `${lhsDisplay} > ${rhsDisplay}`,
              requirementName,
            },
          ],
        ];
      }

      return [
        [
          {
            lhsAst: node.left,
            op: rawOp,
            rhsAst: node.right,
            lhsDisplay,
            rhsDisplay,
            expression: `${lhsDisplay} ${rawOp} ${rhsDisplay}`,
            requirementName,
          },
        ],
      ];
    }
  }

  if (node.kind === "Identifier") {
    // Boolean proposition identifier (`coolingActive` / `not coolingActive`)
    const targetVal = negated ? 0 : 1;
    const rhsLit: SysML2ExprAst = { kind: "NumberLiteral", value: targetVal };
    return [
      [
        {
          lhsAst: node,
          op: "==",
          rhsAst: rhsLit,
          lhsDisplay: node.name,
          rhsDisplay: String(targetVal),
          expression: negated ? `not (${node.name})` : node.name,
          requirementName,
        },
      ],
    ];
  }

  return [[]];
}

interface LinearForm {
  terms: Map<string, number>;
  constant: number;
}

function linearizeAst(node: SysML2ExprAst, parameterEnv: Readonly<Record<string, number>>): LinearForm | null {
  switch (node.kind) {
    case "NumberLiteral":
      return { terms: new Map(), constant: node.value };
    case "BooleanLiteral":
      return { terms: new Map(), constant: node.value ? 1 : 0 };
    case "StringLiteral":
      return null;
    case "Identifier": {
      if (node.name in parameterEnv) {
        const val = parameterEnv[node.name]!;
        if (Number.isFinite(val)) {
          return { terms: new Map(), constant: val };
        }
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
          if (Math.abs(next) < 1e-15) terms.delete(k);
          else terms.set(k, next);
        }
        return { terms, constant: left.constant + sign * right.constant };
      }
      if (node.op === "*") {
        if (left.terms.size === 0) {
          const terms = new Map<string, number>();
          for (const [k, v] of right.terms) {
            const p = left.constant * v;
            if (Math.abs(p) >= 1e-15) terms.set(k, p);
          }
          return { terms, constant: left.constant * right.constant };
        }
        if (right.terms.size === 0) {
          const terms = new Map<string, number>();
          for (const [k, v] of left.terms) {
            const p = right.constant * v;
            if (Math.abs(p) >= 1e-15) terms.set(k, p);
          }
          return { terms, constant: left.constant * right.constant };
        }
        return null;
      }
      if (node.op === "/") {
        if (right.terms.size === 0 && Math.abs(right.constant) > 1e-15) {
          const terms = new Map<string, number>();
          for (const [k, v] of left.terms) {
            const q = v / right.constant;
            if (Math.abs(q) >= 1e-15) terms.set(k, q);
          }
          return { terms, constant: left.constant / right.constant };
        }
        return null;
      }
      if (node.op === "^") {
        if (left.terms.size === 0 && right.terms.size === 0) {
          const val = Math.pow(left.constant, right.constant);
          return Number.isFinite(val) ? { terms: new Map(), constant: val } : null;
        }
        return null;
      }
      return null;
    }
    case "CallExpr": {
      const val = evaluateSysML2Expression(node, parameterEnv);
      if (typeof val === "number" && Number.isFinite(val)) {
        return { terms: new Map(), constant: val };
      }
      return null;
    }
    case "ConditionalExpr":
      return null;
  }
}

interface PolyTermData {
  coeff: number;
  degrees: Map<string, number>;
}

function monomialKey(degrees: Map<string, number>): string {
  if (degrees.size === 0) return "";
  return Array.from(degrees.entries())
    .filter(([, d]) => d > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([v, d]) => `${v}^${d}`)
    .join("*");
}

function mergePolyTerms(items: PolyTermData[]): PolyTermData[] {
  const byKey = new Map<string, PolyTermData>();
  for (const item of items) {
    if (Math.abs(item.coeff) < 1e-15) continue;
    const cleanDeg = new Map<string, number>();
    for (const [v, d] of item.degrees) {
      if (d > 0) cleanDeg.set(v, d);
    }
    const key = monomialKey(cleanDeg);
    const prev = byKey.get(key);
    if (prev) {
      prev.coeff += item.coeff;
      if (Math.abs(prev.coeff) < 1e-15) byKey.delete(key);
    } else {
      byKey.set(key, { coeff: item.coeff, degrees: cleanDeg });
    }
  }
  return Array.from(byKey.values());
}

function mulPolyTerms(a: PolyTermData[], b: PolyTermData[]): PolyTermData[] {
  const raw: PolyTermData[] = [];
  for (const ta of a) {
    for (const tb of b) {
      const deg = new Map<string, number>(ta.degrees);
      for (const [v, d] of tb.degrees) {
        deg.set(v, (deg.get(v) ?? 0) + d);
      }
      raw.push({ coeff: ta.coeff * tb.coeff, degrees: deg });
    }
  }
  return mergePolyTerms(raw);
}

function astToPolyTerms(node: SysML2ExprAst, parameterEnv: Readonly<Record<string, number>>): PolyTermData[] | null {
  switch (node.kind) {
    case "NumberLiteral":
      return Math.abs(node.value) < 1e-15 ? [] : [{ coeff: node.value, degrees: new Map() }];
    case "BooleanLiteral":
      return node.value ? [{ coeff: 1, degrees: new Map() }] : [];
    case "StringLiteral":
      return null;
    case "Identifier": {
      if (node.name in parameterEnv) {
        const val = parameterEnv[node.name]!;
        if (Number.isFinite(val)) {
          return Math.abs(val) < 1e-15 ? [] : [{ coeff: val, degrees: new Map() }];
        }
      }
      return [{ coeff: 1, degrees: new Map([[node.name, 1]]) }];
    }
    case "UnaryExpr": {
      const sub = astToPolyTerms(node.operand, parameterEnv);
      if (!sub) return null;
      if (node.op === "+") return sub;
      if (node.op === "-") {
        return sub.map((t) => ({ coeff: -t.coeff, degrees: new Map(t.degrees) }));
      }
      return null;
    }
    case "BinaryExpr": {
      if (node.op === "+" || node.op === "-") {
        const l = astToPolyTerms(node.left, parameterEnv);
        const r = astToPolyTerms(node.right, parameterEnv);
        if (!l || !r) return null;
        const rSigned = node.op === "+" ? r : r.map((t) => ({ coeff: -t.coeff, degrees: new Map(t.degrees) }));
        return mergePolyTerms([...l, ...rSigned]);
      }
      if (node.op === "*") {
        const l = astToPolyTerms(node.left, parameterEnv);
        const r = astToPolyTerms(node.right, parameterEnv);
        if (!l || !r) return null;
        return mulPolyTerms(l, r);
      }
      if (node.op === "/") {
        const l = astToPolyTerms(node.left, parameterEnv);
        const rLin = linearizeAst(node.right, parameterEnv);
        if (!l || !rLin || rLin.terms.size > 0 || Math.abs(rLin.constant) <= 1e-15) return null;
        return mergePolyTerms(l.map((t) => ({ coeff: t.coeff / rLin.constant, degrees: new Map(t.degrees) })));
      }
      if (node.op === "^") {
        const base = astToPolyTerms(node.left, parameterEnv);
        const expLin = linearizeAst(node.right, parameterEnv);
        if (!base || !expLin || expLin.terms.size > 0) return null;
        const exp = expLin.constant;
        if (!Number.isInteger(exp) || exp < 0 || exp > 12) return null;
        let acc: PolyTermData[] = [{ coeff: 1, degrees: new Map() }];
        for (let k = 0; k < exp; k++) {
          acc = mulPolyTerms(acc, base);
        }
        return acc;
      }
      return null;
    }
    case "CallExpr": {
      const val = evaluateSysML2Expression(node, parameterEnv);
      if (typeof val === "number" && Number.isFinite(val)) {
        return Math.abs(val) < 1e-15 ? [] : [{ coeff: val, degrees: new Map() }];
      }
      return null;
    }
    case "ConditionalExpr":
      return null;
  }
}

interface BranchCheckOutcome {
  feasible: boolean;
  conflictingReqs: Set<string>;
  violation?:
    | {
        expression: string;
        requirementName?: string | undefined;
        reason: string;
      }
    | undefined;
}

function checkConjunctionBranch(
  atoms: readonly DnfAtom[],
  parameterEnv: Readonly<Record<string, number>>,
): BranchCheckOutcome {
  const solver = new RealSimplexSolver();
  const bounds = new Map<
    string,
    {
      lower: number;
      lowerStrict: boolean;
      lowerSourceReq?: string | undefined;
      upper: number;
      upperStrict: boolean;
      upperSourceReq?: string | undefined;
    }
  >();

  // String literal equality/disequality tracking
  const stringEq = new Map<string, { value: string; req?: string | undefined }>();
  const stringNeq = new Map<string, { value: string; req?: string | undefined }[]>();

  interface LinearAtomRecord {
    atom: DnfAtom;
    terms: LinearTerm[];
    rhs: number;
  }
  interface NonlinearAtomRecord {
    atom: DnfAtom;
    polyTerms: PolyTermData[];
    vars: Set<string>;
  }

  const linearRecords: LinearAtomRecord[] = [];
  const nonlinearRecords: NonlinearAtomRecord[] = [];
  const allVarOrder: string[] = [];
  const varIdxMap = new Map<string, number>();

  const ensureVarIdx = (v: string): number => {
    let idx = varIdxMap.get(v);
    if (idx === undefined) {
      idx = allVarOrder.length;
      varIdxMap.set(v, idx);
      allVarOrder.push(v);
    }
    return idx;
  };

  for (const atom of atoms) {
    // 1. Handle string literal equality/disequality
    if (
      (atom.lhsAst.kind === "Identifier" && atom.rhsAst.kind === "StringLiteral") ||
      (atom.rhsAst.kind === "Identifier" && atom.lhsAst.kind === "StringLiteral")
    ) {
      const idName = atom.lhsAst.kind === "Identifier" ? atom.lhsAst.name : (atom.rhsAst as { name: string }).name;
      const strVal =
        atom.lhsAst.kind === "StringLiteral" ? atom.lhsAst.value : (atom.rhsAst as { value: string }).value;
      if (atom.op === "==") {
        const prev = stringEq.get(idName);
        if (prev && prev.value !== strVal) {
          const reqs = new Set<string>();
          if (prev.req) reqs.add(prev.req);
          if (atom.requirementName) reqs.add(atom.requirementName);
          return {
            feasible: false,
            conflictingReqs: reqs,
            violation: {
              expression: atom.expression,
              requirementName: atom.requirementName,
              reason: `Contradictory string values for '${idName}': '${prev.value}' vs '${strVal}'`,
            },
          };
        }
        const forbidden = (stringNeq.get(idName) || []).find((f) => f.value === strVal);
        if (forbidden) {
          const reqs = new Set<string>();
          if (forbidden.req) reqs.add(forbidden.req);
          if (atom.requirementName) reqs.add(atom.requirementName);
          return {
            feasible: false,
            conflictingReqs: reqs,
            violation: {
              expression: atom.expression,
              requirementName: atom.requirementName,
              reason: `Contradictory string constraint for '${idName}': cannot equal '${strVal}'`,
            },
          };
        }
        stringEq.set(idName, { value: strVal, req: atom.requirementName });
      } else {
        const prev = stringEq.get(idName);
        if (prev && prev.value === strVal) {
          const reqs = new Set<string>();
          if (prev.req) reqs.add(prev.req);
          if (atom.requirementName) reqs.add(atom.requirementName);
          return {
            feasible: false,
            conflictingReqs: reqs,
            violation: {
              expression: atom.expression,
              requirementName: atom.requirementName,
              reason: `Contradictory string constraint for '${idName}': cannot both equal and differ from '${strVal}'`,
            },
          };
        }
        const list = stringNeq.get(idName) ?? [];
        list.push({ value: strVal, req: atom.requirementName });
        stringNeq.set(idName, list);
      }
      continue;
    }

    // 2. Attempt exact linear decomposition of `lhsAst - rhsAst`
    const leftLin = linearizeAst(atom.lhsAst, parameterEnv);
    const rightLin = linearizeAst(atom.rhsAst, parameterEnv);

    if (leftLin && rightLin) {
      const merged = new Map<string, number>(leftLin.terms);
      for (const [k, v] of rightLin.terms) {
        const next = (merged.get(k) ?? 0) - v;
        if (Math.abs(next) < 1e-15) merged.delete(k);
        else merged.set(k, next);
      }
      const effectiveRhs = rightLin.constant - leftLin.constant;
      const terms: LinearTerm[] = [];
      for (const [varName, coeff] of merged) {
        ensureVarIdx(varName);
        terms.push({ varName, coeff });
      }

      // Constant-only inequality: `0 <op> effectiveRhs`
      if (terms.length === 0) {
        const sat =
          atom.op === "<="
            ? 0 <= effectiveRhs + 1e-12
            : atom.op === "<"
              ? 0 < effectiveRhs - 1e-12
              : atom.op === ">="
                ? 0 >= effectiveRhs - 1e-12
                : atom.op === ">"
                  ? 0 > effectiveRhs + 1e-12
                  : Math.abs(effectiveRhs) <= 1e-12;
        if (!sat) {
          const reqs = new Set<string>();
          if (atom.requirementName) reqs.add(atom.requirementName);
          return {
            feasible: false,
            conflictingReqs: reqs,
            violation: {
              expression: atom.expression,
              requirementName: atom.requirementName,
              reason: `Unsatisfiable constant constraint '${atom.expression}'`,
            },
          };
        }
        continue;
      }

      // Fast-path single-variable interval bound check (supports unit and scaled single-variable bounds)
      if (terms.length === 1) {
        const coeff = terms[0]!.coeff;
        const varName = terms[0]!.varName;
        const scaledRhs = effectiveRhs / coeff;
        const dirOp: ComparisonOp =
          coeff > 0
            ? atom.op
            : atom.op === "<="
              ? ">="
              : atom.op === "<"
                ? ">"
                : atom.op === ">="
                  ? "<="
                  : atom.op === ">"
                    ? "<"
                    : "==";

        const b = bounds.get(varName) ?? {
          lower: -Infinity,
          lowerStrict: false,
          upper: Infinity,
          upperStrict: false,
        };
        let violated = false;
        let priorReq: string | undefined;

        if (dirOp === "<=" || dirOp === "<") {
          const isStrict = dirOp === "<";
          if (scaledRhs < b.lower - 1e-12 || (Math.abs(scaledRhs - b.lower) <= 1e-12 && (isStrict || b.lowerStrict))) {
            violated = true;
            priorReq = b.lowerSourceReq;
          }
          if (scaledRhs < b.upper || (Math.abs(scaledRhs - b.upper) <= 1e-12 && isStrict && !b.upperStrict)) {
            b.upper = scaledRhs;
            b.upperStrict = isStrict;
            b.upperSourceReq = atom.requirementName;
          }
        } else if (dirOp === ">=" || dirOp === ">") {
          const isStrict = dirOp === ">";
          if (scaledRhs > b.upper + 1e-12 || (Math.abs(scaledRhs - b.upper) <= 1e-12 && (isStrict || b.upperStrict))) {
            violated = true;
            priorReq = b.upperSourceReq;
          }
          if (scaledRhs > b.lower || (Math.abs(scaledRhs - b.lower) <= 1e-12 && isStrict && !b.lowerStrict)) {
            b.lower = scaledRhs;
            b.lowerStrict = isStrict;
            b.lowerSourceReq = atom.requirementName;
          }
        } else {
          if (scaledRhs < b.lower - 1e-12 || (Math.abs(scaledRhs - b.lower) <= 1e-12 && b.lowerStrict)) {
            violated = true;
            priorReq = b.lowerSourceReq;
          } else if (scaledRhs > b.upper + 1e-12 || (Math.abs(scaledRhs - b.upper) <= 1e-12 && b.upperStrict)) {
            violated = true;
            priorReq = b.upperSourceReq;
          }
          b.lower = Math.max(b.lower, scaledRhs);
          b.upper = Math.min(b.upper, scaledRhs);
          b.lowerStrict = false;
          b.upperStrict = false;
          b.lowerSourceReq = atom.requirementName;
          b.upperSourceReq = atom.requirementName;
        }
        bounds.set(varName, b);

        if (violated) {
          const reqs = new Set<string>();
          if (atom.requirementName) reqs.add(atom.requirementName);
          if (priorReq) reqs.add(priorReq);
          return {
            feasible: false,
            conflictingReqs: reqs,
            violation: {
              expression: atom.expression,
              requirementName: atom.requirementName,
              reason: `Contradiction with prior bound for variable '${varName}' (evaluated bound: ${scaledRhs})`,
            },
          };
        }
      }

      linearRecords.push({ atom, terms, rhs: effectiveRhs });
      solver.addConstraint({
        requirementName: atom.requirementName,
        terms,
        operator: atom.op,
        rhs: effectiveRhs,
        expression: atom.expression,
      });

      const simplexRes = solver.solve();
      if (!simplexRes.isFeasible) {
        const reqs = new Set<string>();
        if (atom.requirementName) reqs.add(atom.requirementName);
        if (simplexRes.unsatCore) {
          for (const r of simplexRes.unsatCore) reqs.add(r);
        }
        return {
          feasible: false,
          conflictingReqs: reqs,
          violation: {
            expression: atom.expression,
            requirementName: atom.requirementName,
            reason: simplexRes.conflictExplanation ?? `Contradiction with prior bound for '${atom.lhsDisplay}'`,
          },
        };
      }
      continue;
    }

    // 3. Nonlinear polynomial constraint: `lhsAst - rhsAst <op> 0`
    const diffAst: SysML2ExprAst = {
      kind: "BinaryExpr",
      op: "-",
      left: atom.lhsAst,
      right: atom.rhsAst,
    };
    const polyTerms = astToPolyTerms(diffAst, parameterEnv);
    if (polyTerms) {
      const vars = new Set<string>();
      for (const t of polyTerms) {
        for (const [v, d] of t.degrees) {
          if (d > 0) {
            vars.add(v);
            ensureVarIdx(v);
          }
        }
      }
      if (vars.size === 0) {
        const cVal = polyTerms.reduce((acc, t) => acc + t.coeff, 0);
        const sat =
          atom.op === "<="
            ? cVal <= 1e-12
            : atom.op === "<"
              ? cVal < -1e-12
              : atom.op === ">="
                ? cVal >= -1e-12
                : atom.op === ">"
                  ? cVal > 1e-12
                  : Math.abs(cVal) <= 1e-12;
        if (!sat) {
          const reqs = new Set<string>();
          if (atom.requirementName) reqs.add(atom.requirementName);
          return {
            feasible: false,
            conflictingReqs: reqs,
            violation: {
              expression: atom.expression,
              requirementName: atom.requirementName,
              reason: `Unsatisfiable nonlinear constant constraint '${atom.expression}'`,
            },
          };
        }
      } else {
        nonlinearRecords.push({ atom, polyTerms, vars });
      }
    }
  }

  // 4. Build OctagonDBMF64 relational closure for octagonal tightening and cycle verification
  const octagon = new OctagonDBMF64(Math.max(1, allVarOrder.length));
  for (const [vName, b] of bounds) {
    const idx = varIdxMap.get(vName);
    if (idx !== undefined) {
      const lo = Number.isFinite(b.lower) ? b.lower : -OCTAGON_INF_F64;
      const hi = Number.isFinite(b.upper) ? b.upper : OCTAGON_INF_F64;
      octagon.assumeInterval(idx, lo, hi);
    }
  }
  for (const rec of linearRecords) {
    if (rec.terms.length === 2) {
      const t0 = rec.terms[0]!;
      const t1 = rec.terms[1]!;
      const i0 = varIdxMap.get(t0.varName)!;
      const i1 = varIdxMap.get(t1.varName)!;
      if (Math.abs(Math.abs(t0.coeff) - 1) < 1e-12 && Math.abs(Math.abs(t1.coeff) - 1) < 1e-12) {
        const encodeUpper = (s0: number, s1: number, bound: number) => {
          // `(s0 * x_i0) + (s1 * x_i1) <= bound`
          // In OctagonDBMF64: index `2*i` is `+x_i`, `2*i + 1` is `-x_i`; `mat[u, v]` bounds `u - v <= c`
          // `+x_i0 - x_i1 <= c` -> u=2*i0, v=2*i1 (and u'=2*i1+1, v'=2*i0+1)
          // `+x_i0 + x_i1 <= c` === `+x_i0 - (-x_i1) <= c` -> u=2*i0, v=2*i1+1 (and u'=2*i1, v'=2*i0+1)
          // `-x_i0 - x_i1 <= c` === `(-x_i0) - (+x_i1) <= c` -> u=2*i0+1, v=2*i1 (and u'=2*i1+1, v'=2*i0)
          const u = s0 > 0 ? i0 * 2 : i0 * 2 + 1;
          const v = s1 < 0 ? i1 * 2 : i1 * 2 + 1;
          octagon.setBound(u, v, bound);
          octagon.setBound(v ^ 1, u ^ 1, bound);
        };
        const c0 = t0.coeff > 0 ? 1 : -1;
        const c1 = t1.coeff > 0 ? 1 : -1;
        if (rec.atom.op === "<=" || rec.atom.op === "<" || rec.atom.op === "==") {
          encodeUpper(c0, c1, rec.rhs);
        }
        if (rec.atom.op === ">=" || rec.atom.op === ">" || rec.atom.op === "==") {
          encodeUpper(-c0, -c1, -rec.rhs);
        }
      }
    }
  }
  octagon.close();
  if (octagon.hasNegativeCycle()) {
    const simplexCheck = solver.solve();
    const reqs = new Set<string>();
    if (simplexCheck.unsatCore) {
      for (const r of simplexCheck.unsatCore) reqs.add(r);
    } else {
      for (const rec of linearRecords) {
        if (rec.atom.requirementName) reqs.add(rec.atom.requirementName);
      }
    }
    const lastAtom = linearRecords[linearRecords.length - 1]?.atom;
    return {
      feasible: false,
      conflictingReqs: reqs,
      violation: {
        expression: lastAtom?.expression ?? "",
        requirementName: lastAtom?.requirementName,
        reason: "Negative cycle detected in OctagonDBMF64 relational difference constraints",
      },
    };
  }

  // 5. Fallback to SysML2NRASolver for nonlinear polynomial subsystems (per connected variable component)
  if (nonlinearRecords.length > 0) {
    // Group nonlinear + coupled linear constraints by connected variable components
    const adj = new Map<string, Set<string>>();
    const ensureAdj = (v: string) => {
      if (!adj.has(v)) adj.set(v, new Set());
    };
    for (const nl of nonlinearRecords) {
      const vs = Array.from(nl.vars);
      for (const v of vs) {
        ensureAdj(v);
        for (const u of vs) if (u !== v) adj.get(v)!.add(u);
      }
    }
    for (const lr of linearRecords) {
      if (lr.terms.length >= 2 && lr.terms.some((t) => adj.has(t.varName))) {
        for (const t of lr.terms) ensureAdj(t.varName);
        for (const t1 of lr.terms) {
          for (const t2 of lr.terms) {
            if (t1.varName !== t2.varName) adj.get(t1.varName)!.add(t2.varName);
          }
        }
      }
    }

    const visitedVars = new Set<string>();
    for (const startVar of adj.keys()) {
      if (visitedVars.has(startVar)) continue;
      const compVars: string[] = [];
      const queue = [startVar];
      visitedVars.add(startVar);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        compVars.push(cur);
        for (const nxt of adj.get(cur) || []) {
          if (!visitedVars.has(nxt)) {
            visitedVars.add(nxt);
            queue.push(nxt);
          }
        }
      }
      const compSet = new Set(compVars);
      const compNonlinear = nonlinearRecords.filter((nl) => Array.from(nl.vars).some((v) => compSet.has(v)));
      if (compNonlinear.length === 0) continue;

      const compLinear = linearRecords.filter(
        (lr) => lr.terms.length >= 2 && lr.terms.every((t) => compSet.has(t.varName)),
      );

      const variables: Record<string, [number, number]> = {};
      const compReqs = new Set<string>();

      for (const v of compVars) {
        const idx = varIdxMap.get(v);
        const octLo = idx !== undefined ? octagon.getLowerBound(idx) : -Infinity;
        const octHi = idx !== undefined ? octagon.getUpperBound(idx) : Infinity;
        const b = bounds.get(v);
        if (b?.lowerSourceReq) compReqs.add(b.lowerSourceReq);
        if (b?.upperSourceReq) compReqs.add(b.upperSourceReq);

        const rawLo = Math.max(b?.lower ?? -Infinity, octLo);
        const rawHi = Math.min(b?.upper ?? Infinity, octHi);
        const lo = Number.isFinite(rawLo) ? rawLo : Number.isFinite(rawHi) ? Math.min(-1000, rawHi - 1000) : -1000;
        const hi = Number.isFinite(rawHi) ? rawHi : Number.isFinite(rawLo) ? Math.max(1000, rawLo + 1000) : 1000;
        variables[v] = [lo, hi];
      }

      const nraConstraints: NRAPolynomialConstraint[] = [];
      for (const nl of compNonlinear) {
        if (nl.atom.requirementName) compReqs.add(nl.atom.requirementName);
        const terms = nl.polyTerms.map((t) => new Term(t.coeff, new Map(t.degrees)));
        nraConstraints.push({
          polynomial: new Polynomial(terms, compVars),
          op: nl.atom.op as NRAPredicateOp,
        });
      }
      for (const lr of compLinear) {
        if (lr.atom.requirementName) compReqs.add(lr.atom.requirementName);
        const terms = lr.terms.map((t) => new Term(t.coeff, new Map([[t.varName, 1]])));
        if (Math.abs(lr.rhs) >= 1e-15) {
          terms.push(new Term(-lr.rhs, new Map()));
        }
        nraConstraints.push({
          polynomial: new Polynomial(terms, compVars),
          op: lr.atom.op as NRAPredicateOp,
        });
      }

      const nraRes = SysML2NRASolver.solve({
        variables,
        constraints: nraConstraints,
        tolerance: 1e-5,
        maxIterations: 1500,
      });

      if (nraRes.status === "unsat") {
        const triggerAtom = compNonlinear[compNonlinear.length - 1]!.atom;
        return {
          feasible: false,
          conflictingReqs: compReqs,
          violation: {
            expression: triggerAtom.expression,
            requirementName: triggerAtom.requirementName,
            reason: nraRes.explanation,
          },
        };
      }
    }
  }

  return { feasible: true, conflictingReqs: new Set() };
}

function solveFormulaBlocks(blocks: readonly ExtractedFormulaBlock[]): SMTRequirementCheckResult {
  if (blocks.length === 0) {
    return {
      isConsistent: true,
      conflictingRequirements: [],
      violatedConstraints: [],
    };
  }

  interface ActiveBranch {
    atoms: DnfAtom[];
    env: Record<string, number>;
  }

  let activeBranches: ActiveBranch[] = [{ atoms: [], env: {} }];

  for (const block of blocks) {
    const subBranches = expandAstToDnf(block.ast, false, block.requirementName);
    if (subBranches.length === 0) {
      return {
        isConsistent: false,
        conflictingRequirements: block.requirementName ? [block.requirementName] : [],
        violatedConstraints: [
          {
            expression: block.expression,
            requirementName: block.requirementName,
            reason: `Constraint '${block.expression}' is identically false`,
          },
        ],
      };
    }

    const nextActive: ActiveBranch[] = [];
    const stepConflicts = new Set<string>();
    let firstStepViolation: SMTRequirementCheckResult["violatedConstraints"][number] | undefined;

    for (const prev of activeBranches) {
      const mergedEnv = Object.keys(block.parameterEnv).length > 0 ? { ...prev.env, ...block.parameterEnv } : prev.env;

      for (const sub of subBranches) {
        const candidateAtoms = [...prev.atoms, ...sub];
        const check = checkConjunctionBranch(candidateAtoms, mergedEnv);
        if (check.feasible) {
          nextActive.push({ atoms: candidateAtoms, env: mergedEnv });
          if (nextActive.length >= MAX_DNF_BRANCHES) break;
        } else {
          for (const r of check.conflictingReqs) stepConflicts.add(r);
          if (block.requirementName) stepConflicts.add(block.requirementName);
          if (!firstStepViolation && check.violation) {
            firstStepViolation = check.violation;
          }
        }
      }
      if (nextActive.length >= MAX_DNF_BRANCHES) break;
    }

    if (nextActive.length === 0) {
      return {
        isConsistent: false,
        conflictingRequirements: Array.from(stepConflicts),
        violatedConstraints: [
          firstStepViolation ?? {
            expression: block.expression,
            requirementName: block.requirementName,
            reason: `Contradiction detected at constraint '${block.expression}'`,
          },
        ],
      };
    }

    activeBranches = nextActive;
  }

  return {
    isConsistent: true,
    conflictingRequirements: [],
    violatedConstraints: [],
  };
}

function hasCompoundConnective(ast: SysML2ExprAst): boolean {
  return sysmlAstSome(
    ast,
    (n) =>
      (n.kind === "UnaryExpr" && n.op === "not") ||
      (n.kind === "BinaryExpr" && (n.op === "and" || n.op === "or" || n.op === "xor" || n.op === "implies")) ||
      n.kind === "ConditionalExpr",
  );
}

/**
 * Verifies consistency of a set of SysML v2 extracted constraints.
 * Supports DNF branch expansion for compound boolean formulas (`or`, `implies`, `not`),
 * symbolic multi-variable linear constraints via `RealSimplexSolver` + `OctagonDBMF64`,
 * and nonlinear polynomial constraints via `SysML2NRASolver`.
 *
 * @param constraints - Extracted constraints from SysML v2 requirements.
 * @returns Consistency check result with conflicting requirement names and explanations.
 */
export function verifyConstraintSet(constraints: ExtractedConstraint[]): SMTRequirementCheckResult {
  if (!constraints || constraints.length === 0) {
    return {
      isConsistent: true,
      conflictingRequirements: [],
      violatedConstraints: [],
    };
  }

  const blocks: ExtractedFormulaBlock[] = [];
  for (const c of constraints) {
    let ast: SysML2ExprAst;
    if (c.expression) {
      const exprAst = parseSysML2Expression(c.expression);
      if (hasCompoundConnective(exprAst)) {
        blocks.push({
          ast: exprAst,
          expression: c.expression,
          requirementName: c.requirementName,
          constraintName: c.constraintName,
          parameterEnv: {},
        });
        continue;
      }
    }

    const lhsAst = parseSysML2Expression(c.lhs);
    let rhsAst: SysML2ExprAst;
    if (typeof c.rhs === "number") {
      rhsAst = { kind: "NumberLiteral", value: c.rhs };
    } else {
      const rhsStr = String(c.rhs).trim();
      const numVal = Number(rhsStr);
      if (rhsStr.length > 0 && Number.isFinite(numVal)) {
        rhsAst = { kind: "NumberLiteral", value: numVal };
      } else {
        rhsAst = parseSysML2Expression(rhsStr);
      }
    }

    ast = {
      kind: "BinaryExpr",
      op: c.operator,
      left: lhsAst,
      right: rhsAst,
    };

    blocks.push({
      ast,
      expression: c.expression || `${c.lhs} ${c.operator} ${c.rhs}`,
      requirementName: c.requirementName,
      constraintName: c.constraintName,
      parameterEnv: {},
    });
  }

  return solveFormulaBlocks(blocks);
}

/**
 * Validates the requirement consistency for a package or analysis scope via QueryDB.
 * Preserves full boolean formula structure (`or`, `implies`, `not`) via DNF expansion
 * rather than flattening disjunctive atoms into a conjunction.
 *
 * @param db - Active Salsa `QueryDB` containing indexed SysML v2 symbols.
 * @param scopeFilter - Optional exact package or requirement name to restrict extraction.
 * @returns Consistency verification result across all extracted requirement constraints.
 */
export function checkRequirementConsistency(db: QueryDB, scopeFilter?: string): SMTRequirementCheckResult {
  const blocks = extractSysML2FormulaBlocks(db, scopeFilter);
  if (!blocks || blocks.length === 0) {
    return {
      isConsistent: true,
      conflictingRequirements: [],
      violatedConstraints: [],
    };
  }
  return solveFormulaBlocks(blocks);
}
