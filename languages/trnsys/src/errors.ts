// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/trnsys` (`TRN1001`–`TRN5006`).
 */
export const TrnsysErrorCode = {
  SYNTAX_ERROR: {
    code: "TRN1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `TRNSYS deck syntax error: ${detail}.`,
  },
  DUPLICATE_UNIT: {
    code: "TRN2001",
    rule: "duplicate-unit",
    severity: "error" as const,
    message: (unitNumber: number) => `Duplicate UNIT number '${unitNumber}' declared in deck.`,
  },
  UNDEFINED_UNIT_REF: {
    code: "TRN2002",
    rule: "undefined-unit-ref",
    severity: "error" as const,
    message: (unitNumber: number, targetUnit: number) =>
      `INPUTS connection in UNIT ${unitNumber} references undefined UNIT '${targetUnit}'.`,
  },
  OUTPUT_INDEX_OUT_OF_RANGE: {
    code: "TRN2003",
    rule: "output-index-out-of-range",
    severity: "error" as const,
    message: (unitNumber: number, targetUnit: number, outputIndex: number, typeNumber: number, maxOutputs: number) =>
      `INPUTS connection in UNIT ${unitNumber} references output '${outputIndex}' of UNIT ${targetUnit} (TYPE ${typeNumber}), which only defines ${maxOutputs} outputs.`,
  },
  UNDEFINED_EQUATION_VAR: {
    code: "TRN2004",
    rule: "undefined-equation-var",
    severity: "error" as const,
    message: (varName: string, eqName: string) =>
      `Undefined variable '${varName}' referenced in EQUATIONS assignment '${eqName}'.`,
  },
  PARAMETER_COUNT_MISMATCH: {
    code: "TRN3001",
    rule: "parameter-count-mismatch",
    severity: "error" as const,
    message: (unitNumber: number, declared: number, actual: number) =>
      `UNIT ${unitNumber} PARAMETERS count mismatch: declared ${declared}, found ${actual}.`,
  },
  INPUT_COUNT_MISMATCH: {
    code: "TRN3002",
    rule: "input-count-mismatch",
    severity: "error" as const,
    message: (unitNumber: number, declared: number, actual: number) =>
      `UNIT ${unitNumber} INPUTS count mismatch: declared ${declared}, found ${actual}.`,
  },
  MISSING_SIMULATION_CARD: {
    code: "TRN4001",
    rule: "missing-simulation-card",
    severity: "error" as const,
    message: () => `Missing required 'SIMULATION' control card in TRNSYS deck.`,
  },
  MISSING_END_CARD: {
    code: "TRN4002",
    rule: "missing-end-card",
    severity: "warning" as const,
    message: () => `Missing 'END' control card at end of TRNSYS deck.`,
  },
  INVALID_TIMESTEP: {
    code: "TRN4003",
    rule: "invalid-timestep",
    severity: "error" as const,
    message: (dt: number) => `Simulation timestep '${dt}' must be strictly positive (> 0).`,
  },
  INVALID_TIME_RANGE: {
    code: "TRN4004",
    rule: "invalid-time-range",
    severity: "error" as const,
    message: (tStart: number, tStop: number) =>
      `Invalid SIMULATION time range: start time '${tStart}' must be less than stop time '${tStop}'.`,
  },
  ALGEBRAIC_LOOP: {
    code: "TRN5001",
    rule: "algebraic-loop",
    severity: "warning" as const,
    message: (cycle: string) => `Algebraic loop detected across connected units: ${cycle}.`,
  },
  UNKNOWN_TYPE_NUMBER: {
    code: "TRN5006",
    rule: "unknown-type-number",
    severity: "warning" as const,
    message: (unitNumber: number, typeNumber: number) =>
      `UNIT ${unitNumber} uses non-standard or unregistered TRNSYS TYPE '${typeNumber}'.`,
  },
} as const;
