// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChemkinRange } from "./types.js";

/**
 * Diagnostic error codes for `@modelscript/chemkin` (CK1001–CK5006).
 */
export const ChemkinErrorCode = {
  SYNTAX_ERROR: {
    code: "CK1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `CHEMKIN syntax error: ${detail}.`,
  },
  DUPLICATE_ELEMENT: {
    code: "CK2001",
    rule: "duplicate-element",
    severity: "warning" as const,
    message: (elementName: string) => `Duplicate element '${elementName}' declared in ELEMENTS section.`,
  },
  DUPLICATE_SPECIES: {
    code: "CK2002",
    rule: "duplicate-species",
    severity: "warning" as const,
    message: (speciesName: string) => `Duplicate species '${speciesName}' declared in SPECIES section.`,
  },
  UNDECLARED_SPECIES: {
    code: "CK2003",
    rule: "undeclared-species",
    severity: "error" as const,
    message: (speciesName: string, reactionId: string) =>
      `Undeclared species '${speciesName}' referenced in reaction '${reactionId}'.`,
  },
  UNDECLARED_ELEMENT: {
    code: "CK2004",
    rule: "undeclared-element",
    severity: "error" as const,
    message: (elementName: string, speciesName: string) =>
      `Undeclared element '${elementName}' in THERMO composition for species '${speciesName}'.`,
  },
  STOICHIOMETRIC_IMBALANCE: {
    code: "CK3001",
    rule: "stoichiometric-imbalance",
    severity: "error" as const,
    message: (reactionId: string, elementName: string, lhsCount: number, rhsCount: number) =>
      `Stoichiometric imbalance in reaction '${reactionId}' for element '${elementName}': reactants have ${lhsCount}, products have ${rhsCount}.`,
  },
  DUPLICATE_REACTION: {
    code: "CK3002",
    rule: "duplicate-reaction",
    severity: "error" as const,
    message: (equation: string, reactionId: string) =>
      `Duplicate reaction '${equation}' (${reactionId}) requires the DUPLICATE/DUP auxiliary keyword.`,
  },
  MISSING_THERMO: {
    code: "CK4001",
    rule: "missing-thermo",
    severity: "warning" as const,
    message: (speciesName: string) => `Missing THERMO NASA-7 thermodynamic data for species '${speciesName}'.`,
  },
  INVALID_THERMO_RANGE: {
    code: "CK4002",
    rule: "invalid-thermo-range",
    severity: "error" as const,
    message: (speciesName: string, tLow: number, tMid: number, tHigh: number) =>
      `Invalid NASA-7 temperature range for species '${speciesName}': expected T_low (${tLow}) < T_mid (${tMid}) < T_high (${tHigh}).`,
  },
  NEGATIVE_PREEXPONENTIAL: {
    code: "CK5001",
    rule: "negative-preexponential",
    severity: "error" as const,
    message: (reactionId: string, aVal: number) =>
      `Negative pre-exponential factor A = ${aVal} in reaction '${reactionId}'.`,
  },
  INVALID_FALLOFF_PARAMS: {
    code: "CK5002",
    rule: "invalid-falloff-params",
    severity: "error" as const,
    message: (reactionId: string, detail: string) =>
      `Invalid falloff parameters in reaction '${reactionId}': ${detail}.`,
  },
  EMPTY_MECHANISM: {
    code: "CK5006",
    rule: "empty-mechanism",
    severity: "warning" as const,
    message: (detail: string) => `Incomplete CHEMKIN mechanism: ${detail}.`,
  },
} as const;

export type ChemkinErrorCodeKey = keyof typeof ChemkinErrorCode;

export interface ChemkinDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range?: ChemkinRange | undefined;
}
