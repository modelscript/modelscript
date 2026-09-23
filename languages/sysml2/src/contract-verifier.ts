// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { parseGuardConstraints } from "./state-machine-verifier.js";

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

  // Parse all guarantee constraints into bounds per variable
  const gConstraints = guarantees.flatMap((g) => parseGuardConstraints(g));
  const aConstraints = assumptions.flatMap((a) => parseGuardConstraints(a));

  if (gConstraints.length === 0 || aConstraints.length === 0) {
    // If either side has no constraints, no contract violation can be proven
    return { isSatisfied: true, violations: [] };
  }

  // Exact real bounds per variable
  const gBounds = new Map<string, { lower: number; upper: number }>();

  // Apply supplier guarantees to find bounds
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
    const varName = a.variable.includes(".") ? a.variable.split(".").pop()! : a.variable;
    const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
    const gLo = b.lower;
    const gHi = b.upper;

    // If consumer assumes x >= min, supplier must guarantee gLo >= min
    if (a.operator === ">=" || a.operator === ">") {
      const requiredMin = a.value;
      if (gLo < requiredMin - 1e-9) {
        violations.push({
          connectionName,
          sourceEndpoint: supplierName,
          targetEndpoint: consumerName,
          guarantee:
            guarantees.find((g) => g.includes(varName) || g.includes(a.variable)) || `${varName} ∈ [${gLo}, ${gHi}]`,
          assumption: assumptions[i] || `${a.variable} ${a.operator} ${a.value}`,
          variable: varName,
          counterexample: !Number.isFinite(gLo) ? a.value - 1 : gLo,
          reason: `Supplier '${supplierName}' can deliver ${varName} = ${!Number.isFinite(gLo) ? "-∞" : gLo}, violating consumer '${consumerName}' assumption '${a.variable} >= ${a.value}'`,
        });
      }
    }

    // If consumer assumes x <= max, supplier must guarantee gHi <= max
    if (a.operator === "<=" || a.operator === "<") {
      const requiredMax = a.value;
      if (gHi > requiredMax + 1e-9) {
        violations.push({
          connectionName,
          sourceEndpoint: supplierName,
          targetEndpoint: consumerName,
          guarantee:
            guarantees.find((g) => g.includes(varName) || g.includes(a.variable)) || `${varName} ∈ [${gLo}, ${gHi}]`,
          assumption: assumptions[i] || `${a.variable} ${a.operator} ${a.value}`,
          variable: varName,
          counterexample: !Number.isFinite(gHi) ? a.value + 1 : gHi,
          reason: `Supplier '${supplierName}' can deliver ${varName} = ${!Number.isFinite(gHi) ? "∞" : gHi}, violating consumer '${consumerName}' assumption '${a.variable} <= ${a.value}'`,
        });
      }
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
}
