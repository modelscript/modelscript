// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Qif3dMeshPayload } from "@modelscript/qif/step-bridge";

export interface StepGeometry {
  payload: Qif3dMeshPayload;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Parse a binary STL (80-byte header, uint32 triangle count, 50 bytes per triangle) into a mesh payload. */
export function parseBinaryStl(stl: Uint8Array, name: string): StepGeometry | null {
  if (stl.byteLength < 84) return null;
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const declared = view.getUint32(80, true);
  const triCount = Math.min(declared, Math.floor((stl.byteLength - 84) / 50));
  if (triCount === 0) return null;

  const vertices: number[] = new Array<number>(triCount * 9);
  const normals: number[] = new Array<number>(triCount * 9);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < triCount; i++) {
    const off = 84 + i * 50;
    const nx = view.getFloat32(off, true);
    const ny = view.getFloat32(off + 4, true);
    const nz = view.getFloat32(off + 8, true);
    for (let v = 0; v < 3; v++) {
      const base = i * 9 + v * 3;
      for (let axis = 0; axis < 3; axis++) {
        const value = view.getFloat32(off + 12 + v * 12 + axis * 4, true);
        vertices[base + axis] = value;
        if (value < min[axis]!) min[axis] = value;
        if (value > max[axis]!) max[axis] = value;
      }
      normals[base] = nx;
      normals[base + 1] = ny;
      normals[base + 2] = nz;
    }
  }

  return {
    payload: {
      id: "STEP_PART",
      name,
      isBodyEnvelope: true,
      color: [0.27, 0.35, 0.46],
      deviationStatus: "UNINSPECTED",
      worstToleranceRatio: 0,
      vertices,
      normals,
      indices: [],
    },
    bounds: { min, max },
  };
}

/** Tessellate STEP text into a displayable mesh. The tessellator is loaded lazily (it is large). */
export async function stepTextToGeometry(stepText: string, name: string): Promise<StepGeometry | null> {
  const { tessellateStepSource } = await import("../morsel/hooks/useMorselEngine");
  // Keep native STEP coordinates: QIF feature locations are in the same (millimeter) frame.
  const { stlBuffer } = tessellateStepSource(stepText, { normalize: false });
  return parseBinaryStl(stlBuffer, name);
}

export interface GeometryCompanionRef {
  artifactId: string | number;
  title?: string | undefined;
  provenance?: string | undefined;
}

/** Read `viewConfig.companions.geometry` (a reference to the paired STEP artifact), if present. */
export function readGeometryCompanion(
  viewConfig: Record<string, unknown> | null | undefined,
): GeometryCompanionRef | undefined {
  const companions = viewConfig?.["companions"];
  if (!companions || typeof companions !== "object") return undefined;
  const geometry = (companions as Record<string, unknown>)["geometry"];
  if (!geometry || typeof geometry !== "object") return undefined;
  const g = geometry as Record<string, unknown>;
  const id = g["artifactId"];
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  if (typeof id === "string" && id.length === 0) return undefined;
  return {
    artifactId: id,
    ...(typeof g["title"] === "string" ? { title: g["title"] } : {}),
    ...(typeof g["provenance"] === "string" ? { provenance: g["provenance"] } : {}),
  };
}

type Vec3 = [number, number, number];

/** Union of the scene's feature bounds and the part bounds, in the same shape `Qif3dMbdScene.boundingBox` uses. */
export function unionBounds(
  scene: { min: Vec3; max: Vec3 },
  part: { min: Vec3; max: Vec3 },
): { min: Vec3; max: Vec3; center: Vec3; radius: number } {
  const min: Vec3 = [
    Math.min(scene.min[0], part.min[0]),
    Math.min(scene.min[1], part.min[1]),
    Math.min(scene.min[2], part.min[2]),
  ];
  const max: Vec3 = [
    Math.max(scene.max[0], part.max[0]),
    Math.max(scene.max[1], part.max[1]),
    Math.max(scene.max[2], part.max[2]),
  ];
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    radius: Math.max(20, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2),
  };
}

const SYNTHESIZED_STEP_MARKER = "ModelScript ISO 10303-242 AP242 MBD Companion B-Rep";

/**
 * True for STEP text generated from a QIF by `synthesizeStepAp242FromQif` (older posts persisted it as
 * `stepSource`). It carries no real part geometry, so it must never be presented as one.
 */
export function isSynthesizedStep(stepText: string): boolean {
  return stepText.includes(SYNTHESIZED_STEP_MARKER);
}
