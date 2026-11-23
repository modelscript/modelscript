// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CAD / Geometry Lowering & 3D CMOS Layer-Stack Extrusion for `@modelscript/gdsii`.
 *
 * Flattens hierarchical GDSII `BOUNDARY`, `PATH`, `SREF`, and `AREF` elements
 * into planar 2D polygons with area, perimeter, and bounding-box calculations,
 * and extrudes layers into `@modelscript/cad` 3D assemblies.
 */

import { assembly, linearExtrude, part, translate, type Assembly, type PartEntry, type Vec3 } from "@modelscript/cad";
import type { GdsiiLayerStackEntry, GdsiiLibrary, GdsiiPoint, GdsiiStrans, GdsiiStructure } from "../types.js";

export interface GdsiiBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GdsiiFlatPolygon {
  layer: number;
  datatype: number;
  /** Vertices in database units (closed ring). */
  points: GdsiiPoint[];
  /** Vertices in micrometers (closed ring). */
  pointsUm: GdsiiPoint[];
  /** Area in DB units^2. */
  areaDb2: number;
  /** Area in um^2. */
  areaUm2: number;
  /** Perimeter in um. */
  perimeterUm: number;
  bboxDb: GdsiiBBox;
  bboxUm: GdsiiBBox;
  sourceStructure: string;
}

export interface GdsiiFlatGeometry {
  topStructure: string;
  dbUnitToUm: number;
  polygons: GdsiiFlatPolygon[];
  totalAreaDb2: number;
  totalAreaUm2: number;
  areaByLayerDb2: Record<number, number>;
  areaByLayerUm2: Record<number, number>;
  bboxDb: GdsiiBBox | null;
  bboxUm: GdsiiBBox | null;
  instanceCount: number;
}

export interface GdsiiLowerOptions {
  /** Top structure name to flatten. Defaults to the inferred root structure. */
  topStructure?: string | undefined;
  /** Maximum recursion depth for hierarchy flattening (default: 64). */
  maxDepth?: number | undefined;
}

export interface GdsiiExtrudeOptions extends GdsiiLowerOptions {
  /** Process layer stack definitions. Defaults to `DEFAULT_CMOS_LAYER_STACK`. */
  layerStack?: GdsiiLayerStackEntry[] | undefined;
}

/**
 * Default cleanroom CMOS foundry process layer stack (180nm-class generic PDK).
 */
export const DEFAULT_CMOS_LAYER_STACK: GdsiiLayerStackEntry[] = [
  {
    layer: 1,
    datatype: 0,
    name: "NWELL",
    zMinUm: -0.5,
    thicknessUm: 0.5,
    sheetResistanceOhmSq: 1000.0,
    areaCapFfPerUm2: 0.08,
    fringeCapFfPerUm: 0.02,
    color: "#93c5fd",
  },
  {
    layer: 2,
    datatype: 0,
    name: "ACTIVE",
    zMinUm: 0.0,
    thicknessUm: 0.15,
    sheetResistanceOhmSq: 10.0,
    areaCapFfPerUm2: 0.9,
    fringeCapFfPerUm: 0.06,
    color: "#4ade80",
  },
  {
    layer: 3,
    datatype: 0,
    name: "POLY",
    zMinUm: 0.16,
    thicknessUm: 0.2,
    sheetResistanceOhmSq: 8.0,
    areaCapFfPerUm2: 0.12,
    fringeCapFfPerUm: 0.05,
    color: "#f87171",
  },
  {
    layer: 4,
    datatype: 0,
    name: "CONTACT",
    zMinUm: 0.16,
    thicknessUm: 0.44,
    sheetResistanceOhmSq: 15.0,
    areaCapFfPerUm2: 0.05,
    fringeCapFfPerUm: 0.01,
    color: "#facc15",
  },
  {
    layer: 5,
    datatype: 0,
    name: "METAL1",
    zMinUm: 0.6,
    thicknessUm: 0.4,
    sheetResistanceOhmSq: 0.08,
    areaCapFfPerUm2: 0.035,
    fringeCapFfPerUm: 0.045,
    color: "#60a5fa",
  },
  {
    layer: 6,
    datatype: 0,
    name: "VIA1",
    zMinUm: 1.0,
    thicknessUm: 0.5,
    sheetResistanceOhmSq: 5.0,
    areaCapFfPerUm2: 0.02,
    fringeCapFfPerUm: 0.01,
    color: "#c084fc",
  },
  {
    layer: 7,
    datatype: 0,
    name: "METAL2",
    zMinUm: 1.5,
    thicknessUm: 0.6,
    sheetResistanceOhmSq: 0.05,
    areaCapFfPerUm2: 0.02,
    fringeCapFfPerUm: 0.035,
    color: "#f472b6",
  },
];

/**
 * Signed polygon area using the shoelace formula.
 */
export function polygonSignedArea(points: readonly GdsiiPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return 0.5 * sum;
}

/**
 * Unsigned polygon area.
 */
export function polygonArea(points: readonly GdsiiPoint[]): number {
  return Math.abs(polygonSignedArea(points));
}

/**
 * Polygon perimeter (sum of Euclidean edge lengths).
 */
export function polygonPerimeter(points: readonly GdsiiPoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.x !== last.x || first.y !== last.y) {
    total += Math.hypot(first.x - last.x, first.y - last.y);
  }
  return total;
}

/**
 * Computes the axis-aligned bounding box of a point list.
 */
export function computeBBox(points: readonly GdsiiPoint[]): GdsiiBBox | null {
  if (points.length === 0) return null;
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

/**
 * Merges two optional bounding boxes.
 */
export function mergeBBox(a: GdsiiBBox | null, b: GdsiiBBox | null): GdsiiBBox | null {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.minX, b.minX);
  const minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.maxX, b.maxX);
  const maxY = Math.max(a.maxY, b.maxY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Expands a GDSII `PATH` centerline into a closed 2D polygon ribbon.
 */
export function expandPathToPolygon(points: readonly GdsiiPoint[], width: number, pathtype = 0): GdsiiPoint[] {
  if (points.length < 2 || width <= 0) return [];
  const halfW = width / 2;
  const ext = pathtype === 2 || pathtype === 1 ? halfW : 0;

  const leftSide: GdsiiPoint[] = [];
  const rightSide: GdsiiPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const curr = points[i]!;
    if (i === 0) {
      const next = points[1]!;
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy * halfW;
      const ny = ux * halfW;
      const sx = curr.x - ux * ext;
      const sy = curr.y - uy * ext;
      leftSide.push({ x: sx + nx, y: sy + ny });
      rightSide.push({ x: sx - nx, y: sy - ny });
    } else if (i === points.length - 1) {
      const prev = points[i - 1]!;
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy * halfW;
      const ny = ux * halfW;
      const ex = curr.x + ux * ext;
      const ey = curr.y + uy * ext;
      leftSide.push({ x: ex + nx, y: ey + ny });
      rightSide.push({ x: ex - nx, y: ey - ny });
    } else {
      const prev = points[i - 1]!;
      const next = points[i + 1]!;
      const d1x = curr.x - prev.x;
      const d1y = curr.y - prev.y;
      const l1 = Math.hypot(d1x, d1y) || 1;
      const u1x = d1x / l1;
      const u1y = d1y / l1;

      const d2x = next.x - curr.x;
      const d2y = next.y - curr.y;
      const l2 = Math.hypot(d2x, d2y) || 1;
      const u2x = d2x / l2;
      const u2y = d2y / l2;

      const n1x = -u1y;
      const n1y = u1x;
      const n2x = -u2y;
      const n2y = u2x;

      let bx = n1x + n2x;
      let by = n1y + n2y;
      const blen = Math.hypot(bx, by);
      if (blen < 1e-6) {
        bx = n1x * halfW;
        by = n1y * halfW;
      } else {
        bx /= blen;
        by /= blen;
        const dot = bx * n1x + by * n1y;
        const scale = Math.min(halfW / Math.max(dot, 0.25), halfW * 3);
        bx *= scale;
        by *= scale;
      }
      leftSide.push({ x: curr.x + bx, y: curr.y + by });
      rightSide.push({ x: curr.x - bx, y: curr.y - by });
    }
  }

  rightSide.reverse();
  const poly = [...leftSide, ...rightSide];
  if (poly.length > 0) {
    poly.push({ x: poly[0]!.x, y: poly[0]!.y });
  }
  return poly;
}

interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

const IDENTITY_AFFINE: Affine2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function makeSrefAffine(origin: GdsiiPoint, strans?: GdsiiStrans, mag = 1, angleDeg = 0): Affine2D {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ry = strans?.reflectX ? -1 : 1;
  // Reflect X first (y -> -y), then scale by mag, then rotate by angle, then translate
  return {
    a: cos * mag,
    b: -sin * mag * ry,
    c: sin * mag,
    d: cos * mag * ry,
    tx: origin.x,
    ty: origin.y,
  };
}

function composeAffine(parent: Affine2D, child: Affine2D): Affine2D {
  return {
    a: parent.a * child.a + parent.b * child.c,
    b: parent.a * child.b + parent.b * child.d,
    c: parent.c * child.a + parent.d * child.c,
    d: parent.c * child.b + parent.d * child.d,
    tx: parent.a * child.tx + parent.b * child.ty + parent.tx,
    ty: parent.c * child.tx + parent.d * child.ty + parent.ty,
  };
}

function applyAffine(m: Affine2D, p: GdsiiPoint): GdsiiPoint {
  return {
    x: m.a * p.x + m.b * p.y + m.tx,
    y: m.c * p.x + m.d * p.y + m.ty,
  };
}

/**
 * Infers the top-level structure name of a GDSII library (a structure not referenced
 * by any SREF/AREF, or the last structure if all are referenced).
 */
export function inferTopStructure(library: GdsiiLibrary): string | undefined {
  if (library.structures.length === 0) return undefined;
  const referenced = new Set<string>();
  for (const s of library.structures) {
    for (const el of s.elements) {
      if (el.kind === "sref" || el.kind === "aref") {
        referenced.add(el.sname);
      }
    }
  }
  const roots = library.structures.filter((s) => !referenced.has(s.name));
  if (roots.length > 0) return roots[0]!.name;
  return library.structures[library.structures.length - 1]!.name;
}

/**
 * Flattens a hierarchical `GdsiiLibrary` into 2D polygons with areas and bounding boxes.
 */
export function lowerGdsiiToGeometry(library: GdsiiLibrary, options?: GdsiiLowerOptions): GdsiiFlatGeometry {
  const structMap = new Map<string, GdsiiStructure>();
  for (const s of library.structures) {
    structMap.set(s.name, s);
  }

  const topName = options?.topStructure ?? inferTopStructure(library) ?? "";
  const maxDepth = options?.maxDepth ?? 64;
  // Convert database units to micrometers: dbUnitInMeters * 1e6
  const dbUnitToUm = library.units.dbUnitInMeters > 0 ? library.units.dbUnitInMeters * 1e6 : 1e-3;

  const polygons: GdsiiFlatPolygon[] = [];
  let instanceCount = 0;

  function visit(structName: string, transform: Affine2D, depth: number, stack: Set<string>): void {
    if (depth > maxDepth || stack.has(structName)) return;
    const struct = structMap.get(structName);
    if (!struct) return;

    instanceCount += 1;
    stack.add(structName);

    for (const el of struct.elements) {
      if (el.kind === "boundary") {
        if (el.xy.length < 3) continue;
        const pts = el.xy.map((p) => applyAffine(transform, p));
        pushPolygon(el.layer, el.datatype, pts, structName);
      } else if (el.kind === "path") {
        const w = Math.abs(el.width ?? 0);
        if (el.xy.length >= 2 && w > 0) {
          const ribbon = expandPathToPolygon(el.xy, w, el.pathtype ?? 0);
          const pts = ribbon.map((p) => applyAffine(transform, p));
          pushPolygon(el.layer, el.datatype, pts, structName);
        }
      } else if (el.kind === "sref") {
        const local = makeSrefAffine(el.xy, el.strans, el.mag ?? 1, el.angle ?? 0);
        visit(el.sname, composeAffine(transform, local), depth + 1, stack);
      } else if (el.kind === "aref") {
        const cols = Math.max(0, Math.floor(el.columns));
        const rows = Math.max(0, Math.floor(el.rows));
        if (cols === 0 || rows === 0) continue;
        const p0 = el.xy[0];
        const pCol = el.xy[1];
        const pRow = el.xy[2];
        const colStepX = (pCol.x - p0.x) / cols;
        const colStepY = (pCol.y - p0.y) / cols;
        const rowStepX = (pRow.x - p0.x) / rows;
        const rowStepY = (pRow.y - p0.y) / rows;

        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const origin: GdsiiPoint = {
              x: p0.x + c * colStepX + r * rowStepX,
              y: p0.y + c * colStepY + r * rowStepY,
            };
            const local = makeSrefAffine(origin, el.strans, el.mag ?? 1, el.angle ?? 0);
            visit(el.sname, composeAffine(transform, local), depth + 1, stack);
          }
        }
      }
    }

    stack.delete(structName);
  }

  function pushPolygon(layer: number, datatype: number, pts: GdsiiPoint[], sourceStructure: string): void {
    const bboxDb = computeBBox(pts);
    if (!bboxDb) return;
    const areaDb2 = polygonArea(pts);
    const pointsUm = pts.map((p) => ({ x: p.x * dbUnitToUm, y: p.y * dbUnitToUm }));
    const bboxUm: GdsiiBBox = {
      minX: bboxDb.minX * dbUnitToUm,
      minY: bboxDb.minY * dbUnitToUm,
      maxX: bboxDb.maxX * dbUnitToUm,
      maxY: bboxDb.maxY * dbUnitToUm,
      width: bboxDb.width * dbUnitToUm,
      height: bboxDb.height * dbUnitToUm,
    };
    const areaUm2 = areaDb2 * dbUnitToUm * dbUnitToUm;
    const perimeterUm = polygonPerimeter(pointsUm);

    polygons.push({
      layer,
      datatype,
      points: pts,
      pointsUm,
      areaDb2,
      areaUm2,
      perimeterUm,
      bboxDb,
      bboxUm,
      sourceStructure,
    });
  }

  if (topName) {
    visit(topName, IDENTITY_AFFINE, 0, new Set());
  }

  let totalAreaDb2 = 0;
  let totalAreaUm2 = 0;
  const areaByLayerDb2: Record<number, number> = {};
  const areaByLayerUm2: Record<number, number> = {};
  let bboxDb: GdsiiBBox | null = null;
  let bboxUm: GdsiiBBox | null = null;

  for (const poly of polygons) {
    totalAreaDb2 += poly.areaDb2;
    totalAreaUm2 += poly.areaUm2;
    areaByLayerDb2[poly.layer] = (areaByLayerDb2[poly.layer] ?? 0) + poly.areaDb2;
    areaByLayerUm2[poly.layer] = (areaByLayerUm2[poly.layer] ?? 0) + poly.areaUm2;
    bboxDb = mergeBBox(bboxDb, poly.bboxDb);
    bboxUm = mergeBBox(bboxUm, poly.bboxUm);
  }

  return {
    topStructure: topName,
    dbUnitToUm,
    polygons,
    totalAreaDb2,
    totalAreaUm2,
    areaByLayerDb2,
    areaByLayerUm2,
    bboxDb,
    bboxUm,
    instanceCount,
  };
}

function hexToRgbVec3(hex: string): Vec3 {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return [0.5, 0.5, 0.5];
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}

/**
 * Extrudes flattened GDSII layout polygons into a 3D `@modelscript/cad` Assembly
 * using the CMOS process layer stack.
 */
export function extrudeGdsiiTo3dStack(library: GdsiiLibrary, options?: GdsiiExtrudeOptions): Assembly {
  const flat = lowerGdsiiToGeometry(library, options);
  const stack = options?.layerStack ?? DEFAULT_CMOS_LAYER_STACK;
  const stackByLayer = new Map<number, GdsiiLayerStackEntry>();
  for (const entry of stack) {
    stackByLayer.set(entry.layer, entry);
  }

  const parts: PartEntry[] = [];
  let polyIdx = 0;

  for (const poly of flat.polygons) {
    if (poly.areaUm2 <= 0) continue;
    const layerMeta = stackByLayer.get(poly.layer) ?? {
      layer: poly.layer,
      name: `LAYER_${poly.layer}`,
      zMinUm: poly.layer * 0.5,
      thicknessUm: 0.3,
      sheetResistanceOhmSq: 1.0,
      areaCapFfPerUm2: 0.05,
      fringeCapFfPerUm: 0.02,
      color: "#94a3b8",
    };

    // Strip duplicate closing vertex for linearExtrude
    const openRing =
      poly.pointsUm.length > 1 &&
      poly.pointsUm[0]!.x === poly.pointsUm[poly.pointsUm.length - 1]!.x &&
      poly.pointsUm[0]!.y === poly.pointsUm[poly.pointsUm.length - 1]!.y
        ? poly.pointsUm.slice(0, -1)
        : poly.pointsUm;

    if (openRing.length < 3) continue;

    const coords: [number, number][] = openRing.map((p) => [p.x, p.y]);
    const extruded = linearExtrude(coords, layerMeta.thicknessUm, {
      name: `${layerMeta.name}_${polyIdx++}`,
    });
    const placed = translate(extruded, [0, 0, layerMeta.zMinUm]);

    parts.push(
      part(placed, {
        material: layerMeta.name,
        color: hexToRgbVec3(layerMeta.color),
      }),
    );
  }

  return assembly(flat.topStructure || library.name || "GDSII_3D_STACK", parts);
}
