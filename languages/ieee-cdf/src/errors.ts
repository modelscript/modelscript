// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ieee-cdf — Standard Diagnostic Error Codes (CDF1001–CDF5006).
 */

export const IeeeCdfErrorCode = {
  SYNTAX_ERROR: {
    code: "CDF1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in IEEE CDF / BPA IPF deck: ${detail}.`,
  },
  MISSING_TITLE_OR_MVA_BASE: {
    code: "CDF1002",
    rule: "missing-title-or-mva-base",
    severity: "error" as const,
    message: () => `Missing title card or valid positive system MVA base in IEEE CDF deck.`,
  },
  MISSING_END_OF_DATA: {
    code: "CDF1003",
    rule: "missing-end-of-data",
    severity: "warning" as const,
    message: () => `IEEE CDF deck is missing the required 'END OF DATA' terminator card.`,
  },
  DUPLICATE_BUS_NUMBER: {
    code: "CDF2001",
    rule: "duplicate-bus-number",
    severity: "error" as const,
    message: (busNumber: number) => `Duplicate bus number '${busNumber}' declared in BUS DATA section.`,
  },
  UNDEFINED_BRANCH_BUS: {
    code: "CDF2002",
    rule: "undefined-branch-bus",
    severity: "error" as const,
    message: (role: "from" | "to", busNumber: number, otherBus: number) =>
      `Branch references undefined ${role}-bus '${busNumber}' (connected to bus '${otherBus}').`,
  },
  SELF_LOOP_BRANCH: {
    code: "CDF3001",
    rule: "self-loop-branch",
    severity: "error" as const,
    message: (busNumber: number, circuit: string) =>
      `Branch on circuit '${circuit}' forms a self-loop on bus '${busNumber}'.`,
  },
  ZERO_IMPEDANCE_BRANCH: {
    code: "CDF3002",
    rule: "zero-impedance-branch",
    severity: "error" as const,
    message: (fromBus: number, toBus: number, circuit: string) =>
      `Branch '${fromBus}-${toBus}' (circuit '${circuit}') has zero series impedance (R = 0 and X = 0).`,
  },
  MISSING_SLACK_BUS: {
    code: "CDF4001",
    rule: "missing-slack-bus",
    severity: "error" as const,
    message: () => `Network has no slack/swing bus (bus type 3). Power flow solution cannot be anchored.`,
  },
  MULTIPLE_SLACK_BUSES: {
    code: "CDF4002",
    rule: "multiple-slack-buses",
    severity: "warning" as const,
    message: (count: number) => `Network defines ${count} slack/swing buses (bus type 3); expected 1 per island.`,
  },
  VOLTAGE_OUT_OF_BOUNDS: {
    code: "CDF5001",
    rule: "voltage-out-of-bounds",
    severity: "warning" as const,
    message: (busNumber: number, vmPu: number) =>
      `Bus '${busNumber}' voltage magnitude (${vmPu.toFixed(4)} pu) is outside normal bounds [0.8, 1.2] pu.`,
  },
  PV_QLIM_INVERTED: {
    code: "CDF5002",
    rule: "pv-qlim-inverted",
    severity: "error" as const,
    message: (busNumber: number, qMin: number, qMax: number) =>
      `PV bus '${busNumber}' has inverted reactive power limits (Qmin=${qMin} > Qmax=${qMax} MVAR).`,
  },
  DISCONNECTED_ISLAND_BUS: {
    code: "CDF5003",
    rule: "disconnected-island-bus",
    severity: "warning" as const,
    message: (busNumber: number, busName: string) =>
      `Bus '${busNumber}' ('${busName}') is disconnected from the slack bus island.`,
  },
  NEGATIVE_BRANCH_RESISTANCE: {
    code: "CDF5004",
    rule: "negative-branch-resistance",
    severity: "warning" as const,
    message: (fromBus: number, toBus: number, r: number) =>
      `Branch '${fromBus}-${toBus}' has negative resistance (R=${r} pu).`,
  },
  INVALID_TAP_RATIO: {
    code: "CDF5005",
    rule: "invalid-tap-ratio",
    severity: "warning" as const,
    message: (fromBus: number, toBus: number, tap: number) =>
      `Transformer branch '${fromBus}-${toBus}' has off-nominal tap ratio (${tap}) outside [0.5, 1.5].`,
  },
  ZERO_MVA_BASE: {
    code: "CDF5006",
    rule: "zero-mva-base",
    severity: "error" as const,
    message: (mvaBase: number) => `System MVA base (${mvaBase}) must be strictly positive.`,
  },
} as const;

export type IeeeCdfErrorCodeKey = keyof typeof IeeeCdfErrorCode;

export interface IeeeCdfDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  busNumber?: number | undefined;
}
