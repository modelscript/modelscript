// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

const grammarPath = path.join(pkgDir, "src", "parser", "aml-dsl-grammar.ts");
const outWasm = path.join(pkgDir, "dist", "aml-dsl-parser.wasm");
const srcGenDir = path.join(pkgDir, "src-gen", "aml-dsl");
const distSrcGenDir = path.join(pkgDir, "dist", "src-gen", "aml-dsl");
const cacheDir = path.join(pkgDir, ".cache");
const hashFile = path.join(cacheDir, "aml-dsl.hash");
const forceRebuild = process.argv.includes("--force");

function computeInputHash() {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(grammarPath));
  hash.update(fs.readFileSync(__filename));
  return hash.digest("hex");
}

function syncBindingsToDist() {
  const jsPath = path.join(srcGenDir, "bindings.js");
  const dtsPath = path.join(srcGenDir, "bindings.d.ts");
  if (!fs.existsSync(jsPath) || !fs.existsSync(dtsPath)) return;
  fs.mkdirSync(distSrcGenDir, { recursive: true });
  fs.copyFileSync(jsPath, path.join(distSrcGenDir, "bindings.js"));
  fs.copyFileSync(dtsPath, path.join(distSrcGenDir, "bindings.d.ts"));
}

const currentHash = computeInputHash();
if (
  !forceRebuild &&
  fs.existsSync(outWasm) &&
  fs.existsSync(path.join(srcGenDir, "bindings.js")) &&
  fs.existsSync(path.join(srcGenDir, "bindings.d.ts")) &&
  fs.existsSync(hashFile) &&
  fs.readFileSync(hashFile, "utf8").trim() === currentHash
) {
  console.log(
    "[automationml-dsl] WebAssembly parser is up to date, skipping GLR & asc build. (use --force to rebuild)",
  );
  syncBindingsToDist();
  process.exit(0);
}

fs.mkdirSync(cacheDir, { recursive: true });
const runnerPath = path.join(cacheDir, "build-aml-dsl-parser.ts");
const runnerContent = `// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildParser } from "@modelscript/dsl";
import { automationMLDslGrammar } from "../src/parser/aml-dsl-grammar.js";

const pkgDir = ${JSON.stringify(pkgDir)};
const grammarPath = ${JSON.stringify(grammarPath)};
const result = buildParser(automationMLDslGrammar, { sourcePath: grammarPath });

const asGenDir = path.join(pkgDir, ".cache", "as-gen-aml-dsl");
fs.mkdirSync(asGenDir, { recursive: true });
for (const file of result.assemblyScriptFiles) {
  const filePath = path.join(asGenDir, file.filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, file.content);
}

const srcGenDir = ${JSON.stringify(srcGenDir)};
fs.mkdirSync(srcGenDir, { recursive: true });
fs.writeFileSync(path.join(srcGenDir, "bindings.js"), result.javascriptWrapper.js);
fs.writeFileSync(path.join(srcGenDir, "bindings.d.ts"), result.javascriptWrapper.dts);

const distSrcGenDir = ${JSON.stringify(distSrcGenDir)};
fs.mkdirSync(distSrcGenDir, { recursive: true });
fs.writeFileSync(path.join(distSrcGenDir, "bindings.js"), result.javascriptWrapper.js);
fs.writeFileSync(path.join(distSrcGenDir, "bindings.d.ts"), result.javascriptWrapper.dts);

const outWasm = ${JSON.stringify(outWasm)};
fs.mkdirSync(path.dirname(outWasm), { recursive: true });
const parserTs = path.join(asGenDir, "parser.ts");
const isWin = process.platform === "win32";
const ascPath = path.resolve(pkgDir, "../../node_modules/.bin", isWin ? "asc.cmd" : "asc");
const ascExec = fs.existsSync(ascPath) ? ascPath : isWin ? "npx.cmd" : "npx";
const ascArgs = fs.existsSync(ascPath)
  ? [parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "--enable", "simd", "--optimize", "--runtime", "stub"]
  : ["asc", parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "--enable", "simd", "--optimize", "--runtime", "stub"];

execFileSync(ascExec, ascArgs, { stdio: "inherit", shell: isWin, cwd: pkgDir });
`;

fs.writeFileSync(runnerPath, runnerContent);
const isWin = process.platform === "win32";
const npxBin = isWin ? "npx.cmd" : "npx";
try {
  execFileSync(npxBin, ["tsx", runnerPath], { stdio: "inherit", cwd: pkgDir, shell: isWin });
  fs.writeFileSync(hashFile, currentHash);
} finally {
  if (fs.existsSync(runnerPath)) {
    fs.unlinkSync(runnerPath);
  }
}
