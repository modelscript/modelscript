// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lsdyna — Standard Diagnostic Error Codes (LSD1001–LSD5006).
 */

export const LsDynaErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    stdCode: "LSD1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `LS-DYNA keyword deck syntax error: '${detail}'.`,
  },
  MISSING_KEYWORD_HEADER: {
    code: 1002,
    stdCode: "LSD1002",
    rule: "missing-keyword-header",
    severity: "warning" as const,
    message: () => `LS-DYNA deck is missing the required '*KEYWORD' header card.`,
  },
  MISSING_END_CARD: {
    code: 1003,
    stdCode: "LSD1003",
    rule: "missing-end-card",
    severity: "warning" as const,
    message: () => `LS-DYNA deck is missing the closing '*END' terminator card.`,
  },
  DUPLICATE_NODE_ID: {
    code: 2001,
    stdCode: "LSD2001",
    rule: "duplicate-node-id",
    severity: "error" as const,
    message: (nid: number) => `Duplicate node ID '${nid}' declared in '*NODE'.`,
  },
  DUPLICATE_ELEMENT_ID: {
    code: 2002,
    stdCode: "LSD2002",
    rule: "duplicate-element-id",
    severity: "error" as const,
    message: (eid: number) => `Duplicate element ID '${eid}' declared in '*ELEMENT'.`,
  },
  DUPLICATE_PART_ID: {
    code: 2003,
    stdCode: "LSD2003",
    rule: "duplicate-part-id",
    severity: "error" as const,
    message: (pid: number) => `Duplicate part ID '${pid}' declared in '*PART'.`,
  },
  DUPLICATE_MATERIAL_ID: {
    code: 2004,
    stdCode: "LSD2004",
    rule: "duplicate-material-id",
    severity: "error" as const,
    message: (mid: number) => `Duplicate material ID '${mid}' declared in '*MAT'.`,
  },
  DUPLICATE_SECTION_ID: {
    code: 2005,
    stdCode: "LSD2005",
    rule: "duplicate-section-id",
    severity: "error" as const,
    message: (secid: number) => `Duplicate section ID '${secid}' declared in '*SECTION'.`,
  },
  UNDEFINED_ELEMENT_NODE: {
    code: 3001,
    stdCode: "LSD3001",
    rule: "undefined-element-node",
    severity: "error" as const,
    message: (eid: number, nid: number) => `Element '${eid}' references undefined node ID '${nid}'.`,
  },
  UNDEFINED_ELEMENT_PART: {
    code: 3002,
    stdCode: "LSD3002",
    rule: "undefined-element-part",
    severity: "error" as const,
    message: (eid: number, pid: number) => `Element '${eid}' references undefined part ID '${pid}'.`,
  },
  UNDEFINED_PART_SECTION: {
    code: 3003,
    stdCode: "LSD3003",
    rule: "undefined-part-section",
    severity: "error" as const,
    message: (pid: number, secid: number) => `Part '${pid}' references undefined section ID '${secid}'.`,
  },
  UNDEFINED_PART_MATERIAL: {
    code: 3004,
    stdCode: "LSD3004",
    rule: "undefined-part-material",
    severity: "error" as const,
    message: (pid: number, mid: number) => `Part '${pid}' references undefined material ID '${mid}'.`,
  },
  UNDEFINED_BC_OR_LOAD_TARGET: {
    code: 3005,
    stdCode: "LSD3005",
    rule: "undefined-bc-or-load-target",
    severity: "error" as const,
    message: (card: string, refKind: string, id: number) =>
      `Card '${card}' references undefined ${refKind} ID '${id}'.`,
  },
  NON_POSITIVE_YOUNGS_MODULUS: {
    code: 4001,
    stdCode: "LSD4001",
    rule: "non-positive-youngs-modulus",
    severity: "error" as const,
    message: (mid: number, val: number) => `Material '${mid}' has non-positive Young's modulus '${val}' (must be > 0).`,
  },
  NON_POSITIVE_DENSITY: {
    code: 4002,
    stdCode: "LSD4002",
    rule: "non-positive-density",
    severity: "error" as const,
    message: (mid: number, val: number) =>
      `Material '${mid}' has non-positive mass density '${val}' (must be > 0 for explicit dynamics).`,
  },
  INVALID_POISSON_RATIO: {
    code: 4003,
    stdCode: "LSD4003",
    rule: "invalid-poisson-ratio",
    severity: "error" as const,
    message: (mid: number, val: number) =>
      `Material '${mid}' has invalid Poisson's ratio '${val}' (must satisfy -1.0 < nu < 0.5).`,
  },
  NON_POSITIVE_SECTION_GEOMETRY: {
    code: 4004,
    stdCode: "LSD4004",
    rule: "non-positive-section-geometry",
    severity: "error" as const,
    message: (secid: number, prop: string, val: number) => `Section '${secid}' has non-positive ${prop} '${val}'.`,
  },
  MISSING_CONTROL_TERMINATION: {
    code: 5001,
    stdCode: "LSD5001",
    rule: "missing-control-termination",
    severity: "warning" as const,
    message: () => `Deck is missing '*CONTROL_TERMINATION'; explicit simulation end time is unspecified.`,
  },
  NON_POSITIVE_TERMINATION_TIME: {
    code: 5002,
    stdCode: "LSD5002",
    rule: "non-positive-termination-time",
    severity: "error" as const,
    message: (endtim: number) => `'*CONTROL_TERMINATION' specifies non-positive end time '${endtim}'.`,
  },
  CFL_TIMESTEP_WARNING: {
    code: 5003,
    stdCode: "LSD5003",
    rule: "cfl-timestep-warning",
    severity: "warning" as const,
    message: (detail: string) => `CFL critical timestep warning: ${detail}.`,
  },
  EMPTY_MESH: {
    code: 5004,
    stdCode: "LSD5004",
    rule: "empty-mesh",
    severity: "error" as const,
    message: () => `LS-DYNA deck contains no finite elements or nodes.`,
  },
  UNCONSTRAINED_RIGID_BODY: {
    code: 5005,
    stdCode: "LSD5005",
    rule: "unconstrained-rigid-body",
    severity: "warning" as const,
    message: () => `Deck has no '*BOUNDARY_SPC' constraints; unconstrained rigid-body drift may occur.`,
  },
  INVALID_PLASTICITY_PARAMETERS: {
    code: 5006,
    stdCode: "LSD5006",
    rule: "invalid-plasticity-parameters",
    severity: "error" as const,
    message: (mid: number, detail: string) => `Material '${mid}' has invalid plasticity parameters: ${detail}.`,
  },
} as const;

export type LsDynaErrorKey = keyof typeof LsDynaErrorCode;
