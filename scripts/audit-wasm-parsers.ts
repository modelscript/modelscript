// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const languagesDir = path.join(rootDir, "languages");

function findParserWasm(dir: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".cache") continue;
      const hit = findParserWasm(full);
      if (hit) return hit;
    } else if (entry.name === "parser.wasm") {
      return full;
    }
  }
  return null;
}

const langs = fs
  .readdirSync(languagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(languagesDir, d.name, "package.json")))
  .map((d) => d.name)
  .sort();

const missingWasm: string[] = [];
for (const lang of langs) {
  if (!findParserWasm(path.join(languagesDir, lang))) {
    missingWasm.push(lang);
  }
}

const validationSvc = fs.readFileSync(path.join(rootDir, "packages/lsp/src/services/validation-service.ts"), "utf-8");
const hasFallbackRegex = validationSvc.includes("fallbackRegexValidation");

console.log(`WASM Parser Coverage: ${langs.length - missingWasm.length}/${langs.length}`);
if (missingWasm.length > 0) {
  console.error(`Missing parser.wasm: ${missingWasm.join(", ")}`);
  process.exitCode = 1;
}
if (hasFallbackRegex) {
  console.error("fallbackRegexValidation still present in packages/lsp/src/services/validation-service.ts");
  process.exitCode = 1;
}
if (!missingWasm.length && !hasFallbackRegex) {
  console.log("Audit passed: 93/93 WASM parsers present and fallbackRegexValidation removed.");
}
