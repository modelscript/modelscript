// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Diagnostic & Error Code Catalog (`ENDF1001`–`ENDF5006`).
 */

export interface Endf6ErrorSpec {
  readonly id: string;
  readonly code: number;
  readonly rule: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: (...args: string[]) => string;
}

export const Endf6ErrorCode = {
  // 1xxx — Syntax, card format, and tape/material/file/section terminators
  CARD_FORMAT_ERROR: {
    id: "ENDF1001",
    code: 1001,
    rule: "card-format-error",
    severity: "error",
    message: (detail: string) => `ENDF-6 card syntax/length error: ${detail}.`,
  },
  MISSING_SEND: {
    id: "ENDF1002",
    code: 1002,
    rule: "missing-send",
    severity: "error",
    message: (mat: string, mf: string, mt: string) =>
      `Missing SEND terminator (MT=0) for MAT=${mat}, MF=${mf}, MT=${mt}.`,
  },
  MISSING_FEND: {
    id: "ENDF1003",
    code: 1003,
    rule: "missing-fend",
    severity: "error",
    message: (mat: string, mf: string) => `Missing FEND terminator (MF=0, MT=0) for MAT=${mat}, MF=${mf}.`,
  },
  MISSING_MEND: {
    id: "ENDF1004",
    code: 1004,
    rule: "missing-mend",
    severity: "error",
    message: (mat: string) => `Missing MEND terminator (MAT=0, MF=0, MT=0) for MAT=${mat}.`,
  },
  MISSING_TEND: {
    id: "ENDF1005",
    code: 1005,
    rule: "missing-tend",
    severity: "warning",
    message: () => "Missing TEND tape terminator (MAT=-1, MF=0, MT=0) at end of ENDF-6 tape.",
  },

  // 2xxx — MAT / MF / MT identifier validation
  INVALID_MAT: {
    id: "ENDF2001",
    code: 2001,
    rule: "invalid-mat",
    severity: "error",
    message: (mat: string) =>
      `Invalid ENDF-6 material number MAT='${mat}' (expected 1..9999, 0 for MEND, or -1 for TEND).`,
  },
  INVALID_MF: {
    id: "ENDF2002",
    code: 2002,
    rule: "invalid-mf",
    severity: "error",
    message: (mf: string) => `Invalid ENDF-6 file number MF='${mf}' (expected standard ENDF-6 file 1..40).`,
  },
  INVALID_MT: {
    id: "ENDF2003",
    code: 2003,
    rule: "invalid-mt",
    severity: "error",
    message: (mt: string) => `Invalid ENDF-6 section number MT='${mt}' (expected 0..999).`,
  },

  // 3xxx — MF=3 energy grid, positivity, and interpolation laws
  NON_MONOTONIC_ENERGY: {
    id: "ENDF3001",
    code: 3001,
    rule: "non-monotonic-energy",
    severity: "error",
    message: (mt: string, ePrev: string, eCurr: string) =>
      `Non-monotonic energy grid in MF=3, MT=${mt}: E=${eCurr} eV < previous E=${ePrev} eV.`,
  },
  NEGATIVE_CROSS_SECTION: {
    id: "ENDF3002",
    code: 3002,
    rule: "negative-cross-section",
    severity: "error",
    message: (mt: string, energy: string, sigma: string) =>
      `Negative cross-section in MF=3, MT=${mt} at E=${energy} eV: sigma=${sigma} b < 0.`,
  },
  INVALID_INTERP_SCHEME: {
    id: "ENDF3003",
    code: 3003,
    rule: "invalid-interp-scheme",
    severity: "error",
    message: (mt: string, interp: string) =>
      `Invalid ENDF-6 interpolation scheme INT='${interp}' in MF=3, MT=${mt} (expected 1..5).`,
  },

  // 4xxx — Cross-section physical consistency
  TOTAL_LESS_THAN_PARTIALS: {
    id: "ENDF4001",
    code: 4001,
    rule: "total-less-than-partials",
    severity: "warning",
    message: (mat: string, energy: string, total: string, partialSum: string) =>
      `Inconsistent MF=3 cross-sections in MAT=${mat} at E=${energy} eV: MT=1 total (${total} b) < partial sum (${partialSum} b).`,
  },

  // 5xxx — Nuclide metadata, TAB1 integrity, resonance & decay checks
  INVALID_ZA: {
    id: "ENDF5001",
    code: 5001,
    rule: "invalid-za",
    severity: "error",
    message: (mat: string, za: string) =>
      `Invalid nuclide identifier ZA='${za}' in MAT=${mat} (expected ZA = 1000*Z + A with 0 < Z <= 118).`,
  },
  INVALID_AWR: {
    id: "ENDF5002",
    code: 5002,
    rule: "invalid-awr",
    severity: "error",
    message: (mat: string, awr: string) => `Invalid atomic weight ratio AWR='${awr}' in MAT=${mat} (expected AWR > 0).`,
  },
  EMPTY_TAB1: {
    id: "ENDF5003",
    code: 5003,
    rule: "empty-tab1",
    severity: "error",
    message: (mt: string) => `Empty TAB1 cross-section table (NP=0) in MF=3, MT=${mt}.`,
  },
  TAB1_NBT_MISMATCH: {
    id: "ENDF5004",
    code: 5004,
    rule: "tab1-nbt-mismatch",
    severity: "warning",
    message: (mt: string, lastNbt: string, np: string) =>
      `TAB1 interpolation boundary mismatch in MF=3, MT=${mt}: final NBT=${lastNbt} != NP=${np}.`,
  },
  INVALID_RESONANCE_WIDTH: {
    id: "ENDF5005",
    code: 5005,
    rule: "invalid-resonance-width",
    severity: "error",
    message: (mat: string, er: string) =>
      `Non-positive total resonance width Gamma <= 0 at Er=${er} eV in MAT=${mat} MF=2 MT=151.`,
  },
  INVALID_HALF_LIFE: {
    id: "ENDF5006",
    code: 5006,
    rule: "invalid-half-life",
    severity: "error",
    message: (mat: string, halfLife: string) =>
      `Non-positive half-life T1/2='${halfLife}' s for unstable nuclide (NST=0) in MAT=${mat} MF=8 MT=457.`,
  },
} as const satisfies Record<string, Endf6ErrorSpec>;

export type Endf6ErrorKey = keyof typeof Endf6ErrorCode;
