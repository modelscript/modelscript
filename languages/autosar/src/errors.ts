// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/autosar — Standard Diagnostic Error Codes (M7401–M7420).
 */

export const AutosarErrorCode = {
  UNCONNECTED_MANDATORY_PORT: {
    code: "M7401",
    rule: "unconnected-mandatory-port",
    severity: "warning" as const,
    message: (portName: string, compName: string) =>
      `Required port '${portName}' on component prototype '${compName}' is not connected by any assembly connector.`,
  },
  INTERFACE_MISMATCH: {
    code: "M7402",
    rule: "interface-mismatch",
    severity: "error" as const,
    message: (pPort: string, pIf: string, rPort: string, rIf: string) =>
      `Connector interface mismatch: provider port '${pPort}' uses interface '${pIf}', but requirer port '${rPort}' expects '${rIf}'.`,
  },
  INVALID_RUNNABLE_PERIOD: {
    code: "M7403",
    rule: "invalid-runnable-period",
    severity: "error" as const,
    message: (symbol: string, period: number) =>
      `Timing event for runnable '${symbol}' defines non-positive period (${period} s).`,
  },
  DUPLICATE_SHORT_NAME: {
    code: "M7404",
    rule: "duplicate-short-name",
    severity: "error" as const,
    message: (name: string, pkg: string) => `Duplicate SHORT-NAME '${name}' detected in package '${pkg}'.`,
  },
  INVALID_DATA_TYPE_MAPPING: {
    code: "M7405",
    rule: "invalid-data-type-mapping",
    severity: "error" as const,
    message: (dtName: string, reason: string) => `Invalid data type mapping for '${dtName}': ${reason}.`,
  },
  CIRCULAR_COMPOSITION_DEPENDENCY: {
    code: "M7406",
    rule: "circular-composition-dependency",
    severity: "error" as const,
    message: (path: string) => `Circular software component composition dependency detected: ${path}.`,
  },
  MISSING_SW_ADDR_METHOD: {
    code: "M7407",
    rule: "missing-software-address-method",
    severity: "warning" as const,
    message: (variable: string) =>
      `Variable data prototype '${variable}' lacks a declared SwAddrMethod memory section mapping.`,
  },
  INCOMPATIBLE_PORT_INTERFACE_DIRECTION: {
    code: "M7408",
    rule: "incompatible-port-interface-direction",
    severity: "error" as const,
    message: (portName: string, reason: string) => `Port '${portName}' interface direction violation: ${reason}.`,
  },
} as const;

export type AutosarErrorCodeKey = keyof typeof AutosarErrorCode;
