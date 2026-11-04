// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/phreeqc — Static Pre-Flight Geochemical & Thermodynamic Linter (M9551 - M9560).
 */

import { PhreeqcErrorCode, type DiagnosticItem } from "../errors.js";
import {
  KNOWN_EQUILIBRIUM_PHASE_NAMES,
  KNOWN_MASTER_SPECIES,
  convertToMolality,
} from "../solvers/speciation-solver.js";
import type { PhreeqcDocument } from "../types.js";

export function lintPhreeqc(doc: PhreeqcDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  // M9560: Empty PHREEQC deck
  const hasMasterSpecies = doc.masterSpecies !== undefined && doc.masterSpecies.size > 0;
  const hasPhases = doc.phases !== undefined && doc.phases.size > 0;
  if (
    doc.solutions.size === 0 &&
    doc.equilibriumPhases.length === 0 &&
    doc.reactions.size === 0 &&
    doc.kinetics.length === 0 &&
    doc.mixes.size === 0 &&
    !hasMasterSpecies &&
    !hasPhases
  ) {
    diagnostics.push({
      code: PhreeqcErrorCode.EMPTY_PHREEQC_DECK.code,
      rule: PhreeqcErrorCode.EMPTY_PHREEQC_DECK.rule,
      severity: PhreeqcErrorCode.EMPTY_PHREEQC_DECK.severity,
      message: PhreeqcErrorCode.EMPTY_PHREEQC_DECK.message(),
      range: doc.range,
    });
    return diagnostics;
  }

  // Validate SOLUTION blocks (M9551 - M9556)
  for (const [, sol] of doc.solutions) {
    // M9551: pH out of physical bounds [0, 14]
    if (sol.pH < 0 || sol.pH > 14) {
      diagnostics.push({
        code: PhreeqcErrorCode.PH_OUT_OF_PHYSICAL_BOUNDS.code,
        rule: PhreeqcErrorCode.PH_OUT_OF_PHYSICAL_BOUNDS.rule,
        severity: PhreeqcErrorCode.PH_OUT_OF_PHYSICAL_BOUNDS.severity,
        message: PhreeqcErrorCode.PH_OUT_OF_PHYSICAL_BOUNDS.message(sol.number, sol.pH),
        range: sol.range,
      });
    }

    // M9552: pe out of redox stability bounds [-15, 25]
    if (sol.pe < -15 || sol.pe > 25) {
      diagnostics.push({
        code: PhreeqcErrorCode.PE_OUT_OF_REDOX_STABILITY_BOUNDS.code,
        rule: PhreeqcErrorCode.PE_OUT_OF_REDOX_STABILITY_BOUNDS.rule,
        severity: PhreeqcErrorCode.PE_OUT_OF_REDOX_STABILITY_BOUNDS.severity,
        message: PhreeqcErrorCode.PE_OUT_OF_REDOX_STABILITY_BOUNDS.message(sol.number, sol.pe),
        range: sol.range,
      });
    }

    // M9553: Non-physical temperature (< 0 or > 350 °C)
    if (sol.temp < 0 || sol.temp > 350) {
      diagnostics.push({
        code: PhreeqcErrorCode.NON_PHYSICAL_TEMPERATURE.code,
        rule: PhreeqcErrorCode.NON_PHYSICAL_TEMPERATURE.rule,
        severity: PhreeqcErrorCode.NON_PHYSICAL_TEMPERATURE.severity,
        message: PhreeqcErrorCode.NON_PHYSICAL_TEMPERATURE.message(sol.number, sol.temp),
        range: sol.range,
      });
    }

    let netCharge = 0.0;
    let totalAbsCharge = 0.0;

    for (const [elem, conc] of sol.solutes) {
      const spec = sol.soluteSpecs?.get(elem);
      const itemRange = spec?.range ?? sol.range;

      // M9554: Negative solute concentration
      if (conc < 0) {
        diagnostics.push({
          code: PhreeqcErrorCode.NEGATIVE_SOLUTE_CONCENTRATION.code,
          rule: PhreeqcErrorCode.NEGATIVE_SOLUTE_CONCENTRATION.rule,
          severity: PhreeqcErrorCode.NEGATIVE_SOLUTE_CONCENTRATION.severity,
          message: PhreeqcErrorCode.NEGATIVE_SOLUTE_CONCENTRATION.message(sol.number, elem, conc),
          range: itemRange,
        });
      }

      // M9556: Unknown aqueous master species
      const knownMeta = KNOWN_MASTER_SPECIES.get(elem);
      const customMeta = doc.masterSpecies?.get(elem);
      if (!knownMeta && !customMeta) {
        diagnostics.push({
          code: PhreeqcErrorCode.UNKNOWN_AQUEOUS_MASTER_SPECIES.code,
          rule: PhreeqcErrorCode.UNKNOWN_AQUEOUS_MASTER_SPECIES.rule,
          severity: PhreeqcErrorCode.UNKNOWN_AQUEOUS_MASTER_SPECIES.severity,
          message: PhreeqcErrorCode.UNKNOWN_AQUEOUS_MASTER_SPECIES.message(sol.number, elem),
          range: itemRange,
        });
      } else if (knownMeta && conc > 0) {
        const molality = convertToMolality(conc, sol.units, knownMeta, spec?.units, spec?.gfw);
        netCharge += molality * knownMeta.charge;
        totalAbsCharge += molality * Math.abs(knownMeta.charge);
      }
    }

    // M9555: Charge imbalance exceeded (|sum(z_i * m_i)| / sum(|z_i| * m_i) > 0.05) without charge balance element
    const hasChargeBalance = sol.pHChargeBalance === true || sol.chargeBalanceElement !== undefined;
    if (!hasChargeBalance && totalAbsCharge > 0) {
      const imbalanceFraction = Math.abs(netCharge) / totalAbsCharge;
      if (imbalanceFraction > 0.05) {
        diagnostics.push({
          code: PhreeqcErrorCode.CHARGE_IMBALANCE_EXCEEDED.code,
          rule: PhreeqcErrorCode.CHARGE_IMBALANCE_EXCEEDED.rule,
          severity: PhreeqcErrorCode.CHARGE_IMBALANCE_EXCEEDED.severity,
          message: PhreeqcErrorCode.CHARGE_IMBALANCE_EXCEEDED.message(sol.number, imbalanceFraction),
          range: sol.range,
        });
      }
    }
  }

  // Validate EQUILIBRIUM_PHASES blocks (M9557, M9558)
  for (const ep of doc.equilibriumPhases) {
    const isKnownPhase = KNOWN_EQUILIBRIUM_PHASE_NAMES.has(ep.name) || (doc.phases?.has(ep.name) ?? false);
    if (!isKnownPhase) {
      diagnostics.push({
        code: PhreeqcErrorCode.UNKNOWN_EQUILIBRIUM_MINERAL_PHASE.code,
        rule: PhreeqcErrorCode.UNKNOWN_EQUILIBRIUM_MINERAL_PHASE.rule,
        severity: PhreeqcErrorCode.UNKNOWN_EQUILIBRIUM_MINERAL_PHASE.severity,
        message: PhreeqcErrorCode.UNKNOWN_EQUILIBRIUM_MINERAL_PHASE.message(ep.name, ep.blockNumber),
        range: ep.range,
      });
    }

    if (ep.initialMoles < 0) {
      diagnostics.push({
        code: PhreeqcErrorCode.NEGATIVE_MINERAL_MOLES.code,
        rule: PhreeqcErrorCode.NEGATIVE_MINERAL_MOLES.rule,
        severity: PhreeqcErrorCode.NEGATIVE_MINERAL_MOLES.severity,
        message: PhreeqcErrorCode.NEGATIVE_MINERAL_MOLES.message(ep.name, ep.initialMoles),
        range: ep.range,
      });
    }
  }

  // Validate MIX blocks (M9559)
  for (const [, mix] of doc.mixes) {
    for (const solNum of mix.fractions.keys()) {
      if (!doc.solutions.has(solNum)) {
        diagnostics.push({
          code: PhreeqcErrorCode.UNRESOLVED_MIX_SOLUTION.code,
          rule: PhreeqcErrorCode.UNRESOLVED_MIX_SOLUTION.rule,
          severity: PhreeqcErrorCode.UNRESOLVED_MIX_SOLUTION.severity,
          message: PhreeqcErrorCode.UNRESOLVED_MIX_SOLUTION.message(mix.number, solNum),
          range: mix.range,
        });
      }
    }
  }

  return diagnostics;
}
