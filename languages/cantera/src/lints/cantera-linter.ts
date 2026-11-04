// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Pre-flight Thermochemical & Stoichiometric Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9201 - M9210) for Cantera mechanisms.
 */

import { CanteraErrorCode, type DiagnosticItem } from "../errors.js";
import { evaluateNasa7Coeffs } from "../solvers/kinetics-solver.js";
import type { CanteraDocument, CanteraReaction, CanteraSpecies } from "../types.js";

function inferSpeciesCharge(sp: CanteraSpecies): number {
  if (sp.charge !== undefined) return sp.charge;
  if (sp.composition["E"] !== undefined) return -sp.composition["E"];

  // Check trailing '+' or '-' in species name (e.g. "H3O+", "OH-", "e-")
  const name = sp.name;
  if (name === "E" || name === "e-" || name === "e") return -1;
  let plusCount = 0;
  let minusCount = 0;
  for (let i = name.length - 1; i >= 0; i--) {
    const ch = name[i];
    if (ch === "+") plusCount++;
    else if (ch === "-") minusCount++;
    else break;
  }
  if (plusCount > 0 && minusCount === 0) return plusCount;
  if (minusCount > 0 && plusCount === 0) return -minusCount;
  return 0;
}

function canonicalReactionKey(rxn: CanteraReaction): string {
  const lhs = [...rxn.reactants]
    .sort((a, b) => a.species.localeCompare(b.species))
    .map((s) => `${s.stoichiometry}:${s.species}`)
    .join("+");
  const rhs = [...rxn.products]
    .sort((a, b) => a.species.localeCompare(b.species))
    .map((s) => `${s.stoichiometry}:${s.species}`)
    .join("+");
  const arrow = rxn.reversible ? "<=>" : "=>";
  return `${rxn.type}|${lhs}${arrow}${rhs}`;
}

export function lintCantera(doc: CanteraDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const mech = doc.mechanism;

  // 1. Validate phase species references (M9203)
  for (const phase of mech.phases.values()) {
    for (const spName of phase.species) {
      if (!mech.species.has(spName)) {
        diagnostics.push({
          code: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.code,
          rule: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.rule,
          severity: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.severity,
          message: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.message(phase.name, spName),
          range: phase.range,
        });
      }
    }
  }

  // 2. Validate species thermo definitions (M9210, M9205, M9204)
  for (const sp of mech.species.values()) {
    if (!sp.thermo || sp.thermo.lowCoeffs.length < 7 || sp.thermo.highCoeffs.length < 7) {
      diagnostics.push({
        code: CanteraErrorCode.MISSING_SPECIES_THERMO.code,
        rule: CanteraErrorCode.MISSING_SPECIES_THERMO.rule,
        severity: CanteraErrorCode.MISSING_SPECIES_THERMO.severity,
        message: CanteraErrorCode.MISSING_SPECIES_THERMO.message(sp.name),
        range: sp.range,
      });
      continue;
    }

    const { Tmin, Tmid, Tmax, lowCoeffs, highCoeffs } = sp.thermo;
    const thermoRange = sp.thermo.range ?? sp.range;

    // M9205: Invalid NASA-7 temperature bounds
    if (Tmin <= 0 || Tmin >= Tmid || Tmid >= Tmax) {
      diagnostics.push({
        code: CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.code,
        rule: CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.rule,
        severity: CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.severity,
        message: CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.message(sp.name, Tmin, Tmid, Tmax),
        range: thermoRange,
      });
      continue;
    }

    // M9204: NASA-7 midpoint continuity check at Tmid
    const lowEval = evaluateNasa7Coeffs(lowCoeffs, Tmid);
    const highEval = evaluateNasa7Coeffs(highCoeffs, Tmid);

    const diffCp = Math.abs(lowEval.cpOverR - highEval.cpOverR);
    const diffH = Math.abs(lowEval.hOverRT - highEval.hOverRT);
    const diffS = Math.abs(lowEval.sOverR - highEval.sOverR);
    const tol = 0.05;

    if (diffCp > tol) {
      diagnostics.push({
        code: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.code,
        rule: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.rule,
        severity: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.severity,
        message: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.message(sp.name, Tmid, "Cp/R", diffCp),
        range: thermoRange,
      });
    } else if (diffH > tol) {
      diagnostics.push({
        code: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.code,
        rule: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.rule,
        severity: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.severity,
        message: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.message(sp.name, Tmid, "H/RT", diffH),
        range: thermoRange,
      });
    } else if (diffS > tol) {
      diagnostics.push({
        code: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.code,
        rule: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.rule,
        severity: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.severity,
        message: CanteraErrorCode.NASA7_TEMPERATURE_DISCONTINUITY.message(sp.name, Tmid, "S/R", diffS),
        range: thermoRange,
      });
    }
  }

  // 3. Validate reactions (M9201, M9202, M9203, M9206, M9207, M9208, M9209)
  const seenSignatures = new Map<string, CanteraReaction>();

  for (const rxn of mech.reactions) {
    // M9208: Duplicate reaction declaration without duplicate: true
    const sig = canonicalReactionKey(rxn);
    const prevRxn = seenSignatures.get(sig);
    if (prevRxn) {
      if (!rxn.duplicate || !prevRxn.duplicate) {
        diagnostics.push({
          code: CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.code,
          rule: CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.rule,
          severity: CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.severity,
          message: CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.message(rxn.equation),
          range: rxn.range,
        });
      }
    } else {
      seenSignatures.set(sig, rxn);
    }

    // M9206: Non-positive pre-exponential factor A <= 0
    if (rxn.rateConstant.A <= 0) {
      diagnostics.push({
        code: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.code,
        rule: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.rule,
        severity: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.severity,
        message: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.message(rxn.equation, rxn.rateConstant.A),
        range: rxn.rateConstant.range ?? rxn.range,
      });
    }
    if (rxn.lowRateConstant && rxn.lowRateConstant.A <= 0) {
      diagnostics.push({
        code: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.code,
        rule: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.rule,
        severity: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.severity,
        message: CanteraErrorCode.NEGATIVE_PRE_EXPONENTIAL_FACTOR.message(rxn.equation, rxn.lowRateConstant.A),
        range: rxn.lowRateConstant.range ?? rxn.range,
      });
    }

    // M9207: Missing falloff low-pressure limit
    if (rxn.type === "falloff" && !rxn.lowRateConstant) {
      diagnostics.push({
        code: CanteraErrorCode.MISSING_FALLOFF_LOW_PRESSURE_LIMIT.code,
        rule: CanteraErrorCode.MISSING_FALLOFF_LOW_PRESSURE_LIMIT.rule,
        severity: CanteraErrorCode.MISSING_FALLOFF_LOW_PRESSURE_LIMIT.severity,
        message: CanteraErrorCode.MISSING_FALLOFF_LOW_PRESSURE_LIMIT.message(rxn.equation),
        range: rxn.range,
      });
    }

    // M9209: Negative third-body efficiency
    if (rxn.efficiencies) {
      for (const [spName, eff] of Object.entries(rxn.efficiencies)) {
        if (eff < 0) {
          diagnostics.push({
            code: CanteraErrorCode.NEGATIVE_THIRD_BODY_EFFICIENCY.code,
            rule: CanteraErrorCode.NEGATIVE_THIRD_BODY_EFFICIENCY.rule,
            severity: CanteraErrorCode.NEGATIVE_THIRD_BODY_EFFICIENCY.severity,
            message: CanteraErrorCode.NEGATIVE_THIRD_BODY_EFFICIENCY.message(rxn.equation, spName, eff),
            range: rxn.range,
          });
        }
      }
    }

    // M9203: Undeclared species in reaction reactants/products
    let allSpeciesDeclared = true;
    for (const ref of rxn.reactants) {
      if (!mech.species.has(ref.species)) {
        allSpeciesDeclared = false;
        diagnostics.push({
          code: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.code,
          rule: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.rule,
          severity: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.severity,
          message: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.message(rxn.equation, ref.species),
          range: rxn.range,
        });
      }
    }
    for (const ref of rxn.products) {
      if (!mech.species.has(ref.species)) {
        allSpeciesDeclared = false;
        diagnostics.push({
          code: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.code,
          rule: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.rule,
          severity: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.severity,
          message: CanteraErrorCode.UNDECLARED_PHASE_SPECIES.message(rxn.equation, ref.species),
          range: rxn.range,
        });
      }
    }

    // M9201 & M9202: Element balance and electrical charge balance
    if (allSpeciesDeclared && (rxn.reactants.length > 0 || rxn.products.length > 0)) {
      const reactantElements: Record<string, number> = {};
      const productElements: Record<string, number> = {};
      const allElements = new Set<string>();
      let reactantCharge = 0;
      let productCharge = 0;

      for (const ref of rxn.reactants) {
        const sp = mech.species.get(ref.species)!;
        reactantCharge += ref.stoichiometry * inferSpeciesCharge(sp);
        for (const [el, count] of Object.entries(sp.composition)) {
          if (el === "E") continue;
          allElements.add(el);
          reactantElements[el] = (reactantElements[el] ?? 0) + ref.stoichiometry * count;
        }
      }

      for (const ref of rxn.products) {
        const sp = mech.species.get(ref.species)!;
        productCharge += ref.stoichiometry * inferSpeciesCharge(sp);
        for (const [el, count] of Object.entries(sp.composition)) {
          if (el === "E") continue;
          allElements.add(el);
          productElements[el] = (productElements[el] ?? 0) + ref.stoichiometry * count;
        }
      }

      for (const el of allElements) {
        const rCount = reactantElements[el] ?? 0;
        const pCount = productElements[el] ?? 0;
        if (Math.abs(rCount - pCount) > 1e-6) {
          diagnostics.push({
            code: CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.code,
            rule: CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.rule,
            severity: CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.severity,
            message: CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.message(rxn.equation, el, rCount, pCount),
            range: rxn.range,
          });
        }
      }

      if (Math.abs(reactantCharge - productCharge) > 1e-6) {
        diagnostics.push({
          code: CanteraErrorCode.CHARGE_BALANCE_VIOLATION.code,
          rule: CanteraErrorCode.CHARGE_BALANCE_VIOLATION.rule,
          severity: CanteraErrorCode.CHARGE_BALANCE_VIOLATION.severity,
          message: CanteraErrorCode.CHARGE_BALANCE_VIOLATION.message(rxn.equation, reactantCharge, productCharge),
          range: rxn.range,
        });
      }
    }
  }

  return diagnostics;
}
