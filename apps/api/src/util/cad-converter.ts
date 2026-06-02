// @ts-expect-error missing types for occt-import-js
import occtimportjs from "occt-import-js";
import type { LibraryDatabase } from "../database.js";

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
  const occt = await (
    occtimportjs as unknown as () => Promise<{ ReadStepFile: (data: Uint8Array, param: null) => { meshes: unknown[] } }>
  )();

  // Read the STEP file from memory
  const result = occt.ReadStepFile(fileData, null);

  if (!result || !result.meshes || result.meshes.length === 0) {
    throw new Error("No meshes found in STEP file");
  }

  // We have the raw meshes output from OCCT. We can cache and return it directly.
  const jsonStr = JSON.stringify(result);
  database.setCachedCadGeometry(url, jsonStr);

  return result;
}
