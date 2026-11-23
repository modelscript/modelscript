// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Swept-Volume 3D CAD Geometry Builder using `@modelscript/cad`.
 *
 * Converts CNC cutting & drilling toolpath segments into parametric 3D CAD solids
 * (swept cylindrical/box capsules + optional stock block subtraction).
 */

import {
  assembly,
  box,
  cylinder,
  part,
  rotate,
  sphere,
  subtract,
  translate,
  union,
  type Assembly,
  type Solid,
} from "@modelscript/cad";
import type { Point3D, ToolpathSegment, ToolpathSummary } from "../types.js";

export interface SweptVolumeOptions {
  /** Cutter diameter in mm (default: 6.0). */
  toolDiameterMm?: number | undefined;
  /** Number of chords per 90-degree arc sweep when tessellating arcs (default: 8). */
  arcSubdivisionsPerQuarter?: number | undefined;
  /** Optional workpiece stock block dimensions (if provided, computes machined stock = stock - sweptVolume). */
  stock?:
    | {
        sizeX: number;
        sizeY: number;
        sizeZ: number;
        originX?: number | undefined;
        originY?: number | undefined;
        originZ?: number | undefined;
      }
    | undefined;
}

export interface ToolpathCadResult {
  assembly: Assembly;
  solids: Solid[];
  sweptSolid?: Solid | undefined;
  machinedStock?: Solid | undefined;
  estimatedSweptVolumeMm3: number;
}

function sampleArcPoints(seg: ToolpathSegment, subdivisionsPerQuarter: number): Point3D[] {
  if (!seg.center || !seg.radiusMm || !seg.sweepAngleRad) {
    return [seg.start, seg.end];
  }
  const steps = Math.max(2, Math.ceil((seg.sweepAngleRad / (Math.PI / 2)) * subdivisionsPerQuarter));
  const isCw = seg.kind === "arc_cw";
  const plane = seg.plane ?? "G17";
  const pts: Point3D[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (plane === "G17") {
      const a0 = Math.atan2(seg.start.y - seg.center.y, seg.start.x - seg.center.x);
      const a = isCw ? a0 - t * seg.sweepAngleRad : a0 + t * seg.sweepAngleRad;
      pts.push({
        x: seg.center.x + seg.radiusMm * Math.cos(a),
        y: seg.center.y + seg.radiusMm * Math.sin(a),
        z: seg.start.z + t * (seg.end.z - seg.start.z),
      });
    } else if (plane === "G18") {
      const a0 = Math.atan2(seg.start.x - seg.center.x, seg.start.z - seg.center.z);
      const a = isCw ? a0 - t * seg.sweepAngleRad : a0 + t * seg.sweepAngleRad;
      pts.push({
        x: seg.center.x + seg.radiusMm * Math.sin(a),
        y: seg.start.y + t * (seg.end.y - seg.start.y),
        z: seg.center.z + seg.radiusMm * Math.cos(a),
      });
    } else {
      const a0 = Math.atan2(seg.start.z - seg.center.z, seg.start.y - seg.center.y);
      const a = isCw ? a0 - t * seg.sweepAngleRad : a0 + t * seg.sweepAngleRad;
      pts.push({
        x: seg.start.x + t * (seg.end.x - seg.start.x),
        y: seg.center.y + seg.radiusMm * Math.cos(a),
        z: seg.center.z + seg.radiusMm * Math.sin(a),
      });
    }
  }
  return pts;
}

function buildCapsuleSolid(a: Point3D, b: Point3D, radius: number): Solid {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len <= 1e-6) {
    return translate(sphere({ radius }), [a.x, a.y, a.z]);
  }

  // Build cylinder along +Z of height `len`, rotate to align with (dx, dy, dz), and translate to `a`
  const cyl = cylinder({ radius, height: len });
  const pitchRad = Math.acos(Math.max(-1, Math.min(1, dz / len)));
  const yawRad = Math.atan2(dy, dx);
  const pitchDeg = (pitchRad * 180) / Math.PI;
  const yawDeg = (yawRad * 180) / Math.PI;

  const oriented = Math.abs(pitchDeg) > 1e-5 ? rotate(rotate(cyl, [0, 1, 0], pitchDeg), [0, 0, 1], yawDeg) : cyl;

  return translate(oriented, [a.x, a.y, a.z]);
}

/**
 * Generates `@modelscript/cad` 3D swept-volume solids and an assembly from a simulated toolpath.
 */
export function toolpathToCad(summary: ToolpathSummary, options: SweptVolumeOptions = {}): ToolpathCadResult {
  const diameter = Math.max(0.1, options.toolDiameterMm ?? 6.0);
  const radius = diameter / 2.0;
  const arcSub = options.arcSubdivisionsPerQuarter ?? 8;

  const solids: Solid[] = [];
  let estimatedSweptVolumeMm3 = 0;

  for (const seg of summary.segments) {
    if (seg.kind === "rapid" || seg.kind === "drill_retract" || seg.kind === "dwell") {
      continue;
    }

    if (seg.kind === "arc_cw" || seg.kind === "arc_ccw") {
      const pts = sampleArcPoints(seg, arcSub);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i]!;
        const p1 = pts[i + 1]!;
        solids.push(buildCapsuleSolid(p0, p1, radius));
      }
      estimatedSweptVolumeMm3 += Math.PI * radius * radius * seg.lengthMm;
    } else {
      solids.push(buildCapsuleSolid(seg.start, seg.end, radius));
      estimatedSweptVolumeMm3 += Math.PI * radius * radius * seg.lengthMm;
    }
  }

  const sweptSolid =
    solids.length === 1 ? solids[0] : solids.length > 1 ? union(solids[0]!, solids[1]!, ...solids.slice(2)) : undefined;

  let machinedStock: Solid | undefined;
  const parts = [];

  if (options.stock) {
    const { sizeX, sizeY, sizeZ, originX = 0, originY = 0, originZ = -sizeZ } = options.stock;
    const rawStock = translate(box({ width: sizeX, depth: sizeY, height: sizeZ }), [
      originX + sizeX / 2,
      originY + sizeY / 2,
      originZ + sizeZ / 2,
    ]);
    machinedStock = sweptSolid ? subtract(rawStock, sweptSolid) : rawStock;
    parts.push(part(machinedStock, { material: "Aluminum" }));
  }

  if (sweptSolid) {
    parts.push(part(sweptSolid, { material: "CarbideSweptVolume" }));
  }

  const asm = assembly(`${summary.programName}_cad`, parts);

  return {
    assembly: asm,
    solids,
    sweptSolid,
    machinedStock,
    estimatedSweptVolumeMm3,
  };
}
