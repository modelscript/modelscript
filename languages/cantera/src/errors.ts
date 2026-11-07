// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9201 - M9210).
 */

import type { CanteraRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: CanteraRange | undefined;
}

export const CanteraErrorCode = {
  ELEMENT_BALANCE_VIOLATION: {
    code: 9201,
    rule: "element-balance-violation",
    severity: "error" as DiagnosticSeverity,
    message: (equation: string, element: string, reactantCount: number, productCount: number) =>
      `Reaction '${equation}' is not elementally balanced for element '${element}' (reactants: ${reactantCount}, products: ${productCount}).`,
  },
  CHARGE_BALANCE_VIOLATION: {
    code: 9202,
    rule: "charge-balance-violation",
    severity: "error" as DiagnosticSeverity,
    message: (equation: string, reactantCharge: number, productCharge: number) =>
      `Reaction '${equation}' violates net electrical charge conservation (reactants: ${reactantCharge}, products: ${productCharge}).`,
  },
  UNDECLARED_PHASE_SPECIES: {
    code: 9203,
    rule: "undeclared-phase-species",
    severity: "error" as DiagnosticSeverity,
    message: (equationOrPhase: string, speciesName: string) =>
      `Reaction or phase '${equationOrPhase}' references species '${speciesName}' not declared in the mechanism species list.`,
  },
  NASA7_TEMPERATURE_DISCONTINUITY: {
    code: 9204,
    rule: "nasa7-temperature-discontinuity",
    severity: "warning" as DiagnosticSeverity,
    message: (speciesName: string, Tmid: number, propName: string, delta: number) =>
      `Species '${speciesName}' NASA-7 polynomial has a '${propName}' discontinuity (${delta.toExponential(3)}) at midpoint temperature '${Tmid}' K.`,
  },
  INVALID_NASA7_TEMPERATURE_BOUNDS: {
    code: 9205,
    rule: "invalid-nasa7-temperature-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (speciesName: string, Tmin: number, Tmid: number, Tmax: number) =>
      `Species '${speciesName}' specifies invalid NASA-7 temperature bounds [${Tmin}, ${Tmid}, ${Tmax}] K.`,
  },
  NEGATIVE_PRE_EXPONENTIAL_FACTOR: {
    code: 9206,
    rule: "negative-pre-exponential-factor",
    severity: "error" as DiagnosticSeverity,
    message: (equation: string, A: number) =>
      `Reaction '${equation}' specifies a non-positive pre-exponential factor '${A}'.`,
  },
  MISSING_FALLOFF_LOW_PRESSURE_LIMIT: {
    code: 9207,
    rule: "missing-falloff-low-pressure-limit",
    severity: "error" as DiagnosticSeverity,
    message: (equation: string) =>
      `Falloff reaction '${equation}' is missing required 'low-P-rate-constant' definition.`,
  },
  DUPLICATE_REACTION_DECLARATION: {
    code: 9208,
    rule: "duplicate-reaction-declaration",
    severity: "warning" as DiagnosticSeverity,
    message: (equation: string) =>
      `Identical non-duplicate reaction '${equation}' is declared multiple times without 'duplicate: true'.`,
  },
  NEGATIVE_THIRD_BODY_EFFICIENCY: {
    code: 9209,
    rule: "negative-third-body-efficiency",
    severity: "error" as DiagnosticSeverity,
    message: (equation: string, speciesName: string, efficiency: number) =>
      `Third-body efficiency for '${speciesName}' in reaction '${equation}' is negative (${efficiency}).`,
  },
  MISSING_SPECIES_THERMO: {
    code: 9210,
    rule: "missing-species-thermo",
    severity: "warning" as DiagnosticSeverity,
    message: (speciesName: string) => `Species '${speciesName}' is missing a 'thermo' polynomial definition.`,
  },
  ACTIVATION_ENERGY_OUT_OF_BOUNDS: {
    code: 9211,
    rule: "activation-energy-out-of-bounds",
    severity: "warning" as DiagnosticSeverity,
    message: (eq: string, ea: number) =>
      `Reaction '${eq}' specifies an unusually large negative activation energy (${ea} J/mol).`,
  },
  TRANSPORT_COLLISION_DIAMETER_NEGATIVE: {
    code: 9212,
    rule: "transport-collision-diameter-negative",
    severity: "error" as DiagnosticSeverity,
    message: (species: string, d: number) =>
      `Transport collision diameter for species '${species}' must be positive (found ${d} Å).`,
  },
  UNREFERENCED_ELEMENT_DECLARATION: {
    code: 9213,
    rule: "unreferenced-element-declaration",
    severity: "info" as DiagnosticSeverity,
    message: (elem: string) =>
      `Element '${elem}' declared in mechanism but not present in any species composition.`,
  },
} as const;
