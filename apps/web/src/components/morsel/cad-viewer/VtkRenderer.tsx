// SPDX-License-Identifier: AGPL-3.0-or-later

import { Html } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { CadEdgeOverlay } from "./HeroCadMaterials";

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
  const tmpColor = new THREE.Color();

  for (let s = 0; s < numSeeds; s++) {
    const t = (s + 0.5) / numSeeds;
    let px = minX + 0.08 * spanX;
    let py = minY + (0.15 + 0.7 * t) * spanY;
    let pz = minZ + (0.2 + 0.6 * ((s * 0.6180339) % 1)) * spanZ;

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
      const normT = Math.min(1, Math.max(0, mag1 / maxMag));
      tmpColor.setHSL((1.0 - normT) * 0.66, 0.9, 0.58);
      lineColors.push(tmpColor.r, tmpColor.g, tmpColor.b, tmpColor.r, tmpColor.g, tmpColor.b);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  if (linePositions.length < 6) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linePositions), 3));
  geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(lineColors), 3));
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
): {
  geometry: THREE.BufferGeometry;
  vectorGeometry: THREE.BufferGeometry | null;
  streamlineGeometry: THREE.BufferGeometry | null;
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

  const triIndices: number[] = [];
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
          triIndices.push(v0, polyVerts[k]!, polyVerts[k + 1]!);
        }
      }
    }
  } else {
    // Fallback for unindexed triangle soup in <Points>
    const triCount = Math.floor(numPoints / 3);
    for (let i = 0; i < triCount * 3; i++) {
      triIndices.push(i);
    }
  }

  if (triIndices.length < 3) return null;

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

  const dispArray = dataArrays.find((a) => a.name.toLowerCase().includes("displacement"));
  const dispVals =
    deformationScale > 0 && dispArray?.body
      ? dispArray.body
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((n) => Number.isFinite(n))
      : null;

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
        const px = rawCoords[i * 3] ?? 0;
        const py = rawCoords[i * 3 + 1] ?? 0;
        const pz = rawCoords[i * 3 + 2] ?? 0;
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
  const tmpColor = new THREE.Color();

  for (let i = 0; i < triIndices.length; i++) {
    const ptIdx = triIndices[i]!;
    const safeIdx = ptIdx >= 0 && ptIdx < numPoints ? ptIdx : 0;
    const dx = dispVals ? (dispVals[safeIdx * 3] ?? 0) * deformationScale : 0;
    const dy = dispVals ? (dispVals[safeIdx * 3 + 1] ?? 0) * deformationScale : 0;
    const dz = dispVals ? (dispVals[safeIdx * 3 + 2] ?? 0) * deformationScale : 0;
    positions[i * 3] = (rawCoords[safeIdx * 3] ?? 0) + dx;
    positions[i * 3 + 1] = (rawCoords[safeIdx * 3 + 1] ?? 0) + dy;
    positions[i * 3 + 2] = (rawCoords[safeIdx * 3 + 2] ?? 0) + dz;

    const normT = Math.min(1, Math.max(0, ((pointScalars[safeIdx] ?? minScalar) - minScalar) / span));
    tmpColor.setHSL((1.0 - normT) * 0.66, 0.85, 0.52);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const vertexScalars = new Float32Array(triIndices.length);
  for (let i = 0; i < triIndices.length; i++) {
    const ptIdx = triIndices[i]!;
    const safeIdx = ptIdx >= 0 && ptIdx < numPoints ? ptIdx : 0;
    vertexScalars[i] = pointScalars[safeIdx] ?? 0;
  }
  geometry.userData.vertexScalars = vertexScalars;
  geometry.computeVertexNormals();
  return { geometry, vectorGeometry, streamlineGeometry };
}

/**
 * VtkRenderer - Parses VTK XML PolyData / UnstructuredGrid payloads (`<Points>`, `<Polys>`,
 * and `<PointData><DataArray>`) into a Three.js BufferGeometry with scalar-mapped vertex colors,
 * optional 3D velocity vector needles, RK4 streamlines, and hover numerical probe.
 */
export function VtkRenderer({
  vtkBuffer,
  opacity = 0.8,
  activeField,
  showVectors = false,
  showStreamlines = false,
  deformationScale = 0,
}: VtkRendererProps) {
  const [probe, setProbe] = useState<{ pos: [number, number, number]; value: number } | null>(null);
  const parsed = useMemo(
    () => parseVtkXmlGeometry(vtkBuffer, activeField, showVectors, showStreamlines, deformationScale),
    [vtkBuffer, activeField, showVectors, showStreamlines, deformationScale],
  );

  useEffect(() => {
    return () => {
      parsed?.geometry?.dispose();
      parsed?.vectorGeometry?.dispose();
      parsed?.streamlineGeometry?.dispose();
    };
  }, [parsed]);

  if (!parsed) return null;

  return (
    <group>
      <mesh
        geometry={parsed.geometry}
        onPointerMove={(e) => {
          e.stopPropagation();
          const vScalars = parsed.geometry.userData.vertexScalars as Float32Array | undefined;
          const idx = e.face?.a ?? 0;
          const val = vScalars?.[idx] ?? 0;
          setProbe({ pos: [e.point.x, e.point.y, e.point.z], value: val });
        }}
        onPointerOut={() => setProbe(null)}
      >
        <meshStandardMaterial
          vertexColors
          transparent={opacity < 1}
          opacity={opacity}
          roughness={0.3}
          metalness={0.15}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <CadEdgeOverlay geometry={parsed.geometry} opacity={0.65} />
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
            <span style={{ color: "#06b6d4", fontWeight: 700 }}>{activeField || "Field"}:</span>{" "}
            {probe.value.toFixed(4)}
          </div>
        </Html>
      )}
    </group>
  );
}
