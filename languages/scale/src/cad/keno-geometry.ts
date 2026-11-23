// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — KENO V.a / VI CSG Geometry Volume & `@modelscript/cad` Assembly Builder.
 *
 * Converts KENO units (`cylinder`, `sphere`, `cuboid`, `hexprism`), nested `media` regions,
 * `hole` placements, and `array` lattices into `@modelscript/cad` assemblies with exact
 * analytical region volumes by mixture ID.
 */

import {
  assembly,
  box,
  cylinder,
  part,
  polyhedron,
  sphere,
  subtract,
  translate,
  type Assembly,
  type PartEntry,
  type Solid,
  type Vec3,
} from "@modelscript/cad";
import type { KenoGeometryBody, KenoUnit, ScaleDeck } from "../types.js";

export interface KenoRegionVolume {
  unitId: number;
  mixtureId: number;
  materialName: string;
  volumeCm3: number;
  regions: number[];
}

export interface KenoUnitMetrics {
  unitId: number;
  isGlobal: boolean;
  boundingVolumeCm3: number;
  pitchX: number;
  pitchY: number;
  pitchZ: number;
  regionVolumes: KenoRegionVolume[];
  volumeByMixtureCm3: Record<number, number>;
}

export interface KenoGeometrySummary {
  assembly: Assembly;
  units: Map<number, KenoUnitMetrics>;
  totalVolumeCm3: number;
  volumeByMixtureCm3: Record<number, number>;
  arrayCellCount: number;
}

const MIXTURE_COLORS: Vec3[] = [
  [0.85, 0.25, 0.2], // Fuel (UO2 / MOX)
  [0.2, 0.55, 0.88], // Moderator (H2O)
  [0.72, 0.75, 0.78], // Cladding (Zirc4)
  [0.45, 0.48, 0.52], // Structural (SS304)
  [0.25, 0.25, 0.3], // Absorber (B4C)
  [0.85, 0.65, 0.2],
];

/**
 * Computes the exact analytical volume (cm³) of a single KENO geometric primitive.
 */
export function computeKenoBodyVolume(body: KenoGeometryBody): number {
  if (body.kind === "cylinder") {
    const r = body.radius ?? 0;
    const h = (body.zPlus ?? 0) - (body.zMinus ?? 0);
    return r > 0 && h > 0 ? Math.PI * r * r * h : 0;
  }
  if (body.kind === "sphere") {
    const r = body.radius ?? 0;
    return r > 0 ? (4.0 / 3.0) * Math.PI * r * r * r : 0;
  }
  if (body.kind === "cuboid") {
    const dx = (body.xPlus ?? 0) - (body.xMinus ?? 0);
    const dy = (body.yPlus ?? 0) - (body.yMinus ?? 0);
    const dz = (body.zPlus ?? 0) - (body.zMinus ?? 0);
    return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
  }
  if (body.kind === "hexprism") {
    // Apothem (flat-to-flat half-width) a -> area = 2 * sqrt(3) * a^2
    const a = body.radius ?? 0;
    const h = (body.zPlus ?? 0) - (body.zMinus ?? 0);
    return a > 0 && h > 0 ? 2.0 * Math.sqrt(3.0) * a * a * h : 0;
  }
  return 0;
}

/**
 * Computes the bounding extents (dx, dy, dz) in cm of a KENO body.
 */
export function computeKenoBodyExtents(body: KenoGeometryBody): [number, number, number] {
  if (body.kind === "cylinder") {
    const d = 2.0 * (body.radius ?? 0);
    const h = Math.max(0, (body.zPlus ?? 0) - (body.zMinus ?? 0));
    return [d, d, h];
  }
  if (body.kind === "sphere") {
    const d = 2.0 * (body.radius ?? 0);
    return [d, d, d];
  }
  if (body.kind === "cuboid") {
    return [
      Math.max(0, (body.xPlus ?? 0) - (body.xMinus ?? 0)),
      Math.max(0, (body.yPlus ?? 0) - (body.yMinus ?? 0)),
      Math.max(0, (body.zPlus ?? 0) - (body.zMinus ?? 0)),
    ];
  }
  if (body.kind === "hexprism") {
    const a = body.radius ?? 0;
    const flatToFlat = 2.0 * a;
    const cornerToCorner = (4.0 * a) / Math.sqrt(3.0);
    const h = Math.max(0, (body.zPlus ?? 0) - (body.zMinus ?? 0));
    return [cornerToCorner, flatToFlat, h];
  }
  return [0, 0, 0];
}

function buildHexPrismSolid(apothem: number, height: number, name: string): Solid {
  const rCorner = (2.0 * apothem) / Math.sqrt(3.0);
  const hz = height * 0.5;
  const points: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3.0;
    const x = rCorner * Math.cos(angle);
    const y = rCorner * Math.sin(angle);
    points.push([x, y, -hz]);
  }
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3.0;
    const x = rCorner * Math.cos(angle);
    const y = rCorner * Math.sin(angle);
    points.push([x, y, hz]);
  }
  const faces: number[][] = [
    [0, 5, 4, 3, 2, 1],
    [6, 7, 8, 9, 10, 11],
  ];
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    faces.push([i, next, next + 6, i + 6]);
  }
  return polyhedron({ points, faces, name });
}

/**
 * Converts a single KENO body primitive into a `@modelscript/cad` `Solid`.
 */
export function buildKenoBodySolid(body: KenoGeometryBody, namePrefix: string): Solid | null {
  const name = `${namePrefix}_${body.kind}_${body.id}`;
  let solid: Solid | null = null;
  let cx = body.origin?.[0] ?? 0;
  let cy = body.origin?.[1] ?? 0;
  let cz = body.origin?.[2] ?? 0;

  if (body.kind === "cylinder") {
    const r = body.radius ?? 0;
    const zPlus = body.zPlus ?? 0;
    const zMinus = body.zMinus ?? 0;
    const h = zPlus - zMinus;
    if (r <= 0 || h <= 0) return null;
    solid = cylinder({ radius: r, height: h, name });
    cz += 0.5 * (zPlus + zMinus);
  } else if (body.kind === "sphere") {
    const r = body.radius ?? 0;
    if (r <= 0) return null;
    solid = sphere({ radius: r, name });
  } else if (body.kind === "cuboid") {
    const xPlus = body.xPlus ?? 0;
    const xMinus = body.xMinus ?? 0;
    const yPlus = body.yPlus ?? 0;
    const yMinus = body.yMinus ?? 0;
    const zPlus = body.zPlus ?? 0;
    const zMinus = body.zMinus ?? 0;
    const dx = xPlus - xMinus;
    const dy = yPlus - yMinus;
    const dz = zPlus - zMinus;
    if (dx <= 0 || dy <= 0 || dz <= 0) return null;
    solid = box({ width: dx, height: dy, depth: dz, name });
    cx += 0.5 * (xPlus + xMinus);
    cy += 0.5 * (yPlus + yMinus);
    cz += 0.5 * (zPlus + zMinus);
  } else if (body.kind === "hexprism") {
    const a = body.radius ?? 0;
    const zPlus = body.zPlus ?? 0;
    const zMinus = body.zMinus ?? 0;
    const h = zPlus - zMinus;
    if (a <= 0 || h <= 0) return null;
    solid = buildHexPrismSolid(a, h, name);
    cz += 0.5 * (zPlus + zMinus);
  }

  if (!solid) return null;
  if (cx !== 0 || cy !== 0 || cz !== 0) {
    return translate(solid, [cx, cy, cz]);
  }
  return solid;
}

function resolveMaterialName(deck: ScaleDeck, mixtureId: number): string {
  if (mixtureId === 0) return "VOID";
  const comp = deck.compositions.find((c) => c.mixtureId === mixtureId);
  return comp ? comp.materialName.toUpperCase() : `MIX_${mixtureId}`;
}

/**
 * Analyzes a single KENO unit's nested media regions and computes exact analytical volumes.
 */
export function computeKenoUnitMetrics(deck: ScaleDeck, unit: KenoUnit): KenoUnitMetrics {
  const bodyById = new Map<number, KenoGeometryBody>();
  for (const b of unit.bodies) bodyById.set(b.id, b);

  const regionVolumes: KenoRegionVolume[] = [];
  const volumeByMixtureCm3: Record<number, number> = {};

  for (const med of unit.media) {
    const posIds = med.regions.filter((r) => r > 0);
    const negIds = med.regions.filter((r) => r < 0).map((r) => Math.abs(r));

    // Outer region volume is the smallest positive containing body
    let outerVol = 0;
    if (posIds.length > 0) {
      const posVols = posIds
        .map((id) => {
          const b = bodyById.get(id);
          return b ? computeKenoBodyVolume(b) : 0;
        })
        .filter((v) => v > 0);
      outerVol = posVols.length > 0 ? Math.min(...posVols) : 0;
    }

    // Subtract excluded inner bodies
    let excludedVol = 0;
    for (const nid of negIds) {
      const b = bodyById.get(nid);
      if (b) excludedVol += computeKenoBodyVolume(b);
    }

    const netVol = Math.max(0, outerVol - excludedVol) * (med.volumeFraction > 0 ? med.volumeFraction : 1.0);
    regionVolumes.push({
      unitId: unit.id,
      mixtureId: med.mixtureId,
      materialName: resolveMaterialName(deck, med.mixtureId),
      volumeCm3: netVol,
      regions: [...med.regions],
    });
    volumeByMixtureCm3[med.mixtureId] = (volumeByMixtureCm3[med.mixtureId] ?? 0) + netVol;
  }

  // Determine bounding body
  const boundaryBody =
    (unit.boundaryBodyId !== undefined ? bodyById.get(unit.boundaryBodyId) : undefined) ??
    unit.bodies[unit.bodies.length - 1];
  const boundingVolumeCm3 = boundaryBody ? computeKenoBodyVolume(boundaryBody) : 0;
  const [pitchX, pitchY, pitchZ] = boundaryBody ? computeKenoBodyExtents(boundaryBody) : [0, 0, 0];

  return {
    unitId: unit.id,
    isGlobal: unit.isGlobal,
    boundingVolumeCm3,
    pitchX,
    pitchY,
    pitchZ,
    regionVolumes,
    volumeByMixtureCm3,
  };
}

function buildUnitParts(deck: ScaleDeck, unit: KenoUnit, offset: Vec3, prefix: string): PartEntry[] {
  const bodyById = new Map<number, KenoGeometryBody>();
  for (const b of unit.bodies) bodyById.set(b.id, b);
  const parts: PartEntry[] = [];

  for (let mIdx = 0; mIdx < unit.media.length; mIdx++) {
    const med = unit.media[mIdx]!;
    const posIds = med.regions.filter((r) => r > 0);
    const negIds = med.regions.filter((r) => r < 0).map((r) => Math.abs(r));
    if (posIds.length === 0) continue;

    const outerBody = bodyById.get(posIds[0]!);
    if (!outerBody) continue;
    let solid = buildKenoBodySolid(outerBody, `${prefix}_u${unit.id}_m${mIdx}`);
    if (!solid) continue;

    for (const nid of negIds) {
      const innerBody = bodyById.get(nid);
      if (!innerBody) continue;
      const innerSolid = buildKenoBodySolid(innerBody, `${prefix}_u${unit.id}_sub${nid}`);
      if (innerSolid) {
        solid = subtract(solid, innerSolid);
      }
    }

    if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) {
      solid = translate(solid, offset);
    }

    const color = MIXTURE_COLORS[Math.abs(med.mixtureId - 1) % MIXTURE_COLORS.length]!;
    parts.push(
      part(solid, {
        material: resolveMaterialName(deck, med.mixtureId),
        color,
      }),
    );
  }

  // Recurse into holes placed in this unit
  for (let hIdx = 0; hIdx < unit.holes.length; hIdx++) {
    const hole = unit.holes[hIdx]!;
    const targetUnit = deck.units.get(hole.unitId);
    if (!targetUnit || targetUnit.id === unit.id) continue;
    const holeOffset: Vec3 = [offset[0] + hole.origin[0], offset[1] + hole.origin[1], offset[2] + hole.origin[2]];
    parts.push(...buildUnitParts(deck, targetUnit, holeOffset, `${prefix}_h${hIdx}`));
  }

  return parts;
}

/**
 * Builds a complete `@modelscript/cad` `Assembly` and exact analytical volume breakdown
 * from a parsed SCALE / KENO geometry deck.
 */
export function buildKenoCadAssembly(deck: ScaleDeck): KenoGeometrySummary {
  const unitMetrics = new Map<number, KenoUnitMetrics>();
  for (const unit of deck.units.values()) {
    unitMetrics.set(unit.id, computeKenoUnitMetrics(deck, unit));
  }

  const allParts: PartEntry[] = [];
  const totalVolByMix: Record<number, number> = {};
  let totalVolumeCm3 = 0;
  let arrayCellCount = 0;

  const globalUnit = Array.from(deck.units.values()).find((u) => u.isGlobal) ?? deck.units.values().next().value;

  if (globalUnit) {
    // Check if global unit places an array lattice
    if (globalUnit.arrayPlacements.length > 0) {
      for (const placement of globalUnit.arrayPlacements) {
        const arr = deck.arrays.get(placement.arrayId);
        if (!arr) continue;
        const fillList = arr.fill.length > 0 ? arr.fill : Array(arr.nux * arr.nuy * arr.nuz).fill(1);

        let idx = 0;
        for (let iz = 0; iz < arr.nuz; iz++) {
          for (let iy = 0; iy < arr.nuy; iy++) {
            for (let ix = 0; ix < arr.nux; ix++) {
              const cellUnitId = fillList[idx % fillList.length]!;
              idx++;
              const cellUnit = deck.units.get(cellUnitId);
              const cellMetrics = unitMetrics.get(cellUnitId);
              if (!cellUnit || !cellMetrics) continue;

              arrayCellCount++;
              const cx = (ix - (arr.nux - 1) * 0.5) * cellMetrics.pitchX + (placement.origin?.[0] ?? 0);
              const cy = (iy - (arr.nuy - 1) * 0.5) * cellMetrics.pitchY + (placement.origin?.[1] ?? 0);
              const cz = (iz - (arr.nuz - 1) * 0.5) * cellMetrics.pitchZ + (placement.origin?.[2] ?? 0);

              allParts.push(...buildUnitParts(deck, cellUnit, [cx, cy, cz], `arr${arr.id}_${ix}_${iy}_${iz}`));
              for (const [mixKey, vol] of Object.entries(cellMetrics.volumeByMixtureCm3)) {
                const mId = Number(mixKey);
                totalVolByMix[mId] = (totalVolByMix[mId] ?? 0) + vol;
                totalVolumeCm3 += vol;
              }
            }
          }
        }
      }
    } else {
      allParts.push(...buildUnitParts(deck, globalUnit, [0, 0, 0], "global"));
      const gMetrics = unitMetrics.get(globalUnit.id);
      if (gMetrics) {
        for (const [mixKey, vol] of Object.entries(gMetrics.volumeByMixtureCm3)) {
          const mId = Number(mixKey);
          totalVolByMix[mId] = (totalVolByMix[mId] ?? 0) + vol;
          totalVolumeCm3 += vol;
        }
      }
      // Include volumes of placed holes
      for (const hole of globalUnit.holes) {
        const hMetrics = unitMetrics.get(hole.unitId);
        if (hMetrics) {
          for (const [mixKey, vol] of Object.entries(hMetrics.volumeByMixtureCm3)) {
            const mId = Number(mixKey);
            totalVolByMix[mId] = (totalVolByMix[mId] ?? 0) + vol;
            totalVolumeCm3 += vol;
          }
        }
      }
    }
  }

  const asmName = (deck.title || "KenoGeometry").replace(/[^a-zA-Z0-9_]/g, "_");
  return {
    assembly: assembly(asmName, allParts),
    units: unitMetrics,
    totalVolumeCm3,
    volumeByMixtureCm3: totalVolByMix,
    arrayCellCount,
  };
}
