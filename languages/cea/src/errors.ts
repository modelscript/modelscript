// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Pre-flight Diagnostic Error Definitions (CEA1001–CEA5006).
 */

export type CeaDiagnosticSeverity = "error" | "warning" | "info";

export interface CeaDiagnostic {
  code: string;
  rule: string;
  severity: CeaDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
}

export const CeaErrorCode = {
  SYNTAX_ERROR: {
    code: "CEA1001",
    rule: "syntax-error",
    severity: "error" as CeaDiagnosticSeverity,
    message: (detail: string) => `Syntax error in NASA CEA deck: ${detail}.`,
  },
  MISSING_PROBLEM: {
    code: "CEA1002",
    rule: "missing-problem",
    severity: "error" as CeaDiagnosticSeverity,
    message: () => "Missing required 'problem' dataset in NASA CEA input deck.",
  },
  MISSING_REACTANTS: {
    code: "CEA1003",
    rule: "missing-reactants",
    severity: "error" as CeaDiagnosticSeverity,
    message: () => "Missing required 'reactants' dataset in NASA CEA input deck.",
  },
  MISSING_END: {
    code: "CEA1004",
    rule: "missing-end",
    severity: "warning" as CeaDiagnosticSeverity,
    message: () => "Missing 'end' terminator at the conclusion of the NASA CEA problem deck.",
  },
  UNKNOWN_PROBLEM_TYPE: {
    code: "CEA2001",
    rule: "unknown-problem-type",
    severity: "error" as CeaDiagnosticSeverity,
    message: (token: string) =>
      `Unknown NASA CEA problem type '${token}'. Expected one of: hp, tp, uv, tv, sp, sv, rocket, deton, shock.`,
  },
  UNKNOWN_REACTANT_SPECIES: {
    code: "CEA2002",
    rule: "unknown-reactant-species",
    severity: "error" as CeaDiagnosticSeverity,
    message: (species: string) =>
      `Unknown reactant species '${species}' not found in the NASA CEA thermodynamic library.`,
  },
  UNKNOWN_FILTER_SPECIES: {
    code: "CEA2003",
    rule: "unknown-filter-species",
    severity: "warning" as CeaDiagnosticSeverity,
    message: (section: string, species: string) =>
      `Species '${species}' in '${section}' dataset is not recognized in the thermodynamic library.`,
  },
  NON_POSITIVE_PRESSURE: {
    code: "CEA3001",
    rule: "non-positive-pressure",
    severity: "error" as CeaDiagnosticSeverity,
    message: (value: number) => `Pressure must be strictly positive (found '${value}').`,
  },
  NON_POSITIVE_TEMPERATURE: {
    code: "CEA3002",
    rule: "non-positive-temperature",
    severity: "error" as CeaDiagnosticSeverity,
    message: (value: number) => `Temperature must be strictly positive in Kelvin (found '${value}' K).`,
  },
  NON_POSITIVE_EXPANSION_RATIO: {
    code: "CEA3003",
    rule: "non-positive-expansion-ratio",
    severity: "error" as CeaDiagnosticSeverity,
    message: (kind: string, value: number) =>
      `Nozzle expansion or pressure ratio '${kind}' must be strictly positive (found '${value}').`,
  },
  NEGATIVE_MIXTURE_RATIO: {
    code: "CEA3004",
    rule: "negative-mixture-ratio",
    severity: "error" as CeaDiagnosticSeverity,
    message: (kind: string, value: number) => `Mixture ratio '${kind}' cannot be negative (found '${value}').`,
  },
  FUEL_WEIGHT_PERCENT_SUM: {
    code: "CEA4001",
    rule: "fuel-weight-percent-sum",
    severity: "error" as CeaDiagnosticSeverity,
    message: (sum: number) => `Fuel 'wt%' values must sum to 100% (found ${sum.toFixed(2)}%).`,
  },
  OXID_WEIGHT_PERCENT_SUM: {
    code: "CEA4002",
    rule: "oxid-weight-percent-sum",
    severity: "error" as CeaDiagnosticSeverity,
    message: (sum: number) => `Oxidizer 'wt%' values must sum to 100% (found ${sum.toFixed(2)}%).`,
  },
  CONFLICTING_ONLY_OMIT: {
    code: "CEA4003",
    rule: "conflicting-only-omit",
    severity: "error" as CeaDiagnosticSeverity,
    message: (species: string) =>
      `Species '${species}' appears in both 'only' and 'omit' datasets, creating a contradictory filter.`,
  },
  MISSING_PRESSURE: {
    code: "CEA5001",
    rule: "missing-pressure",
    severity: "error" as CeaDiagnosticSeverity,
    message: (problemType: string) => `Problem type '${problemType}' requires at least one pressure specification.`,
  },
  MISSING_TEMPERATURE: {
    code: "CEA5002",
    rule: "missing-temperature",
    severity: "error" as CeaDiagnosticSeverity,
    message: (problemType: string) => `Problem type '${problemType}' requires at least one temperature specification.`,
  },
  MISSING_FUEL_OR_OXID: {
    code: "CEA5003",
    rule: "missing-fuel-or-oxid",
    severity: "warning" as CeaDiagnosticSeverity,
    message: (ratioKind: string) =>
      `Mixture ratio '${ratioKind}' is specified, but reactants do not include both 'fuel' and 'oxid' entries.`,
  },
  DUPLICATE_REACTANT: {
    code: "CEA5004",
    rule: "duplicate-reactant",
    severity: "warning" as CeaDiagnosticSeverity,
    message: (species: string) => `Duplicate reactant entry for species '${species}'.`,
  },
  NON_POSITIVE_REACTANT_AMOUNT: {
    code: "CEA5005",
    rule: "non-positive-reactant-amount",
    severity: "error" as CeaDiagnosticSeverity,
    message: (species: string, value: number) => `Reactant '${species}' specifies a non-positive amount ('${value}').`,
  },
  INVALID_TRACE_THRESHOLD: {
    code: "CEA5006",
    rule: "invalid-trace-threshold",
    severity: "error" as CeaDiagnosticSeverity,
    message: (value: number) => `Output 'trace' threshold must be in (0, 1] (found '${value}').`,
  },
} as const;
