// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Sculpted, beveled, vertex-shaded 3D architectural, furniture, tree, and landmark
 * geometry builders for the Engineering Rotunda VR environments.
 *
 * Art direction: Meta Quest 3 Horizon Home × Job Simulator stylized architectural realism.
 *  - Every solid uses rounded chamfers, smooth tapers, or organic lofted curves (zero razor-sharp un-beveled cubes).
 *  - Multi-material zones + vertical sky-bounce GI + floor-contact ambient occlusion are baked directly
 *    into non-indexed sRGB vertex colors (`color` attribute), enabling complete multi-part furniture,
 *    cubicles, trees, and landmarks to render in a SINGLE `THREE.InstancedMesh` draw call on Quest 2/3.
 */

const SCRATCH_COLOR = new THREE.Color();
const SCRATCH_POS = new THREE.Vector3();
const SCRATCH_NORM = new THREE.Vector3();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface VertexShadeOptions {
  /** Base hex color of this sub-part. */
  color: string;
  /** World/model-local Y where floor contact AO darkens vertices (default 0). */
  aoFloorY?: number | undefined;
  /** Vertical span (meters) over which floor AO fades out (default 0.35). */
  aoHeight?: number | undefined;
  /** Strength of floor contact darkening in [0, 0.5] (default 0.18). */
  aoStrength?: number | undefined;
  /** Strength of top-vs-bottom Hemisphere GI bounce gradient (default 0.12). */
  giStrength?: number | undefined;
  /** Optional spherical canopy center — bends normals outward & shades sun-top vs shadow-belly. */
  foliageCenter?: readonly [number, number, number] | undefined;
  /** Normal-bending blend factor [0..1] toward radial canopy normal (default 0.68). */
  foliageNormalBlend?: number | undefined;
}

/**
 * Normalizes any `BufferGeometry` to non-indexed layout `(position, normal, uv, color)`
 * and bakes smooth sRGB vertex colors with top-down GI bounce + floor contact AO.
 */
export function bakePartGeometry(raw: THREE.BufferGeometry, opts: VertexShadeOptions): THREE.BufferGeometry {
  const geom = raw.index ? raw.toNonIndexed() : raw.clone();
  raw.dispose();

  if (!geom.getAttribute("normal")) {
    geom.computeVertexNormals();
  }

  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  const norm = geom.getAttribute("normal") as THREE.BufferAttribute;
  const count = pos.count;

  if (!geom.getAttribute("uv")) {
    geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  } else {
    // Strip any extra attributes (e.g. uv1) so mergeGeometries never mismatches attribute sets
    for (const key of Object.keys(geom.attributes)) {
      if (key !== "position" && key !== "normal" && key !== "uv") {
        geom.deleteAttribute(key);
      }
    }
  }

  SCRATCH_COLOR.set(opts.color);
  const baseR = SCRATCH_COLOR.r;
  const baseG = SCRATCH_COLOR.g;
  const baseB = SCRATCH_COLOR.b;

  const aoFloorY = opts.aoFloorY ?? 0;
  const aoHeight = Math.max(0.02, opts.aoHeight ?? 0.35);
  const aoStrength = opts.aoStrength ?? 0.18;
  const giStrength = opts.giStrength ?? 0.12;
  const foliageCenter = opts.foliageCenter;
  const foliageBlend = opts.foliageNormalBlend ?? 0.68;

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanY = Math.max(0.01, maxY - minY);

  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let nx = norm.getX(i);
    let ny = norm.getY(i);
    let nz = norm.getZ(i);

    if (foliageCenter) {
      const rx = x - foliageCenter[0];
      const ry = y - foliageCenter[1];
      const rz = z - foliageCenter[2];
      const rLen = Math.hypot(rx, ry, rz) || 1;
      nx = nx * (1 - foliageBlend) + (rx / rLen) * foliageBlend;
      ny = ny * (1 - foliageBlend) + (ry / rLen) * foliageBlend;
      nz = nz * (1 - foliageBlend) + (rz / rLen) * foliageBlend;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
      norm.setXYZ(i, nx, ny, nz);
    }

    const aoT = clamp01((y - aoFloorY) / aoHeight);
    const aoFactor = 1 - aoStrength * (1 - aoT) * (1 - aoT);

    const localH = clamp01((y - minY) / spanY);
    const hemiBounce = 1 + giStrength * (ny * 0.55 + (localH - 0.45) * 0.45);

    let r = baseR * aoFactor * hemiBounce;
    let g = baseG * aoFactor * hemiBounce;
    let b = baseB * aoFactor * hemiBounce;

    if (foliageCenter) {
      // Sunlit golden-green crown -> cool emerald underside (Quest Home / Witness foliage shading)
      const sunCrown = clamp01(ny * 0.5 + 0.5);
      r *= 0.82 + sunCrown * 0.34;
      g *= 0.86 + sunCrown * 0.26;
      b *= 0.92 + sunCrown * 0.12;
    }

    colors[i * 3] = clamp01(r);
    colors[i * 3 + 1] = clamp01(g);
    colors[i * 3 + 2] = clamp01(b);
  }

  if (foliageCenter) {
    norm.needsUpdate = true;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geom;
}

/** Merges multiple pre-baked sub-part geometries into a single draw-call geometry and disposes inputs. */
export function mergePartGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) {
    return new THREE.BufferGeometry();
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) {
    p.dispose();
  }
  if (!merged) {
    return new THREE.BufferGeometry();
  }
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Builds a chamfered/rounded 3D box (extruded rounded 2D profile + bevel) positioned at `(x, y, z)`.
 * Eliminates the harsh 90° CG-primitive look across all furniture, desks, panels, and equipment.
 */
export function createRoundedBoxPart(
  w: number,
  h: number,
  d: number,
  radius: number,
  pos: readonly [number, number, number],
  shade: VertexShadeOptions,
  rot?: readonly [number, number, number] | undefined,
): THREE.BufferGeometry {
  const bevel = Math.min(radius * 0.45, w * 0.16, h * 0.16, d * 0.16, 0.028);
  const innerW = Math.max(0.004, w - bevel * 2);
  const innerD = Math.max(0.004, d - bevel * 2);
  const innerH = Math.max(0.004, h - bevel * 2);
  const r = Math.min(Math.max(0.002, radius - bevel), innerW * 0.46, innerD * 0.46);

  const hw = innerW * 0.5;
  const hd = innerD * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: innerH,
    bevelEnabled: bevel > 0.001,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // Extrude runs along +Z; rotate so innerH runs along +Y and center at origin
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, -innerH * 0.5, 0);

  if (rot) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    geom.applyMatrix4(m);
  }
  geom.translate(pos[0], pos[1], pos[2]);
  geom.computeVertexNormals();
  return bakePartGeometry(geom, shade);
}

export function createCylinderPart(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  pos: readonly [number, number, number],
  shade: VertexShadeOptions,
  rot?: readonly [number, number, number] | undefined,
): THREE.BufferGeometry {
  const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1);
  if (rot) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    geom.applyMatrix4(m);
  }
  geom.translate(pos[0], pos[1], pos[2]);
  return bakePartGeometry(geom, shade);
}

/** Builds a curved tapered organic trunk or branch along 3D control points. */
function createTaperedBranchPart(
  points: readonly (readonly [number, number, number])[],
  rBottom: number,
  rTop: number,
  radialSegments: number,
  tubularSegments: number,
  color: string,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const ringVerts = radialSegments + 1;
  const vertCount = (tubularSegments + 1) * ringVerts;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const pt = curve.getPointAt(t, SCRATCH_POS);
    const N = frames.normals[i]!;
    const B = frames.binormals[i]!;
    // Root flare near base + smooth taper toward tip
    const rootFlare = i === 0 ? 1.28 : i === 1 ? 1.08 : 1.0;
    const radius = (rBottom + (rTop - rBottom) * Math.pow(t, 0.78)) * rootFlare;

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = Math.cos(v);
      SCRATCH_NORM.set(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize();

      const idx = i * ringVerts + j;
      positions[idx * 3] = pt.x + radius * SCRATCH_NORM.x;
      positions[idx * 3 + 1] = pt.y + radius * SCRATCH_NORM.y;
      positions[idx * 3 + 2] = pt.z + radius * SCRATCH_NORM.z;
      normals[idx * 3] = SCRATCH_NORM.x;
      normals[idx * 3 + 1] = SCRATCH_NORM.y;
      normals[idx * 3 + 2] = SCRATCH_NORM.z;
      uvs[idx * 2] = j / radialSegments;
      uvs[idx * 2 + 1] = t;
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      const c = (i + 1) * ringVerts + (j + 1);
      const d = i * ringVerts + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);

  return bakePartGeometry(geom, { color, aoFloorY: 0, aoHeight: 0.7, aoStrength: 0.25, giStrength: 0.14 });
}

/** Builds a soft, sculpted organic foliage lobe with gentle surface undulation and spherical normal bending. */
function createCanopyLobePart(
  center: readonly [number, number, number],
  scale: readonly [number, number, number],
  color: string,
  canopyGlobalCenter: readonly [number, number, number],
  seed: number,
  detail = 2,
): THREE.BufferGeometry {
  const geom = new THREE.IcosahedronGeometry(0.5, detail);
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Gentle cloud-like billowing (avoids sharp faceted triangles while breaking perfect sphere symmetry)
    const billow =
      1 + 0.11 * Math.sin(x * 7.2 + seed) * Math.cos(z * 6.8 - seed * 0.7) + 0.07 * Math.sin(y * 8.5 + seed * 1.3);
    // Slightly flatten bottom belly like real tree boughs
    const bellyFlatten = y < 0 ? 0.76 : 1.0;
    pos.setXYZ(
      i,
      center[0] + x * scale[0] * billow,
      center[1] + y * scale[1] * billow * bellyFlatten,
      center[2] + z * scale[2] * billow,
    );
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return bakePartGeometry(geom, {
    color,
    aoFloorY: canopyGlobalCenter[1] - scale[1] * 0.9,
    aoHeight: scale[1] * 1.6,
    aoStrength: 0.2,
    giStrength: 0.18,
    foliageCenter: canopyGlobalCenter,
    foliageNormalBlend: 0.76,
  });
}

/* -------------------------------------------------------------------------- */
/*  1. Natural Sculpted Tree Archetypes (Outdoors & Courtyard Vistas)         */
/* -------------------------------------------------------------------------- */

/** Lush Mediterranean / Park Umbrella Oak & Broadleaf Tree (~4.8m tall at scale 1). */
export function createParkBroadleafTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bark = "#6b5344";

  // Gracefully curved main trunk + 3 spreading scaffold boughs
  parts.push(
    createTaperedBranchPart(
      [
        [0, 0, 0],
        [0.06, 0.85, 0.03],
        [0.02, 1.75, -0.04],
        [-0.08, 2.55, 0.02],
      ],
      0.24,
      0.11,
      8,
      7,
      bark,
    ),
  );
  parts.push(
    createTaperedBranchPart(
      [
        [0.03, 1.65, -0.02],
        [0.52, 2.25, 0.34],
        [0.98, 2.72, 0.56],
      ],
      0.11,
      0.045,
      6,
      5,
      bark,
    ),
  );
  parts.push(
    createTaperedBranchPart(
      [
        [-0.02, 1.78, 0.0],
        [-0.58, 2.35, -0.32],
        [-1.05, 2.82, -0.48],
      ],
      0.1,
      0.045,
      6,
      5,
      bark,
    ),
  );
  parts.push(
    createTaperedBranchPart(
      [
        [0.0, 1.9, 0.02],
        [0.24, 2.5, -0.58],
        [0.42, 2.95, -0.96],
      ],
      0.09,
      0.04,
      6,
      5,
      bark,
    ),
  );

  // Layered cloud-like foliage crown with spherical normal bending
  const crownCenter: [number, number, number] = [0, 3.35, 0];
  parts.push(createCanopyLobePart([0, 3.65, 0], [2.75, 1.65, 2.65], "#4d8b55", crownCenter, 1.1));
  parts.push(createCanopyLobePart([1.05, 3.05, 0.58], [1.95, 1.25, 1.85], "#58995e", crownCenter, 2.4));
  parts.push(createCanopyLobePart([-1.08, 3.12, -0.48], [1.98, 1.28, 1.88], "#457f4e", crownCenter, 3.7));
  parts.push(createCanopyLobePart([0.38, 3.22, -0.98], [1.78, 1.18, 1.72], "#5ca062", crownCenter, 5.1));
  parts.push(createCanopyLobePart([-0.46, 2.98, 0.92], [1.72, 1.14, 1.68], "#4a8752", crownCenter, 6.3));
  parts.push(createCanopyLobePart([0.12, 4.22, 0.08], [1.65, 1.05, 1.62], "#68ad69", crownCenter, 7.9));

  return mergePartGeometries(parts);
}

/** Multi-stem Silver Birch / Aspen Park Tree with white-bark trunks & airy golden-sage canopy (~5.2m tall). */
export function createSilverBirchTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const birchBark = "#dcd9d0";

  // Twin leaning slender birch stems
  parts.push(
    createTaperedBranchPart(
      [
        [-0.08, 0, 0.04],
        [-0.22, 1.3, 0.1],
        [-0.36, 2.7, 0.14],
        [-0.44, 3.8, 0.18],
      ],
      0.13,
      0.045,
      7,
      7,
      birchBark,
    ),
  );
  parts.push(
    createTaperedBranchPart(
      [
        [0.08, 0, -0.03],
        [0.26, 1.25, -0.12],
        [0.42, 2.55, -0.2],
        [0.52, 3.55, -0.26],
      ],
      0.11,
      0.04,
      7,
      7,
      "#d2cfc4",
    ),
  );

  const crown: [number, number, number] = [0.02, 3.75, -0.02];
  parts.push(createCanopyLobePart([-0.42, 3.95, 0.18], [1.75, 1.55, 1.68], "#74a857", crown, 11.2));
  parts.push(createCanopyLobePart([0.52, 3.68, -0.24], [1.68, 1.48, 1.62], "#84b560", crown, 13.5));
  parts.push(createCanopyLobePart([0.04, 4.55, 0.0], [1.52, 1.32, 1.48], "#8fc068", crown, 15.8));
  parts.push(createCanopyLobePart([-0.15, 3.05, -0.32], [1.38, 1.08, 1.35], "#65984c", crown, 17.1));

  return mergePartGeometries(parts);
}

/** Sculpted Soft-Tiered Alpine Conifer / Pine (replaces harsh 8-sided ConeGeometry; ~5.4m tall). */
export function createSculptedPineTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    createTaperedBranchPart(
      [
        [0, 0, 0],
        [0.03, 1.2, 0.02],
        [-0.02, 2.8, -0.01],
        [0, 4.4, 0],
      ],
      0.2,
      0.05,
      7,
      6,
      "#5c4332",
    ),
  );

  const crown: [number, number, number] = [0, 3.0, 0];
  const tiers: readonly { y: number; w: number; h: number; col: string; seed: number }[] = [
    { y: 1.55, w: 2.45, h: 1.05, col: "#2d5e48", seed: 21.1 },
    { y: 2.35, w: 2.08, h: 1.0, col: "#346b52", seed: 23.4 },
    { y: 3.12, w: 1.68, h: 0.96, col: "#3c785c", seed: 25.7 },
    { y: 3.82, w: 1.26, h: 0.92, col: "#468667", seed: 28.2 },
    { y: 4.45, w: 0.82, h: 0.88, col: "#529674", seed: 30.9 },
  ];
  for (const tier of tiers) {
    parts.push(createCanopyLobePart([0, tier.y, 0], [tier.w, tier.h, tier.w], tier.col, crown, tier.seed, 2));
  }

  return mergePartGeometries(parts);
}

/** Indoor Architectural Potted Olive / Ficus Tree in a ribbed matte ceramic planter (`1.0` = ~2.55m tall). */
export function createPottedIndoorTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Tapered ceramic planter + lip + dark soil
  parts.push(createCylinderPart(0.42, 0.33, 0.68, 20, [0, 0.34, 0], { color: "#ebe6dd", aoStrength: 0.24 }));
  parts.push(createCylinderPart(0.445, 0.445, 0.055, 20, [0, 0.66, 0], { color: "#f5f2ec", aoStrength: 0.08 }));
  parts.push(createCylinderPart(0.39, 0.39, 0.03, 18, [0, 0.685, 0], { color: "#42352c", aoStrength: 0.1 }));

  // Sculptural branching olive trunk
  parts.push(
    createTaperedBranchPart(
      [
        [0, 0.68, 0],
        [0.05, 1.18, 0.03],
        [-0.04, 1.68, -0.02],
      ],
      0.075,
      0.036,
      7,
      6,
      "#785c44",
    ),
  );
  parts.push(
    createTaperedBranchPart(
      [
        [0.02, 1.32, 0.02],
        [0.32, 1.72, 0.18],
      ],
      0.042,
      0.022,
      6,
      4,
      "#785c44",
    ),
  );
  parts.push(
    createTaperedBranchPart(
      [
        [-0.02, 1.4, -0.01],
        [-0.28, 1.78, -0.16],
      ],
      0.04,
      0.02,
      6,
      4,
      "#785c44",
    ),
  );

  const crown: [number, number, number] = [0, 2.02, 0];
  parts.push(createCanopyLobePart([-0.04, 2.08, 0], [1.08, 0.72, 1.04], "#567d62", crown, 41.2, 2));
  parts.push(createCanopyLobePart([0.34, 1.88, 0.18], [0.76, 0.54, 0.74], "#658d70", crown, 43.7, 2));
  parts.push(createCanopyLobePart([-0.3, 1.92, -0.16], [0.74, 0.52, 0.72], "#4c7258", crown, 46.1, 2));

  return mergePartGeometries(parts);
}

/* -------------------------------------------------------------------------- */
/*  2. Quest 3 Home Lounge & Pavilion Furniture Archetypes                    */
/* -------------------------------------------------------------------------- */

/** Plush 3-Seat Curved/Beveled Horizon Home Lounge Sofa with walnut plinth, cushions & throw pillows (`2.4m` wide). */
export function createHorizonLoungeSofaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const walnut = "#7c583c";
  const upholstery = "#e6e1d8";
  const cushion = "#efece6";
  const pillowA = "#5b8291";
  const pillowB = "#c98a5b";

  // Recessed walnut timber base plinth + 4 tapered legs
  parts.push(createRoundedBoxPart(2.36, 0.11, 0.94, 0.04, [0, 0.14, 0], { color: walnut, aoStrength: 0.28 }));
  for (const lx of [-1.04, 1.04]) {
    for (const lz of [-0.36, 0.36]) {
      parts.push(createCylinderPart(0.032, 0.022, 0.09, 10, [lx, 0.045, lz], { color: "#334155", aoStrength: 0.35 }));
    }
  }

  // Wide rounded armrests & upholstered wrap-around back shell
  parts.push(createRoundedBoxPart(0.24, 0.54, 0.96, 0.08, [-1.1, 0.44, 0], { color: upholstery }));
  parts.push(createRoundedBoxPart(0.24, 0.54, 0.96, 0.08, [1.1, 0.44, 0], { color: upholstery }));
  parts.push(createRoundedBoxPart(2.42, 0.62, 0.22, 0.08, [0, 0.48, -0.38], { color: upholstery }));

  // 3 Pillowy beveled seat cushions + 3 angled backrest cushions
  for (const cx of [-0.64, 0, 0.64]) {
    parts.push(createRoundedBoxPart(0.62, 0.19, 0.74, 0.065, [cx, 0.29, 0.06], { color: cushion, aoFloorY: 0.18 }));
    parts.push(
      createRoundedBoxPart(
        0.61,
        0.4,
        0.18,
        0.065,
        [cx, 0.56, -0.22],
        { color: cushion, aoFloorY: 0.34 },
        [-0.16, 0, 0],
      ),
    );
  }

  // Accent throw pillows tucked into corners
  parts.push(
    createRoundedBoxPart(0.36, 0.34, 0.13, 0.06, [-0.82, 0.54, -0.06], { color: pillowA }, [-0.2, 0.35, 0.12]),
  );
  parts.push(
    createRoundedBoxPart(0.36, 0.34, 0.13, 0.06, [0.82, 0.54, -0.06], { color: pillowB }, [-0.2, -0.35, -0.12]),
  );

  return mergePartGeometries(parts);
}

/** Low Organic Walnut & Travertine Coffee Table with ceramic tray, art book & mug (`1.35m × 0.72m`). */
export function createLoungeCoffeeTableGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Rounded travertine top slab + walnut sled legs
  parts.push(createRoundedBoxPart(1.36, 0.055, 0.74, 0.16, [0, 0.39, 0], { color: "#ede8df", aoFloorY: 0.34 }));
  parts.push(createRoundedBoxPart(0.08, 0.36, 0.56, 0.03, [-0.46, 0.18, 0], { color: "#78553a", aoStrength: 0.28 }));
  parts.push(createRoundedBoxPart(0.08, 0.36, 0.56, 0.03, [0.46, 0.18, 0], { color: "#78553a", aoStrength: 0.28 }));
  // Hardcover architecture book stack + ceramic planter bowl
  parts.push(createRoundedBoxPart(0.34, 0.042, 0.26, 0.01, [-0.28, 0.44, 0.04], { color: "#334155" }, [0, 0.12, 0]));
  parts.push(createRoundedBoxPart(0.28, 0.034, 0.22, 0.01, [-0.27, 0.478, 0.04], { color: "#0284c7" }, [0, -0.08, 0]));
  parts.push(createCylinderPart(0.14, 0.1, 0.09, 16, [0.28, 0.46, -0.04], { color: "#d6ccc2" }));
  parts.push(createCanopyLobePart([0.28, 0.54, -0.04], [0.24, 0.14, 0.24], "#52825d", [0.28, 0.54, -0.04], 9.2, 1));
  return mergePartGeometries(parts);
}

/* -------------------------------------------------------------------------- */
/*  3. Job Simulator × Modern Office Cubicle, Chair & Room Furniture          */
/* -------------------------------------------------------------------------- */

/** Ergonomic Swivel Task Chair (5-star caster base, gas lift, sculpted cushion, mesh back & armrests). */
export function createErgonomicTaskChairGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frameDark = "#263142";
  const aluminum = "#94a3b8";
  const cushion = "#334155";

  // 5-star base legs + dual-wheel casters + pneumatic cylinder
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const mx = Math.sin(a) * 0.16;
    const mz = Math.cos(a) * 0.16;
    parts.push(
      createRoundedBoxPart(0.042, 0.034, 0.32, 0.014, [mx, 0.065, mz], { color: aluminum, aoStrength: 0.3 }, [0, a, 0]),
    );
    parts.push(
      createCylinderPart(0.026, 0.026, 0.036, 8, [Math.sin(a) * 0.3, 0.026, Math.cos(a) * 0.3], { color: frameDark }, [
        0,
        a,
        Math.PI / 2,
      ]),
    );
  }
  parts.push(createCylinderPart(0.028, 0.032, 0.36, 12, [0, 0.24, 0], { color: frameDark }));

  // Beveled Waterfall Seat Cushion
  parts.push(createRoundedBoxPart(0.5, 0.085, 0.48, 0.042, [0, 0.46, 0.02], { color: cushion, aoFloorY: 0.4 }));

  // Curved Spine Post + Breathable Mesh Backrest + Lumbar Pad + T-Armrests
  parts.push(createRoundedBoxPart(0.06, 0.34, 0.04, 0.015, [0, 0.62, -0.22], { color: aluminum }, [0.14, 0, 0]));
  parts.push(createRoundedBoxPart(0.46, 0.52, 0.055, 0.045, [0, 0.82, -0.23], { color: frameDark }, [0.1, 0, 0]));
  parts.push(createRoundedBoxPart(0.38, 0.12, 0.035, 0.02, [0, 0.68, -0.2], { color: "#475569" }, [0.1, 0, 0]));
  for (const sx of [-0.26, 0.26]) {
    parts.push(createRoundedBoxPart(0.035, 0.22, 0.04, 0.012, [sx, 0.57, -0.02], { color: frameDark }));
    parts.push(createRoundedBoxPart(0.075, 0.032, 0.24, 0.016, [sx, 0.68, 0.0], { color: cushion }));
  }

  return mergePartGeometries(parts);
}

/**
 * Complete Job-Simulator × Tech-Studio L-Shaped Cubicle Pod (`2.1m × 1.9m`, `1.36m` felt privacy walls):
 * Acoustic oatmeal-felt partitions with rounded brushed-silver trim, warm-oak L-desk, 3-drawer cabinet,
 * dual thin-bezel monitors, keyboard, mug, desk lamp, and pinned colorful sticky notes.
 */
export function createOfficeCubiclePodGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const feltWall = "#d5d9e0";
  const feltTack = "#94a3b8";
  const trim = "#9aa6b5";
  const oak = "#d7b388";
  const darkMetal = "#1e293b";

  // Front & Left Acoustic Cubicle Partition Walls (1.36m tall, rounded aluminum top cap & corner post)
  parts.push(createRoundedBoxPart(2.06, 1.34, 0.075, 0.024, [0, 0.67, -0.9], { color: feltWall, aoStrength: 0.24 }));
  parts.push(createRoundedBoxPart(2.08, 0.038, 0.088, 0.016, [0, 1.35, -0.9], { color: trim, aoFloorY: 1.3 }));
  parts.push(
    createRoundedBoxPart(0.075, 1.34, 1.82, 0.024, [-1.0, 0.67, -0.02], { color: feltWall, aoStrength: 0.24 }),
  );
  parts.push(createRoundedBoxPart(0.088, 0.038, 1.84, 0.016, [-1.0, 1.35, -0.02], { color: trim, aoFloorY: 1.3 }));
  // Half-height return wing on right side
  parts.push(createRoundedBoxPart(0.075, 1.08, 0.96, 0.024, [1.0, 0.54, -0.45], { color: feltWall, aoStrength: 0.24 }));

  // Fabric tackboard strip + colorful Job-Simulator sticky notes & schematic printout
  parts.push(createRoundedBoxPart(0.86, 0.34, 0.02, 0.01, [-0.42, 1.06, -0.855], { color: feltTack, aoFloorY: 0.88 }));
  parts.push(
    createRoundedBoxPart(0.09, 0.09, 0.008, 0.003, [-0.68, 1.12, -0.842], { color: "#fef08a", aoStrength: 0 }),
  );
  parts.push(
    createRoundedBoxPart(0.09, 0.09, 0.008, 0.003, [-0.55, 1.09, -0.842], { color: "#7dd3fc", aoStrength: 0 }),
  );
  parts.push(
    createRoundedBoxPart(0.09, 0.09, 0.008, 0.003, [-0.62, 0.98, -0.842], { color: "#fda4af", aoStrength: 0 }),
  );
  parts.push(
    createRoundedBoxPart(0.28, 0.22, 0.008, 0.003, [-0.22, 1.06, -0.842], { color: "#f8fafc", aoStrength: 0 }),
  );

  // Warm White-Oak L-Shaped Desktop + Steel Legs + 3-Drawer Under-Desk Pedestal
  parts.push(createRoundedBoxPart(1.92, 0.045, 0.76, 0.022, [0, 0.74, -0.48], { color: oak, aoFloorY: 0.7 }));
  parts.push(createRoundedBoxPart(0.68, 0.045, 0.92, 0.022, [-0.62, 0.74, 0.34], { color: oak, aoFloorY: 0.7 }));
  parts.push(
    createRoundedBoxPart(0.05, 0.72, 0.66, 0.014, [0.88, 0.36, -0.48], { color: "#475569", aoStrength: 0.28 }),
  );
  parts.push(
    createRoundedBoxPart(0.58, 0.05, 0.05, 0.014, [-0.62, 0.36, 0.74], { color: "#475569", aoStrength: 0.28 }),
  );

  // 3-Drawer Rolling Filing Pedestal with silver handles
  parts.push(
    createRoundedBoxPart(0.42, 0.64, 0.56, 0.024, [0.58, 0.34, -0.48], { color: "#f1f5f9", aoStrength: 0.25 }),
  );
  for (const dy of [0.18, 0.36, 0.54]) {
    parts.push(createRoundedBoxPart(0.18, 0.018, 0.024, 0.006, [0.58, dy, -0.19], { color: trim, aoStrength: 0 }));
  }

  // Dual Thin-Bezel Studio Monitors on VESA Arm (bright IDE & CAD screen faces)
  parts.push(createCylinderPart(0.028, 0.032, 0.34, 10, [0.12, 0.92, -0.74], { color: darkMetal, aoFloorY: 0.74 }));
  for (const [mx, myaw, screenTint] of [
    [-0.18, 0.16, "#dbeafe"],
    [0.44, -0.16, "#e0f2fe"],
  ] as const) {
    parts.push(
      createRoundedBoxPart(0.58, 0.35, 0.028, 0.014, [mx, 1.08, -0.68], { color: darkMetal, aoFloorY: 0.88 }, [
        0,
        myaw,
        0,
      ]),
    );
    parts.push(
      createRoundedBoxPart(
        0.54,
        0.31,
        0.008,
        0.006,
        [mx + Math.sin(myaw) * 0.015, 1.08, -0.665],
        { color: screenTint, aoStrength: 0, giStrength: 0.04 },
        [0, myaw, 0],
      ),
    );
  }

  // Low-profile Aluminum Keyboard + Mouse + Ceramic Coffee Mug + Articulated Desk Lamp
  parts.push(createRoundedBoxPart(0.38, 0.016, 0.13, 0.01, [0.1, 0.77, -0.32], { color: "#e2e8f0", aoFloorY: 0.75 }));
  parts.push(
    createRoundedBoxPart(0.065, 0.024, 0.105, 0.024, [0.38, 0.772, -0.32], { color: "#f8fafc", aoFloorY: 0.75 }),
  );
  parts.push(createCylinderPart(0.044, 0.038, 0.1, 14, [0.62, 0.81, -0.3], { color: "#0284c7", aoFloorY: 0.75 }));
  // Desk lamp on left L-return
  parts.push(createCylinderPart(0.09, 0.095, 0.02, 14, [-0.72, 0.77, -0.66], { color: "#334155", aoFloorY: 0.75 }));
  parts.push(
    createCylinderPart(
      0.012,
      0.012,
      0.44,
      8,
      [-0.72, 0.98, -0.66],
      { color: "#64748b", aoFloorY: 0.75 },
      [0.22, 0, -0.18],
    ),
  );
  parts.push(
    createCylinderPart(
      0.04,
      0.085,
      0.11,
      14,
      [-0.63, 1.16, -0.56],
      { color: "#f8fafc", aoFloorY: 1.0 },
      [0.5, 0, -0.3],
    ),
  );

  return mergePartGeometries(parts);
}

/** Classic Job-Simulator Office Water Cooler (`1.38m` tall) + Cup Dispenser + Translucent Blue Bottle. */
export function createOfficeWaterCoolerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(createRoundedBoxPart(0.36, 0.96, 0.36, 0.035, [0, 0.48, 0], { color: "#f1f5f9", aoStrength: 0.26 }));
  parts.push(createRoundedBoxPart(0.26, 0.22, 0.04, 0.015, [0, 0.72, 0.17], { color: "#cbd5e1", aoFloorY: 0.6 }));
  // Red hot & blue cold paddles
  parts.push(createRoundedBoxPart(0.032, 0.055, 0.03, 0.008, [-0.05, 0.77, 0.19], { color: "#ef4444", aoStrength: 0 }));
  parts.push(createRoundedBoxPart(0.032, 0.055, 0.03, 0.008, [0.05, 0.77, 0.19], { color: "#0284c7", aoStrength: 0 }));
  // 5-gallon sky-blue water jug on top
  parts.push(
    createCylinderPart(0.145, 0.145, 0.36, 18, [0, 1.18, 0], { color: "#7dd3fc", aoStrength: 0.05, giStrength: 0.2 }),
  );
  parts.push(createCylinderPart(0.055, 0.145, 0.08, 18, [0, 0.98, 0], { color: "#38bdf8", aoStrength: 0.1 }));
  parts.push(createCylinderPart(0.148, 0.148, 0.03, 18, [0, 1.37, 0], { color: "#bae6fd", aoStrength: 0 }));
  return mergePartGeometries(parts);
}

/** Boat-Shaped Conference Room Table (`3.4m × 1.25m`) in Warm Walnut with Power Trough. */
export function createConferenceTableGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(createRoundedBoxPart(3.4, 0.055, 1.24, 0.24, [0, 0.74, 0], { color: "#855d3f", aoFloorY: 0.7 }));
  // Brushed aluminum center cable-hatch strip
  parts.push(createRoundedBoxPart(1.35, 0.012, 0.14, 0.02, [0, 0.77, 0], { color: "#cbd5e1", aoStrength: 0 }));
  // Twin sculpted cylinder-slab pedestals
  parts.push(createRoundedBoxPart(0.22, 0.7, 0.62, 0.08, [-0.95, 0.36, 0], { color: "#334155", aoStrength: 0.3 }));
  parts.push(createRoundedBoxPart(0.22, 0.7, 0.62, 0.08, [0.95, 0.36, 0], { color: "#334155", aoStrength: 0.3 }));
  return mergePartGeometries(parts);
}

/* -------------------------------------------------------------------------- */
/*  4. Warehouse R&D Robotics & Prototyping Cell Archetypes                   */
/* -------------------------------------------------------------------------- */

/** Autonomous Mobile Robot / AGV Rover (`1.15m × 0.78m`) with LiDAR Dome & Safety Bumper. */
export function createWarehouseAgvGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(createRoundedBoxPart(1.16, 0.12, 0.8, 0.12, [0, 0.09, 0], { color: "#1e293b", aoStrength: 0.34 }));
  parts.push(createRoundedBoxPart(1.1, 0.22, 0.74, 0.1, [0, 0.24, 0], { color: "#eab308", aoFloorY: 0.12 }));
  parts.push(createRoundedBoxPart(0.92, 0.04, 0.62, 0.06, [0, 0.37, 0], { color: "#334155", aoFloorY: 0.34 }));
  // Spinning-style LiDAR sensor puck + cyan status band
  parts.push(createCylinderPart(0.075, 0.085, 0.09, 16, [0.36, 0.43, 0], { color: "#0f172a", aoFloorY: 0.38 }));
  parts.push(createCylinderPart(0.077, 0.077, 0.025, 16, [0.36, 0.44, 0], { color: "#38bdf8", aoStrength: 0 }));
  return mergePartGeometries(parts);
}

/** Heavy R&D Electronics & Mechatronics Workbench (`2.2m` wide) with Pegboard, Oscilloscope & Parts Bins. */
export function createLabWorkbenchGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const steel = "#334155";
  const maple = "#dfb98c";

  // Steel frame legs + lower shelf + thick butcher-block top
  for (const lx of [-1.02, 1.02]) {
    parts.push(createRoundedBoxPart(0.06, 0.86, 0.76, 0.015, [lx, 0.43, 0], { color: steel, aoStrength: 0.3 }));
  }
  parts.push(createRoundedBoxPart(2.02, 0.035, 0.68, 0.015, [0, 0.24, 0], { color: "#475569", aoStrength: 0.2 }));
  parts.push(createRoundedBoxPart(2.22, 0.06, 0.86, 0.024, [0, 0.88, 0], { color: maple, aoFloorY: 0.84 }));

  // Rear perforated pegboard hutch + top LED worklight canopy
  parts.push(createRoundedBoxPart(2.14, 0.86, 0.045, 0.02, [0, 1.34, -0.38], { color: "#64748b", aoFloorY: 0.9 }));
  parts.push(createRoundedBoxPart(2.18, 0.045, 0.32, 0.018, [0, 1.78, -0.26], { color: steel, aoFloorY: 1.7 }));
  parts.push(createRoundedBoxPart(1.85, 0.018, 0.12, 0.008, [0, 1.752, -0.24], { color: "#fffbeb", aoStrength: 0 }));

  // Digital Oscilloscope + Bench Power Supply + Colorful Akro Parts Bins
  parts.push(createRoundedBoxPart(0.46, 0.3, 0.24, 0.025, [-0.56, 1.06, -0.14], { color: "#e2e8f0", aoFloorY: 0.9 }));
  parts.push(createRoundedBoxPart(0.3, 0.2, 0.015, 0.01, [-0.61, 1.07, -0.018], { color: "#0f172a", aoStrength: 0 }));
  parts.push(
    createRoundedBoxPart(0.28, 0.18, 0.008, 0.008, [-0.61, 1.07, -0.008], { color: "#34d399", aoStrength: 0 }),
  );
  parts.push(createRoundedBoxPart(0.32, 0.22, 0.26, 0.02, [-0.08, 1.02, -0.14], { color: "#1e293b", aoFloorY: 0.9 }));

  const binColors = ["#0284c7", "#eab308", "#ef4444", "#0284c7"];
  for (let i = 0; i < 4; i++) {
    parts.push(
      createRoundedBoxPart(0.18, 0.13, 0.22, 0.018, [0.34 + i * 0.21, 0.975, -0.18], {
        color: binColors[i]!,
        aoFloorY: 0.9,
      }),
    );
  }

  return mergePartGeometries(parts);
}

/* -------------------------------------------------------------------------- */
/*  5. Large-Scale Outdoor Engineering Landmarks (Turbines, Bridge, Boats)    */
/* -------------------------------------------------------------------------- */

/** Utility-Scale Wind Turbine Tower + Streamlined Nacelle (`1.0` = `22m` hub height). */
export function createWindTurbineTowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Concrete foundation pad + tapered white tubular steel tower
  parts.push(createCylinderPart(1.6, 1.85, 0.6, 20, [0, 0.3, 0], { color: "#cbd5e1", aoStrength: 0.28 }));
  parts.push(
    createCylinderPart(0.46, 1.05, 21.6, 20, [0, 11.1, 0], {
      color: "#f8fafc",
      aoFloorY: 0.3,
      aoHeight: 4.5,
      aoStrength: 0.22,
    }),
  );
  // Streamlined beveled nacelle + aviation warning beacon
  parts.push(createRoundedBoxPart(1.38, 1.42, 3.65, 0.38, [0, 22.1, -0.45], { color: "#ffffff", aoFloorY: 21.2 }));
  parts.push(createCylinderPart(0.14, 0.14, 0.24, 10, [0, 22.92, -1.6], { color: "#ef4444", aoStrength: 0 }));
  return mergePartGeometries(parts);
}

/** 3-Blade Wind Turbine Rotor + Spinner Hub (`10.5m` blade radius; origin at hub center, spins around Z). */
export function createWindTurbineRotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Aerodynamic nose cone spinner pointing +Z
  parts.push(
    createCylinderPart(0.08, 0.68, 1.45, 18, [0, 0, 0.65], { color: "#f8fafc", aoStrength: 0.08 }, [Math.PI / 2, 0, 0]),
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    // Root cylinder + tapered pitched airfoil blade
    parts.push(
      createCylinderPart(0.22, 0.28, 1.6, 12, [sin * 0.9, cos * 0.9, 0.2], { color: "#f1f5f9", aoStrength: 0.08 }, [
        0,
        0,
        -a,
      ]),
    );
    parts.push(
      createRoundedBoxPart(
        0.62,
        9.4,
        0.14,
        0.06,
        [sin * 5.8, cos * 5.8, 0.22],
        { color: "#ffffff", aoStrength: 0.05, giStrength: 0.14 },
        [0, 0.18, -a],
      ),
    );
  }
  return mergePartGeometries(parts);
}

/** Modern Cable-Stayed Bridge Spanning the Distant Lake Narrows (`64m` span, `19m` twin A-pylons). */
export function createCableStayedBridgeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const concrete = "#f1f5f9";
  const deckCol = "#dbe4ee";
  const cableCol = "#cbd5e1";

  // Slender orthotropic roadway deck + piers
  parts.push(createRoundedBoxPart(68, 0.75, 4.6, 0.2, [0, 5.4, 0], { color: deckCol, aoFloorY: 4.8 }));

  for (const px of [-16, 16]) {
    // Pier footings in water
    parts.push(
      createRoundedBoxPart(2.6, 6.2, 5.2, 0.4, [px, 2.6, 0], {
        color: "#cbd5e1",
        aoFloorY: 0,
        aoHeight: 2.5,
        aoStrength: 0.3,
      }),
    );
    // Twin inclined A-frame tower legs rising to y = 19.5m
    parts.push(
      createRoundedBoxPart(0.85, 14.8, 0.9, 0.18, [px, 12.4, -1.35], { color: concrete, aoFloorY: 5.4 }, [0.09, 0, 0]),
    );
    parts.push(
      createRoundedBoxPart(0.85, 14.8, 0.9, 0.18, [px, 12.4, 1.35], { color: concrete, aoFloorY: 5.4 }, [-0.09, 0, 0]),
    );
    parts.push(createRoundedBoxPart(1.0, 0.7, 2.2, 0.15, [px, 15.2, 0], { color: concrete, aoFloorY: 14.8 }));
    parts.push(createRoundedBoxPart(1.0, 1.1, 1.4, 0.2, [px, 19.4, 0], { color: concrete, aoFloorY: 18.8 }));

    // Fan-arranged stay cables on left & right of each pylon
    for (const side of [-1, 1]) {
      for (let c = 1; c <= 4; c++) {
        const anchorX = px + side * (3.6 * c);
        const topY = 15.8 + c * 0.85;
        const dx = anchorX - px;
        const dy = 5.6 - topY;
        const len = Math.hypot(dx, dy);
        const ang = Math.atan2(dx, -dy);
        parts.push(
          createCylinderPart(
            0.055,
            0.055,
            len,
            6,
            [(px + anchorX) * 0.5, (topY + 5.6) * 0.5, 0],
            { color: cableCol, aoStrength: 0 },
            [0, 0, -ang],
          ),
        );
      }
    }
  }

  return mergePartGeometries(parts);
}

/** Sleek Autonomous Research Sailboat / Yacht with True Triangular Mainsail & Jib (`5.2m` hull, `6.8m` mast). */
export function createLakeSailboatGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Tapered hull + cabin coachroof
  parts.push(
    createRoundedBoxPart(1.35, 0.42, 4.8, 0.24, [0, 0.16, 0], { color: "#f8fafc", aoFloorY: -0.1, aoStrength: 0.22 }),
  );
  parts.push(createRoundedBoxPart(0.96, 0.24, 1.6, 0.12, [0, 0.44, 0.15], { color: "#0284c7", aoFloorY: 0.3 }));
  // Slender aluminum mast + boom
  parts.push(createCylinderPart(0.032, 0.048, 6.4, 10, [0, 3.4, 0.45], { color: "#cbd5e1", aoStrength: 0.05 }));
  parts.push(
    createCylinderPart(0.028, 0.032, 2.5, 8, [0, 0.95, -0.82], { color: "#cbd5e1", aoStrength: 0.05 }, [
      Math.PI / 2,
      0,
      0,
    ]),
  );

  // True triangular mainsail (aft of mast) + foresail jib (forward of mast), slightly billowed
  const sailGeom = new THREE.BufferGeometry();
  const sailVerts = new Float32Array([
    // Mainsail (double-sided via two wind-curved triangles)
    0.0, 6.45, 0.42, 0.14, 1.02, -2.02, 0.0, 1.02, 0.42, 0.0, 6.45, 0.42, 0.0, 1.02, 0.42, 0.14, 1.02, -2.02,
    // Jib foresail
    0.0, 5.65, 0.52, 0.0, 0.85, 0.52, -0.1, 0.72, 2.25, 0.0, 5.65, 0.52, -0.1, 0.72, 2.25, 0.0, 0.85, 0.52,
  ]);
  sailGeom.setAttribute("position", new THREE.BufferAttribute(sailVerts, 3));
  sailGeom.computeVertexNormals();
  parts.push(bakePartGeometry(sailGeom, { color: "#ffffff", aoStrength: 0.04, giStrength: 0.16 }));

  return mergePartGeometries(parts);
}

/** Geodesic Observatory Pavilion Dome (`9.5m` diameter) for a distant scenic bluff. */
export function createObservatoryDomeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(createCylinderPart(4.8, 5.1, 2.8, 24, [0, 1.4, 0], { color: "#f1f5f9", aoStrength: 0.26 }));
  parts.push(createCylinderPart(5.0, 5.0, 0.25, 24, [0, 2.85, 0], { color: "#cbd5e1", aoFloorY: 2.6 }));

  const dome = new THREE.IcosahedronGeometry(4.45, 2);
  const pos = dome.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setY(i, 2.85 + Math.max(-0.2, y * 0.88));
  }
  pos.needsUpdate = true;
  dome.computeVertexNormals();
  parts.push(
    bakePartGeometry(dome, { color: "#ffffff", aoFloorY: 2.6, aoHeight: 3.2, aoStrength: 0.14, giStrength: 0.2 }),
  );

  // Observatory slit arch
  parts.push(createRoundedBoxPart(0.95, 3.6, 4.65, 0.2, [0, 4.6, 0.1], { color: "#334155", aoFloorY: 2.8 }));
  return mergePartGeometries(parts);
}

/**
 * Multi-layered 360° Horizon Mountain & Foothill Vista Ring (`innerR` + `outerR`)
 * with aerial-perspective atmospheric mist baked into vertex colors for 6DoF Quest parallax.
 */
export function createPanoramicMountainRingGeometry(
  radius: number,
  baseY: number,
  minHeight: number,
  maxHeight: number,
  ridgeColorHex: string,
  hazeColorHex: string,
  seed: number,
  segments = 96,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const ridgeCol = new THREE.Color(ridgeColorHex);
  const hazeCol = new THREE.Color(hazeColorHex);
  const snowCol = new THREE.Color("#f8fafc");
  const tmpTop = new THREE.Color();

  const ridgeHAt = (i: number): number => {
    const u = (i % segments) / segments;
    const a = u * Math.PI * 2;
    const w1 = 0.5 + 0.5 * Math.sin(a * 3 + seed);
    const w2 = 0.5 + 0.5 * Math.cos(a * 7 - seed * 1.7);
    const w3 = 0.5 + 0.5 * Math.sin(a * 13 + seed * 2.9);
    const shaped = Math.pow(w1 * 0.52 + w2 * 0.32 + w3 * 0.16, 1.25);
    return minHeight + (maxHeight - minHeight) * shaped;
  };

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const h0 = ridgeHAt(i);
    const h1 = ridgeHAt(i + 1);

    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;

    const top0 = baseY + h0;
    const top1 = baseY + h1;

    // Two triangles facing inward toward origin
    positions.push(x0, baseY, z0, x0, top0, z0, x1, top1, z1);
    positions.push(x0, baseY, z0, x1, top1, z1, x1, baseY, z1);

    const snowMix0 = clamp01(
      (h0 - (minHeight + (maxHeight - minHeight) * 0.68)) / Math.max(1, (maxHeight - minHeight) * 0.3),
    );
    const snowMix1 = clamp01(
      (h1 - (minHeight + (maxHeight - minHeight) * 0.68)) / Math.max(1, (maxHeight - minHeight) * 0.3),
    );

    tmpTop.copy(ridgeCol).lerp(snowCol, snowMix0 * 0.42);
    const r0 = tmpTop.r;
    const g0 = tmpTop.g;
    const b0 = tmpTop.b;

    tmpTop.copy(ridgeCol).lerp(snowCol, snowMix1 * 0.42);
    const r1 = tmpTop.r;
    const g1 = tmpTop.g;
    const b1 = tmpTop.b;

    // Base blends seamlessly into horizon haze; ridge crest shows crisp alpine silhouette
    colors.push(
      hazeCol.r,
      hazeCol.g,
      hazeCol.b,
      r0,
      g0,
      b0,
      r1,
      g1,
      b1,
      hazeCol.r,
      hazeCol.g,
      hazeCol.b,
      r1,
      g1,
      b1,
      hazeCol.r,
      hazeCol.g,
      hazeCol.b,
    );
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}
