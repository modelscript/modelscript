// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RS-274 / ISO 6983 G-code Postprocessor Projection for `@modelscript/apt`.
 *
 * Compiles solved CLDATA toolpaths into executable CNC G-code
 * (`G20`/`G21`, `G90`, `G17`, `G00`/`G01`/`G02`/`G03`, `M03`/`M04`/`M05`,
 * `M07`/`M08`/`M09`, `M30`).
 */

import { solveAptToClData, type SolveClDataOptions } from "../cad/geometry-solver.js";
import { parseAptProgram } from "../parser/apt-parser.js";
import type { AptProgram, ClDataProgram } from "../types.js";

export interface AptToGCodeOptions extends SolveClDataOptions {
  /** Program number for Oxxxx header (default: 1001). */
  programNumber?: number | undefined;
  /** Number of decimal places for coordinates and feedrates (default: 4). */
  precision?: number | undefined;
  /** Include N10/N20/... block sequence numbers (default: true). */
  lineNumbers?: boolean | undefined;
}

function fmtNum(v: number, digits: number): string {
  const n = Math.abs(v) < 1e-9 ? 0 : v;
  return n.toFixed(digits);
}

/**
 * Compiles an APT program or solved CLDATA toolpath into RS-274 / ISO 6983 G-code.
 */
export function aptToGCode(input: AptProgram | ClDataProgram | string, options: AptToGCodeOptions = {}): string {
  const clData: ClDataProgram =
    typeof input === "string"
      ? solveAptToClData(parseAptProgram(input), options)
      : "records" in input
        ? input
        : solveAptToClData(input, options);

  const progNum = options.programNumber ?? 1001;
  const prec = options.precision ?? 4;
  const useLineNums = options.lineNumbers ?? true;

  const lines: string[] = [];
  let seqNum = 10;
  const emit = (block: string): void => {
    if (useLineNums) {
      lines.push(`N${seqNum} ${block}`);
      seqNum += 10;
    } else {
      lines.push(block);
    }
  };

  lines.push("%");
  const safeTitle = (clData.partno || "APT_PART").replace(/[()]/g, "");
  lines.push(`O${String(progNum).padStart(4, "0")} (${safeTitle})`);

  const unitCode = clData.units === "MM" ? "G21" : "G20";
  emit(`${unitCode} G90 G17 G40`);

  let activeFeed = clData.feedRate;
  let hasEnded = false;

  for (const rec of clData.records) {
    switch (rec.kind) {
      case "CUTTER": {
        if (rec.value !== undefined) {
          emit(`(CUTTER DIAMETER ${fmtNum(rec.value, prec)} ${clData.units})`);
        }
        break;
      }
      case "SPINDL": {
        const mode = (rec.mode ?? "CLW").toUpperCase();
        if (mode === "OFF") {
          emit("M05");
        } else {
          const mCode = mode === "CCLW" ? "M04" : "M03";
          const rpm = Math.round(rec.value ?? clData.spindleRpm);
          emit(`S${rpm} ${mCode}`);
        }
        break;
      }
      case "FEDRAT": {
        if (rec.value !== undefined && rec.value > 0) {
          activeFeed = rec.value;
        }
        break;
      }
      case "COOLNT": {
        const mode = (rec.mode ?? "ON").toUpperCase();
        if (mode === "OFF") emit("M09");
        else if (mode === "MIST") emit("M07");
        else emit("M08");
        break;
      }
      case "FROM":
      case "RAPID": {
        if (rec.x !== undefined && rec.y !== undefined && rec.z !== undefined) {
          emit(`G00 X${fmtNum(rec.x, prec)} Y${fmtNum(rec.y, prec)} Z${fmtNum(rec.z, prec)}`);
        }
        break;
      }
      case "LINEAR": {
        if (rec.x !== undefined && rec.y !== undefined && rec.z !== undefined) {
          const f = rec.feedRate && rec.feedRate > 0 ? rec.feedRate : activeFeed;
          emit(`G01 X${fmtNum(rec.x, prec)} Y${fmtNum(rec.y, prec)} Z${fmtNum(rec.z, prec)} F${fmtNum(f, 2)}`);
        }
        break;
      }
      case "ARC_CW":
      case "ARC_CCW": {
        if (
          rec.x0 !== undefined &&
          rec.y0 !== undefined &&
          rec.x !== undefined &&
          rec.y !== undefined &&
          rec.cx !== undefined &&
          rec.cy !== undefined
        ) {
          const gCode = rec.kind === "ARC_CW" ? "G02" : "G03";
          const iOff = rec.cx - rec.x0;
          const jOff = rec.cy - rec.y0;
          const f = rec.feedRate && rec.feedRate > 0 ? rec.feedRate : activeFeed;
          emit(
            `${gCode} X${fmtNum(rec.x, prec)} Y${fmtNum(rec.y, prec)} I${fmtNum(iOff, prec)} J${fmtNum(jOff, prec)} F${fmtNum(f, 2)}`,
          );
        }
        break;
      }
      case "FINI": {
        emit("M05");
        emit("M09");
        emit("M30");
        hasEnded = true;
        break;
      }
    }
  }

  if (!hasEnded) {
    emit("M05");
    emit("M30");
  }

  lines.push("%");
  return lines.join("\n") + "\n";
}
