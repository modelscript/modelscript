// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CAD Lowering for `@modelscript/apt`.
 *
 * Converts a solved `ClDataProgram` toolpath into a `@modelscript/cad` CSG `Assembly`
 * representing the swept milling cutter volume (oriented slot prisms + cylindrical
 * end-caps along linear and circular arc segments).
 */

import {
  assembly,
  box,
  computeSolidAABB,
  cylinder,
  part,
  rotate,
  translate,
  type AABB,
  type Assembly,
  type PartEntry,
  type Solid,
} from "@modelscript/cad";
import type { AptProgram, ClDataProgram } from "../types.js";
import { solveAptToClData } from "./geometry-solver.js";

export interface AptCadLoweringOptions {
  /** Axial cut depth (flute height) in program units (default: 0.5 for INCHES, 10.0 for MM). */
  axialDepth?: number | undefined;
  /** Number of chords per 90 degrees when discretizing circular arcs (default: 8). */
  arcSubdivisionsPerQuadrant?: number | undefined;
}

export interface AptCadLoweringResult {
  assembly: Assembly;
  clData: ClDataProgram;
  sweptSegmentCount: number;
  estimatedRemovedVolume: number;
  bounds: AABB;
}

function makeSweptSegmentParts(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  radius: number,
  depth: number,
  namePrefix: string,
): PartEntry[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const parts: PartEntry[] = [];

  if (len > 1e-9) {
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const slotBox = translate(
      rotate(box({ width: len, height: 2 * radius, depth, name: `${namePrefix}_slot` }), [0, 0, 1], angleDeg),
      [mx, my, z0],
    );
    parts.push(part(slotBox));
  }

  const endCap = translate(rotate(cylinder({ radius, height: depth, name: `${namePrefix}_cap` }), [1, 0, 0], 90), [
    x1,
    y1,
    z0,
  ]);
  parts.push(part(endCap));

  return parts;
}

/**
 * Lowers a `ClDataProgram` (or raw `AptProgram`) into a `@modelscript/cad` swept-toolpath `Assembly`.
 */
export function lowerAptToCad(
  input: AptProgram | ClDataProgram,
  options?: AptCadLoweringOptions,
): AptCadLoweringResult {
  const clData: ClDataProgram = "records" in input ? input : solveAptToClData(input);
  const radius = clData.cutterRadius > 0 ? clData.cutterRadius : clData.units === "MM" ? 5.0 : 0.25;
  const depth = options?.axialDepth ?? (clData.units === "MM" ? 10.0 : 0.5);
  const subPerQuad = Math.max(2, options?.arcSubdivisionsPerQuadrant ?? 8);

  const parts: PartEntry[] = [];
  let segIdx = 0;

  for (const rec of clData.records) {
    if (
      rec.kind === "LINEAR" &&
      rec.x0 !== undefined &&
      rec.y0 !== undefined &&
      rec.x !== undefined &&
      rec.y !== undefined
    ) {
      const z0 = rec.z0 ?? 0;
      const segParts = makeSweptSegmentParts(rec.x0, rec.y0, z0, rec.x, rec.y, radius, depth, `cut_lin_${segIdx}`);
      parts.push(...segParts);
      segIdx++;
    } else if (
      (rec.kind === "ARC_CW" || rec.kind === "ARC_CCW") &&
      rec.cx !== undefined &&
      rec.cy !== undefined &&
      rec.radius !== undefined &&
      rec.startAngle !== undefined &&
      rec.sweepAngle !== undefined
    ) {
      const z0 = rec.z0 ?? 0;
      const steps = Math.max(2, Math.ceil((Math.abs(rec.sweepAngle) / (Math.PI / 2)) * subPerQuad));
      let px = rec.cx + rec.radius * Math.cos(rec.startAngle);
      let py = rec.cy + rec.radius * Math.sin(rec.startAngle);
      for (let i = 1; i <= steps; i++) {
        const ang = rec.startAngle + (rec.sweepAngle * i) / steps;
        const nx = rec.cx + rec.radius * Math.cos(ang);
        const ny = rec.cy + rec.radius * Math.sin(ang);
        const segParts = makeSweptSegmentParts(px, py, z0, nx, ny, radius, depth, `cut_arc_${segIdx}_${i}`);
        parts.push(...segParts);
        px = nx;
        py = ny;
      }
      segIdx++;
    }
  }

  // Fallback tool marker if no cutting moves exist yet
  if (parts.length === 0) {
    const marker: Solid = rotate(cylinder({ radius, height: depth, name: "tool_home" }), [1, 0, 0], 90);
    parts.push(part(marker));
  }

  const asm = assembly(clData.partno || "APT_TOOLPATH", parts);

  // Aggregate AABB across all parts
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of parts) {
    const bb = computeSolidAABB(p.solid);
    if (bb.min[0] < minX) minX = bb.min[0];
    if (bb.min[1] < minY) minY = bb.min[1];
    if (bb.min[2] < minZ) minZ = bb.min[2];
    if (bb.max[0] > maxX) maxX = bb.max[0];
    if (bb.max[1] > maxY) maxY = bb.max[1];
    if (bb.max[2] > maxZ) maxZ = bb.max[2];
  }

  const estimatedRemovedVolume = clData.totalCuttingLength * (2 * radius) * depth;

  return {
    assembly: asm,
    clData,
    sweptSegmentCount: segIdx,
    estimatedRemovedVolume,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  };
}
