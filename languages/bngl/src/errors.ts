// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bngl — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9051 - M9060).
 */

import type { BnglRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: BnglRange | undefined;
}

export const BnglErrorCode = {
  UNDECLARED_MOLECULE_TYPE: {
    code: 9051,
    rule: "molecule-type-undeclared",
    severity: "error" as DiagnosticSeverity,
    message: (moleculeName: string, context?: string) =>
      context
        ? `Molecule type '${moleculeName}' referenced in '${context}' is not declared in 'molecule types'.`
        : `Molecule type '${moleculeName}' is not declared in 'molecule types'.`,
  },
  UNDECLARED_COMPONENT_SITE: {
    code: 9052,
    rule: "component-site-undeclared",
    severity: "error" as DiagnosticSeverity,
    message: (siteName: string, moleculeName: string) =>
      `Component site '${siteName}' is not declared on molecule type '${moleculeName}'.`,
  },
  INVALID_INTERNAL_STATE: {
    code: 9053,
    rule: "invalid-internal-state",
    severity: "error" as DiagnosticSeverity,
    message: (stateName: string, siteName: string, moleculeName: string) =>
      `Internal state '~${stateName}' is not allowed for component '${siteName}' of molecule type '${moleculeName}'.`,
  },
  DANGLING_BOND_LABEL: {
    code: 9054,
    rule: "dangling-bond-label",
    severity: "error" as DiagnosticSeverity,
    message: (bondLabel: string, patternText: string, count?: number) =>
      count !== undefined
        ? `Bond label '!${bondLabel}' in complex pattern '${patternText}' appears '${count}' times; each bond must connect exactly 2 sites.`
        : `Bond label '!${bondLabel}' in complex pattern '${patternText}' is dangling; each bond must connect exactly 2 sites.`,
  },
  UNDEFINED_RATE_PARAMETER: {
    code: 9055,
    rule: "undefined-rate-parameter",
    severity: "warning" as DiagnosticSeverity,
    message: (ruleId: string, parameterName: string) =>
      `Reaction rule '${ruleId}' references undeclared rate parameter '${parameterName}'.`,
  },
  REVERSIBLE_RULE_MISSING_REVERSE_RATE: {
    code: 9056,
    rule: "reversible-rule-missing-reverse-rate",
    severity: "error" as DiagnosticSeverity,
    message: (ruleId: string) => `Reversible reaction rule '${ruleId}' ('<->') is missing a reverse rate constant.`,
  },
  NEGATIVE_SEED_CONCENTRATION: {
    code: 9057,
    rule: "negative-seed-concentration",
    severity: "error" as DiagnosticSeverity,
    message: (speciesPattern: string, concentration?: number) =>
      concentration !== undefined
        ? `Seed species '${speciesPattern}' has negative initial concentration '${concentration}'.`
        : `Seed species '${speciesPattern}' has negative initial concentration.`,
  },
  EMPTY_BIONETGEN_MODEL: {
    code: 9058,
    rule: "empty-bionetgen-model",
    severity: "error" as DiagnosticSeverity,
    message: (modelName: string) =>
      `BioNetGen model '${modelName}' contains no molecule types, seed species, or reaction rules.`,
  },
  DUPLICATE_OBSERVABLE_NAME: {
    code: 9059,
    rule: "duplicate-observable-name",
    severity: "error" as DiagnosticSeverity,
    message: (observableName: string) => `Observable '${observableName}' is defined multiple times in 'observables'.`,
  },
  UNBOUNDED_POLYMERIZATION_RULE: {
    code: 9060,
    rule: "unbounded-polymerization-rule",
    severity: "warning" as DiagnosticSeverity,
    message: (ruleId: string, moleculeName: string) =>
      `Reaction rule '${ruleId}' forms intermolecular bonds on multi-site molecule '${moleculeName}' that can cause unbounded polymerization.`,
  },
} as const;
