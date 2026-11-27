// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildParser } from "../dist/index.js";
import { xmlGrammar } from "../dist/xml/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const xmlDir = path.join(pkgDir, "src", "xml");
const asGenDir = path.join(pkgDir, ".cache", "xml-as-gen");
const srcGenDir = path.join(xmlDir, "src-gen");

fs.mkdirSync(asGenDir, { recursive: true });
fs.mkdirSync(srcGenDir, { recursive: true });

const result = buildParser(xmlGrammar, { sourcePath: path.join(xmlDir, "language.ts") });
for (const file of result.assemblyScriptFiles) {
  const outPath = path.join(asGenDir, file.filename);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, file.content);
}

fs.writeFileSync(path.join(srcGenDir, "bindings.js"), result.javascriptWrapper.js);
fs.writeFileSync(path.join(srcGenDir, "bindings.d.ts"), result.javascriptWrapper.dts);

const ascPath = path.resolve(pkgDir, "../../node_modules/.bin/asc");
const outWasm = path.join(xmlDir, "parser.wasm");
execFileSync(
  ascPath,
  [
    path.join(asGenDir, "parser.ts"),
    "-o",
    outWasm,
    "--exportRuntime",
    "--enable",
    "threads",
    "--enable",
    "simd",
    "--runtime",
    "stub",
    "--optimizeLevel",
    "1",
    "--shrinkLevel",
    "0",
  ],
  { stdio: "inherit" },
);

console.log(`Built ${outWasm} (${(fs.statSync(outWasm).size / 1024).toFixed(1)} KB)`);
