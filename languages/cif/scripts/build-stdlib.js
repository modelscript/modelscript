// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildCifCleanroomSchemas } from "../src/catalog/cif-std-schemas.ts";

const cifDir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(cifDir, "assets", "cif-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json from declarative MOSIS SCMOS & Mead-Conway schemas
const schemas = buildCifCleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "cif",
  packageName: "@modelscript/cif-std-lib",
  description: `Cleanroom MOSIS SCMOS & Mead-Conway CIF 2.0 IC layout standard library (${schemas.length} schemas, SVG layer icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(cifDir, "src", "catalog", "cif-std-lib-data.ts"),
  constPrefix: "CIF_STD_LIB",
  wasmGetterName: "getCifStdLibWasmBytes",
});
