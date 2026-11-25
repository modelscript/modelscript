// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — 3MF (ISO/IEC 25422) & Medical Extension 3D Mesh Extractor
 * for Ansatz & CAD Viewers.
 *
 * Converts parsed ThreeMfDocument objects (`<mesh>`, `<build><item>`, `<basematerials>`,
 * and `<medical:SurgicalGuide>` drill sleeves / osteotomy planes) into browser-ready
 * triangulated ProceduralMeshData + CadComponent descriptors.
 */

import { parseThreeMf } from "./parser/index.js";
import type {
  ThreeMfBuildItem,
  ThreeMfDocument,
  ThreeMfDrillSleeve,
  ThreeMfObject,
  ThreeMfOsteotomyPlane,
  ThreeMfUnit,
} from "./types.js";

export interface ThreeMfProceduralMeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  color?: [number, number, number, number] | undefined;
  material?: string | undefined;
}

export interface ThreeMfCadComponent {
  name: string;
  cad: {
    uri: string;
    position?: [number, number, number] | undefined;
    rotation?: [number, number, number] | undefined;
    scale?: [number, number, number] | undefined;
  };
  proceduralMesh: ThreeMfProceduralMeshData;
  shapeType: string;
}

type Vec3 = [number, number, number];
type Affine3MF = [number, number, number, number, number, number, number, number, number, number, number, number];

const IDENTITY_3MF: Affine3MF = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function unitToMillimeters(unit: ThreeMfUnit): number {
  switch (unit) {
    case "micron":
      return 0.001;
    case "millimeter":
      return 1.0;
    case "centimeter":
      return 10.0;
    case "inch":
      return 25.4;
    case "foot":
      return 304.8;
    case "meter":
      return 1000.0;
    default:
      return 1.0;
  }
}

/**
 * Apply a 3MF 4x3 row-vector affine transform, scale to millimeters, and convert
 * 3MF Z-up coordinates to Three.js Y-up coordinates: (x, y, z)_Zup -> (x, z, -y)_Yup.
 */
function transformPoint3MfToThree(p: Vec3, m: Affine3MF, unitScale: number): Vec3 {
  const tx = (p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9]) * unitScale;
  const ty = (p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10]) * unitScale;
  const tz = (p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]) * unitScale;
  return [tx, tz, ty === 0 ? 0 : -ty];
}

function affineDeterminant(m: Affine3MF): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function parseHexColor(hex?: string): [number, number, number, number] | undefined {
  if (!hex) return undefined;
  const cleaned = hex.trim().replace(/^#/, "");
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r / 255, g / 255, b / 255, 1.0];
    }
  } else if (cleaned.length === 8) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    const a = parseInt(cleaned.slice(6, 8), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
      return [r / 255, g / 255, b / 255, a / 255];
    }
  }
  return undefined;
}

function resolveObjectColor(doc: ThreeMfDocument, obj: ThreeMfObject): [number, number, number, number] {
  if (obj.pid) {
    const group = doc.baseMaterialGroups.find((g) => g.id === obj.pid);
    const mat = group?.materials[obj.pindex ?? 0];
    const parsed = parseHexColor(mat?.displayColor);
    if (parsed) return parsed;
  }
  if (obj.materialName) {
    for (const group of doc.baseMaterialGroups) {
      const mat = group.materials.find((m) => m.name.toLowerCase() === obj.materialName?.toLowerCase());
      const parsed = parseHexColor(mat?.displayColor);
      if (parsed) return parsed;
    }
  }
  if (obj.isMedicalDevice) {
    return [0.85, 0.74, 0.36, 1.0];
  }
  return [0.46, 0.64, 0.82, 1.0];
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function buildOrthonormalBasis(axis: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const w = normalizeVec3(axis);
  const helper: Vec3 = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  // u = normalize(helper x w)
  const ux = helper[1] * w[2] - helper[2] * w[1];
  const uy = helper[2] * w[0] - helper[0] * w[2];
  const uz = helper[0] * w[1] - helper[1] * w[0];
  const u = normalizeVec3([ux, uy, uz]);
  // v = w x u
  const vx = w[1] * u[2] - w[2] * u[1];
  const vy = w[2] * u[0] - w[0] * u[2];
  const vz = w[0] * u[1] - w[1] * u[0];
  const v: Vec3 = [vx, vy, vz];
  return { u, v, w };
}

function pushFlatTriangle(
  vertices: number[],
  normals: number[],
  indices: number[],
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
): void {
  const e1x = p2[0] - p1[0];
  const e1y = p2[1] - p1[1];
  const e1z = p2[2] - p1[2];
  const e2x = p3[0] - p1[0];
  const e2y = p3[1] - p1[1];
  const e2z = p3[2] - p1[2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  const fnx = nx / len;
  const fny = ny / len;
  const fnz = nz / len;

  const base = vertices.length / 3;
  vertices.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  normals.push(fnx, fny, fnz, fnx, fny, fnz, fnx, fny, fnz);
  indices.push(base, base + 1, base + 2);
}

function tessellateObjectMesh(
  obj: ThreeMfObject,
  m: Affine3MF,
  unitScale: number,
  color: [number, number, number, number],
): ThreeMfProceduralMeshData | null {
  if (!obj.mesh || obj.mesh.vertices.length === 0 || obj.mesh.triangles.length === 0) {
    return null;
  }

  const flipWinding = affineDeterminant(m) < 0;
  const transformed: Vec3[] = obj.mesh.vertices.map((v) => transformPoint3MfToThree([v.x, v.y, v.z], m, unitScale));

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const tri of obj.mesh.triangles) {
    const i1 = tri.v1;
    const i2 = flipWinding ? tri.v3 : tri.v2;
    const i3 = flipWinding ? tri.v2 : tri.v3;
    if (
      i1 < 0 ||
      i2 < 0 ||
      i3 < 0 ||
      i1 >= transformed.length ||
      i2 >= transformed.length ||
      i3 >= transformed.length ||
      i1 === i2 ||
      i2 === i3 ||
      i1 === i3
    ) {
      continue;
    }
    pushFlatTriangle(vertices, normals, indices, transformed[i1]!, transformed[i2]!, transformed[i3]!);
  }

  if (vertices.length === 0) return null;

  return {
    vertices,
    indices,
    normals,
    color,
    material: obj.materialName,
  };
}

function tessellateDrillSleeve(sleeve: ThreeMfDrillSleeve, m: Affine3MF, unitScale: number): ThreeMfProceduralMeshData {
  const outerR = Math.max(0.2, sleeve.outerDiameterMm / 2);
  const innerR = Math.max(0.05, Math.min(outerR * 0.85, sleeve.innerDiameterMm / 2));
  const halfH = Math.max(0.5, (sleeve.lengthMm ?? 10.0) / 2);
  const segments = 24;

  const { u, v, w } = buildOrthonormalBasis(sleeve.axis);
  const [ex, ey, ez] = sleeve.entryPoint;

  const toWorld = (r: number, theta: number, zLocal: number): Vec3 => {
    const ct = Math.cos(theta) * r;
    const st = Math.sin(theta) * r;
    const lx = ex + u[0] * ct + v[0] * st + w[0] * zLocal;
    const ly = ey + u[1] * ct + v[1] * st + w[1] * zLocal;
    const lz = ez + u[2] * ct + v[2] * st + w[2] * zLocal;
    return transformPoint3MfToThree([lx, ly, lz], m, unitScale);
  };

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const flip = affineDeterminant(m) < 0;

  const addQuad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    if (flip) {
      pushFlatTriangle(vertices, normals, indices, a, c, b);
      pushFlatTriangle(vertices, normals, indices, a, d, c);
    } else {
      pushFlatTriangle(vertices, normals, indices, a, b, c);
      pushFlatTriangle(vertices, normals, indices, a, c, d);
    }
  };

  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;

    const ob0 = toWorld(outerR, t0, -halfH);
    const ob1 = toWorld(outerR, t1, -halfH);
    const ot0 = toWorld(outerR, t0, halfH);
    const ot1 = toWorld(outerR, t1, halfH);

    const ib0 = toWorld(innerR, t0, -halfH);
    const ib1 = toWorld(innerR, t1, -halfH);
    const it0 = toWorld(innerR, t0, halfH);
    const it1 = toWorld(innerR, t1, halfH);

    // Outer wall
    addQuad(ob0, ob1, ot1, ot0);
    // Inner bore wall
    addQuad(ib1, ib0, it0, it1);
    // Top annular cap
    addQuad(ot0, ot1, it1, it0);
    // Bottom annular cap
    addQuad(ob1, ob0, ib0, ib1);
  }

  return {
    vertices,
    indices,
    normals,
    color: [0.75, 0.78, 0.82, 1.0],
    material: "Ti-6Al-4V",
  };
}

function tessellateOsteotomyPlane(
  plane: ThreeMfOsteotomyPlane,
  m: Affine3MF,
  unitScale: number,
  extent: number,
): ThreeMfProceduralMeshData {
  const halfSpan = Math.max(4.0, extent * 0.6);
  const halfThick = Math.max(0.15, (plane.slotWidthMm ?? 1.0) / 2);
  const { u, v, w } = buildOrthonormalBasis(plane.normal);
  const [ox, oy, oz] = plane.origin;

  const pt = (su: number, sv: number, sw: number): Vec3 => {
    const lx = ox + u[0] * su + v[0] * sv + w[0] * sw;
    const ly = oy + u[1] * su + v[1] * sv + w[1] * sw;
    const lz = oz + u[2] * su + v[2] * sv + w[2] * sw;
    return transformPoint3MfToThree([lx, ly, lz], m, unitScale);
  };

  const c000 = pt(-halfSpan, -halfSpan, -halfThick);
  const c100 = pt(halfSpan, -halfSpan, -halfThick);
  const c110 = pt(halfSpan, halfSpan, -halfThick);
  const c010 = pt(-halfSpan, halfSpan, -halfThick);
  const c001 = pt(-halfSpan, -halfSpan, halfThick);
  const c101 = pt(halfSpan, -halfSpan, halfThick);
  const c111 = pt(halfSpan, halfSpan, halfThick);
  const c011 = pt(-halfSpan, halfSpan, halfThick);

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const flip = affineDeterminant(m) < 0;

  const addQuad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    if (flip) {
      pushFlatTriangle(vertices, normals, indices, a, c, b);
      pushFlatTriangle(vertices, normals, indices, a, d, c);
    } else {
      pushFlatTriangle(vertices, normals, indices, a, b, c);
      pushFlatTriangle(vertices, normals, indices, a, c, d);
    }
  };

  addQuad(c001, c101, c111, c011); // +w
  addQuad(c100, c000, c010, c110); // -w
  addQuad(c100, c110, c111, c101); // +u
  addQuad(c010, c000, c001, c011); // -u
  addQuad(c010, c011, c111, c110); // +v
  addQuad(c000, c100, c101, c001); // -v

  return {
    vertices,
    indices,
    normals,
    color: [0.15, 0.75, 0.95, 0.45],
  };
}

function estimateMeshExtent(obj: ThreeMfObject): number {
  if (!obj.mesh || obj.mesh.vertices.length === 0) return 12.0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of obj.mesh.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  return diag > 1e-6 ? diag : 12.0;
}

/**
 * Parse a 3MF (.3mf) XML document and tessellate all objects, build items,
 * and medical surgical guide features into CadComponent descriptors ready
 * for the Ansatz 3D CadViewer.
 */
export function extractThreeMfCadComponents(content: string): ThreeMfCadComponent[] {
  if (!content || !content.trim()) return [];

  let doc: ThreeMfDocument;
  try {
    doc = parseThreeMf(content);
  } catch {
    return [];
  }

  if (!doc.objects || doc.objects.length === 0) return [];

  const unitScale = unitToMillimeters(doc.unit);
  const objectById = new Map<string, ThreeMfObject>();
  for (const obj of doc.objects) {
    objectById.set(obj.id, obj);
  }

  // Build items define what is placed on the build tray; if none exist, render all objects directly.
  const placements: Array<{ obj: ThreeMfObject; transform: Affine3MF; instanceIndex: number; totalForObj: number }> =
    [];

  if (doc.buildItems.length > 0) {
    const counts = new Map<string, number>();
    for (const item of doc.buildItems) {
      if (objectById.has(item.objectId)) {
        counts.set(item.objectId, (counts.get(item.objectId) ?? 0) + 1);
      }
    }
    const seen = new Map<string, number>();
    for (const item of doc.buildItems as ThreeMfBuildItem[]) {
      const obj = objectById.get(item.objectId);
      if (!obj) continue;
      const idx = (seen.get(item.objectId) ?? 0) + 1;
      seen.set(item.objectId, idx);
      placements.push({
        obj,
        transform: item.transform ?? IDENTITY_3MF,
        instanceIndex: idx,
        totalForObj: counts.get(item.objectId) ?? 1,
      });
    }
  }

  if (placements.length === 0) {
    for (const obj of doc.objects) {
      placements.push({ obj, transform: IDENTITY_3MF, instanceIndex: 1, totalForObj: 1 });
    }
  }

  const components: ThreeMfCadComponent[] = [];

  for (const { obj, transform, instanceIndex, totalForObj } of placements) {
    const baseName = obj.name || `Object_${obj.id}`;
    const displayName = totalForObj > 1 ? `${baseName} #${instanceIndex}` : baseName;
    const color = resolveObjectColor(doc, obj);

    const meshData = tessellateObjectMesh(obj, transform, unitScale, color);
    if (meshData) {
      components.push({
        name: displayName,
        cad: {
          uri: `threemf://object/${obj.id}`,
          position: [0, 0, 0],
        },
        proceduralMesh: meshData,
        shapeType: "mesh",
      });
    }

    if (obj.surgicalGuide) {
      const extent = estimateMeshExtent(obj);
      const suffix = totalForObj > 1 ? ` #${instanceIndex}` : "";

      for (const sleeve of obj.surgicalGuide.drillSleeves) {
        components.push({
          name: `DrillSleeve ${sleeve.id}${suffix}`,
          cad: {
            uri: `threemf://object/${obj.id}/sleeve/${sleeve.id}`,
            position: [0, 0, 0],
          },
          proceduralMesh: tessellateDrillSleeve(sleeve, transform, unitScale),
          shapeType: "drillsleeve",
        });
      }

      for (const plane of obj.surgicalGuide.osteotomyPlanes) {
        components.push({
          name: `OsteotomyPlane ${plane.id}${suffix}`,
          cad: {
            uri: `threemf://object/${obj.id}/plane/${plane.id}`,
            position: [0, 0, 0],
          },
          proceduralMesh: tessellateOsteotomyPlane(plane, transform, unitScale, extent),
          shapeType: "osteotomyplane",
        });
      }
    }
  }

  return components;
}
