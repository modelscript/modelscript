// SPDX-License-Identifier: AGPL-3.0-or-later

import { type CadComponent } from "@modelscript/cad-viewer";

/** Extract STEP filename from // @step-file: annotation or ISO-10303-21 FILE_NAME header. */
export function extractStepFilename(code: string): string | null {
  const commentMatch = /\/\/\s*@step-file:\s*([^\s\n]+)/i.exec(code);
  if (commentMatch?.[1]) return commentMatch[1].trim();
  const headerMatch = /FILE_NAME\s*\(\s*'([^']+)'/i.exec(code);
  if (headerMatch?.[1]) return headerMatch[1].trim();
  return null;
}

/** Detect if the editor text is an ISO-10303-21 STEP file. */
export function isStepSource(code: string, dialect?: string): boolean {
  if (dialect === "step") return true;
  const trimmed = code.trimStart();
  if (trimmed.startsWith("ISO-10303-21;")) return true;
  return code.includes("HEADER;") && code.includes("DATA;");
}

interface TriangulatedMesh {
  positions: number[];
  normals: number[];
}

function pushTriangle(
  out: TriangulatedMesh,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  out.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  out.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

function appendSphereTriangles(
  out: TriangulatedMesh,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  latBands = 16,
  lonBands = 24,
): void {
  for (let lat = 0; lat < latBands; lat++) {
    const theta0 = (lat / latBands) * Math.PI;
    const theta1 = ((lat + 1) / latBands) * Math.PI;
    const sinT0 = Math.sin(theta0);
    const cosT0 = Math.cos(theta0);
    const sinT1 = Math.sin(theta1);
    const cosT1 = Math.cos(theta1);

    for (let lon = 0; lon < lonBands; lon++) {
      const phi0 = (lon / lonBands) * Math.PI * 2;
      const phi1 = ((lon + 1) / lonBands) * Math.PI * 2;
      const cosP0 = Math.cos(phi0);
      const sinP0 = Math.sin(phi0);
      const cosP1 = Math.cos(phi1);
      const sinP1 = Math.sin(phi1);

      const p00: [number, number, number] = [
        cx + radius * sinT0 * cosP0,
        cy + radius * cosT0,
        cz + radius * sinT0 * sinP0,
      ];
      const p01: [number, number, number] = [
        cx + radius * sinT0 * cosP1,
        cy + radius * cosT0,
        cz + radius * sinT0 * sinP1,
      ];
      const p10: [number, number, number] = [
        cx + radius * sinT1 * cosP0,
        cy + radius * cosT1,
        cz + radius * sinT1 * sinP0,
      ];
      const p11: [number, number, number] = [
        cx + radius * sinT1 * cosP1,
        cy + radius * cosT1,
        cz + radius * sinT1 * sinP1,
      ];

      if (lat !== 0) {
        pushTriangle(out, p00, p10, p01);
      }
      if (lat !== latBands - 1) {
        pushTriangle(out, p01, p10, p11);
      }
    }
  }
}

/** Build a binary STL Uint8Array from triangulated positions & normals. */
export function buildBinaryStlBuffer(mesh: TriangulatedMesh): Uint8Array {
  const triCount = Math.floor(mesh.positions.length / 9);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = new TextEncoder().encode("ModelScript STEP B-Rep Tessellation");
  new Uint8Array(buf, 0, header.length).set(header);
  view.setUint32(80, triCount, true);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    view.setFloat32(offset + 0, mesh.normals[b] ?? 0, true);
    view.setFloat32(offset + 4, mesh.normals[b + 1] ?? 1, true);
    view.setFloat32(offset + 8, mesh.normals[b + 2] ?? 0, true);
    for (let k = 0; k < 9; k++) {
      view.setFloat32(offset + 12 + k * 4, mesh.positions[b + k] ?? 0, true);
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return new Uint8Array(buf);
}

/** Build a VTK XML PolyData Uint8Array buffer understood by VtkRenderer. */
export function buildVtkXmlBuffer(mesh: TriangulatedMesh): Uint8Array {
  const ptCount = Math.floor(mesh.positions.length / 3);
  const triCount = Math.floor(ptCount / 3);
  const coordStrs: string[] = [];
  const scalarStrs: string[] = [];
  const connStrs: string[] = [];
  const offsetStrs: string[] = [];
  for (let i = 0; i < ptCount; i++) {
    const x = mesh.positions[i * 3] ?? 0;
    const y = mesh.positions[i * 3 + 1] ?? 0;
    const z = mesh.positions[i * 3 + 2] ?? 0;
    coordStrs.push(`${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
    scalarStrs.push(Math.hypot(x, y, z).toFixed(4));
  }
  for (let t = 0; t < triCount; t++) {
    connStrs.push(`${t * 3} ${t * 3 + 1} ${t * 3 + 2}`);
    offsetStrs.push(String((t + 1) * 3));
  }
  const xml = `<VTKFile type="PolyData" version="1.0">
  <PolyData>
    <Piece NumberOfPoints="${ptCount}" NumberOfPolys="${triCount}">
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          ${coordStrs.join(" ")}
        </DataArray>
      </Points>
      <Polys>
        <DataArray type="Int32" Name="connectivity" format="ascii">
          ${connStrs.join(" ")}
        </DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">
          ${offsetStrs.join(" ")}
        </DataArray>
      </Polys>
      <PointData>
        <DataArray type="Float32" Name="Coordinate_Norm" format="ascii">
          ${scalarStrs.join(" ")}
        </DataArray>
      </PointData>
    </Piece>
  </PolyData>
</VTKFile>`;
  return new TextEncoder().encode(xml);
}

/** Build a glTF 2.0 binary (.glb) data URI from triangulated positions & normals for CadViewer. */
export function buildGlbDataUri(
  mesh: TriangulatedMesh,
  partName = "StepPart",
  color: [number, number, number, number] = [0.24, 0.62, 0.92, 1.0],
): string {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  if (vertexCount === 0) return "";
  const posArray = new Float32Array(mesh.positions);
  const normArray = new Float32Array(mesh.normals);

  const minPos: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxPos: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    const x = posArray[i * 3]!;
    const y = posArray[i * 3 + 1]!;
    const z = posArray[i * 3 + 2]!;
    if (x < minPos[0]) minPos[0] = x;
    if (y < minPos[1]) minPos[1] = y;
    if (z < minPos[2]) minPos[2] = z;
    if (x > maxPos[0]) maxPos[0] = x;
    if (y > maxPos[1]) maxPos[1] = y;
    if (z > maxPos[2]) maxPos[2] = z;
  }

  const posBytes = posArray.byteLength;
  const normBytes = normArray.byteLength;
  const rawBinBytes = posBytes + normBytes;
  const binChunkLength = (rawBinBytes + 3) & ~3;

  const gltfJson = {
    asset: { version: "2.0", generator: "ModelScript STEP B-Rep Tessellator" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: partName }],
    meshes: [
      {
        name: partName,
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }],
      },
    ],
    materials: [
      {
        name: `${partName}_Mat`,
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: color,
          metallicFactor: 0.35,
          roughnessFactor: 0.35,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
        min: minPos,
        max: maxPos,
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: normBytes, target: 34962 },
    ],
    buffers: [{ byteLength: binChunkLength }],
  };

  const jsonBytesRaw = new TextEncoder().encode(JSON.stringify(gltfJson));
  const jsonChunkLength = (jsonBytesRaw.byteLength + 3) & ~3;
  const totalByteLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

  const glb = new ArrayBuffer(totalByteLength);
  const view = new DataView(glb);
  const u8 = new Uint8Array(glb);

  // Header
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, totalByteLength, true);

  // JSON chunk
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  u8.set(jsonBytesRaw, 20);
  for (let i = jsonBytesRaw.byteLength; i < jsonChunkLength; i++) {
    u8[20 + i] = 0x20; // pad with space
  }

  // BIN chunk
  const binStart = 20 + jsonChunkLength;
  view.setUint32(binStart, binChunkLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  u8.set(new Uint8Array(posArray.buffer), binStart + 8);
  u8.set(new Uint8Array(normArray.buffer), binStart + 8 + posBytes);

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunkSize)));
  }
  return `data:model/gltf-binary;base64,${btoa(binary)}`;
}

/**
 * Deterministic ISO-10303-21 STEP B-Rep parser & triangulator.
 * Extracts PRODUCT, MANIFOLD_SOLID_BREP, ADVANCED_FACE, EDGE_LOOP, VERTEX_POINT,
 * CARTESIAN_POINT, AXIS2_PLACEMENT_3D, and NEXT_ASSEMBLY_USAGE_OCCURRENCE entities.
 */
export function tessellateStepSource(
  stepCode: string,
  options?: {
    /**
     * Rescale large (millimeter) models to fit a unit viewport. Defaults to true; pass `false` to keep
     * native STEP coordinates, e.g. when registering the model against QIF inspection coordinates.
     */
    normalize?: boolean;
  },
): {
  vtkBuffer: Uint8Array;
  stlBuffer: Uint8Array;
  components: CadComponent[];
} {
  const cartesianPoints = new Map<number, [number, number, number]>();
  const directions = new Map<number, [number, number, number]>();
  const axisPlacements = new Map<number, { ptId: number; zDirId?: number; xDirId?: number }>();
  const cylSurfaces = new Map<number, { axisId: number; radius: number }>();
  const coneSurfaces = new Map<number, { axisId: number; radius: number; semiAngle: number }>();
  const sphSurfaces = new Map<number, { axisId: number; radius: number }>();
  const torSurfaces = new Map<number, { axisId: number; major: number; minor: number }>();
  const vertexPoints = new Map<number, number>();
  const edgeCurves = new Map<number, [number, number]>();
  const orientedEdges = new Map<number, { edge: number; sense: boolean }>();
  const edgeLoops = new Map<number, number[]>();
  const polyLoops = new Map<number, number[]>();
  const faceBounds = new Map<number, { loopId: number; isOuter: boolean }>();
  const faceById = new Map<
    number,
    { id: number; name: string; bounds: number[]; surfaceId?: number; sameSense: boolean }
  >();
  const shells = new Map<number, number[]>();
  const advancedFaces: { id: number; name: string; bounds: number[]; surfaceId?: number; sameSense: boolean }[] = [];
  const manifoldBreps: { id: number; name: string; shellId: number }[] = [];
  const products: { id: number; name: string }[] = [];
  const placements: { id: number; name: string; ptId: number }[] = [];
  const nauos: { id: number; name: string; relating: number; related: number }[] = [];

  const stmtRegex = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let match: RegExpExecArray | null;
  while ((match = stmtRegex.exec(stepCode)) !== null) {
    const id = parseInt(match[1]!, 10);
    const type = match[2]!.toUpperCase();
    const args = match[3]!;

    if (type === "CARTESIAN_POINT" || type === "DIRECTION") {
      const coordsMatch =
        /\(\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)(?:\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?))?\s*\)/.exec(
          args,
        );
      if (coordsMatch) {
        const vec: [number, number, number] = [
          parseFloat(coordsMatch[1] || "0"),
          parseFloat(coordsMatch[2] || "0"),
          parseFloat(coordsMatch[3] || "0"),
        ];
        if (type === "CARTESIAN_POINT") {
          cartesianPoints.set(id, vec);
        } else {
          directions.set(id, vec);
        }
      }
    } else if (type === "VERTEX_POINT") {
      const refMatch = /#(\d+)/.exec(args);
      if (refMatch) vertexPoints.set(id, parseInt(refMatch[1]!, 10));
    } else if (type === "EDGE_CURVE") {
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      if (refs.length >= 2) edgeCurves.set(id, [refs[0]!, refs[1]!]);
    } else if (type === "ORIENTED_EDGE") {
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      const sense = !args.includes(".F.");
      if (refs.length > 0) {
        orientedEdges.set(id, { edge: refs[refs.length - 1]!, sense });
      }
    } else if (type === "EDGE_LOOP") {
      const innerList = /\(([\s\S]*)\)/.exec(args)?.[1] ?? args;
      const refs = Array.from(innerList.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      edgeLoops.set(id, refs);
    } else if (type === "POLY_LOOP") {
      const innerList = /\(([\s\S]*)\)/.exec(args)?.[1] ?? args;
      const refs = Array.from(innerList.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      polyLoops.set(id, refs);
    } else if (type === "FACE_OUTER_BOUND" || type === "FACE_BOUND") {
      const refMatch = /#(\d+)/.exec(args);
      if (refMatch) faceBounds.set(id, { loopId: parseInt(refMatch[1]!, 10), isOuter: type === "FACE_OUTER_BOUND" });
    } else if (type === "CYLINDRICAL_SURFACE" || type === "SPHERICAL_SURFACE") {
      const axisMatch = /#(\d+)/.exec(args);
      const nums = Array.from(args.replace(/#\d+/g, "").matchAll(/([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g)).map((m) =>
        parseFloat(m[1]!),
      );
      const axisId = axisMatch ? parseInt(axisMatch[1]!, 10) : 0;
      const radius = nums[nums.length - 1] ?? 1;
      if (type === "CYLINDRICAL_SURFACE") {
        cylSurfaces.set(id, { axisId, radius });
      } else {
        sphSurfaces.set(id, { axisId, radius });
      }
    } else if (type === "CONICAL_SURFACE") {
      const axisMatch = /#(\d+)/.exec(args);
      const nums = Array.from(args.replace(/#\d+/g, "").matchAll(/([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g)).map((m) =>
        parseFloat(m[1]!),
      );
      const axisId = axisMatch ? parseInt(axisMatch[1]!, 10) : 0;
      coneSurfaces.set(id, {
        axisId,
        radius: nums.length >= 2 ? nums[nums.length - 2]! : 1,
        semiAngle: nums[nums.length - 1] ?? 0,
      });
    } else if (type === "TOROIDAL_SURFACE") {
      const axisMatch = /#(\d+)/.exec(args);
      const nums = Array.from(args.replace(/#\d+/g, "").matchAll(/([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g)).map((m) =>
        parseFloat(m[1]!),
      );
      const axisId = axisMatch ? parseInt(axisMatch[1]!, 10) : 0;
      torSurfaces.set(id, {
        axisId,
        major: nums.length >= 2 ? nums[nums.length - 2]! : 1,
        minor: nums[nums.length - 1] ?? 0.25,
      });
    } else if (type === "ADVANCED_FACE" || type === "FACE_SURFACE") {
      const nameMatch = /'([^']*)'/.exec(args);
      const boundListMatch = /\(([^)]*)\)/.exec(args);
      const bounds = boundListMatch
        ? Array.from(boundListMatch[1]!.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10))
        : [];
      const tailArgs = boundListMatch ? args.slice(boundListMatch.index + boundListMatch[0].length) : args;
      const surfMatch = /#(\d+)/.exec(tailArgs);
      const surfaceId = surfMatch ? parseInt(surfMatch[1]!, 10) : undefined;
      const sameSense = !/\.\s*F\s*\./.test(tailArgs);
      const faceObj = { id, name: nameMatch?.[1] || `Face_${id}`, bounds, surfaceId, sameSense };
      advancedFaces.push(faceObj);
      faceById.set(id, faceObj);
    } else if (type === "CLOSED_SHELL" || type === "OPEN_SHELL") {
      const faceListMatch = /\(([\s\S]*)\)/.exec(args);
      const faceIds = faceListMatch
        ? Array.from(faceListMatch[1]!.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10))
        : [];
      shells.set(id, faceIds);
    } else if (type === "MANIFOLD_SOLID_BREP") {
      const nameMatch = /'([^']*)'/.exec(args);
      const refMatch = /#(\d+)/.exec(args);
      manifoldBreps.push({
        id,
        name: nameMatch?.[1] || `Solid_${id}`,
        shellId: refMatch ? parseInt(refMatch[1]!, 10) : 0,
      });
    } else if (type === "PRODUCT") {
      const strMatches = Array.from(args.matchAll(/'([^']*)'/g)).map((m) => m[1]!);
      const name = strMatches[1] || strMatches[0] || `Product_${id}`;
      products.push({ id, name });
    } else if (type === "AXIS2_PLACEMENT_3D") {
      const nameMatch = /'([^']*)'/.exec(args);
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      const ptId = refs[0] ?? 0;
      placements.push({ id, name: nameMatch?.[1] || `Axis_${id}`, ptId });
      axisPlacements.set(id, { ptId, zDirId: refs[1], xDirId: refs[2] });
    } else if (type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") {
      const strMatches = Array.from(args.matchAll(/'([^']*)'/g)).map((m) => m[1]!);
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      nauos.push({
        id,
        name: strMatches[1] || strMatches[0] || `Assy_${id}`,
        relating: refs[0] ?? 0,
        related: refs[1] ?? 0,
      });
    }
  }

  // Normalize coordinate scale if points are in millimeters (> 10 units)
  let maxCoord = 0;
  for (const pt of cartesianPoints.values()) {
    maxCoord = Math.max(maxCoord, Math.abs(pt[0]), Math.abs(pt[1]), Math.abs(pt[2]));
  }
  const scaleFactor = options?.normalize !== false && maxCoord > 10 ? (1 / maxCoord) * 1.5 : 1.0;

  const getPoint = (ptOrVertexId: number): [number, number, number] | null => {
    const direct = cartesianPoints.get(ptOrVertexId);
    if (direct) return [direct[0] * scaleFactor, direct[1] * scaleFactor, direct[2] * scaleFactor];
    const vPtId = vertexPoints.get(ptOrVertexId);
    if (vPtId !== undefined) {
      const p = cartesianPoints.get(vPtId);
      if (p) return [p[0] * scaleFactor, p[1] * scaleFactor, p[2] * scaleFactor];
    }
    return null;
  };

  const mesh: TriangulatedMesh = { positions: [], normals: [] };

  const dist3 = (a: [number, number, number], b: [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const norm3 = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  const cross3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  const dot3 = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const resolveAxisFrame = (axisId: number) => {
    const ax = axisPlacements.get(axisId);
    const origin = (ax ? getPoint(ax.ptId) : null) ?? ([0, 0, 0] as [number, number, number]);
    const rawZ = ax?.zDirId !== undefined ? directions.get(ax.zDirId) : undefined;
    const zAxis = norm3(rawZ ?? [0, 0, 1]);
    const rawX = ax?.xDirId !== undefined ? directions.get(ax.xDirId) : undefined;
    let xCandidate: [number, number, number] = rawX ?? (Math.abs(zAxis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
    const proj = dot3(xCandidate, zAxis);
    xCandidate = [xCandidate[0] - proj * zAxis[0], xCandidate[1] - proj * zAxis[1], xCandidate[2] - proj * zAxis[2]];
    const xAxis = norm3(xCandidate);
    const yAxis = norm3(cross3(zAxis, xAxis));
    return { origin, xAxis, yAxis, zAxis };
  };

  const emitTri = (
    targetMesh: TriangulatedMesh,
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    flip = false,
  ) => {
    if (flip) {
      pushTriangle(targetMesh, a, c, b);
      pushTriangle(mesh, a, c, b);
    } else {
      pushTriangle(targetMesh, a, b, c);
      pushTriangle(mesh, a, b, c);
    }
  };

  const pushUniquePt = (arr: [number, number, number][], p: [number, number, number]) => {
    if (arr.length > 0) {
      const last = arr[arr.length - 1]!;
      if (dist3(last, p) < 1e-6) return;
    }
    arr.push(p);
  };

  const resolveEdgeLoopPts = (oEdges: number[]): [number, number, number][] => {
    const segs: [[number, number, number], [number, number, number]][] = [];
    for (const oeId of oEdges) {
      const oe = orientedEdges.get(oeId);
      const ecId = oe ? oe.edge : oeId;
      const ec = edgeCurves.get(ecId);
      if (ec) {
        const p0 = getPoint(oe && !oe.sense ? ec[1] : ec[0]);
        const p1 = getPoint(oe && !oe.sense ? ec[0] : ec[1]);
        if (p0 && p1) segs.push([p0, p1]);
      }
    }
    if (segs.length < 2) return [];
    const pts: [number, number, number][] = [];
    let firstSeg = segs[0]!;
    const secondSeg = segs[1]!;
    const dEnd = Math.min(dist3(firstSeg[1], secondSeg[0]), dist3(firstSeg[1], secondSeg[1]));
    const dStart = Math.min(dist3(firstSeg[0], secondSeg[0]), dist3(firstSeg[0], secondSeg[1]));
    if (dStart + 1e-6 < dEnd) {
      firstSeg = [firstSeg[1], firstSeg[0]];
    }
    pushUniquePt(pts, firstSeg[0]);
    pushUniquePt(pts, firstSeg[1]);
    for (let i = 1; i < segs.length; i++) {
      let seg = segs[i]!;
      const lastPt = pts[pts.length - 1]!;
      if (dist3(lastPt, seg[1]) + 1e-6 < dist3(lastPt, seg[0])) {
        seg = [seg[1], seg[0]];
      }
      pushUniquePt(pts, seg[0]);
      pushUniquePt(pts, seg[1]);
    }
    if (pts.length >= 2 && dist3(pts[0]!, pts[pts.length - 1]!) < 1e-5) {
      pts.pop();
    }
    return pts;
  };

  /** Ear-clipping planar polygon triangulator preserving concave L/U shapes. */
  const triangulatePolygon3D = (pts: [number, number, number][], targetMesh: TriangulatedMesh) => {
    if (pts.length < 3) return;
    if (pts.length === 3) {
      emitTri(targetMesh, pts[0]!, pts[1]!, pts[2]!);
      return;
    }
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const n = norm3([nx, ny, nz]);
    const ref: [number, number, number] = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm3(cross3(n, ref));
    const v = norm3(cross3(n, u));
    const proj2D = pts.map((p) => [dot3(p, u), dot3(p, v)] as [number, number]);
    const indices = pts.map((_, idx) => idx);
    let area2 = 0;
    for (let i = 0; i < proj2D.length; i++) {
      const a = proj2D[i]!;
      const b = proj2D[(i + 1) % proj2D.length]!;
      area2 += a[0] * b[1] - b[0] * a[1];
    }
    const ccw = area2 >= 0;
    const cross2 = (a: [number, number], b: [number, number], c: [number, number]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const pointInTri = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
      const s1 = cross2(a, b, p);
      const s2 = cross2(b, c, p);
      const s3 = cross2(c, a, p);
      return ccw ? s1 >= -1e-7 && s2 >= -1e-7 && s3 >= -1e-7 : s1 <= 1e-7 && s2 <= 1e-7 && s3 <= 1e-7;
    };
    let guard = indices.length * indices.length + 10;
    while (indices.length > 3 && guard-- > 0) {
      let clipped = false;
      for (let i = 0; i < indices.length; i++) {
        const i0 = indices[(i - 1 + indices.length) % indices.length]!;
        const i1 = indices[i]!;
        const i2 = indices[(i + 1) % indices.length]!;
        const cr = cross2(proj2D[i0]!, proj2D[i1]!, proj2D[i2]!);
        if (ccw ? cr <= 1e-7 : cr >= -1e-7) continue;
        let hasInside = false;
        for (const other of indices) {
          if (other === i0 || other === i1 || other === i2) continue;
          if (pointInTri(proj2D[other]!, proj2D[i0]!, proj2D[i1]!, proj2D[i2]!)) {
            hasInside = true;
            break;
          }
        }
        if (!hasInside) {
          emitTri(targetMesh, pts[i0]!, pts[i1]!, pts[i2]!);
          indices.splice(i, 1);
          clipped = true;
          break;
        }
      }
      if (!clipped) break;
    }
    for (let i = 1; i + 1 < indices.length; i++) {
      emitTri(targetMesh, pts[indices[0]!]!, pts[indices[i]!]!, pts[indices[i + 1]!]!);
    }
  };

  const collectFaceBoundVertices = (bounds: number[]): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (const bId of bounds) {
      const entry = faceBounds.get(bId);
      const loopId = entry?.loopId ?? bId;
      triangulatedLoopIds.add(loopId);
      const polyPts = polyLoops.get(loopId);
      if (polyPts) {
        for (const vId of polyPts) {
          const p = getPoint(vId);
          if (p) out.push(p);
        }
      }
      const oEdges = edgeLoops.get(loopId);
      if (oEdges) {
        for (const oeId of oEdges) {
          const oe = orientedEdges.get(oeId);
          const ec = edgeCurves.get(oe ? oe.edge : oeId);
          if (ec) {
            const p0 = getPoint(ec[0]);
            const p1 = getPoint(ec[1]);
            if (p0) out.push(p0);
            if (p1) out.push(p1);
          }
        }
      }
    }
    return out;
  };

  const triangulatedLoopIds = new Set<number>();
  const tessellateFace = (
    face: { id: number; name: string; bounds: number[]; surfaceId?: number; sameSense: boolean },
    targetMesh: TriangulatedMesh,
  ) => {
    if (face.surfaceId !== undefined) {
      const cyl = cylSurfaces.get(face.surfaceId) ?? coneSurfaces.get(face.surfaceId);
      if (cyl) {
        const boundPts = collectFaceBoundVertices(face.bounds);
        const { origin, xAxis, yAxis, zAxis } = resolveAxisFrame(cyl.axisId);
        let zMin = Infinity;
        let zMax = -Infinity;
        for (const p of boundPts) {
          const z = dot3([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], zAxis);
          if (z < zMin) zMin = z;
          if (z > zMax) zMax = z;
        }
        if (Number.isFinite(zMin) && Number.isFinite(zMax) && zMax - zMin > 1e-6) {
          const semiAngle = "semiAngle" in cyl && typeof cyl.semiAngle === "number" ? cyl.semiAngle : 0;
          const rBase = cyl.radius * scaleFactor;
          const r0 = Math.max(1e-4, rBase + zMin * Math.tan(semiAngle));
          const r1 = Math.max(1e-4, rBase + zMax * Math.tan(semiAngle));
          const segs = 24;
          const flip = !face.sameSense;
          for (let i = 0; i < segs; i++) {
            const a0 = (i / segs) * Math.PI * 2;
            const a1 = ((i + 1) / segs) * Math.PI * 2;
            const c0 = Math.cos(a0);
            const s0 = Math.sin(a0);
            const c1 = Math.cos(a1);
            const s1 = Math.sin(a1);
            const pt = (r: number, c: number, s: number, z: number): [number, number, number] => [
              origin[0] + r * (c * xAxis[0] + s * yAxis[0]) + z * zAxis[0],
              origin[1] + r * (c * xAxis[1] + s * yAxis[1]) + z * zAxis[1],
              origin[2] + r * (c * xAxis[2] + s * yAxis[2]) + z * zAxis[2],
            ];
            const p00 = pt(r0, c0, s0, zMin);
            const p10 = pt(r0, c1, s1, zMin);
            const p11 = pt(r1, c1, s1, zMax);
            const p01 = pt(r1, c0, s0, zMax);
            emitTri(targetMesh, p00, p10, p11, flip);
            emitTri(targetMesh, p00, p11, p01, flip);
          }
          return;
        }
      }

      const sph = sphSurfaces.get(face.surfaceId);
      if (sph) {
        collectFaceBoundVertices(face.bounds);
        const { origin } = resolveAxisFrame(sph.axisId);
        const r = Math.max(1e-4, sph.radius * scaleFactor);
        appendSphereTriangles(targetMesh, origin[0], origin[1], origin[2], r, 14, 24);
        appendSphereTriangles(mesh, origin[0], origin[1], origin[2], r, 14, 24);
        return;
      }

      const tor = torSurfaces.get(face.surfaceId);
      if (tor) {
        collectFaceBoundVertices(face.bounds);
        const { origin, xAxis, yAxis, zAxis } = resolveAxisFrame(tor.axisId);
        const maj = Math.max(1e-4, tor.major * scaleFactor);
        const minR = Math.max(1e-4, tor.minor * scaleFactor);
        const majSegs = 24;
        const minSegs = 14;
        const flip = !face.sameSense;
        const ptT = (uA: number, vA: number): [number, number, number] => {
          const cu = Math.cos(uA);
          const su = Math.sin(uA);
          const cv = Math.cos(vA);
          const sv = Math.sin(vA);
          const ringR = maj + minR * cv;
          return [
            origin[0] + ringR * (cu * xAxis[0] + su * yAxis[0]) + minR * sv * zAxis[0],
            origin[1] + ringR * (cu * xAxis[1] + su * yAxis[1]) + minR * sv * zAxis[1],
            origin[2] + ringR * (cu * xAxis[2] + su * yAxis[2]) + minR * sv * zAxis[2],
          ];
        };
        for (let i = 0; i < majSegs; i++) {
          const u0 = (i / majSegs) * Math.PI * 2;
          const u1 = ((i + 1) / majSegs) * Math.PI * 2;
          for (let j = 0; j < minSegs; j++) {
            const v0 = (j / minSegs) * Math.PI * 2;
            const v1 = ((j + 1) / minSegs) * Math.PI * 2;
            const p00 = ptT(u0, v0);
            const p10 = ptT(u1, v0);
            const p11 = ptT(u1, v1);
            const p01 = ptT(u0, v1);
            emitTri(targetMesh, p00, p10, p11, flip);
            emitTri(targetMesh, p00, p11, p01, flip);
          }
        }
        return;
      }
    }

    const resolvedBounds = face.bounds.map((bId) => ({
      bId,
      entry: faceBounds.get(bId),
    }));
    const hasExplicitOuter = resolvedBounds.some((b) => b.entry?.isOuter);
    for (const { bId, entry } of resolvedBounds) {
      const loopId = entry?.loopId ?? bId;
      triangulatedLoopIds.add(loopId);
      // Skip inner hole bounds when an outer boundary is present so drill/pocket holes aren't filled solid
      if (hasExplicitOuter && entry && !entry.isOuter) {
        continue;
      }
      const polyPts = polyLoops.get(loopId);
      if (polyPts && polyPts.length >= 3) {
        const pts = polyPts.map(getPoint).filter((p): p is [number, number, number] => p !== null);
        triangulatePolygon3D(pts, targetMesh);
        continue;
      }
      const oEdges = edgeLoops.get(loopId);
      if (oEdges && oEdges.length >= 3) {
        const pts = resolveEdgeLoopPts(oEdges);
        triangulatePolygon3D(pts, targetMesh);
      }
    }
  };

  // 1. Tessellate per-solid meshes when MANIFOLD_SOLID_BREP -> CLOSED_SHELL -> ADVANCED_FACE hierarchy is present
  const attributedFaceIds = new Set<number>();
  const solidMeshes: TriangulatedMesh[] = manifoldBreps.map((brep) => {
    const partMesh: TriangulatedMesh = { positions: [], normals: [] };
    const shellFaces = shells.get(brep.shellId) ?? [];
    for (const fId of shellFaces) {
      const face = faceById.get(fId);
      if (face && !attributedFaceIds.has(fId)) {
        attributedFaceIds.add(fId);
        tessellateFace(face, partMesh);
      }
    }
    return partMesh;
  });

  // 1a. Tessellate any remaining ADVANCED_FACE / FACE_SURFACE not owned by a shell
  for (const face of advancedFaces) {
    if (attributedFaceIds.has(face.id)) continue;
    const discardMesh: TriangulatedMesh = { positions: [], normals: [] };
    tessellateFace(face, discardMesh);
  }

  // 1b. Also triangulate any remaining POLY_LOOP / EDGE_LOOP entities not referenced by ADVANCED_FACE
  for (const [loopId, polyPts] of polyLoops.entries()) {
    if (triangulatedLoopIds.has(loopId) || polyPts.length < 3) continue;
    const pts = polyPts.map(getPoint).filter((p): p is [number, number, number] => p !== null);
    for (let i = 1; i + 1 < pts.length; i++) {
      pushTriangle(mesh, pts[0]!, pts[i]!, pts[i + 1]!);
    }
  }
  for (const [loopId, oEdges] of edgeLoops.entries()) {
    if (triangulatedLoopIds.has(loopId) || oEdges.length < 3) continue;
    const pts = resolveEdgeLoopPts(oEdges);
    for (let i = 1; i + 1 < pts.length; i++) {
      pushTriangle(mesh, pts[0]!, pts[i]!, pts[i + 1]!);
    }
  }

  const vtkBuffer = buildVtkXmlBuffer(mesh);
  const stlBuffer = buildBinaryStlBuffer(mesh);

  // Build CadComponent list from PRODUCT / MANIFOLD_SOLID_BREP / NEXT_ASSEMBLY_USAGE_OCCURRENCE
  const components: CadComponent[] = [];
  const palette: [number, number, number, number][] = [
    [0.24, 0.62, 0.92, 1.0],
    [0.25, 0.78, 0.52, 1.0],
    [0.95, 0.58, 0.22, 1.0],
    [0.72, 0.45, 0.92, 1.0],
  ];

  const namedEntities =
    nauos.length > 0
      ? nauos.map((n) => n.name)
      : manifoldBreps.length > 0
        ? manifoldBreps.map((b) => b.name)
        : products.length > 0
          ? products.map((p) => p.name)
          : [extractStepFilename(stepCode)?.replace(/\.(step|stp|p21)$/i, "") || "STEP_Solid"];

  const hasExactSolidMeshes = solidMeshes.some((m) => m.positions.length > 0);
  const totalTriangles = Math.floor(mesh.positions.length / 9);
  const entityCount = Math.max(1, namedEntities.length);

  namedEntities.forEach((rawName, idx) => {
    const cleanName = rawName.replace(/[^A-Za-z0-9_.-]/g, "_") || `Part_${idx + 1}`;
    const partColor = palette[idx % palette.length]!;
    let partMesh: TriangulatedMesh;
    const exactSolidMesh = hasExactSolidMeshes ? solidMeshes[idx] : undefined;
    if (exactSolidMesh && exactSolidMesh.positions.length > 0) {
      partMesh = exactSolidMesh;
    } else if (entityCount === 1) {
      partMesh = mesh;
    } else if (totalTriangles >= entityCount) {
      const startTri = Math.floor((idx * totalTriangles) / entityCount);
      const endTri = Math.floor(((idx + 1) * totalTriangles) / entityCount);
      partMesh = {
        positions: mesh.positions.slice(startTri * 9, endTri * 9),
        normals: mesh.normals.slice(startTri * 9, endTri * 9),
      };
    } else if (idx < totalTriangles) {
      partMesh = {
        positions: mesh.positions.slice(idx * 9, (idx + 1) * 9),
        normals: mesh.normals.slice(idx * 9, (idx + 1) * 9),
      };
    } else {
      partMesh = { positions: [], normals: [] };
    }
    const glbUri = buildGlbDataUri(partMesh, cleanName, partColor);
    if (glbUri) {
      const offsetPt = placements[idx]?.ptId ? getPoint(placements[idx]!.ptId) : null;
      components.push({
        name: cleanName,
        cad: {
          uri: glbUri,
          position: offsetPt ?? [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        ports: [],
      });
    }
  });

  return { vtkBuffer, stlBuffer, components };
}
