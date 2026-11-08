// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * VTU (VTK XML Unstructured Grid) Parser
 *
 * Parses VTK XML format (.vtu) files into typed arrays suitable for
 * Three.js BufferGeometry rendering with scalar field overlays.
 *
 * Supports:
 *   - ASCII and Base64-encoded binary data
 *   - Point data (per-node scalars/vectors)
 *   - Cell data (per-element scalars/vectors)
 *   - Multiple named data arrays (fields)
 *
 * Reference: https://vtk.org/Wiki/VTK_XML_Formats
 */

// ── Types ───────────────────────────────────────────────────────

export interface VtuField {
  name: string;
  association: "point" | "cell";
  numComponents: number;
  data: Float32Array;
  range: [number, number]; // [min, max]
}

export interface VtuParseResult {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array | null;
  numPoints: number;
  numCells: number;
  fields: VtuField[];
  bounds: [number, number, number, number, number, number]; // xmin,xmax,ymin,ymax,zmin,zmax
}

// ── Parser ──────────────────────────────────────────────────────

interface XmlLikeElement {
  getAttribute(name: string): string | null;
  textContent: string | null;
  querySelector(selector: string): XmlLikeElement | null;
  querySelectorAll(selector: string): XmlLikeElement[];
}

function createHeadlessVtuDoc(xmlString: string): XmlLikeElement {
  const parseAttrs = (attrText: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    const re = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrText)) !== null) {
      attrs[m[1]!] = m[2]!;
    }
    return attrs;
  };

  const makeEl = (tag: string, attrStr: string, inner: string): XmlLikeElement => {
    const attrs = parseAttrs(attrStr);
    return {
      getAttribute: (name: string) => attrs[name] ?? null,
      textContent: inner.replace(/<[^>]+>/g, " "),
      querySelector(selector: string): XmlLikeElement | null {
        const all = this.querySelectorAll(selector);
        return all[0] ?? null;
      },
      querySelectorAll(selector: string): XmlLikeElement[] {
        const parts = selector
          .split(">")
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length === 0) return [];
        if (parts.length > 1) {
          const first = this.querySelector(parts[0]!);
          if (!first) return [];
          return first.querySelectorAll(parts.slice(1).join(" > "));
        }
        const targetTag = parts[0]!;
        const results: XmlLikeElement[] = [];
        const tagRe = new RegExp(`<${targetTag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${targetTag}>`, "g");
        let match: RegExpExecArray | null;
        while ((match = tagRe.exec(inner)) !== null) {
          results.push(makeEl(targetTag, match[1] || "", match[2] || ""));
        }
        return results;
      },
    };
  };

  return makeEl("root", "", xmlString);
}

/**
 * Parse a VTU XML string into geometry + field data.
 */
export function parseVtu(xmlString: string): VtuParseResult {
  const doc: XmlLikeElement =
    typeof DOMParser !== "undefined"
      ? (new DOMParser().parseFromString(xmlString, "application/xml") as unknown as XmlLikeElement)
      : createHeadlessVtuDoc(xmlString);

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`VTU XML parse error: ${parseError.textContent}`);
  }

  const piece = doc.querySelector("UnstructuredGrid > Piece");
  if (!piece) {
    throw new Error("No <Piece> element found in VTU file");
  }

  const numPoints = parseInt(piece.getAttribute("NumberOfPoints") || "0", 10);
  const numCells = parseInt(piece.getAttribute("NumberOfCells") || "0", 10);

  if (numPoints === 0) {
    throw new Error("VTU file contains no points");
  }

  // ── Parse points ──
  const pointsNode = piece.querySelector("Points > DataArray");
  if (!pointsNode) throw new Error("No Points DataArray found");
  const positions = parseDataArray(pointsNode, numPoints * 3);

  // ── Parse cells ──
  const cellsNode = piece.querySelector("Cells");
  let indices: Uint32Array;
  let cellConnectivity: Float32Array | null = null;
  let cellOffsets: Float32Array | null = null;

  if (cellsNode) {
    const connectivityNode = Array.from(cellsNode.querySelectorAll("DataArray")).find(
      (da) => da.getAttribute("Name") === "connectivity",
    );
    const offsetsNode = Array.from(cellsNode.querySelectorAll("DataArray")).find(
      (da) => da.getAttribute("Name") === "offsets",
    );
    const typesNode = Array.from(cellsNode.querySelectorAll("DataArray")).find(
      (da) => da.getAttribute("Name") === "types",
    );

    if (connectivityNode && offsetsNode && typesNode) {
      const triRes = triangulateFromVtkCells(connectivityNode, offsetsNode, typesNode, numCells);
      indices = triRes.indices;
      cellConnectivity = triRes.connectivity;
      cellOffsets = triRes.offsets;
    } else if (connectivityNode) {
      // Assume all triangles if no offsets/types
      const conn = parseDataArray(connectivityNode, numCells * 3);
      indices = new Uint32Array(conn);
      cellConnectivity = conn;
    } else {
      indices = new Uint32Array(0);
    }
  } else {
    indices = new Uint32Array(0);
  }

  // ── Parse fields ──
  const fields: VtuField[] = [];

  // Point data
  const pointDataNode = piece.querySelector("PointData");
  if (pointDataNode) {
    for (const da of Array.from(pointDataNode.querySelectorAll("DataArray"))) {
      const field = parseFieldDataArray(da, numPoints, "point");
      if (field) fields.push(field);
    }
  }

  // Cell data
  const cellDataNode = piece.querySelector("CellData");
  if (cellDataNode) {
    for (const da of Array.from(cellDataNode.querySelectorAll("DataArray"))) {
      const field = parseFieldDataArray(da, numCells, "cell");
      if (field) {
        fields.push(field);
        // Promote CellData to a vertex-averaged point field when no PointData with the same name exists
        if (!fields.some((f) => f.association === "point" && f.name === field.name)) {
          const promoted = promoteCellFieldToPointField(field, numPoints, numCells, cellConnectivity, cellOffsets);
          if (promoted) fields.push(promoted);
        }
      }
    }
  }

  // ── Compute bounds ──
  let xmin = Infinity,
    xmax = -Infinity;
  let ymin = Infinity,
    ymax = -Infinity;
  let zmin = Infinity,
    zmax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
  }

  // ── Compute normals ──
  const normals = computeNormals(positions, indices);

  return {
    positions: new Float32Array(positions),
    indices,
    normals,
    numPoints,
    numCells,
    fields,
    bounds: [xmin, xmax, ymin, ymax, zmin, zmax],
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function parseDataArray(node: XmlLikeElement, expectedLength?: number): Float32Array {
  const format = (node.getAttribute("format") || "ascii").toLowerCase();
  const dataType = node.getAttribute("type") || "Float32";
  const text = (node.textContent || "").trim();

  if (format === "ascii") {
    if (!text) return new Float32Array(expectedLength ?? 0);
    const values = text.split(/\s+/).map(Number);
    const len = expectedLength ?? values.length;
    const arr = new Float32Array(len);
    for (let i = 0; i < Math.min(values.length, len); i++) {
      arr[i] = values[i]!;
    }
    return arr;
  } else if (format === "binary") {
    // Base64-encoded binary
    const binary = atob(text.replace(/\s+/g, ""));
    const headerSize = 4; // UInt32 byte-count header
    const byteLength = Math.max(0, binary.length - headerSize);
    const buffer = new ArrayBuffer(byteLength);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < byteLength; i++) {
      view[i] = binary.charCodeAt(i + headerSize);
    }
    switch (dataType) {
      case "Float64":
        return new Float32Array(new Float64Array(buffer, 0, Math.floor(byteLength / 8)));
      case "Int32":
        return new Float32Array(new Int32Array(buffer, 0, Math.floor(byteLength / 4)));
      case "UInt32":
        return new Float32Array(new Uint32Array(buffer, 0, Math.floor(byteLength / 4)));
      case "Int16":
        return new Float32Array(new Int16Array(buffer, 0, Math.floor(byteLength / 2)));
      case "UInt16":
        return new Float32Array(new Uint16Array(buffer, 0, Math.floor(byteLength / 2)));
      case "Int8":
        return new Float32Array(new Int8Array(buffer));
      case "UInt8":
        return new Float32Array(new Uint8Array(buffer));
      case "Int64":
      case "UInt64": {
        const count = Math.floor(byteLength / 8);
        const dv = new DataView(buffer);
        const out = new Float32Array(count);
        const isSigned = dataType === "Int64";
        for (let i = 0; i < count; i++) {
          const val = isSigned ? dv.getBigInt64(i * 8, true) : dv.getBigUint64(i * 8, true);
          out[i] = Number(val);
        }
        return out;
      }
      case "Float32":
      default:
        return new Float32Array(buffer, 0, Math.floor(byteLength / 4));
    }
  }

  // Fallback: try parsing as ASCII
  const values = text ? text.split(/\s+/).map(Number) : [];
  return new Float32Array(values);
}

function promoteCellFieldToPointField(
  cellField: VtuField,
  numPoints: number,
  numCells: number,
  connectivity: Float32Array | null,
  offsets: Float32Array | null,
): VtuField | null {
  if (!connectivity || connectivity.length === 0 || numPoints === 0 || numCells === 0) return null;
  const nc = cellField.numComponents;
  const pointData = new Float32Array(numPoints * nc);
  const counts = new Uint32Array(numPoints);

  for (let c = 0; c < numCells; c++) {
    const start = offsets ? (c === 0 ? 0 : Math.round(offsets[c - 1]!)) : c * 3;
    const end = offsets ? Math.round(offsets[c]!) : (c + 1) * 3;
    for (let idx = start; idx < end && idx < connectivity.length; idx++) {
      const ptIdx = Math.round(connectivity[idx]!);
      if (ptIdx >= 0 && ptIdx < numPoints) {
        for (let k = 0; k < nc; k++) {
          pointData[ptIdx * nc + k] = (pointData[ptIdx * nc + k] ?? 0) + (cellField.data[c * nc + k] ?? 0);
        }
        counts[ptIdx] = (counts[ptIdx] ?? 0) + 1;
      }
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (let p = 0; p < numPoints; p++) {
    const cnt = counts[p] || 1;
    if (nc === 1) {
      const v = (pointData[p] ?? 0) / cnt;
      pointData[p] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    } else {
      let magSq = 0;
      for (let k = 0; k < nc; k++) {
        const v = (pointData[p * nc + k] ?? 0) / cnt;
        pointData[p * nc + k] = v;
        magSq += v * v;
      }
      const mag = Math.sqrt(magSq);
      if (mag < min) min = mag;
      if (mag > max) max = mag;
    }
  }

  return {
    name: cellField.name,
    association: "point",
    numComponents: nc,
    data: pointData,
    range: [Number.isFinite(min) ? min : 0, Number.isFinite(max) ? max : 1],
  };
}

function parseFieldDataArray(
  node: XmlLikeElement,
  numEntities: number,
  association: "point" | "cell",
): VtuField | null {
  const name = node.getAttribute("Name");
  if (!name) return null;

  const numComponents = parseInt(node.getAttribute("NumberOfComponents") || "1", 10);
  const data = parseDataArray(node, numEntities * numComponents);

  // Compute range
  let min = Infinity,
    max = -Infinity;
  if (numComponents === 1) {
    for (let i = 0; i < data.length; i++) {
      if (data[i]! < min) min = data[i]!;
      if (data[i]! > max) max = data[i]!;
    }
  } else {
    // For vectors, compute magnitude range
    for (let i = 0; i < data.length; i += numComponents) {
      let mag = 0;
      for (let c = 0; c < numComponents; c++) {
        mag += data[i + c]! * data[i + c]!;
      }
      mag = Math.sqrt(mag);
      if (mag < min) min = mag;
      if (mag > max) max = mag;
    }
  }

  return { name, association, numComponents, data, range: [min, max] };
}

function triangulateFromVtkCells(
  connectivityNode: XmlLikeElement,
  offsetsNode: XmlLikeElement,
  typesNode: XmlLikeElement,
  numCells: number,
): { indices: Uint32Array; connectivity: Float32Array; offsets: Float32Array } {
  const offsets = parseDataArray(offsetsNode, numCells);
  const totalConn = numCells > 0 ? Math.round(offsets[numCells - 1] ?? 0) : 0;
  const connectivity = parseDataArray(connectivityNode, totalConn > 0 ? totalConn : undefined);
  const types = parseDataArray(typesNode, numCells);

  const surfaceTriangles: number[] = [];
  const volumeFaces = new Map<string, { corners: number[]; count: number }>();

  const addVolumeFace = (corners: number[]) => {
    const key = [...corners].sort((a, b) => a - b).join(",");
    const existing = volumeFaces.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      volumeFaces.set(key, { corners, count: 1 });
    }
  };

  for (let i = 0; i < numCells; i++) {
    const start = i === 0 ? 0 : Math.round(offsets[i - 1]!);
    const end = Math.round(offsets[i]!);
    const cellSize = end - start;
    const cellType = Math.round(types[i]!);

    // VTK cell types: 5 = triangle, 9 = quad, 10/24 = tetra, 12/25 = hex, 13/26 = wedge, 14/27 = pyramid
    if ((cellType === 5 || cellType === 22) && cellSize >= 3) {
      surfaceTriangles.push(
        Math.round(connectivity[start]!),
        Math.round(connectivity[start + 1]!),
        Math.round(connectivity[start + 2]!),
      );
    } else if ((cellType === 9 || cellType === 23) && cellSize >= 4) {
      const v0 = Math.round(connectivity[start]!);
      const v1 = Math.round(connectivity[start + 1]!);
      const v2 = Math.round(connectivity[start + 2]!);
      const v3 = Math.round(connectivity[start + 3]!);
      surfaceTriangles.push(v0, v1, v2, v0, v2, v3);
    } else if ((cellType === 10 || cellType === 24) && cellSize >= 4) {
      // Tetrahedron → 4 outward-oriented faces
      const a = Math.round(connectivity[start]!);
      const b = Math.round(connectivity[start + 1]!);
      const c = Math.round(connectivity[start + 2]!);
      const d = Math.round(connectivity[start + 3]!);
      addVolumeFace([a, c, b]);
      addVolumeFace([a, b, d]);
      addVolumeFace([b, c, d]);
      addVolumeFace([a, d, c]);
    } else if ((cellType === 12 || cellType === 25) && cellSize >= 8) {
      // Hexahedron → 6 outward quad faces
      const v0 = Math.round(connectivity[start]!);
      const v1 = Math.round(connectivity[start + 1]!);
      const v2 = Math.round(connectivity[start + 2]!);
      const v3 = Math.round(connectivity[start + 3]!);
      const v4 = Math.round(connectivity[start + 4]!);
      const v5 = Math.round(connectivity[start + 5]!);
      const v6 = Math.round(connectivity[start + 6]!);
      const v7 = Math.round(connectivity[start + 7]!);
      addVolumeFace([v0, v3, v2, v1]);
      addVolumeFace([v4, v5, v6, v7]);
      addVolumeFace([v0, v1, v5, v4]);
      addVolumeFace([v1, v2, v6, v5]);
      addVolumeFace([v2, v3, v7, v6]);
      addVolumeFace([v3, v0, v4, v7]);
    } else if ((cellType === 13 || cellType === 26) && cellSize >= 6) {
      // Wedge / Prism → 2 triangles + 3 quads
      const v0 = Math.round(connectivity[start]!);
      const v1 = Math.round(connectivity[start + 1]!);
      const v2 = Math.round(connectivity[start + 2]!);
      const v3 = Math.round(connectivity[start + 3]!);
      const v4 = Math.round(connectivity[start + 4]!);
      const v5 = Math.round(connectivity[start + 5]!);
      addVolumeFace([v0, v2, v1]);
      addVolumeFace([v3, v4, v5]);
      addVolumeFace([v0, v1, v4, v3]);
      addVolumeFace([v1, v2, v5, v4]);
      addVolumeFace([v2, v0, v3, v5]);
    } else if ((cellType === 14 || cellType === 27) && cellSize >= 5) {
      // Pyramid → 1 quad base + 4 triangle sides
      const v0 = Math.round(connectivity[start]!);
      const v1 = Math.round(connectivity[start + 1]!);
      const v2 = Math.round(connectivity[start + 2]!);
      const v3 = Math.round(connectivity[start + 3]!);
      const v4 = Math.round(connectivity[start + 4]!);
      addVolumeFace([v0, v3, v2, v1]);
      addVolumeFace([v0, v1, v4]);
      addVolumeFace([v1, v2, v4]);
      addVolumeFace([v2, v3, v4]);
      addVolumeFace([v3, v0, v4]);
    } else if (cellSize >= 3) {
      // Generic polygon → fan triangulation
      const v0 = Math.round(connectivity[start]!);
      for (let j = 1; j < cellSize - 1; j++) {
        surfaceTriangles.push(v0, Math.round(connectivity[start + j]!), Math.round(connectivity[start + j + 1]!));
      }
    }
  }

  for (const { corners, count } of volumeFaces.values()) {
    if (count !== 1) continue;
    if (corners.length === 3) {
      surfaceTriangles.push(corners[0]!, corners[1]!, corners[2]!);
    } else if (corners.length === 4) {
      surfaceTriangles.push(corners[0]!, corners[1]!, corners[2]!, corners[0]!, corners[2]!, corners[3]!);
    }
  }

  return {
    indices: new Uint32Array(surfaceTriangles),
    connectivity,
    offsets,
  };
}

function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array | null {
  if (indices.length === 0) return null;

  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;

    const ax = positions[ia]!,
      ay = positions[ia + 1]!,
      az = positions[ia + 2]!;
    const bx = positions[ib]!,
      by = positions[ib + 1]!,
      bz = positions[ib + 2]!;
    const cx = positions[ic]!,
      cy = positions[ic + 1]!,
      cz = positions[ic + 2]!;

    // Edge vectors
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;

    // Cross product
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate
    normals[ia] = normals[ia]! + nx;
    normals[ia + 1] = normals[ia + 1]! + ny;
    normals[ia + 2] = normals[ia + 2]! + nz;
    normals[ib] = normals[ib]! + nx;
    normals[ib + 1] = normals[ib + 1]! + ny;
    normals[ib + 2] = normals[ib + 2]! + nz;
    normals[ic] = normals[ic]! + nx;
    normals[ic + 1] = normals[ic + 1]! + ny;
    normals[ic + 2] = normals[ic + 2]! + nz;
  }

  // Normalize
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i]! ** 2 + normals[i + 1]! ** 2 + normals[i + 2]! ** 2);
    if (len > 0) {
      normals[i] = normals[i]! / len;
      normals[i + 1] = normals[i + 1]! / len;
      normals[i + 2] = normals[i + 2]! / len;
    }
  }

  return normals;
}

// ── Synthetic VTU Generator (for testing/seeding) ───────────────

/**
 * Generate a synthetic VTU XML string representing a simple mesh with scalar fields.
 * Useful for seeding demo data without needing an actual FEA solver.
 */
export function generateSyntheticVtu(
  options: {
    gridSize?: number | undefined;
    fields?: { name: string; generator: (x: number, y: number, z: number) => number }[] | undefined;
  } = {},
): string {
  const N = options.gridSize || 20;
  const fields = options.fields || [
    {
      name: "vonMisesStress",
      generator: (x: number, y: number) => {
        // Stress concentration at center
        const r = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2);
        return Math.max(0, 450e6 * (1 - r * 1.5) * (1 + 0.3 * Math.sin(x * 10)));
      },
    },
    {
      name: "Displacement",
      generator: (x: number, y: number) => {
        return 0.002 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
      },
    },
    {
      name: "Temperature",
      generator: (x: number, y: number) => {
        return 293 + 200 * Math.exp(-((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.1);
      },
    },
  ];

  // Generate a flat plate mesh
  const points: number[] = [];
  const cells: number[] = [];
  const offsets: number[] = [];
  const types: number[] = [];
  const fieldData: Map<string, number[]> = new Map();

  for (const f of fields) fieldData.set(f.name, []);

  // Points
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      const y = j / N;
      const z = 0.05 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y); // Slight deformation
      points.push(x, y, z);

      for (const f of fields) {
        fieldData.get(f.name)!.push(f.generator(x, y, z));
      }
    }
  }

  // Cells (triangles from quads)
  let offset = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const p0 = j * (N + 1) + i;
      const p1 = p0 + 1;
      const p2 = (j + 1) * (N + 1) + i;
      const p3 = p2 + 1;

      // Triangle 1
      cells.push(p0, p1, p3);
      offset += 3;
      offsets.push(offset);
      types.push(5); // VTK_TRIANGLE

      // Triangle 2
      cells.push(p0, p3, p2);
      offset += 3;
      offsets.push(offset);
      types.push(5);
    }
  }

  const numPoints = (N + 1) * (N + 1);
  const numCells = N * N * 2;

  let xml = `<?xml version="1.0"?>
<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">
  <UnstructuredGrid>
    <Piece NumberOfPoints="${numPoints}" NumberOfCells="${numCells}">
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          ${points.join(" ")}
        </DataArray>
      </Points>
      <Cells>
        <DataArray type="Int32" Name="connectivity" format="ascii">
          ${cells.join(" ")}
        </DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">
          ${offsets.join(" ")}
        </DataArray>
        <DataArray type="UInt8" Name="types" format="ascii">
          ${types.join(" ")}
        </DataArray>
      </Cells>
      <PointData>`;

  for (const f of fields) {
    const data = fieldData.get(f.name)!;
    xml += `
        <DataArray type="Float32" Name="${f.name}" NumberOfComponents="1" format="ascii">
          ${data.join(" ")}
        </DataArray>`;
  }

  xml += `
      </PointData>
    </Piece>
  </UnstructuredGrid>
</VTKFile>`;

  return xml;
}
