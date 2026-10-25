// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gensysDir = path.resolve(__dirname, "..");
const wasmOutPath = path.join(gensysDir, "dist", "contact.wasm");
const binaryTsPath = path.join(gensysDir, "src", "contact", "wasm-binary.ts");

console.log("[gensys] Compiling contact mechanics WebAssembly kernel with asc...");
execFileSync("npx", ["asc", "assembly/contact.ts", "--config", "asconfig.json"], {
  cwd: gensysDir,
  stdio: "inherit",
});

if (!fs.existsSync(wasmOutPath)) {
  throw new Error(`Expected WASM output file at ${wasmOutPath}`);
}

const wasmBuffer = fs.readFileSync(wasmOutPath);
const base64 = wasmBuffer.toString("base64");

const tsContent = `// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pre-compiled WebAssembly binary payload for GENSYS Contact Mechanics Kernel.
 * Embedded as base64 for zero-I/O execution in browsers, Web Workers, and Node.js.
 */
export const CONTACT_WASM_BASE64 =
  "${base64}";

let cachedBytes: Uint8Array | null = null;

export function getContactWasmBinary(): Uint8Array {
  if (!cachedBytes) {
    if (typeof Buffer !== "undefined") {
      cachedBytes = new Uint8Array(Buffer.from(CONTACT_WASM_BASE64, "base64"));
    } else {
      const binaryStr = atob(CONTACT_WASM_BASE64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      cachedBytes = bytes;
    }
  }
  return cachedBytes;
}
`;

fs.writeFileSync(binaryTsPath, tsContent, "utf-8");
console.log(`[gensys] Generated ${binaryTsPath} (${base64.length} chars, ${wasmBuffer.length} bytes WASM).`);
