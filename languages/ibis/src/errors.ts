// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error definition for IBIS I/O buffer specifications (ANSI/EIA-656-B).
 */
export const IbisErrorCode = {
  NON_MONOTONIC_IV_CURVE: {
    code: 8303,
    rule: "non-monotonic-iv-curve",
    severity: "warning" as const,
    message: (modelName: string, tableType: string, v1: number, v2: number) =>
      `IBIS model '${modelName}' contains non-monotonic slope in '${tableType}' table between ${v1.toFixed(2)}V and ${v2.toFixed(2)}V.`,
  },
  MISSING_PIN_MODEL_BINDING: {
    code: 8305,
    rule: "missing-pin-model-binding",
    severity: "error" as const,
    message: (pinName: string, modelName: string) =>
      `Component pin '${pinName}' references undefined model '${modelName}'.`,
  },
  MISSING_COMPONENT_PINS: {
    code: 8316,
    rule: "missing-component-pins",
    severity: "error" as const,
    message: (compName: string) => `Component '${compName}' declaration has no defined pins in '[Pin]' section.`,
  },
  INVALID_VOLTAGE_RANGE: {
    code: 8317,
    rule: "invalid-voltage-range",
    severity: "error" as const,
    message: (modelName: string, min: number, max: number) =>
      `IBIS model '${modelName}' has invalid [Voltage Range]: min (${min.toFixed(2)}V) is greater than max (${max.toFixed(2)}V).`,
  },
  CLAMPING_DIODE_DIVERGENCE: {
    code: 8318,
    rule: "clamping-diode-divergence",
    severity: "warning" as const,
    message: (modelName: string, clampType: string, current: number) =>
      `Model '${modelName}' clamp table '${clampType}' diverges to excessive current (${current.toFixed(2)}A).`,
  },
  MISSING_PULLUP_PULLDOWN: {
    code: 8319,
    rule: "missing-pullup-pulldown",
    severity: "error" as const,
    message: (modelName: string, modelType: string) =>
      `Driver model '${modelName}' of type '${modelType}' is missing both I/V tables ([Pullup]/[Pulldown]) and [Ramp] slew rates.`,
  },
  NEGATIVE_DIE_CAPACITANCE: {
    code: 8320,
    rule: "negative-die-capacitance",
    severity: "error" as const,
    message: (modelName: string, val: string) =>
      `IBIS model '${modelName}' specifies non-positive die capacitance C_comp '${val}'.`,
  },
  NEGATIVE_PACKAGE_PARASITIC: {
    code: 8321,
    rule: "negative-package-parasitic",
    severity: "error" as const,
    message: (compName: string, param: string, val: string) =>
      `Component '${compName}' package parasitic '${param}' has non-positive value '${val}'.`,
  },
  NO_MODELS_DEFINED: {
    code: 8322,
    rule: "no-models-defined",
    severity: "error" as const,
    message: () => "IBIS file contains no buffer [Model] definitions.",
  },
} as const;
