// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Zero-Dependency STL/OBJ Mesh Loader & Robotics Animation Binding Builder.
 *
 * Parses binary/ASCII `.stl` and Wavefront `.obj` link meshes and generates
 * `AnimationBinding[]` connecting `DAEBuilder` 6-DOF link trajectories,
 * ground-reaction contact force vectors (`vectorCoordinates`), and servo
 * winding temperature heatmaps (`color`) to `AnimationController`.
 */

import type { AnimationBinding } from "./animation-controller.js";

export interface LoadedMeshBuffers {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface RobotSceneInput {
  linkNames: string[];
  baseLinkName?: string | undefined;
  contactNames?: string[] | undefined;
  servoJointNames?: string[] | undefined;
  prefix?: string | undefined;
}

/**
 * Parses an ASCII or binary `.stl` file into indexed triangle buffers.
 */
export function parseStlMesh(input: Uint8Array | string): LoadedMeshBuffers {
  if (typeof input === "string") {
    return parseAsciiStl(input);
  }
  // Heuristic: ASCII STL starts with "solid" and contains "facet normal"
  const head = new TextDecoder().decode(input.subarray(0, Math.min(256, input.length)));
  if (head.trimStart().startsWith("solid") && head.includes("facet")) {
    return parseAsciiStl(new TextDecoder().decode(input));
  }
  return parseBinaryStl(input);
}

function parseBinaryStl(bytes: Uint8Array): LoadedMeshBuffers {
  if (bytes.byteLength < 84) {
    return { vertices: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const maxTris = Math.min(triCount, Math.floor((bytes.byteLength - 84) / 50));

  const vertices = new Float32Array(maxTris * 9);
  const normals = new Float32Array(maxTris * 9);
  const indices = new Uint32Array(maxTris * 3);

  let offset = 84;
  for (let t = 0; t < maxTris; t++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;
    for (let v = 0; v < 3; v++) {
      const idx = t * 9 + v * 3;
      vertices[idx] = view.getFloat32(offset, true);
      vertices[idx + 1] = view.getFloat32(offset + 4, true);
      vertices[idx + 2] = view.getFloat32(offset + 8, true);
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
      indices[t * 3 + v] = t * 3 + v;
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  return { vertices, normals, indices };
}

function parseAsciiStl(text: string): LoadedMeshBuffers {
  const verts: number[] = [];
  const norms: number[] = [];
  let currentNormal: [number, number, number] = [0, 0, 1];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("facet normal")) {
      const parts = line.split(/\s+/);
      currentNormal = [
        Number.parseFloat(parts[2] ?? "0") || 0,
        Number.parseFloat(parts[3] ?? "0") || 0,
        Number.parseFloat(parts[4] ?? "1") || 0,
      ];
    } else if (line.startsWith("vertex")) {
      const parts = line.split(/\s+/);
      verts.push(
        Number.parseFloat(parts[1] ?? "0") || 0,
        Number.parseFloat(parts[2] ?? "0") || 0,
        Number.parseFloat(parts[3] ?? "0") || 0,
      );
      norms.push(currentNormal[0], currentNormal[1], currentNormal[2]);
    }
  }

  const count = Math.floor(verts.length / 3);
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  return {
    vertices: new Float32Array(verts),
    normals: new Float32Array(norms),
    indices,
  };
}

/**
 * Parses a Wavefront `.obj` mesh into unindexed triangle buffers.
 */
export function parseObjMesh(text: string): LoadedMeshBuffers {
  const rawPositions: [number, number, number][] = [];
  const rawNormals: [number, number, number][] = [];
  const verts: number[] = [];
  const norms: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v" && parts.length >= 4) {
      rawPositions.push([
        Number.parseFloat(parts[1]!) || 0,
        Number.parseFloat(parts[2]!) || 0,
        Number.parseFloat(parts[3]!) || 0,
      ]);
    } else if (parts[0] === "vn" && parts.length >= 4) {
      rawNormals.push([
        Number.parseFloat(parts[1]!) || 0,
        Number.parseFloat(parts[2]!) || 0,
        Number.parseFloat(parts[3]!) || 0,
      ]);
    } else if (parts[0] === "f" && parts.length >= 4) {
      const faceVerts = parts.slice(1);
      for (let i = 1; i + 1 < faceVerts.length; i++) {
        for (const token of [faceVerts[0]!, faceVerts[i]!, faceVerts[i + 1]!]) {
          const [vStr, , vnStr] = token.split("/");
          const vIdx = (Number.parseInt(vStr ?? "1", 10) || 1) - 1;
          const pos = rawPositions[vIdx] ?? [0, 0, 0];
          verts.push(pos[0], pos[1], pos[2]);
          const vnIdx = vnStr ? (Number.parseInt(vnStr, 10) || 1) - 1 : -1;
          const n = vnIdx >= 0 ? rawNormals[vnIdx] : undefined;
          norms.push(n?.[0] ?? 0, n?.[1] ?? 0, n?.[2] ?? 1);
        }
      }
    }
  }

  const count = Math.floor(verts.length / 3);
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  return {
    vertices: new Float32Array(verts),
    normals: new Float32Array(norms),
    indices,
  };
}

/**
 * Builds `AnimationBinding[]` for 6-DOF robot links, ground-reaction force vectors,
 * and servo thermal color overlays compatible with `AnimationController`.
 */
export function buildRobotAnimationBindings(input: RobotSceneInput): AnimationBinding[] {
  const p = input.prefix ?? "";
  const bindings: AnimationBinding[] = [];

  for (const linkName of input.linkNames) {
    if (linkName === "world") continue;
    bindings.push({
      componentName: linkName,
      bindings: [
        { property: "position", index: 0, variable: `${p}${linkName}.x`, unit: "m" },
        { property: "position", index: 1, variable: `${p}${linkName}.y`, unit: "m" },
        { property: "position", index: 2, variable: `${p}${linkName}.z`, unit: "m" },
      ],
    });
  }

  if (input.contactNames) {
    for (const cName of input.contactNames) {
      bindings.push({
        componentName: `${cName}_force_arrow`,
        bindings: [
          { property: "vectorCoordinates", index: 0, variable: `${p}${cName}.fx`, scaleFactor: 0.02 },
          { property: "vectorCoordinates", index: 1, variable: `${p}${cName}.fy`, scaleFactor: 0.02 },
          { property: "vectorCoordinates", index: 2, variable: `${p}${cName}.fz`, scaleFactor: 0.02 },
        ],
      });
    }
  }

  if (input.servoJointNames) {
    for (const jName of input.servoJointNames) {
      bindings.push({
        componentName: `${jName}_servo_thermal`,
        bindings: [{ property: "color", index: 0, variable: `${p}${jName}.T_winding`, scaleFactor: 1 / 373.15 }],
      });
    }
  }

  return bindings;
}
