// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const srcPath = path.join(rootDir, "assembly", "flattener.ts");
const destPath = path.join(rootDir, "src", "flattener-wasm.ts");

if (!fs.existsSync(srcPath)) {
  throw new Error(`Source assembly file not found at ${srcPath}`);
}

let content = fs.readFileSync(srcPath, "utf-8");

// Strip redundant license header from inside the string if present
content = content.replace(/^\/\/ SPDX-License-Identifier: [^\n]+\n/, "");
// Clean leading whitespace/newlines
content = content.trimStart();

const cleaned = content.replace(/\\/g, "\\\\").replace(/\`/g, "\\`").replace(/\$/g, "\\$");

const out = `// SPDX-License-Identifier: AGPL-3.0-or-later
// AUTO-GENERATED FROM assembly/flattener.ts - DO NOT EDIT DIRECTLY

export const modelicaFlattenerWasmCode = \`${cleaned}\`;
`;

fs.writeFileSync(destPath, out, "utf-8");
console.log(`[modelica] Bundled assembly/flattener.ts -> src/flattener-wasm.ts (${cleaned.length} chars)`);
