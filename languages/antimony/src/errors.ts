// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/antimony — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9001 - M9010).
 */

import type { AntimonyRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: AntimonyRange | undefined;
}

export const AntimonyErrorCode = {
  EMPTY_ANTIMONY_MODULE: {
    code: 9001,
    rule: "empty-antimony-module",
    severity: "error" as DiagnosticSeverity,
    message: (moduleName: string) => `Antimony module '${moduleName}' contains no species, reactions, or rules.`,
  },
  UNDEFINED_COMPARTMENT_IN_SPECIES: {
    code: 9002,
    rule: "undefined-compartment-in-species",
    severity: "error" as DiagnosticSeverity,
    message: (speciesId: string, compartmentId: string) =>
      `Species '${speciesId}' is placed in undeclared compartment '${compartmentId}'.`,
  },
  MISSING_REACTION_RATE_LAW: {
    code: 9003,
    rule: "missing-reaction-rate-law",
    severity: "warning" as DiagnosticSeverity,
    message: (reactionId: string) => `Reaction '${reactionId}' has no kinetic rate expression.`,
  },
  NEGATIVE_STOICHIOMETRIC_COEFFICIENT: {
    code: 9004,
    rule: "negative-stoichiometric-coefficient",
    severity: "error" as DiagnosticSeverity,
    message: (speciesId: string, reactionId: string, stoichiometry?: number) =>
      stoichiometry !== undefined
        ? `Species '${speciesId}' in reaction '${reactionId}' has non-positive stoichiometry '${stoichiometry}'.`
        : `Species '${speciesId}' in reaction '${reactionId}' has non-positive stoichiometry.`,
  },
  UNDEFINED_RATE_LAW_SYMBOL: {
    code: 9005,
    rule: "undefined-rate-law-symbol",
    severity: "warning" as DiagnosticSeverity,
    message: (reactionId: string, symbol: string) =>
      `Rate expression in '${reactionId}' references undeclared identifier '${symbol}'.`,
  },
  DUPLICATE_REACTION_ID: {
    code: 9006,
    rule: "duplicate-reaction-id",
    severity: "error" as DiagnosticSeverity,
    message: (reactionId: string, moduleName: string) =>
      `Reaction identifier '${reactionId}' is defined multiple times in module '${moduleName}'.`,
  },
  CIRCULAR_SUBMODEL_INSTANTIATION: {
    code: 9007,
    rule: "circular-submodel-instantiation",
    severity: "error" as DiagnosticSeverity,
    message: (moduleName: string) => `Submodel hierarchy contains a cycle involving '${moduleName}'.`,
  },
  CONFLICTING_SPECIES_VARIABILITY: {
    code: 9008,
    rule: "conflicting-species-variability",
    severity: "error" as DiagnosticSeverity,
    message: (speciesId: string) =>
      `Species '${speciesId}' is declared both 'const' and modified by a rate rule or non-boundary reaction.`,
  },
  NEGATIVE_COMPARTMENT_VOLUME: {
    code: 9009,
    rule: "negative-compartment-volume",
    severity: "error" as DiagnosticSeverity,
    message: (compartmentId: string, volume?: number) =>
      volume !== undefined
        ? `Compartment '${compartmentId}' initialized with non-positive volume '${volume}'.`
        : `Compartment '${compartmentId}' initialized with non-positive volume.`,
  },
  INVALID_EVENT_TRIGGER: {
    code: 9010,
    rule: "invalid-event-trigger",
    severity: "error" as DiagnosticSeverity,
    message: (eventId: string) => `Event '${eventId}' trigger condition is not a relational/boolean expression.`,
  },
} as const;
