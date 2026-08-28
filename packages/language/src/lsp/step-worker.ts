import initOpenCascade from "occt-import-js";

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

self.onmessage = async (event) => {
  const { uri, buffer } = event.data;

  try {
    // Initialize the WebAssembly module
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const occt = await (initOpenCascade as any)();

    // occt.ReadStepFile requires a Uint8Array
    const result = occt.ReadStepFile(buffer, null);

    if (result && result.meshes) {
      result.properties = computeMeshProperties(result.meshes);
    }

    self.postMessage({ type: "success", uri, result });
  } catch (error) {
    self.postMessage({ type: "error", uri, error: String(error) });
  }
};
