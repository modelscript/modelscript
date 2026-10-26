// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/aspen — Diagnostic Error Codes (M8101–M8115).
 * Follows OpenModelica formatting: single-quoted identifiers ('${id}') and period-terminated.
 */

export const AspenErrorCode = {
  UNCONNECTED_STREAM_PORT: {
    code: "M8101",
    rule: "unconnected-stream-port",
    severity: "error" as const,
    message: (streamName: string, blockName: string) =>
      `Stream '${streamName}' connected to block '${blockName}' inlet has no producing source block outlet.`,
  },
  TEAR_STREAM_UNCONVERGED: {
    code: "M8102",
    rule: "tear-stream-unconverged",
    severity: "error" as const,
    message: (blockName: string) =>
      `Circular flowsheet loop detected involving block '${blockName}' without designated tear stream.`,
  },
  INVALID_EOS_PARAMETER: {
    code: "M8103",
    rule: "invalid-eos-parameter",
    severity: "error" as const,
    message: (compName: string, propertyMethod: string) =>
      `Component '${compName}' lacks critical properties for property method '${propertyMethod}'.`,
  },
  NEGATIVE_COMPONENT_FRACTION: {
    code: "M8104",
    rule: "negative-component-fraction",
    severity: "error" as const,
    message: (streamName: string, compName: string, val: number) =>
      `Stream '${streamName}' specifies negative component molar fraction for '${compName}' (${val}).`,
  },
  COLUMN_REBOILER_HEAT_DEFICIT: {
    code: "M8105",
    rule: "column-reboiler-heat-deficit",
    severity: "warning" as const,
    message: (blockName: string) => `Column '${blockName}' duty results in non-positive reboiler boil-up.`,
  },
  DUPLICATE_BLOCK_ID: {
    code: "M8106",
    rule: "duplicate-block-id",
    severity: "error" as const,
    message: (blockId: string) => `Duplicate block ID '${blockId}' declared in flowsheet.`,
  },
  DUPLICATE_COMPONENT_ID: {
    code: "M8107",
    rule: "duplicate-component-id",
    severity: "error" as const,
    message: (compId: string) => `Duplicate component ID '${compId}' declared in COMPONENTS.`,
  },
  FRACTIONS_SUM_INVALID: {
    code: "M8108",
    rule: "fractions-sum-invalid",
    severity: "warning" as const,
    message: (streamName: string, sum: number) =>
      `Component mole fractions in stream '${streamName}' sum to ${sum.toFixed(4)}, expected 1.0.`,
  },
  FEED_STAGE_OUT_OF_RANGE: {
    code: "M8109",
    rule: "feed-stage-out-of-range",
    severity: "error" as const,
    message: (blockName: string, stage: number, nStages: number) =>
      `Column '${blockName}' feed stage ${stage} is out of bounds (1..${nStages}).`,
  },
  PRODUCT_STAGE_OUT_OF_RANGE: {
    code: "M8110",
    rule: "product-stage-out-of-range",
    severity: "error" as const,
    message: (blockName: string, stage: number, nStages: number) =>
      `Column '${blockName}' product stage ${stage} is out of bounds (1..${nStages}).`,
  },
  MISSING_FLOWSHEET_ENTRY: {
    code: "M8111",
    rule: "missing-flowsheet-entry",
    severity: "warning" as const,
    message: (blockName: string) =>
      `Block '${blockName}' has parameter declarations but is not connected in FLOWSHEET.`,
  },
  STREAM_TEMPERATURE_NEGATIVE: {
    code: "M8112",
    rule: "stream-temperature-negative",
    severity: "error" as const,
    message: (streamName: string, temp: number) =>
      `Stream '${streamName}' specifies non-physical absolute temperature ${temp} K.`,
  },
  STREAM_PRESSURE_NEGATIVE: {
    code: "M8113",
    rule: "stream-pressure-negative",
    severity: "error" as const,
    message: (streamName: string, pres: number) =>
      `Stream '${streamName}' specifies non-positive pressure ${pres} bar.`,
  },
  RADFRAC_STAGES_TOO_FEW: {
    code: "M8114",
    rule: "radfrac-stages-too-few",
    severity: "error" as const,
    message: (blockName: string, nStages: number) =>
      `RadFrac column '${blockName}' has fewer than 2 stages (${nStages}).`,
  },
  REFLUX_RATIO_NEGATIVE: {
    code: "M8115",
    rule: "reflux-ratio-negative",
    severity: "error" as const,
    message: (blockName: string, rr: number) => `Column '${blockName}' reflux ratio (${rr}) must be non-negative.`,
  },
} as const;
