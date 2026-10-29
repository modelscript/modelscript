// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ssp — Standard Diagnostic Error Codes (S7001–S7020).
 */

export const SspErrorCode = {
  EMPTY_CONNECTOR_NAME: {
    code: 7001,
    stdCode: "S7001",
    rule: "SSP_EMPTY_CONNECTOR_NAME",
    severity: "error" as const,
    message: (owner: string) => `Connector in ${owner} has an empty name.`,
  },
  DUPLICATE_CONNECTOR: {
    code: 7002,
    stdCode: "S7002",
    rule: "SSP_DUPLICATE_CONNECTOR",
    severity: "error" as const,
    message: (name: string, owner: string) => `Duplicate connector '${name}' declared in ${owner}.`,
  },
  INVALID_CONNECTOR_KIND: {
    code: 7003,
    stdCode: "S7003",
    rule: "SSP_INVALID_CONNECTOR_KIND",
    severity: "error" as const,
    message: (kind: string) =>
      `Invalid connector kind '${kind}'. Must be input, output, inout, parameter, or calculatedParameter.`,
  },
  EMPTY_COMPONENT_NAME: {
    code: 7004,
    stdCode: "S7004",
    rule: "SSP_EMPTY_COMPONENT_NAME",
    severity: "error" as const,
    message: () => `Component declared with an empty name attribute.`,
  },
  DUPLICATE_COMPONENT: {
    code: 7005,
    stdCode: "S7005",
    rule: "SSP_DUPLICATE_COMPONENT",
    severity: "error" as const,
    message: (name: string) => `Duplicate component '${name}' in system.`,
  },
  EMPTY_SOURCE: {
    code: 7006,
    stdCode: "S7006",
    rule: "SSP_EMPTY_SOURCE",
    severity: "error" as const,
    message: (comp: string) => `Component '${comp}' has an empty or missing source FMU URI.`,
  },
  UNDEFINED_COMPONENT: {
    code: 7007,
    stdCode: "S7007",
    rule: "SSP_UNDEFINED_COMPONENT",
    severity: "error" as const,
    message: (comp: string) => `Referenced component '${comp}' is not defined in system elements.`,
  },
  UNDEFINED_CONNECTOR: {
    code: 7008,
    stdCode: "S7008",
    rule: "SSP_UNDEFINED_CONNECTOR",
    severity: "error" as const,
    message: (conn: string, comp: string) => `Referenced connector '${conn}' not found on component '${comp}'.`,
  },
  CONNECTOR_TYPE_MISMATCH: {
    code: 7009,
    stdCode: "S7009",
    rule: "SSP_CONNECTOR_TYPE_MISMATCH",
    severity: "error" as const,
    message: (startType: string, endType: string) =>
      `Connection type mismatch: '${startType}' cannot connect to '${endType}'.`,
  },
  CONNECTOR_CAUSALITY_CONFLICT: {
    code: 7010,
    stdCode: "S7010",
    rule: "SSP_CONNECTOR_CAUSALITY_CONFLICT",
    severity: "error" as const,
    message: () => `Connection violates causal flow rules.`,
  },
  CYCLIC_CONNECTION: {
    code: 7011,
    stdCode: "S7011",
    rule: "SSP_CYCLIC_CONNECTION",
    severity: "error" as const,
    message: () => `Connection creates an algebraic loop or cyclic dependency without delay.`,
  },
  INVALID_EXPERIMENT_BOUNDS: {
    code: 7012,
    stdCode: "S7012",
    rule: "SSP_INVALID_EXPERIMENT_BOUNDS",
    severity: "error" as const,
    message: () => `DefaultExperiment stopTime must be strictly greater than startTime.`,
  },
  CONNECTOR_UNIT_MISMATCH: {
    code: 7013,
    stdCode: "S7013",
    rule: "SSP_CONNECTOR_UNIT_MISMATCH",
    severity: "warning" as const,
    message: (startUnit: string, endUnit: string) =>
      `Connector unit mismatch: '${startUnit}' connected to '${endUnit}'.`,
  },
} as const;
