// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanroomSchemasToLibraryPayloads } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { buildCleanroomStdLib } from "../../../scripts/build/build-cleanroom-stdlib.js";
import { buildAsn1CleanroomSchemas } from "../src/catalog/asn1-std-schemas.ts";

const asn1Dir = new URL("..", import.meta.url).pathname;
const stdLibDir = path.join(asn1Dir, "assets", "asn1-std-lib");
const stdLibSrc = path.join(stdLibDir, "src");
fs.mkdirSync(stdLibSrc, { recursive: true });

// 1. Materialize symbols.json and diagrams.json (with cleanroom SVG block icons) from declarative schemas
const schemas = buildAsn1CleanroomSchemas();
const { symbols, diagrams } = cleanroomSchemasToLibraryPayloads(schemas);
fs.writeFileSync(path.join(stdLibSrc, "symbols.json"), JSON.stringify(symbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(stdLibSrc, "diagrams.json"), JSON.stringify(diagrams, null, 2) + "\n", "utf-8");

// 2. Build modelscript.yaml + AssemblyScript runtime.wasm + zero-I/O TS bundle
buildCleanroomStdLib({
  langName: "asn1",
  packageName: "@modelscript/asn1-std-lib",
  description: `Cleanroom ISO/ITU-T X.680 ASN.1 universal tags & 1980s protocol schemas standard library (${schemas.length} schemas, cleanroom SVG block icons, AssemblyScript WASM runtime)`,
  stdLibDir,
  entryFile: "src/models.ts",
  outTsPath: path.join(asn1Dir, "src", "catalog", "asn1-std-lib-data.ts"),
  constPrefix: "ASN1_STD_LIB",
  wasmGetterName: "getAsn1StdLibWasmBytes",
});
