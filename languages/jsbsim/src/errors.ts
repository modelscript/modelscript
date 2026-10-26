// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — Pre-flight Flight Dynamics Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M8901 - M8910).
 */

import type { JsbsimRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: JsbsimRange | undefined;
}

export const JsbsimErrorCode = {
  MISSING_AIRCRAFT_NAME: {
    code: 8901,
    rule: "missing-aircraft-name",
    severity: "error" as DiagnosticSeverity,
    message: () => `JSBSim <fdm_config> element is missing required 'name' attribute.`,
  },
  NON_POSITIVE_REFERENCE_AREA: {
    code: 8902,
    rule: "non-positive-reference-area",
    severity: "error" as DiagnosticSeverity,
    message: (val: number) => `Wing reference area (${val}) must be strictly positive.`,
  },
  NON_POSITIVE_WINGSPAN_CHORD: {
    code: 8903,
    rule: "non-positive-wingspan-chord",
    severity: "error" as DiagnosticSeverity,
    message: (param: string, val: number) => `Wing metric '${param}' (${val}) must be strictly positive.`,
  },
  NON_POSITIVE_EMPTY_WEIGHT: {
    code: 8904,
    rule: "non-positive-empty-weight",
    severity: "error" as DiagnosticSeverity,
    message: (val: number) => `Aircraft empty weight (${val}) must be strictly positive.`,
  },
  INVALID_INERTIA_TENSOR: {
    code: 8905,
    rule: "invalid-inertia-tensor",
    severity: "error" as DiagnosticSeverity,
    message: (reason: string) => `Moments of inertia tensor is invalid: ${reason}.`,
  },
  MISSING_AERODYNAMICS_SECTION: {
    code: 8906,
    rule: "missing-aerodynamics-section",
    severity: "error" as DiagnosticSeverity,
    message: () => `Aircraft model does not define any aerodynamic force/moment coefficients in <aerodynamics>.`,
  },
  MISSING_LANDING_GEAR: {
    code: 8907,
    rule: "missing-landing-gear",
    severity: "warning" as DiagnosticSeverity,
    message: () =>
      `Aircraft model defines no landing gear bogies in <ground_reactions>; ground interaction is disabled.`,
  },
  NEGATIVE_ENGINE_THRUST: {
    code: 8908,
    rule: "negative-engine-thrust",
    severity: "error" as DiagnosticSeverity,
    message: (engineName: string, val: number) => `Engine '${engineName}' specifies negative maximum thrust (${val}).`,
  },
  UNDEFINED_FCS_INPUT: {
    code: 8909,
    rule: "undefined-fcs-input",
    severity: "warning" as DiagnosticSeverity,
    message: (channelName: string, inputProperty: string) =>
      `FCS channel '${channelName}' references input property '${inputProperty}' not bound in flight control.`,
  },
  UNREALISTIC_CG_LOCATION: {
    code: 8910,
    rule: "unrealistic-cg-location",
    severity: "warning" as DiagnosticSeverity,
    message: (cgX: number, aeroX: number) =>
      `Center of gravity (${cgX}) is significantly far from aerodynamic center (${aeroX}); aircraft may have extreme pitch instability.`,
  },
} as const;
