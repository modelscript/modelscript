// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/edif` (EDIF1001–EDIF5006).
 */

export type EdifSeverity = "error" | "warning" | "info";

export interface EdifDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: EdifSeverity;
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  symbolName?: string | undefined;
}

export const EdifErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "EDIF1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `EDIF syntax error: ${detail}.`,
  },
  INVALID_EDIF_VERSION: {
    code: 1002,
    id: "EDIF1002",
    rule: "invalid-edif-version",
    severity: "error" as const,
    message: (found: string) => `Invalid edifVersion '${found}': expected EDIF 2.0.0 ('2 0 0').`,
  },
  INVALID_EDIF_LEVEL: {
    code: 1003,
    id: "EDIF1003",
    rule: "invalid-edif-level",
    severity: "warning" as const,
    message: (level: string) => `Unsupported edifLevel '${level}': expected 0, 1, or 2.`,
  },
  DUPLICATE_LIBRARY: {
    code: 2001,
    id: "EDIF2001",
    rule: "duplicate-library",
    severity: "error" as const,
    message: (libName: string) => `Duplicate library or external declaration '${libName}'.`,
  },
  DUPLICATE_CELL: {
    code: 2002,
    id: "EDIF2002",
    rule: "duplicate-cell",
    severity: "error" as const,
    message: (cellName: string, libName: string) => `Duplicate cell declaration '${cellName}' in library '${libName}'.`,
  },
  DUPLICATE_INSTANCE: {
    code: 2003,
    id: "EDIF2003",
    rule: "duplicate-instance",
    severity: "error" as const,
    message: (instName: string, cellName: string) =>
      `Duplicate instance declaration '${instName}' in cell '${cellName}'.`,
  },
  DUPLICATE_NET: {
    code: 2004,
    id: "EDIF2004",
    rule: "duplicate-net",
    severity: "error" as const,
    message: (netName: string, cellName: string) => `Duplicate net declaration '${netName}' in cell '${cellName}'.`,
  },
  DUPLICATE_PORT: {
    code: 2005,
    id: "EDIF2005",
    rule: "duplicate-port",
    severity: "error" as const,
    message: (portName: string, cellName: string) => `Duplicate port declaration '${portName}' in cell '${cellName}'.`,
  },
  UNRESOLVED_LIBRARY_REF: {
    code: 3001,
    id: "EDIF3001",
    rule: "unresolved-library-ref",
    severity: "error" as const,
    message: (libName: string) => `Unresolved libraryRef '${libName}'.`,
  },
  UNRESOLVED_CELL_REF: {
    code: 3002,
    id: "EDIF3002",
    rule: "unresolved-cell-ref",
    severity: "error" as const,
    message: (cellName: string, libName: string) => `Unresolved cellRef '${cellName}' in library '${libName}'.`,
  },
  UNRESOLVED_VIEW_REF: {
    code: 3003,
    id: "EDIF3003",
    rule: "unresolved-view-ref",
    severity: "error" as const,
    message: (viewName: string, cellName: string) => `Unresolved viewRef '${viewName}' in cell '${cellName}'.`,
  },
  UNRESOLVED_INSTANCE_REF: {
    code: 3004,
    id: "EDIF3004",
    rule: "unresolved-instance-ref",
    severity: "error" as const,
    message: (instName: string, netName: string) => `Unresolved instanceRef '${instName}' in net '${netName}'.`,
  },
  UNRESOLVED_PORT_REF: {
    code: 3005,
    id: "EDIF3005",
    rule: "unresolved-port-ref",
    severity: "error" as const,
    message: (portName: string, target: string) => `Unresolved portRef '${portName}' on '${target}'.`,
  },
  FLOATING_NET: {
    code: 4001,
    id: "EDIF4001",
    rule: "floating-net",
    severity: "warning" as const,
    message: (netName: string, pinCount: number) =>
      `Floating net '${netName}' has fewer than 2 connected pins (${pinCount} connected).`,
  },
  SHORTED_OUTPUT_DRIVERS: {
    code: 4002,
    id: "EDIF4002",
    rule: "shorted-output-drivers",
    severity: "error" as const,
    message: (netName: string, drivers: string) => `Shorted output-to-output drivers on net '${netName}': ${drivers}.`,
  },
  MISSING_DESIGN: {
    code: 5001,
    id: "EDIF5001",
    rule: "missing-design",
    severity: "error" as const,
    message: (edifName: string) => `Missing top-level 'design' reference in EDIF document '${edifName}'.`,
  },
  UNRESOLVED_DESIGN_CELL: {
    code: 5002,
    id: "EDIF5002",
    rule: "unresolved-design-cell",
    severity: "error" as const,
    message: (cellName: string, libName: string) =>
      `Top-level design references unresolved cell '${cellName}' in library '${libName}'.`,
  },
  EMPTY_VIEW_CONTENTS: {
    code: 5003,
    id: "EDIF5003",
    rule: "empty-view-contents",
    severity: "info" as const,
    message: (cellName: string, viewName: string) => `View '${viewName}' of cell '${cellName}' has empty contents.`,
  },
  UNCONNECTED_PORT: {
    code: 5004,
    id: "EDIF5004",
    rule: "unconnected-port",
    severity: "warning" as const,
    message: (portName: string, cellName: string) =>
      `Interface port '${portName}' of cell '${cellName}' is not connected to any net.`,
  },
  INVALID_PORT_DIRECTION: {
    code: 5005,
    id: "EDIF5005",
    rule: "invalid-port-direction",
    severity: "error" as const,
    message: (direction: string, portName: string) =>
      `Invalid direction '${direction}' on port '${portName}': expected INPUT, OUTPUT, or INOUT.`,
  },
  HIERARCHY_CYCLE: {
    code: 5006,
    id: "EDIF5006",
    rule: "hierarchy-cycle",
    severity: "error" as const,
    message: (cyclePath: string) => `Circular cell instantiation hierarchy detected: ${cyclePath}.`,
  },
} as const;

export type EdifErrorCodeKey = keyof typeof EdifErrorCode;
