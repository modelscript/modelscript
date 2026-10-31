// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Pre-flight Biochemical Network Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M8801 - M8810) for SBML models.
 */

import { type DiagnosticItem, SbmlErrorCode } from "../errors.js";
import type { SbmlDocument } from "../types.js";

export function lintSbml(doc: SbmlDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const model = doc.model;

  // M8801: Missing model ID
  if (!model.id || model.id.trim() === "") {
    diagnostics.push({
      code: SbmlErrorCode.MISSING_MODEL_ID.code,
      rule: SbmlErrorCode.MISSING_MODEL_ID.rule,
      severity: SbmlErrorCode.MISSING_MODEL_ID.severity,
      message: SbmlErrorCode.MISSING_MODEL_ID.message(),
      range: model.range,
    });
  }

  // M8804: Compartment size validation
  for (const c of model.compartments.values()) {
    if (c.size <= 0) {
      diagnostics.push({
        code: SbmlErrorCode.NEGATIVE_COMPARTMENT_SIZE.code,
        rule: SbmlErrorCode.NEGATIVE_COMPARTMENT_SIZE.rule,
        severity: SbmlErrorCode.NEGATIVE_COMPARTMENT_SIZE.severity,
        message: SbmlErrorCode.NEGATIVE_COMPARTMENT_SIZE.message(c.id, c.size),
        range: c.range,
      });
    }
  }

  // M8802: Undefined compartment reference & M8805: Negative initial amount/concentration
  for (const s of model.species.values()) {
    if (!model.compartments.has(s.compartment)) {
      diagnostics.push({
        code: SbmlErrorCode.UNDEFINED_COMPARTMENT_REFERENCE.code,
        rule: SbmlErrorCode.UNDEFINED_COMPARTMENT_REFERENCE.rule,
        severity: SbmlErrorCode.UNDEFINED_COMPARTMENT_REFERENCE.severity,
        message: SbmlErrorCode.UNDEFINED_COMPARTMENT_REFERENCE.message(s.id, s.compartment),
        range: s.range,
      });
    }

    if (s.initialAmount !== undefined && s.initialAmount < 0) {
      diagnostics.push({
        code: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.code,
        rule: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.rule,
        severity: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.severity,
        message: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.message(s.id, s.initialAmount),
        range: s.range,
      });
    }

    if (s.initialConcentration !== undefined && s.initialConcentration < 0) {
      diagnostics.push({
        code: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.code,
        rule: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.rule,
        severity: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.severity,
        message: SbmlErrorCode.NEGATIVE_INITIAL_AMOUNT_CONCENTRATION.message(s.id, s.initialConcentration),
        range: s.range,
      });
    }
  }

  // Reaction validation
  for (const r of model.reactions.values()) {
    // M8806: Empty reaction
    if (r.reactants.length === 0 && r.products.length === 0) {
      diagnostics.push({
        code: SbmlErrorCode.EMPTY_REACTION.code,
        rule: SbmlErrorCode.EMPTY_REACTION.rule,
        severity: SbmlErrorCode.EMPTY_REACTION.severity,
        message: SbmlErrorCode.EMPTY_REACTION.message(r.id),
        range: r.range,
      });
    }

    // M8807: Missing kinetic law
    if (r.reactants.length > 0 || r.products.length > 0) {
      if (!r.kineticLaw || !r.kineticLaw.formula.trim()) {
        diagnostics.push({
          code: SbmlErrorCode.MISSING_KINETIC_LAW.code,
          rule: SbmlErrorCode.MISSING_KINETIC_LAW.rule,
          severity: SbmlErrorCode.MISSING_KINETIC_LAW.severity,
          message: SbmlErrorCode.MISSING_KINETIC_LAW.message(r.id),
          range: r.range,
        });
      }
    }

    // M8803: Undefined species reference & M8808: Negative stoichiometry
    for (const ref of r.reactants) {
      if (!model.species.has(ref.species)) {
        diagnostics.push({
          code: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.code,
          rule: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.rule,
          severity: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.severity,
          message: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.message(r.id, ref.species, "reactant"),
          range: ref.range,
        });
      }
      if (ref.stoichiometry <= 0) {
        diagnostics.push({
          code: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.code,
          rule: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.rule,
          severity: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.severity,
          message: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.message(r.id, ref.species, ref.stoichiometry),
          range: ref.range,
        });
      }
    }

    for (const ref of r.products) {
      if (!model.species.has(ref.species)) {
        diagnostics.push({
          code: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.code,
          rule: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.rule,
          severity: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.severity,
          message: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.message(r.id, ref.species, "product"),
          range: ref.range,
        });
      }
      if (ref.stoichiometry <= 0) {
        diagnostics.push({
          code: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.code,
          rule: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.rule,
          severity: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.severity,
          message: SbmlErrorCode.NEGATIVE_STOICHIOMETRY.message(r.id, ref.species, ref.stoichiometry),
          range: ref.range,
        });
      }
    }

    for (const ref of r.modifiers) {
      if (!model.species.has(ref.species)) {
        diagnostics.push({
          code: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.code,
          rule: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.rule,
          severity: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.severity,
          message: SbmlErrorCode.UNDEFINED_SPECIES_REFERENCE.message(r.id, ref.species, "modifier"),
          range: ref.range,
        });
      }
    }

    // M8809: Undefined kinetic parameter/symbol in kinetic law formula
    if (r.kineticLaw && r.kineticLaw.formula.trim()) {
      const BUILTIN_MATH_SYMBOLS = new Set([
        "time",
        "exp",
        "log",
        "ln",
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "sinh",
        "cosh",
        "tanh",
        "sqrt",
        "pow",
        "abs",
        "min",
        "max",
        "floor",
        "ceil",
        "pi",
        "e",
        "true",
        "false",
      ]);
      const seenUndefined = new Set<string>();
      const identRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
      let match: RegExpExecArray | null;
      while ((match = identRegex.exec(r.kineticLaw.formula)) !== null) {
        const sym = match[0];
        if (!sym || seenUndefined.has(sym) || BUILTIN_MATH_SYMBOLS.has(sym)) continue;
        // Skip scientific notation exponent markers like 1e-3 (already avoided since identRegex requires leading alpha/underscore, unless preceded by digit)
        const prevIdx = match.index - 1;
        const prevChar = prevIdx >= 0 ? r.kineticLaw.formula[prevIdx] : undefined;
        if (prevChar && /[0-9.]/.test(prevChar)) continue;

        const isDefined =
          model.species.has(sym) ||
          model.compartments.has(sym) ||
          model.parameters.has(sym) ||
          r.kineticLaw.parameters.has(sym);

        if (!isDefined) {
          seenUndefined.add(sym);
          diagnostics.push({
            code: SbmlErrorCode.UNDEFINED_KINETIC_PARAMETER.code,
            rule: SbmlErrorCode.UNDEFINED_KINETIC_PARAMETER.rule,
            severity: SbmlErrorCode.UNDEFINED_KINETIC_PARAMETER.severity,
            message: SbmlErrorCode.UNDEFINED_KINETIC_PARAMETER.message(r.id, sym),
            range: r.kineticLaw.range ?? r.range,
          });
        }
      }
    }

    // M8810: Circular species assignment (species as both reactant and product with same stoichiometry)
    for (const reactRef of r.reactants) {
      const prodRef = r.products.find((p) => p.species === reactRef.species);
      if (prodRef && prodRef.stoichiometry === reactRef.stoichiometry) {
        diagnostics.push({
          code: SbmlErrorCode.CIRCULAR_SPECIES_ASSIGNMENT.code,
          rule: SbmlErrorCode.CIRCULAR_SPECIES_ASSIGNMENT.rule,
          severity: SbmlErrorCode.CIRCULAR_SPECIES_ASSIGNMENT.severity,
          message: SbmlErrorCode.CIRCULAR_SPECIES_ASSIGNMENT.message(r.id, reactRef.species),
          range: r.range,
        });
      }
    }
  }

  return diagnostics;
}
