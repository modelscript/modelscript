// SPDX-License-Identifier: AGPL-3.0-or-later

import { assembly, box, part, translate, type Assembly, type PartEntry } from "@modelscript/cad";
import { lookupMosisLayerRule } from "../catalog/cif-std-schemas.js";
import type { CifCommand, CifDocument, CifPoint, CifTransform } from "../types.js";

/**
 * 2D affine transformation matrix `[a, b, c, d, tx, ty]`:
 *   x' = a * x + b * y + tx
 *   y' = c * x + d * y + ty
 */
export type Mat2D = readonly [number, number, number, number, number, number];

export const MAT2D_IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export function mat2Multiply(m2: Mat2D, m1: Mat2D): Mat2D {
  return [
    m2[0] * m1[0] + m2[1] * m1[2],
    m2[0] * m1[1] + m2[1] * m1[3],
    m2[2] * m1[0] + m2[3] * m1[2],
    m2[2] * m1[1] + m2[3] * m1[3],
    m2[0] * m1[4] + m2[1] * m1[5] + m2[4],
    m2[2] * m1[4] + m2[3] * m1[5] + m2[5],
  ];
}

export function mat2Scale(s: number): Mat2D {
  return [s, 0, 0, s, 0, 0];
}

export function mat2FromCifTransform(t: CifTransform): Mat2D {
  switch (t.kind) {
    case "T":
      return [1, 0, 0, 1, t.x, t.y];
    case "MX":
      return [-1, 0, 0, 1, 0, 0];
    case "MY":
      return [1, 0, 0, -1, 0, 0];
    case "R": {
      const r = Math.hypot(t.x, t.y);
      if (r === 0) return MAT2D_IDENTITY;
      const cos = t.x / r;
      const sin = t.y / r;
      return [cos, -sin, sin, cos, 0, 0];
    }
  }
}

export function mat2ComposeTransforms(transforms: CifTransform[]): Mat2D {
  let m: Mat2D = MAT2D_IDENTITY;
  for (const t of transforms) {
    m = mat2Multiply(mat2FromCifTransform(t), m);
  }
  return m;
}

export function mat2Apply(m: Mat2D, p: CifPoint): CifPoint {
  return {
    x: m[0] * p.x + m[1] * p.y + m[4],
    y: m[2] * p.x + m[3] * p.y + m[5],
  };
}

export function mat2LinearScale(m: Mat2D): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export interface BBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface FlatPolygon {
  layer: string;
  points: CifPoint[];
  sourceKind: "B" | "P" | "R" | "W";
  /** Polygon area in CIF units² (centimicrons²). */
  area: number;
  /** Polygon perimeter in CIF units (centimicrons). */
  perimeter: number;
  /** Minimum feature width in CIF units (for DRC width verification). */
  minDimension: number;
  bbox: BBox2D;
}

export interface DrcViolation {
  layer: string;
  sourceKind: "B" | "P" | "R" | "W";
  actualWidthCif: number;
  requiredWidthCif: number;
  minWidthLambda: number;
  bbox: BBox2D;
}

export interface FlattenedCifLayout {
  polygons: FlatPolygon[];
  bbox: BBox2D;
  /** Total area per layer in CIF units² (centimicrons²). */
  layerAreas: Record<string, number>;
  /** Total area per layer in µm² (1 µm = 100 CIF units, 1 µm² = 10,000 CIF units²). */
  layerAreasUm2: Record<string, number>;
  /** Total perimeter per layer in CIF units. */
  layerPerimeters: Record<string, number>;
  /** Total perimeter per layer in µm. */
  layerPerimetersUm: Record<string, number>;
  /** Polygons grouped by layer name. */
  layerPolygons: Record<string, FlatPolygon[]>;
  /** Minimum-width DRC violations detected on flattened features. */
  drcViolations: DrcViolation[];
}

export interface CifFlattenOptions {
  /** Number of polygon segments used to tessellate Roundflash (`R`) circles (default: 64). */
  roundflashSegments?: number;
  /** Value of 1 Mead-Conway lambda (λ) in CIF units (default: 100 = 1.0 µm). */
  lambdaCifUnits?: number;
  /** Optional root symbol ID to flatten instead of top-level commands. */
  rootSymbolId?: number;
  /** Maximum call hierarchy depth to prevent infinite recursion on cyclic inputs (default: 64). */
  maxDepth?: number;
}

export function polygonArea(points: CifPoint[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) * 0.5;
}

export function polygonPerimeter(points: CifPoint[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    sum += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  return sum;
}

export function computePointsBBox(points: CifPoint[]): BBox2D {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function mergeBBoxes(boxes: BBox2D[]): BBox2D {
  if (boxes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function makeFlatPolygon(
  layer: string,
  points: CifPoint[],
  sourceKind: "B" | "P" | "R" | "W",
  minDimension: number,
): FlatPolygon {
  return {
    layer,
    points,
    sourceKind,
    area: polygonArea(points),
    perimeter: polygonPerimeter(points),
    minDimension,
    bbox: computePointsBBox(points),
  };
}

function expandCommandList(
  commands: CifCommand[],
  doc: CifDocument,
  transform: Mat2D,
  roundflashSegments: number,
  maxDepth: number,
  depth: number,
  activeCallStack: Set<number>,
  out: FlatPolygon[],
): void {
  if (depth > maxDepth) return;

  let currentLayer = "DEFAULT";
  const linearScale = mat2LinearScale(transform);

  for (const cmd of commands) {
    if (cmd.kind === "L") {
      currentLayer = cmd.layer;
      continue;
    }

    if (cmd.kind === "B") {
      if (cmd.length <= 0 || cmd.width <= 0) continue;
      let ux = 1;
      let uy = 0;
      if (cmd.direction) {
        const r = Math.hypot(cmd.direction.x, cmd.direction.y);
        if (r > 0) {
          ux = cmd.direction.x / r;
          uy = cmd.direction.y / r;
        }
      }
      const vx = -uy;
      const vy = ux;
      const hl = cmd.length * 0.5;
      const hw = cmd.width * 0.5;
      const cx = cmd.center.x;
      const cy = cmd.center.y;

      const localCorners: CifPoint[] = [
        { x: cx - hl * ux - hw * vx, y: cy - hl * uy - hw * vy },
        { x: cx + hl * ux - hw * vx, y: cy + hl * uy - hw * vy },
        { x: cx + hl * ux + hw * vx, y: cy + hl * uy + hw * vy },
        { x: cx - hl * ux + hw * vx, y: cy - hl * uy + hw * vy },
      ];
      const worldCorners = localCorners.map((p) => mat2Apply(transform, p));
      out.push(makeFlatPolygon(currentLayer, worldCorners, "B", Math.min(cmd.length, cmd.width) * linearScale));
      continue;
    }

    if (cmd.kind === "P") {
      if (cmd.points.length < 3) continue;
      const worldPoints = cmd.points.map((p) => mat2Apply(transform, p));
      const bbox = computePointsBBox(worldPoints);
      out.push(makeFlatPolygon(currentLayer, worldPoints, "P", Math.min(bbox.width, bbox.height)));
      continue;
    }

    if (cmd.kind === "R") {
      if (cmd.diameter <= 0) continue;
      const radius = cmd.diameter * 0.5;
      const worldPoints: CifPoint[] = [];
      for (let i = 0; i < roundflashSegments; i++) {
        const theta = (2 * Math.PI * i) / roundflashSegments;
        const lp: CifPoint = {
          x: cmd.center.x + radius * Math.cos(theta),
          y: cmd.center.y + radius * Math.sin(theta),
        };
        worldPoints.push(mat2Apply(transform, lp));
      }
      out.push(makeFlatPolygon(currentLayer, worldPoints, "R", cmd.diameter * linearScale));
      continue;
    }

    if (cmd.kind === "W") {
      if (cmd.width <= 0 || cmd.points.length < 2) continue;
      const hw = cmd.width * 0.5;
      for (let i = 0; i < cmd.points.length - 1; i++) {
        const p1 = cmd.points[i]!;
        const p2 = cmd.points[i + 1]!;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen === 0) continue;
        const ux = dx / segLen;
        const uy = dy / segLen;
        const nx = -uy * hw;
        const ny = ux * hw;
        const localQuad: CifPoint[] = [
          { x: p1.x - nx, y: p1.y - ny },
          { x: p2.x - nx, y: p2.y - ny },
          { x: p2.x + nx, y: p2.y + ny },
          { x: p1.x + nx, y: p1.y + ny },
        ];
        const worldQuad = localQuad.map((p) => mat2Apply(transform, p));
        out.push(makeFlatPolygon(currentLayer, worldQuad, "W", cmd.width * linearScale));
      }
      continue;
    }

    if (cmd.kind === "C") {
      const targetSym = doc.symbols.get(cmd.symbolId);
      if (!targetSym || activeCallStack.has(cmd.symbolId)) continue;
      const scaleFactor = targetSym.scaleA > 0 && targetSym.scaleB > 0 ? targetSym.scaleA / targetSym.scaleB : 1;
      const callMat = mat2ComposeTransforms(cmd.transforms);
      const childMat = mat2Multiply(transform, mat2Multiply(callMat, mat2Scale(scaleFactor)));
      activeCallStack.add(cmd.symbolId);
      expandCommandList(
        targetSym.commands,
        doc,
        childMat,
        roundflashSegments,
        maxDepth,
        depth + 1,
        activeCallStack,
        out,
      );
      activeCallStack.delete(cmd.symbolId);
    }
  }
}

/**
 * Flattens a hierarchical CIF 2.0 document into world-space 2D polygons, bounding boxes,
 * per-layer areas/perimeters, and MOSIS SCMOS minimum-width DRC violations.
 */
export function flattenCifLayout(doc: CifDocument, options?: CifFlattenOptions): FlattenedCifLayout {
  const roundflashSegments = options?.roundflashSegments ?? 64;
  const lambdaCifUnits = options?.lambdaCifUnits ?? 100;
  const maxDepth = options?.maxDepth ?? 64;
  const polygons: FlatPolygon[] = [];
  const activeCallStack = new Set<number>();

  if (options?.rootSymbolId !== undefined) {
    const sym = doc.symbols.get(options.rootSymbolId);
    if (sym) {
      const scaleFactor = sym.scaleA > 0 && sym.scaleB > 0 ? sym.scaleA / sym.scaleB : 1;
      activeCallStack.add(sym.id);
      expandCommandList(
        sym.commands,
        doc,
        mat2Scale(scaleFactor),
        roundflashSegments,
        maxDepth,
        0,
        activeCallStack,
        polygons,
      );
      activeCallStack.delete(sym.id);
    }
  } else {
    expandCommandList(
      doc.topLevelCommands,
      doc,
      MAT2D_IDENTITY,
      roundflashSegments,
      maxDepth,
      0,
      activeCallStack,
      polygons,
    );
  }

  const layerAreas: Record<string, number> = {};
  const layerAreasUm2: Record<string, number> = {};
  const layerPerimeters: Record<string, number> = {};
  const layerPerimetersUm: Record<string, number> = {};
  const layerPolygons: Record<string, FlatPolygon[]> = {};
  const drcViolations: DrcViolation[] = [];

  for (const poly of polygons) {
    layerAreas[poly.layer] = (layerAreas[poly.layer] ?? 0) + poly.area;
    layerPerimeters[poly.layer] = (layerPerimeters[poly.layer] ?? 0) + poly.perimeter;
    if (!layerPolygons[poly.layer]) {
      layerPolygons[poly.layer] = [];
    }
    layerPolygons[poly.layer]!.push(poly);

    const rule = lookupMosisLayerRule(poly.layer);
    if (rule) {
      const requiredWidthCif = rule.minWidthLambda * lambdaCifUnits;
      if (poly.minDimension + 1e-9 < requiredWidthCif) {
        drcViolations.push({
          layer: poly.layer,
          sourceKind: poly.sourceKind,
          actualWidthCif: poly.minDimension,
          requiredWidthCif,
          minWidthLambda: rule.minWidthLambda,
          bbox: poly.bbox,
        });
      }
    }
  }

  for (const [layer, areaCif2] of Object.entries(layerAreas)) {
    // 1 µm = 100 CIF units => 1 µm² = 10,000 CIF units²
    layerAreasUm2[layer] = areaCif2 / 10_000;
  }
  for (const [layer, perimCif] of Object.entries(layerPerimeters)) {
    layerPerimetersUm[layer] = perimCif / 100;
  }

  const bbox = mergeBBoxes(polygons.map((p) => p.bbox));

  return {
    polygons,
    bbox,
    layerAreas,
    layerAreasUm2,
    layerPerimeters,
    layerPerimetersUm,
    layerPolygons,
    drcViolations,
  };
}

/**
 * Lowers a flattened CIF 2D mask layout into a 3D `@modelscript/cad` layer-stack `Assembly`
 * (dimensions in µm, using MOSIS SCMOS vertical Z-stack heights).
 */
export function lowerCifToCadAssembly(layout: FlattenedCifLayout, name: string = "CifIcLayout"): Assembly {
  const parts: PartEntry[] = [];
  let idx = 0;

  for (const poly of layout.polygons) {
    const rule = lookupMosisLayerRule(poly.layer);
    const zMin = rule?.zMinUm ?? 0.5;
    const zThick = rule?.zThicknessUm ?? 0.3;
    const widthUm = Math.max(1e-4, poly.bbox.width / 100);
    const heightUm = Math.max(1e-4, poly.bbox.height / 100);
    const cxUm = (poly.bbox.minX + poly.bbox.maxX) / 200;
    const cyUm = (poly.bbox.minY + poly.bbox.maxY) / 200;

    const solid = translate(
      box({
        width: widthUm,
        height: heightUm,
        depth: zThick,
        name: `${poly.layer}_${idx}`,
      }),
      [cxUm, cyUm, zMin + zThick * 0.5],
    );
    parts.push(
      part(solid, {
        material: poly.layer,
      }),
    );
    idx++;
  }

  return assembly(name, parts);
}
