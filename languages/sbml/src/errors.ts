// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M8801 - M8810).
 */

import type { SbmlRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: SbmlRange | undefined;
}

export const SbmlErrorCode = {
  MISSING_MODEL_ID: {
    code: 8801,
    rule: "missing-model-id",
    severity: "error" as DiagnosticSeverity,
    message: () => `SBML <model> element is missing required 'id' attribute.`,
  },
  UNDEFINED_COMPARTMENT_REFERENCE: {
    code: 8802,
    rule: "undefined-compartment-reference",
    severity: "error" as DiagnosticSeverity,
    message: (speciesId: string, compartmentId: string) =>
      `Species '${speciesId}' references undefined compartment '${compartmentId}'.`,
  },
  UNDEFINED_SPECIES_REFERENCE: {
    code: 8803,
    rule: "undefined-species-reference",
    severity: "error" as DiagnosticSeverity,
    message: (reactionId: string, speciesId: string, role: string) =>
      `Reaction '${reactionId}' references undefined ${role} species '${speciesId}'.`,
  },
  NEGATIVE_COMPARTMENT_SIZE: {
    code: 8804,
    rule: "negative-compartment-size",
    severity: "error" as DiagnosticSeverity,
    message: (compartmentId: string, size: number) =>
      `Compartment '${compartmentId}' defines non-positive size (${size}).`,
  },
  NEGATIVE_INITIAL_AMOUNT_CONCENTRATION: {
    code: 8805,
    rule: "negative-initial-amount-concentration",
    severity: "error" as DiagnosticSeverity,
    message: (speciesId: string, val: number) =>
      `Species '${speciesId}' specifies negative initial amount/concentration (${val}).`,
  },
  EMPTY_REACTION: {
    code: 8806,
    rule: "empty-reaction",
    severity: "error" as DiagnosticSeverity,
    message: (reactionId: string) => `Reaction '${reactionId}' must define at least one reactant or product.`,
  },
  MISSING_KINETIC_LAW: {
    code: 8807,
    rule: "missing-kinetic-law",
    severity: "warning" as DiagnosticSeverity,
    message: (reactionId: string) => `Reaction '${reactionId}' does not define a kineticLaw rate law equation.`,
  },
  NEGATIVE_STOICHIOMETRY: {
    code: 8808,
    rule: "negative-stoichiometry",
    severity: "error" as DiagnosticSeverity,
    message: (reactionId: string, speciesId: string, stoich: number) =>
      `Species reference for '${speciesId}' in reaction '${reactionId}' specifies non-positive stoichiometry (${stoich}).`,
  },
  UNDEFINED_KINETIC_PARAMETER: {
    code: 8809,
    rule: "undefined-kinetic-parameter",
    severity: "warning" as DiagnosticSeverity,
    message: (reactionId: string, id: string) =>
      `Kinetic law formula in reaction '${reactionId}' references identifier '${id}' not found in parameters or species.`,
  },
  CIRCULAR_SPECIES_ASSIGNMENT: {
    code: 8810,
    rule: "circular-species-assignment",
    severity: "info" as DiagnosticSeverity,
    message: (reactionId: string, speciesId: string) =>
      `Reaction '${reactionId}' lists '${speciesId}' as both reactant and product with identical stoichiometry; consider defining as modifier.`,
  },
} as const;
