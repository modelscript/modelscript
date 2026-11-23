// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for USAF Stability and Control Digital DATCOM (`DAT1001`–`DAT5006`).
 */

export type DatcomSeverity = "error" | "warning" | "info";

export interface DatcomDiagnostic {
  id: string;
  code: number;
  rule: string;
  severity: DatcomSeverity;
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  group?: string | undefined;
}

export const DatcomErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "DAT1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in DATCOM input deck: ${detail}.`,
  },
  UNTERMINATED_NAMELIST: {
    code: 1002,
    id: "DAT1002",
    rule: "unterminated-namelist",
    severity: "error" as const,
    message: (group: string) => `NAMELIST group '$${group}' is missing a closing '$' or '$END' terminator.`,
  },
  UNKNOWN_NAMELIST_GROUP: {
    code: 2001,
    id: "DAT2001",
    rule: "unknown-namelist-group",
    severity: "error" as const,
    message: (group: string) => `Unknown DATCOM NAMELIST group '$${group}'.`,
  },
  INVALID_NACA_DESIGNATION: {
    code: 2002,
    id: "DAT2002",
    rule: "invalid-naca-designation",
    severity: "error" as const,
    message: (designation: string) =>
      `Invalid NACA airfoil designation '${designation}'. Expected NACA-{W|H|V|F}-{4|5|6}-<digits>.`,
  },
  MISSING_FLTCON: {
    code: 3001,
    id: "DAT3001",
    rule: "missing-fltcon",
    severity: "error" as const,
    message: (caseId: string) => `Case '${caseId}' is missing required '$FLTCON' flight-conditions NAMELIST.`,
  },
  MISSING_WGPLNF: {
    code: 3002,
    id: "DAT3002",
    rule: "missing-wgplnf",
    severity: "error" as const,
    message: (caseId: string) => `Case '${caseId}' is missing required '$WGPLNF' wing-planform NAMELIST.`,
  },
  MISMATCHED_ARRAY_LENGTH: {
    code: 3003,
    id: "DAT3003",
    rule: "mismatched-array-length",
    severity: "error" as const,
    message: (countName: string, expected: number, arrayName: string, actual: number) =>
      `Declared '${countName}=${expected}' does not match '${arrayName}' array length (${actual}).`,
  },
  NON_POSITIVE_SREF: {
    code: 4001,
    id: "DAT4001",
    rule: "non-positive-sref",
    severity: "error" as const,
    message: (val: number) => `Reference wing area 'SREF' must be positive, got '${val}'.`,
  },
  NON_POSITIVE_CBARR: {
    code: 4002,
    id: "DAT4002",
    rule: "non-positive-cbarr",
    severity: "error" as const,
    message: (val: number) => `Reference mean aerodynamic chord 'CBARR' must be positive, got '${val}'.`,
  },
  NON_POSITIVE_BLREF: {
    code: 4003,
    id: "DAT4003",
    rule: "non-positive-blref",
    severity: "error" as const,
    message: (val: number) => `Reference wing span 'BLREF' must be positive, got '${val}'.`,
  },
  INVALID_TAPER_RATIO: {
    code: 4004,
    id: "DAT4004",
    rule: "invalid-taper-ratio",
    severity: "error" as const,
    message: (group: string, taper: number) =>
      `Invalid taper ratio '${taper.toFixed(3)}' in '$${group}'. Taper ratio (CHRDTP/CHRDR) must lie in [0, 1.5].`,
  },
  INVALID_SWEEP_ANGLE: {
    code: 4005,
    id: "DAT4005",
    rule: "invalid-sweep-angle",
    severity: "error" as const,
    message: (group: string, sweep: number) =>
      `Invalid sweep angle 'SAVSI=${sweep}' deg in '$${group}'. Sweep angle must lie in (-60, 80) deg.`,
  },
  STATIC_INSTABILITY_CG_AFT: {
    code: 5001,
    id: "DAT5001",
    rule: "static-instability-cg-aft",
    severity: "warning" as const,
    message: (xcg: number, xnp: number, smPct: number) =>
      `CG ('XCG=${xcg.toFixed(3)}') is aft of aerodynamic neutral point ('XNP=${xnp.toFixed(3)}'); static margin is ${smPct.toFixed(1)}% (longitudinally unstable).`,
  },
  EXCESSIVE_STATIC_MARGIN: {
    code: 5002,
    id: "DAT5002",
    rule: "excessive-static-margin",
    severity: "warning" as const,
    message: (smPct: number) =>
      `Static margin (${smPct.toFixed(1)}%) exceeds 45% MAC; aircraft may be overly stiff in pitch.`,
  },
  TRANSONIC_REGIME_INFO: {
    code: 5003,
    id: "DAT5003",
    rule: "transonic-regime-info",
    severity: "info" as const,
    message: (mach: number) =>
      `Mach '${mach.toFixed(2)}' is in the transonic regime (0.80 <= M <= 1.20); semi-empirical DATCOM accuracy is reduced.`,
  },
  MISSING_AIRCRAFT_WEIGHT: {
    code: 5004,
    id: "DAT5004",
    rule: "missing-aircraft-weight",
    severity: "warning" as const,
    message: (caseId: string) =>
      `Case '${caseId}' omits positive 'WT' in '$FLTCON'; dynamic flight-mode estimates will use default mass.`,
  },
  INVALID_SPAN_GEOMETRY: {
    code: 5005,
    id: "DAT5005",
    rule: "invalid-span-geometry",
    severity: "error" as const,
    message: (group: string) => `Planform '$${group}' must specify positive semispan 'SSPN' and root chord 'CHRDR'.`,
  },
  FLAP_CHORD_EXCEEDS_WING: {
    code: 5006,
    id: "DAT5006",
    rule: "flap-chord-exceeds-wing",
    severity: "warning" as const,
    message: (flapChord: number, wingChord: number) =>
      `Flap chord ('${flapChord}') exceeds local wing chord ('${wingChord}').`,
  },
} as const;
