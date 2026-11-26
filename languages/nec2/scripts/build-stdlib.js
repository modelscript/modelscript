// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildNec2CleanroomSchemas } from "../src/catalog/nec2-std-schemas.ts";

const nec2Dir = fileURLToPath(new URL("..", import.meta.url));
const stdLibDir = path.join(nec2Dir, "assets", "nec2-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildNec2CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "nec2",
  packageName: "@modelscript/nec2-std-lib",
  description: `Cleanroom LLNL NEC-2 wire antenna standard library (${schemas.length} archetypes, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(nec2Dir, "src", "catalog", "nec2-std-lib-data.ts"),
  constPrefix: "NEC2_STD_LIB",
  wasmGetterName: "getNec2StdLibWasmBytes",
});
