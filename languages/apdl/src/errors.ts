// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ApdlErrorDef {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

/**
 * Diagnostic error codes for `@modelscript/apdl` (`APDL1001`–`APDL5006`).
 *
 * Numbering scheme:
 * - `APDL1xxx` — Syntax & control-flow structure
 * - `APDL2xxx` — Name & entity reference resolution
 * - `APDL3xxx` — Material & constitutive parameter validation
 * - `APDL4xxx` — Structural boundary condition & model completeness
 * - `APDL5xxx` — Processor context & element/loop sanity
 */
export const ApdlErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "APDL1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `APDL syntax error: ${detail}.`,
  },
  UNMATCHED_DO: {
    code: 1002,
    id: "APDL1002",
    rule: "unmatched-do",
    severity: "error" as const,
    message: (detail: string) => `Unmatched '*DO' / '*ENDDO' block: ${detail}.`,
  },
  UNMATCHED_IF: {
    code: 1003,
    id: "APDL1003",
    rule: "unmatched-if",
    severity: "error" as const,
    message: (detail: string) => `Unmatched '*IF' / '*ELSE' / '*ENDIF' block: ${detail}.`,
  },
  UNDEFINED_PARAMETER: {
    code: 2001,
    id: "APDL2001",
    rule: "undefined-parameter",
    severity: "error" as const,
    message: (paramName: string) => `Undefined APDL parameter '${paramName}' referenced in expression.`,
  },
  UNDEFINED_NODE: {
    code: 2002,
    id: "APDL2002",
    rule: "undefined-node",
    severity: "error" as const,
    message: (nodeId: string, elemId: string) => `Element '${elemId}' references undefined node '${nodeId}'.`,
  },
  UNDEFINED_ELEMENT_TYPE: {
    code: 2003,
    id: "APDL2003",
    rule: "undefined-element-type",
    severity: "error" as const,
    message: (typeId: string) => `Reference to undefined element type 'ET, ${typeId}'.`,
  },
  UNDEFINED_MATERIAL: {
    code: 2004,
    id: "APDL2004",
    rule: "undefined-material",
    severity: "error" as const,
    message: (matId: string) => `Reference to undefined material 'MAT = ${matId}'.`,
  },
  INVALID_YOUNGS_MODULUS: {
    code: 3001,
    id: "APDL3001",
    rule: "invalid-youngs-modulus",
    severity: "error" as const,
    message: (matId: string, val: string) =>
      `Material '${matId}' has non-positive Young's modulus EX = '${val}' (must be > 0).`,
  },
  INVALID_POISSONS_RATIO: {
    code: 3002,
    id: "APDL3002",
    rule: "invalid-poissons-ratio",
    severity: "error" as const,
    message: (matId: string, val: string) =>
      `Material '${matId}' has invalid Poisson's ratio PRXY = '${val}' (must satisfy -1 < PRXY < 0.5).`,
  },
  INVALID_DENSITY: {
    code: 3003,
    id: "APDL3003",
    rule: "invalid-density",
    severity: "error" as const,
    message: (matId: string, val: string) =>
      `Material '${matId}' has non-positive mass density DENS = '${val}' (must be > 0).`,
  },
  RIGID_BODY_MOTION: {
    code: 4001,
    id: "APDL4001",
    rule: "rigid-body-motion",
    severity: "error" as const,
    message: () =>
      `'SOLVE' invoked with no displacement boundary constraints ('D' command); model exhibits rigid-body motion.`,
  },
  NO_ELEMENTS_DEFINED: {
    code: 4002,
    id: "APDL4002",
    rule: "no-elements",
    severity: "warning" as const,
    message: () => `'SOLVE' invoked with no finite elements defined in the model.`,
  },
  WRONG_PROCESSOR_PREP7: {
    code: 5001,
    id: "APDL5001",
    rule: "wrong-processor-prep7",
    severity: "warning" as const,
    message: (cmd: string, proc: string) =>
      `Preprocessor command '${cmd}' used in '${proc}' processor instead of '/PREP7'.`,
  },
  WRONG_PROCESSOR_SOLU: {
    code: 5002,
    id: "APDL5002",
    rule: "wrong-processor-solu",
    severity: "warning" as const,
    message: (cmd: string, proc: string) => `Solution command '${cmd}' used in '${proc}' processor instead of '/SOLU'.`,
  },
  WRONG_PROCESSOR_POST1: {
    code: 5003,
    id: "APDL5003",
    rule: "wrong-processor-post1",
    severity: "warning" as const,
    message: (cmd: string, proc: string) =>
      `Postprocessor command '${cmd}' used in '${proc}' processor instead of '/POST1'.`,
  },
  DUPLICATE_NODE: {
    code: 5004,
    id: "APDL5004",
    rule: "duplicate-node",
    severity: "warning" as const,
    message: (nodeId: string) =>
      `Node '${nodeId}' is defined multiple times; later definition overwrites earlier coordinates.`,
  },
  DEGENERATE_ELEMENT: {
    code: 5005,
    id: "APDL5005",
    rule: "degenerate-element",
    severity: "error" as const,
    message: (elemId: string, detail: string) => `Element '${elemId}' is degenerate: ${detail}.`,
  },
  EMPTY_DO_LOOP: {
    code: 5006,
    id: "APDL5006",
    rule: "empty-do-loop",
    severity: "warning" as const,
    message: (varName: string, detail: string) => `'*DO' loop over '${varName}' is invalid or empty: ${detail}.`,
  },
} as const;

export type ApdlErrorKey = keyof typeof ApdlErrorCode;
