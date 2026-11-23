// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Diagnostic Error Codes (MCNP1001–MCNP5006).
 */

export type McnpSeverity = "error" | "warning" | "info";

export interface McnpErrorDef {
  readonly code: number;
  readonly id: string;
  readonly rule: string;
  readonly severity: McnpSeverity;
  readonly message: (...args: string[]) => string;
}

export interface McnpDiagnostic {
  id: string;
  code: number;
  rule: string;
  severity: McnpSeverity;
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  entityId?: string | undefined;
}

export const McnpErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "MCNP1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in MCNP deck: ${detail}.`,
  },
  MALFORMED_CARD: {
    code: 1002,
    id: "MCNP1002",
    rule: "malformed-card",
    severity: "error" as const,
    message: (card: string) => `Malformed MCNP card '${card}'.`,
  },
  DUPLICATE_CELL_ID: {
    code: 2001,
    id: "MCNP2001",
    rule: "duplicate-cell-id",
    severity: "error" as const,
    message: (cellId: string) => `Duplicate cell ID '${cellId}' declared in Cell Cards block.`,
  },
  DUPLICATE_SURFACE_ID: {
    code: 2002,
    id: "MCNP2002",
    rule: "duplicate-surface-id",
    severity: "error" as const,
    message: (surfId: string) => `Duplicate surface ID '${surfId}' declared in Surface Cards block.`,
  },
  DUPLICATE_MATERIAL_ID: {
    code: 2003,
    id: "MCNP2003",
    rule: "duplicate-material-id",
    severity: "error" as const,
    message: (matId: string) => `Duplicate material ID 'M${matId}' declared in Data Cards block.`,
  },
  UNDEFINED_SURFACE_IN_CELL: {
    code: 2004,
    id: "MCNP2004",
    rule: "undefined-surface-in-cell",
    severity: "error" as const,
    message: (surfId: string, cellId: string) =>
      `Undefined surface '${surfId}' referenced in CSG geometry of cell '${cellId}'.`,
  },
  UNDEFINED_MATERIAL_IN_CELL: {
    code: 2005,
    id: "MCNP2005",
    rule: "undefined-material-in-cell",
    severity: "error" as const,
    message: (matId: string, cellId: string) => `Undefined material 'M${matId}' referenced by cell '${cellId}'.`,
  },
  TALLY_UNDEFINED_TARGET: {
    code: 2006,
    id: "MCNP2006",
    rule: "tally-undefined-target",
    severity: "error" as const,
    message: (tallyId: string, kind: string, targetId: string) =>
      `Tally 'F${tallyId}' references undefined ${kind} '${targetId}'.`,
  },
  INVALID_ZAID_FORMAT: {
    code: 3001,
    id: "MCNP3001",
    rule: "invalid-zaid-format",
    severity: "error" as const,
    message: (zaid: string, matId: string) =>
      `Invalid ZAID '${zaid}' in material 'M${matId}'; expected ZZZAAA[.nnX] format.`,
  },
  MIXED_MATERIAL_FRACTION_SIGNS: {
    code: 3002,
    id: "MCNP3002",
    rule: "mixed-material-fraction-signs",
    severity: "error" as const,
    message: (matId: string) => `Material 'M${matId}' mixes positive (atom) and negative (weight) fraction signs.`,
  },
  INVALID_CELL_DENSITY: {
    code: 3003,
    id: "MCNP3003",
    rule: "invalid-cell-density",
    severity: "error" as const,
    message: (cellId: string) => `Non-void cell '${cellId}' requires a non-zero density.`,
  },
  MISSING_GRAVEYARD_CELL: {
    code: 4001,
    id: "MCNP4001",
    rule: "missing-graveyard-cell",
    severity: "warning" as const,
    message: () => `Deck has no graveyard cell with zero importance ('IMP:N=0' or 'IMP:P=0').`,
  },
  MISSING_SOURCE_CARD: {
    code: 4002,
    id: "MCNP4002",
    rule: "missing-source-card",
    severity: "warning" as const,
    message: () => `Deck has no particle source specification ('SDEF' or 'KCODE').`,
  },
  KCODE_MISSING_KSRC: {
    code: 4003,
    id: "MCNP4003",
    rule: "kcode-missing-ksrc",
    severity: "warning" as const,
    message: () => `Criticality card 'KCODE' specified without initial fission source points ('KSRC').`,
  },
  INVALID_SURFACE_PARAM_COUNT: {
    code: 5001,
    id: "MCNP5001",
    rule: "invalid-surface-param-count",
    severity: "error" as const,
    message: (surfId: string, surfType: string, actual: string, expected: string) =>
      `Surface '${surfId}' (${surfType}) has ${actual} parameter(s); expected ${expected}.`,
  },
  NON_POSITIVE_RADIUS: {
    code: 5002,
    id: "MCNP5002",
    rule: "non-positive-radius",
    severity: "error" as const,
    message: (surfId: string, surfType: string) =>
      `Surface '${surfId}' (${surfType}) must have a strictly positive radius.`,
  },
  INVALID_CELL_VOLUME: {
    code: 5003,
    id: "MCNP5003",
    rule: "invalid-cell-volume",
    severity: "error" as const,
    message: (cellId: string) => `Cell '${cellId}' has non-positive volume ('VOL').`,
  },
  INVALID_NPS: {
    code: 5004,
    id: "MCNP5004",
    rule: "invalid-nps",
    severity: "error" as const,
    message: (nps: string) => `Particle history count 'NPS ${nps}' must be a positive integer.`,
  },
  INVALID_KCODE_PARAMS: {
    code: 5005,
    id: "MCNP5005",
    rule: "invalid-kcode-params",
    severity: "error" as const,
    message: (detail: string) => `Invalid 'KCODE' parameters: ${detail}.`,
  },
  CIRCULAR_CELL_COMPLEMENT: {
    code: 5006,
    id: "MCNP5006",
    rule: "circular-cell-complement",
    severity: "error" as const,
    message: (cellId: string) => `Circular cell complement reference involving cell '${cellId}'.`,
  },
} as const;
