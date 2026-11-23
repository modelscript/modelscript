// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Cross-Domain Static Analysis & Pre-Simulation Lint Checks.
 *
 * Provides structured compiler/static-analysis diagnostics for:
 *   - M5101 (`unidentifiable-parameter`): Pre-calibration structural identifiability check
 *   - M5102 (`non-passive-macromodel`): Touchstone / SPICE / EMT scattering & immittance passivity check
 *   - M5103 (`stoichiometric-conservation-violation`): SBML / Cantera / PHREEQC mass/element balance check
 *   - M5104 (`lvs-netlist-mismatch`): KiCad / SPICE / Atopile VF2 Layout-vs-Schematic equivalence check
 */

import { PassivityTheoryOracle, type MacromodelPassivitySpec } from "../formal/oracles/passivity_oracle.js";
import { vf2SubgraphIsomorphism, type LabeledGraph } from "../math/csr_graph.js";
import { analyzeIdentifiability, type IdentifiabilityInput } from "./identifiability.js";

export interface DomainLintDiagnostic {
  readonly code: string;
  readonly rule: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly entity?: string | undefined;
}

/** M5101: Pre-calibration structural identifiability lint. */
export function lintUnidentifiableParameters(input: IdentifiabilityInput): DomainLintDiagnostic[] {
  const res = analyzeIdentifiability(input);
  if (res.isStructurallyIdentifiable) return [];
  return res.unidentifiableParams.map((param) => ({
    code: "M5101",
    rule: "unidentifiable-parameter",
    severity: "warning" as const,
    entity: param,
    message: `Parameter '${param}' is structurally unidentifiable or collinear (rank ${res.numericalRank}/${res.numParameters}, collinearity ${res.collinearityIndex.toFixed(2)}).`,
  }));
}

/** M5102: Frequency-domain macromodel passivity lint (Touchstone / IBIS / EMT). */
export function lintMacromodelPassivity(spec: MacromodelPassivitySpec): DomainLintDiagnostic[] {
  const oracle = new PassivityTheoryOracle();
  oracle.registerMacromodel(spec);
  const violations = oracle.findViolations();
  return violations.map((v) => ({
    code: "M5102",
    rule: "non-passive-macromodel",
    severity: "error" as const,
    entity: v.modelId,
    message: `Macromodel '${v.modelId}' violates ${v.kind} passivity at ${v.frequencyHz} Hz (value ${v.value.toExponential(4)} vs bound ${v.limit}).`,
  }));
}

/**
 * M5103: Element / mass conservation lint for reaction networks (SBML / Cantera / PHREEQC).
 * Checks that elementMatrix (numElem x numSpecies) * stoichiometry^T (numSpecies x numRxns) == 0.
 */
export function lintStoichiometricConservation(
  elementNames: readonly string[],
  reactionNames: readonly string[],
  elementMatrix: readonly (readonly number[])[],
  stoichiometryRxnBySpecies: readonly (readonly number[])[],
  tol = 1e-9,
): DomainLintDiagnostic[] {
  const diags: DomainLintDiagnostic[] = [];
  const numElem = elementMatrix.length;
  const numRxns = stoichiometryRxnBySpecies.length;
  for (let r = 0; r < numRxns; r++) {
    const stoich = stoichiometryRxnBySpecies[r]!;
    for (let e = 0; e < numElem; e++) {
      const elemRow = elementMatrix[e]!;
      let net = 0;
      for (let s = 0; s < stoich.length; s++) {
        net += (elemRow[s] ?? 0) * stoich[s]!;
      }
      if (Math.abs(net) > tol) {
        const rxn = reactionNames[r] ?? `R${r}`;
        const el = elementNames[e] ?? `E${e}`;
        diags.push({
          code: "M5103",
          rule: "stoichiometric-conservation-violation",
          severity: "error",
          entity: rxn,
          message: `Reaction '${rxn}' violates conservation of element '${el}' (net imbalance = ${net.toFixed(4)}).`,
        });
      }
    }
  }
  return diags;
}

/** M5104: VF2 Layout-vs-Schematic (LVS) netlist equivalence lint. */
export function lintLvsGraphEquivalence(
  schematicId: string,
  schematic: LabeledGraph,
  layout: LabeledGraph,
): DomainLintDiagnostic[] {
  if (schematic.numNodes !== layout.numNodes) {
    return [
      {
        code: "M5104",
        rule: "lvs-netlist-mismatch",
        severity: "error",
        entity: schematicId,
        message: `LVS mismatch for '${schematicId}': schematic has ${schematic.numNodes} nodes while layout has ${layout.numNodes} nodes.`,
      },
    ];
  }
  const iso = vf2SubgraphIsomorphism(schematic, layout, true);
  if (!iso) {
    return [
      {
        code: "M5104",
        rule: "lvs-netlist-mismatch",
        severity: "error",
        entity: schematicId,
        message: `LVS mismatch for '${schematicId}': no topological graph isomorphism exists between schematic and layout netlists.`,
      },
    ];
  }
  return [];
}
