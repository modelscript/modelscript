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

/**
 * Parse a VTU XML string into geometry + field data.
 */
export function parseVtu(xmlString: string): VtuParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

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
      indices = triangulateFromVtkCells(connectivityNode, offsetsNode, typesNode, numCells);
    } else if (connectivityNode) {
      // Assume all triangles if no offsets/types
      const conn = parseDataArray(connectivityNode, numCells * 3);
      indices = new Uint32Array(conn);
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
      if (field) fields.push(field);
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
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
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

function parseDataArray(node: Element, expectedLength: number): Float32Array {
  const format = node.getAttribute("format") || "ascii";
  const text = (node.textContent || "").trim();

  if (format === "ascii") {
    const values = text.split(/\s+/).map(Number);
    const arr = new Float32Array(expectedLength);
    for (let i = 0; i < Math.min(values.length, expectedLength); i++) {
      arr[i] = values[i];
    }
    return arr;
  } else if (format === "binary") {
    // Base64-encoded binary
    const binary = atob(text);
    // VTK prepends a header with the byte count (4 or 8 bytes)
    const headerSize = 4; // UInt32 header
    const buffer = new ArrayBuffer(binary.length - headerSize);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < buffer.byteLength; i++) {
      view[i] = binary.charCodeAt(i + headerSize);
    }
    return new Float32Array(buffer);
  }

  // Fallback: try parsing as ASCII
  const values = text.split(/\s+/).map(Number);
  return new Float32Array(values);
}

function parseFieldDataArray(node: Element, numEntities: number, association: "point" | "cell"): VtuField | null {
  const name = node.getAttribute("Name");
  if (!name) return null;

  const numComponents = parseInt(node.getAttribute("NumberOfComponents") || "1", 10);
  const data = parseDataArray(node, numEntities * numComponents);

  // Compute range
  let min = Infinity,
    max = -Infinity;
  if (numComponents === 1) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
  } else {
    // For vectors, compute magnitude range
    for (let i = 0; i < data.length; i += numComponents) {
      let mag = 0;
      for (let c = 0; c < numComponents; c++) {
        mag += data[i + c] * data[i + c];
      }
      mag = Math.sqrt(mag);
      if (mag < min) min = mag;
      if (mag > max) max = mag;
    }
  }

  return { name, association, numComponents, data, range: [min, max] };
}

function triangulateFromVtkCells(
  connectivityNode: Element,
  offsetsNode: Element,
  typesNode: Element,
  numCells: number,
): Uint32Array {
  const connectivityText = (connectivityNode.textContent || "").trim();
  const connectivity = connectivityText.split(/\s+/).map(Number);

  const offsetsText = (offsetsNode.textContent || "").trim();
  const offsets = offsetsText.split(/\s+/).map(Number);

  const typesText = (typesNode.textContent || "").trim();
  const types = typesText.split(/\s+/).map(Number);

  const triangles: number[] = [];

  for (let i = 0; i < numCells; i++) {
    const start = i === 0 ? 0 : offsets[i - 1];
    const end = offsets[i];
    const cellSize = end - start;
    const cellType = types[i];

    // VTK cell types: 5 = triangle, 9 = quad, 10 = tetra, etc.
    if (cellType === 5 && cellSize === 3) {
      // Triangle
      triangles.push(connectivity[start], connectivity[start + 1], connectivity[start + 2]);
    } else if (cellType === 9 && cellSize === 4) {
      // Quad → 2 triangles
      triangles.push(connectivity[start], connectivity[start + 1], connectivity[start + 2]);
      triangles.push(connectivity[start], connectivity[start + 2], connectivity[start + 3]);
    } else if (cellType === 10 && cellSize === 4) {
      // Tetrahedron → 4 triangles (surface faces)
      const [a, b, c, d] = [
        connectivity[start],
        connectivity[start + 1],
        connectivity[start + 2],
        connectivity[start + 3],
      ];
      triangles.push(a, b, c);
      triangles.push(a, b, d);
      triangles.push(a, c, d);
      triangles.push(b, c, d);
    } else if (cellType === 12 && cellSize === 8) {
      // Hexahedron → 12 triangles (6 quad faces)
      const v = connectivity.slice(start, end);
      // front, back, left, right, top, bottom
      triangles.push(v[0], v[1], v[2], v[0], v[2], v[3]); // front
      triangles.push(v[4], v[7], v[6], v[4], v[6], v[5]); // back
      triangles.push(v[0], v[4], v[5], v[0], v[5], v[1]); // bottom
      triangles.push(v[2], v[6], v[7], v[2], v[7], v[3]); // top
      triangles.push(v[0], v[3], v[7], v[0], v[7], v[4]); // left
      triangles.push(v[1], v[5], v[6], v[1], v[6], v[2]); // right
    } else if (cellSize >= 3) {
      // Generic polygon → fan triangulation
      for (let j = 1; j < cellSize - 1; j++) {
        triangles.push(connectivity[start], connectivity[start + j], connectivity[start + j + 1]);
      }
    }
  }

  return new Uint32Array(triangles);
}

function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array | null {
  if (indices.length === 0) return null;

  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;

    const ax = positions[ia],
      ay = positions[ia + 1],
      az = positions[ia + 2];
    const bx = positions[ib],
      by = positions[ib + 1],
      bz = positions[ib + 2];
    const cx = positions[ic],
      cy = positions[ic + 1],
      cz = positions[ic + 2];

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
    normals[ia] += nx;
    normals[ia + 1] += ny;
    normals[ia + 2] += nz;
    normals[ib] += nx;
    normals[ib + 1] += ny;
    normals[ib + 2] += nz;
    normals[ic] += nx;
    normals[ic + 1] += ny;
    normals[ic + 2] += nz;
  }

  // Normalize
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
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
    gridSize?: number;
    fields?: { name: string; generator: (x: number, y: number, z: number) => number }[];
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
