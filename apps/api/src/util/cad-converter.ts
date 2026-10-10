// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssemblyBVH, type BVHItem } from "@modelscript/cad";
import { extractStepAssembly } from "@modelscript/step";
// @ts-expect-error missing types for occt-import-js
import occtimportjs from "occt-import-js";
import type { LibraryDatabase } from "../database.js";
import { safePublicFetch } from "./ssrf.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeMeshProperties(meshes: any[]) {
  let totalVolume = 0;
  let totalSurfaceArea = 0;

  for (const mesh of meshes) {
    if (!mesh.attributes || !mesh.attributes.position || !mesh.index) continue;

    const positions = mesh.attributes.position.array;
    const indices = mesh.index.array;

    let volume = 0;
    let surfaceArea = 0;

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3;
      const i1 = indices[i + 1] * 3;
      const i2 = indices[i + 2] * 3;

      const v0 = [positions[i0], positions[i0 + 1], positions[i0 + 2]];
      const v1 = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
      const v2 = [positions[i2], positions[i2 + 1], positions[i2 + 2]];

      const crossX = v1[1] * v2[2] - v1[2] * v2[1];
      const crossY = v1[2] * v2[0] - v1[0] * v2[2];
      const crossZ = v1[0] * v2[1] - v1[1] * v2[0];

      volume += (v0[0] * crossX + v0[1] * crossY + v0[2] * crossZ) / 6.0;

      const dx1 = v1[0] - v0[0];
      const dy1 = v1[1] - v0[1];
      const dz1 = v1[2] - v0[2];

      const dx2 = v2[0] - v0[0];
      const dy2 = v2[1] - v0[1];
      const dz2 = v2[2] - v0[2];

      const nx = dy1 * dz2 - dz1 * dy2;
      const ny = dz1 * dx2 - dx1 * dz2;
      const nz = dx1 * dy2 - dy1 * dx2;

      surfaceArea += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    }

    totalVolume += Math.abs(volume);
    totalSurfaceArea += surfaceArea;
  }

  return { volume: totalVolume, surfaceArea: totalSurfaceArea };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function convertStepBufferToJson(fileData: Uint8Array, stepText?: string): Promise<any> {
  // occtimportjs is a wasm module factory
  const occt = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (occtimportjs as unknown as () => Promise<{ ReadStepFile: (data: Uint8Array, param: null) => any }>)();

  // Read the STEP file from memory
  const result = occt.ReadStepFile(fileData, null) || { meshes: [] };

  if (result.meshes && result.meshes.length > 0) {
    // Compute mass properties for manufacturing estimation
    result.properties = computeMeshProperties(result.meshes);

    // Build BVH tree over the meshes for fast spatial queries/culling
    try {
      const bvhItems: BVHItem[] = [];
      for (let i = 0; i < result.meshes.length; i++) {
        const mesh = result.meshes[i];
        if (mesh.attributes?.position?.array) {
          const pos = mesh.attributes.position.array;
          let minX = Infinity;
          let minY = Infinity;
          let minZ = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let maxZ = -Infinity;
          for (let j = 0; j < pos.length; j += 3) {
            const x = pos[j];
            const y = pos[j + 1];
            const z = pos[j + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
          bvhItems.push({
            id: i,
            aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
          });
        }
      }
      if (bvhItems.length > 0) {
        const bvh = new AssemblyBVH(bvhItems);
        result.bvh = {
          depth: bvh.depth,
          totalItems: bvh.totalItems,
          root: bvh.root,
        };
      }
    } catch (err) {
      console.warn("[CAD] AssemblyBVH build warning:", err);
    }
  }

  // If STEP text is provided, extract semantic assembly hierarchy and joints
  if (stepText) {
    try {
      const parsedAssembly = extractStepAssembly(stepText);
      result.assembly = {
        parts: Object.fromEntries(parsedAssembly.parts.entries()),
        edges: parsedAssembly.edges,
        joints: parsedAssembly.joints,
        massProperties: Object.fromEntries(parsedAssembly.massProperties.entries()),
        tolerances: parsedAssembly.tolerances,
        datums: parsedAssembly.datums ? Object.fromEntries(parsedAssembly.datums.entries()) : {},
        datumSystems: parsedAssembly.datumSystems,
      };
    } catch (err) {
      console.warn("[CAD] extractStepAssembly warning:", err);
    }
  }

  return result;
}

export async function convertStepToJson(url: string, database: LibraryDatabase): Promise<unknown> {
  // Check cache first
  const cached = database.getCachedCadGeometry(url);
  if (cached) {
    return JSON.parse(cached);
  }

  console.log(`[CAD] Fetching and converting STEP: ${url}`);
  const response = await safePublicFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch STEP file: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const fileData = new Uint8Array(buffer);
  const text = new TextDecoder().decode(fileData);

  const result = await convertStepBufferToJson(fileData, text);

  if (!result || (!result.meshes?.length && !result.assembly)) {
    throw new Error("No meshes or assembly found in STEP file");
  }

  // We have the raw meshes output from OCCT. We can cache and return it directly.
  const jsonStr = JSON.stringify(result);
  database.setCachedCadGeometry(url, jsonStr);

  return result;
}
