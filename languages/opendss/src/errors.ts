// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error definitions for EPRI OpenDSS distribution circuits.
 */
export const OpenDssErrorCode = {
  UNCONNECTED_BUS_NODE: {
    code: 8401,
    rule: "unconnected-bus-node",
    severity: "error" as const,
    message: (elemType: string, elemName: string, busName: string) =>
      `${elemType} '${elemName}' references undefined bus node '${busName}'.`,
  },
  PHASE_COUNT_MISMATCH: {
    code: 8402,
    rule: "phase-count-mismatch",
    severity: "error" as const,
    message: (elemName: string, elemPhases: number, busName: string, busPhases: number) =>
      `Element '${elemName}' (${elemPhases} phases) connected to bus '${busName}' with different phase count (${busPhases}).`,
  },
  TRANSFORMER_VOLTAGE_MISMATCH: {
    code: 8403,
    rule: "transformer-voltage-mismatch",
    severity: "warning" as const,
    message: (xfmrName: string, winding: number, kv: number, busKv: number) =>
      `Transformer '${xfmrName}' winding ${winding} rated voltage (${kv.toFixed(2)} kV) differs from nominal bus voltage (${busKv.toFixed(2)} kV).`,
  },
  REVERSE_POWER_HOSTING_RISK: {
    code: 8404,
    rule: "reverse-power-hosting-risk",
    severity: "warning" as const,
    message: (feederName: string, derCapacity: number, rating: number) =>
      `Total DER generation capacity on feeder '${feederName}' (${derCapacity.toFixed(1)} kW) exceeds upstream transformer thermal rating (${rating.toFixed(1)} kVA).`,
  },
  MISSING_CIRCUIT_DEFINITION: {
    code: 8405,
    rule: "missing-circuit-definition",
    severity: "error" as const,
    message: () => "OpenDSS script defines circuit elements without declaring a 'New Circuit' voltage source.",
  },
  NEGATIVE_LOAD_POWER: {
    code: 8406,
    rule: "negative-load-power",
    severity: "error" as const,
    message: (loadName: string, kw: number) =>
      `Load '${loadName}' specifies negative active power (${kw.toFixed(2)} kW); use Generator or Storage for net generation.`,
  },
  ZERO_OR_NEGATIVE_LINE_LENGTH: {
    code: 8407,
    rule: "zero-or-negative-line-length",
    severity: "error" as const,
    message: (lineName: string, len: number) => `Line '${lineName}' specifies invalid non-positive length (${len}).`,
  },
  MISSING_LINE_CODE: {
    code: 8408,
    rule: "missing-line-code",
    severity: "error" as const,
    message: (lineName: string, codeName: string) => `Line '${lineName}' references undefined LineCode '${codeName}'.`,
  },
} as const;
