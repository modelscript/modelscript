// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Exact 2D CAD Geometry Lowering & 3D Copper Solid Extrusion for Gerber RS-274-D & RS-274X.
 */

import { box, cylinder, linearExtrude, rotate, translate, type Solid } from "@modelscript/cad";
import type {
  GerberApertureDef,
  GerberBoundingBox,
  GerberDocument,
  GerberFilledRegion,
  GerberFlashPad,
  GerberGeometry,
  GerberPoint,
  GerberQuadrantMode,
  GerberRegionSegment,
  GerberStrokeSegment,
  GerberUnit,
} from "../types.js";

export const MM_PER_INCH = 25.4;

/** Converts a value in native Gerber file units (`IN` or `MM`) to millimeters. */
export function unitToMm(value: number, unit: GerberUnit): number {
  return unit === "IN" ? value * MM_PER_INCH : value;
}

export interface ResolvedArc {
  center: GerberPoint;
  radius: number;
  startAngleRad: number;
  endAngleRad: number;
  sweepAngleRad: number;
  lengthMm: number;
  rStart: number;
  rEnd: number;
}

function normalizeAnglePositive(rad: number): number {
  const twoPi = 2 * Math.PI;
  let a = rad % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/**
 * Resolves a Gerber circular arc (`G02` CW or `G03` CCW) in either single-quadrant (`G74`)
 * or multi-quadrant (`G75`) mode.
 */
export function resolveGerberArc(
  start: GerberPoint,
  end: GerberPoint,
  iOffset: number,
  jOffset: number,
  clockwise: boolean,
  quadrantMode: GerberQuadrantMode,
): ResolvedArc {
  const twoPi = 2 * Math.PI;

  const evalCandidate = (cx: number, cy: number): ResolvedArc => {
    const rStart = Math.hypot(start.x - cx, start.y - cy);
    const rEnd = Math.hypot(end.x - cx, end.y - cy);
    const radius = 0.5 * (rStart + rEnd);
    const startAngleRad = Math.atan2(start.y - cy, start.x - cx);
    const endAngleRad = Math.atan2(end.y - cy, end.x - cx);

    let sweep: number;
    const samePoint = Math.hypot(end.x - start.x, end.y - start.y) < 1e-9;
    if (samePoint) {
      sweep = quadrantMode === "MULTI" ? twoPi : 0;
    } else if (clockwise) {
      sweep = normalizeAnglePositive(startAngleRad - endAngleRad);
      if (sweep < 1e-12) sweep = twoPi;
    } else {
      sweep = normalizeAnglePositive(endAngleRad - startAngleRad);
      if (sweep < 1e-12) sweep = twoPi;
    }

    return {
      center: { x: cx, y: cy },
      radius,
      startAngleRad,
      endAngleRad,
      sweepAngleRad: sweep,
      lengthMm: radius * sweep,
      rStart,
      rEnd,
    };
  };

  if (quadrantMode === "MULTI") {
    return evalCandidate(start.x + iOffset, start.y + jOffset);
  }

  // Single-quadrant mode (G74): I and J are unsigned magnitudes; pick center with matching radius and sweep <= pi/2
  const absI = Math.abs(iOffset);
  const absJ = Math.abs(jOffset);
  const candidates: ResolvedArc[] = [
    evalCandidate(start.x + absI, start.y + absJ),
    evalCandidate(start.x + absI, start.y - absJ),
    evalCandidate(start.x - absI, start.y + absJ),
    evalCandidate(start.x - absI, start.y - absJ),
  ];

  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const radErr = Math.abs(c.rStart - c.rEnd);
    const quadPenalty = c.sweepAngleRad > Math.PI / 2 + 1e-5 ? 1e6 + c.sweepAngleRad : 0;
    const score = radErr + quadPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Computes exact copper area (mm^2) of a standard Gerber aperture flash.
 */
export function computeApertureAreaMm2(ap: GerberApertureDef, unit: GerberUnit): number {
  const w = unitToMm(ap.width, unit);
  const h = unitToMm(ap.height, unit);
  const hole = unitToMm(ap.holeDiameter ?? 0, unit);
  if (w <= 0) return 0;

  const holeArea = hole > 0 ? Math.PI * (0.5 * hole) * (0.5 * hole) : 0;
  let outerArea = 0;

  switch (ap.shape) {
    case "C": {
      const r = 0.5 * w;
      outerArea = Math.PI * r * r;
      break;
    }
    case "R": {
      outerArea = w * (h > 0 ? h : w);
      break;
    }
    case "O": {
      const hh = h > 0 ? h : w;
      const major = Math.max(w, hh);
      const minor = Math.min(w, hh);
      const r = 0.5 * minor;
      outerArea = (major - minor) * minor + Math.PI * r * r;
      break;
    }
    case "P": {
      const r = 0.5 * w;
      const n = Math.max(3, ap.vertices ?? 4);
      outerArea = 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);
      break;
    }
    case "MACRO": {
      const r = 0.5 * w;
      outerArea = Math.PI * r * r;
      break;
    }
  }

  return Math.max(0, outerArea - holeArea);
}

function createEmptyBBox(): { minX: number; minY: number; maxX: number; maxY: number; empty: boolean } {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    empty: true,
  };
}

function expandBBox(
  bb: { minX: number; minY: number; maxX: number; maxY: number; empty: boolean },
  x: number,
  y: number,
  padX: number = 0,
  padY: number = padX,
): void {
  bb.empty = false;
  if (x - padX < bb.minX) bb.minX = x - padX;
  if (x + padX > bb.maxX) bb.maxX = x + padX;
  if (y - padY < bb.minY) bb.minY = y - padY;
  if (y + padY > bb.maxY) bb.maxY = y + padY;
}

function finalizeBBox(bb: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  empty: boolean;
}): GerberBoundingBox {
  if (bb.empty) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  return {
    minX: bb.minX,
    minY: bb.minY,
    maxX: bb.maxX,
    maxY: bb.maxY,
    width: bb.maxX - bb.minX,
    height: bb.maxY - bb.minY,
  };
}

function angleInSweep(angle: number, startAngle: number, sweep: number, clockwise: boolean): boolean {
  if (sweep >= 2 * Math.PI - 1e-9) return true;
  const delta = clockwise ? normalizeAnglePositive(startAngle - angle) : normalizeAnglePositive(angle - startAngle);
  return delta <= sweep + 1e-9;
}

function expandArcBBox(
  bb: { minX: number; minY: number; maxX: number; maxY: number; empty: boolean },
  start: GerberPoint,
  end: GerberPoint,
  center: GerberPoint,
  radius: number,
  startAngle: number,
  sweep: number,
  clockwise: boolean,
  halfWidth: number,
): void {
  expandBBox(bb, start.x, start.y, halfWidth);
  expandBBox(bb, end.x, end.y, halfWidth);
  const cardinals: Array<[number, number, number]> = [
    [0, center.x + radius, center.y],
    [Math.PI / 2, center.x, center.y + radius],
    [Math.PI, center.x - radius, center.y],
    [(3 * Math.PI) / 2, center.x, center.y - radius],
  ];
  for (const [ang, px, py] of cardinals) {
    if (angleInSweep(ang, startAngle, sweep, clockwise)) {
      expandBBox(bb, px, py, halfWidth);
    }
  }
}

/**
 * Computes exact signed area of a closed contour composed of line and circular arc segments
 * using Green's theorem (shoelace formula + exact circular segment area corrections).
 */
function computeContourAreaMm2(segments: GerberRegionSegment[]): number {
  if (segments.length === 0) return 0;
  let signedDoubleArea = 0;
  let arcCorrection = 0;

  for (const seg of segments) {
    signedDoubleArea += seg.start.x * seg.end.y - seg.end.x * seg.start.y;
    if (seg.kind === "ARC" && seg.radius !== undefined && seg.sweepAngleRad !== undefined) {
      const segArea = 0.5 * seg.radius * seg.radius * (seg.sweepAngleRad - Math.sin(seg.sweepAngleRad));
      // CCW arc bulges to the right of chord (adds to CCW positive area); CW arc subtracts
      arcCorrection += seg.clockwise ? -segArea : segArea;
    }
  }

  return Math.abs(0.5 * signedDoubleArea + arcCorrection);
}

/**
 * Lowers a parsed `GerberDocument` into exact 2D copper geometry (`GerberGeometry`) in millimeters.
 */
export function lowerGerberToGeometry(doc: GerberDocument): GerberGeometry {
  const strokes: GerberStrokeSegment[] = [];
  const flashes: GerberFlashPad[] = [];
  const regions: GerberFilledRegion[] = [];
  const bbox = createEmptyBBox();

  let currentPoint: GerberPoint = { x: 0, y: 0 };
  let activeRegionContours: GerberRegionSegment[][] = [];
  let currentContour: GerberRegionSegment[] = [];
  let regionPolarity: "D" | "C" = "D";
  let regionStepRepeat = { xRepeat: 1, yRepeat: 1, xStep: 0, yStep: 0 };
  let regionUnit: GerberUnit = doc.unit ?? "MM";
  let inRegion = false;

  const flushRegion = (): void => {
    if (currentContour.length > 0) {
      activeRegionContours.push(currentContour);
      currentContour = [];
    }
    if (activeRegionContours.length === 0) return;

    const dxStepMm = unitToMm(regionStepRepeat.xStep, regionUnit);
    const dyStepMm = unitToMm(regionStepRepeat.yStep, regionUnit);

    for (let ix = 0; ix < regionStepRepeat.xRepeat; ix++) {
      for (let iy = 0; iy < regionStepRepeat.yRepeat; iy++) {
        const ox = ix * dxStepMm;
        const oy = iy * dyStepMm;
        const regBBox = createEmptyBBox();
        const shiftedContours: GerberRegionSegment[][] = [];
        let totalArea = 0;

        for (const contour of activeRegionContours) {
          const shifted: GerberRegionSegment[] = contour.map((seg) => {
            const s: GerberPoint = { x: seg.start.x + ox, y: seg.start.y + oy };
            const e: GerberPoint = { x: seg.end.x + ox, y: seg.end.y + oy };
            const c: GerberPoint | undefined = seg.center ? { x: seg.center.x + ox, y: seg.center.y + oy } : undefined;
            expandBBox(regBBox, s.x, s.y);
            expandBBox(regBBox, e.x, e.y);
            if (seg.kind === "ARC" && c && seg.radius !== undefined && seg.sweepAngleRad !== undefined) {
              const startAng = Math.atan2(s.y - c.y, s.x - c.x);
              expandArcBBox(regBBox, s, e, c, seg.radius, startAng, seg.sweepAngleRad, Boolean(seg.clockwise), 0);
            }
            return { ...seg, start: s, end: e, center: c };
          });
          shiftedContours.push(shifted);
          totalArea += computeContourAreaMm2(shifted);
        }

        const finalizedRegBBox = finalizeBBox(regBBox);
        if (!regBBox.empty) {
          expandBBox(bbox, finalizedRegBBox.minX, finalizedRegBBox.minY);
          expandBBox(bbox, finalizedRegBBox.maxX, finalizedRegBBox.maxY);
        }

        regions.push({
          contours: shiftedContours,
          areaMm2: totalArea,
          polarity: regionPolarity,
          boundingBox: finalizedRegBBox,
        });
      }
    }

    activeRegionContours = [];
  };

  for (const cmd of doc.commands) {
    if (cmd.kind === "REGION_START") {
      inRegion = true;
      activeRegionContours = [];
      currentContour = [];
      continue;
    }

    if (cmd.kind === "REGION_END") {
      flushRegion();
      inRegion = false;
      continue;
    }

    if (cmd.kind !== "OPERATION") continue;

    const unit = cmd.unit;
    const nextPoint: GerberPoint = {
      x: unitToMm(cmd.x ?? 0, unit),
      y: unitToMm(cmd.y ?? 0, unit),
    };

    if (cmd.op === "MOVE") {
      if (inRegion && currentContour.length > 0) {
        activeRegionContours.push(currentContour);
        currentContour = [];
      }
      currentPoint = nextPoint;
      continue;
    }

    if (cmd.op === "DRAW") {
      if (inRegion) {
        regionPolarity = cmd.polarity;
        regionStepRepeat = cmd.stepRepeat;
        regionUnit = unit;

        if (cmd.interpolation === "LINEAR") {
          currentContour.push({
            kind: "LINE",
            start: { ...currentPoint },
            end: { ...nextPoint },
          });
        } else {
          const iMm = unitToMm(cmd.i ?? 0, unit);
          const jMm = unitToMm(cmd.j ?? 0, unit);
          const clockwise = cmd.interpolation === "CW_ARC";
          const arc = resolveGerberArc(currentPoint, nextPoint, iMm, jMm, clockwise, cmd.quadrantMode);
          currentContour.push({
            kind: "ARC",
            start: { ...currentPoint },
            end: { ...nextPoint },
            center: arc.center,
            radius: arc.radius,
            clockwise,
            sweepAngleRad: arc.sweepAngleRad,
          });
        }
        currentPoint = nextPoint;
        continue;
      }

      const ap = cmd.apertureCode !== null ? doc.apertures.get(cmd.apertureCode) : undefined;
      const widthMm = ap ? unitToMm(ap.width, unit) : 0;
      const halfW = 0.5 * widthMm;
      const dxStepMm = unitToMm(cmd.stepRepeat.xStep, unit);
      const dyStepMm = unitToMm(cmd.stepRepeat.yStep, unit);

      if (cmd.interpolation === "LINEAR") {
        const lengthMm = Math.hypot(nextPoint.x - currentPoint.x, nextPoint.y - currentPoint.y);
        // Exact capsule/stadium area for round-aperture stroke: L * w + pi * (w/2)^2
        const areaMm2 = lengthMm * widthMm + Math.PI * halfW * halfW;

        for (let ix = 0; ix < cmd.stepRepeat.xRepeat; ix++) {
          for (let iy = 0; iy < cmd.stepRepeat.yRepeat; iy++) {
            const ox = ix * dxStepMm;
            const oy = iy * dyStepMm;
            const s: GerberPoint = { x: currentPoint.x + ox, y: currentPoint.y + oy };
            const e: GerberPoint = { x: nextPoint.x + ox, y: nextPoint.y + oy };
            expandBBox(bbox, s.x, s.y, halfW);
            expandBBox(bbox, e.x, e.y, halfW);
            strokes.push({
              kind: "LINE",
              start: s,
              end: e,
              widthMm,
              lengthMm,
              areaMm2,
              polarity: cmd.polarity,
              apertureCode: cmd.apertureCode ?? 0,
            });
          }
        }
      } else {
        const iMm = unitToMm(cmd.i ?? 0, unit);
        const jMm = unitToMm(cmd.j ?? 0, unit);
        const clockwise = cmd.interpolation === "CW_ARC";
        const arc = resolveGerberArc(currentPoint, nextPoint, iMm, jMm, clockwise, cmd.quadrantMode);
        const areaMm2 = arc.lengthMm * widthMm + Math.PI * halfW * halfW;

        for (let ix = 0; ix < cmd.stepRepeat.xRepeat; ix++) {
          for (let iy = 0; iy < cmd.stepRepeat.yRepeat; iy++) {
            const ox = ix * dxStepMm;
            const oy = iy * dyStepMm;
            const s: GerberPoint = { x: currentPoint.x + ox, y: currentPoint.y + oy };
            const e: GerberPoint = { x: nextPoint.x + ox, y: nextPoint.y + oy };
            const c: GerberPoint = { x: arc.center.x + ox, y: arc.center.y + oy };
            expandArcBBox(bbox, s, e, c, arc.radius, arc.startAngleRad, arc.sweepAngleRad, clockwise, halfW);
            strokes.push({
              kind: "ARC",
              start: s,
              end: e,
              center: c,
              radius: arc.radius,
              clockwise,
              startAngleRad: arc.startAngleRad,
              sweepAngleRad: arc.sweepAngleRad,
              widthMm,
              lengthMm: arc.lengthMm,
              areaMm2,
              polarity: cmd.polarity,
              apertureCode: cmd.apertureCode ?? 0,
            });
          }
        }
      }

      currentPoint = nextPoint;
      continue;
    }

    if (cmd.op === "FLASH") {
      const ap = cmd.apertureCode !== null ? doc.apertures.get(cmd.apertureCode) : undefined;
      if (ap) {
        const widthMm = unitToMm(ap.width, unit);
        const heightMm = unitToMm(ap.height, unit);
        const holeDiameterMm = unitToMm(ap.holeDiameter ?? 0, unit);
        const areaMm2 = computeApertureAreaMm2(ap, unit);
        const dxStepMm = unitToMm(cmd.stepRepeat.xStep, unit);
        const dyStepMm = unitToMm(cmd.stepRepeat.yStep, unit);

        for (let ix = 0; ix < cmd.stepRepeat.xRepeat; ix++) {
          for (let iy = 0; iy < cmd.stepRepeat.yRepeat; iy++) {
            const cx = nextPoint.x + ix * dxStepMm;
            const cy = nextPoint.y + iy * dyStepMm;
            expandBBox(bbox, cx, cy, 0.5 * widthMm, 0.5 * heightMm);
            flashes.push({
              center: { x: cx, y: cy },
              apertureCode: ap.dCode,
              shape: ap.shape,
              widthMm,
              heightMm,
              holeDiameterMm,
              vertices: ap.vertices,
              rotationDeg: ap.rotationDeg,
              areaMm2,
              polarity: cmd.polarity,
            });
          }
        }
      }
      currentPoint = nextPoint;
    }
  }

  // If file ended with an unclosed region, flush what was collected
  if (inRegion) {
    flushRegion();
  }

  let copperAreaMm2 = 0;
  let traceLengthMm = 0;
  let arcCount = 0;
  let traceCount = 0;

  for (const s of strokes) {
    const sign = s.polarity === "D" ? 1 : -1;
    copperAreaMm2 += sign * s.areaMm2;
    if (s.polarity === "D") {
      traceLengthMm += s.lengthMm;
    }
    if (s.kind === "ARC") arcCount++;
    else traceCount++;
  }

  for (const f of flashes) {
    const sign = f.polarity === "D" ? 1 : -1;
    copperAreaMm2 += sign * f.areaMm2;
  }

  for (const r of regions) {
    const sign = r.polarity === "D" ? 1 : -1;
    copperAreaMm2 += sign * r.areaMm2;
  }

  return {
    unit: "MM",
    strokes,
    flashes,
    regions,
    boundingBox: finalizeBBox(bbox),
    copperAreaMm2: Math.max(0, copperAreaMm2),
    traceLengthMm,
    padCount: flashes.length,
    traceCount,
    arcCount,
    regionCount: regions.length,
  };
}

export interface GerberCadExtrusionOptions {
  /** Copper foil thickness in mm (default: 0.0348 mm for 1 oz/ft^2 copper). */
  copperThicknessMm?: number | undefined;
  /** Z-offset for the copper layer in mm (default: 0). */
  zOffsetMm?: number | undefined;
}

/**
 * Extrudes lowered 2D Gerber copper geometry into `@modelscript/cad` 3D `Solid[]` primitives.
 */
export function lowerGerberToCadSolids(doc: GerberDocument, options: GerberCadExtrusionOptions = {}): Solid[] {
  const geom = lowerGerberToGeometry(doc);
  const thickness = options.copperThicknessMm ?? 0.0348;
  const zOffset = options.zOffsetMm ?? 0;
  const solids: Solid[] = [];

  for (const flash of geom.flashes) {
    if (flash.polarity === "C") continue;
    if (flash.shape === "R") {
      const s = translate(
        box({
          width: Math.max(1e-4, flash.widthMm),
          height: Math.max(1e-4, flash.heightMm),
          depth: thickness,
        }),
        [flash.center.x, flash.center.y, zOffset + 0.5 * thickness],
      );
      solids.push(s);
    } else {
      const r = Math.max(1e-4, 0.5 * flash.widthMm);
      const s = translate(rotate(cylinder({ radius: r, height: thickness }), [1, 0, 0], 90), [
        flash.center.x,
        flash.center.y,
        zOffset + 0.5 * thickness,
      ]);
      solids.push(s);
    }
  }

  for (const stroke of geom.strokes) {
    if (stroke.polarity === "C" || stroke.widthMm <= 0) continue;
    if (stroke.kind === "LINE" && stroke.lengthMm > 1e-6) {
      const dx = stroke.end.x - stroke.start.x;
      const dy = stroke.end.y - stroke.start.y;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const midX = 0.5 * (stroke.start.x + stroke.end.x);
      const midY = 0.5 * (stroke.start.y + stroke.end.y);
      const traceBox = translate(
        rotate(box({ width: stroke.lengthMm, height: stroke.widthMm, depth: thickness }), [0, 0, 1], angleDeg),
        [midX, midY, zOffset + 0.5 * thickness],
      );
      solids.push(traceBox);
    }
  }

  for (const region of geom.regions) {
    if (region.polarity === "C") continue;
    for (const contour of region.contours) {
      if (contour.length < 3) continue;
      const pts: [number, number][] = contour.map((seg) => [seg.start.x, seg.start.y]);
      const polySolid = translate(linearExtrude(pts, thickness), [0, 0, zOffset]);
      solids.push(polySolid);
    }
  }

  return solids;
}
