// SPDX-License-Identifier: AGPL-3.0-or-later

import { getStdThermoRecord } from "../catalog/chemkin-std-schemas.js";
import { ChemkinErrorCode, type ChemkinDiagnostic } from "../errors.js";
import type { ChemkinDocument, ChemkinReaction, ChemkinSpeciesStoich } from "../types.js";

export { ChemkinErrorCode, type ChemkinDiagnostic, type ChemkinErrorCodeKey } from "../errors.js";

function canonicalizeSide(side: ChemkinSpeciesStoich[]): string {
  const counts = new Map<string, number>();
  for (const item of side) {
    const key = item.species.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + item.stoichiometry);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sp, c]) => `${c}:${sp}`)
    .join("+");
}

function reactionSignature(rxn: ChemkinReaction): string {
  const lhs = canonicalizeSide(rxn.reactants);
  const rhs = canonicalizeSide(rxn.products);
  const bodyTag = rxn.falloff ? `(+${(rxn.thirdBodySpecies ?? "M").toUpperCase()})` : rxn.thirdBody ? "+M" : "";
  if (rxn.reversible) {
    const [a, b] = lhs <= rhs ? [lhs, rhs] : [rhs, lhs];
    return `${a}<=>${b}${bodyTag}`;
  }
  return `${lhs}=>${rhs}${bodyTag}`;
}

/**
 * Runs all static semantic and physical validation checks (CK1001–CK5006) on a parsed CHEMKIN document.
 */
export function lintChemkin(doc: ChemkinDocument): ChemkinDiagnostic[] {
  const diags: ChemkinDiagnostic[] = [];
  const mech = doc.mechanism;

  // CK1001: Parse / syntax errors recorded by parser
  for (const err of mech.parseErrors) {
    diags.push({
      code: ChemkinErrorCode.SYNTAX_ERROR.code,
      rule: ChemkinErrorCode.SYNTAX_ERROR.rule,
      severity: ChemkinErrorCode.SYNTAX_ERROR.severity,
      message: ChemkinErrorCode.SYNTAX_ERROR.message(err.message),
      range: err.range,
    });
  }

  // CK2001: Duplicate element declarations
  for (const dup of mech.duplicateElements) {
    diags.push({
      code: ChemkinErrorCode.DUPLICATE_ELEMENT.code,
      rule: ChemkinErrorCode.DUPLICATE_ELEMENT.rule,
      severity: ChemkinErrorCode.DUPLICATE_ELEMENT.severity,
      message: ChemkinErrorCode.DUPLICATE_ELEMENT.message(dup.name),
      range: dup.range,
    });
  }

  // CK2002: Duplicate species declarations
  for (const dup of mech.duplicateSpecies) {
    diags.push({
      code: ChemkinErrorCode.DUPLICATE_SPECIES.code,
      rule: ChemkinErrorCode.DUPLICATE_SPECIES.rule,
      severity: ChemkinErrorCode.DUPLICATE_SPECIES.severity,
      message: ChemkinErrorCode.DUPLICATE_SPECIES.message(dup.name),
      range: dup.range,
    });
  }

  // Build case-insensitive lookup sets for declared elements and species
  const declaredElements = new Set<string>();
  for (const el of mech.elements.keys()) {
    declaredElements.add(el.toUpperCase());
  }

  const declaredSpecies = new Set<string>();
  for (const sp of mech.species.keys()) {
    declaredSpecies.add(sp.toUpperCase());
  }

  const thermoByUpper = new Map<string, ReturnType<typeof mech.thermo.get>>();
  for (const [sp, rec] of mech.thermo) {
    thermoByUpper.set(sp.toUpperCase(), rec);
  }

  // CK4001: Missing THERMO data for declared species
  for (const [spName, spEntry] of mech.species) {
    if (!thermoByUpper.has(spName.toUpperCase())) {
      diags.push({
        code: ChemkinErrorCode.MISSING_THERMO.code,
        rule: ChemkinErrorCode.MISSING_THERMO.rule,
        severity: ChemkinErrorCode.MISSING_THERMO.severity,
        message: ChemkinErrorCode.MISSING_THERMO.message(spName),
        range: spEntry.range,
      });
    }
  }

  // CK2004 & CK4002: Validate THERMO records (undeclared elements + T_low < T_mid < T_high)
  for (const [spName, rec] of mech.thermo) {
    if (declaredElements.size > 0) {
      for (const el of Object.keys(rec.composition)) {
        if (!declaredElements.has(el.toUpperCase())) {
          diags.push({
            code: ChemkinErrorCode.UNDECLARED_ELEMENT.code,
            rule: ChemkinErrorCode.UNDECLARED_ELEMENT.rule,
            severity: ChemkinErrorCode.UNDECLARED_ELEMENT.severity,
            message: ChemkinErrorCode.UNDECLARED_ELEMENT.message(el, spName),
            range: rec.range,
          });
        }
      }
    }

    if (!(rec.tLow < rec.tMid && rec.tMid < rec.tHigh) || rec.tLow <= 0) {
      diags.push({
        code: ChemkinErrorCode.INVALID_THERMO_RANGE.code,
        rule: ChemkinErrorCode.INVALID_THERMO_RANGE.rule,
        severity: ChemkinErrorCode.INVALID_THERMO_RANGE.severity,
        message: ChemkinErrorCode.INVALID_THERMO_RANGE.message(spName, rec.tLow, rec.tMid, rec.tHigh),
        range: rec.range,
      });
    }
  }

  // Validate REACTIONS
  const seenSignatures = new Map<string, ChemkinReaction[]>();
  for (const rxn of mech.reactions) {
    const sig = reactionSignature(rxn);
    const list = seenSignatures.get(sig) ?? [];
    list.push(rxn);
    seenSignatures.set(sig, list);

    // CK2003: Undeclared species in REACTIONS
    if (declaredSpecies.size > 0) {
      const referenced = new Set<string>();
      for (const r of rxn.reactants) referenced.add(r.species);
      for (const p of rxn.products) referenced.add(p.species);
      if (rxn.thirdBodySpecies) referenced.add(rxn.thirdBodySpecies);
      for (const effSp of Object.keys(rxn.efficiencies)) referenced.add(effSp);

      for (const sp of referenced) {
        if (!declaredSpecies.has(sp.toUpperCase())) {
          diags.push({
            code: ChemkinErrorCode.UNDECLARED_SPECIES.code,
            rule: ChemkinErrorCode.UNDECLARED_SPECIES.rule,
            severity: ChemkinErrorCode.UNDECLARED_SPECIES.severity,
            message: ChemkinErrorCode.UNDECLARED_SPECIES.message(sp, rxn.id),
            range: rxn.range,
          });
        }
      }
    }

    // CK3001: Stoichiometric element balance check
    const lhsAtoms = new Map<string, number>();
    const rhsAtoms = new Map<string, number>();
    let allKnown = true;

    for (const r of rxn.reactants) {
      const rec = thermoByUpper.get(r.species.toUpperCase()) ?? getStdThermoRecord(r.species);
      if (!rec || Object.keys(rec.composition).length === 0) {
        allKnown = false;
        break;
      }
      for (const [el, cnt] of Object.entries(rec.composition)) {
        const up = el.toUpperCase();
        lhsAtoms.set(up, (lhsAtoms.get(up) ?? 0) + cnt * r.stoichiometry);
      }
    }

    if (allKnown) {
      for (const p of rxn.products) {
        const rec = thermoByUpper.get(p.species.toUpperCase()) ?? getStdThermoRecord(p.species);
        if (!rec || Object.keys(rec.composition).length === 0) {
          allKnown = false;
          break;
        }
        for (const [el, cnt] of Object.entries(rec.composition)) {
          const up = el.toUpperCase();
          rhsAtoms.set(up, (rhsAtoms.get(up) ?? 0) + cnt * p.stoichiometry);
        }
      }
    }

    if (allKnown) {
      const allElements = new Set<string>([...lhsAtoms.keys(), ...rhsAtoms.keys()]);
      for (const el of allElements) {
        const l = lhsAtoms.get(el) ?? 0;
        const r = rhsAtoms.get(el) ?? 0;
        if (Math.abs(l - r) > 1e-6) {
          diags.push({
            code: ChemkinErrorCode.STOICHIOMETRIC_IMBALANCE.code,
            rule: ChemkinErrorCode.STOICHIOMETRIC_IMBALANCE.rule,
            severity: ChemkinErrorCode.STOICHIOMETRIC_IMBALANCE.severity,
            message: ChemkinErrorCode.STOICHIOMETRIC_IMBALANCE.message(rxn.id, el, l, r),
            range: rxn.range,
          });
        }
      }
    }

    // CK5001: Negative pre-exponential factor A
    if (rxn.rate.A < 0) {
      diags.push({
        code: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.code,
        rule: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.rule,
        severity: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.severity,
        message: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.message(rxn.id, rxn.rate.A),
        range: rxn.range,
      });
    }
    if (rxn.low && rxn.low.A < 0) {
      diags.push({
        code: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.code,
        rule: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.rule,
        severity: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.severity,
        message: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.message(`${rxn.id} (LOW)`, rxn.low.A),
        range: rxn.range,
      });
    }
    if (rxn.rev && rxn.rev.A < 0) {
      diags.push({
        code: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.code,
        rule: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.rule,
        severity: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.severity,
        message: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.message(`${rxn.id} (REV)`, rxn.rev.A),
        range: rxn.range,
      });
    }
    if (rxn.plog) {
      for (const entry of rxn.plog) {
        if (entry.A < 0) {
          diags.push({
            code: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.code,
            rule: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.rule,
            severity: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.severity,
            message: ChemkinErrorCode.NEGATIVE_PREEXPONENTIAL.message(`${rxn.id} (PLOG)`, entry.A),
            range: rxn.range,
          });
        }
      }
    }

    // CK5002: Falloff reaction missing LOW parameters
    if (rxn.falloff && !rxn.low) {
      diags.push({
        code: ChemkinErrorCode.INVALID_FALLOFF_PARAMS.code,
        rule: ChemkinErrorCode.INVALID_FALLOFF_PARAMS.rule,
        severity: ChemkinErrorCode.INVALID_FALLOFF_PARAMS.severity,
        message: ChemkinErrorCode.INVALID_FALLOFF_PARAMS.message(
          rxn.id,
          "falloff reaction '(+M)' requires a LOW /A b Ea/ auxiliary clause",
        ),
        range: rxn.range,
      });
    }
  }

  // CK3002: Duplicate reactions without DUPLICATE / DUP
  for (const [, group] of seenSignatures) {
    if (group.length > 1) {
      for (const rxn of group) {
        if (!rxn.duplicate) {
          diags.push({
            code: ChemkinErrorCode.DUPLICATE_REACTION.code,
            rule: ChemkinErrorCode.DUPLICATE_REACTION.rule,
            severity: ChemkinErrorCode.DUPLICATE_REACTION.severity,
            message: ChemkinErrorCode.DUPLICATE_REACTION.message(rxn.equation, rxn.id),
            range: rxn.range,
          });
        }
      }
    }
  }

  // CK5006: Empty mechanism check
  if (mech.species.size === 0 && mech.reactions.length === 0) {
    diags.push({
      code: ChemkinErrorCode.EMPTY_MECHANISM.code,
      rule: ChemkinErrorCode.EMPTY_MECHANISM.rule,
      severity: ChemkinErrorCode.EMPTY_MECHANISM.severity,
      message: ChemkinErrorCode.EMPTY_MECHANISM.message("no species or reactions declared"),
    });
  }

  return diags;
}
