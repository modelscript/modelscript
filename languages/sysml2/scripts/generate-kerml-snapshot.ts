// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build script to generate pre-compiled KerML standard library snapshot.
 * Parses stdlib/KerML.sysml using the WASM GLR parser and emits src-gen/kerml-snapshot.ts.
 */

import { createWasmParser } from "@modelscript/dsl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSysML2WorkspaceIndex } from "../src/factory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sysmlDir = path.resolve(__dirname, "..");
const wasmPath = path.resolve(sysmlDir, "dist/parser.wasm");
const kermlPath = path.resolve(sysmlDir, "stdlib/KerML.sysml");
const outSnapshotTs = path.resolve(sysmlDir, "src-gen/kerml-snapshot.ts");
const outSnapshotJs = path.resolve(sysmlDir, "src-gen/kerml-snapshot.js");

async function main() {
  console.log("[sysml2] Generating pre-compiled KerML standard library snapshot...");
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`parser.wasm not found at ${wasmPath}. Build the parser first.`);
  }
  if (!fs.existsSync(kermlPath)) {
    throw new Error(`KerML.sysml not found at ${kermlPath}`);
  }

  const { parser } = await createWasmParser(wasmPath);
  const workspaceIndex = createSysML2WorkspaceIndex();
  const text = fs.readFileSync(kermlPath, "utf-8");
  const uri = "sysml2://stdlib/KerML.sysml";

  workspaceIndex.register(uri, () => {
    const tree = parser.parse(text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tree ? (tree.rootNode as any) : null;
  });

  const entries = workspaceIndex.exportFileEntries(uri);
  console.log(`[sysml2] Indexed ${entries.length} standard library symbols from KerML.sysml`);

  const tsContent = `// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated pre-compiled KerML standard library snapshot.
// DO NOT EDIT DIRECTLY. Regenerated during build.

/* eslint-disable */
import type { SymbolEntry } from "@modelscript/runtime";

export const KERML_STDLIB_URI = "sysml2://stdlib/KerML.sysml";

export const kermlStdlibEntries: SymbolEntry[] = ${JSON.stringify(entries, null, 2)};
`;

  const jsContent = `// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated pre-compiled KerML standard library snapshot.
// DO NOT EDIT DIRECTLY. Regenerated during build.

export const KERML_STDLIB_URI = "sysml2://stdlib/KerML.sysml";

export const kermlStdlibEntries = ${JSON.stringify(entries, null, 2)};
`;

  fs.mkdirSync(path.dirname(outSnapshotTs), { recursive: true });
  fs.writeFileSync(outSnapshotTs, tsContent, "utf-8");
  fs.writeFileSync(outSnapshotJs, jsContent, "utf-8");
  console.log(`[sysml2] Snapshot written to -> ${outSnapshotTs}`);
}

main().catch((err) => {
  console.error("[sysml2] Snapshot generation failed:", err);
  process.exit(1);
});
