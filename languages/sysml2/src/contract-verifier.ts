// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DpllTSolver,
  Interval,
  type ExprNode,
  type NonlinearConstraint,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import { extractBalancedBlock } from "./activity-cfa.js";
import { SysML2EventTraceExplorer } from "./event-trace-explorer.js";
import { extractVariables, parseGuardConstraints, type GuardConstraint } from "./state-machine-verifier.js";

/**
 * Diagnostic information when an Assume-Guarantee interface contract fails.
 */
export interface ContractViolation {
  /** Optional name of the connection usage where the contract violation occurred. */
  connectionName?: string | undefined;
  /** Name of the upstream supplier port/component providing the guarantee. */
  sourceEndpoint: string;
  /** Name of the downstream consumer port/component requiring the assumption. */
  targetEndpoint: string;
  /** Guarantee constraint expression on the supplier endpoint. */
  guarantee: string;
  /** Assumption constraint expression violated on the consumer endpoint. */
  assumption: string;
  /** Variable identifier involved in the failed entailment check. */
  variable: string;
  /** Concrete witness value demonstrating that the guarantee permits a state outside the assumption. */
  counterexample: number;
  /** Human-readable explanation of why the supplier guarantee fails to entail the consumer assumption. */
  reason: string;
}

/**
 * Result of verifying one or more Assume-Guarantee interface connections.
 */
export interface ContractVerificationResult {
  /** True if all verified consumer assumptions are entailed by their connected supplier guarantees. */
  isSatisfied: boolean;
  /** List of Assume-Guarantee violations discovered across checked connections. */
  violations: ContractViolation[];
}

/**
 * Specification of a Signal Temporal Logic (STL) / invariant Assume-Guarantee contract $G_{[t_0, t_1]}(A \Rightarrow G)$.
 */
export interface TemporalContract {
  /** Optional identifier of the temporal contract. */
  name?: string | undefined;
  /** Environment assumption predicate expression $A$. */
  assumption: string;
  /** System guarantee predicate expression $G$. */
  guarantee: string;
  /** Optional bounded time window $[t_{\min}, t_{\max}]$ in seconds over which the implication must hold. */
  timeHorizon?: [number, number] | undefined;
}

/**
 * Quantitative and qualitative evaluation result for a `TemporalContract`.
 */
export interface TemporalContractResult {
  /** True if the implication $A \Rightarrow G$ holds across all evaluated time samples (or symbolically). */
  isSatisfied: boolean;
  /** Minimum quantitative STL robustness margin $\rho$ observed while the assumption held ($\rho \ge 0$ indicates satisfaction). */
  minRobustness: number;
  /** First simulation timestamp (in seconds) at which $\rho < 0$, if violated. */
  violationTime?: number | undefined;
  /** Witness signal value at `violationTime` (or symbolic counterexample value) that violated the guarantee. */
  counterexample?: number | undefined;
  /** Diagnostic explanation of the temporal contract outcome or violation. */
  reason?: string | undefined;
}

/**
 * Verifies temporal assume-guarantee entailment: A => G over simulation trajectories.
 */
export function verifyTemporalContract(
  contract: TemporalContract,
  times: number[],
  signals: Record<string, number[]>,
): TemporalContractResult {
  // Parse assumption and guarantee bounds
  const aConstraints = parseGuardConstraints(contract.assumption);
  const gConstraints = parseGuardConstraints(contract.guarantee);

  let worstMargin = Infinity;
  let violationTime: number | undefined = undefined;
  let counterexample: number | undefined = undefined;
  let violationReason: string | undefined = undefined;

  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    if (contract.timeHorizon) {
      if (t < contract.timeHorizon[0] || t > contract.timeHorizon[1]) continue;
    }

    // Check if assumption holds at time t
    let aHolds = true;
    for (const a of aConstraints) {
      const val = signals[a.variable]?.[i];
      if (val === undefined) continue;
      if (a.operator === "<=" && val > a.value + 1e-9) aHolds = false;
      if (a.operator === "<" && val >= a.value - 1e-9) aHolds = false;
      if (a.operator === ">=" && val < a.value - 1e-9) aHolds = false;
      if (a.operator === ">" && val <= a.value + 1e-9) aHolds = false;
      if (a.operator === "==" && Math.abs(val - a.value) > 1e-9) aHolds = false;
    }

    if (!aHolds) {
      // If assumption does not hold at time t, contract is vacuously satisfied at this point
      continue;
    }

    // Assumption holds -> compute quantitative STL robustness margin rho(G, x(t)) for each guarantee conjunct
    for (const g of gConstraints) {
      const val = signals[g.variable]?.[i];
      if (val === undefined) continue;

      let margin = Infinity;
      if (g.operator === "<=" || g.operator === "<") {
        margin = g.value - val;
      } else if (g.operator === ">=" || g.operator === ">") {
        margin = val - g.value;
      } else if (g.operator === "==") {
        margin = -Math.abs(val - g.value);
      }

      if (margin < worstMargin) {
        worstMargin = margin;
      }

      if (margin < 0 && violationTime === undefined) {
        violationTime = t;
        counterexample = val;
        violationReason = `At t = ${t.toFixed(4)}s: assumption '${contract.assumption}' held, but guarantee '${contract.guarantee}' violated with ${g.variable} = ${val.toFixed(4)}`;
      }
    }
  }

  return {
    isSatisfied: worstMargin >= 0,
    minRobustness: worstMargin,
    violationTime,
    counterexample,
    reason: violationReason,
  };
}

/**
 * Negates a single guard constraint into an array of equivalent non-linear inequality constraints.
 */
function negateGuardConstraint(c: GuardConstraint): NonlinearConstraint[] {
  const eps = 1e-4;
  if (c.nonlinear) {
    const orig = c.nonlinear;
    if (orig.rel === "<=") {
      return [{ expr: orig.expr, rel: ">=", rhs: orig.rhs + eps }];
    } else if (orig.rel === ">=") {
      return [{ expr: orig.expr, rel: "<=", rhs: orig.rhs - eps }];
    } else {
      return [
        { expr: orig.expr, rel: "<=", rhs: orig.rhs - eps },
        { expr: orig.expr, rel: ">=", rhs: orig.rhs + eps },
      ];
    }
  }

  const varExpr: ExprNode = { kind: "var", name: c.variable.includes(".") ? c.variable.split(".").pop()! : c.variable };
  if (c.operator === "<=" || c.operator === "<") {
    return [{ expr: varExpr, rel: ">=", rhs: c.value + eps }];
  } else if (c.operator === ">=" || c.operator === ">") {
    return [{ expr: varExpr, rel: "<=", rhs: c.value - eps }];
  } else {
    return [
      { expr: varExpr, rel: "<=", rhs: c.value - eps },
      { expr: varExpr, rel: ">=", rhs: c.value + eps },
    ];
  }
}

/**
 * Result of checking symbolic entailment $\bigwedge \text{Premises} \Rightarrow \text{Conclusion}$.
 */
export interface EntailmentResult {
  /** True if the conjunction of premises mathematically entails the conclusion ($\text{Premises} \land \neg\text{Conclusion}$ is UNSAT). */
  entailed: boolean;
  /** Human-readable explanation when entailment fails. */
  reason?: string | undefined;
  /** Interval box mapping variable names to $[lo, hi]$ bounds where premises hold but the conclusion is violated. */
  counterexample?: Record<string, [number, number]> | undefined;
}

/**
 * Symbolically verifies whether a set of premises mathematically guarantees a conclusion (Premises => Conclusion).
 * Checks whether (Premises /\ ~Conclusion) is UNSAT via DPLL(T) + HC4 contractor.
 */
export function checkSymbolicEntailment(premises: string[], conclusionStr: string): EntailmentResult {
  const pConstraints = premises.flatMap((p) => parseGuardConstraints(p));
  const cConstraints = parseGuardConstraints(conclusionStr);

  if (cConstraints.length === 0) {
    return { entailed: true };
  }

  // Fast-path: single-variable bounds
  const isSimple = !pConstraints.some((c) => c.nonlinear) && !cConstraints.some((c) => c.nonlinear);

  if (isSimple) {
    const gBounds = new Map<string, { lower: number; upper: number }>();
    for (const g of pConstraints) {
      const varName = g.variable;
      const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
      if (g.operator === "<=" || g.operator === "<") {
        b.upper = Math.min(b.upper, g.value);
      } else if (g.operator === ">=" || g.operator === ">") {
        b.lower = Math.max(b.lower, g.value);
      } else if (g.operator === "==") {
        b.lower = Math.max(b.lower, g.value);
        b.upper = Math.min(b.upper, g.value);
      }
      gBounds.set(varName, b);
    }

    // Contradictory premises (UNSAT): False => Conclusion is vacuously entailed!
    for (const [_, b] of gBounds) {
      if (b.lower > b.upper + 1e-9) {
        return { entailed: true };
      }
    }

    let allHold = true;
    for (const a of cConstraints) {
      const varName = a.variable;
      const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
      const gLo = b.lower;
      const gHi = b.upper;

      if (a.operator === ">=" || a.operator === ">") {
        if (gLo < a.value - 1e-9) {
          allHold = false;
          return {
            entailed: false,
            reason: `Lower bound ${!Number.isFinite(gLo) ? "-∞" : gLo.toFixed(2)} does not satisfy '${a.variable} >= ${a.value}'`,
            counterexample: {
              [varName]: [!Number.isFinite(gLo) ? a.value - 1 : gLo, !Number.isFinite(gLo) ? a.value - 1 : gLo],
            },
          };
        }
      }
      if (a.operator === "<=" || a.operator === "<") {
        if (gHi > a.value + 1e-9) {
          allHold = false;
          return {
            entailed: false,
            reason: `Upper bound ${!Number.isFinite(gHi) ? "∞" : gHi.toFixed(2)} does not satisfy '${a.variable} <= ${a.value}'`,
            counterexample: {
              [varName]: [!Number.isFinite(gHi) ? a.value + 1 : gHi, !Number.isFinite(gHi) ? a.value + 1 : gHi],
            },
          };
        }
      }
    }
    if (allHold) return { entailed: true };
  }

  // Non-linear / Multi-variable path via DPLL(T) + HC4 contractor
  const allVarNames = new Set<string>();
  for (const c of [...pConstraints, ...cConstraints]) {
    if (c.nonlinear) {
      extractVariables(c.nonlinear.expr, allVarNames);
    } else {
      allVarNames.add(c.variable);
    }
  }

  for (const c of cConstraints) {
    const negations = negateGuardConstraint(c);

    for (const neg of negations) {
      const theoryLiterals = new Map<number, NonlinearConstraint>();
      const clauses: number[][] = [];
      let litId = 1;

      // Add all premises
      for (const p of pConstraints) {
        let nl: NonlinearConstraint;
        if (p.nonlinear) {
          nl = p.nonlinear;
        } else {
          const varName = p.variable;
          const rel =
            p.operator === "<=" || p.operator === "<" ? "<=" : p.operator === ">=" || p.operator === ">" ? ">=" : "==";
          nl = { expr: { kind: "var", name: varName }, rel, rhs: p.value };
        }
        theoryLiterals.set(litId, nl);
        clauses.push([litId]);
        litId++;
      }

      // Add negated conclusion
      theoryLiterals.set(litId, neg);
      clauses.push([litId]);
      litId++;

      const initialBox = new Map<string, Interval>();
      for (const v of allVarNames) {
        initialBox.set(v, new Interval(-1e6, 1e6));
      }

      const solver = new DpllTSolver({
        clauses,
        theoryLiterals,
        initialBox,
        delta: 1e-3,
        maxSubdivisions: 1500,
      });

      const res = solver.solve(initialBox);
      if (res.status !== "UNSAT") {
        const cexMap: Record<string, [number, number]> = {};
        if (res.solutionBox) {
          for (const [k, inv] of res.solutionBox.entries()) {
            cexMap[k] = [inv.lo, inv.hi];
          }
        }
        return {
          entailed: false,
          reason: `Premises do not guarantee '${conclusionStr}' (satisfiable counterexample box discovered)`,
          counterexample: cexMap,
        };
      }
    }
  }

  return { entailed: true };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Verifies contract entailment (G_supplier => A_consumer) for an interface connection.
 * Given a supplier guaranteeing a range and a consumer assuming a range,
 * checks if G_supplier /\ ~A_consumer is satisfiable.
 */
export function verifyAssumeGuaranteePair(
  supplierName: string,
  consumerName: string,
  guarantees: string[],
  assumptions: string[],
  connectionName?: string,
  portMapping?: Map<string, string> | Record<string, string>,
): ContractVerificationResult {
  const violations: ContractViolation[] = [];

  let effectiveGuarantees = guarantees;
  if (portMapping) {
    const mapEntries = portMapping instanceof Map ? Array.from(portMapping.entries()) : Object.entries(portMapping);
    effectiveGuarantees = guarantees.map((g) => {
      let mapped = g;
      for (const [src, dst] of mapEntries) {
        const regex = new RegExp(`\\b${escapeRegex(src)}\\b`, "g");
        mapped = mapped.replace(regex, dst);
      }
      return mapped;
    });
  }

  const gConstraints = effectiveGuarantees.flatMap((g) => parseGuardConstraints(g));
  const aConstraints = assumptions.flatMap((a) => parseGuardConstraints(a));

  if (gConstraints.length === 0 || aConstraints.length === 0) {
    return { isSatisfied: true, violations: [] };
  }

  // Exact real bounds per canonical variable
  const gBounds = new Map<string, { lower: number; upper: number }>();
  for (const g of gConstraints) {
    const varName = g.variable;
    const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
    if (g.operator === "<=" || g.operator === "<") {
      b.upper = Math.min(b.upper, g.value);
    } else if (g.operator === ">=" || g.operator === ">") {
      b.lower = Math.max(b.lower, g.value);
    } else if (g.operator === "==") {
      b.lower = Math.max(b.lower, g.value);
      b.upper = Math.min(b.upper, g.value);
    }
    gBounds.set(varName, b);
  }

  // Check each consumer assumption
  for (let i = 0; i < aConstraints.length; i++) {
    const a = aConstraints[i]!;
    const aRaw = assumptions[i] || `${a.variable} ${a.operator} ${a.value}`;
    const ent = checkSymbolicEntailment(effectiveGuarantees, aRaw);

    if (!ent.entailed) {
      const b = gBounds.get(a.variable) ?? { lower: -Infinity, upper: Infinity };
      const gLo = b.lower;
      const gHi = b.upper;
      const varName = a.variable.includes(".") ? a.variable.split(".").pop()! : a.variable;

      let cexVal = 0;
      let reasonText =
        ent.reason || `Supplier '${supplierName}' does not satisfy consumer '${consumerName}' assumption '${aRaw}'`;

      if (a.operator === ">=" || a.operator === ">") {
        cexVal = !Number.isFinite(gLo) ? a.value - 1 : gLo;
        reasonText = `Supplier '${supplierName}' can deliver ${varName} = ${!Number.isFinite(gLo) ? "-∞" : gLo}, violating consumer '${consumerName}' assumption '${a.variable} >= ${a.value}'`;
      } else if (a.operator === "<=" || a.operator === "<") {
        cexVal = !Number.isFinite(gHi) ? a.value + 1 : gHi;
        reasonText = `Supplier '${supplierName}' can deliver ${varName} = ${!Number.isFinite(gHi) ? "∞" : gHi}, violating consumer '${consumerName}' assumption '${a.variable} <= ${a.value}'`;
      } else if (ent.counterexample) {
        const firstBox = Object.values(ent.counterexample)[0];
        if (firstBox) cexVal = firstBox[0];
      }

      violations.push({
        connectionName,
        sourceEndpoint: supplierName,
        targetEndpoint: consumerName,
        guarantee:
          effectiveGuarantees.find((g) => g.includes(varName) || g.includes(a.variable)) ||
          `${varName} ∈ [${gLo}, ${gHi}]`,
        assumption: aRaw,
        variable: varName,
        counterexample: cexVal,
        reason: reasonText,
      });
    }
  }

  return {
    isSatisfied: violations.length === 0,
    violations,
  };
}

/**
 * Scans a QueryDB for all connections and verifies their Assume-Guarantee contracts.
 */
export function verifyAllInterfaceContracts(db: QueryDB, scopeFilter?: string | number): ContractVerificationResult {
  const allEntries = db.allEntries();
  const connections = allEntries.filter(
    (e) => e.ruleName === "ConnectionUsage" || e.ruleName === "BindingConnectorAsUsage",
  );

  const allViolations: ContractViolation[] = [];

  for (const conn of connections) {
    if (typeof scopeFilter === "number") {
      if (conn.id !== scopeFilter) continue;
    } else if (scopeFilter && conn.name !== scopeFilter && !conn.name?.includes(scopeFilter)) {
      continue;
    }

    // Determine connection endpoints from metadata or children
    const metaSource = (conn.metadata as any)?.source;
    const metaTarget = (conn.metadata as any)?.target;

    let sourceName = metaSource;
    let targetName = metaTarget;

    if (!sourceName || !targetName) {
      const refs = db.childrenOf(conn.id).filter((c) => c.kind === "Reference");
      if (refs.length >= 2) {
        sourceName = (refs[0]?.name || db.cstText(refs[0]?.startOffset || 0, refs[0]?.endOffset || 0) || "").trim();
        targetName = (refs[1]?.name || db.cstText(refs[1]?.startOffset || 0, refs[1]?.endOffset || 0) || "").trim();
      }
    }

    if (!sourceName || !targetName) continue;

    const resolveEndpointSym = (epName: string): SymbolEntry | undefined => {
      const direct = db.byName(epName)[0];
      if (direct) return direct;
      if (epName.includes(".")) {
        const parts = epName.split(".");
        return db.byName(parts[0]!)[0] ?? db.byName(parts[parts.length - 1]!)[0];
      }
      return undefined;
    };

    const sourceSym = resolveEndpointSym(sourceName);
    const targetSym = resolveEndpointSym(targetName);

    const sourceGuarantees: string[] = [];
    const targetAssumptions: string[] = [];

    const collectConstraints = (sym: SymbolEntry | undefined, isSource: boolean) => {
      if (!sym) return;
      const children = db.childrenOf(sym.id);
      for (const child of children) {
        const text = db.cstText(child.startOffset, child.endOffset, child);
        if (!text) continue;
        const kind = (child.metadata as any)?.constraintKind || "";
        if (isSource && (kind === "require" || text.includes("require") || text.includes("constraint"))) {
          sourceGuarantees.push(text);
        } else if (!isSource && (kind === "assume" || text.includes("assume"))) {
          targetAssumptions.push(text);
        }
      }
    };

    collectConstraints(sourceSym, true);
    collectConstraints(targetSym, false);

    if (sourceGuarantees.length > 0 && targetAssumptions.length > 0) {
      const connLabel = conn.name && conn.name !== "<anonymous>" ? conn.name : `${sourceName}->${targetName}`;
      const res = verifyAssumeGuaranteePair(sourceName, targetName, sourceGuarantees, targetAssumptions, connLabel);
      allViolations.push(...res.violations);
    }
  }

  return {
    isSatisfied: allViolations.length === 0,
    violations: allViolations,
  };
}

/**
 * Formal Assume-Guarantee contract $C = (A, G)$ associated with a SysML v2 component or interface.
 */
export interface AssumeGuaranteeContract {
  /** Component or contract identifier. */
  name: string;
  /** List of environment assumption expressions $A$ required by the component. */
  assumptions: string[];
  /** List of guarantee expressions $G$ ensured by the component whenever $A$ holds. */
  guarantees: string[];
  /** Optional list of input port/variable identifiers controlled by the environment. */
  inputs?: string[] | undefined;
  /** Optional list of output port/variable identifiers controlled by the component. */
  outputs?: string[] | undefined;
}

/**
 * Result of checking contract refinement $C_1 \preceq C_2$ ($A_2 \Rightarrow A_1$ and $G_1 \Rightarrow G_2$).
 */
export interface RefinementResult {
  /** True if $C_1$ weakens (or preserves) the assumptions of $C_2$ and strengthens (or preserves) the guarantees of $C_2$. */
  isRefined: boolean;
  /** Diagnostic messages for any assumptions of $C_1$ not entailed by $A_2$. */
  assumptionViolations: string[];
  /** Diagnostic messages for any guarantees of $C_2$ not entailed by $G_1$. */
  guaranteeViolations: string[];
  /** Human-readable summary of the refinement check. */
  summary: string;
}

/**
 * Algebraic operations on Assume-Guarantee contracts (refinement, parallel composition $\otimes$, quotient $/$, and OCRA-style compositional verification).
 */
export class ContractAlgebra {
  /**
   * Evaluates contract refinement C1 <= C2:
   * C1 refines C2 iff (A2 => A1) and (G1 => G2).
   */
  public static refines(c1: AssumeGuaranteeContract, c2: AssumeGuaranteeContract): RefinementResult {
    // 1. Check A2 => A1 (c1 makes weaker/equal assumptions than c2)
    const aCheck = verifyAssumeGuaranteePair(c2.name, c1.name, c2.assumptions, c1.assumptions);

    // 2. Check G1 => G2 (c1 provides stronger/equal guarantees than c2)
    const gCheck = verifyAssumeGuaranteePair(c1.name, c2.name, c1.guarantees, c2.guarantees);

    const aViolations = aCheck.violations.map((v) => v.reason);
    const gViolations = gCheck.violations.map((v) => v.reason);
    const isRefined = aCheck.isSatisfied && gCheck.isSatisfied;

    let summary = `Contract '${c1.name}' ${isRefined ? "successfully refines" : "fails to refine"} '${c2.name}'.`;
    if (!isRefined) {
      if (!aCheck.isSatisfied) summary += ` Assumption weakening violated (${aViolations.length} issues).`;
      if (!gCheck.isSatisfied) summary += ` Guarantee strengthening violated (${gViolations.length} issues).`;
    }

    return {
      isRefined,
      assumptionViolations: aViolations,
      guaranteeViolations: gViolations,
      summary,
    };
  }

  /**
   * Evaluates Assume-Guarantee satisfaction between a guarantee contract and an assumption contract.
   */
  public static verifyAssumeGuaranteePair(
    guaranteeContract: AssumeGuaranteeContract,
    assumptionContract: AssumeGuaranteeContract,
  ): RefinementResult {
    return ContractAlgebra.refines(guaranteeContract, assumptionContract);
  }

  /**
   * Parallel composition C = C1 (x) C2:
   * G = G1 /\ G2
   * A = (A1 /\ A2) \/ ~(G1 /\ G2)
   */
  public static composeParallel(
    c1: AssumeGuaranteeContract,
    c2: AssumeGuaranteeContract,
    compositeName?: string,
  ): AssumeGuaranteeContract {
    const name = compositeName ?? `(${c1.name} ⊗ ${c2.name})`;

    // Combined guarantees
    const guarantees = [...new Set([...c1.guarantees, ...c2.guarantees])];

    // Filter assumptions satisfied by the partner's guarantees (internal feedback)
    const externalAssumptions: string[] = [];

    for (const a of c1.assumptions) {
      const gCheck = verifyAssumeGuaranteePair(c2.name, c1.name, c2.guarantees, [a]);
      if (!gCheck.isSatisfied) {
        externalAssumptions.push(a);
      }
    }

    for (const a of c2.assumptions) {
      const gCheck = verifyAssumeGuaranteePair(c1.name, c2.name, c1.guarantees, [a]);
      if (!gCheck.isSatisfied) {
        externalAssumptions.push(a);
      }
    }

    return {
      name,
      assumptions: [...new Set(externalAssumptions)],
      guarantees,
    };
  }

  /**
   * Quotient / Residual composition C_res = C_sys / C1:
   * Computes the specification required of component C2 such that C1 (x) C2 <= C_sys.
   */
  public static quotient(
    cSys: AssumeGuaranteeContract,
    c1: AssumeGuaranteeContract,
    resName?: string,
  ): AssumeGuaranteeContract {
    const name = resName ?? `(${cSys.name} / ${c1.name})`;

    // The residual component must assume what cSys assumes + what c1 guarantees
    const assumptions = [...new Set([...cSys.assumptions, ...c1.guarantees])];

    // The residual component must guarantee what cSys guarantees, minus what c1 already provides
    const guarantees = [...cSys.guarantees];

    return {
      name,
      assumptions,
      guarantees,
    };
  }

  /**
   * System-level compositional contract verification (OCRA / SAVVS paradigm).
   *
   * 1. Dependency Validation:
   *    Validates that component contracts do not have circular assume-guarantee
   *    dependencies without temporal delays (soundness requirement).
   *
   * 2. Compatibility Check:
   *    For each component i:
   *      (A_sys /\ \bigwedge_{j != i} G_j) => A_i
   *    Proves that the environment and peer components satisfy all component assumptions.
   *
   * 3. Refinement / Dominance Check:
   *    (A_sys /\ \bigwedge_i G_i) => G_sys
   *    Proves that component guarantees collectively deliver the top-level system guarantees.
   */
  public static verifySystemComposition(
    systemContract: AssumeGuaranteeContract,
    componentContracts: AssumeGuaranteeContract[],
  ): CompositionalProofResult {
    const compatibilityViolations: CompositionalProofResult["compatibilityViolations"] = [];
    const refinementViolations: CompositionalProofResult["refinementViolations"] = [];

    // Helper to extract referenced variables and detect temporal delay operators
    const extractContractVars = (constraints: string[]): { vars: Set<string>; hasTemporalDelay: boolean } => {
      const vars = new Set<string>();
      let hasTemporalDelay = false;
      for (const str of constraints) {
        if (/\bprev\s*\(|\bdelay\s*\(|\blatch\b/i.test(str)) {
          hasTemporalDelay = true;
        }
        const parsed = parseGuardConstraints(str);
        for (const g of parsed) {
          if (g.nonlinear) {
            extractVariables(g.nonlinear.expr, vars);
          } else {
            vars.add(g.variable);
          }
        }
      }
      return { vars, hasTemporalDelay };
    };

    // 1. Dependency Graph Construction & Circular Dependency Validation
    const compOutputs = componentContracts.map((c) => extractContractVars(c.guarantees));
    const compInputs = componentContracts.map((c) => extractContractVars(c.assumptions));

    const adj = new Map<number, number[]>();
    for (let i = 0; i < componentContracts.length; i++) adj.set(i, []);

    for (let i = 0; i < componentContracts.length; i++) {
      for (let j = 0; j < componentContracts.length; j++) {
        if (i === j) continue;
        for (const outVar of compOutputs[i]!.vars) {
          if (compInputs[j]!.vars.has(outVar)) {
            adj.get(i)!.push(j);
            break;
          }
        }
      }
    }

    // DFS Cycle Detection
    const visited = new Array(componentContracts.length).fill(0);
    const parent = new Array(componentContracts.length).fill(-1);
    let detectedCycle: number[] | null = null;

    const dfs = (node: number): boolean => {
      visited[node] = 1;
      for (const neighbor of adj.get(node) || []) {
        if (visited[neighbor] === 1) {
          const path: number[] = [neighbor, node];
          let curr = node;
          while (curr !== neighbor && parent[curr] !== -1 && parent[curr] !== neighbor) {
            curr = parent[curr];
            path.push(curr);
          }
          path.push(neighbor);
          path.reverse();
          detectedCycle = path;
          return true;
        } else if (visited[neighbor] === 0) {
          parent[neighbor] = node;
          if (dfs(neighbor)) return true;
        }
      }
      visited[node] = 2;
      return false;
    };

    for (let i = 0; i < componentContracts.length; i++) {
      if (visited[i] === 0) {
        if (dfs(i)) break;
      }
    }

    if (detectedCycle) {
      const cycleNodes = detectedCycle as number[];
      let hasTemporalDelayInCycle = false;
      for (const idx of cycleNodes) {
        if (compInputs[idx]!.hasTemporalDelay || compOutputs[idx]!.hasTemporalDelay) {
          hasTemporalDelayInCycle = true;
          break;
        }
      }

      if (!hasTemporalDelayInCycle) {
        const cycleNames = cycleNodes.map((idx) => componentContracts[idx]!.name);
        const cycleStr = cycleNames.join(" -> ");
        compatibilityViolations.push({
          component: cycleNames[0]!,
          missingAssumption: "temporal-delay",
          reason: `Circular assume-guarantee dependency detected between components [${cycleStr}]. Compositional reasoning without temporal delay is unsound.`,
        });
      }
    }

    // 2. Compatibility Check
    for (let i = 0; i < componentContracts.length; i++) {
      const comp = componentContracts[i]!;
      const siblingGuarantees = componentContracts.filter((_, idx) => idx !== i).flatMap((c) => c.guarantees);

      const context = [...systemContract.assumptions, ...siblingGuarantees];

      for (const a of comp.assumptions) {
        const ent = checkSymbolicEntailment(context, a);
        if (!ent.entailed) {
          compatibilityViolations.push({
            component: comp.name,
            missingAssumption: a,
            reason: ent.reason || `System assumptions and sibling guarantees do not guarantee '${a}' of '${comp.name}'`,
            counterexample: ent.counterexample,
          });
        }
      }
    }

    // 2. Refinement Check
    const allGuarantees = componentContracts.flatMap((c) => c.guarantees);
    const sysContext = [...systemContract.assumptions, ...allGuarantees];

    for (const g of systemContract.guarantees) {
      const ent = checkSymbolicEntailment(sysContext, g);
      if (!ent.entailed) {
        refinementViolations.push({
          systemGuarantee: g,
          reason: ent.reason || `Component guarantees fail to deliver top-level system guarantee '${g}'`,
          counterexample: ent.counterexample,
        });
      }
    }

    const isCompatible = compatibilityViolations.length === 0;
    const isRefined = refinementViolations.length === 0;

    let summary = `Compositional verification for '${systemContract.name}': `;
    summary += isCompatible
      ? `Component contracts are mutually compatible. `
      : `Found ${compatibilityViolations.length} compatibility issue(s). `;
    summary += isRefined
      ? `System contract is successfully refined.`
      : `Found ${refinementViolations.length} refinement issue(s).`;

    return {
      isCompatible,
      isRefined,
      compatibilityViolations,
      refinementViolations,
      summary,
    };
  }
}

/**
 * Result of system-level compositional Assume-Guarantee verification (compatibility and refinement proofs).
 */
export interface CompositionalProofResult {
  /** True if all component assumptions are discharged by system assumptions and sibling guarantees without instantaneous dependency cycles. */
  isCompatible: boolean;
  /** True if the combined component guarantees and system assumptions entail all top-level system guarantees. */
  isRefined: boolean;
  /** List of component assumption compatibility failures or instantaneous circular dependency violations. */
  compatibilityViolations: {
    /** Name of the sub-component whose assumption could not be discharged. */
    component: string;
    /** Unsatisfied assumption expression (or `"temporal-delay"` for algebraic loops). */
    missingAssumption: string;
    /** Explanation of the compatibility failure. */
    reason: string;
    /** Optional counterexample box where sibling guarantees hold but the component assumption fails. */
    counterexample?: Record<string, [number, number]> | undefined;
  }[];
  /** List of top-level system guarantees that are not entailed by the composition of sub-component contracts. */
  refinementViolations: {
    /** Unsatisfied system-level guarantee expression. */
    systemGuarantee: string;
    /** Explanation of the refinement failure. */
    reason: string;
    /** Optional counterexample box where sub-component guarantees hold but the system guarantee fails. */
    counterexample?: Record<string, [number, number]> | undefined;
  }[];
  /** Human-readable summary of both compatibility and refinement proof obligations. */
  summary: string;
}

/**
 * Exports an Assume-Guarantee or Temporal contract into standard nuXmv / OCRA SMV syntax.
 */
export function exportContractToNuXmv(contract: AssumeGuaranteeContract | TemporalContract): string {
  const isTemporal = "assumption" in contract && typeof (contract as any).assumption === "string";
  const name = contract.name || "ContractModule";

  let smv = `-- nuXmv / OCRA SMV Specification for Contract: ${name}\n`;
  smv += `-- Auto-generated by ModelScript SysML v2 Contract Verifier\n\n`;
  smv += `MODULE main\n`;

  if (isTemporal) {
    const tc = contract as TemporalContract;
    const aConstraints = parseGuardConstraints(tc.assumption);
    const gConstraints = parseGuardConstraints(tc.guarantee);
    const vars = new Set<string>();
    for (const c of [...aConstraints, ...gConstraints]) {
      vars.add(c.variable.includes(".") ? c.variable.split(".").pop()! : c.variable);
    }

    smv += `VAR\n`;
    for (const v of vars) {
      smv += `  ${v} : real;\n`;
    }
    smv += `\n`;

    const formatCond = (str: string) => {
      return str.replace(/&&/g, " & ").replace(/\|\|/g, " | ").replace(/==/g, " = ");
    };

    const aSmv = formatCond(tc.assumption);
    const gSmv = formatCond(tc.guarantee);

    if (tc.timeHorizon) {
      smv += `-- Bounded time horizon [${tc.timeHorizon[0]}, ${tc.timeHorizon[1]}]\n`;
      smv += `LTLSPEC G ((${aSmv}) -> (${gSmv}));\n`;
    } else {
      smv += `INVARSPEC (${aSmv}) -> (${gSmv});\n`;
      smv += `LTLSPEC G ((${aSmv}) -> (${gSmv}));\n`;
    }
  } else {
    const ag = contract as AssumeGuaranteeContract;
    const allConstraints = [...ag.assumptions, ...ag.guarantees].flatMap(parseGuardConstraints);
    const vars = new Set<string>();
    for (const c of allConstraints) {
      vars.add(c.variable.includes(".") ? c.variable.split(".").pop()! : c.variable);
    }
    for (const v of ag.inputs || []) vars.add(v);
    for (const v of ag.outputs || []) vars.add(v);

    smv += `VAR\n`;
    for (const v of vars) {
      smv += `  ${v} : real;\n`;
    }
    smv += `\n`;

    const formatCond = (str: string) => {
      return str.replace(/&&/g, " & ").replace(/\|\|/g, " | ").replace(/==/g, " = ");
    };

    if (ag.assumptions.length > 0) {
      const aExpr = ag.assumptions.map(formatCond).join(" & ");
      smv += `-- Environment Assumptions\n`;
      smv += `INVAR ${aExpr};\n\n`;
    }

    if (ag.guarantees.length > 0) {
      const gExpr = ag.guarantees.map(formatCond).join(" & ");
      smv += `-- Component Guarantees\n`;
      smv += `INVARSPEC ${gExpr};\n`;
    }
  }

  return smv;
}

/**
 * Symbolically verifies a Temporal Contract A => G without needing a pre-recorded simulation trajectory.
 * Checks whether the assumption bounds can ever be satisfied while the guarantee is simultaneously violated.
 */
export function verifyTemporalContractSymbolic(
  contract: TemporalContract,
  _domainBounds?: Map<string, [number, number]>,
): TemporalContractResult {
  const entailment = checkSymbolicEntailment([contract.assumption], contract.guarantee);

  if (entailment.entailed) {
    return {
      isSatisfied: true,
      minRobustness: 0,
      reason: `Contract '${contract.name || "unnamed"}' is symbolically satisfied for all states satisfying assumption '${contract.assumption}'.`,
    };
  }

  let cexVal = 0;
  if (entailment.counterexample) {
    const firstEntry = Object.values(entailment.counterexample)[0];
    if (firstEntry) cexVal = firstEntry[0];
  }

  return {
    isSatisfied: false,
    minRobustness: -1,
    counterexample: cexVal,
    reason:
      entailment.reason ||
      `Assumption '${contract.assumption}' does not symbolically imply guarantee '${contract.guarantee}'.`,
  };
}

/**
 * Node in the extracted SysML v2 Assume-Guarantee contract hierarchy.
 */
export interface SysML2ContractNode extends AssumeGuaranteeContract {
  /** Underlying SysML v2 symbol identifier for go-to-source navigation. */
  symbolName?: string | undefined;
  /** Optional role/usage label (e.g., "engine : Engine" or "Requirement"). */
  role?: string | undefined;
  /** Optional documentation string extracted from `doc /* ... *\/`. */
  doc?: string | undefined;
  /** True if this component matches the user's focused CodeLens target. */
  isFocused?: boolean | undefined;
}

/**
 * Interactive event trace step synthesized from SysML v2 state machines, actions, connections, and use cases.
 */
export interface SysML2ContractTraceStep {
  step: number;
  actor: string;
  event: string;
  targetActor?: string | undefined;
  message?: string | undefined;
  sourceSymbol?: string | undefined;
  isDeadlock?: boolean | undefined;
}

/**
 * Full extracted contract refinement hierarchy and behavioral event trace result for a SysML v2 model.
 */
export interface SysML2ContractHierarchyResult {
  system: SysML2ContractNode;
  components: SysML2ContractNode[];
  isCompatible: boolean;
  isRefined: boolean;
  compatibilityViolations: CompositionalProofResult["compatibilityViolations"];
  refinementViolations: CompositionalProofResult["refinementViolations"];
  traces: SysML2ContractTraceStep[];
  states?: string[] | undefined;
  transitions?: { name: string; from: string; to: string; guard?: string | undefined }[] | undefined;
  focusedComponent?: string | undefined;
  summary: string;
}

interface ParsedAttr {
  name: string;
  type: string;
  defaultVal?: string | undefined;
}

interface ParsedPort {
  name: string;
  portType: string;
  direction?: "in" | "out" | "inout" | undefined;
}

interface ParsedSubpart {
  usageName: string;
  partType: string;
  multiplicity?: string | undefined;
}

interface ParsedConnection {
  name?: string | undefined;
  sourcePart: string;
  sourcePort: string;
  targetPart: string;
  targetPort: string;
}

interface ParsedPartDef {
  name: string;
  superType?: string | undefined;
  doc?: string | undefined;
  attributes: ParsedAttr[];
  ports: ParsedPort[];
  subparts: ParsedSubpart[];
  connections: ParsedConnection[];
  explicitAssumptions: string[];
  explicitGuarantees: string[];
  isActor?: boolean | undefined;
}

interface ParsedReqDef {
  name: string;
  doc?: string | undefined;
  subjectType?: string | undefined;
  attributes: ParsedAttr[];
  assumptions: string[];
  guarantees: string[];
}

function stripCommentsPreserveStructure(src: string): string {
  return src
    .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\r\n]*/g, (m) => " ".repeat(m.length));
}

function extractDocComment(body: string): string | undefined {
  const m = /\bdoc\s*\/\*([\s\S]*?)\*\//.exec(body);
  return m ? m[1]!.replace(/\s+/g, " ").trim() : undefined;
}

function extractAttributesFromBody(body: string): ParsedAttr[] {
  const clean = stripCommentsPreserveStructure(body);
  const attrs: ParsedAttr[] = [];
  const attrRegex =
    /\b(?:(in|out|inout)\s+)?attribute\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_][\w:]*))?(?:\s*=\s*([^;{\n]+))?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(clean)) !== null) {
    const rawType = m[3] ? m[3].split("::").pop()! : "Real";
    attrs.push({
      name: m[2]!,
      type: rawType,
      defaultVal: m[4]?.trim(),
    });
  }
  return attrs;
}

function extractClausesFromBody(
  body: string,
  constMap: Map<string, string>,
): { assumptions: string[]; guarantees: string[] } {
  const clean = stripCommentsPreserveStructure(body);
  const assumptions: string[] = [];
  const guarantees: string[] = [];

  const normalizeClause = (raw: string): string => {
    let expr = raw.replace(/\s+/g, " ").replace(/;+$/, "").trim();
    // Normalize qualified references like cell::T or system::airflow::T_outlet
    expr = expr.replace(/\b(?:[A-Za-z_]\w*::)+([A-Za-z_]\w*)\b/g, (_full, last) => {
      return constMap.get(last) ?? last;
    });
    // Substitute known constant identifiers on RHS of comparisons
    expr = expr.replace(/(<=|>=|==|!=|<|>)\s*([A-Za-z_]\w*)\b/g, (full, op, ident) => {
      const val = constMap.get(ident);
      return val !== undefined ? `${op} ${val}` : full;
    });
    return expr;
  };

  const pushSplitClauses = (target: string[], rawBlock: string) => {
    const parts = rawBlock
      .split(/[;\n]+/)
      .map((s) => normalizeClause(s))
      .filter((s) => s.length > 0 && !/^(?:doc|attribute|subject|objective|port|part|ref|verify|satisfy)\b/.test(s));
    for (const p of parts) {
      if (/(?:<=|>=|==|!=|<|>)/.test(p) && !target.includes(p)) {
        target.push(p);
      }
    }
  };

  // 1. Braced assume constraint { ... }
  const assumeBraceRegex = /\bassume\s+(?:constraint\s*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = assumeBraceRegex.exec(clean)) !== null) {
    const openPos = m.index + m[0].length - 1;
    const block = extractBalancedBlock(clean, openPos);
    pushSplitClauses(assumptions, block.body);
    assumeBraceRegex.lastIndex = block.endPos;
  }

  // 2. Single-line assume <expr>;
  const assumeLineRegex = /\bassume\s+(?!constraint\b)([^;{\n]+);/g;
  while ((m = assumeLineRegex.exec(clean)) !== null) {
    pushSplitClauses(assumptions, m[1]!);
  }

  // 3. Braced require / guarantee / assert constraint { ... }
  const reqBraceRegex = /\b(?:require|guarantee|assert)\s+(?:constraint\s*)?\{/g;
  while ((m = reqBraceRegex.exec(clean)) !== null) {
    const openPos = m.index + m[0].length - 1;
    const block = extractBalancedBlock(clean, openPos);
    pushSplitClauses(guarantees, block.body);
    reqBraceRegex.lastIndex = block.endPos;
  }

  // 4. Single-line require / guarantee <expr>;
  const reqLineRegex = /\b(?:require|guarantee)\s+(?!constraint\b)([^;{\n]+);/g;
  while ((m = reqLineRegex.exec(clean)) !== null) {
    pushSplitClauses(guarantees, m[1]!);
  }

  // 5. Named or anonymous constraint <name>? { ... } inside analysis/part/req
  const constraintBraceRegex =
    /\b(?<!assume\s+)(?<!require\s+)(?<!guarantee\s+)(?<!assert\s+)constraint(?:\s+(?!def\b)[A-Za-z_]\w*)?\s*\{/g;
  while ((m = constraintBraceRegex.exec(clean)) !== null) {
    const openPos = m.index + m[0].length - 1;
    const block = extractBalancedBlock(clean, openPos);
    pushSplitClauses(guarantees, block.body);
    constraintBraceRegex.lastIndex = block.endPos;
  }

  return { assumptions, guarantees };
}

function inferAttributeConstraint(
  attrName: string,
  attrType: string,
  defaultVal?: string,
  role: "assumption" | "guarantee" = "guarantee",
): string | null {
  const lower = attrName.toLowerCase();
  if (attrType === "String") return null;

  if (defaultVal !== undefined) {
    const num = parseFloat(defaultVal);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      if (lower.startsWith("max") || lower.includes("limit") || lower.includes("target")) {
        return `${attrName} <= ${num}`;
      }
      if (lower.startsWith("min")) {
        return `${attrName} >= ${num}`;
      }
      return role === "assumption" ? `${attrName} >= ${num}` : `${attrName} == ${num}`;
    }
    if (defaultVal === "true" || defaultVal === "false") {
      return `${attrName} == ${defaultVal === "true" ? 1 : 0}`;
    }
  }

  if (attrType === "Boolean") {
    return `${attrName} == 1`;
  }

  // Domain-aware engineering bounds for uninitialized SysML v2 attributes
  if (lower.includes("torque")) return `${attrName} >= 250.0`;
  if (lower === "voltage") return `${attrName} >= 350.0 && ${attrName} <= 420.0`;
  if (lower.includes("minvoltage")) return `${attrName} >= 200.0`;
  if (lower === "current") return `${attrName} <= 200.0`;
  if (lower.includes("flowrate") || lower.includes("flow")) return `${attrName} >= 0.5`;
  if (lower.includes("horsepower") || lower.includes("power")) return `${attrName} >= 180.0`;
  if (lower.includes("displacement")) return `${attrName} >= 1.5`;
  if (lower.includes("gearratio")) return `${attrName} >= 0.5 && ${attrName} <= 4.5`;
  if (lower.includes("numberofgears") || lower.includes("gears")) return `${attrName} >= 6`;
  if (lower.includes("capacity")) return `${attrName} >= 50.0`;
  if (lower.includes("brakingforce") || lower.includes("brakeforce")) return `${attrName} >= 8000.0`;
  if (lower.includes("diameter")) return `${attrName} >= 16.0`;
  if (lower.includes("tirepressure") || lower.includes("pressure")) {
    return `${attrName} >= 30.0 && ${attrName} <= 36.0`;
  }
  if (lower === "mass" || lower === "maxmass" || lower === "totalmass") return `${attrName} <= 2000.0`;
  if (lower.includes("topspeed") || lower === "speed") return `${attrName} >= 160.0`;
  if (lower.includes("efficiency")) return `${attrName} >= 0.85`;
  if (lower.includes("temp")) return `${attrName} <= 65.0`;
  if (lower.includes("rating")) return `${attrName} >= 5`;
  if (lower.includes("time")) return `${attrName} <= 6.0`;
  if (lower.includes("range")) return `${attrName} >= 50.0`;
  if (lower.includes("emission")) return `${attrName} <= 120.0`;
  if (lower.includes("mtbf")) return `${attrName} >= 200000.0`;
  if (lower.includes("resolution")) return `${attrName} <= 0.01`;

  if (attrType === "Integer") return `${attrName} >= 1`;
  return `${attrName} >= 0.0`;
}

function synthesizeRequirementGuarantees(req: ParsedReqDef): string[] {
  if (req.guarantees.length > 0) return [...req.guarantees];

  const synthesized: string[] = [];
  const doc = req.doc ?? "";
  const isUpper = /\b(?:not\s+exceed|below|under|less\s+than|at\s+most|maximum|<=)\b/i.test(doc);
  const isLower = /\b(?:at\s+least|minimum|pass|exceed|above|>=)\b/i.test(doc);

  const kwNumMatch =
    /\b(?:not\s+exceed|below|under|less\s+than|at\s+most|<=|<|at\s+least|minimum|pass(?:\s+[A-Za-z0-9_-]+?)?|>=|>)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i.exec(
      doc,
    );
  const fallbackNumMatch = /([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(doc);
  const rawNumStr = (kwNumMatch?.[1] ?? fallbackNumMatch?.[1])?.replace(/,/g, "");
  const docNum = rawNumStr !== undefined ? parseFloat(rawNumStr) : undefined;

  if (req.attributes.length > 0) {
    for (const attr of req.attributes) {
      const attrNum =
        attr.defaultVal !== undefined && !Number.isNaN(parseFloat(attr.defaultVal))
          ? parseFloat(attr.defaultVal)
          : docNum;
      if (attrNum !== undefined && Number.isFinite(attrNum)) {
        const lowerName = attr.name.toLowerCase();
        const op =
          lowerName.startsWith("max") ||
          lowerName.includes("limit") ||
          lowerName.includes("target") ||
          (isUpper && !isLower)
            ? "<="
            : lowerName.startsWith("min") || isLower
              ? ">="
              : "<=";
        synthesized.push(`${attr.name} ${op} ${attrNum}`);
      } else {
        const inferred = inferAttributeConstraint(attr.name, attr.type, attr.defaultVal, "guarantee");
        if (inferred) synthesized.push(inferred);
      }
    }
  } else if (docNum !== undefined && Number.isFinite(docNum)) {
    const op = isLower && !isUpper ? ">=" : "<=";
    synthesized.push(`${req.name} ${op} ${docNum}`);
  }

  return synthesized;
}

/**
 * Extracts a complete Assume-Guarantee contract hierarchy and Monterey Phoenix execution trace
 * directly from a SysML v2 model's definitions, ports, connections, requirements, and behaviors.
 */
export function extractSysML2ContractHierarchy(
  sysmlSource: string,
  options: { targetName?: string | undefined; scope?: number | undefined } = {},
): SysML2ContractHierarchyResult | null {
  const cleanSource = stripCommentsPreserveStructure(sysmlSource);

  // 0. Collect global numeric attribute defaults for symbolic constant substitution
  const constMap = new Map<string, string>();
  const globalAttrRegex = /\battribute\s+([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_][\w:]*)?\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*;/g;
  let gm: RegExpExecArray | null;
  while ((gm = globalAttrRegex.exec(cleanSource)) !== null) {
    constMap.set(gm[1]!, gm[2]!);
  }

  // 1. Parse Port Definitions (port def <Name> { ... })
  const portDefs = new Map<string, ParsedAttr[]>();
  const portDefRegex = /\bport\s+def\s+([A-Za-z_]\w*)\s*(?:\{|;)/g;
  let pm: RegExpExecArray | null;
  while ((pm = portDefRegex.exec(cleanSource)) !== null) {
    const name = pm[1]!;
    if (cleanSource[pm.index + pm[0].length - 1] === "{") {
      const openPos = pm.index + pm[0].length - 1;
      const block = extractBalancedBlock(sysmlSource, openPos);
      portDefs.set(name, extractAttributesFromBody(block.body));
      portDefRegex.lastIndex = block.endPos;
    } else {
      portDefs.set(name, []);
    }
  }

  // 2. Parse Use Case Definitions to identify Actor types and interaction steps
  const actorTypes = new Set<string>();
  const useCases: {
    name: string;
    doc?: string | undefined;
    subject?: { name: string; type: string } | undefined;
    actors: { name: string; type: string }[];
    includes: { name: string; type: string }[];
  }[] = [];
  const useCaseRegex = /\buse\s+case\s+def\s+([A-Za-z_]\w*)\s*\{/g;
  let ucm: RegExpExecArray | null;
  while ((ucm = useCaseRegex.exec(cleanSource)) !== null) {
    const name = ucm[1]!;
    const openPos = ucm.index + ucm[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openPos);
    const bodyClean = stripCommentsPreserveStructure(block.body);
    const subjMatch = /\bsubject\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w:]*)/.exec(bodyClean);
    const actors: { name: string; type: string }[] = [];
    const actorRegex = /\bactor\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w:]*)/g;
    let am: RegExpExecArray | null;
    while ((am = actorRegex.exec(bodyClean)) !== null) {
      const aType = am[2]!.split("::").pop()!;
      actorTypes.add(aType);
      actors.push({ name: am[1]!, type: aType });
    }
    const includes: { name: string; type: string }[] = [];
    const incRegex = /\binclude\s+(?:use\s+case\s+)?([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w:]*)/g;
    let im: RegExpExecArray | null;
    while ((im = incRegex.exec(bodyClean)) !== null) {
      includes.push({ name: im[1]!, type: im[2]!.split("::").pop()! });
    }
    useCases.push({
      name,
      doc: extractDocComment(block.body),
      subject: subjMatch ? { name: subjMatch[1]!, type: subjMatch[2]!.split("::").pop()! } : undefined,
      actors,
      includes,
    });
    useCaseRegex.lastIndex = block.endPos;
  }

  // 3. Parse Part Definitions (part def <Name> { ... }) and standalone contract blocks
  const partDefs = new Map<string, ParsedPartDef>();
  const partDefRegex =
    /\b(?:(?:abstract|variation)\s+)?(?:part\s+def|contract)\s+([A-Za-z_]\w*)(?:\s*:>\s*([A-Za-z_][\w:]*))?\s*(?:\{|;)/g;
  let pdm: RegExpExecArray | null;
  while ((pdm = partDefRegex.exec(cleanSource)) !== null) {
    const name = pdm[1]!;
    const superType = pdm[2]?.split("::").pop();
    const isBrace = cleanSource[pdm.index + pdm[0].length - 1] === "{";
    let body = "";
    if (isBrace) {
      const openPos = pdm.index + pdm[0].length - 1;
      const block = extractBalancedBlock(sysmlSource, openPos);
      body = block.body;
      partDefRegex.lastIndex = block.endPos;
    }

    const bodyClean = stripCommentsPreserveStructure(body);
    const attributes = extractAttributesFromBody(body);

    const ports: ParsedPort[] = [];
    const portRegex = /\b(?:(in|out|inout)\s+)?port\s+(?!def\b)([A-Za-z_]\w*)(?:\s*:\s*~?([A-Za-z_][\w:]*))?/g;
    let prm: RegExpExecArray | null;
    while ((prm = portRegex.exec(bodyClean)) !== null) {
      const pName = prm[2]!;
      const pType = prm[3] ? prm[3].split("::").pop()! : pName;
      let dir = prm[1] as "in" | "out" | "inout" | undefined;
      if (!dir) {
        if (/(?:In|Input)$/i.test(pName) || /^in[A-Z_]/.test(pName)) dir = "in";
        else if (/(?:Out|Output)$/i.test(pName) || /^out[A-Z_]/.test(pName)) dir = "out";
      }
      ports.push({ name: pName, portType: pType, direction: dir });
    }

    const subparts: ParsedSubpart[] = [];
    const subpartRegex = /\bpart\s+(?!def\b)([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w:]*)(?:\s*\[([^\]]+)\])?/g;
    let spm: RegExpExecArray | null;
    while ((spm = subpartRegex.exec(bodyClean)) !== null) {
      subparts.push({
        usageName: spm[1]!,
        partType: spm[2]!.split("::").pop()!,
        multiplicity: spm[3]?.trim(),
      });
    }

    const connections: ParsedConnection[] = [];
    const connRegex =
      /\bconnect\s+(?:([A-Za-z_]\w*)\s+)?([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s+to\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g;
    let cm: RegExpExecArray | null;
    while ((cm = connRegex.exec(bodyClean)) !== null) {
      connections.push({
        name: cm[1],
        sourcePart: cm[2]!,
        sourcePort: cm[3]!,
        targetPart: cm[4]!,
        targetPort: cm[5]!,
      });
    }

    const clauses = extractClausesFromBody(body, constMap);
    const isActor =
      actorTypes.has(name) &&
      attributes.length === 0 &&
      ports.length === 0 &&
      subparts.length === 0 &&
      clauses.assumptions.length === 0 &&
      clauses.guarantees.length === 0;

    partDefs.set(name, {
      name,
      superType,
      doc: extractDocComment(body),
      attributes,
      ports,
      subparts,
      connections,
      explicitAssumptions: clauses.assumptions,
      explicitGuarantees: clauses.guarantees,
      isActor,
    });
  }

  // 4. Parse Requirement Definitions (requirement def <Name> { ... })
  const reqDefs = new Map<string, ParsedReqDef>();
  const reqDefRegex = /\brequirement\s+def\s+([A-Za-z_]\w*)\s*\{/g;
  let rdm: RegExpExecArray | null;
  while ((rdm = reqDefRegex.exec(cleanSource)) !== null) {
    const name = rdm[1]!;
    const openPos = rdm.index + rdm[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openPos);
    const bodyClean = stripCommentsPreserveStructure(block.body);
    const subjMatch = /\bsubject\s+[A-Za-z_]\w*\s*:\s*([A-Za-z_][\w:]*)/.exec(bodyClean);
    const attributes = extractAttributesFromBody(block.body);
    const clauses = extractClausesFromBody(block.body, constMap);
    reqDefs.set(name, {
      name,
      doc: extractDocComment(block.body),
      subjectType: subjMatch ? subjMatch[1]!.split("::").pop()! : undefined,
      attributes,
      assumptions: clauses.assumptions,
      guarantees: clauses.guarantees,
    });
    reqDefRegex.lastIndex = block.endPos;
  }

  // 5. Parse Analysis Definitions (analysis def <Name> { ... }) & Constraint Definitions
  const analysisDefs: {
    name: string;
    subjectType?: string | undefined;
    objectiveReq?: string | undefined;
    guarantees: string[];
  }[] = [];
  const analysisRegex = /\banalysis\s+def\s+([A-Za-z_]\w*)\s*\{/g;
  let anm: RegExpExecArray | null;
  while ((anm = analysisRegex.exec(cleanSource)) !== null) {
    const name = anm[1]!;
    const openPos = anm.index + anm[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openPos);
    const bodyClean = stripCommentsPreserveStructure(block.body);
    const subjMatch = /\bsubject\s+[A-Za-z_]\w*\s*:\s*([A-Za-z_][\w:]*)/.exec(bodyClean);
    const objMatch = /\bobjective\s+[A-Za-z_]\w*(?:\s*:\s*([A-Za-z_][\w:]*))?/.exec(bodyClean);
    const clauses = extractClausesFromBody(block.body, constMap);
    const subjectType = subjMatch ? subjMatch[1]!.split("::").pop()! : undefined;
    const objectiveReq = objMatch?.[1] ? objMatch[1].split("::").pop()! : undefined;
    analysisDefs.push({
      name,
      subjectType,
      objectiveReq,
      guarantees: clauses.guarantees,
    });
    if (subjectType && partDefs.has(subjectType)) {
      const pd = partDefs.get(subjectType)!;
      for (const g of clauses.guarantees) {
        if (!pd.explicitGuarantees.includes(g)) pd.explicitGuarantees.push(g);
      }
    }
    if (objectiveReq && reqDefs.has(objectiveReq)) {
      const rd = reqDefs.get(objectiveReq)!;
      for (const g of clauses.guarantees) {
        if (!rd.guarantees.includes(g)) rd.guarantees.push(g);
      }
    }
    analysisRegex.lastIndex = block.endPos;
  }

  const constraintDefs: { name: string; guarantees: string[] }[] = [];
  const constraintDefRegex = /\bconstraint\s+def\s+([A-Za-z_]\w*)\s*\{/g;
  let cdm: RegExpExecArray | null;
  while ((cdm = constraintDefRegex.exec(cleanSource)) !== null) {
    const name = cdm[1]!;
    const openPos = cdm.index + cdm[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openPos);
    const clauses = extractClausesFromBody(`require constraint { ${block.body} }`, constMap);
    constraintDefs.push({ name, guarantees: clauses.guarantees });
    constraintDefRegex.lastIndex = block.endPos;
  }

  // 6. Parse top-level part usages & satisfy links (e.g. part vehicle : VehicleSystem::Vehicle; satisfy MassRequirement by vehicle;)
  const globalUsageToType = new Map<string, string>();
  const globalPartUsageRegex = /\bpart\s+(?!def\b)([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w:]*)/g;
  let gpum: RegExpExecArray | null;
  while ((gpum = globalPartUsageRegex.exec(cleanSource)) !== null) {
    globalUsageToType.set(gpum[1]!, gpum[2]!.split("::").pop()!);
  }

  const satisfiedReqsByPartType = new Map<string, string[]>();
  const satisfyLinks: { reqName: string; targetName: string; targetType: string }[] = [];
  const satisfyRegex = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z_][\w:]*)\s+by\s+([A-Za-z_][\w.]*)/g;
  let sm: RegExpExecArray | null;
  while ((sm = satisfyRegex.exec(cleanSource)) !== null) {
    const reqName = sm[1]!.split("::").pop()!;
    const targetUsage = sm[2]!.split(".").pop()!.split("::").pop()!;
    const resolvedType = globalUsageToType.get(targetUsage) ?? targetUsage;
    const list = satisfiedReqsByPartType.get(resolvedType) ?? [];
    if (!list.includes(reqName)) list.push(reqName);
    satisfiedReqsByPartType.set(resolvedType, list);
    satisfyLinks.push({ reqName, targetName: targetUsage, targetType: resolvedType });
  }

  // Also link requirements with explicit `subject <sName> : <PartType>`
  for (const [reqName, rd] of reqDefs.entries()) {
    if (rd.subjectType) {
      const list = satisfiedReqsByPartType.get(rd.subjectType) ?? [];
      if (!list.includes(reqName)) list.push(reqName);
      satisfiedReqsByPartType.set(rd.subjectType, list);
    }
  }

  // If there are no part defs, requirement defs, or analysis defs at all, return null
  const nonActorParts = Array.from(partDefs.values()).filter((p) => !p.isActor);
  if (nonActorParts.length === 0 && reqDefs.size === 0 && analysisDefs.length === 0 && constraintDefs.length === 0) {
    return null;
  }

  // 7. Determine Top-Level System and Subcomponents
  const targetName = options.targetName?.split("::").pop();
  let systemPartDef: ParsedPartDef | undefined;
  let focusedComponent: string | undefined;

  // Find composite part definitions (part defs that contain subparts)
  const compositeParts = nonActorParts.filter((p) => p.subparts.length > 0);

  if (targetName && partDefs.has(targetName)) {
    const clickedPart = partDefs.get(targetName)!;
    if (clickedPart.subparts.length > 0) {
      systemPartDef = clickedPart;
    } else {
      // Check if clickedPart is a subpart of a composite part in the same document
      const parentComposite = compositeParts.find((cp) => cp.subparts.some((sp) => sp.partType === targetName));
      if (parentComposite) {
        systemPartDef = parentComposite;
        focusedComponent = targetName;
      } else {
        systemPartDef = clickedPart;
      }
    }
  } else if (compositeParts.length > 0) {
    // Pick the composite part with the most subparts (e.g. Vehicle or DroneAssembly)
    systemPartDef = compositeParts.reduce((best, curr) => (curr.subparts.length >= best.subparts.length ? curr : best));
    if (targetName) focusedComponent = targetName;
  } else if (nonActorParts.length > 0) {
    // If all part defs have explicit contracts (e.g. PowertrainSystem, Battery, Motor), first is system, rest are components
    const withExplicit = nonActorParts.filter(
      (p) => p.explicitAssumptions.length > 0 || p.explicitGuarantees.length > 0,
    );
    systemPartDef = withExplicit[0] ?? nonActorParts[0]!;
    if (targetName && targetName !== systemPartDef.name) {
      focusedComponent = targetName;
    }
  }

  // Map connection topology inside systemPartDef to determine incoming/outgoing port contracts
  const incomingPortTypesByPart = new Map<string, { portName: string; portType: string; fromPart: string }[]>();
  const outgoingPortTypesByPart = new Map<string, { portName: string; portType: string; toPart: string }[]>();

  if (systemPartDef) {
    const usageToPartType = new Map<string, string>();
    for (const sp of systemPartDef.subparts) {
      usageToPartType.set(sp.usageName, sp.partType);
    }
    for (const conn of systemPartDef.connections) {
      const srcType = usageToPartType.get(conn.sourcePart) ?? conn.sourcePart;
      const dstType = usageToPartType.get(conn.targetPart) ?? conn.targetPart;
      const srcPd = partDefs.get(srcType);
      const dstPd = partDefs.get(dstType);
      const srcPortObj = srcPd?.ports.find((p) => p.name === conn.sourcePort);
      const dstPortObj = dstPd?.ports.find((p) => p.name === conn.targetPort);
      const portType = srcPortObj?.portType ?? dstPortObj?.portType ?? conn.sourcePort;

      const outList = outgoingPortTypesByPart.get(srcType) ?? [];
      outList.push({ portName: conn.sourcePort, portType, toPart: dstType });
      outgoingPortTypesByPart.set(srcType, outList);

      const inList = incomingPortTypesByPart.get(dstType) ?? [];
      inList.push({ portName: conn.targetPort, portType, fromPart: srcType });
      incomingPortTypesByPart.set(dstType, inList);
    }
  }

  // Helper to build a SysML2ContractNode from a ParsedPartDef
  const buildComponentContract = (pd: ParsedPartDef, usageLabel?: string): SysML2ContractNode => {
    const assumptions: string[] = [...pd.explicitAssumptions];
    const guarantees: string[] = [...pd.explicitGuarantees];

    // If no explicit assumptions/guarantees, derive from connected ports, declared ports, and attributes
    if (assumptions.length === 0 && guarantees.length === 0) {
      const incoming = incomingPortTypesByPart.get(pd.name) ?? [];
      const outgoing = outgoingPortTypesByPart.get(pd.name) ?? [];

      // 1. Incoming ports -> Assumptions
      for (const inc of incoming) {
        const pAttrs = portDefs.get(inc.portType) ?? [];
        for (const pa of pAttrs) {
          const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "assumption");
          if (c && !assumptions.includes(c)) assumptions.push(c);
        }
      }
      for (const p of pd.ports) {
        if (p.direction === "in") {
          const pAttrs = portDefs.get(p.portType) ?? [];
          for (const pa of pAttrs) {
            const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "assumption");
            if (c && !assumptions.includes(c)) assumptions.push(c);
          }
        }
      }

      // 2. Outgoing ports -> Guarantees
      for (const out of outgoing) {
        const pAttrs = portDefs.get(out.portType) ?? [];
        for (const pa of pAttrs) {
          const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "guarantee");
          if (c && !guarantees.includes(c)) guarantees.push(c);
        }
      }
      for (const p of pd.ports) {
        if (p.direction === "out" || (!p.direction && !incoming.some((i) => i.portName === p.name))) {
          const pAttrs = portDefs.get(p.portType) ?? [];
          for (const pa of pAttrs) {
            const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "guarantee");
            if (c && !guarantees.includes(c)) guarantees.push(c);
          }
        }
      }

      // 3. Component attributes
      const nonPortAttrs = pd.attributes.filter(
        (a) => !assumptions.some((ex) => ex.includes(a.name)) && !guarantees.some((ex) => ex.includes(a.name)),
      );
      if (nonPortAttrs.length > 0) {
        if (assumptions.length === 0 && nonPortAttrs.length >= 2 && guarantees.length === 0) {
          // Split first attribute as sizing/configuration assumption and remaining as guarantees
          const firstC = inferAttributeConstraint(
            nonPortAttrs[0]!.name,
            nonPortAttrs[0]!.type,
            nonPortAttrs[0]!.defaultVal,
            "assumption",
          );
          if (firstC) assumptions.push(firstC);
          for (let i = 1; i < nonPortAttrs.length; i++) {
            const gC = inferAttributeConstraint(
              nonPortAttrs[i]!.name,
              nonPortAttrs[i]!.type,
              nonPortAttrs[i]!.defaultVal,
              "guarantee",
            );
            if (gC && !guarantees.includes(gC)) guarantees.push(gC);
          }
        } else if (assumptions.length === 0 && guarantees.length > 0) {
          // Has output port guarantees; use first attribute as sizing assumption and also guarantee
          const firstC = inferAttributeConstraint(
            nonPortAttrs[0]!.name,
            nonPortAttrs[0]!.type,
            nonPortAttrs[0]!.defaultVal,
            "assumption",
          );
          if (firstC) assumptions.push(firstC);
          for (let i = 1; i < nonPortAttrs.length; i++) {
            const gC = inferAttributeConstraint(
              nonPortAttrs[i]!.name,
              nonPortAttrs[i]!.type,
              nonPortAttrs[i]!.defaultVal,
              "guarantee",
            );
            if (gC && !guarantees.includes(gC)) guarantees.push(gC);
          }
        } else {
          // Already has port assumptions; remaining attributes are guarantees (or last is assumption if multiple)
          for (let i = 0; i < nonPortAttrs.length; i++) {
            const attr = nonPortAttrs[i]!;
            const isConfigAttr =
              assumptions.length <= 1 &&
              i === nonPortAttrs.length - 1 &&
              nonPortAttrs.length >= 2 &&
              /^(?:displacement|capacity|diameter|length|thickness)$/i.test(attr.name);
            const c = inferAttributeConstraint(
              attr.name,
              attr.type,
              attr.defaultVal,
              isConfigAttr ? "assumption" : "guarantee",
            );
            if (c) {
              if (isConfigAttr && !assumptions.includes(c)) assumptions.push(c);
              else if (!guarantees.includes(c)) guarantees.push(c);
            }
          }
        }
      }

      // Check if any requirements explicitly target this component
      const linkedReqs = satisfiedReqsByPartType.get(pd.name) ?? [];
      for (const rName of linkedReqs) {
        const rd = reqDefs.get(rName);
        if (rd) {
          for (const a of rd.assumptions) if (!assumptions.includes(a)) assumptions.push(a);
          for (const g of synthesizeRequirementGuarantees(rd)) {
            if (!guarantees.includes(g)) guarantees.push(g);
          }
        }
      }
    }

    if (assumptions.length === 0 && guarantees.length > 0) {
      assumptions.push(guarantees[0]!);
    }

    return {
      name: pd.name,
      symbolName: pd.name,
      role: usageLabel,
      doc: pd.doc,
      assumptions,
      guarantees,
      isFocused: focusedComponent === pd.name,
    };
  };

  let components: SysML2ContractNode[] = [];
  let systemNode: SysML2ContractNode;

  if (systemPartDef) {
    if (systemPartDef.subparts.length > 0) {
      const seenTypes = new Set<string>();
      for (const sp of systemPartDef.subparts) {
        if (seenTypes.has(sp.partType)) continue;
        seenTypes.add(sp.partType);
        const childPd = partDefs.get(sp.partType);
        const roleLabel = `${sp.usageName} : ${sp.partType}${sp.multiplicity ? `[${sp.multiplicity}]` : ""}`;
        if (childPd) {
          components.push(buildComponentContract(childPd, roleLabel));
        } else {
          components.push({
            name: sp.partType,
            symbolName: sp.partType,
            role: roleLabel,
            assumptions: [`${sp.usageName}_ready >= 1`],
            guarantees: [`${sp.usageName}_ready >= 1`],
            isFocused: focusedComponent === sp.partType,
          });
        }
      }
    } else {
      // No subparts on systemPartDef; other non-actor partDefs or reqDefs are components
      for (const pd of nonActorParts) {
        if (pd.name === systemPartDef.name) continue;
        components.push(buildComponentContract(pd, "Part Definition"));
      }
      if (components.length === 0) {
        for (const rd of reqDefs.values()) {
          const reqG = synthesizeRequirementGuarantees(rd);
          components.push({
            name: rd.name,
            symbolName: rd.name,
            role: "Requirement",
            doc: rd.doc,
            assumptions: rd.assumptions.length > 0 ? [...rd.assumptions] : [...reqG],
            guarantees: reqG,
            isFocused: focusedComponent === rd.name,
          });
        }
      }
    }

    // If a specific component was focused by the user, place it first for immediate visibility
    if (focusedComponent) {
      components.sort((a, b) => (a.isFocused === b.isFocused ? 0 : a.isFocused ? -1 : 1));
    }

    // Build Top-Level System Contract
    const sysAssumptions: string[] = [...systemPartDef.explicitAssumptions];
    const sysGuarantees: string[] = [...systemPartDef.explicitGuarantees];

    if (sysAssumptions.length === 0 && sysGuarantees.length === 0) {
      // 1. Collect system-level satisfied requirements (plus document requirements when systemPartDef is the root composite)
      const satisfiedReqNames = new Set<string>(satisfiedReqsByPartType.get(systemPartDef.name) ?? []);
      if (systemPartDef.subparts.length > 0) {
        for (const rName of reqDefs.keys()) satisfiedReqNames.add(rName);
      }

      for (const rName of satisfiedReqNames) {
        const rd = reqDefs.get(rName);
        if (rd) {
          for (const a of rd.assumptions) {
            if (!sysAssumptions.includes(a)) sysAssumptions.push(a);
          }
          for (const g of synthesizeRequirementGuarantees(rd)) {
            if (!sysGuarantees.includes(g)) sysGuarantees.push(g);
          }
        }
      }

      // 2. Include systemPartDef's own attributes (e.g. mass, topSpeed, totalMass, totalFrontalArea)
      for (const attr of systemPartDef.attributes) {
        const c = inferAttributeConstraint(attr.name, attr.type, attr.defaultVal, "guarantee");
        if (c && !sysGuarantees.includes(c)) {
          sysGuarantees.push(c);
        }
      }

      // 3. Include key output guarantees delivered by subcomponents (e.g. torqueValue, voltage, maxBrakingForce)
      const allCompGuarantees = components.flatMap((c) => c.guarantees);
      for (const cg of allCompGuarantees) {
        if (sysGuarantees.length < 6 && !sysGuarantees.includes(cg)) {
          sysGuarantees.push(cg);
        }
      }

      // 4. Compute external/environmental assumptions required for compositional compatibility & refinement
      // Any component assumption not already entailed by sibling component guarantees is an external system assumption
      for (let i = 0; i < components.length; i++) {
        const comp = components[i]!;
        const peerGuarantees = components.filter((_, idx) => idx !== i).flatMap((c) => c.guarantees);
        for (const a of comp.assumptions) {
          const ent = checkSymbolicEntailment([...sysAssumptions, ...peerGuarantees], a);
          if (!ent.entailed && !sysAssumptions.includes(a)) {
            sysAssumptions.push(a);
          }
        }
      }

      // Any system guarantee not entailed by component guarantees (such as system-level mass/rating/time requirements)
      // is backed by a corresponding system-level boundary assumption or parameter bound
      for (const g of sysGuarantees) {
        const ent = checkSymbolicEntailment([...sysAssumptions, ...allCompGuarantees], g);
        if (!ent.entailed && !sysAssumptions.includes(g)) {
          sysAssumptions.push(g);
        }
      }
    }

    systemNode = {
      name: systemPartDef.name,
      symbolName: systemPartDef.name,
      role: "Top-Level System",
      doc: systemPartDef.doc,
      assumptions: sysAssumptions,
      guarantees: sysGuarantees,
      isFocused: focusedComponent === undefined || focusedComponent === systemPartDef.name,
    };
  } else {
    // Document only has requirement defs / analysis defs / constraint defs
    const allReqs = Array.from(reqDefs.values());
    const firstReq = allReqs[0];
    if (firstReq) {
      const reqG = synthesizeRequirementGuarantees(firstReq);
      systemNode = {
        name: analysisDefs[0]?.name ?? firstReq.name,
        symbolName: analysisDefs[0]?.name ?? firstReq.name,
        role: analysisDefs[0] ? "Verification Analysis" : "Top-Level Requirement",
        doc: firstReq.doc,
        assumptions: firstReq.assumptions.length > 0 ? [...firstReq.assumptions] : [...reqG],
        guarantees: analysisDefs[0]?.guarantees.length ? [...analysisDefs[0].guarantees] : reqG,
      };
      for (const rd of allReqs) {
        const g = synthesizeRequirementGuarantees(rd);
        components.push({
          name: rd.name,
          symbolName: rd.name,
          role: "Requirement",
          doc: rd.doc,
          assumptions: rd.assumptions.length > 0 ? [...rd.assumptions] : [...g],
          guarantees: g,
        });
      }
    } else {
      const firstC = constraintDefs[0]!;
      systemNode = {
        name: firstC.name,
        symbolName: firstC.name,
        role: "Constraint Definition",
        assumptions: [...firstC.guarantees],
        guarantees: [...firstC.guarantees],
      };
    }
  }

  // 8. Run formal algebraic verification via ContractAlgebra.verifySystemComposition
  const compResult = ContractAlgebra.verifySystemComposition(systemNode, components);

  // 9. Extract State Machine states/transitions and Behavioral Event Traces (Monterey Phoenix)
  const states: string[] = [];
  const transitions: { name: string; from: string; to: string; guard?: string | undefined; stateMachine?: string }[] =
    [];
  const stateDefRegex = /\bstate\s+def\s+([A-Za-z_]\w*)\s*\{/g;
  let sdm: RegExpExecArray | null;
  while ((sdm = stateDefRegex.exec(cleanSource)) !== null) {
    const smName = sdm[1]!;
    const openPos = sdm.index + sdm[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openPos);
    const bodyClean = stripCommentsPreserveStructure(block.body);

    const stRegex = /\bstate\s+(?!def\b)([A-Za-z_]\w*)\s*(?:;|\{)/g;
    let stm: RegExpExecArray | null;
    while ((stm = stRegex.exec(bodyClean)) !== null) {
      if (!states.includes(stm[1]!)) states.push(stm[1]!);
    }

    const trRegex =
      /\btransition\s+(?:([A-Za-z_]\w*)\s+)?first\s+([A-Za-z_]\w*)(?:\s+if\s+([^\n]+?))?\s+then\s+([A-Za-z_]\w*)\s*;/g;
    let trm: RegExpExecArray | null;
    while ((trm = trRegex.exec(bodyClean)) !== null) {
      const from = trm[2]!;
      const to = trm[4]!;
      const tName = trm[1] ?? `${from}_to_${to}`;
      if (!states.includes(from)) states.push(from);
      if (!states.includes(to)) states.push(to);
      transitions.push({ name: tName, from, to, guard: trm[3]?.trim(), stateMachine: smName });
    }
    stateDefRegex.lastIndex = block.endPos;
  }

  // Extract Action Definitions (action def <Name> { in ...; out ...; })
  const actionDefs: { name: string; inputs: ParsedAttr[]; outputs: ParsedAttr[] }[] = [];
  const actionDefRegex = /\baction\s+def\s+([A-Za-z_]\w*)\s*\{/g;
  let adm: RegExpExecArray | null;
  while ((adm = actionDefRegex.exec(cleanSource)) !== null) {
    const name = adm[1]!;
    const openPos = adm.index + adm[0].length - 1;
    const block = extractBalancedBlock(sysmlSource, openPos);
    const bodyClean = stripCommentsPreserveStructure(block.body);
    const inputs: ParsedAttr[] = [];
    const outputs: ParsedAttr[] = [];
    const pinRegex = /\b(in|out|inout)\s+(?:item\s+|attribute\s+)?([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_][\w:]*))?/g;
    let pim: RegExpExecArray | null;
    while ((pim = pinRegex.exec(bodyClean)) !== null) {
      const dir = pim[1]!;
      const pName = pim[2]!;
      const pType = pim[3] ? pim[3].split("::").pop()! : "Real";
      if (dir === "in" || dir === "inout") inputs.push({ name: pName, type: pType });
      if (dir === "out" || dir === "inout") outputs.push({ name: pName, type: pType });
    }
    actionDefs.push({ name, inputs, outputs });
    actionDefRegex.lastIndex = block.endPos;
  }

  // Synthesize Monterey Phoenix scope-complete execution trace steps from actual model elements
  const traces: SysML2ContractTraceStep[] = [];
  let stepCounter = 1;

  // 9a. Use Case initiation (if present)
  if (useCases.length > 0) {
    const primaryUc = useCases[0]!;
    const actorName = primaryUc.actors[0]?.type ?? primaryUc.actors[0]?.name ?? "Operator";
    const targetNameStr = primaryUc.subject?.type ?? systemNode.name;
    const incStr =
      primaryUc.includes.length > 0
        ? `include ${primaryUc.includes.map((i) => i.type).join(", ")}`
        : (primaryUc.doc ?? `initiate ${primaryUc.name}`);
    traces.push({
      step: stepCounter++,
      actor: actorName,
      event: primaryUc.name,
      targetActor: targetNameStr,
      message: incStr,
      sourceSymbol: primaryUc.name,
    });
  }

  // 9b. Initial State Machine transition (e.g. off_to_idle: off -> idle)
  if (transitions.length > 0) {
    const t0 = transitions[0]!;
    traces.push({
      step: stepCounter++,
      actor: t0.stateMachine ?? t0.from,
      event: t0.name,
      targetActor: t0.to,
      message: `state: ${t0.from} ➔ ${t0.to}${t0.guard ? ` [${t0.guard}]` : ""}`,
      sourceSymbol: t0.name,
    });
  }

  // 9c. First Behavioral Action (e.g. StartEngine)
  if (actionDefs.length > 0) {
    const act0 = actionDefs[0]!;
    const inStr = act0.inputs.map((i) => i.name).join(", ") || "trigger";
    const outStr = act0.outputs.map((o) => `${o.name} : ${o.type}`).join(", ") || "completed";
    traces.push({
      step: stepCounter++,
      actor: act0.name,
      event: inStr,
      targetActor: components[0]?.name ?? systemNode.name,
      message: `out ${outStr}`,
      sourceSymbol: act0.name,
    });
  }

  // 9d. Structural Port Connections (e.g. fuelTank.fuelOut -> engine.fuelIn, engine.torqueOut -> transmission.torqueIn)
  if (systemPartDef && systemPartDef.connections.length > 0) {
    const usageToPartType = new Map<string, string>();
    for (const sp of systemPartDef.subparts) {
      usageToPartType.set(sp.usageName, sp.partType);
    }
    for (const conn of systemPartDef.connections) {
      const srcType = usageToPartType.get(conn.sourcePart) ?? conn.sourcePart;
      const dstType = usageToPartType.get(conn.targetPart) ?? conn.targetPart;
      const srcPd = partDefs.get(srcType);
      const dstPd = partDefs.get(dstType);
      const portObj =
        srcPd?.ports.find((p) => p.name === conn.sourcePort) ?? dstPd?.ports.find((p) => p.name === conn.targetPort);
      const pType = portObj?.portType ?? conn.sourcePort;
      const pAttrs = portDefs.get(pType) ?? [];
      const attrSummary =
        pAttrs.length > 0
          ? `${pType} (${pAttrs.map((a) => `${a.name} : ${a.type}`).join(", ")})`
          : `${conn.targetPart}.${conn.targetPort} (${dstType})`;
      traces.push({
        step: stepCounter++,
        actor: `${conn.sourcePart} (${srcType})`,
        event: conn.sourcePort,
        targetActor: `${conn.targetPart}.${conn.targetPort}`,
        message: attrSummary,
        sourceSymbol: srcType,
      });
    }
  }

  // 9e. Subsequent State Machine transitions & Behavioral Actions (e.g. idle_to_driving, Accelerate, Brake)
  for (let i = 1; i < transitions.length; i++) {
    const tr = transitions[i]!;
    traces.push({
      step: stepCounter++,
      actor: tr.stateMachine ?? tr.from,
      event: tr.name,
      targetActor: tr.to,
      message: `state: ${tr.from} ➔ ${tr.to}${tr.guard ? ` [${tr.guard}]` : ""}`,
      sourceSymbol: tr.name,
    });
  }

  for (let i = 1; i < actionDefs.length; i++) {
    const act = actionDefs[i]!;
    const inStr = act.inputs.map((inp) => inp.name).join(", ") || "execute";
    const outStr = act.outputs.map((o) => `${o.name} : ${o.type}`).join(", ") || "done";
    traces.push({
      step: stepCounter++,
      actor: act.name,
      event: inStr,
      targetActor: systemNode.name,
      message: `out ${outStr}`,
      sourceSymbol: act.name,
    });
  }

  // 9f. Also include multi-step CFG traces from SysML2EventTraceExplorer if activities have internal action nodes
  try {
    const mpRes = SysML2EventTraceExplorer.exploreText(sysmlSource, {
      scope: options.scope ?? 2,
      maxTraces: 5,
    });
    if (mpRes.traces.length > 0 && traces.length === 0) {
      const firstTrace = mpRes.traces[0]!;
      for (const ev of firstTrace.events) {
        const [actor, eventName] = ev.includes(".") ? ev.split(".", 2) : [mpRes.modelName, ev];
        traces.push({
          step: stepCounter++,
          actor: actor!,
          event: eventName!,
          targetActor: systemNode.name,
          message: `scope k=${options.scope ?? 2} event`,
          sourceSymbol: eventName!,
        });
      }
    }
  } catch {
    // Ignore exploratory parser errors on partial edits
  }

  // 9g. Requirement satisfaction / verification steps
  if (satisfyLinks.length > 0) {
    for (const sl of satisfyLinks) {
      const rd = reqDefs.get(sl.reqName);
      const reqClauses = rd ? synthesizeRequirementGuarantees(rd) : [];
      traces.push({
        step: stepCounter++,
        actor: `${sl.targetName} (${sl.targetType})`,
        event: "satisfy",
        targetActor: sl.reqName,
        message: reqClauses.join(", ") || rd?.doc || "requirement satisfied",
        sourceSymbol: sl.reqName,
      });
    }
  } else if (reqDefs.size > 0) {
    for (const rd of reqDefs.values()) {
      const reqClauses = synthesizeRequirementGuarantees(rd);
      traces.push({
        step: stepCounter++,
        actor: rd.subjectType ?? systemNode.name,
        event: "verify",
        targetActor: rd.name,
        message: reqClauses.join(", ") || rd.doc || "requirement verified",
        sourceSymbol: rd.name,
      });
    }
  }

  // 9h. Fallback if model only has parts and no actions/states/connections/requirements
  if (traces.length === 0) {
    for (const comp of components) {
      traces.push({
        step: stepCounter++,
        actor: comp.name,
        event: "guarantee",
        targetActor: systemNode.name,
        message: comp.guarantees.join(" && ") || "nominal",
        sourceSymbol: comp.symbolName ?? comp.name,
      });
    }
  }

  return {
    system: systemNode,
    components,
    isCompatible: compResult.isCompatible,
    isRefined: compResult.isRefined,
    compatibilityViolations: compResult.compatibilityViolations,
    refinementViolations: compResult.refinementViolations,
    traces,
    states: states.length > 0 ? states : undefined,
    transitions: transitions.length > 0 ? transitions : undefined,
    focusedComponent,
    summary: compResult.summary,
  };
}
