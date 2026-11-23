// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis and Linter Engine for RS-274 / ISO 6983 G-code (`GC1001`–`GC5006`).
 */

import { GCodeErrorCode } from "../errors.js";
import { parseGCode } from "../parser/gcode-parser.js";
import type {
  CutterCompMode,
  DistanceMode,
  GCodeBlock,
  GCodeProgram,
  MotionMode,
  PlaneMode,
  SpindleState,
  UnitMode,
} from "../types.js";

export interface GCodeDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

/**
 * ISO 6983 modal group classification for detecting conflicting G-codes in the same block.
 */
const MODAL_GROUPS: Record<string, string> = {
  // Group 1: Motion
  G00: "motion",
  G01: "motion",
  G02: "motion",
  G03: "motion",
  G80: "motion",
  G81: "motion",
  G82: "motion",
  G83: "motion",
  G84: "motion",
  G85: "motion",
  G86: "motion",
  G87: "motion",
  G88: "motion",
  G89: "motion",
  // Group 2: Plane selection
  G17: "plane",
  G18: "plane",
  G19: "plane",
  // Group 3: Distance mode
  G90: "distance",
  G91: "distance",
  // Group 5: Feedrate mode
  G94: "feed-mode",
  G95: "feed-mode",
  // Group 6: Units
  G20: "units",
  G21: "units",
  // Group 7: Cutter radius compensation
  G40: "cutter-comp",
  G41: "cutter-comp",
  G42: "cutter-comp",
  // Group 10: Canned cycle return mode
  G98: "retract-mode",
  G99: "retract-mode",
  // Group 12: Work coordinate system
  G54: "work-offset",
  G55: "work-offset",
  G56: "work-offset",
  G57: "work-offset",
  G58: "work-offset",
  G59: "work-offset",
};

const CUTTING_MOTION_CODES = new Set([
  "G01",
  "G02",
  "G03",
  "G81",
  "G82",
  "G83",
  "G84",
  "G85",
  "G86",
  "G87",
  "G88",
  "G89",
]);
const CANNED_DRILL_CODES = new Set(["G81", "G82", "G83", "G84", "G85", "G86", "G87", "G88", "G89"]);

const AXIS_LETTERS = new Set(["X", "Y", "Z", "A", "B", "C"]);

function checkBlockList(
  blocks: GCodeBlock[],
  program: GCodeProgram,
  diags: GCodeDiagnostic[],
  isMainProgram: boolean,
): void {
  let motionMode: MotionMode = "G00";
  let planeMode: PlaneMode = "G17";
  let distanceMode: DistanceMode = "G90";
  let unitMode: UnitMode = "G21";
  let spindleState: SpindleState = "M05";
  let cutterComp: CutterCompMode = "G40";
  let feedrate = 0;
  let spindleSpeed = 0;
  let curX = 0;
  let curY = 0;
  let curZ = 0;
  let hasProgramEnd = false;

  for (const block of blocks) {
    if (block.blockDelete || block.isTapeMarker) continue;

    // 1. Check duplicate non-G/M words in the same block (GC5006)
    const seenLetters = new Map<string, number>();
    for (const w of block.words) {
      if (w.letter === "G" || w.letter === "M") continue;
      const count = (seenLetters.get(w.letter) ?? 0) + 1;
      seenLetters.set(w.letter, count);
      if (count === 2) {
        const def = GCodeErrorCode.DUPLICATE_WORD_IN_BLOCK;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(w.letter),
          line: w.line,
          column: w.column,
          startOffset: w.startOffset,
          endOffset: w.endOffset,
        });
      }
    }

    // 2. Check conflicting modal G-codes in same block (GC4002)
    const groupSeen = new Map<string, string[]>();
    for (const g of block.gCodes) {
      const grp = MODAL_GROUPS[g];
      if (!grp) continue;
      const list = groupSeen.get(grp) ?? [];
      list.push(g);
      groupSeen.set(grp, list);
    }
    for (const [grp, codes] of groupSeen) {
      if (codes.length > 1) {
        const def = GCodeErrorCode.CONFLICTING_MODAL_GCODES;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(grp, codes.join(", ")),
          line: block.line,
          column: 1,
          startOffset: block.startOffset,
          endOffset: block.endOffset,
        });
      }
    }

    // Update modal state from words in this block
    const wordMap = new Map<string, number>();
    for (const w of block.words) {
      if (w.letter !== "G" && w.letter !== "M" && Number.isFinite(w.value)) {
        wordMap.set(w.letter, w.value);
      }
    }

    if (wordMap.has("F")) feedrate = wordMap.get("F") ?? feedrate;
    if (wordMap.has("S")) spindleSpeed = wordMap.get("S") ?? spindleSpeed;

    for (const g of block.gCodes) {
      if (g === "G17" || g === "G18" || g === "G19") planeMode = g;
      else if (g === "G90" || g === "G91") distanceMode = g;
      else if (g === "G20" || g === "G21") unitMode = g;
      else if (g === "G40" || g === "G41" || g === "G42") cutterComp = g;
      else if (g === "G00" || g === "G01" || g === "G02" || g === "G03" || g === "G80" || CANNED_DRILL_CODES.has(g)) {
        motionMode = g as MotionMode;
      }
    }

    for (const m of block.mCodes) {
      if (m === "M03" || m === "M04") {
        spindleState = m;
        if (spindleSpeed <= 0) {
          const def = GCodeErrorCode.MISSING_SPINDLE_SPEED;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(m),
            line: block.line,
            column: 1,
            startOffset: block.startOffset,
            endOffset: block.endOffset,
          });
        }
      } else if (m === "M05") {
        spindleState = "M05";
      } else if (m === "M02" || m === "M30") {
        hasProgramEnd = true;
        spindleState = "M05";
      } else if (m === "M98") {
        const targetP = wordMap.get("P");
        if (targetP === undefined || !program.subprograms.has(Math.round(targetP))) {
          const def = GCodeErrorCode.UNDEFINED_SUBPROGRAM;
          diags.push({
            code: def.code,
            id: def.id,
            rule: def.rule,
            severity: def.severity,
            message: def.message(targetP !== undefined ? Math.round(targetP) : 0),
            line: block.line,
            column: 1,
            startOffset: block.startOffset,
            endOffset: block.endOffset,
          });
        }
      }
    }

    const hasAxisMove = block.words.some((w) => AXIS_LETTERS.has(w.letter));
    const isNonModalHomeOrDwell = block.gCodes.includes("G28") || block.gCodes.includes("G04");

    // Compute target coordinates
    const nextX = wordMap.has("X")
      ? distanceMode === "G91"
        ? curX + (wordMap.get("X") ?? 0)
        : (wordMap.get("X") ?? curX)
      : curX;
    const nextY = wordMap.has("Y")
      ? distanceMode === "G91"
        ? curY + (wordMap.get("Y") ?? 0)
        : (wordMap.get("Y") ?? curY)
      : curY;
    const nextZ = wordMap.has("Z")
      ? distanceMode === "G91"
        ? curZ + (wordMap.get("Z") ?? 0)
        : (wordMap.get("Z") ?? curZ)
      : curZ;

    // 3. Canned drilling cycle parameter validation (GC5004)
    const explicitCanned = block.gCodes.find((g) => CANNED_DRILL_CODES.has(g));
    if (explicitCanned) {
      if (!wordMap.has("Z") || !wordMap.has("R")) {
        const def = GCodeErrorCode.INVALID_CANNED_CYCLE_PARAMS;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(explicitCanned, "both 'Z' depth and 'R' retract plane must be specified"),
          line: block.line,
          column: 1,
          startOffset: block.startOffset,
          endOffset: block.endOffset,
        });
      }
      if (explicitCanned === "G83" && (wordMap.get("Q") ?? 0) <= 0) {
        const def = GCodeErrorCode.INVALID_CANNED_CYCLE_PARAMS;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message("G83", "peck drilling requires a positive 'Q' peck depth"),
          line: block.line,
          column: 1,
          startOffset: block.startOffset,
          endOffset: block.endOffset,
        });
      }
    }

    // 4. Cutting moves: feedrate & spindle safety (GC3001, GC3002)
    if (hasAxisMove && !isNonModalHomeOrDwell && CUTTING_MOTION_CODES.has(motionMode)) {
      if (feedrate <= 0) {
        const def = GCodeErrorCode.ZERO_FEEDRATE_CUTTING;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(motionMode),
          line: block.line,
          column: 1,
          startOffset: block.startOffset,
          endOffset: block.endOffset,
        });
      }
      if (spindleState === "M05") {
        const def = GCodeErrorCode.SPINDLE_STOPPED_CUTTING;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(motionMode),
          line: block.line,
          column: 1,
          startOffset: block.startOffset,
          endOffset: block.endOffset,
        });
      }
    }

    // 5. Arc geometry validation for G02 / G03 (GC4001)
    if (
      !isNonModalHomeOrDwell &&
      (motionMode === "G02" || motionMode === "G03") &&
      (hasAxisMove || wordMap.has("I") || wordMap.has("J") || wordMap.has("K") || wordMap.has("R"))
    ) {
      const hasIJK = wordMap.has("I") || wordMap.has("J") || wordMap.has("K");
      const hasR = wordMap.has("R");
      if (!hasIJK && !hasR) {
        const def = GCodeErrorCode.INVALID_ARC_GEOMETRY;
        diags.push({
          code: def.code,
          id: def.id,
          rule: def.rule,
          severity: def.severity,
          message: def.message(motionMode, "arc requires center offsets (I/J/K) or radius (R)"),
          line: block.line,
          column: 1,
          startOffset: block.startOffset,
          endOffset: block.endOffset,
        });
      } else {
        // Plane coordinates (u, v)
        let u0 = curX;
        let v0 = curY;
        let u1 = nextX;
        let v1 = nextY;
        let du = wordMap.get("I") ?? 0;
        let dv = wordMap.get("J") ?? 0;
        if (planeMode === "G18") {
          u0 = curZ;
          v0 = curX;
          u1 = nextZ;
          v1 = nextX;
          du = wordMap.get("K") ?? 0;
          dv = wordMap.get("I") ?? 0;
        } else if (planeMode === "G19") {
          u0 = curY;
          v0 = curZ;
          u1 = nextY;
          v1 = nextZ;
          du = wordMap.get("J") ?? 0;
          dv = wordMap.get("K") ?? 0;
        }

        if (hasIJK) {
          const cu = u0 + du;
          const cv = v0 + dv;
          const rStart = Math.hypot(u0 - cu, v0 - cv);
          const rEnd = Math.hypot(u1 - cu, v1 - cv);
          const tol = unitMode === "G20" ? 0.002 : 0.05;
          if (rStart < 1e-6) {
            const def = GCodeErrorCode.INVALID_ARC_GEOMETRY;
            diags.push({
              code: def.code,
              id: def.id,
              rule: def.rule,
              severity: def.severity,
              message: def.message(motionMode, "zero arc radius from I/J/K center offsets"),
              line: block.line,
              column: 1,
              startOffset: block.startOffset,
              endOffset: block.endOffset,
            });
          } else if (Math.abs(rStart - rEnd) > tol) {
            const def = GCodeErrorCode.INVALID_ARC_GEOMETRY;
            diags.push({
              code: def.code,
              id: def.id,
              rule: def.rule,
              severity: def.severity,
              message: def.message(
                motionMode,
                `arc start radius (${rStart.toFixed(4)}) and end radius (${rEnd.toFixed(4)}) mismatch by ${Math.abs(rStart - rEnd).toFixed(4)}`,
              ),
              line: block.line,
              column: 1,
              startOffset: block.startOffset,
              endOffset: block.endOffset,
            });
          }
        } else if (hasR) {
          const r = Math.abs(wordMap.get("R") ?? 0);
          const chord = Math.hypot(u1 - u0, v1 - v0);
          if (r < 1e-6 || chord > 2 * r + 1e-5) {
            const def = GCodeErrorCode.INVALID_ARC_GEOMETRY;
            diags.push({
              code: def.code,
              id: def.id,
              rule: def.rule,
              severity: def.severity,
              message: def.message(
                motionMode,
                `arc radius R=${r.toFixed(4)} is smaller than half-chord length ${(chord / 2).toFixed(4)}`,
              ),
              line: block.line,
              column: 1,
              startOffset: block.startOffset,
              endOffset: block.endOffset,
            });
          }
        }
      }
    }

    // 6. Rapid plunge below workplane Z < 0 collision warning (GC5001)
    if (!isNonModalHomeOrDwell && motionMode === "G00" && wordMap.has("Z") && nextZ < 0 && nextZ < curZ) {
      const def = GCodeErrorCode.RAPID_PLUNGE_COLLISION;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(nextZ, unitMode === "G20" ? "in" : "mm"),
        line: block.line,
        column: 1,
        startOffset: block.startOffset,
        endOffset: block.endOffset,
      });
    }

    curX = nextX;
    curY = nextY;
    curZ = nextZ;
  }

  if (isMainProgram) {
    // 7. Missing program end M02 / M30 (GC5002)
    if (!hasProgramEnd && blocks.some((b) => b.words.length > 0)) {
      const last = blocks[blocks.length - 1];
      const def = GCodeErrorCode.MISSING_PROGRAM_END;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(),
        line: last?.line ?? 1,
        column: 1,
        startOffset: last?.startOffset ?? 0,
        endOffset: last?.endOffset ?? 0,
      });
    }

    // 8. Unbalanced cutter radius compensation (GC5005)
    if (cutterComp !== "G40") {
      const last = blocks[blocks.length - 1];
      const def = GCodeErrorCode.UNBALANCED_CUTTER_COMP;
      diags.push({
        code: def.code,
        id: def.id,
        rule: def.rule,
        severity: def.severity,
        message: def.message(cutterComp),
        line: last?.line ?? 1,
        column: 1,
        startOffset: last?.startOffset ?? 0,
        endOffset: last?.endOffset ?? 0,
      });
    }
  }
}

/**
 * Runs all RS-274 / ISO 6983 static analysis checks (`GC1001`–`GC5006`) on a G-code program.
 */
export function lintGCode(input: GCodeProgram | string): GCodeDiagnostic[] {
  const program = typeof input === "string" ? parseGCode(input) : input;
  const diags: GCodeDiagnostic[] = [];

  // Surface parser syntax errors as GC1001
  for (const err of program.parseErrors) {
    const def = GCodeErrorCode.SYNTAX_ERROR;
    diags.push({
      code: def.code,
      id: def.id,
      rule: def.rule,
      severity: def.severity,
      message: def.message(err.message),
      line: err.line,
      column: err.column,
      startOffset: err.startOffset,
      endOffset: err.endOffset,
    });
  }

  checkBlockList(program.blocks, program, diags, true);
  for (const sub of program.subprograms.values()) {
    checkBlockList(sub.blocks, program, diags, false);
  }

  return diags;
}

export { GCodeErrorCode };
