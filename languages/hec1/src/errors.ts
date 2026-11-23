// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`HEC11001`–`HEC15006`) for USACE HEC-1 card decks.
 */

export interface Hec1Diagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number | undefined;
  stationId?: string | undefined;
}

export const Hec1ErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "HEC11001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `HEC-1 card syntax error: ${detail}.`,
  },
  MISSING_TIME_INTERVAL: {
    code: 2001,
    id: "HEC12001",
    rule: "missing-time-interval",
    severity: "error" as const,
    message: () => `Missing required 'IT' time-interval specification card in HEC-1 deck.`,
  },
  MISSING_END_CARD: {
    code: 2002,
    id: "HEC12002",
    rule: "missing-end-card",
    severity: "warning" as const,
    message: () => `Missing required 'ZZ' end-of-job terminator card in HEC-1 deck.`,
  },
  DUPLICATE_STATION_ID: {
    code: 2003,
    id: "HEC12003",
    rule: "duplicate-station-id",
    severity: "error" as const,
    message: (stationId: string) => `Duplicate 'KK' station identifier '${stationId}' in HEC-1 deck.`,
  },
  NON_POSITIVE_DRAINAGE_AREA: {
    code: 3001,
    id: "HEC13001",
    rule: "non-positive-drainage-area",
    severity: "error" as const,
    message: (stationId: string, area: number) =>
      `Subbasin '${stationId}' has non-positive drainage area '${area}' on 'BA' card; area must be > 0.`,
  },
  CURVE_NUMBER_OUT_OF_RANGE: {
    code: 3002,
    id: "HEC13002",
    rule: "curve-number-out-of-range",
    severity: "error" as const,
    message: (stationId: string, cn: number) =>
      `Subbasin '${stationId}' has SCS Curve Number '${cn}' on 'LS' card outside valid range (0, 100].`,
  },
  MISSING_PRECIPITATION: {
    code: 3003,
    id: "HEC13003",
    rule: "missing-precipitation",
    severity: "error" as const,
    message: (stationId: string) => `Subbasin '${stationId}' is missing precipitation data ('PB', 'PI', or 'PC' card).`,
  },
  INVALID_MUSKINGUM_X: {
    code: 4001,
    id: "HEC14001",
    rule: "invalid-muskingum-x",
    severity: "error" as const,
    message: (stationId: string, x: number) =>
      `Reach '${stationId}' has invalid Muskingum weighting factor X = '${x}' on 'RM' card; must satisfy 0 <= X <= 0.5.`,
  },
  MUSKINGUM_STABILITY_VIOLATION: {
    code: 4002,
    id: "HEC14002",
    rule: "muskingum-stability-violation",
    severity: "warning" as const,
    message: (stationId: string, dtHours: number, kSub: number, x: number) =>
      `Reach '${stationId}' violates Muskingum stability criterion dt/(2*K) >= X (dt=${dtHours.toFixed(3)} hr, K_sub=${kSub.toFixed(3)} hr, dt/(2*K)=${(dtHours / (2 * kSub)).toFixed(4)} < X=${x}); increase NSTPS or adjust dt.`,
  },
  INVALID_MUSKINGUM_K_OR_STEPS: {
    code: 4003,
    id: "HEC14003",
    rule: "invalid-muskingum-k-or-steps",
    severity: "error" as const,
    message: (stationId: string, k: number, nstps: number) =>
      `Reach '${stationId}' has non-positive Muskingum parameters on 'RM' card (K='${k}', NSTPS='${nstps}'); both must be > 0.`,
  },
  INVALID_COMBINE_COUNT: {
    code: 5001,
    id: "HEC15001",
    rule: "invalid-combine-count",
    severity: "error" as const,
    message: (stationId: string, count: number, available: number) =>
      `Combine station '${stationId}' on 'HC' card requires at least 2 upstream hydrographs (requested '${count}', available '${available}').`,
  },
  INVALID_TIME_INTERVAL: {
    code: 5002,
    id: "HEC15002",
    rule: "invalid-time-interval",
    severity: "error" as const,
    message: (nmin: number, nq: number) =>
      `Invalid 'IT' time control parameters (NMIN='${nmin}', NQ='${nq}'); both time interval and ordinate count must be > 0.`,
  },
  INVALID_UNIT_HYDROGRAPH_PARAMS: {
    code: 5003,
    id: "HEC15003",
    rule: "invalid-unit-hydrograph-params",
    severity: "error" as const,
    message: (stationId: string, method: string, detail: string) =>
      `Subbasin '${stationId}' has invalid ${method} unit hydrograph parameters: ${detail}.`,
  },
  INVALID_LOSS_PARAMETERS: {
    code: 5004,
    id: "HEC15004",
    rule: "invalid-loss-parameters",
    severity: "error" as const,
    message: (stationId: string, detail: string) => `Subbasin '${stationId}' has invalid loss parameters: ${detail}.`,
  },
  MISSING_UNIT_HYDROGRAPH: {
    code: 5005,
    id: "HEC15005",
    rule: "missing-unit-hydrograph",
    severity: "warning" as const,
    message: (stationId: string) =>
      `Subbasin '${stationId}' is missing a unit hydrograph specification ('UC', 'UD', or 'US' card).`,
  },
  ROUTING_WITHOUT_UPSTREAM: {
    code: 5006,
    id: "HEC15006",
    rule: "routing-without-upstream",
    severity: "error" as const,
    message: (stationId: string) => `Routing station '${stationId}' has no upstream hydrograph to route.`,
  },
} as const;
