// @ts-expect-error missing types for occt-import-js
import occtimportjs from "occt-import-js";
import type { LibraryDatabase } from "../database.js";

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

export async function convertStepToJson(url: string, database: LibraryDatabase): Promise<unknown> {
  // Check cache first
  const cached = database.getCachedCadGeometry(url);
  if (cached) {
    return JSON.parse(cached);
  }

  console.log(`[CAD] Fetching and converting STEP: ${url}`);
  let fetchUrl = url;
  if (url.startsWith("/")) {
    const port = process.env["PORT"] || "3000";
    fetchUrl = `http://localhost:${port}${url}`;
  }
  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch STEP file: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const fileData = new Uint8Array(buffer);

  // occtimportjs is a wasm module factory
  const occt = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (occtimportjs as unknown as () => Promise<{ ReadStepFile: (data: Uint8Array, param: null) => any }>)();

  // Read the STEP file from memory
  const result = occt.ReadStepFile(fileData, null);

  if (!result || !result.meshes || result.meshes.length === 0) {
    throw new Error("No meshes found in STEP file");
  }

  // Compute mass properties for manufacturing estimation
  result.properties = computeMeshProperties(result.meshes);

  // We have the raw meshes output from OCCT. We can cache and return it directly.
  const jsonStr = JSON.stringify(result);
  database.setCachedCadGeometry(url, jsonStr);

  return result;
}
