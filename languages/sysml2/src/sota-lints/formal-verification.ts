// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSTNode, LintResult } from "@modelscript/dsl";
import {
  CraigInterpolator,
  DpllTSolver,
  FlowAlgebraOracle,
  Interval,
  NumericalInterval,
  type LinearConstraint as CraigLinearConstraint,
  type NonlinearConstraint,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import { KERML_STDLIB_URI } from "../../src-gen/kerml-snapshot.js";
import {
  collapseWhitespace,
  collectCstLeaves,
  findCstDescendants,
  findFirstDescendant,
  getCstChildren,
  isSysmlIdentLeaf,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
  type SysmlCstNode,
} from "../cst-utils.js";
import { SysML2ErrorCode } from "../errors.js";
import { isGuardTautologicallyFalse } from "../lints.js";
import {
  collectEffectiveSubjectAttributes,
  evaluateConstraintBody,
  evaluateExpressionNode,
  findRelationshipsTargeting,
  getConstraintKind,
  getFeatureValue,
  getRelationshipTargetName,
  metaStr,
  resolveFeatureInScope,
  resolveTypeOf,
} from "../queries.js";
import {
  parseLinearExpression,
  RealSimplexSolver,
  type LinearConstraint as SimplexLinearConstraint,
} from "../real-simplex.js";
import { checkGuardsMutuallyExclusive, parseGuardConstraints } from "../state-machine-verifier.js";
import { isStdlibOrBuiltinSymbol, normalizeTypeName, resolvePathInScope } from "../type-checker.js";
import { collectOwnExpressionSubtrees, unwrapArgOwnedExpr } from "./behavioral-modifiers.js";
import { extractMetadataTypeName } from "./hygiene-metadata.js";
import {
  cstHasError,
  emitDiag,
  extractSpecializationClauses,
  getFeatureDeclaredTypeRaw,
  getHeaderLeavesBeforeBody,
  getSymbolCst,
  getSymbolLeavesFast,
  hasFeatureValueInfo,
  hasHeaderKeyword,
  isSysmlLanguageSymbol,
  isTruthyMeta,
  narrowDiagnosticRange,
  parseExplicitMultiplicity,
  resolveSpecializationTarget,
  resolveTypeOrClassifierByName,
} from "./shared.js";
import { hasExplicitRedefinition } from "./type-hierarchy.js";
// ---------------------------------------------------------------------------
// Shared Linear Constraint Extraction for Live Formal Verification (S6xxx)
// ---------------------------------------------------------------------------

export interface ExtractedLinearAtom {
  constraintSym: SymbolEntry;
  terms: Array<{ varName: string; coeff: number }>;
  operator: "<=" | "<" | ">=" | ">" | "==";
  rhs: number;
  rawText: string;
}

function stripSubjectAlias(varName: string, subjectNames: ReadonlySet<string>): string {
  const dotIdx = varName.indexOf(".");
  if (dotIdx > 0) {
    const prefix = varName.slice(0, dotIdx);
    if (subjectNames.has(prefix)) {
      return varName.slice(dotIdx + 1);
    }
  }
  return varName;
}

function getSubjectAliasesForReq(db: QueryDB, reqSym: SymbolEntry): Set<string> {
  const aliases = new Set<string>();
  const walk = (sym: SymbolEntry, visited: Set<number>) => {
    if (visited.has(sym.id)) return;
    visited.add(sym.id);
    for (const ch of db.childrenOf(sym.id)) {
      if (ch.ruleName === "SubjectUsage" && ch.name) {
        aliases.add(ch.name);
      }
      if ((ch.ruleName === "OwnedSubclassification" || ch.ruleName === "OwnedSubsetting") && ch.name) {
        const sup = resolveTypeOrClassifierByName(db, sym.parentId, ch.name);
        if (sup) walk(sup, visited);
      }
    }
  };
  walk(reqSym, new Set<number>());
  return aliases;
}

export function extractLinearAtomsFromConstraintSymbol(
  db: QueryDB,
  constraintSym: SymbolEntry,
  subjectAliases: ReadonlySet<string>,
  evalScopeId: number | null,
): ExtractedLinearAtom[] {
  const { node: cst } = getSymbolCst(db, constraintSym);
  if (!cst || cstHasError(cst)) return [];

  const atoms: ExtractedLinearAtom[] = [];

  const walkBoolExpr = (expr: SysmlCstNode, negated: boolean) => {
    const t = expr.type;
    if (t === "AndExpression" && !negated) {
      for (const op of expr.childrenForFieldName?.("operand") ?? []) {
        walkBoolExpr(op, false);
      }
      return;
    }
    if (t === "UnaryExpression") {
      const opTok = expr.childForFieldName?.("operator")?.text?.trim();
      const inner = expr.childForFieldName?.("operand");
      if (opTok === "not" && inner) {
        walkBoolExpr(inner, !negated);
        return;
      }
    }
    if (t === "RelationalExpression" || t === "EqualityExpression") {
      let operands = expr.childrenForFieldName?.("operand") ?? [];
      let ops = (expr.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
      if (operands.length < 2 && getCstChildren(expr).length === 3) {
        const chs = getCstChildren(expr);
        operands = [chs[0]!, chs[2]!];
        ops = [chs[1]!.text.trim()];
      }
      if (operands.length < 2 || ops.length === 0) return;
      let op = ops[0]!;
      if (op === "===") op = "==";
      if (op === "!==") op = "!=";
      if (negated) {
        if (op === "<=") op = ">";
        else if (op === "<") op = ">=";
        else if (op === ">=") op = "<";
        else if (op === ">") op = "<=";
        else return;
      }
      if (op !== "<=" && op !== "<" && op !== ">=" && op !== ">" && op !== "==") return;

      const lhsVal = evaluateExpressionNode(db, operands[0]! as unknown as CSTNode, evalScopeId);
      const rhsVal = evaluateExpressionNode(db, operands[1]! as unknown as CSTNode, evalScopeId);

      const lhsLinear =
        typeof lhsVal === "number" && Number.isFinite(lhsVal)
          ? { terms: [], constant: lhsVal }
          : parseLinearExpression(operands[0]!.text);
      const rhsLinear =
        typeof rhsVal === "number" && Number.isFinite(rhsVal)
          ? { terms: [], constant: rhsVal }
          : parseLinearExpression(operands[1]!.text);

      if (lhsLinear.terms.length === 0 && rhsLinear.terms.length === 0) return;

      // Reject nonlinear expressions (`*` between variables, `/`, `(`, `[` other than unit)
      const combinedText = `${operands[0]!.text} ${operands[1]!.text}`;
      if (combinedText.includes("/") || combinedText.includes("^") || combinedText.includes("**")) return;

      const coeffByVar = new Map<string, number>();
      for (const term of lhsLinear.terms) {
        const normVar = stripSubjectAlias(term.varName, subjectAliases);
        coeffByVar.set(normVar, (coeffByVar.get(normVar) ?? 0) + term.coeff);
      }
      for (const term of rhsLinear.terms) {
        const normVar = stripSubjectAlias(term.varName, subjectAliases);
        coeffByVar.set(normVar, (coeffByVar.get(normVar) ?? 0) - term.coeff);
      }

      const terms = Array.from(coeffByVar.entries())
        .filter(([, c]) => Math.abs(c) > 1e-12)
        .map(([varName, coeff]) => ({ varName, coeff }));
      if (terms.length === 0) return;

      const effectiveRhs = rhsLinear.constant - lhsLinear.constant;
      atoms.push({
        constraintSym,
        terms,
        operator: op,
        rhs: effectiveRhs,
        rawText: collapseWhitespace(expr.text),
      });
      return;
    }

    const children = getCstChildren(expr);
    if (children.length === 1) {
      walkBoolExpr(children[0]!, negated);
      return;
    }
    for (const ch of children) {
      if (
        ch.type === "ResultExpressionMember" ||
        ch.type === "OwnedExpression" ||
        ch.type === "EqualityExpressionReference" ||
        ch.type === "EqualityExpressionMember" ||
        ch.type.endsWith("Body")
      ) {
        walkBoolExpr(ch, negated);
      }
    }
  };

  walkBoolExpr(cst, false);
  return atoms;
}

function negateLinearAtom(atom: ExtractedLinearAtom): SimplexLinearConstraint[] {
  switch (atom.operator) {
    case "<=":
      return [{ terms: atom.terms, operator: ">", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case "<":
      return [{ terms: atom.terms, operator: ">=", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case ">=":
      return [{ terms: atom.terms, operator: "<", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case ">":
      return [{ terms: atom.terms, operator: "<=", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case "==":
      return [
        { terms: atom.terms, operator: "<", rhs: atom.rhs, expression: `not (${atom.rawText})` },
        { terms: atom.terms, operator: ">", rhs: atom.rhs, expression: `not (${atom.rawText})` },
      ];
  }
}

function checkLinearEntailment(
  premises: readonly ExtractedLinearAtom[],
  goal: ExtractedLinearAtom,
): { entailed: boolean; witness?: Record<string, number> | undefined } {
  const negations = negateLinearAtom(goal);
  for (const neg of negations) {
    const solver = new RealSimplexSolver();
    for (const p of premises) {
      solver.addConstraint({
        terms: p.terms,
        operator: p.operator,
        rhs: p.rhs,
        expression: p.rawText,
      });
    }
    solver.addConstraint(neg);
    const res = solver.solve(1000);
    if (res.isFeasible) {
      return { entailed: false, witness: res.assignment };
    }
  }
  return { entailed: true };
}

function formatWitnessAssignment(witness: Record<string, number> | undefined): string {
  if (!witness) return "";
  const entries = Object.entries(witness).slice(0, 3);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${Number.isInteger(v) ? v : Number(v.toFixed(4))}`).join(", ");
}

export function toCraigConstraints(atoms: readonly ExtractedLinearAtom[]): CraigLinearConstraint[] {
  const out: CraigLinearConstraint[] = [];
  for (const a of atoms) {
    if (a.operator === "<=" || a.operator === "<") {
      const coeffs = new Map<string, number>();
      for (const t of a.terms) coeffs.set(t.varName, t.coeff);
      out.push({ coeffs, rhs: a.operator === "<" ? a.rhs - 1e-6 : a.rhs });
    } else if (a.operator === ">=" || a.operator === ">") {
      const coeffs = new Map<string, number>();
      for (const t of a.terms) coeffs.set(t.varName, -t.coeff);
      out.push({ coeffs, rhs: a.operator === ">" ? -(a.rhs + 1e-6) : -a.rhs });
    } else if (a.operator === "==") {
      const pos = new Map<string, number>();
      const neg = new Map<string, number>();
      for (const t of a.terms) {
        pos.set(t.varName, t.coeff);
        neg.set(t.varName, -t.coeff);
      }
      out.push({ coeffs: pos, rhs: a.rhs });
      out.push({ coeffs: neg, rhs: -a.rhs });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// S6001: Behavioral Liskov Contract Refinement
// ---------------------------------------------------------------------------

/**
 * Validates S6001 (`contract-refinement-violation`) using `RealSimplexSolver`.
 * Verifies contravariant preconditions (`A_super => A_sub`) and covariant guarantees
 * (`(A_super & G_sub) => G_super`) on redefined or weakened contract constraints.
 */
export function checkContractRefinement(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (
    self.ruleName !== "RequirementDefinition" &&
    self.ruleName !== "RequirementUsage" &&
    self.ruleName !== "PartDefinition"
  ) {
    return null;
  }
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const superSyms: SymbolEntry[] = [];
  for (const child of db.childrenOf(self.id)) {
    if (
      (child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "Subclassification" ||
        child.ruleName === "OwnedSubsetting") &&
      child.name
    ) {
      if (isStdlibOrBuiltinSymbol(child.name)) continue;
      const sup = resolveTypeOrClassifierByName(db, self.parentId, child.name);
      if (sup && isSysmlLanguageSymbol(sup)) superSyms.push(sup);
    }
  }
  if (superSyms.length === 0) return null;

  const subAliases = getSubjectAliasesForReq(db, self);
  const subChildren = db.childrenOf(self.id);

  const subAssumeSyms = subChildren.filter(
    (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "assume",
  );
  const subRequireSyms = subChildren.filter(
    (c) =>
      (c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require") ||
      c.ruleName === "AssertConstraintUsage" ||
      c.ruleName === "ConstraintUsage",
  );

  if (subAssumeSyms.length === 0 && subRequireSyms.length === 0) return null;

  const subAssumeAtoms = subAssumeSyms.flatMap((s) =>
    extractLinearAtomsFromConstraintSymbol(db, s, subAliases, self.id),
  );
  const diagnostics: LintResult[] = [];
  const selfName = self.name || "<anonymous>";

  for (const sup of superSyms) {
    const supAliases = new Set<string>([...subAliases, ...getSubjectAliasesForReq(db, sup)]);
    const supChildren = db.childrenOf(sup.id);

    const supAssumeSyms = supChildren.filter(
      (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "assume",
    );
    const supRequireSyms = supChildren.filter(
      (c) =>
        (c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require") ||
        c.ruleName === "AssertConstraintUsage" ||
        c.ruleName === "ConstraintUsage",
    );

    const supAssumeAtoms = supAssumeSyms.flatMap((s) =>
      extractLinearAtomsFromConstraintSymbol(db, s, supAliases, sup.id),
    );
    const supAssumeVars = new Set(supAssumeAtoms.flatMap((a) => a.terms.map((t) => t.varName)));

    // 1. Precondition contravariance: `A_super => A_sub` when overriding/tightening existing assumed variables
    for (const subAssSym of subAssumeSyms) {
      const isRedef = hasExplicitRedefinition(db, subAssSym);
      const atoms = extractLinearAtomsFromConstraintSymbol(db, subAssSym, supAliases, self.id);
      for (const atom of atoms) {
        const touchesSupVar = atom.terms.some((t) => supAssumeVars.has(t.varName));
        if (!isRedef && !touchesSupVar) continue;
        const ent = checkLinearEntailment(supAssumeAtoms, atom);
        if (!ent.entailed) {
          const wStr = formatWitnessAssignment(ent.witness);
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
              [
                selfName,
                sup.name || "<super>",
                `tightened 'assume' precondition '${atom.rawText}' rejects supertype input${wStr ? ` (${wStr})` : ""}`,
              ],
              subAssSym,
            ),
          );
          break;
        }
      }
    }

    // 2. Postcondition covariance: `(A_super & G_sub) => G_super` on redefined/overridden guarantees
    for (const subReqSym of subRequireSyms) {
      const subAtoms = extractLinearAtomsFromConstraintSymbol(db, subReqSym, supAliases, self.id);
      if (subAtoms.length === 0) continue;

      const redefTargets = extractSpecializationClauses(db, subReqSym)
        .filter((cl) => cl.ruleName === "OwnedRedefinition")
        .map((cl) => cl.targetPath.split("::").pop()?.split(".").pop()?.trim())
        .filter((x): x is string => Boolean(x));

      const isExplicitRedef = redefTargets.length > 0 || hasExplicitRedefinition(db, subReqSym);

      let matchedSuperSyms: SymbolEntry[] = [];
      if (redefTargets.length > 0) {
        matchedSuperSyms = supRequireSyms.filter((s) => s.name && redefTargets.includes(s.name));
      } else if (subReqSym.name && subReqSym.name !== "<anonymous>" && subReqSym.name !== subReqSym.ruleName) {
        matchedSuperSyms = supRequireSyms.filter((s) => s.name === subReqSym.name);
      }

      if (matchedSuperSyms.length > 0 || isExplicitRedef) {
        const targetSupSyms = matchedSuperSyms.length > 0 ? matchedSuperSyms : supRequireSyms;
        const supGuaranteeAtoms = targetSupSyms.flatMap((s) =>
          extractLinearAtomsFromConstraintSymbol(db, s, supAliases, sup.id),
        );
        for (const supAtom of supGuaranteeAtoms) {
          const ent = checkLinearEntailment([...supAssumeAtoms, ...subAtoms], supAtom);
          if (!ent.entailed) {
            const wStr = formatWitnessAssignment(ent.witness);
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
                [
                  selfName,
                  sup.name || "<super>",
                  `redefined guarantee '${subAtoms[0]!.rawText}' weakens '${supAtom.rawText}'${wStr ? ` (witness: ${wStr})` : ""}`,
                ],
                subReqSym,
              ),
            );
            break;
          }
        }
      } else {
        // Unnamed constraint over identical variable set that is strictly weaker than supertype guarantee
        const subVars = new Set(subAtoms.flatMap((a) => a.terms.map((t) => t.varName)));
        for (const supReqSym of supRequireSyms) {
          const supAtoms = extractLinearAtomsFromConstraintSymbol(db, supReqSym, supAliases, sup.id);
          if (supAtoms.length === 0) continue;
          const supVars = new Set(supAtoms.flatMap((a) => a.terms.map((t) => t.varName)));
          if (subVars.size !== supVars.size || Array.from(subVars).some((v) => !supVars.has(v))) continue;

          const supEntailsSub = subAtoms.every(
            (sa) => checkLinearEntailment([...supAssumeAtoms, ...supAtoms], sa).entailed,
          );
          const subFailsSup = supAtoms.find(
            (pa) => !checkLinearEntailment([...supAssumeAtoms, ...subAtoms], pa).entailed,
          );
          if (supEntailsSub && subFailsSup) {
            const ent = checkLinearEntailment([...supAssumeAtoms, ...subAtoms], subFailsSup);
            const wStr = formatWitnessAssignment(ent.witness);
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
                [
                  selfName,
                  sup.name || "<super>",
                  `guarantee '${subAtoms[0]!.rawText}' weakens inherited '${subFailsSup.rawText}'${wStr ? ` (witness: ${wStr})` : ""}`,
                ],
                subReqSym,
              ),
            );
            break;
          }
        }
      }
    }

    if (subAssumeAtoms.length > 0 && supAssumeAtoms.length === 0 && supRequireSyms.length > 0) {
      // Adding a new assume precondition where supertype had unconditional `true` assumption violates A_super => A_sub
      const hasStandardMeta = subChildren.some((c) => c.ruleName === "MetadataUsage");
      if (!hasStandardMeta && subAssumeSyms.some((s) => hasExplicitRedefinition(db, s))) {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
            [selfName, sup.name || "<super>", "cannot strengthen unconditional supertype assumption"],
            subAssumeSyms[0]!,
          ),
        );
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6002 & S6003: Requirement Decomposition Gap & Vacuous Assumption
// ---------------------------------------------------------------------------

/**
 * Validates S6002 (`requirement-decomposition-gap`) and S6003 (`vacuous-requirement-assumption`).
 */
export function checkRequirementDecompositionAndVacuity(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  if (self.ruleName !== "RequirementDefinition" && self.ruleName !== "RequirementUsage") return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const selfName = self.name || "<anonymous>";
  const children = db.childrenOf(self.id);
  const subjectAliases = getSubjectAliasesForReq(db, self);
  const diagnostics: LintResult[] = [];

  // 1. S6003: VACUOUS_REQUIREMENT_ASSUMPTION
  const assumeSyms = children.filter(
    (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "assume",
  );

  let assumptionsConsistent = true;
  const assumeAtoms: ExtractedLinearAtom[] = [];

  if (assumeSyms.length > 0) {
    // Check constant/tautological false assumption first
    for (const assSym of assumeSyms) {
      const staticEval = evaluateConstraintBody(db, assSym, self.id);
      if (staticEval === false) {
        assumptionsConsistent = false;
        const rawText = collapseWhitespace(db.cstText(assSym.startOffset, assSym.endOffset, assSym) || "assume false");
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.VACUOUS_REQUIREMENT_ASSUMPTION,
            [selfName, `'${rawText}' evaluates to false`],
            assSym,
          ),
        );
        break;
      }
      assumeAtoms.push(...extractLinearAtomsFromConstraintSymbol(db, assSym, subjectAliases, self.id));
    }

    // Include subject constant/domain bounds if SubjectUsage has a type
    const subjectSym = children.find((c) => c.ruleName === "SubjectUsage");
    const subjectType = subjectSym ? resolveTypeOf(db, subjectSym) : null;

    if (assumptionsConsistent && assumeAtoms.length > 0) {
      const solver = new RealSimplexSolver();
      if (subjectType) {
        for (const member of db.childrenOf(subjectType.id)) {
          if (member.kind !== "Usage" || !member.name) continue;
          const tInfo = getFeatureDeclaredTypeRaw(db, member);
          const normT = tInfo ? normalizeTypeName(tInfo.raw) : "";
          if (normT === "Positive") {
            solver.addConstraint({ terms: [{ varName: member.name, coeff: 1 }], operator: ">", rhs: 0 });
          } else if (normT === "Natural") {
            solver.addConstraint({ terms: [{ varName: member.name, coeff: 1 }], operator: ">=", rhs: 0 });
          }
          if (isTruthyMeta(member, "isConstant") || hasHeaderKeyword(db, member, "constant")) {
            const cVal = getFeatureValue(db, member, subjectType.id);
            if (typeof cVal === "number" && Number.isFinite(cVal)) {
              solver.addConstraint({ terms: [{ varName: member.name, coeff: 1 }], operator: "==", rhs: cVal });
            }
          }
        }
      }
      for (const a of assumeAtoms) {
        solver.addConstraint({
          requirementName: selfName,
          terms: a.terms,
          operator: a.operator,
          rhs: a.rhs,
          expression: a.rawText,
        });
      }
      const res = solver.solve(1000);
      if (!res.isFeasible) {
        assumptionsConsistent = false;
        const exprSummary = assumeAtoms.map((a) => a.rawText).join(" and ");
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.VACUOUS_REQUIREMENT_ASSUMPTION,
            [selfName, `contradictory assumptions: ${exprSummary}`],
            assumeSyms[assumeSyms.length - 1]!,
          ),
        );
      }
    } else if (assumptionsConsistent && assumeSyms.length >= 1) {
      // Nonlinear fallback via DPLL(T) + HC4 contractor
      const rawBodies = assumeSyms
        .map((s) => db.cstText(s.startOffset, s.endOffset, s) || "")
        .map((txt) => {
          const open = txt.indexOf("{");
          const close = txt.lastIndexOf("}");
          return open !== -1 && close > open ? txt.slice(open + 1, close).trim() : txt.trim();
        });
      const nlConstraints = rawBodies.flatMap((b) => parseGuardConstraints(b)).filter((c) => c.nonlinear);
      if (nlConstraints.length > 0) {
        const theoryLiterals = new Map<number, NonlinearConstraint>();
        const clauses: number[][] = [];
        const initialBox = new Map<string, Interval>();
        let litId = 1;
        for (const nc of nlConstraints) {
          theoryLiterals.set(litId, nc.nonlinear!);
          clauses.push([litId]);
          initialBox.set(nc.variable, new Interval(-1000, 1000));
          litId++;
        }
        const dpll = new DpllTSolver({ clauses, theoryLiterals, initialBox, delta: 1e-3, maxSubdivisions: 500 });
        if (dpll.solve(initialBox).status === "UNSAT") {
          assumptionsConsistent = false;
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.VACUOUS_REQUIREMENT_ASSUMPTION,
              [selfName, "nonlinear assumption constraints are unsatisfiable"],
              assumeSyms[0]!,
            ),
          );
        }
      }
    }
  }

  // 2. S6002: REQUIREMENT_DECOMPOSITION_GAP
  if (assumptionsConsistent) {
    const parentReqSyms = children.filter(
      (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require",
    );
    const childReqs = children.filter((c) => c.ruleName === "RequirementUsage");

    if (parentReqSyms.length >= 1 && childReqs.length >= 1) {
      const parentAtoms = parentReqSyms.flatMap((s) =>
        extractLinearAtomsFromConstraintSymbol(db, s, subjectAliases, self.id),
      );
      const childAtoms: ExtractedLinearAtom[] = [];
      for (const cr of childReqs) {
        const crAliases = new Set<string>([...subjectAliases, ...getSubjectAliasesForReq(db, cr)]);
        for (const subC of db.childrenOf(cr.id)) {
          if (subC.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, subC) === "require") {
            childAtoms.push(...extractLinearAtomsFromConstraintSymbol(db, subC, crAliases, cr.id));
          }
        }
        // Also support RequirementUsage typed by a RequirementDefinition
        const crType = resolveTypeOf(db, cr);
        if (crType && crType.ruleName === "RequirementDefinition") {
          const typeAliases = new Set<string>([...crAliases, ...getSubjectAliasesForReq(db, crType)]);
          for (const subC of db.childrenOf(crType.id)) {
            if (subC.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, subC) === "require") {
              childAtoms.push(...extractLinearAtomsFromConstraintSymbol(db, subC, typeAliases, crType.id));
            }
          }
        }
      }

      if (parentAtoms.length > 0 && childAtoms.length > 0) {
        const childVars = new Set(childAtoms.flatMap((a) => a.terms.map((t) => t.varName)));
        for (const pAtom of parentAtoms) {
          const allVarsCovered = pAtom.terms.every((t) => childVars.has(t.varName));
          if (!allVarsCovered) continue;

          const premises = [...assumeAtoms, ...childAtoms];
          const ent = checkLinearEntailment(premises, pAtom);
          if (!ent.entailed) {
            const wStr = formatWitnessAssignment(ent.witness);
            // Compute Craig interpolant explanation when child bounds are compared against strengthened region
            let interpNote = "";
            if (ent.witness) {
              const witnessAtoms: ExtractedLinearAtom[] = Object.entries(ent.witness).map(([varName, val]) => ({
                constraintSym: pAtom.constraintSym,
                terms: [{ varName, coeff: 1 }],
                operator: "==",
                rhs: val,
                rawText: `${varName} == ${val}`,
              }));
              const craigRes = CraigInterpolator.interpolateLRA(
                toCraigConstraints(witnessAtoms),
                toCraigConstraints([pAtom]),
              );
              if (craigRes.status === "INTERPOLANT_FOUND" && craigRes.summary) {
                interpNote = `; Craig separator over [${craigRes.sharedVars.join(", ")}]`;
              }
            }
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.REQUIREMENT_DECOMPOSITION_GAP,
                [
                  selfName,
                  `sub-requirements permit ${wStr || "unconstrained witness"} violating '${pAtom.rawText}'${interpNote}`,
                ],
                pAtom.constraintSym,
              ),
            );
            break;
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6011 & S6012: State Machine Zeno Chattering & Orthogonal Region Write Races
// ---------------------------------------------------------------------------

interface ParsedTransitionFast {
  sym: SymbolEntry;
  source: string;
  target: string;
  trigger: string;
  hasEventOrDelay: boolean;
  guard: string;
  assignedVars: Set<string>;
}

function extractAssignedVarsInSubtree(cst: SysmlCstNode | null | undefined): Set<string> {
  const vars = new Set<string>();
  if (!cst) return vars;
  const assignNodes = findCstDescendants(cst, "AssignActionNode");
  for (const an of assignNodes) {
    const tgt = an.childForFieldName?.("targetFeature")?.text?.trim();
    if (tgt) {
      vars.add(tgt);
      const tail = tgt.split(".").pop();
      if (tail) vars.add(tail);
    }
  }
  const leaves = collectCstLeaves(cst);
  for (let i = 0; i < leaves.length - 1; i++) {
    if (leaves[i]!.text === ":=" && i > 0 && isSysmlIdentLeaf(leaves[i - 1]!.text)) {
      vars.add(leaves[i - 1]!.text);
    } else if (leaves[i]!.text === "=:" && isSysmlIdentLeaf(leaves[i + 1]?.text)) {
      vars.add(leaves[i + 1]!.text);
    }
  }
  return vars;
}

function parseTransitionFast(db: QueryDB, trSym: SymbolEntry): ParsedTransitionFast {
  const { node: cst } = getSymbolCst(db, trSym);
  const leaves = cst ? collectCstLeaves(cst) : [];

  let source = "";
  let target = "";
  let trigger = "";
  let hasEventOrDelay = false;
  let guard = "";

  // Check top-level tokens (braceDepth === 0)
  let braceDepth = 0;
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === "{") {
      braceDepth++;
      continue;
    }
    if (tok === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth > 0) continue;

    if (tok === "first" && !source) {
      const ch = readDottedChainFromLeaves(leaves, i + 1);
      if (ch) source = ch.text;
    } else if (tok === "transition" && !source) {
      const next = leaves[i + 1]?.text;
      if (next && next !== "first" && isSysmlIdentLeaf(next)) {
        const afterNext = leaves[i + 2]?.text;
        if (afterNext !== "first") {
          const ch = readDottedChainFromLeaves(leaves, i + 1);
          if (ch) source = ch.text;
        }
      }
    } else if (tok === "accept" && !hasEventOrDelay) {
      hasEventOrDelay = true;
      const trigParts: string[] = [];
      for (let j = i + 1; j < leaves.length; j++) {
        const t = leaves[j]!.text;
        if (t === "if" || t === "do" || t === "then" || t === "{" || t === ";") break;
        trigParts.push(t);
      }
      trigger = trigParts.join(" ").trim();
    } else if ((tok === "after" || tok === "at" || tok === "when") && !hasEventOrDelay) {
      hasEventOrDelay = true;
      trigger = tok;
    } else if (tok === "if" && !guard) {
      const guardNode = cst?.childForFieldName?.("guard");
      if (guardNode) {
        guard = guardNode.text.trim();
      } else {
        const raw = db.cstText(trSym.startOffset, trSym.endOffset, trSym) || "";
        for (let j = i + 1; j < leaves.length; j++) {
          const endTok = leaves[j]!.text;
          if (endTok === "do" || endTok === "then" || endTok === "{" || endTok === ";") {
            guard = sliceBetweenLeaves(raw, leaves[i]!, leaves[j]!);
            break;
          }
        }
      }
    } else if (tok === "then" && !target) {
      const ch = readDottedChainFromLeaves(leaves, i + 1);
      if (ch) target = ch.text;
    }
  }

  const effectNode = cst?.childForFieldName?.("effect") ?? cst;
  const assignedVars = extractAssignedVarsInSubtree(effectNode);

  return { sym: trSym, source, target, trigger, hasEventOrDelay, guard, assignedVars };
}

function areGuardsJointlySatisfiable(db: QueryDB, trA: ParsedTransitionFast, trB: ParsedTransitionFast): boolean {
  if (trA.guard && isGuardTautologicallyFalse(db, trA.sym, trA.guard)) return false;
  if (trB.guard && isGuardTautologicallyFalse(db, trB.sym, trB.guard)) return false;
  if (!trA.guard || !trB.guard) return true;
  return !checkGuardsMutuallyExclusive(trA.guard, trB.guard).mutuallyExclusive;
}

/**
 * Validates S6011 (`zeno-chattering-transition-cycle`) and S6012 (`parallel-region-write-race`).
 */
export function checkStateMachineZenoAndParallelRaces(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  if (self.ruleName !== "StateDefinition" && self.ruleName !== "StateUsage" && self.ruleName !== "ExhibitStateUsage") {
    return null;
  }
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const children = db.childrenOf(self.id);
  const selfName = self.name || "state";

  // 1. S6011: ZENO_CHATTERING_TRANSITION_CYCLE (2-cycles without trigger/delay or guard-variable mutation)
  const directTransitions = children
    .filter((c) => c.ruleName === "TransitionUsage")
    .map((t) => parseTransitionFast(db, t));
  if (directTransitions.length >= 2) {
    const stateMutations = new Map<string, Set<string>>();
    for (const st of children) {
      if ((st.ruleName === "StateUsage" || st.ruleName === "ExhibitStateUsage") && st.name) {
        const { node: stCst } = getSymbolCst(db, st);
        stateMutations.set(st.name, extractAssignedVarsInSubtree(stCst));
      }
    }

    for (let i = 0; i < directTransitions.length; i++) {
      for (let j = i + 1; j < directTransitions.length; j++) {
        const t12 = directTransitions[i]!;
        const t21 = directTransitions[j]!;
        if (!t12.source || !t12.target || !t21.source || !t21.target) continue;
        if (t12.source === t12.target) continue;
        if (!(t12.source === t21.target && t12.target === t21.source)) continue;
        if (t12.hasEventOrDelay || t21.hasEventOrDelay) continue;
        if (!areGuardsJointlySatisfiable(db, t12, t21)) continue;

        const allMutated = new Set<string>([
          ...t12.assignedVars,
          ...t21.assignedVars,
          ...(stateMutations.get(t12.source) ?? []),
          ...(stateMutations.get(t12.target) ?? []),
        ]);

        const guardVars = new Set<string>();
        for (const gc of [...parseGuardConstraints(t12.guard), ...parseGuardConstraints(t21.guard)]) {
          guardVars.add(gc.variable);
          const tail = gc.variable.split(".").pop();
          if (tail) guardVars.add(tail);
        }

        const mutatesGuardVar = Array.from(guardVars).some((v) => allMutated.has(v));
        if (!mutatesGuardVar) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.ZENO_CHATTERING_TRANSITION_CYCLE,
              [`'${t12.source}' <-> '${t12.target}'`],
              t12.sym,
            ),
          );
          break;
        }
      }
      if (diagnostics.length > 0) break;
    }
  }

  // 2. S6012: PARALLEL_REGION_WRITE_RACE
  if (isTruthyMeta(self, "isParallel") || hasHeaderKeyword(db, self, "parallel")) {
    const regions = children.filter((c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage");
    if (regions.length >= 2) {
      const regionTransitions = regions.map((reg) => {
        const { node: regCst } = getSymbolCst(db, reg);
        return {
          region: reg,
          transitions: db
            .childrenOf(reg.id)
            .filter((c) => c.ruleName === "TransitionUsage")
            .map((t) => parseTransitionFast(db, t)),
          actionVars: extractAssignedVarsInSubtree(regCst),
        };
      });

      let emittedRace = false;
      for (let a = 0; a < regionTransitions.length && !emittedRace; a++) {
        for (let b = a + 1; b < regionTransitions.length && !emittedRace; b++) {
          const regA = regionTransitions[a]!;
          const regB = regionTransitions[b]!;
          for (const trA of regA.transitions) {
            if (trA.assignedVars.size === 0) continue;
            for (const trB of regB.transitions) {
              if (trB.assignedVars.size === 0) continue;
              // Normalize trigger event token (`accept sig : Sig` -> `sig` / `Sig`)
              const normTrig = (t: string) =>
                t
                  .replace(/^via\s+\S+/, "")
                  .trim()
                  .split(/\s+/)[0] ?? "";
              if (normTrig(trA.trigger) !== normTrig(trB.trigger)) continue;
              if (!areGuardsJointlySatisfiable(db, trA, trB)) continue;

              const sharedVar =
                Array.from(trA.assignedVars).find((v) => !v.includes(".") && trB.assignedVars.has(v)) ??
                Array.from(trA.assignedVars).find((v) => trB.assignedVars.has(v));

              if (sharedVar) {
                diagnostics.push(
                  emitDiag(
                    db,
                    self,
                    SysML2ErrorCode.PARALLEL_REGION_WRITE_RACE,
                    [selfName, sharedVar, regA.region.name || `region_${a + 1}`, regB.region.name || `region_${b + 1}`],
                    trB.sym,
                  ),
                );
                emittedRace = true;
                break;
              }
            }
            if (emittedRace) break;
          }

          if (!emittedRace && regA.actionVars.size > 0 && regB.actionVars.size > 0) {
            const sharedActionVar =
              Array.from(regA.actionVars).find((v) => !v.includes(".") && regB.actionVars.has(v)) ??
              Array.from(regA.actionVars).find((v) => regB.actionVars.has(v));
            if (sharedActionVar) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.PARALLEL_REGION_WRITE_RACE,
                  [
                    selfName,
                    sharedActionVar,
                    regA.region.name || `region_${a + 1}`,
                    regB.region.name || `region_${b + 1}`,
                  ],
                  regB.region,
                ),
              );
              emittedRace = true;
            }
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6020 & S6022: Abstract Interpretation Domain / Div-By-Zero & Physical Bounds
// ---------------------------------------------------------------------------

const STRICTLY_POSITIVE_TYPES = new Set<string>(["Positive"]);

const NON_NEGATIVE_PHYSICAL_TYPES = new Set<string>([
  "Natural",
  "MassValue",
  "Mass",
  "DurationValue",
  "Duration",
  "ThermodynamicTemperatureValue",
  "ThermodynamicTemperature",
  "LengthValue",
  "FrequencyValue",
  "Frequency",
  "AreaValue",
  "Area",
  "VolumeValue",
  "Volume",
]);

export function evalCstInterval(
  db: QueryDB,
  node: SysmlCstNode | null | undefined,
  scopeId: number | null,
  depth = 0,
): NumericalInterval {
  if (!node || depth > 12) return NumericalInterval.TOP;

  switch (node.type) {
    case "LiteralInteger":
    case "DECIMAL_VALUE": {
      const v = Number.parseInt(node.text.trim(), 10);
      return Number.isFinite(v) ? new NumericalInterval(v, v) : NumericalInterval.TOP;
    }
    case "LiteralReal":
    case "RealValue": {
      const v = Number.parseFloat(node.text.trim());
      return Number.isFinite(v) ? new NumericalInterval(v, v) : NumericalInterval.TOP;
    }
    case "MeasurementExpression": {
      const valNode = node.childForFieldName?.("value") ?? getCstChildren(node)[0];
      return evalCstInterval(db, valNode, scopeId, depth + 1);
    }
    case "UnaryExpression": {
      const op = node.childForFieldName?.("operator")?.text?.trim();
      const operand = node.childForFieldName?.("operand") ?? getCstChildren(node)[1];
      const inner = evalCstInterval(db, operand, scopeId, depth + 1);
      if (inner.isBottom() || inner.isTop()) return inner;
      if (op === "-") return new NumericalInterval(-inner.high, -inner.low);
      if (op === "+") return inner;
      return NumericalInterval.TOP;
    }
    case "FeatureReferenceExpression":
    case "PrimaryExpression": {
      const exprOperand = node.childForFieldName?.("operand");
      if (exprOperand) return evalCstInterval(db, exprOperand, scopeId, depth + 1);

      const refPath = node.text.trim();
      if (!refPath || refPath.includes("(")) return NumericalInterval.TOP;
      const feat = resolvePathInScope(db, scopeId, refPath) ?? resolveFeatureInScope(db, scopeId, refPath);
      if (!feat) return NumericalInterval.TOP;

      const dir = metaStr(feat, "direction");
      const valInfo = hasFeatureValueInfo(db, feat);
      // Do not treat an unbound or default-valued `in` parameter as a fixed constant
      if ((dir !== "in" && dir !== "inout") || (valInfo.hasValue && !valInfo.isDefault)) {
        const scalar = getFeatureValue(db, feat, feat.parentId ?? scopeId);
        if (typeof scalar === "number" && Number.isFinite(scalar)) {
          return new NumericalInterval(scalar, scalar);
        }
      }

      const tInfo = getFeatureDeclaredTypeRaw(db, feat);
      const normT = tInfo ? normalizeTypeName(tInfo.raw) : "";
      if (STRICTLY_POSITIVE_TYPES.has(normT)) return new NumericalInterval(1e-12, Infinity);
      if (NON_NEGATIVE_PHYSICAL_TYPES.has(normT)) return new NumericalInterval(0, Infinity);
      return NumericalInterval.TOP;
    }
    case "AdditiveExpression":
    case "MultiplicativeExpression": {
      const operands = node.childrenForFieldName?.("operand") ?? [];
      const ops = (node.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
      if (operands.length < 2 || ops.length < operands.length - 1) {
        return operands[0] ? evalCstInterval(db, operands[0], scopeId, depth + 1) : NumericalInterval.TOP;
      }
      let acc = evalCstInterval(db, operands[0]!, scopeId, depth + 1);
      for (let i = 0; i < ops.length; i++) {
        const rhs = evalCstInterval(db, operands[i + 1]!, scopeId, depth + 1);
        const op = ops[i]!;
        if (op === "+") acc = acc.add(rhs);
        else if (op === "-") acc = acc.sub(rhs);
        else if (op === "*") acc = acc.mul(rhs);
        else if (op === "/") acc = acc.div(rhs).result;
        else return NumericalInterval.TOP;
      }
      return acc;
    }
    default: {
      const chs = getCstChildren(node);
      if (chs.length === 1) return evalCstInterval(db, chs[0]!, scopeId, depth + 1);
      for (const ch of chs) {
        if (ch.type === "(" || ch.text === "(" || ch.type === ")" || ch.text === ")") continue;
        if (ch.type.includes("Expression") || ch.type.includes("Literal") || ch.type === "SequenceExpression") {
          return evalCstInterval(db, ch, scopeId, depth + 1);
        }
      }
      return NumericalInterval.TOP;
    }
  }
}

/**
 * Validates S6020 (`calc-domain-or-div-zero`) and S6022 (`physical-domain-impossibility`).
 */
export function checkCalcAndFeatureAbstractInterpretation(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst || cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const ownerName = self.name && self.name !== "<anonymous>" ? self.name : self.ruleName;
  const evalScopeId =
    self.ruleName === "CalculationDefinition" ||
    self.ruleName === "CalculationUsage" ||
    self.ruleName === "ConstraintDefinition"
      ? self.id
      : (self.parentId ?? self.id);

  // 1. S6020: Division/modulo by zero and math domain violations (`sqrt`, `log`/`ln`, `asin`/`acos`)
  if (
    self.ruleName === "CalculationDefinition" ||
    self.ruleName === "CalculationUsage" ||
    self.ruleName === "ConstraintDefinition" ||
    self.ruleName === "ConstraintUsage" ||
    self.ruleName === "AssertConstraintUsage" ||
    self.ruleName === "RequirementConstraintUsage" ||
    self.ruleName === "AttributeUsage" ||
    self.ruleName === "ReferenceUsage" ||
    self.ruleName === "DefaultReferenceUsage"
  ) {
    const exprNodes = collectOwnExpressionSubtrees(
      db,
      self,
      cst,
      baseOffset,
      new Set(["MultiplicativeExpression", "InvocationExpression"]),
    );

    for (const en of exprNodes) {
      if (en.type === "MultiplicativeExpression") {
        const operands = en.childrenForFieldName?.("operand") ?? [];
        const ops = (en.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
        for (let i = 0; i < ops.length && i + 1 < operands.length; i++) {
          const op = ops[i]!;
          if (op !== "/" && op !== "%") continue;
          const denomNode = operands[i + 1]!;
          const iv = evalCstInterval(db, denomNode, evalScopeId);
          if (!iv.isBottom() && iv.low === 0 && iv.high === 0) {
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
                [
                  ownerName,
                  `definite ${op === "%" ? "modulo" : "division"} by zero ('${collapseWhitespace(en.text)}')`,
                ],
                { node: denomNode, baseOffset },
              ),
            );
          }
        }
      } else if (en.type === "InvocationExpression") {
        const fnRaw = (en.childForFieldName?.("type") ?? getCstChildren(en)[0])?.text?.trim() ?? "";
        const fnShort = normalizeTypeName(fnRaw.split(".").pop() || fnRaw).toLowerCase();
        if (
          fnShort !== "sqrt" &&
          fnShort !== "log" &&
          fnShort !== "ln" &&
          fnShort !== "log10" &&
          fnShort !== "asin" &&
          fnShort !== "acos"
        ) {
          continue;
        }
        const firstArgMember = findFirstDescendant(en, "ArgumentMember");
        const argExpr = unwrapArgOwnedExpr(firstArgMember);
        if (!argExpr) continue;
        const iv = evalCstInterval(db, argExpr, evalScopeId);
        if (iv.isBottom() || iv.isTop()) continue;

        if (fnShort === "sqrt" && iv.high < 0) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
              [ownerName, `'sqrt' argument interval [${iv.low}, ${iv.high}] is strictly negative`],
              { node: argExpr, baseOffset },
            ),
          );
        } else if ((fnShort === "log" || fnShort === "ln" || fnShort === "log10") && iv.high <= 0) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
              [ownerName, `'${fnShort}' argument interval [${iv.low}, ${iv.high}] is non-positive`],
              { node: argExpr, baseOffset },
            ),
          );
        } else if ((fnShort === "asin" || fnShort === "acos") && (iv.high < -1 || iv.low > 1)) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
              [ownerName, `'${fnShort}' argument interval [${iv.low}, ${iv.high}] lies outside [-1, 1]`],
              { node: argExpr, baseOffset },
            ),
          );
        }
      }
    }
  }

  // 2. S6022: PHYSICAL_DOMAIN_IMPOSSIBILITY
  if (
    self.ruleName === "AttributeUsage" ||
    self.ruleName === "ReferenceUsage" ||
    self.ruleName === "DefaultReferenceUsage" ||
    self.ruleName === "ItemUsage"
  ) {
    let typeRaw = getFeatureDeclaredTypeRaw(db, self)?.raw ?? null;
    if (!typeRaw) {
      for (const cl of extractSpecializationClauses(db, self)) {
        const base = resolveSpecializationTarget(db, self, cl.targetPath, cl.ruleName);
        if (base) {
          typeRaw = getFeatureDeclaredTypeRaw(db, base)?.raw ?? null;
          if (typeRaw) break;
        }
      }
    }

    if (typeRaw) {
      const normType = normalizeTypeName(typeRaw);
      const isPositiveType = STRICTLY_POSITIVE_TYPES.has(normType);
      const isNonNegativeType = NON_NEGATIVE_PHYSICAL_TYPES.has(normType);

      if (isPositiveType || isNonNegativeType) {
        let valueExpr: SysmlCstNode | null = null;
        for (const ch of getCstChildren(cst)) {
          if (ch.type === "{" || ch.text === "{") break;
          if (ch.type === "FeatureValue" || ch.type === "_ValuePart" || ch.type === "ValuePart") {
            valueExpr =
              findFirstDescendant(ch, "OwnedExpression") ?? ch.childForFieldName?.("ownedRelatedElement") ?? ch;
            break;
          }
          if (ch.type === "OwnedExpression") {
            valueExpr = ch;
            break;
          }
        }

        if (valueExpr) {
          const iv = evalCstInterval(db, valueExpr, self.parentId ?? self.id);
          if (!iv.isBottom() && !iv.isTop()) {
            const measNode =
              valueExpr.type === "MeasurementExpression"
                ? valueExpr
                : findFirstDescendant(valueExpr, "MeasurementExpression");
            const unitText = measNode?.childForFieldName?.("unit")?.text?.trim() ?? "";
            const isTempType = normType === "ThermodynamicTemperatureValue" || normType === "ThermodynamicTemperature";

            if (isPositiveType && iv.high <= 0) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                  [ownerName, typeRaw, `value ${iv.high} violates strictly positive domain (> 0)`],
                  { node: valueExpr, baseOffset },
                ),
              );
            } else if (isTempType && (unitText === "degC" || unitText === "°C")) {
              if (iv.high < -273.15) {
                diagnostics.push(
                  emitDiag(
                    db,
                    self,
                    SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                    [ownerName, typeRaw, `temperature ${iv.high} [degC] is below absolute zero (-273.15 degC)`],
                    { node: valueExpr, baseOffset },
                  ),
                );
              }
            } else if (isTempType && (unitText === "degF" || unitText === "°F")) {
              if (iv.high < -459.67) {
                diagnostics.push(
                  emitDiag(
                    db,
                    self,
                    SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                    [ownerName, typeRaw, `temperature ${iv.high} [degF] is below absolute zero (-459.67 degF)`],
                    { node: valueExpr, baseOffset },
                  ),
                );
              }
            } else if (isNonNegativeType && iv.high < 0) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                  [ownerName, typeRaw, `negative value ${iv.high} violates non-negative physical domain (>= 0)`],
                  { node: valueExpr, baseOffset },
                ),
              );
            }
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6030, S6032, S6041: Structural Balance, Flow Driver Conflict & Budget Roll-Up
// ---------------------------------------------------------------------------

const ADDITIVE_EXTENSIVE_PREFIXES = [
  "mass",
  "weight",
  "power",
  "cost",
  "price",
  "energy",
  "current",
  "area",
  "volume",
  "heat",
  "dissipation",
  "load",
  "budget",
  "capacity",
  "latency",
  "bandwidth",
  "memory",
  "storage",
  "total",
  "sum",
];

function isAdditiveExtensiveAttribute(attrName: string): boolean {
  const lower = attrName.toLowerCase();
  return ADDITIVE_EXTENSIVE_PREFIXES.some((p) => lower === p || lower.startsWith(p) || lower.endsWith(p));
}

export function extractBindingEndpoints(db: QueryDB, bindSym: SymbolEntry): [string, string] | null {
  const refs = db.childrenOf(bindSym.id).filter((c) => c.kind === "Reference");
  const readRef = (ref: SymbolEntry): string => {
    const chain = db.childrenOf(ref.id).filter((c) => c.name && c.name !== "<anonymous>");
    if (chain.length > 0) return chain.map((c) => c.name).join(".");
    if (ref.name && ref.name !== "OwnedReferenceSubsetting") return ref.name.trim();
    return (db.cstText(ref.startOffset, ref.endOffset, ref) || "").trim();
  };
  if (refs.length >= 2) {
    const a = readRef(refs[0]!);
    const b = readRef(refs[1]!);
    if (a && b) return [a, b];
  }
  const { leaves } = getSymbolLeavesFast(db, bindSym);
  const bindIdx = leaves.findIndex((l) => l.text === "bind");
  if (bindIdx !== -1) {
    const lhs = readDottedChainFromLeaves(leaves, bindIdx + 1);
    if (lhs && leaves[lhs.nextIdx]?.text === "=") {
      const rhs = readDottedChainFromLeaves(leaves, lhs.nextIdx + 1);
      if (rhs) return [lhs.text, rhs.text];
    }
  }
  return null;
}

export function extractFlowEndpointsFast(db: QueryDB, flowSym: SymbolEntry): { source: string; target: string } | null {
  const { leaves } = getSymbolLeavesFast(db, flowSym);
  let braceDepth = 0;
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === "{") braceDepth++;
    else if (tok === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (braceDepth > 0) continue;

    if (tok === "from") {
      const src = readDottedChainFromLeaves(leaves, i + 1);
      if (src && leaves[src.nextIdx]?.text === "to") {
        const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
        if (tgt) return { source: src.text, target: tgt.text };
      }
    }
  }
  const flowIdx = leaves.findIndex((l) => l.text === "flow");
  if (flowIdx !== -1) {
    let src = readDottedChainFromLeaves(leaves, flowIdx + 1);
    if (src && leaves[src.nextIdx]?.text !== "to") {
      src = readDottedChainFromLeaves(leaves, src.nextIdx);
    }
    if (src && leaves[src.nextIdx]?.text === "to") {
      const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
      if (tgt) return { source: src.text, target: tgt.text };
    }
  }
  return null;
}

function getEffectiveLowerMultiplicity(db: QueryDB, partUsage: SymbolEntry): number {
  const mult = parseExplicitMultiplicity(db, partUsage);
  return mult ? mult.lower : 1;
}

function computeMinimumChildRollup(
  db: QueryDB,
  container: SymbolEntry,
  attrNames: readonly string[],
  visited = new Set<number>(),
): { sum: number; contributorCount: number } {
  if (visited.has(container.id)) return { sum: 0, contributorCount: 0 };
  visited.add(container.id);

  let sum = 0;
  let contributorCount = 0;

  for (const child of db.childrenOf(container.id)) {
    if (child.ruleName !== "PartUsage") continue;
    if (isTruthyMeta(child, "isRef") || hasHeaderKeyword(db, child, "ref")) continue;

    const lowerMult = getEffectiveLowerMultiplicity(db, child);
    if (lowerMult <= 0) continue;

    const childAttrs = collectEffectiveSubjectAttributes(db, child);
    let matchedVal: number | undefined;
    for (const candName of attrNames) {
      const v = childAttrs.get(candName);
      if (typeof v === "number" && Number.isFinite(v)) {
        matchedVal = v;
        break;
      }
    }
    if (matchedVal === undefined) {
      const partDef = resolveTypeOf(db, child);
      if (partDef) {
        for (const defChild of db.childrenOf(partDef.id)) {
          if (defChild.ruleName === "AttributeUsage" && defChild.name && attrNames.includes(defChild.name)) {
            const dv = getFeatureValue(db, defChild, partDef.id);
            if (typeof dv === "number" && Number.isFinite(dv)) {
              matchedVal = dv;
              break;
            }
          }
        }
      }
    }

    if (matchedVal !== undefined) {
      sum += lowerMult * matchedVal;
      contributorCount++;
    } else {
      const nested = computeMinimumChildRollup(db, child, attrNames, visited);
      if (nested.contributorCount > 0) {
        sum += lowerMult * nested.sum;
        contributorCount += nested.contributorCount;
      }
    }
  }

  return { sum, contributorCount };
}

/**
 * Validates S6030 (`over-or-under-constrained-part`), S6032 (`flow-network-driver-conflict`),
 * and S6041 (`multiplicity-budget-rollup-violation`).
 */
export function checkStructuralBalanceAndRollup(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (self.ruleName !== "PartDefinition" && self.ruleName !== "PartUsage") return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const children = db.childrenOf(self.id);
  const selfName = self.name || "part";

  // 1. S6030: OVER_OR_UNDER_CONSTRAINED_PART (scalar binding connector & equality equation balance)
  if (self.ruleName === "PartDefinition") {
    const bindings = children.filter((c) => c.ruleName === "BindingConnectorAsUsage");
    const assertEqSyms = children.filter(
      (c) => c.ruleName === "AssertConstraintUsage" || c.ruleName === "ConstraintUsage",
    );

    if (bindings.length > 0 || assertEqSyms.length > 1) {
      const solver = new RealSimplexSolver();
      const parentMap = new Map<string, string>();
      const findRoot = (x: string): string => {
        let r = x;
        while (parentMap.has(r) && parentMap.get(r) !== r) r = parentMap.get(r)!;
        return r;
      };
      const unionVars = (a: string, b: string) => {
        const ra = findRoot(a);
        const rb = findRoot(b);
        if (ra !== rb) parentMap.set(ra, rb);
      };

      const fixedValues = new Map<string, number>();
      const allVars = new Set<string>();
      const eqEdges: Array<{ vars: string[]; sym: SymbolEntry; desc: string }> = [];

      const registerVar = (pathStr: string) => {
        allVars.add(pathStr);
        if (!parentMap.has(pathStr)) parentMap.set(pathStr, pathStr);
        const resolved = resolvePathInScope(db, self.id, pathStr) ?? resolveFeatureInScope(db, self.id, pathStr);
        if (resolved && !fixedValues.has(pathStr)) {
          const vInfo = hasFeatureValueInfo(db, resolved);
          if (vInfo.hasValue && !vInfo.isDefault) {
            const val = getFeatureValue(db, resolved, resolved.parentId ?? self.id);
            if (typeof val === "number" && Number.isFinite(val)) {
              fixedValues.set(pathStr, val);
              solver.addConstraint({
                terms: [{ varName: pathStr, coeff: 1 }],
                operator: "==",
                rhs: val,
                expression: `${pathStr} == ${val}`,
              });
            }
          }
        }
      };

      const seenPairs = new Set<string>();
      for (const bSym of bindings) {
        const pair = extractBindingEndpoints(db, bSym);
        if (!pair) continue;
        const [lhs, rhs] = pair;
        if (lhs === rhs) continue;
        const pairKey = lhs < rhs ? `${lhs}=${rhs}` : `${rhs}=${lhs}`;
        registerVar(lhs);
        registerVar(rhs);
        unionVars(lhs, rhs);
        eqEdges.push({ vars: [lhs, rhs], sym: bSym, desc: `bind ${lhs} = ${rhs}` });
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          solver.addConstraint({
            terms: [
              { varName: lhs, coeff: 1 },
              { varName: rhs, coeff: -1 },
            ],
            operator: "==",
            rhs: 0,
            expression: `${lhs} == ${rhs}`,
          });
        }
      }

      for (const aSym of assertEqSyms) {
        const atoms = extractLinearAtomsFromConstraintSymbol(db, aSym, new Set(), self.id).filter(
          (at) => at.operator === "==",
        );
        for (const at of atoms) {
          const vNames = at.terms.map((t) => t.varName);
          for (const v of vNames) registerVar(v);
          for (let k = 1; k < vNames.length; k++) unionVars(vNames[0]!, vNames[k]!);
          eqEdges.push({ vars: vNames, sym: aSym, desc: at.rawText });
          solver.addConstraint({
            terms: at.terms,
            operator: "==",
            rhs: at.rhs,
            expression: at.rawText,
          });
        }
      }

      if (eqEdges.length > 0) {
        const solveRes = solver.solve(1000);
        if (!solveRes.isFeasible) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.OVER_OR_UNDER_CONSTRAINED_PART,
              [selfName, "contradictory scalar bindings / equality constraints have no solution"],
              eqEdges[eqEdges.length - 1]!.sym,
            ),
          );
        } else {
          // Check equation count vs variable count per connected component
          const varsByComp = new Map<string, Set<string>>();
          const eqsByComp = new Map<string, number>();
          for (const v of allVars) {
            const r = findRoot(v);
            if (!varsByComp.has(r)) varsByComp.set(r, new Set());
            varsByComp.get(r)!.add(v);
          }
          for (const eq of eqEdges) {
            if (eq.vars.length === 0) continue;
            const r = findRoot(eq.vars[0]!);
            eqsByComp.set(r, (eqsByComp.get(r) ?? 0) + 1);
          }
          for (const [r, compVars] of varsByComp) {
            const fixedCount = Array.from(compVars).filter((v) => fixedValues.has(v)).length;
            const eqCount = eqsByComp.get(r) ?? 0;
            if (fixedCount + eqCount > compVars.size) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.OVER_OR_UNDER_CONSTRAINED_PART,
                  [
                    selfName,
                    `over-constrained component (${fixedCount + eqCount} scalar equations for ${compVars.size} variable(s): ${Array.from(compVars).join(", ")})`,
                  ],
                  eqEdges[eqEdges.length - 1]!.sym,
                ),
              );
              break;
            }
          }
        }
      }
    }
  }

  // 2. S6032: FLOW_NETWORK_DRIVER_CONFLICT
  const flows = children.filter((c) => c.ruleName === "FlowUsage" || c.ruleName === "SuccessionFlowUsage");
  if (flows.length >= 2) {
    const driversByTarget = new Map<string, { sources: Set<string>; lastFlow: SymbolEntry }>();
    for (const fl of flows) {
      const ep = extractFlowEndpointsFast(db, fl);
      if (!ep || !ep.source || !ep.target) continue;
      let rec = driversByTarget.get(ep.target);
      if (!rec) {
        rec = { sources: new Set<string>(), lastFlow: fl };
        driversByTarget.set(ep.target, rec);
      }
      rec.sources.add(ep.source);
      rec.lastFlow = fl;
    }

    for (const [targetPath, rec] of driversByTarget) {
      if (rec.sources.size < 2) continue;
      const targetSym = resolvePathInScope(db, self.id, targetPath) ?? resolveFeatureInScope(db, self.id, targetPath);
      if (targetSym) {
        const mult = parseExplicitMultiplicity(db, targetSym);
        if (mult && mult.upper > 1) continue;
      }
      const driversList = Array.from(rec.sources)
        .map((s) => `'${s}'`)
        .join(", ");
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT, [targetPath, driversList], rec.lastFlow),
      );
    }
  }

  // 2b. S6032 Enhancement: Steady-state Kirchhoff flow conservation via FlowAlgebraOracle
  const selfIsConserved = hasConservedFlowAnnotation(db, self);
  if (selfIsConserved) {
    const dirFlowPorts: Array<{ dir: "in" | "out"; rate: number; sym: SymbolEntry; name: string }> = [];
    let allBound = true;
    const oracle = new FlowAlgebraOracle();
    let litCounter = 1;

    for (const ch of children) {
      if (ch.kind !== "Usage") continue;
      const dir = metaStr(ch, "direction");
      if (dir !== "in" && dir !== "out") continue;
      const extracted = extractConservedFlowRate(db, ch, self.id);
      if (!extracted) {
        allBound = false;
        break;
      }
      const pName = ch.name || `port_${ch.id}`;
      const pType = `ConservedPort_${ch.id}`;
      oracle.assertLiteral({
        id: litCounter++,
        predicate: "portType",
        args: [pType, [{ name: extracted.attrName, direction: dir, isFlow: true }]],
      });
      oracle.assertLiteral({
        id: litCounter++,
        predicate: "portUsage",
        args: [pName, pType, false],
      });
      dirFlowPorts.push({ dir, rate: extracted.value, sym: ch, name: pName });
    }

    const inPorts = dirFlowPorts.filter((p) => p.dir === "in");
    const outPorts = dirFlowPorts.filter((p) => p.dir === "out");
    if (allBound && inPorts.length >= 1 && outPorts.length >= 1) {
      oracle.checkSat();
      const sumIn = inPorts.reduce((acc, p) => acc + p.rate, 0);
      const sumOut = outPorts.reduce((acc, p) => acc + p.rate, 0);
      if (Math.abs(sumIn - sumOut) > 1e-6) {
        const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString());
        diagnostics.push({
          code: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.code,
          severity: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.severity,
          message: `Steady-state flow conservation violated on '${selfName}': inflow sum (${fmt(sumIn)}) != outflow sum (${fmt(sumOut)}).`,
          ...narrowDiagnosticRange(db, self, outPorts[outPorts.length - 1]!.sym),
        });
      }
    }
  }

  if (flows.length >= 2) {
    const inflowsByPart = new Map<string, Array<{ flowSym: SymbolEntry; endpoint: string }>>();
    const outflowsByPart = new Map<string, Array<{ flowSym: SymbolEntry; endpoint: string }>>();

    for (const fl of flows) {
      const ep = extractFlowEndpointsFast(db, fl);
      if (!ep || !ep.source || !ep.target) continue;
      const srcRoot = ep.source.split(".")[0]!;
      const tgtRoot = ep.target.split(".")[0]!;
      if (srcRoot === tgtRoot) continue;
      if (!outflowsByPart.has(srcRoot)) outflowsByPart.set(srcRoot, []);
      outflowsByPart.get(srcRoot)!.push({ flowSym: fl, endpoint: ep.source });
      if (!inflowsByPart.has(tgtRoot)) inflowsByPart.set(tgtRoot, []);
      inflowsByPart.get(tgtRoot)!.push({ flowSym: fl, endpoint: ep.target });
    }

    for (const [partName, inList] of inflowsByPart) {
      const outList = outflowsByPart.get(partName);
      if (!outList || inList.length === 0 || outList.length === 0) continue;
      const partSym = children.find((c) => c.ruleName === "PartUsage" && c.name === partName);
      if (!partSym) continue;

      const explicitNodeConserved = selfIsConserved || hasConservedFlowAnnotation(db, partSym);
      let sumIn = 0;
      let sumOut = 0;
      let allIncidentBound = true;
      const attrKinds = new Set<string>();

      for (const item of inList) {
        const rateInfo =
          extractConservedFlowRate(db, item.flowSym, self.id) ??
          extractEndpointConservedFlowRate(db, self.id, item.endpoint);
        if (!rateInfo) {
          allIncidentBound = false;
          break;
        }
        sumIn += rateInfo.value;
        attrKinds.add(rateInfo.attrName);
      }

      for (const item of outList) {
        if (!allIncidentBound) break;
        const rateInfo =
          extractConservedFlowRate(db, item.flowSym, self.id) ??
          extractEndpointConservedFlowRate(db, self.id, item.endpoint);
        if (!rateInfo) {
          allIncidentBound = false;
          break;
        }
        sumOut += rateInfo.value;
        attrKinds.add(rateInfo.attrName);
      }

      if (allIncidentBound && (explicitNodeConserved || attrKinds.size === 1) && Math.abs(sumIn - sumOut) > 1e-6) {
        const oracle = new FlowAlgebraOracle();
        oracle.assert1DPortValues({ portName: `${partName}_in`, massFlow: sumIn, pressure: 0 });
        oracle.assertSpatialFlux({ patchName: `${partName}_out`, integratedMassFlow: -sumOut, meanPressure: 0 });
        oracle.connect1Dto3D(`${partName}_in`, `${partName}_out`);
        const satRes = oracle.checkSat();
        if (!satRes.isSat || Math.abs(sumIn - sumOut) > 1e-6) {
          const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString());
          diagnostics.push({
            code: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.code,
            severity: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.severity,
            message: `Steady-state flow conservation violated at junction '${partName}': inflow sum (${fmt(sumIn)}) != outflow sum (${fmt(sumOut)}).`,
            ...narrowDiagnosticRange(db, self, outList[outList.length - 1]!.flowSym),
          });
        }
      }
    }
  }

  // 3. S6041: MULTIPLICITY_BUDGET_ROLLUP_VIOLATION
  const hasCompositeSubparts = children.some(
    (c) => c.ruleName === "PartUsage" && !isTruthyMeta(c, "isRef") && !hasHeaderKeyword(db, c, "ref"),
  );
  if (hasCompositeSubparts) {
    const upperBoundBudgets: Array<{ attr: string; limit: number; strict: boolean; sourceSym: SymbolEntry }> = [];

    // (a) Direct `assert constraint` / `constraint` on `self`
    for (const ch of children) {
      if (ch.ruleName !== "AssertConstraintUsage" && ch.ruleName !== "ConstraintUsage") continue;
      const scopedAtoms = extractLinearAtomsFromConstraintSymbol(db, ch, new Set([selfName]), self.id);
      const atoms =
        scopedAtoms.length > 0
          ? scopedAtoms
          : extractLinearAtomsFromConstraintSymbol(db, ch, new Set([selfName]), null);
      for (const at of atoms) {
        if (at.terms.length === 1 && at.terms[0]!.coeff > 0 && (at.operator === "<=" || at.operator === "<")) {
          const attr = at.terms[0]!.varName;
          const limit = at.rhs / at.terms[0]!.coeff;
          if (isAdditiveExtensiveAttribute(attr)) {
            upperBoundBudgets.push({ attr, limit, strict: at.operator === "<", sourceSym: ch });
          }
        }
      }
    }

    // (a2) Direct `max<Attr>` / `total<Attr>` / `<attr>Budget` / `<attr>Limit` attributes on `self`
    for (const ch of children) {
      if (ch.ruleName !== "AttributeUsage" || !ch.name) continue;
      const nm = ch.name;
      if (nm.startsWith("max") || nm.startsWith("total") || nm.endsWith("Budget") || nm.endsWith("Limit")) {
        const val = getFeatureValue(db, ch, self.id);
        if (typeof val === "number" && Number.isFinite(val) && val > 0 && isAdditiveExtensiveAttribute(nm)) {
          upperBoundBudgets.push({ attr: nm, limit: val, strict: false, sourceSym: ch });
        }
      }
    }

    // (b) Satisfied requirements (owned `satisfy Req;` or external `satisfy Req by <selfName>;`)
    const satisfiedReqs: Array<{ reqSym: SymbolEntry; satSym: SymbolEntry }> = [];
    for (const ch of children) {
      if (ch.ruleName === "SatisfyRequirementUsage") {
        const reqName = getRelationshipTargetName(db, ch);
        if (reqName) {
          const rSym = db
            .byName(reqName)
            .find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage");
          if (rSym) satisfiedReqs.push({ reqSym: rSym, satSym: ch });
        }
      }
    }
    if (self.parentId !== null && self.name) {
      for (const sib of db.childrenOf(self.parentId)) {
        if (sib.ruleName !== "SatisfyRequirementUsage") continue;
        const { leaves } = getSymbolLeavesFast(db, sib);
        const byIdx = leaves.findIndex((l) => l.text === "by");
        const byTarget = byIdx !== -1 ? readDottedChainFromLeaves(leaves, byIdx + 1)?.text : null;
        if (byTarget === self.name) {
          const reqName = getRelationshipTargetName(db, sib);
          if (reqName) {
            const rSym = db
              .byName(reqName)
              .find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage");
            if (rSym) satisfiedReqs.push({ reqSym: rSym, satSym: sib });
          }
        }
      }
    }
    if (self.name && self.kind === "Definition") {
      for (const rel of findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"])) {
        void rel;
      }
    }

    for (const { reqSym, satSym } of satisfiedReqs) {
      const aliases = new Set<string>([selfName, ...getSubjectAliasesForReq(db, reqSym)]);
      for (const rChild of db.childrenOf(reqSym.id)) {
        if (rChild.ruleName !== "RequirementConstraintUsage" || getConstraintKind(db, rChild) !== "require") continue;
        const scopedAtoms = extractLinearAtomsFromConstraintSymbol(db, rChild, aliases, reqSym.id);
        const atoms =
          scopedAtoms.length > 0 ? scopedAtoms : extractLinearAtomsFromConstraintSymbol(db, rChild, aliases, null);
        for (const at of atoms) {
          if (at.terms.length === 1 && at.terms[0]!.coeff > 0 && (at.operator === "<=" || at.operator === "<")) {
            const attr = at.terms[0]!.varName;
            const limit = at.rhs / at.terms[0]!.coeff;
            if (isAdditiveExtensiveAttribute(attr)) {
              upperBoundBudgets.push({
                attr,
                limit,
                strict: at.operator === "<",
                sourceSym: satSym.parentId === self.id ? satSym : self,
              });
            }
          }
        }
      }
    }

    const checkedAttrs = new Set<string>();
    for (const budget of upperBoundBudgets) {
      if (checkedAttrs.has(budget.attr)) continue;
      checkedAttrs.add(budget.attr);

      const candidateNames = [budget.attr];
      if (budget.attr.startsWith("total") && budget.attr.length > 5) {
        const stripped = budget.attr[5]!.toLowerCase() + budget.attr.slice(6);
        candidateNames.push(stripped);
      } else if (budget.attr.startsWith("max") && budget.attr.length > 3) {
        const stripped = budget.attr[3]!.toLowerCase() + budget.attr.slice(4);
        candidateNames.push(stripped);
      } else if (budget.attr.endsWith("Budget") && budget.attr.length > 6) {
        candidateNames.push(budget.attr.slice(0, -6));
      } else if (budget.attr.endsWith("Limit") && budget.attr.length > 5) {
        candidateNames.push(budget.attr.slice(0, -5));
      }

      const { sum, contributorCount } = computeMinimumChildRollup(db, self, candidateNames);
      if (contributorCount < 1) continue;

      const violated = budget.strict ? sum >= budget.limit - 1e-9 : sum > budget.limit + 1e-9;
      if (violated) {
        const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString());
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.MULTIPLICITY_BUDGET_ROLLUP_VIOLATION,
            [selfName, budget.attr, fmt(sum), fmt(budget.limit)],
            budget.sourceSym.id === self.id ? null : budget.sourceSym,
          ),
        );
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// Shared Helpers for User Workspace & Metadata / Conservation Inspection
// ---------------------------------------------------------------------------

export function isUserWorkspaceSymbol(entry: SymbolEntry): boolean {
  const uri = entry.resourceId ?? entry.documentUri ?? "";
  if (uri === KERML_STDLIB_URI || uri.startsWith("sysml2://stdlib")) return false;
  return isSysmlLanguageSymbol(entry);
}

const CONSERVED_FLOW_ATTR_NAMES = new Set<string>([
  "flowrate",
  "massflow",
  "m_flow",
  "current",
  "rate",
  "flux",
  "volumetricflow",
  "heatflow",
]);

function hasConservedFlowAnnotation(db: QueryDB, sym: SymbolEntry): boolean {
  const checkSingle = (s: SymbolEntry): boolean => {
    const { leaves } = getHeaderLeavesBeforeBody(db, s);
    for (let i = 0; i < leaves.length - 1; i++) {
      if (leaves[i]!.text === "#" && leaves[i + 1]!.text.toLowerCase() === "conserved") return true;
    }
    for (const ch of db.childrenOf(s.id)) {
      if (ch.ruleName !== "MetadataUsage" && ch.ruleName !== "PrefixMetadataUsage") continue;
      const mName = extractMetadataTypeName(db, ch).toLowerCase();
      if (mName === "conserved" || mName.endsWith("::conserved")) return true;
    }
    return false;
  };
  if (checkSingle(sym)) return true;
  const tSym = resolveTypeOf(db, sym);
  return Boolean(tSym && isUserWorkspaceSymbol(tSym) && checkSingle(tSym));
}

function extractConservedFlowRate(
  db: QueryDB,
  sym: SymbolEntry,
  scopeId: number | null,
): { attrName: string; value: number } | null {
  for (const ch of db.childrenOf(sym.id)) {
    if (ch.kind !== "Usage") continue;
    let rawName = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
    if (!rawName) {
      const specs = extractSpecializationClauses(db, ch);
      if (specs.length > 0) {
        rawName = specs[0]!.targetPath.split("::").pop()!.split(".").pop()!;
      }
    }
    if (!rawName || !CONSERVED_FLOW_ATTR_NAMES.has(rawName.toLowerCase())) continue;
    const vInfo = hasFeatureValueInfo(db, ch);
    if (!vInfo.hasValue || vInfo.isDefault) continue;
    const val = getFeatureValue(db, ch, sym.id);
    if (typeof val === "number" && Number.isFinite(val)) {
      return { attrName: rawName.toLowerCase(), value: val };
    }
  }
  const selfValInfo = hasFeatureValueInfo(db, sym);
  if (selfValInfo.hasValue && !selfValInfo.isDefault) {
    const directVal = getFeatureValue(db, sym, scopeId);
    if (typeof directVal === "number" && Number.isFinite(directVal)) {
      const nm = (sym.name || "flow").toLowerCase();
      return { attrName: CONSERVED_FLOW_ATTR_NAMES.has(nm) ? nm : "flow", value: directVal };
    }
  }
  return null;
}

function extractEndpointConservedFlowRate(
  db: QueryDB,
  scopeId: number,
  endpointPath: string,
): { attrName: string; value: number } | null {
  const segs = endpointPath
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length === 0) return null;
  if (segs.length === 1) {
    const pSym = resolveFeatureInScope(db, scopeId, segs[0]!);
    return pSym ? extractConservedFlowRate(db, pSym, scopeId) : null;
  }
  const partSym = resolveFeatureInScope(db, scopeId, segs[0]!);
  if (!partSym) return null;
  const portName = segs[1]!;
  // Check redefined port on partSym first
  for (const ch of db.childrenOf(partSym.id)) {
    if (ch.kind !== "Usage") continue;
    const matchesDirect = ch.name === portName;
    const matchesRedef =
      !matchesDirect && extractSpecializationClauses(db, ch).some((cl) => cl.targetPath.split(".").pop() === portName);
    if (matchesDirect || matchesRedef) {
      const hit = extractConservedFlowRate(db, ch, partSym.id);
      if (hit) return hit;
    }
  }
  const partDef = resolveTypeOf(db, partSym);
  if (partDef) {
    for (const ch of db.childrenOf(partDef.id)) {
      if (ch.kind === "Usage" && ch.name === portName) {
        const hit = extractConservedFlowRate(db, ch, partDef.id);
        if (hit) return hit;
      }
    }
  }
  return null;
}
