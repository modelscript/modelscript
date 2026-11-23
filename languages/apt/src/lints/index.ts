// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis and Linter Engine for `@modelscript/apt` (`APT1001`–`APT5006`).
 */

import { solveAptToClData } from "../cad/geometry-solver.js";
import { AptErrorCode, type AptDiagnostic } from "../errors.js";
import { parseAptProgram } from "../parser/apt-parser.js";
import type { AptProgram } from "../types.js";

const RESERVED_APT_TOKENS = new Set<string>([
  "TO",
  "ON",
  "PAST",
  "TANTO",
  "CENTER",
  "RADIUS",
  "INTOF",
  "ATANGL",
  "PARLEL",
  "PERPTO",
  "XLARGE",
  "XSMALL",
  "YLARGE",
  "YSMALL",
  "LARGE",
  "SMALL",
  "LEFT",
  "RIGHT",
  "LINEAR",
  "ARC",
  "CLW",
  "CCLW",
  "OFF",
  "FLOOD",
  "MIST",
  "INCHES",
  "INCH",
  "IN",
  "MM",
  "MILLIMETERS",
  "INCR",
  "DECR",
  "XAXIS",
  "YAXIS",
  "ZAXIS",
  "OUT",
  "THRU",
  "AVOID",
  "RETAIN",
  "OMIT",
  "POINT",
  "LINE",
  "CIRCLE",
  "PLANE",
  "PATERN",
  "RPM",
  "SFM",
  "IPM",
  "MMPM",
  "IPR",
]);

function isNumericToken(tok: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(tok.trim());
}

function isIdentifierToken(tok: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(tok.trim());
}

function extractRefIdentifiers(arg: string): string[] {
  const trimmed = arg.trim();
  if (!trimmed) return [];
  // Handle nested parenthesized expressions like (POINT / 1, 2, 0) or (LINE / P1, P2)
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(1, -1).trim();
    const slashIdx = inner.indexOf("/");
    const argPart = slashIdx >= 0 ? inner.slice(slashIdx + 1) : inner;
    const refs: string[] = [];
    for (const part of argPart.split(",")) {
      refs.push(...extractRefIdentifiers(part));
    }
    return refs;
  }
  if (isNumericToken(trimmed)) return [];
  const upper = trimmed.toUpperCase();
  if (RESERVED_APT_TOKENS.has(upper)) return [];
  if (isIdentifierToken(trimmed)) return [upper];
  return [];
}

/**
 * Runs all APT static analysis checks (`APT1001`–`APT5006`) on an APT part program.
 */
export function lintApt(input: AptProgram | string): AptDiagnostic[] {
  const program = typeof input === "string" ? parseAptProgram(input) : input;
  const diags: AptDiagnostic[] = [];

  // 1. Parser syntax errors (APT1001)
  for (const err of program.parseErrors) {
    const def = AptErrorCode.SYNTAX_ERROR;
    diags.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(err.message),
      line: err.line,
      column: err.column,
      endLine: err.endLine,
      endColumn: err.endColumn,
      startOffset: err.startOffset,
      endOffset: err.endOffset,
    });
  }

  // 2. Duplicate geometry labels (APT2001) + track defined labels in declaration order
  const definedLabels = new Set<string>();
  const allDefinedLabels = new Set<string>(program.geometries.keys());

  let seenFrom = false;
  let seenCutter = false;

  for (const stmt of program.statements) {
    if (stmt.stmtKind === "geometry") {
      if (definedLabels.has(stmt.label)) {
        const def = AptErrorCode.DUPLICATE_GEOMETRY_LABEL;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(stmt.label),
          line: stmt.line,
          column: stmt.column,
          endLine: stmt.endLine,
          endColumn: stmt.endColumn,
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
          symbol: stmt.label,
        });
      }

      // Check references inside geometry definition arguments (APT2002)
      for (const arg of stmt.args) {
        for (const ref of extractRefIdentifiers(arg)) {
          if (!allDefinedLabels.has(ref)) {
            const def = AptErrorCode.UNDEFINED_GEOMETRY_REF;
            diags.push({
              code: def.code,
              id: def.id,
              rule: def.rule,
              severity: def.severity,
              message: def.message(ref, `${stmt.geometryKind} definition '${stmt.label}'`),
              line: stmt.line,
              column: stmt.column,
              endLine: stmt.endLine,
              endColumn: stmt.endColumn,
              startOffset: stmt.startOffset,
              endOffset: stmt.endOffset,
              symbol: ref,
            });
          }
        }
      }

      definedLabels.add(stmt.label);
      continue;
    }

    if (stmt.stmtKind === "postprocessor") {
      if (stmt.keyword === "CUTTER") {
        seenCutter = true;
        const diam = Number(stmt.args[0]);
        if (!Number.isFinite(diam) || diam <= 0) {
          const def = AptErrorCode.INVALID_CUTTER_DIAMETER;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(diam),
            line: stmt.line,
            column: stmt.column,
            endLine: stmt.endLine,
            endColumn: stmt.endColumn,
            startOffset: stmt.startOffset,
            endOffset: stmt.endOffset,
          });
        }
      } else if (stmt.keyword === "FEDRAT") {
        const feed = Number(stmt.args[0]);
        if (!Number.isFinite(feed) || feed <= 0) {
          const def = AptErrorCode.INVALID_FEED_RATE;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(feed),
            line: stmt.line,
            column: stmt.column,
            endLine: stmt.endLine,
            endColumn: stmt.endColumn,
            startOffset: stmt.startOffset,
            endOffset: stmt.endOffset,
          });
        }
      } else if (stmt.keyword === "SPINDL") {
        const firstUpper = (stmt.args[0] ?? "").toUpperCase();
        if (firstUpper !== "OFF" && firstUpper !== "ON") {
          const rpm = Number(stmt.args[0]);
          if (!Number.isFinite(rpm) || rpm <= 0 || rpm > 100000) {
            const def = AptErrorCode.INVALID_SPINDLE_RPM;
            diags.push({
              code: def.code,
              id: def.id,
              rule: def.rule,
              severity: def.severity,
              message: def.message(rpm),
              line: stmt.line,
              column: stmt.column,
              endLine: stmt.endLine,
              endColumn: stmt.endColumn,
              startOffset: stmt.startOffset,
              endOffset: stmt.endOffset,
            });
          }
        }
      } else if (stmt.keyword === "INTOL" || stmt.keyword === "OUTTOL") {
        const tol = Number(stmt.args[0]);
        if (!Number.isFinite(tol) || tol <= 0) {
          const def = AptErrorCode.NON_POSITIVE_TOLERANCE;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(stmt.keyword, tol),
            line: stmt.line,
            column: stmt.column,
            endLine: stmt.endLine,
            endColumn: stmt.endColumn,
            startOffset: stmt.startOffset,
            endOffset: stmt.endOffset,
          });
        }
      }
      continue;
    }

    // Motion statements
    if (stmt.keyword === "FROM") {
      seenFrom = true;
    } else {
      if (!seenFrom) {
        const def = AptErrorCode.MOTION_BEFORE_FROM;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(stmt.keyword),
          line: stmt.line,
          column: stmt.column,
          endLine: stmt.endLine,
          endColumn: stmt.endColumn,
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
        });
      }
      if (!seenCutter) {
        const def = AptErrorCode.MOTION_BEFORE_CUTTER;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(stmt.keyword),
          line: stmt.line,
          column: stmt.column,
          endLine: stmt.endLine,
          endColumn: stmt.endColumn,
          startOffset: stmt.startOffset,
          endOffset: stmt.endOffset,
        });
      }
    }

    // Undefined geometry references in motion arguments (APT2002)
    for (const arg of stmt.args) {
      for (const ref of extractRefIdentifiers(arg)) {
        if (!allDefinedLabels.has(ref)) {
          const def = AptErrorCode.UNDEFINED_GEOMETRY_REF;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(ref, `${stmt.keyword} motion statement`),
            line: stmt.line,
            column: stmt.column,
            endLine: stmt.endLine,
            endColumn: stmt.endColumn,
            startOffset: stmt.startOffset,
            endOffset: stmt.endOffset,
            symbol: ref,
          });
        }
      }
    }
  }

  // 3. Missing FINI warning (APT5002)
  if (!program.hasFini && program.statements.length > 0) {
    const last = program.statements[program.statements.length - 1];
    const def = AptErrorCode.MISSING_FINI;
    diags.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(),
      line: last?.line ?? 1,
      column: last?.column ?? 1,
      endLine: last?.endLine ?? 1,
      endColumn: last?.endColumn ?? 1,
      startOffset: last?.startOffset ?? 0,
      endOffset: last?.endOffset ?? 0,
    });
  }

  // 4. Geometric / CLDATA solver errors (APT5001, APT5004, APT5005, APT5006)
  const clData = solveAptToClData(program);
  const solverCodeMap: Record<
    string,
    { code: number; id: string; rule: string; severity: "error" | "warning" | "info" }
  > = {
    APT5001: AptErrorCode.PARALLEL_NON_INTERSECTING_LINES,
    APT5004: AptErrorCode.DEGENERATE_GEOMETRY,
    APT5005: AptErrorCode.NO_CIRCLE_INTERSECTION,
    APT5006: AptErrorCode.CUTTER_TOO_LARGE_FOR_FILLET,
  };

  for (const err of clData.errors) {
    const spec = solverCodeMap[err.code];
    if (!spec) continue;
    diags.push({
      code: spec.code,
      id: spec.id,
      rule: spec.rule,
      severity: spec.severity,
      message: err.message,
      line: err.line,
      column: 1,
    });
  }

  return diags;
}

export { AptErrorCode, type AptDiagnostic };
