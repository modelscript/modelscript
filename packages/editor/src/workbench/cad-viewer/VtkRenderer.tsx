// SPDX-License-Identifier: AGPL-3.0-or-later

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { CadEdgeOverlay } from "./HeroCadMaterials";

export interface VtkSlicePlane {
  axis: "x" | "y" | "z";
  /** Normalized [0..1] fraction along the axis bounding box (or world coordinate if outside [0..1]) */
  position: number;
  /** Optional slice slab thickness (normalized fraction if <= 1, or world units if > 1) */
  thickness?: number | undefined;
}

export interface VtkProbePoint {
  point: [number, number, number];
  scalarName: string;
  value: number;
  screenX: number;
  screenY: number;
}

export interface VtkRendererProps {
  /** The latest VTK buffer extracted from the CFD orchestrator */
  vtkBuffer: Uint8Array | null;
  /** Opacity of the melt front */
  opacity?: number | undefined;
  /** Optional active scalar/vector field name (e.g. "Velocity Magnitude", "Pressure", "Temperature") */
  activeField?: string | undefined;
  /** Render 3D velocity vector needles when a 3-component vector DataArray is present */
  showVectors?: boolean | undefined;
  /** Render RK4-integrated 3D streamlines when a 3-component vector DataArray is present */
  showStreamlines?: boolean | undefined;
  /** Structural deformation amplification scale factor (e.g. 0..25) */
  deformationScale?: number | undefined;
  /** Smoothly oscillate vertex positions along the displacement vector when deformationScale > 0 */
  animateDeformation?: boolean | undefined;
  /** Render animated glowing flow tracer particles advecting along RK4 streamlines */
  animateFlow?: boolean | undefined;
  /** Enable iso-surface / iso-contour extraction for Q-criterion, lambda2, vorticity, shock, or von Mises stress */
  isoSurfaceEnabled?: boolean | undefined;
  /** Normalized (0..1) or physical scalar threshold for iso-surface extraction */
  isoThreshold?: number | undefined;
  /** Optional 3D axis-aligned slice plane filter on VTK triangles and vectors */
  slicePlane?: VtkSlicePlane | null | undefined;
  /** Pointer hover/click callback emitting world coordinates, scalar value, and screen coordinates */
  onProbePoint?: ((probe: VtkProbePoint | null) => void) | undefined;
  /** Optional multi-timestep VTK frame sequence for transient playback */
  timestepFrames?: Uint8Array[] | undefined;
  /** Active index into timestepFrames (clamped to valid range) */
  activeFrameIndex?: number | undefined;
}

/**
 * Integrates 4th-order Runge-Kutta (RK4) 3D streamlines through a vector field.
 */
export function computeRk4Streamlines(
  rawCoords: number[],
  vecVals: number[],
  numPoints: number,
  numComps: number,
  numSeeds = 14,
  steps = 28,
): THREE.BufferGeometry | null {
  if (numPoints < 3 || numComps < 3 || vecVals.length < numPoints * numComps) return null;

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let maxMag = 1e-6;
  for (let i = 0; i < numPoints; i++) {
    const x = rawCoords[i * 3] ?? 0;
    const y = rawCoords[i * 3 + 1] ?? 0;
    const z = rawCoords[i * 3 + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    const vx = vecVals[i * numComps] ?? 0;
    const vy = vecVals[i * numComps + 1] ?? 0;
    const vz = vecVals[i * numComps + 2] ?? 0;
    const mag = Math.hypot(vx, vy, vz);
    if (mag > maxMag) maxMag = mag;
  }

  const spanX = Math.max(1e-4, maxX - minX);
  const spanY = Math.max(1e-4, maxY - minY);
  const spanZ = Math.max(1e-4, maxZ - minZ);
  const diag = Math.hypot(spanX, spanY, spanZ);
  const dt = diag / steps / maxMag;

  const sampleStep = Math.max(1, Math.floor(numPoints / 250));
  const sampleVel = (px: number, py: number, pz: number): [number, number, number] => {
    let wSum = 0;
    let vxSum = 0;
    let vySum = 0;
    let vzSum = 0;
    for (let i = 0; i < numPoints; i += sampleStep) {
      const dx = px - (rawCoords[i * 3] ?? 0);
      const dy = py - (rawCoords[i * 3 + 1] ?? 0);
      const dz = pz - (rawCoords[i * 3 + 2] ?? 0);
      const d2 = dx * dx + dy * dy + dz * dz;
      const w = 1 / (d2 + 1e-6);
      wSum += w;
      vxSum += w * (vecVals[i * numComps] ?? 0);
      vySum += w * (vecVals[i * numComps + 1] ?? 0);
      vzSum += w * (vecVals[i * numComps + 2] ?? 0);
    }
    return wSum > 0 ? [vxSum / wSum, vySum / wSum, vzSum / wSum] : [0, 0, 0];
  };

  const linePositions: number[] = [];
  const lineColors: number[] = [];
  const polylines: Float32Array[] = [];
  const tmpColor = new THREE.Color();

  for (let s = 0; s < numSeeds; s++) {
    const t = (s + 0.5) / numSeeds;
    let px = minX + 0.08 * spanX;
    let py = minY + (0.15 + 0.7 * t) * spanY;
    let pz = minZ + (0.2 + 0.6 * ((s * 0.6180339) % 1)) * spanZ;
    const polyPts: number[] = [px, py, pz];

    for (let k = 0; k < steps; k++) {
      const [vx1, vy1, vz1] = sampleVel(px, py, pz);
      const mag1 = Math.hypot(vx1, vy1, vz1);
      if (mag1 < 1e-6) break;

      const [vx2, vy2, vz2] = sampleVel(px + 0.5 * dt * vx1, py + 0.5 * dt * vy1, pz + 0.5 * dt * vz1);
      const [vx3, vy3, vz3] = sampleVel(px + 0.5 * dt * vx2, py + 0.5 * dt * vy2, pz + 0.5 * dt * vz2);
      const [vx4, vy4, vz4] = sampleVel(px + dt * vx3, py + dt * vy3, pz + dt * vz3);

      const nx = px + (dt / 6) * (vx1 + 2 * vx2 + 2 * vx3 + vx4);
      const ny = py + (dt / 6) * (vy1 + 2 * vy2 + 2 * vy3 + vy4);
      const nz = pz + (dt / 6) * (vz1 + 2 * vz2 + 2 * vz3 + vz4);

      if (
        nx < minX - 0.1 * spanX ||
        nx > maxX + 0.1 * spanX ||
        ny < minY - 0.1 * spanY ||
        ny > maxY + 0.1 * spanY ||
        nz < minZ - 0.1 * spanZ ||
        nz > maxZ + 0.1 * spanZ
      ) {
        break;
      }

      linePositions.push(px, py, pz, nx, ny, nz);
      polyPts.push(nx, ny, nz);
      const normT = Math.min(1, Math.max(0, mag1 / maxMag));
      tmpColor.setHSL((1.0 - normT) * 0.66, 0.9, 0.58);
      lineColors.push(tmpColor.r, tmpColor.g, tmpColor.b, tmpColor.r, tmpColor.g, tmpColor.b);
      px = nx;
      py = ny;
      pz = nz;
    }

    if (polyPts.length >= 6) {
      polylines.push(new Float32Array(polyPts));
    }
  }

  if (linePositions.length < 6) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(lineColors), 3));
  geom.userData.polylines = polylines;
  return geom;
}

/**
 * Samples a scalar (or vector magnitude) field along an axis-aligned cut-line
 * for 2D XY line plot visualization.
 */
export function sampleVtkCutLine(
  vtkBuffer: Uint8Array | null,
  activeField?: string,
  axis: "x" | "y" | "z" = "x",
  numBins = 24,
): Array<{ s: number; value: number }> {
  if (!vtkBuffer || vtkBuffer.length === 0) return [];
  const fullText = new TextDecoder().decode(vtkBuffer);
  const pointsMatch = /<Points>[\s\S]*?<DataArray[^>]*>([\s\S]*?)<\/DataArray>[\s\S]*?<\/Points>/i.exec(fullText);
  if (!pointsMatch?.[1]) return [];
  const rawCoords = pointsMatch[1]
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const numPoints = Math.floor(rawCoords.length / 3);
  if (numPoints < 2) return [];

  const pointDataBlock = /<PointData[^>]*>([\s\S]*?)<\/PointData>/i.exec(fullText)?.[1];
  const dataArrays: { attrs: string; name: string; body: string }[] = [];
  if (pointDataBlock) {
    const arrRegex = /<DataArray([^>]*)>([\s\S]*?)<\/DataArray>/gi;
    let m: RegExpExecArray | null;
    while ((m = arrRegex.exec(pointDataBlock)) !== null) {
      const attrs = m[1] ?? "";
      const name = /Name=["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      dataArrays.push({ attrs, name, body: m[2] ?? "" });
    }
  }
  const targetField = (activeField ?? "").toLowerCase().trim();
  const matched =
    (targetField
      ? dataArrays.find((a) => targetField.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(targetField))
      : undefined) ?? dataArrays[0];
  if (!matched?.body) return [];

  const compMatch = /NumberOfComponents=["'](\d+)["']/i.exec(matched.attrs);
  const numComps = compMatch ? Math.max(1, Number.parseInt(compMatch[1]!, 10)) : 1;
  const vals = matched.body
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));

  const axisOffset = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  let minA = Infinity;
  let maxA = -Infinity;
  for (let i = 0; i < numPoints; i++) {
    const c = rawCoords[i * 3 + axisOffset] ?? 0;
    if (c < minA) minA = c;
    if (c > maxA) maxA = c;
  }
  const spanA = Math.max(1e-6, maxA - minA);
  const sums = new Float64Array(numBins);
  const counts = new Uint32Array(numBins);

  for (let i = 0; i < numPoints; i++) {
    const c = rawCoords[i * 3 + axisOffset] ?? 0;
    const bin = Math.min(numBins - 1, Math.max(0, Math.floor(((c - minA) / spanA) * numBins)));
    let scalar = 0;
    if (numComps === 1) {
      scalar = vals[i] ?? 0;
    } else {
      let sq = 0;
      for (let k = 0; k < numComps; k++) {
        const v = vals[i * numComps + k] ?? 0;
        sq += v * v;
      }
      scalar = Math.sqrt(sq);
    }
    sums[bin] += scalar;
    counts[bin] += 1;
  }

  const out: Array<{ s: number; value: number }> = [];
  for (let b = 0; b < numBins; b++) {
    if (counts[b]! > 0) {
      out.push({ s: (b + 0.5) / numBins, value: sums[b]! / counts[b]! });
    }
  }
  return out;
}

function parseVtkXmlGeometry(
  vtkBuffer: Uint8Array | null,
  activeField?: string,
  showVectors = false,
  showStreamlines = false,
  deformationScale = 0,
  isoSurfaceEnabled = false,
  isoThreshold?: number,
  slicePlane?: VtkSlicePlane | null,
): {
  geometry: THREE.BufferGeometry;
  isoGeometry: THREE.BufferGeometry | null;
  isoContourGeometry: THREE.BufferGeometry | null;
  vectorGeometry: THREE.BufferGeometry | null;
  streamlineGeometry: THREE.BufferGeometry | null;
  scalarName: string;
} | null {
  if (!vtkBuffer || vtkBuffer.length === 0) return null;

  const fullText = new TextDecoder().decode(vtkBuffer);
  if (!fullText.includes("<VTKFile") && !fullText.includes("<PolyData") && !fullText.includes("<UnstructuredGrid")) {
    return null;
  }

  const pointsMatch = /<Points>[\s\S]*?<DataArray[^>]*>([\s\S]*?)<\/DataArray>[\s\S]*?<\/Points>/i.exec(fullText);
  if (!pointsMatch?.[1]) return null;

  const rawCoords = pointsMatch[1]
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const numPoints = Math.floor(rawCoords.length / 3);
  if (numPoints < 3) return null;

  // Parse <Polys> or <Cells> connectivity & offsets
  const polysOrCellsBlock =
    /<Polys>([\s\S]*?)<\/Polys>/i.exec(fullText)?.[1] ?? /<Cells>([\s\S]*?)<\/Cells>/i.exec(fullText)?.[1] ?? fullText;
  const connMatch = /<DataArray[^>]*Name=["']connectivity["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(polysOrCellsBlock);
  const offsetsMatch = /<DataArray[^>]*Name=["']offsets["'][^>]*>([\s\S]*?)<\/DataArray>/i.exec(polysOrCellsBlock);

  const rawTriIndices: number[] = [];
  if (connMatch?.[1] && offsetsMatch?.[1]) {
    const connectivity = connMatch[1]
      .trim()
      .split(/\s+/)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
    const offsets = offsetsMatch[1]
      .trim()
      .split(/\s+/)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n));

    let prevOffset = 0;
    for (const endOffset of offsets) {
      const polyVerts = connectivity.slice(prevOffset, endOffset);
      prevOffset = endOffset;
      if (polyVerts.length >= 3) {
        const v0 = polyVerts[0]!;
        for (let k = 1; k + 1 < polyVerts.length; k++) {
          rawTriIndices.push(v0, polyVerts[k]!, polyVerts[k + 1]!);
        }
      }
    }
  } else {
    // Fallback for unindexed triangle soup in <Points>
    const triCount = Math.floor(numPoints / 3);
    for (let i = 0; i < triCount * 3; i++) {
      rawTriIndices.push(i);
    }
  }

  if (rawTriIndices.length < 3) return null;

  // Parse <PointData><DataArray> scalar / vector fields
  const pointDataBlock = /<PointData[^>]*>([\s\S]*?)<\/PointData>/i.exec(fullText)?.[1];
  const dataArrays: { attrs: string; name: string; body: string }[] = [];
  if (pointDataBlock) {
    const arrRegex = /<DataArray([^>]*)>([\s\S]*?)<\/DataArray>/gi;
    let m: RegExpExecArray | null;
    while ((m = arrRegex.exec(pointDataBlock)) !== null) {
      const attrs = m[1] ?? "";
      const name = /Name=["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      dataArrays.push({ attrs, name, body: m[2] ?? "" });
    }
  }

  const targetField = (activeField ?? "").toLowerCase().trim();
  const matchedArray =
    (targetField
      ? dataArrays.find((a) => targetField.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(targetField))
      : undefined) ?? dataArrays[0];
  const scalarName = matchedArray?.name || activeField || "Field";

  const dispArray = dataArrays.find((a) => a.name.toLowerCase().includes("displacement"));
  const dispVals =
    deformationScale > 0 && dispArray?.body
      ? dispArray.body
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((n) => Number.isFinite(n))
      : null;

  // Compute deformed coordinates once so slice plane, iso-contours, and triangles are consistent
  const deformedCoords = new Float32Array(numPoints * 3);
  for (let i = 0; i < numPoints; i++) {
    const dx = dispVals ? (dispVals[i * 3] ?? 0) * deformationScale : 0;
    const dy = dispVals ? (dispVals[i * 3 + 1] ?? 0) * deformationScale : 0;
    const dz = dispVals ? (dispVals[i * 3 + 2] ?? 0) * deformationScale : 0;
    deformedCoords[i * 3] = (rawCoords[i * 3] ?? 0) + dx;
    deformedCoords[i * 3 + 1] = (rawCoords[i * 3 + 1] ?? 0) + dy;
    deformedCoords[i * 3 + 2] = (rawCoords[i * 3 + 2] ?? 0) + dz;
  }

  // Optional 3D slice plane slab bounds
  let sliceAxisIdx = -1;
  let sliceMin = -Infinity;
  let sliceMax = Infinity;
  if (slicePlane) {
    sliceAxisIdx = slicePlane.axis === "x" ? 0 : slicePlane.axis === "y" ? 1 : 2;
    let minA = Infinity;
    let maxA = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const c = deformedCoords[i * 3 + sliceAxisIdx] ?? 0;
      if (c < minA) minA = c;
      if (c > maxA) maxA = c;
    }
    const spanA = Math.max(1e-6, maxA - minA);
    const planeCoord =
      slicePlane.position >= 0 && slicePlane.position <= 1 ? minA + slicePlane.position * spanA : slicePlane.position;
    const rawThick = slicePlane.thickness;
    const halfThick =
      rawThick !== undefined && rawThick > 0
        ? Math.max(1e-5, (rawThick <= 1 ? rawThick * spanA : rawThick) * 0.5)
        : Math.max(1e-5, spanA * 0.06);
    sliceMin = planeCoord - halfThick;
    sliceMax = planeCoord + halfThick;
  }

  const triIndices: number[] = [];
  if (sliceAxisIdx >= 0) {
    for (let t = 0; t + 2 < rawTriIndices.length; t += 3) {
      const i0 = rawTriIndices[t]!;
      const i1 = rawTriIndices[t + 1]!;
      const i2 = rawTriIndices[t + 2]!;
      const s0 = i0 >= 0 && i0 < numPoints ? i0 : 0;
      const s1 = i1 >= 0 && i1 < numPoints ? i1 : 0;
      const s2 = i2 >= 0 && i2 < numPoints ? i2 : 0;
      const c0 = deformedCoords[s0 * 3 + sliceAxisIdx] ?? 0;
      const c1 = deformedCoords[s1 * 3 + sliceAxisIdx] ?? 0;
      const c2 = deformedCoords[s2 * 3 + sliceAxisIdx] ?? 0;
      const triMin = Math.min(c0, c1, c2);
      const triMax = Math.max(c0, c1, c2);
      if (triMax >= sliceMin && triMin <= sliceMax) {
        triIndices.push(s0, s1, s2);
      }
    }
  } else {
    for (let i = 0; i < rawTriIndices.length; i++) {
      triIndices.push(rawTriIndices[i]!);
    }
  }

  const pointScalars = new Float32Array(numPoints);
  let vectorGeometry: THREE.BufferGeometry | null = null;
  let streamlineGeometry: THREE.BufferGeometry | null = null;

  if (matchedArray?.body) {
    const compMatch = /NumberOfComponents=["'](\d+)["']/i.exec(matchedArray.attrs);
    const numComps = compMatch ? Math.max(1, Number.parseInt(compMatch[1]!, 10)) : 1;
    const rawVals = matchedArray.body
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));

    for (let i = 0; i < numPoints; i++) {
      if (numComps === 1) {
        pointScalars[i] = rawVals[i] ?? 0;
      } else {
        let sumSq = 0;
        for (let c = 0; c < numComps; c++) {
          const v = rawVals[i * numComps + c] ?? 0;
          sumSq += v * v;
        }
        pointScalars[i] = Math.sqrt(sumSq);
      }
    }

    if (showVectors && numComps >= 3) {
      const step = Math.max(1, Math.floor(numPoints / 140));
      const vecVerts: number[] = [];
      let maxMag = 1e-6;
      for (let i = 0; i < numPoints; i += step) {
        if (pointScalars[i]! > maxMag) maxMag = pointScalars[i]!;
      }
      for (let i = 0; i < numPoints; i += step) {
        const px = deformedCoords[i * 3] ?? 0;
        const py = deformedCoords[i * 3 + 1] ?? 0;
        const pz = deformedCoords[i * 3 + 2] ?? 0;
        if (sliceAxisIdx >= 0) {
          const coord = sliceAxisIdx === 0 ? px : sliceAxisIdx === 1 ? py : pz;
          if (coord < sliceMin || coord > sliceMax) continue;
        }
        const vx = rawVals[i * numComps] ?? 0;
        const vy = rawVals[i * numComps + 1] ?? 0;
        const vz = rawVals[i * numComps + 2] ?? 0;
        const scale = 0.35 / maxMag;
        vecVerts.push(px, py, pz, px + vx * scale, py + vy * scale, pz + vz * scale);
      }
      if (vecVerts.length >= 6) {
        vectorGeometry = new THREE.BufferGeometry();
        vectorGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vecVerts), 3));
      }
    }

    if (showStreamlines && numComps >= 3) {
      streamlineGeometry = computeRk4Streamlines(rawCoords, rawVals, numPoints, numComps);
    }
  } else {
    for (let i = 0; i < numPoints; i++) {
      const x = rawCoords[i * 3] ?? 0;
      const y = rawCoords[i * 3 + 1] ?? 0;
      const z = rawCoords[i * 3 + 2] ?? 0;
      pointScalars[i] = Math.hypot(x, y, z);
    }
  }

  let minScalar = Infinity;
  let maxScalar = -Infinity;
  for (let i = 0; i < numPoints; i++) {
    const val = pointScalars[i]!;
    if (val < minScalar) minScalar = val;
    if (val > maxScalar) maxScalar = val;
  }
  const span = Math.max(1e-6, maxScalar - minScalar);

  const positions = new Float32Array(triIndices.length * 3);
  const colors = new Float32Array(triIndices.length * 3);
  const vertexScalars = new Float32Array(triIndices.length);
  const basePositions = dispVals ? new Float32Array(triIndices.length * 3) : null;
  const displacements = dispVals ? new Float32Array(triIndices.length * 3) : null;
  const tmpColor = new THREE.Color();

  for (let i = 0; i < triIndices.length; i++) {
    const ptIdx = triIndices[i]!;
    const safeIdx = ptIdx >= 0 && ptIdx < numPoints ? ptIdx : 0;
    positions[i * 3] = deformedCoords[safeIdx * 3] ?? 0;
    positions[i * 3 + 1] = deformedCoords[safeIdx * 3 + 1] ?? 0;
    positions[i * 3 + 2] = deformedCoords[safeIdx * 3 + 2] ?? 0;

    if (basePositions && displacements && dispVals) {
      basePositions[i * 3] = rawCoords[safeIdx * 3] ?? 0;
      basePositions[i * 3 + 1] = rawCoords[safeIdx * 3 + 1] ?? 0;
      basePositions[i * 3 + 2] = rawCoords[safeIdx * 3 + 2] ?? 0;
      displacements[i * 3] = dispVals[safeIdx * 3] ?? 0;
      displacements[i * 3 + 1] = dispVals[safeIdx * 3 + 1] ?? 0;
      displacements[i * 3 + 2] = dispVals[safeIdx * 3 + 2] ?? 0;
    }

    const scalar = pointScalars[safeIdx] ?? minScalar;
    vertexScalars[i] = scalar;
    const normT = Math.min(1, Math.max(0, (scalar - minScalar) / span));
    tmpColor.setHSL((1.0 - normT) * 0.66, 0.85, 0.52);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.userData.vertexScalars = vertexScalars;
  if (basePositions && displacements) {
    geometry.userData.basePositions = basePositions;
    geometry.userData.displacements = displacements;
  }
  if (triIndices.length >= 3) {
    geometry.computeVertexNormals();
  }

  // Optional iso-surface & exact iso-contour extraction (Q-criterion, lambda2, vorticity, shock, von Mises)
  let isoGeometry: THREE.BufferGeometry | null = null;
  let isoContourGeometry: THREE.BufferGeometry | null = null;

  if (isoSurfaceEnabled && triIndices.length >= 3) {
    const physThreshold =
      isoThreshold === undefined
        ? minScalar + 0.5 * span
        : isoThreshold >= 0 && isoThreshold <= 1 && (minScalar < 0 || maxScalar > 1.0001 || span > 1.0001)
          ? minScalar + isoThreshold * span
          : isoThreshold;

    const isoPos: number[] = [];
    const isoCol: number[] = [];
    const isoScalars: number[] = [];
    const contourPts: number[] = [];

    const interpEdge = (aIdx: number, bIdx: number, sa: number, sb: number): [number, number, number] | null => {
      const crosses = (sa <= physThreshold && sb >= physThreshold) || (sb <= physThreshold && sa >= physThreshold);
      if (!crosses || Math.abs(sb - sa) < 1e-12) return null;
      const t = Math.min(1, Math.max(0, (physThreshold - sa) / (sb - sa)));
      const ax = deformedCoords[aIdx * 3] ?? 0;
      const ay = deformedCoords[aIdx * 3 + 1] ?? 0;
      const az = deformedCoords[aIdx * 3 + 2] ?? 0;
      const bx = deformedCoords[bIdx * 3] ?? 0;
      const by = deformedCoords[bIdx * 3 + 1] ?? 0;
      const bz = deformedCoords[bIdx * 3 + 2] ?? 0;
      return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
    };

    for (let t = 0; t + 2 < triIndices.length; t += 3) {
      const i0 = triIndices[t]!;
      const i1 = triIndices[t + 1]!;
      const i2 = triIndices[t + 2]!;
      const s0 = i0 >= 0 && i0 < numPoints ? i0 : 0;
      const s1 = i1 >= 0 && i1 < numPoints ? i1 : 0;
      const s2 = i2 >= 0 && i2 < numPoints ? i2 : 0;
      const v0 = pointScalars[s0] ?? 0;
      const v1 = pointScalars[s1] ?? 0;
      const v2 = pointScalars[s2] ?? 0;

      const maxV = Math.max(v0, v1, v2);
      const minV = Math.min(v0, v1, v2);
      const avgV = (v0 + v1 + v2) / 3;
      const straddles = minV <= physThreshold && maxV >= physThreshold;

      if (avgV >= physThreshold || straddles) {
        const triVerts = [s0, s1, s2];
        const triVals = [v0, v1, v2];
        for (let k = 0; k < 3; k++) {
          const vi = triVerts[k]!;
          const sv = triVals[k]!;
          isoPos.push(deformedCoords[vi * 3] ?? 0, deformedCoords[vi * 3 + 1] ?? 0, deformedCoords[vi * 3 + 2] ?? 0);
          isoScalars.push(sv);
          const normT = Math.min(1, Math.max(0, (sv - minScalar) / span));
          tmpColor.setHSL((1.0 - normT) * 0.66, 0.95, straddles ? 0.62 : 0.54);
          isoCol.push(tmpColor.r, tmpColor.g, tmpColor.b);
        }
      }

      if (straddles) {
        const hits: [number, number, number][] = [];
        const e01 = interpEdge(s0, s1, v0, v1);
        const e12 = interpEdge(s1, s2, v1, v2);
        const e20 = interpEdge(s2, s0, v2, v0);
        if (e01) hits.push(e01);
        if (e12) hits.push(e12);
        if (e20) hits.push(e20);
        if (hits.length >= 2) {
          contourPts.push(hits[0]![0], hits[0]![1], hits[0]![2], hits[1]![0], hits[1]![1], hits[1]![2]);
        }
      }
    }

    if (isoPos.length >= 9) {
      isoGeometry = new THREE.BufferGeometry();
      isoGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(isoPos), 3));
      isoGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(isoCol), 3));
      isoGeometry.userData.vertexScalars = new Float32Array(isoScalars);
      isoGeometry.computeVertexNormals();
    }
    if (contourPts.length >= 6) {
      isoContourGeometry = new THREE.BufferGeometry();
      isoContourGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(contourPts), 3));
    }
  }

  return { geometry, isoGeometry, isoContourGeometry, vectorGeometry, streamlineGeometry, scalarName };
}

/**
 * VtkRenderer - Parses VTK XML PolyData / UnstructuredGrid payloads (`<Points>`, `<Polys>`,
 * and `<PointData><DataArray>`) into a Three.js BufferGeometry with scalar-mapped vertex colors,
 * optional 3D velocity vector needles, RK4 streamlines, iso-surface/contour extraction,
 * 3D slice plane filtering, multi-timestep frame playback, and hover/click numerical probe.
 */
export function VtkRenderer({
  vtkBuffer,
  opacity = 0.8,
  activeField,
  showVectors = false,
  showStreamlines = false,
  deformationScale = 0,
  animateDeformation = false,
  animateFlow = false,
  isoSurfaceEnabled = false,
  isoThreshold,
  slicePlane = null,
  onProbePoint,
  timestepFrames,
  activeFrameIndex = 0,
}: VtkRendererProps) {
  const [probe, setProbe] = useState<{ pos: [number, number, number]; value: number; scalarName: string } | null>(null);

  const effectiveBuffer = useMemo(() => {
    if (timestepFrames && timestepFrames.length > 0) {
      const clampedIdx = Math.min(timestepFrames.length - 1, Math.max(0, Math.floor(activeFrameIndex)));
      return timestepFrames[clampedIdx] ?? vtkBuffer;
    }
    return vtkBuffer;
  }, [timestepFrames, activeFrameIndex, vtkBuffer]);

  const parsed = useMemo(
    () =>
      parseVtkXmlGeometry(
        effectiveBuffer,
        activeField,
        showVectors,
        showStreamlines,
        deformationScale,
        isoSurfaceEnabled,
        isoThreshold,
        slicePlane,
      ),
    [
      effectiveBuffer,
      activeField,
      showVectors,
      showStreamlines,
      deformationScale,
      isoSurfaceEnabled,
      isoThreshold,
      slicePlane,
    ],
  );

  const flowTracers = useMemo(() => {
    if (!animateFlow || !parsed?.streamlineGeometry) return null;
    const polylines = parsed.streamlineGeometry.userData.polylines as Float32Array[] | undefined;
    if (!polylines || polylines.length === 0) return null;

    const particlesPerLine = 4;
    const totalParticles = polylines.length * particlesPerLine;
    const positions = new Float32Array(totalParticles * 3);
    const colors = new Float32Array(totalParticles * 3);
    const phases = new Float32Array(totalParticles);
    const speeds = new Float32Array(totalParticles);
    const lineIndices = new Uint32Array(totalParticles);
    const tmpColor = new THREE.Color();

    let idx = 0;
    for (let l = 0; l < polylines.length; l++) {
      const poly = polylines[l]!;
      const segCount = Math.max(1, poly.length / 3 - 1);
      for (let p = 0; p < particlesPerLine; p++) {
        const phase = ((p + ((l * 0.37) % 1)) / particlesPerLine) % 1;
        phases[idx] = phase;
        speeds[idx] = 0.28 + ((l * 0.07 + p * 0.11) % 0.16);
        lineIndices[idx] = l;

        const fIdx = phase * segCount;
        const sIdx = Math.min(segCount - 1, Math.floor(fIdx));
        const frac = fIdx - sIdx;
        const a = sIdx * 3;
        const b = (sIdx + 1) * 3;
        positions[idx * 3] = poly[a]! + (poly[b]! - poly[a]!) * frac;
        positions[idx * 3 + 1] = poly[a + 1]! + (poly[b + 1]! - poly[a + 1]!) * frac;
        positions[idx * 3 + 2] = poly[a + 2]! + (poly[b + 2]! - poly[a + 2]!) * frac;

        tmpColor.setHSL(0.53 + (p / particlesPerLine) * 0.05, 0.95, 0.72);
        colors[idx * 3] = tmpColor.r;
        colors[idx * 3 + 1] = tmpColor.g;
        colors[idx * 3 + 2] = tmpColor.b;
        idx++;
      }
    }

    if (!parsed.streamlineGeometry.boundingSphere) {
      parsed.streamlineGeometry.computeBoundingSphere();
    }
    const radius = parsed.streamlineGeometry.boundingSphere?.radius ?? 1;
    const particleSize = Math.max(0.015, radius * 0.035);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { geometry, polylines, phases, speeds, lineIndices, particleSize };
  }, [animateFlow, parsed?.streamlineGeometry]);

  useEffect(() => {
    return () => {
      parsed?.geometry?.dispose();
      parsed?.isoGeometry?.dispose();
      parsed?.isoContourGeometry?.dispose();
      parsed?.vectorGeometry?.dispose();
      parsed?.streamlineGeometry?.dispose();
    };
  }, [parsed]);

  useEffect(() => {
    return () => {
      flowTracers?.geometry.dispose();
    };
  }, [flowTracers]);

  useEffect(() => {
    if (animateDeformation || !parsed?.geometry) return;
    const basePositions = parsed.geometry.userData.basePositions as Float32Array | undefined;
    const displacements = parsed.geometry.userData.displacements as Float32Array | undefined;
    const posAttr = parsed.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!basePositions || !displacements || !posAttr) return;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = basePositions[i]! + displacements[i]! * deformationScale;
    }
    posAttr.needsUpdate = true;
  }, [animateDeformation, deformationScale, parsed?.geometry]);

  useFrame((state, delta) => {
    if (animateDeformation && deformationScale > 0 && parsed?.geometry) {
      const basePositions = parsed.geometry.userData.basePositions as Float32Array | undefined;
      const displacements = parsed.geometry.userData.displacements as Float32Array | undefined;
      const posAttr = parsed.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (basePositions && displacements && posAttr) {
        const factor = deformationScale * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 2.6));
        const arr = posAttr.array as Float32Array;
        const len = arr.length;
        for (let i = 0; i < len; i++) {
          arr[i] = basePositions[i]! + displacements[i]! * factor;
        }
        posAttr.needsUpdate = true;
      }
    }

    if (animateFlow && flowTracers) {
      const dt = Math.min(delta, 0.05);
      const posAttr = flowTracers.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (posAttr) {
        const arr = posAttr.array as Float32Array;
        const { polylines, phases, speeds, lineIndices } = flowTracers;
        const count = phases.length;
        for (let i = 0; i < count; i++) {
          const t = (phases[i]! + dt * speeds[i]!) % 1;
          phases[i] = t;
          const poly = polylines[lineIndices[i]!]!;
          const segCount = Math.max(1, poly.length / 3 - 1);
          const fIdx = t * segCount;
          const sIdx = Math.min(segCount - 1, Math.floor(fIdx));
          const frac = fIdx - sIdx;
          const a = sIdx * 3;
          const b = (sIdx + 1) * 3;
          arr[i * 3] = poly[a]! + (poly[b]! - poly[a]!) * frac;
          arr[i * 3 + 1] = poly[a + 1]! + (poly[b + 1]! - poly[a + 1]!) * frac;
          arr[i * 3 + 2] = poly[a + 2]! + (poly[b + 2]! - poly[a + 2]!) * frac;
        }
        posAttr.needsUpdate = true;
      }
    }
  });

  if (!parsed) return null;

  const handlePointerProbe = (
    geom: THREE.BufferGeometry,
    e: {
      stopPropagation: () => void;
      face?: { a: number } | null | undefined;
      point: { x: number; y: number; z: number };
      clientX: number;
      clientY: number;
    },
  ) => {
    e.stopPropagation();
    const vScalars = geom.userData.vertexScalars as Float32Array | undefined;
    const idx = e.face?.a ?? 0;
    const val = vScalars?.[idx] ?? 0;
    const point: [number, number, number] = [e.point.x, e.point.y, e.point.z];
    setProbe({ pos: point, value: val, scalarName: parsed.scalarName });
    onProbePoint?.({
      point,
      scalarName: parsed.scalarName,
      value: val,
      screenX: e.clientX,
      screenY: e.clientY,
    });
  };

  const handlePointerOut = () => {
    setProbe(null);
    onProbePoint?.(null);
  };

  const baseOpacity = isoSurfaceEnabled && parsed.isoGeometry ? Math.min(opacity, 0.22) : opacity;

  return (
    <group>
      <mesh
        geometry={parsed.geometry}
        onPointerMove={(e) => handlePointerProbe(parsed.geometry, e)}
        onClick={(e) => handlePointerProbe(parsed.geometry, e)}
        onPointerOut={handlePointerOut}
      >
        <meshStandardMaterial
          vertexColors
          transparent={baseOpacity < 1}
          opacity={baseOpacity}
          roughness={0.3}
          metalness={0.15}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <CadEdgeOverlay geometry={parsed.geometry} opacity={isoSurfaceEnabled && parsed.isoGeometry ? 0.25 : 0.65} />
      {parsed.isoGeometry && (
        <mesh
          geometry={parsed.isoGeometry}
          onPointerMove={(e) => handlePointerProbe(parsed.isoGeometry!, e)}
          onClick={(e) => handlePointerProbe(parsed.isoGeometry!, e)}
          onPointerOut={handlePointerOut}
        >
          <meshStandardMaterial
            vertexColors
            transparent={opacity < 1}
            opacity={Math.max(0.85, opacity)}
            roughness={0.22}
            metalness={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {parsed.isoContourGeometry && (
        <lineSegments geometry={parsed.isoContourGeometry}>
          <lineBasicMaterial color="#38bdf8" transparent opacity={0.95} />
        </lineSegments>
      )}
      {parsed.vectorGeometry && (
        <lineSegments geometry={parsed.vectorGeometry}>
          <lineBasicMaterial color="#2563eb" transparent opacity={0.75} />
        </lineSegments>
      )}
      {parsed.streamlineGeometry && (
        <lineSegments geometry={parsed.streamlineGeometry}>
          <lineBasicMaterial vertexColors transparent opacity={0.92} />
        </lineSegments>
      )}
      {flowTracers && (
        <points geometry={flowTracers.geometry}>
          <pointsMaterial
            vertexColors
            size={flowTracers.particleSize}
            sizeAttenuation
            transparent
            opacity={0.95}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
      )}
      {probe && (
        <Html position={probe.pos} style={{ pointerEvents: "none", transform: "translate3d(-50%, -125%, 0)" }}>
          <div
            style={{
              background: "rgba(15, 23, 42, 0.92)",
              color: "#f8fafc",
              border: "1px solid rgba(6, 182, 212, 0.55)",
              borderRadius: 8,
              padding: "4px 8px",
              fontSize: 10,
              fontFamily: "var(--font-mono, monospace)",
              whiteSpace: "nowrap",
              boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
            }}
          >
            <span style={{ color: "#06b6d4", fontWeight: 700 }}>{probe.scalarName}:</span> {probe.value.toFixed(4)}
          </div>
        </Html>
      )}
    </group>
  );
}
