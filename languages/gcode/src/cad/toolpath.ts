// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modal CNC State Machine & 3D Toolpath Trajectory Generator for RS-274 / ISO 6983 G-code.
 *
 * Computes exact rapid, linear, circular/helical arc, dwell, and canned drilling cycle
 * trajectories with exact Euclidean/helical arc lengths, bounding boxes, and cycle times.
 */

import { parseGCode } from "../parser/gcode-parser.js";
import type {
  BoundingBox3D,
  DistanceMode,
  FeedMode,
  GCodeBlock,
  GCodeProgram,
  MotionMode,
  PlaneMode,
  Point3D,
  RetractMode,
  SpindleState,
  ToolpathOptions,
  ToolpathSegment,
  ToolpathSummary,
  UnitMode,
  WorkOffsetCode,
} from "../types.js";

const INCH_TO_MM = 25.4;
const TWO_PI = 2 * Math.PI;
const CANNED_CYCLES = new Set<string>(["G81", "G82", "G83", "G84", "G85", "G86", "G87", "G88", "G89"]);

interface MachineState {
  pos: Point3D;
  motionMode: MotionMode;
  plane: PlaneMode;
  distanceMode: DistanceMode;
  unitMode: UnitMode;
  feedMode: FeedMode;
  retractMode: RetractMode;
  workOffset: WorkOffsetCode;
  spindleState: SpindleState;
  spindleRpm: number;
  feedrateRaw: number; // in active units/min (G94) or active units/rev (G95)
  toolNumber: number;
  // Canned cycle latched parameters (in mm)
  cannedR: number;
  cannedZ: number;
  cannedQ: number;
  cannedP: number;
  cannedInitialZ: number;
  // Stats
  segments: ToolpathSegment[];
  toolChanges: number[];
  spindleRpmMax: number;
  feedrateMaxMmPerMin: number;
  holeCount: number;
}

function dist3(a: Point3D, b: Point3D): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function clonePt(p: Point3D): Point3D {
  return { x: p.x, y: p.y, z: p.z };
}

function getEffectiveFeedMmPerMin(state: MachineState): number {
  const scale = state.unitMode === "G20" ? INCH_TO_MM : 1.0;
  if (state.feedMode === "G95") {
    return state.feedrateRaw * scale * Math.max(0, state.spindleRpm);
  }
  return state.feedrateRaw * scale;
}

function normalizeAnglePos(a: number): number {
  let r = a % TWO_PI;
  if (r < 0) r += TWO_PI;
  return r;
}

function angleInSweep(angle: number, startAngle: number, sweep: number, isCw: boolean): boolean {
  const a = normalizeAnglePos(angle);
  const s = normalizeAnglePos(startAngle);
  if (sweep >= TWO_PI - 1e-9) return true;
  if (isCw) {
    const delta = normalizeAnglePos(s - a);
    return delta >= -1e-9 && delta <= sweep + 1e-9;
  }
  const delta = normalizeAnglePos(a - s);
  return delta >= -1e-9 && delta <= sweep + 1e-9;
}

function expandBox(box: BoundingBox3D, p: Point3D): void {
  if (p.x < box.minX) box.minX = p.x;
  if (p.x > box.maxX) box.maxX = p.x;
  if (p.y < box.minY) box.minY = p.y;
  if (p.y > box.maxY) box.maxY = p.y;
  if (p.z < box.minZ) box.minZ = p.z;
  if (p.z > box.maxZ) box.maxZ = p.z;
}

function expandBoxForArc(box: BoundingBox3D, seg: ToolpathSegment): void {
  expandBox(box, seg.start);
  expandBox(box, seg.end);
  if (!seg.center || !seg.radiusMm || !seg.sweepAngleRad) return;

  const isCw = seg.kind === "arc_cw";
  const r = seg.radiusMm;
  const plane = seg.plane ?? "G17";
  const cardinals = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

  if (plane === "G17") {
    const a0 = Math.atan2(seg.start.y - seg.center.y, seg.start.x - seg.center.x);
    for (const c of cardinals) {
      if (angleInSweep(c, a0, seg.sweepAngleRad, isCw)) {
        expandBox(box, {
          x: seg.center.x + r * Math.cos(c),
          y: seg.center.y + r * Math.sin(c),
          z: seg.start.z,
        });
      }
    }
  } else if (plane === "G18") {
    const a0 = Math.atan2(seg.start.x - seg.center.x, seg.start.z - seg.center.z);
    for (const c of cardinals) {
      if (angleInSweep(c, a0, seg.sweepAngleRad, isCw)) {
        expandBox(box, {
          x: seg.center.x + r * Math.sin(c),
          y: seg.start.y,
          z: seg.center.z + r * Math.cos(c),
        });
      }
    }
  } else if (plane === "G19") {
    const a0 = Math.atan2(seg.start.z - seg.center.z, seg.start.y - seg.center.y);
    for (const c of cardinals) {
      if (angleInSweep(c, a0, seg.sweepAngleRad, isCw)) {
        expandBox(box, {
          x: seg.start.x,
          y: seg.center.y + r * Math.cos(c),
          z: seg.center.z + r * Math.sin(c),
        });
      }
    }
  }
}

function addLinearSegment(
  state: MachineState,
  kind: "rapid" | "linear" | "drill_plunge" | "drill_retract",
  target: Point3D,
  rateMmPerMin: number,
  blockLine: number,
  gCode: string,
): void {
  const len = dist3(state.pos, target);
  if (len <= 1e-12) {
    state.pos = clonePt(target);
    return;
  }
  const safeRate = Math.max(1e-6, rateMmPerMin);
  const durationSec = (len / safeRate) * 60.0;
  state.segments.push({
    kind,
    start: clonePt(state.pos),
    end: clonePt(target),
    feedrateMmPerMin: safeRate,
    spindleRpm: state.spindleRpm,
    lengthMm: len,
    durationSec,
    blockLine,
    gCode,
    toolNumber: state.toolNumber,
  });
  state.pos = clonePt(target);
}

function executeBlocks(
  blocks: GCodeBlock[],
  program: GCodeProgram,
  state: MachineState,
  rapidRateMmPerMin: number,
  peckClearanceMm: number,
  workOffsets: Partial<Record<WorkOffsetCode, Point3D>>,
  maxSubDepth: number,
  depth: number,
): boolean {
  for (const block of blocks) {
    if (block.blockDelete || block.isTapeMarker) continue;

    const wordMap = new Map<string, number>();
    for (const w of block.words) {
      if (w.letter !== "G" && w.letter !== "M" && Number.isFinite(w.value)) {
        wordMap.set(w.letter, w.value);
      }
    }

    // Update modal state from G-codes
    let isDwell = false;
    let isHomeReturn = false;
    let explicitCanned: string | undefined;

    for (const g of block.gCodes) {
      if (g === "G17" || g === "G18" || g === "G19") state.plane = g;
      else if (g === "G90" || g === "G91") state.distanceMode = g;
      else if (g === "G20" || g === "G21") state.unitMode = g;
      else if (g === "G94" || g === "G95") state.feedMode = g;
      else if (g === "G98" || g === "G99") state.retractMode = g;
      else if (g === "G54" || g === "G55" || g === "G56" || g === "G57" || g === "G58" || g === "G59") {
        state.workOffset = g;
      } else if (g === "G04") {
        isDwell = true;
      } else if (g === "G28") {
        isHomeReturn = true;
      } else if (g === "G00" || g === "G01" || g === "G02" || g === "G03" || g === "G80") {
        state.motionMode = g;
      } else if (CANNED_CYCLES.has(g)) {
        state.motionMode = g as MotionMode;
        explicitCanned = g;
        state.cannedInitialZ = state.pos.z;
      }
    }

    // Update F, S, T
    if (wordMap.has("F")) {
      state.feedrateRaw = wordMap.get("F") ?? state.feedrateRaw;
      const effFeed = getEffectiveFeedMmPerMin(state);
      if (effFeed > state.feedrateMaxMmPerMin) state.feedrateMaxMmPerMin = effFeed;
    }
    if (wordMap.has("S")) {
      state.spindleRpm = wordMap.get("S") ?? state.spindleRpm;
      if (state.spindleRpm > state.spindleRpmMax) state.spindleRpmMax = state.spindleRpm;
    }
    if (wordMap.has("T")) {
      state.toolNumber = Math.round(wordMap.get("T") ?? state.toolNumber);
    }

    // Process M-codes
    let endProgram = false;
    let returnSub = false;
    let subCallTarget: number | undefined;
    let subCallRepeats = 1;

    for (const m of block.mCodes) {
      if (m === "M03" || m === "M04") {
        state.spindleState = m;
      } else if (m === "M05") {
        state.spindleState = "M05";
      } else if (m === "M06") {
        state.toolChanges.push(state.toolNumber);
      } else if (m === "M02" || m === "M30") {
        state.spindleState = "M05";
        endProgram = true;
      } else if (m === "M99") {
        returnSub = true;
      } else if (m === "M98") {
        const p = wordMap.get("P");
        if (p !== undefined) {
          subCallTarget = Math.round(p);
          subCallRepeats = Math.max(1, Math.round(wordMap.get("L") ?? 1));
        }
      }
    }

    const scale = state.unitMode === "G20" ? INCH_TO_MM : 1.0;
    const offset = workOffsets[state.workOffset] ?? { x: 0, y: 0, z: 0 };

    // Handle G04 dwell
    if (isDwell) {
      const dwellSec = Math.max(0, wordMap.get("P") ?? wordMap.get("X") ?? 0);
      if (dwellSec > 0) {
        state.segments.push({
          kind: "dwell",
          start: clonePt(state.pos),
          end: clonePt(state.pos),
          feedrateMmPerMin: 0,
          spindleRpm: state.spindleRpm,
          lengthMm: 0,
          durationSec: dwellSec,
          blockLine: block.line,
          gCode: "G04",
          toolNumber: state.toolNumber,
        });
      }
      if (endProgram) return true;
      if (returnSub) return false;
      continue;
    }

    // Handle G28 home return
    if (isHomeReturn) {
      const target = clonePt(state.pos);
      if (wordMap.has("X")) target.x = 0;
      if (wordMap.has("Y")) target.y = 0;
      if (wordMap.has("Z")) target.z = 0;
      if (!wordMap.has("X") && !wordMap.has("Y") && !wordMap.has("Z")) {
        target.x = 0;
        target.y = 0;
        target.z = 0;
      }
      addLinearSegment(state, "rapid", target, rapidRateMmPerMin, block.line, "G28");
      if (endProgram) return true;
      if (returnSub) return false;
      continue;
    }

    // Compute target coordinates in mm
    const hasX = wordMap.has("X");
    const hasY = wordMap.has("Y");
    const hasZ = wordMap.has("Z");
    const hasAxis = hasX || hasY || hasZ;

    const targetX = hasX
      ? state.distanceMode === "G91"
        ? state.pos.x + (wordMap.get("X") ?? 0) * scale
        : (wordMap.get("X") ?? 0) * scale + offset.x
      : state.pos.x;
    const targetY = hasY
      ? state.distanceMode === "G91"
        ? state.pos.y + (wordMap.get("Y") ?? 0) * scale
        : (wordMap.get("Y") ?? 0) * scale + offset.y
      : state.pos.y;
    const targetZ = hasZ
      ? state.distanceMode === "G91"
        ? state.pos.z + (wordMap.get("Z") ?? 0) * scale
        : (wordMap.get("Z") ?? 0) * scale + offset.z
      : state.pos.z;

    // Handle canned drilling cycles (G81, G82, G83)
    if (CANNED_CYCLES.has(state.motionMode) && (explicitCanned !== undefined || hasX || hasY)) {
      if (wordMap.has("R")) {
        state.cannedR =
          state.distanceMode === "G91"
            ? state.pos.z + (wordMap.get("R") ?? 0) * scale
            : (wordMap.get("R") ?? 0) * scale + offset.z;
      }
      if (hasZ) {
        state.cannedZ = targetZ;
      }
      if (wordMap.has("Q")) {
        state.cannedQ = Math.abs((wordMap.get("Q") ?? 0) * scale);
      }
      if (wordMap.has("P")) {
        state.cannedP = Math.max(0, wordMap.get("P") ?? 0);
      }

      const feedMmMin = Math.max(1e-6, getEffectiveFeedMmPerMin(state));
      const rZ = state.cannedR;
      const bottomZ = state.cannedZ;
      const retractZ = state.retractMode === "G98" ? Math.max(state.cannedInitialZ, rZ) : rZ;
      const repeats = Math.max(1, Math.round(wordMap.get("L") ?? 1));

      for (let rep = 0; rep < repeats; rep++) {
        // 1. Rapid to XY hole location at current Z
        const holeX =
          rep === 0 ? targetX : state.distanceMode === "G91" ? state.pos.x + (wordMap.get("X") ?? 0) * scale : targetX;
        const holeY =
          rep === 0 ? targetY : state.distanceMode === "G91" ? state.pos.y + (wordMap.get("Y") ?? 0) * scale : targetY;
        addLinearSegment(state, "rapid", { x: holeX, y: holeY, z: state.pos.z }, rapidRateMmPerMin, block.line, "G00");

        // 2. Rapid to R-plane
        addLinearSegment(state, "rapid", { x: holeX, y: holeY, z: rZ }, rapidRateMmPerMin, block.line, "G00");

        if (state.motionMode === "G83" && state.cannedQ > 1e-6 && rZ > bottomZ) {
          // Deep-hole peck drilling
          const totalDepth = rZ - bottomZ;
          const q = state.cannedQ;
          let depthCut = 0;
          let peckIdx = 0;
          while (depthCut < totalDepth - 1e-9) {
            const nextDepth = Math.min(totalDepth, depthCut + q);
            if (peckIdx > 0) {
              const entryZ = rZ - Math.max(0, depthCut - peckClearanceMm);
              addLinearSegment(state, "rapid", { x: holeX, y: holeY, z: entryZ }, rapidRateMmPerMin, block.line, "G00");
            }
            const targetPeckZ = rZ - nextDepth;
            addLinearSegment(
              state,
              "drill_plunge",
              { x: holeX, y: holeY, z: targetPeckZ },
              feedMmMin,
              block.line,
              "G83",
            );
            const isFinal = nextDepth >= totalDepth - 1e-9;
            addLinearSegment(
              state,
              "drill_retract",
              { x: holeX, y: holeY, z: isFinal ? retractZ : rZ },
              rapidRateMmPerMin,
              block.line,
              "G83",
            );
            depthCut = nextDepth;
            peckIdx++;
          }
        } else {
          // G81 / G82 / other canned drills
          addLinearSegment(
            state,
            "drill_plunge",
            { x: holeX, y: holeY, z: bottomZ },
            feedMmMin,
            block.line,
            state.motionMode,
          );
          if (state.motionMode === "G82" && state.cannedP > 0) {
            state.segments.push({
              kind: "dwell",
              start: clonePt(state.pos),
              end: clonePt(state.pos),
              feedrateMmPerMin: 0,
              spindleRpm: state.spindleRpm,
              lengthMm: 0,
              durationSec: state.cannedP,
              blockLine: block.line,
              gCode: "G82",
              toolNumber: state.toolNumber,
            });
          }
          addLinearSegment(
            state,
            "drill_retract",
            { x: holeX, y: holeY, z: retractZ },
            rapidRateMmPerMin,
            block.line,
            state.motionMode,
          );
        }

        state.holeCount++;
      }
    } else if (
      (state.motionMode === "G02" || state.motionMode === "G03") &&
      (hasAxis || wordMap.has("I") || wordMap.has("J") || wordMap.has("K") || wordMap.has("R"))
    ) {
      // Circular / Helical Arc Interpolation
      const isCw = state.motionMode === "G02";
      const endPt: Point3D = { x: targetX, y: targetY, z: targetZ };
      const startPt = clonePt(state.pos);

      let u0 = startPt.x;
      let v0 = startPt.y;
      let w0 = startPt.z;
      let u1 = endPt.x;
      let v1 = endPt.y;
      let w1 = endPt.z;
      let du = (wordMap.get("I") ?? 0) * scale;
      let dv = (wordMap.get("J") ?? 0) * scale;

      if (state.plane === "G18") {
        u0 = startPt.z;
        v0 = startPt.x;
        w0 = startPt.y;
        u1 = endPt.z;
        v1 = endPt.x;
        w1 = endPt.y;
        du = (wordMap.get("K") ?? 0) * scale;
        dv = (wordMap.get("I") ?? 0) * scale;
      } else if (state.plane === "G19") {
        u0 = startPt.y;
        v0 = startPt.z;
        w0 = startPt.x;
        u1 = endPt.y;
        v1 = endPt.z;
        w1 = endPt.x;
        du = (wordMap.get("J") ?? 0) * scale;
        dv = (wordMap.get("K") ?? 0) * scale;
      }

      let cu = u0 + du;
      let cv = v0 + dv;
      let radius = Math.hypot(u0 - cu, v0 - cv);

      if (wordMap.has("R") && !wordMap.has("I") && !wordMap.has("J") && !wordMap.has("K")) {
        const rSigned = (wordMap.get("R") ?? 0) * scale;
        const rAbs = Math.abs(rSigned);
        const chord = Math.hypot(u1 - u0, v1 - v0);
        if (chord > 1e-9 && rAbs >= chord / 2 - 1e-6) {
          const h = Math.sqrt(Math.max(0, rAbs * rAbs - (chord * chord) / 4));
          const mu = (u0 + u1) / 2;
          const mv = (v0 + v1) / 2;
          const nx = -(v1 - v0) / chord;
          const ny = (u1 - u0) / chord;
          // CCW + positive R => center on left (+h); CW + positive R => center on right (-h)
          const leftSide = (!isCw && rSigned > 0) || (isCw && rSigned < 0);
          const sign = leftSide ? 1 : -1;
          cu = mu + sign * h * nx;
          cv = mv + sign * h * ny;
          radius = rAbs;
        }
      }

      const a0 = Math.atan2(v0 - cv, u0 - cu);
      const a1 = Math.atan2(v1 - cv, u1 - cu);
      let sweep = isCw ? a0 - a1 : a1 - a0;
      // Full circle or wrap-around normalization
      if (sweep <= 1e-9) sweep += TWO_PI;
      if (sweep > TWO_PI + 1e-9) sweep -= TWO_PI;

      const arcLen2D = radius * sweep;
      const dw = w1 - w0;
      const lengthMm = Math.hypot(arcLen2D, dw);
      const feedMmMin = Math.max(1e-6, getEffectiveFeedMmPerMin(state));
      const durationSec = (lengthMm / feedMmMin) * 60.0;

      let center: Point3D = { x: cu, y: cv, z: startPt.z };
      if (state.plane === "G18") center = { x: cv, y: startPt.y, z: cu };
      else if (state.plane === "G19") center = { x: startPt.x, y: cu, z: cv };

      if (lengthMm > 1e-12) {
        state.segments.push({
          kind: isCw ? "arc_cw" : "arc_ccw",
          start: startPt,
          end: endPt,
          center,
          radiusMm: radius,
          sweepAngleRad: sweep,
          plane: state.plane,
          feedrateMmPerMin: feedMmMin,
          spindleRpm: state.spindleRpm,
          lengthMm,
          durationSec,
          blockLine: block.line,
          gCode: state.motionMode,
          toolNumber: state.toolNumber,
        });
      }
      state.pos = endPt;
    } else if (hasAxis && (state.motionMode === "G00" || state.motionMode === "G01")) {
      const target: Point3D = { x: targetX, y: targetY, z: targetZ };
      if (state.motionMode === "G00") {
        addLinearSegment(state, "rapid", target, rapidRateMmPerMin, block.line, "G00");
      } else {
        const feedMmMin = Math.max(1e-6, getEffectiveFeedMmPerMin(state));
        addLinearSegment(state, "linear", target, feedMmMin, block.line, "G01");
      }
    }

    // Execute subprogram call M98 Pxxxx Lnn
    if (subCallTarget !== undefined && depth < maxSubDepth) {
      const sub = program.subprograms.get(subCallTarget);
      if (sub) {
        for (let r = 0; r < subCallRepeats; r++) {
          const stopped = executeBlocks(
            sub.blocks,
            program,
            state,
            rapidRateMmPerMin,
            peckClearanceMm,
            workOffsets,
            maxSubDepth,
            depth + 1,
          );
          if (stopped) return true;
        }
      }
    }

    if (endProgram) return true;
    if (returnSub) return false;
  }
  return false;
}

/**
 * Simulates the modal CNC state machine on a G-code program and produces a complete 3D toolpath summary.
 */
export function simulateToolpath(input: GCodeProgram | string, options: ToolpathOptions = {}): ToolpathSummary {
  const program = typeof input === "string" ? parseGCode(input) : input;
  const rapidRateMmPerMin = options.rapidRateMmPerMin ?? 10000.0;
  const peckClearanceMm = options.peckClearanceMm ?? 0.5;
  const maxSubDepth = options.maxSubprogramDepth ?? 16;
  const workOffsets = options.workOffsets ?? {};

  const state: MachineState = {
    pos: { x: 0, y: 0, z: 0 },
    motionMode: "G00",
    plane: "G17",
    distanceMode: "G90",
    unitMode: options.defaultUnits ?? "G21",
    feedMode: "G94",
    retractMode: "G98",
    workOffset: "G54",
    spindleState: "M05",
    spindleRpm: 0,
    feedrateRaw: 0,
    toolNumber: 1,
    cannedR: 0,
    cannedZ: 0,
    cannedQ: 0,
    cannedP: 0,
    cannedInitialZ: 0,
    segments: [],
    toolChanges: [],
    spindleRpmMax: 0,
    feedrateMaxMmPerMin: 0,
    holeCount: 0,
  };

  executeBlocks(program.blocks, program, state, rapidRateMmPerMin, peckClearanceMm, workOffsets, maxSubDepth, 0);

  const boundingBox: BoundingBox3D =
    state.segments.length > 0
      ? {
          minX: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
          minZ: Number.POSITIVE_INFINITY,
          maxZ: Number.NEGATIVE_INFINITY,
        }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  let rapidLengthMm = 0;
  let cuttingLengthMm = 0;
  let rapidTimeSec = 0;
  let cuttingTimeSec = 0;
  let dwellTimeSec = 0;

  for (const seg of state.segments) {
    if (seg.kind === "arc_cw" || seg.kind === "arc_ccw") {
      expandBoxForArc(boundingBox, seg);
    } else {
      expandBox(boundingBox, seg.start);
      expandBox(boundingBox, seg.end);
    }

    if (seg.kind === "rapid" || seg.kind === "drill_retract") {
      rapidLengthMm += seg.lengthMm;
      rapidTimeSec += seg.durationSec;
    } else if (seg.kind === "dwell") {
      dwellTimeSec += seg.durationSec;
    } else {
      cuttingLengthMm += seg.lengthMm;
      cuttingTimeSec += seg.durationSec;
    }
  }

  return {
    programName: program.name,
    segments: state.segments,
    boundingBox,
    rapidLengthMm,
    cuttingLengthMm,
    totalLengthMm: rapidLengthMm + cuttingLengthMm,
    rapidTimeSec,
    cuttingTimeSec,
    dwellTimeSec,
    totalCycleTimeSec: rapidTimeSec + cuttingTimeSec + dwellTimeSec,
    unitMode: state.unitMode,
    finalPosition: clonePt(state.pos),
    toolChanges: state.toolChanges,
    spindleRpmMax: state.spindleRpmMax,
    feedrateMaxMmPerMin: state.feedrateMaxMmPerMin,
    holeCount: state.holeCount,
  };
}
