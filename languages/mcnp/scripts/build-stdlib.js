// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildMcnpCleanroomSchemas } from "../src/catalog/mcnp-std-schemas.ts";

const mcnpDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(mcnpDir, "assets", "mcnp-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildMcnpCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "mcnp",
  packageName: "@modelscript/mcnp-std-lib",
  description: `Cleanroom MCNP ENDF-like isotopic cross-sections, surface & tally archetypes (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(mcnpDir, "src", "catalog", "mcnp-std-lib-data.ts"),
  constPrefix: "MCNP_STD_LIB",
  wasmGetterName: "getMcnpStdLibWasmBytes",
});
