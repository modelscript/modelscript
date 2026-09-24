import {
  DpllTSolver,
  Interval,
  type ExprNode,
  type NonlinearConstraint,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import { extractVariables, parseGuardConstraints, type GuardConstraint } from "./state-machine-verifier.js";

/**
 * Diagnostic information when an Assume-Guarantee interface contract fails.
 */
export interface ContractViolation {
  connectionName?: string;
  sourceEndpoint: string;
  targetEndpoint: string;
  guarantee: string;
  assumption: string;
  variable: string;
  counterexample: number;
  reason: string;
}

export interface ContractVerificationResult {
  isSatisfied: boolean;
  violations: ContractViolation[];
}

export interface TemporalContract {
  name?: string;
  assumption: string;
  guarantee: string;
  timeHorizon?: [number, number];
}

export interface TemporalContractResult {
  isSatisfied: boolean;
  minRobustness: number;
  violationTime?: number;
  counterexample?: number;
  reason?: string;
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

    // Assumption holds -> check if guarantee holds
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

export interface EntailmentResult {
  entailed: boolean;
  reason?: string;
  counterexample?: Record<string, [number, number]>;
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
      const varName = g.variable.includes(".") ? g.variable.split(".").pop()! : g.variable;
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

    let allHold = true;
    for (const a of cConstraints) {
      const varName = a.variable.includes(".") ? a.variable.split(".").pop()! : a.variable;
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
      const varName = c.variable.includes(".") ? c.variable.split(".").pop()! : c.variable;
      allVarNames.add(varName);
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
          const varName = p.variable.includes(".") ? p.variable.split(".").pop()! : p.variable;
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
        initialBox.set(v, new Interval(-1000, 1000));
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
): ContractVerificationResult {
  const violations: ContractViolation[] = [];

  const gConstraints = guarantees.flatMap((g) => parseGuardConstraints(g));
  const aConstraints = assumptions.flatMap((a) => parseGuardConstraints(a));

  if (gConstraints.length === 0 || aConstraints.length === 0) {
    return { isSatisfied: true, violations: [] };
  }

  // Exact real bounds per variable
  const gBounds = new Map<string, { lower: number; upper: number }>();
  for (const g of gConstraints) {
    const varName = g.variable.includes(".") ? g.variable.split(".").pop()! : g.variable;
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
    const ent = checkSymbolicEntailment(guarantees, aRaw);

    if (!ent.entailed) {
      const varName = a.variable.includes(".") ? a.variable.split(".").pop()! : a.variable;
      const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
      const gLo = b.lower;
      const gHi = b.upper;

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
          guarantees.find((g) => g.includes(varName) || g.includes(a.variable)) || `${varName} ∈ [${gLo}, ${gHi}]`,
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
export function verifyAllInterfaceContracts(db: QueryDB, scopeFilter?: string): ContractVerificationResult {
  const allEntries = db.allEntries();
  const connections = allEntries.filter(
    (e) => (e.ruleName === "ConnectionUsage" || e.ruleName === "BindingConnectorAsUsage") && e.name,
  );

  const allViolations: ContractViolation[] = [];

  for (const conn of connections) {
    if (scopeFilter && conn.name !== scopeFilter && !conn.name.includes(scopeFilter)) {
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
        sourceName = refs[0]?.name || db.cstText(refs[0]?.startByte || 0, refs[0]?.endByte || 0);
        targetName = refs[1]?.name || db.cstText(refs[1]?.startByte || 0, refs[1]?.endByte || 0);
      }
    }

    if (!sourceName || !targetName) continue;

    // Find source and target symbols
    const sourceSymbols = db.byName(sourceName);
    const targetSymbols = db.byName(targetName);

    const sourceSym = sourceSymbols[0];
    const targetSym = targetSymbols[0];

    const sourceGuarantees: string[] = [];
    const targetAssumptions: string[] = [];

    const collectConstraints = (sym: SymbolEntry | undefined, isSource: boolean) => {
      if (!sym) return;
      // Check children constraints
      const children = db.childrenOf(sym.id);
      for (const child of children) {
        const text = db.cstText(child.startByte, child.endByte, child);
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
      const res = verifyAssumeGuaranteePair(sourceName, targetName, sourceGuarantees, targetAssumptions, conn.name);
      allViolations.push(...res.violations);
    }
  }

  return {
    isSatisfied: allViolations.length === 0,
    violations: allViolations,
  };
}

export interface AssumeGuaranteeContract {
  name: string;
  assumptions: string[];
  guarantees: string[];
  inputs?: string[];
  outputs?: string[];
}

export interface RefinementResult {
  isRefined: boolean;
  assumptionViolations: string[];
  guaranteeViolations: string[];
  summary: string;
}

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
   * 1. Compatibility Check:
   *    For each component i:
   *      (A_sys /\ \bigwedge_{j != i} G_j) => A_i
   *    Proves that the environment and peer components satisfy all component assumptions.
   *
   * 2. Refinement / Dominance Check:
   *    (A_sys /\ \bigwedge_i G_i) => G_sys
   *    Proves that component guarantees collectively deliver the top-level system guarantees.
   */
  public static verifySystemComposition(
    systemContract: AssumeGuaranteeContract,
    componentContracts: AssumeGuaranteeContract[],
  ): CompositionalProofResult {
    const compatibilityViolations: CompositionalProofResult["compatibilityViolations"] = [];
    const refinementViolations: CompositionalProofResult["refinementViolations"] = [];

    // 1. Compatibility Check
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

export interface CompositionalProofResult {
  isCompatible: boolean;
  isRefined: boolean;
  compatibilityViolations: {
    component: string;
    missingAssumption: string;
    reason: string;
    counterexample?: Record<string, [number, number]>;
  }[];
  refinementViolations: {
    systemGuarantee: string;
    reason: string;
    counterexample?: Record<string, [number, number]>;
  }[];
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
  domainBounds?: Map<string, [number, number]>,
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
