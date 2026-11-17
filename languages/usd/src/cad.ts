// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/usd — OpenUSD (.usda) 3D Scenegraph Tessellator for Morsel & CAD Viewers.
 *
 * Converts parsed UsdStage prims (Mesh, Cube, Sphere, Cylinder, Cone, Capsule, Xform)
 * into browser-ready triangulated ProceduralMeshData + CadComponent descriptors.
 */

import { parseUsd } from "./parser/index.js";
import type { UsdAttribute, UsdPrim, UsdStage, UsdValue } from "./types.js";

export interface UsdProceduralMeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  color?: [number, number, number, number] | undefined;
}

export interface UsdCadComponent {
  name: string;
  cad: {
    uri: string;
    position?: [number, number, number] | undefined;
    rotation?: [number, number, number] | undefined;
    scale?: [number, number, number] | undefined;
  };
  proceduralMesh: UsdProceduralMeshData;
  shapeType: string;
}

// ── Row-major 4x4 matrix helpers (USD row-vector convention: p' = p * M) ─────

type Mat4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0) as Mat4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0]! * b[0 * 4 + c]! +
        a[r * 4 + 1]! * b[1 * 4 + c]! +
        a[r * 4 + 2]! * b[2 * 4 + c]! +
        a[r * 4 + 3]! * b[3 * 4 + c]!;
    }
  }
  return out;
}

function mat4Translate(tx: number, ty: number, tz: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
}

function mat4Scale(sx: number, sy: number, sz: number): Mat4 {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

function mat4RotateX(deg: number): Mat4 {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function mat4RotateY(deg: number): Mat4 {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function mat4RotateZ(deg: number): Mat4 {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mat4FromQuat(w: number, x: number, y: number, z: number): Mat4 {
  const len = Math.hypot(w, x, y, z) || 1;
  const nw = w / len;
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;

  const xx = nx * nx;
  const yy = ny * ny;
  const zz = nz * nz;
  const xy = nx * ny;
  const xz = nx * nz;
  const yz = ny * nz;
  const wx = nw * nx;
  const wy = nw * ny;
  const wz = nw * nz;

  // Row-vector convention (transpose of column-vector rotation matrix)
  return [
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    0,
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    0,
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ];
}

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    x * m[0] + y * m[4] + z * m[8] + m[12],
    x * m[1] + y * m[5] + z * m[9] + m[13],
    x * m[2] + y * m[6] + z * m[10] + m[14],
  ];
}

function transformDir(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  const nx = x * m[0] + y * m[4] + z * m[8];
  const ny = x * m[1] + y * m[5] + z * m[9];
  const nz = x * m[2] + y * m[6] + z * m[10];
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// ── Attribute Value Helpers ──────────────────────────────────────────────────

function resolveAttrValue(attr: UsdAttribute | undefined, startTimeCode = 0): UsdValue {
  if (!attr) return undefined;
  if (attr.value !== undefined && attr.value !== null) return attr.value;
  if (attr.timeSamples && attr.timeSamples.size > 0) {
    if (attr.timeSamples.has(startTimeCode)) return attr.timeSamples.get(startTimeCode);
    const firstKey = attr.timeSamples.keys().next().value;
    if (firstKey !== undefined) return attr.timeSamples.get(firstKey);
  }
  return undefined;
}

function toVec3(val: UsdValue, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(val) || val.length < 3) return fallback;
  const x = Number(val[0]);
  const y = Number(val[1]);
  const z = Number(val[2]);
  return [
    Number.isFinite(x) ? x : fallback[0],
    Number.isFinite(y) ? y : fallback[1],
    Number.isFinite(z) ? z : fallback[2],
  ];
}

function toVec4(val: UsdValue, fallback: [number, number, number, number]): [number, number, number, number] {
  if (!Array.isArray(val) || val.length < 4) return fallback;
  const w = Number(val[0]);
  const x = Number(val[1]);
  const y = Number(val[2]);
  const z = Number(val[3]);
  return [
    Number.isFinite(w) ? w : fallback[0],
    Number.isFinite(x) ? x : fallback[1],
    Number.isFinite(y) ? y : fallback[2],
    Number.isFinite(z) ? z : fallback[3],
  ];
}

function toNum(val: UsdValue, fallback: number): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function computeLocalMatrix(prim: UsdPrim, startTimeCode: number): Mat4 {
  const orderAttr = prim.attributes.get("xformOpOrder");
  const orderVal = resolveAttrValue(orderAttr, startTimeCode);
  let opNames: string[] = [];
  if (Array.isArray(orderVal)) {
    opNames = orderVal.filter((v): v is string => typeof v === "string");
  } else {
    for (const key of [
      "xformOp:translate",
      "xformOp:orient",
      "xformOp:rotateXYZ",
      "xformOp:rotateX",
      "xformOp:rotateY",
      "xformOp:rotateZ",
      "xformOp:scale",
      "xformOp:transform",
    ]) {
      if (prim.attributes.has(key)) opNames.push(key);
    }
  }

  // In row-vector convention, xformOpOrder = [op0, op1, ...] means p_out = p_in * M_last * ... * M_1 * M_0
  let mat = mat4Identity();
  for (let i = opNames.length - 1; i >= 0; i--) {
    const opName = opNames[i]!;
    const attr = prim.attributes.get(opName);
    const val = resolveAttrValue(attr, startTimeCode);
    if (val === undefined || val === null) continue;

    let opMat: Mat4 | null = null;
    if (opName.startsWith("xformOp:translate")) {
      const [tx, ty, tz] = toVec3(val, [0, 0, 0]);
      opMat = mat4Translate(tx, ty, tz);
    } else if (opName.startsWith("xformOp:scale")) {
      const [sx, sy, sz] = toVec3(val, [1, 1, 1]);
      opMat = mat4Scale(sx, sy, sz);
    } else if (opName.startsWith("xformOp:orient")) {
      const [w, x, y, z] = toVec4(val, [1, 0, 0, 0]);
      opMat = mat4FromQuat(w, x, y, z);
    } else if (opName.startsWith("xformOp:rotateXYZ")) {
      const [rx, ry, rz] = toVec3(val, [0, 0, 0]);
      opMat = mat4Mul(mat4Mul(mat4RotateX(rx), mat4RotateY(ry)), mat4RotateZ(rz));
    } else if (opName.startsWith("xformOp:rotateX")) {
      opMat = mat4RotateX(toNum(val, 0));
    } else if (opName.startsWith("xformOp:rotateY")) {
      opMat = mat4RotateY(toNum(val, 0));
    } else if (opName.startsWith("xformOp:rotateZ")) {
      opMat = mat4RotateZ(toNum(val, 0));
    } else if (opName.startsWith("xformOp:transform") && Array.isArray(val) && val.length >= 4) {
      const rows = val as UsdValue[];
      if (rows.every((r) => Array.isArray(r) && r.length >= 4)) {
        const r0 = rows[0] as number[];
        const r1 = rows[1] as number[];
        const r2 = rows[2] as number[];
        const r3 = rows[3] as number[];
        opMat = [
          Number(r0[0]) || 0,
          Number(r0[1]) || 0,
          Number(r0[2]) || 0,
          Number(r0[3]) || 0,
          Number(r1[0]) || 0,
          Number(r1[1]) || 0,
          Number(r1[2]) || 0,
          Number(r1[3]) || 0,
          Number(r2[0]) || 0,
          Number(r2[1]) || 0,
          Number(r2[2]) || 0,
          Number(r2[3]) || 0,
          Number(r3[0]) || 0,
          Number(r3[1]) || 0,
          Number(r3[2]) || 0,
          Number(r3[3]) || 0,
        ];
      }
    }

    if (opMat) {
      mat = mat4Mul(mat, opMat);
    }
  }
  return mat;
}

function extractDisplayColor(
  prim: UsdPrim,
  inherited?: [number, number, number, number],
): [number, number, number, number] {
  const attr = prim.attributes.get("primvars:displayColor") ?? prim.attributes.get("displayColor");
  const val = resolveAttrValue(attr, 0);
  if (Array.isArray(val) && val.length > 0) {
    const first = Array.isArray(val[0]) ? val[0] : val;
    if (Array.isArray(first) && first.length >= 3) {
      const r = Number(first[0]);
      const g = Number(first[1]);
      const b = Number(first[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [r, g, b, 1.0];
      }
    }
  }
  return inherited ?? [0.27, 0.56, 0.85, 1.0];
}

// ── Primitive Mesh Generators (local USD space) ──────────────────────────────

interface RawGeometry {
  positions: number[];
  normals: number[];
  indices: number[];
}

function addTriangle(
  geo: RawGeometry,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): void {
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az;
  const vx = cx - ax,
    vy = cy - ay,
    vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;

  const base = geo.positions.length / 3;
  geo.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  geo.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  geo.indices.push(base, base + 1, base + 2);
}

function addQuad(
  geo: RawGeometry,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  addTriangle(geo, ax, ay, az, bx, by, bz, cx, cy, cz);
  addTriangle(geo, ax, ay, az, cx, cy, cz, dx, dy, dz);
}

function buildCubeGeometry(size: number): RawGeometry {
  const h = size / 2;
  const geo: RawGeometry = { positions: [], normals: [], indices: [] };
  // +Z
  addQuad(geo, -h, -h, h, h, -h, h, h, h, h, -h, h, h);
  // -Z
  addQuad(geo, h, -h, -h, -h, -h, -h, -h, h, -h, h, h, -h);
  // +Y
  addQuad(geo, -h, h, h, h, h, h, h, h, -h, -h, h, -h);
  // -Y
  addQuad(geo, -h, -h, -h, h, -h, -h, h, -h, h, -h, -h, h);
  // +X
  addQuad(geo, h, -h, h, h, -h, -h, h, h, -h, h, h, h);
  // -X
  addQuad(geo, -h, -h, -h, -h, -h, h, -h, h, h, -h, h, -h);
  return geo;
}

function buildSphereGeometry(radius: number, segs = 24, rings = 16): RawGeometry {
  const geo: RawGeometry = { positions: [], normals: [], indices: [] };
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let s = 0; s <= segs; s++) {
      const theta = (s / segs) * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = sinPhi * Math.sin(theta);
      const nz = cosPhi;
      geo.positions.push(radius * nx, radius * ny, radius * nz);
      geo.normals.push(nx, ny, nz);
    }
  }
  const stride = segs + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * stride + s;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      if (r !== 0) geo.indices.push(a, b, d);
      if (r !== rings - 1) geo.indices.push(b, c, d);
    }
  }
  return geo;
}

function axisSwizzle(x: number, y: number, z: number, axis: string): [number, number, number] {
  if (axis === "X") return [z, x, y];
  if (axis === "Y") return [x, z, -y];
  return [x, y, z]; // Z (default in USD)
}

function buildCylinderGeometry(radius: number, height: number, axis: string, segs = 24): RawGeometry {
  const geo: RawGeometry = { positions: [], normals: [], indices: [] };
  const hh = height / 2;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const x0 = radius * Math.cos(a0),
      y0 = radius * Math.sin(a0);
    const x1 = radius * Math.cos(a1),
      y1 = radius * Math.sin(a1);

    const p0b = axisSwizzle(x0, y0, -hh, axis);
    const p1b = axisSwizzle(x1, y1, -hh, axis);
    const p1t = axisSwizzle(x1, y1, hh, axis);
    const p0t = axisSwizzle(x0, y0, hh, axis);
    addQuad(geo, p0b[0], p0b[1], p0b[2], p1b[0], p1b[1], p1b[2], p1t[0], p1t[1], p1t[2], p0t[0], p0t[1], p0t[2]);

    const ct = axisSwizzle(0, 0, hh, axis);
    addTriangle(geo, ct[0], ct[1], ct[2], p0t[0], p0t[1], p0t[2], p1t[0], p1t[1], p1t[2]);

    const cb = axisSwizzle(0, 0, -hh, axis);
    addTriangle(geo, cb[0], cb[1], cb[2], p1b[0], p1b[1], p1b[2], p0b[0], p0b[1], p0b[2]);
  }
  return geo;
}

function buildConeGeometry(radius: number, height: number, axis: string, segs = 24): RawGeometry {
  const geo: RawGeometry = { positions: [], normals: [], indices: [] };
  const hh = height / 2;
  const apex = axisSwizzle(0, 0, hh, axis);
  const cb = axisSwizzle(0, 0, -hh, axis);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const p0b = axisSwizzle(radius * Math.cos(a0), radius * Math.sin(a0), -hh, axis);
    const p1b = axisSwizzle(radius * Math.cos(a1), radius * Math.sin(a1), -hh, axis);
    addTriangle(geo, p0b[0], p0b[1], p0b[2], p1b[0], p1b[1], p1b[2], apex[0], apex[1], apex[2]);
    addTriangle(geo, cb[0], cb[1], cb[2], p1b[0], p1b[1], p1b[2], p0b[0], p0b[1], p0b[2]);
  }
  return geo;
}

function buildMeshGeometry(prim: UsdPrim, startTimeCode: number): RawGeometry | null {
  const pointsVal = resolveAttrValue(prim.attributes.get("points"), startTimeCode);
  const countsVal = resolveAttrValue(prim.attributes.get("faceVertexCounts"), startTimeCode);
  const indicesVal = resolveAttrValue(prim.attributes.get("faceVertexIndices"), startTimeCode);

  if (!Array.isArray(pointsVal) || !Array.isArray(countsVal) || !Array.isArray(indicesVal)) {
    return null;
  }

  const pts: [number, number, number][] = [];
  for (const p of pointsVal) {
    if (Array.isArray(p) && p.length >= 3) {
      pts.push([Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]);
    }
  }
  if (pts.length === 0) return null;

  const geo: RawGeometry = { positions: [], normals: [], indices: [] };
  let cursor = 0;
  for (const rawCount of countsVal) {
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count < 3) {
      cursor += Number.isFinite(count) && count > 0 ? count : 0;
      continue;
    }
    const i0 = Number(indicesVal[cursor]);
    const p0 = pts[i0];
    if (p0) {
      for (let k = 1; k + 1 < count; k++) {
        const i1 = Number(indicesVal[cursor + k]);
        const i2 = Number(indicesVal[cursor + k + 1]);
        const p1 = pts[i1];
        const p2 = pts[i2];
        if (p1 && p2) {
          addTriangle(geo, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        }
      }
    }
    cursor += count;
  }

  return geo.positions.length > 0 ? geo : null;
}

function buildGeometryForPrim(prim: UsdPrim, startTimeCode: number): RawGeometry | null {
  switch (prim.typeName) {
    case "Mesh":
      return buildMeshGeometry(prim, startTimeCode);
    case "Cube": {
      const size = toNum(resolveAttrValue(prim.attributes.get("size"), startTimeCode), 2.0);
      return buildCubeGeometry(size);
    }
    case "Sphere": {
      const radius = toNum(resolveAttrValue(prim.attributes.get("radius"), startTimeCode), 1.0);
      return buildSphereGeometry(radius);
    }
    case "Cylinder": {
      const radius = toNum(resolveAttrValue(prim.attributes.get("radius"), startTimeCode), 1.0);
      const height = toNum(resolveAttrValue(prim.attributes.get("height"), startTimeCode), 2.0);
      const axis = String(resolveAttrValue(prim.attributes.get("axis"), startTimeCode) ?? "Z");
      return buildCylinderGeometry(radius, height, axis);
    }
    case "Cone": {
      const radius = toNum(resolveAttrValue(prim.attributes.get("radius"), startTimeCode), 1.0);
      const height = toNum(resolveAttrValue(prim.attributes.get("height"), startTimeCode), 2.0);
      const axis = String(resolveAttrValue(prim.attributes.get("axis"), startTimeCode) ?? "Z");
      return buildConeGeometry(radius, height, axis);
    }
    case "Capsule": {
      const radius = toNum(resolveAttrValue(prim.attributes.get("radius"), startTimeCode), 0.5);
      const height = toNum(resolveAttrValue(prim.attributes.get("height"), startTimeCode), 1.0);
      const axis = String(resolveAttrValue(prim.attributes.get("axis"), startTimeCode) ?? "Z");
      return buildCylinderGeometry(radius, height + radius * 2, axis);
    }
    default:
      return null;
  }
}

/**
 * Parse an ASCII OpenUSD (.usda) document and tessellate all geometric prims
 * into CadComponent descriptors ready for the Morsel 3D CadViewer.
 */
export function extractUsdCadComponents(content: string): UsdCadComponent[] {
  if (!content || !content.trim()) return [];

  let stage: UsdStage;
  try {
    stage = parseUsd(content);
  } catch {
    return [];
  }

  const startTimeCode = stage.metadata.startTimeCode ?? 0;
  const metersPerUnit =
    typeof stage.metadata.metersPerUnit === "number" && Number.isFinite(stage.metadata.metersPerUnit)
      ? stage.metadata.metersPerUnit
      : 1.0;
  const isZUp = stage.metadata.upAxis === "Z";

  // Root transform: scale to meters, and convert Z-up to Three.js Y-up if needed
  let rootMat = mat4Scale(metersPerUnit, metersPerUnit, metersPerUnit);
  if (isZUp) {
    // (x, y, z)_Zup -> (x, z, -y)_Yup
    const zUpToYUp: Mat4 = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    rootMat = mat4Mul(rootMat, zUpToYUp);
  }

  const components: UsdCadComponent[] = [];

  function visit(prim: UsdPrim, parentWorldMat: Mat4, inheritedColor?: [number, number, number, number]): void {
    const localMat = computeLocalMatrix(prim, startTimeCode);
    const worldMat = mat4Mul(localMat, parentWorldMat);
    const color = extractDisplayColor(prim, inheritedColor);

    const rawGeo = buildGeometryForPrim(prim, startTimeCode);
    if (rawGeo && rawGeo.positions.length > 0) {
      const vertices: number[] = new Array(rawGeo.positions.length);
      const normals: number[] = new Array(rawGeo.normals.length);

      for (let i = 0; i < rawGeo.positions.length; i += 3) {
        const [wx, wy, wz] = transformPoint(
          worldMat,
          rawGeo.positions[i]!,
          rawGeo.positions[i + 1]!,
          rawGeo.positions[i + 2]!,
        );
        vertices[i] = wx;
        vertices[i + 1] = wy;
        vertices[i + 2] = wz;

        const [nx, ny, nz] = transformDir(worldMat, rawGeo.normals[i]!, rawGeo.normals[i + 1]!, rawGeo.normals[i + 2]!);
        normals[i] = nx;
        normals[i + 1] = ny;
        normals[i + 2] = nz;
      }

      components.push({
        name: prim.path,
        cad: {
          uri: `usd://${prim.path}`,
          position: [0, 0, 0],
        },
        proceduralMesh: {
          vertices,
          indices: rawGeo.indices,
          normals,
          color,
        },
        shapeType: prim.typeName.toLowerCase(),
      });
    }

    for (const child of prim.children.values()) {
      visit(child, worldMat, color);
    }
  }

  for (const root of stage.rootPrims) {
    visit(root, rootMat);
  }

  return components;
}
