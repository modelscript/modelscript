// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CfdGeometryPart {
  name: string;
  positions: number[];
  indices: number[];
  normals?: number[] | undefined;
  color?: [number, number, number, number] | string | undefined;
}

export interface CfdGeometryPayload {
  positions: number[];
  indices: number[];
  normals?: number[] | undefined;
  sourceFile?: string | undefined;
  parts?: CfdGeometryPart[] | undefined;
}

/**
 * Normalizes CFD 3D geometry coordinates to fit within a canonical bounding box span.
 */
export function normalizeCfdGeometry(raw: CfdGeometryPayload, targetSpan = 0.65): CfdGeometryPayload {
  const { positions, indices, normals, sourceFile, parts } = raw;
  if (positions.length < 3) return raw;

  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const cx = 0.5 * (minX + maxX);
  const cy = 0.5 * (minY + maxY);
  const cz = 0.5 * (minZ + maxZ);
  const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxSpan > 1e-6 ? targetSpan / maxSpan : 1.0;

  const normPositions = new Array<number>(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    normPositions[i] = (positions[i]! - cx) * scale;
    normPositions[i + 1] = (positions[i + 1]! - cy) * scale;
    normPositions[i + 2] = (positions[i + 2]! - cz) * scale;
  }

  const normParts = parts?.map((part) => {
    const pPos = new Array<number>(part.positions.length);
    for (let i = 0; i < part.positions.length; i += 3) {
      pPos[i] = (part.positions[i]! - cx) * scale;
      pPos[i + 1] = (part.positions[i + 1]! - cy) * scale;
      pPos[i + 2] = (part.positions[i + 2]! - cz) * scale;
    }
    return {
      ...part,
      positions: pPos,
    };
  });

  return {
    positions: normPositions,
    indices,
    normals,
    sourceFile,
    parts: normParts,
  };
}

/**
 * Extracts surface triangle meshes from an SU2 ASCII mesh deck (.su2).
 * Inspects MARKER_TAG boundary elements, falling back to volume tets surface faces.
 */
export function parseSu2MeshSurface(
  su2Text: string,
  wallMarkers: string[] = [],
): { positions: number[]; indices: number[] } | null {
  const lines = su2Text.split(/\r?\n/);
  const positions: number[] = [];
  const allMarkerTris = new Map<string, number[]>();
  const volTetIndices: number[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line.startsWith("NPOIN=")) {
      const npoin = parseInt(line.split("=")[1]!.trim(), 10);
      i++;
      for (let p = 0; p < npoin && i < lines.length; i++) {
        const ptLine = lines[i]!.trim();
        if (!ptLine || ptLine.startsWith("%")) continue;
        const cols = ptLine.split(/\s+/);
        if (cols.length >= 3) {
          positions.push(parseFloat(cols[0]!) || 0, parseFloat(cols[1]!) || 0, parseFloat(cols[2]!) || 0);
          p++;
        }
      }
      continue;
    }
    if (line.startsWith("NELEM=")) {
      const nelem = parseInt(line.split("=")[1]!.trim(), 10);
      i++;
      for (let e = 0; e < nelem && i < lines.length; i++) {
        const elLine = lines[i]!.trim();
        if (!elLine || elLine.startsWith("%")) continue;
        const cols = elLine.split(/\s+/);
        const vtkType = parseInt(cols[0]!, 10);
        if ((vtkType === 10 || vtkType === 24) && cols.length >= 5) {
          volTetIndices.push(
            parseInt(cols[1]!, 10),
            parseInt(cols[2]!, 10),
            parseInt(cols[3]!, 10),
            parseInt(cols[4]!, 10),
          );
        }
        e++;
      }
      continue;
    }
    if (line.startsWith("MARKER_TAG=")) {
      const tag = line.split("=")[1]!.trim();
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("MARKER_ELEMS=")) {
        i++;
      }
      if (i < lines.length && lines[i]!.trim().startsWith("MARKER_ELEMS=")) {
        const melem = parseInt(lines[i]!.trim().split("=")[1]!.trim(), 10);
        i++;
        const tris: number[] = allMarkerTris.get(tag) ?? [];
        for (let m = 0; m < melem && i < lines.length; i++) {
          const mLine = lines[i]!.trim();
          if (!mLine || mLine.startsWith("%")) continue;
          const cols = mLine.split(/\s+/);
          const vtkType = parseInt(cols[0]!, 10);
          if (vtkType === 5 && cols.length >= 4) {
            tris.push(parseInt(cols[1]!, 10), parseInt(cols[2]!, 10), parseInt(cols[3]!, 10));
          } else if (vtkType === 9 && cols.length >= 5) {
            const n0 = parseInt(cols[1]!, 10);
            const n1 = parseInt(cols[2]!, 10);
            const n2 = parseInt(cols[3]!, 10);
            const n3 = parseInt(cols[4]!, 10);
            tris.push(n0, n1, n2, n0, n2, n3);
          }
          m++;
        }
        allMarkerTris.set(tag, tris);
        continue;
      }
    }
    i++;
  }

  if (positions.length < 9) return null;

  // Prefer wall markers if present and non-empty, otherwise use all boundary markers
  const preferredTags = new Set(wallMarkers.map((w) => w.toLowerCase()));
  const selectedIndices: number[] = [];
  for (const [tag, tris] of allMarkerTris.entries()) {
    const lower = tag.toLowerCase();
    if (
      preferredTags.has(lower) ||
      lower.includes("wall") ||
      lower.includes("body") ||
      lower.includes("airfoil") ||
      lower.includes("wing") ||
      lower.includes("drone") ||
      lower.includes("blade")
    ) {
      selectedIndices.push(...tris);
    }
  }

  if (selectedIndices.length === 0) {
    for (const tris of allMarkerTris.values()) {
      selectedIndices.push(...tris);
    }
  }

  if (selectedIndices.length === 0 && volTetIndices.length >= 4) {
    const faceMap = new Map<string, { count: number; tri: [number, number, number] }>();
    for (let e = 0; e < volTetIndices.length; e += 4) {
      const n0 = volTetIndices[e]!;
      const n1 = volTetIndices[e + 1]!;
      const n2 = volTetIndices[e + 2]!;
      const n3 = volTetIndices[e + 3]!;
      const faces: [number, number, number][] = [
        [n0, n2, n1],
        [n0, n1, n3],
        [n1, n2, n3],
        [n0, n3, n2],
      ];
      for (const f of faces) {
        const key = [...f].sort((a, b) => a - b).join("_");
        const entry = faceMap.get(key);
        if (entry) entry.count++;
        else faceMap.set(key, { count: 1, tri: f });
      }
    }
    for (const { count, tri } of faceMap.values()) {
      if (count === 1) selectedIndices.push(tri[0], tri[1], tri[2]);
    }
  }

  if (selectedIndices.length < 3) return null;

  // Compact to only referenced surface vertices so CFD field sampling only operates on surface nodes
  const usedMap = new Map<number, number>();
  const compactPositions: number[] = [];
  const compactIndices: number[] = [];
  const totalVerts = positions.length / 3;
  for (const origIdx of selectedIndices) {
    if (origIdx < 0 || origIdx >= totalVerts) continue;
    let newIdx = usedMap.get(origIdx);
    if (newIdx === undefined) {
      newIdx = compactPositions.length / 3;
      usedMap.set(origIdx, newIdx);
      compactPositions.push(positions[origIdx * 3]!, positions[origIdx * 3 + 1]!, positions[origIdx * 3 + 2]!);
    }
    compactIndices.push(newIdx);
  }

  if (compactPositions.length < 9 || compactIndices.length < 3) return null;
  return { positions: compactPositions, indices: compactIndices };
}
