// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/autosar — Standard Diagnostic Error Codes (M7401–M7420).
 */

export const AutosarErrorCode = {
  UNCONNECTED_MANDATORY_PORT: {
    code: "M7401",
    rule: "unconnected-mandatory-port",
    severity: "error" as const,
    message: (portName: string, compName: string, typeName?: string, compSwc?: string) =>
      typeName && compSwc
        ? `Required port '${portName}' on component '${compName}' (${typeName}) is unconnected in composition '${compSwc}'.`
        : `Required port '${portName}' on component prototype '${compName}' is not connected by any assembly connector.`,
  },
  INTERFACE_MISMATCH: {
    code: "M7402",
    rule: "interface-mismatch",
    severity: "error" as const,
    message: (connName: string, pPort: string, pIf: string, rPort: string, rIf?: string) =>
      rIf !== undefined
        ? `Interface mismatch in connector '${connName}': Provider port '${pPort}' provides '${pIf}' while requester port '${rPort}' requires '${rIf}'.`
        : `Connector interface mismatch: provider port '${connName}' uses interface '${pPort}', but requirer port '${pIf}' expects '${rPort}'.`,
  },
  DATA_ELEMENT_TYPE_MISMATCH: {
    code: "M7403",
    rule: "data-element-type-mismatch",
    severity: "warning" as const,
    message: (deName: string, ifName: string) =>
      `Data element '${deName}' in interface '${ifName}' has no data type reference.`,
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
  WCET_BUDGET_OVERFLOW: {
    code: "M7405",
    rule: "wcet-budget-overflow",
    severity: "error" as const,
    message: (runnableName: string, wcetMs: string, periodMs: string) =>
      `Execution time WCET (${wcetMs} ms) of runnable '${runnableName}' exceeds its timing event period (${periodMs} ms).`,
  },
  INVALID_DATA_TYPE_MAPPING: {
    code: "M7405",
    rule: "invalid-data-type-mapping",
    severity: "error" as const,
    message: (dtName: string, reason: string) => `Invalid data type mapping for '${dtName}': ${reason}.`,
  },
  OVERLAPPING_PDU_BITS: {
    code: "M7406",
    rule: "overlapping-pdu-bits",
    severity: "error" as const,
    message: (sigA: string, sigB: string, bitIdx: number, pduName: string) =>
      `Signals '${sigA}' and '${sigB}' overlap bit index ${bitIdx} in PDU '${pduName}'.`,
  },
  CIRCULAR_COMPOSITION_DEPENDENCY: {
    code: "M7406",
    rule: "circular-composition-dependency",
    severity: "error" as const,
    message: (path: string) => `Circular software component composition dependency detected: ${path}.`,
  },
  PDU_EXCEEDS_FRAME_CAPACITY: {
    code: "M7407",
    rule: "pdu-exceeds-frame-capacity",
    severity: "error" as const,
    message: (pduName: string, pduLen: number, frameName: string, frameLen: number) =>
      `PDU '${pduName}' length (${pduLen} bytes) exceeds CAN frame '${frameName}' payload capacity (${frameLen} bytes).`,
  },
  MISSING_SW_ADDR_METHOD: {
    code: "M7407",
    rule: "missing-software-address-method",
    severity: "warning" as const,
    message: (variable: string) =>
      `Variable data prototype '${variable}' lacks a declared SwAddrMethod memory section mapping.`,
  },
  CYCLIC_RUNNABLE_DEPENDENCY: {
    code: "M7408",
    rule: "cyclic-runnable-dependency",
    severity: "error" as const,
    message: (cycle: string[]) => `Cyclic data dependency detected between runnables: '${cycle.join("' -> '")}'.`,
  },
  INCOMPATIBLE_PORT_INTERFACE_DIRECTION: {
    code: "M7408",
    rule: "incompatible-port-interface-direction",
    severity: "error" as const,
    message: (portName: string, reason: string) => `Port '${portName}' interface direction violation: ${reason}.`,
  },
  MISSING_INTERNAL_BEHAVIOR: {
    code: "M7409",
    rule: "missing-internal-behavior",
    severity: "warning" as const,
    message: (swcName: string) => `Atomic software component '${swcName}' lacks internal behavior definition.`,
  },
  UNTRIGGERED_RUNNABLE: {
    code: "M7410",
    rule: "untriggered-runnable",
    severity: "info" as const,
    message: (rName: string, swcName: string) =>
      `Runnable entity '${rName}' in SWC '${swcName}' has no associated RTE trigger event.`,
  },
} as const;

export type AutosarErrorCodeKey = keyof typeof AutosarErrorCode;
