// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { SmtOctagonDBM } from "./smt-bridge.js";
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

  // Map variable names
  const varMap = new Map<string, number>();
  let nextId = 0;
  const getVarId = (name: string): number => {
    // Strip qualification prefix if any (e.g. "p.voltage" -> "voltage")
    const shortName = name.includes(".") ? name.split(".").pop()! : name;
    let id = varMap.get(shortName);
    if (id === undefined) {
      id = nextId++;
      varMap.set(shortName, id);
    }
    return id;
  };

  for (const c of [...gConstraints, ...aConstraints]) {
    getVarId(c.variable);
  }

  const numVars = Math.max(nextId, 1);
  const dbm = new SmtOctagonDBM(numVars);

  // Apply supplier guarantees to find bounds
  for (const g of gConstraints) {
    const v = getVarId(g.variable);
    const curLo = dbm.getLowerBound(v);
    const curHi = dbm.getUpperBound(v);
    if (g.operator === "<=" || g.operator === "<") {
      dbm.assumeInterval(v, curLo, Math.floor(g.value));
    } else if (g.operator === ">=" || g.operator === ">") {
      dbm.assumeInterval(v, Math.ceil(g.value), curHi);
    } else if (g.operator === "==") {
      dbm.assumeInterval(v, Math.round(g.value), Math.round(g.value));
    }
  }

  // Check each consumer assumption
  for (let i = 0; i < aConstraints.length; i++) {
    const a = aConstraints[i]!;
    const varName = a.variable.includes(".") ? a.variable.split(".").pop()! : a.variable;
    const v = getVarId(a.variable);
    const gLo = dbm.getLowerBound(v);
    const gHi = dbm.getUpperBound(v);

    // If consumer assumes x >= min, supplier must guarantee gLo >= min
    if (a.operator === ">=" || a.operator === ">") {
      const requiredMin = a.operator === ">=" ? Math.ceil(a.value) : Math.floor(a.value + 1);
      if (gLo < requiredMin) {
        violations.push({
          connectionName,
          sourceEndpoint: supplierName,
          targetEndpoint: consumerName,
          guarantee:
            guarantees.find((g) => g.includes(varName) || g.includes(a.variable)) || `${varName} ∈ [${gLo}, ${gHi}]`,
          assumption: assumptions[i] || `${a.variable} ${a.operator} ${a.value}`,
          variable: varName,
          counterexample: gLo <= -100000 ? a.value - 1 : gLo,
          reason: `Supplier '${supplierName}' can deliver ${varName} = ${gLo <= -100000 ? "-∞" : gLo}, violating consumer '${consumerName}' assumption '${a.variable} >= ${a.value}'`,
        });
      }
    }

    // If consumer assumes x <= max, supplier must guarantee gHi <= max
    if (a.operator === "<=" || a.operator === "<") {
      const requiredMax = a.operator === "<=" ? Math.floor(a.value) : Math.ceil(a.value - 1);
      if (gHi > requiredMax) {
        violations.push({
          connectionName,
          sourceEndpoint: supplierName,
          targetEndpoint: consumerName,
          guarantee:
            guarantees.find((g) => g.includes(varName) || g.includes(a.variable)) || `${varName} ∈ [${gLo}, ${gHi}]`,
          assumption: assumptions[i] || `${a.variable} ${a.operator} ${a.value}`,
          variable: varName,
          counterexample: gHi >= 100000 ? a.value + 1 : gHi,
          reason: `Supplier '${supplierName}' can deliver ${varName} = ${gHi >= 100000 ? "∞" : gHi}, violating consumer '${consumerName}' assumption '${a.variable} <= ${a.value}'`,
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
