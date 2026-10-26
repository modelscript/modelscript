// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M8601 - M8610).
 */

import type { Relap5Range } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: Relap5Range | undefined;
}

export const Relap5ErrorCode = {
  DANGLING_VOLUME_CONNECTION: {
    code: 8601,
    rule: "dangling-volume-connection",
    severity: "error" as DiagnosticSeverity,
    message: (junctionId: number, volId: number, end: "from" | "to") =>
      `Junction '${junctionId}' specifies undefined ${end}-volume '${volId}'.`,
  },
  UNCLOSED_TRIP_LOGIC_CUTSET: {
    code: 8602,
    rule: "unclosed-trip-logic-cutset",
    severity: "error" as DiagnosticSeverity,
    message: (parentTripId: number, childTripId: number) =>
      `Trip logic '${parentTripId}' references undefined child trip ID '${childTripId}'.`,
  },
  NEGATIVE_HEAT_CAPACITY: {
    code: 8603,
    rule: "negative-heat-capacity",
    severity: "error" as DiagnosticSeverity,
    message: (hsId: number, k: number, cp: number) =>
      `Heat structure '${hsId}' specifies non-positive conductivity (${k} W/m-K) or capacity (${cp} J/m³-K).`,
  },
  SONIC_CHOKED_FLOW_SINGULARITY: {
    code: 8604,
    rule: "sonic-choked-flow-singularity",
    severity: "warning" as DiagnosticSeverity,
    message: (junctionId: number) => `Junction '${junctionId}' flagged for critical sonic choked flow transition.`,
  },
  MISSING_KINETICS_DELAYED_GROUPS: {
    code: 8605,
    rule: "missing-kinetics-delayed-groups",
    severity: "error" as DiagnosticSeverity,
    message: (count: number) =>
      `Point kinetics model specifies ${count} delayed groups; standard reactor kinetics requires 6 precursor groups.`,
  },
  NEGATIVE_PROMPT_NEUTRON_LIFETIME: {
    code: 8606,
    rule: "negative-prompt-neutron-lifetime",
    severity: "error" as DiagnosticSeverity,
    message: (lambda: number) => `Prompt neutron generation time '${lambda}' s must be strictly positive.`,
  },
  ADVERSE_VOLUME_ELEVATION: {
    code: 8607,
    rule: "adverse-volume-elevation",
    severity: "warning" as DiagnosticSeverity,
    message: (volId: number, dz: number, length: number) =>
      `Volume '${volId}' elevation change dz (${dz} m) exceeds physical volume length (${length} m).`,
  },
  NEGATIVE_JUNCTION_LOSS_COEFFICIENT: {
    code: 8608,
    rule: "negative-junction-loss-coefficient",
    severity: "error" as DiagnosticSeverity,
    message: (junctionId: number, kForw: number, kRev: number) =>
      `Junction '${junctionId}' specifies negative form loss coefficient (K_forw=${kForw}, K_rev=${kRev}).`,
  },
  INVALID_TIME_STEP_BOUNDS: {
    code: 8609,
    rule: "invalid-time-step-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (minDt: number, maxDt: number) => `Minimum time step (${minDt} s) exceeds maximum time step (${maxDt} s).`,
  },
  NEGATIVE_PRESSURE_STATE: {
    code: 8610,
    rule: "negative-pressure-state",
    severity: "error" as DiagnosticSeverity,
    message: (volId: number, p: number) => `Volume '${volId}' specifies non-positive thermodynamic pressure (${p} Pa).`,
  },
} as const;
