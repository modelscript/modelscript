// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/phreeqc — Pre-flight Geochemical & Speciation Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9551 - M9560).
 */

import type { PhreeqcRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: PhreeqcRange | undefined;
}

export const PhreeqcErrorCode = {
  PH_OUT_OF_PHYSICAL_BOUNDS: {
    code: 9551,
    rule: "ph-out-of-physical-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (solutionNumber: number, pH: number) =>
      `SOLUTION '${solutionNumber}' specifies pH '${pH}' outside standard aqueous bounds [0, 14].`,
  },
  PE_OUT_OF_REDOX_STABILITY_BOUNDS: {
    code: 9552,
    rule: "pe-out-of-redox-stability-bounds",
    severity: "warning" as DiagnosticSeverity,
    message: (solutionNumber: number, pe: number) =>
      `SOLUTION '${solutionNumber}' specifies redox potential pe '${pe}' outside water stability bounds [-15, 25].`,
  },
  NON_PHYSICAL_TEMPERATURE: {
    code: 9553,
    rule: "non-physical-temperature",
    severity: "error" as DiagnosticSeverity,
    message: (solutionNumber: number, tempC: number) =>
      `SOLUTION '${solutionNumber}' specifies non-physical aqueous temperature '${tempC}' °C (valid range: [0, 350] °C).`,
  },
  NEGATIVE_SOLUTE_CONCENTRATION: {
    code: 9554,
    rule: "negative-solute-concentration",
    severity: "error" as DiagnosticSeverity,
    message: (solutionNumber: number, element: string, concentration: number) =>
      `Solute '${element}' in SOLUTION '${solutionNumber}' specifies negative concentration '${concentration}'.`,
  },
  CHARGE_IMBALANCE_EXCEEDED: {
    code: 9555,
    rule: "charge-imbalance-exceeded",
    severity: "warning" as DiagnosticSeverity,
    message: (solutionNumber: number, imbalanceFraction: number) =>
      `SOLUTION '${solutionNumber}' exhibits relative electrical charge imbalance '${(imbalanceFraction * 100).toFixed(2)}%' (> 5%) without a 'charge' balance element.`,
  },
  UNKNOWN_AQUEOUS_MASTER_SPECIES: {
    code: 9556,
    rule: "unknown-aqueous-master-species",
    severity: "error" as DiagnosticSeverity,
    message: (solutionNumber: number, element: string) =>
      `SOLUTION '${solutionNumber}' references unrecognized aqueous master species '${element}'.`,
  },
  UNKNOWN_EQUILIBRIUM_MINERAL_PHASE: {
    code: 9557,
    rule: "unknown-equilibrium-mineral-phase",
    severity: "error" as DiagnosticSeverity,
    message: (mineralName: string, blockNumber: number) =>
      `EQUILIBRIUM_PHASES '${blockNumber}' references unrecognized mineral phase '${mineralName}'.`,
  },
  NEGATIVE_MINERAL_MOLES: {
    code: 9558,
    rule: "negative-mineral-moles",
    severity: "error" as DiagnosticSeverity,
    message: (mineralName: string, initialMoles: number) =>
      `Equilibrium mineral phase '${mineralName}' specifies negative initial moles '${initialMoles}'.`,
  },
  UNRESOLVED_MIX_SOLUTION: {
    code: 9559,
    rule: "unresolved-mix-solution",
    severity: "error" as DiagnosticSeverity,
    message: (mixNumber: number, solutionNumber: number) =>
      `MIX '${mixNumber}' references undefined SOLUTION '${solutionNumber}'.`,
  },
  EMPTY_PHREEQC_DECK: {
    code: 9560,
    rule: "empty-phreeqc-deck",
    severity: "error" as DiagnosticSeverity,
    message: () =>
      `PHREEQC deck contains no SOLUTION, EQUILIBRIUM_PHASES, REACTION, KINETICS, MIX, or database definitions.`,
  },
} as const;
