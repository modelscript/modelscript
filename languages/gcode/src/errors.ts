// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for @modelscript/gcode (GC1001–GC5006).
 *
 * Numbering scheme:
 * - GC1xxx: Parser / Syntax
 * - GC2xxx: Subprogram / Reference resolution
 * - GC3xxx: Feedrate & Spindle safety
 * - GC4xxx: Geometry & Modal consistency
 * - GC5xxx: Collision, Program Structure & Machining Best Practices
 */

export const GCodeErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "GC1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `G-code syntax error: ${detail}.`,
  },
  UNDEFINED_SUBPROGRAM: {
    code: 2001,
    id: "GC2001",
    rule: "undefined-subprogram",
    severity: "error" as const,
    message: (programNum: number) =>
      `Subprogram 'O${String(programNum).padStart(4, "0")}' referenced by 'M98 P${programNum}' is not defined in this file.`,
  },
  ZERO_FEEDRATE_CUTTING: {
    code: 3001,
    id: "GC3001",
    rule: "zero-feedrate-cutting",
    severity: "error" as const,
    message: (gCode: string) =>
      `Cutting move '${gCode}' commanded with zero or unset feedrate 'F'. Specify a positive 'F' word before cutting.`,
  },
  SPINDLE_STOPPED_CUTTING: {
    code: 3002,
    id: "GC3002",
    rule: "spindle-stopped-cutting",
    severity: "error" as const,
    message: (gCode: string) =>
      `Cutting move '${gCode}' commanded while spindle is stopped ('M05'). Start spindle with 'M03' or 'M04' before cutting.`,
  },
  INVALID_ARC_GEOMETRY: {
    code: 4001,
    id: "GC4001",
    rule: "invalid-arc-geometry",
    severity: "error" as const,
    message: (gCode: string, reason: string) => `Invalid arc geometry in '${gCode}': ${reason}.`,
  },
  CONFLICTING_MODAL_GCODES: {
    code: 4002,
    id: "GC4002",
    rule: "conflicting-modal-gcodes",
    severity: "error" as const,
    message: (group: string, codes: string) =>
      `Conflicting modal G-codes from group '${group}' in the same block: ${codes}.`,
  },
  RAPID_PLUNGE_COLLISION: {
    code: 5001,
    id: "GC5001",
    rule: "rapid-plunge-collision",
    severity: "warning" as const,
    message: (zTarget: number, unit: string) =>
      `Rapid move 'G00' plunges below workplane (Z = ${zTarget.toFixed(3)} ${unit} < 0). Potential tool-workpiece collision.`,
  },
  MISSING_PROGRAM_END: {
    code: 5002,
    id: "GC5002",
    rule: "missing-program-end",
    severity: "warning" as const,
    message: () => `Program does not contain an explicit end-of-program code ('M02' or 'M30').`,
  },
  MISSING_SPINDLE_SPEED: {
    code: 5003,
    id: "GC5003",
    rule: "missing-spindle-speed",
    severity: "warning" as const,
    message: (mCode: string) => `Spindle start '${mCode}' commanded without a positive spindle speed 'S'.`,
  },
  INVALID_CANNED_CYCLE_PARAMS: {
    code: 5004,
    id: "GC5004",
    rule: "invalid-canned-cycle-params",
    severity: "error" as const,
    message: (gCode: string, reason: string) => `Invalid canned cycle '${gCode}' parameters: ${reason}.`,
  },
  UNBALANCED_CUTTER_COMP: {
    code: 5005,
    id: "GC5005",
    rule: "unbalanced-cutter-comp",
    severity: "warning" as const,
    message: (mode: string) =>
      `Cutter radius compensation '${mode}' remains active at program end without 'G40' cancel.`,
  },
  DUPLICATE_WORD_IN_BLOCK: {
    code: 5006,
    id: "GC5006",
    rule: "duplicate-word-in-block",
    severity: "warning" as const,
    message: (letter: string) =>
      `Duplicate address word '${letter}' in the same block; later value overrides earlier value.`,
  },
} as const;

export type GCodeErrorCodeKey = keyof typeof GCodeErrorCode;
