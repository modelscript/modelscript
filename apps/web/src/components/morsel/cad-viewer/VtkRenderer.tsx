// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo } from "react";
import * as THREE from "three";

export interface VtkRendererProps {
  /** The latest VTK buffer extracted from the CFD orchestrator */
  vtkBuffer: Uint8Array | null;
  /** Opacity of the melt front */
  opacity?: number | undefined;
}

function parseVtkXmlGeometry(vtkBuffer: Uint8Array | null): THREE.BufferGeometry | null {
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

  // Parse <PointData><DataArray> scalar / vector field
  const pointDataBlock = /<PointData[^>]*>([\s\S]*?)<\/PointData>/i.exec(fullText)?.[1];
  const dataArrayMatch = pointDataBlock ? /<DataArray([^>]*)>([\s\S]*?)<\/DataArray>/i.exec(pointDataBlock) : null;

  const pointScalars = new Float32Array(numPoints);
  if (dataArrayMatch?.[2]) {
    const attrs = dataArrayMatch[1] ?? "";
    const compMatch = /NumberOfComponents=["'](\d+)["']/i.exec(attrs);
    const numComps = compMatch ? Math.max(1, Number.parseInt(compMatch[1]!, 10)) : 1;
    const rawVals = dataArrayMatch[2]
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
    positions[i * 3] = rawCoords[safeIdx * 3] ?? 0;
    positions[i * 3 + 1] = rawCoords[safeIdx * 3 + 1] ?? 0;
    positions[i * 3 + 2] = rawCoords[safeIdx * 3 + 2] ?? 0;

    const normT = Math.min(1, Math.max(0, ((pointScalars[safeIdx] ?? minScalar) - minScalar) / span));
    tmpColor.setHSL((1.0 - normT) * 0.66, 0.85, 0.52);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * VtkRenderer - Parses VTK XML PolyData / UnstructuredGrid payloads (`<Points>`, `<Polys>`,
 * and `<PointData><DataArray>`) into a Three.js BufferGeometry with scalar-mapped vertex colors.
 */
export function VtkRenderer({ vtkBuffer, opacity = 0.8 }: VtkRendererProps) {
  const geometry = useMemo(() => parseVtkXmlGeometry(vtkBuffer), [vtkBuffer]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.3}
        metalness={0.15}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
