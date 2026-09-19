import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const forceRebuild = process.argv.includes("--force");
const outWasm = path.join(__dirname, "dist", "parser.wasm");
const bindingsJs = path.join(__dirname, "src-gen", "bindings.js");
const languagePath = path.join(__dirname, "language.ts");
const dslDistPath = path.resolve(__dirname, "../../packages/dsl/dist/index.js");

const cacheDir = path.join(__dirname, ".cache");
const cacheWasm = path.join(cacheDir, "parser.wasm");

function isParserUpToDate() {
  if (forceRebuild) return false;
  // If outWasm is missing (e.g. wiped by Nx task runner), restore from .cache if valid
  if (!fs.existsSync(outWasm) && fs.existsSync(cacheWasm) && fs.existsSync(bindingsJs)) {
    const cacheStat = fs.statSync(cacheWasm);
    if (cacheStat.size > 0) {
      const cacheTime = cacheStat.mtimeMs;
      const langTime = fs.existsSync(languagePath) ? fs.statSync(languagePath).mtimeMs : 0;
      const dslTime = fs.existsSync(dslDistPath) ? fs.statSync(dslDistPath).mtimeMs : 0;
      if (cacheTime > langTime && cacheTime > dslTime) {
        fs.mkdirSync(path.dirname(outWasm), { recursive: true });
        fs.copyFileSync(cacheWasm, outWasm);
        return true;
      }
    }
  }

  if (!fs.existsSync(outWasm) || !fs.existsSync(bindingsJs)) return false;
  const wasmStat = fs.statSync(outWasm);
  if (wasmStat.size === 0) return false;
  const wasmTime = wasmStat.mtimeMs;

  if (fs.existsSync(languagePath) && fs.statSync(languagePath).mtimeMs > wasmTime) return false;
  if (fs.existsSync(dslDistPath) && fs.statSync(dslDistPath).mtimeMs > wasmTime) return false;

  // Keep .cache in sync with valid outWasm
  if (!fs.existsSync(cacheWasm) || fs.statSync(cacheWasm).mtimeMs < wasmTime) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.copyFileSync(outWasm, cacheWasm);
  }
  return true;
}

if (isParserUpToDate()) {
  console.log("[csv] WebAssembly parser is up to date, skipping GLR & asc build. (use --force to rebuild)");
} else {
  // Step 1: Run builder via tsx to compile parser and WASM
  const buildScriptPath = path.join(__dirname, "build-parser.ts");
  const buildScriptContent = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { buildParser } from "@modelscript/dsl";
import { csvLanguage } from "./language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const languagePath = path.join(__dirname, "language.ts");
const result = buildParser(csvLanguage, { sourcePath: languagePath });

// 1. Write AssemblyScript files to as-gen/ for asc
const asGenDir = path.join(__dirname, "as-gen");
fs.mkdirSync(asGenDir, { recursive: true });
for (const file of result.assemblyScriptFiles) {
  fs.writeFileSync(path.join(asGenDir, file.filename), file.content);
}

// 2. Write TypeScript/JavaScript bindings to src-gen/
const srcGenDir = path.join(__dirname, "src-gen");
fs.mkdirSync(srcGenDir, { recursive: true });
fs.writeFileSync(path.join(srcGenDir, "bindings.js"), result.javascriptWrapper.js);
fs.writeFileSync(path.join(srcGenDir, "bindings.d.ts"), result.javascriptWrapper.dts);

// 3. Compile AssemblyScript to WASM
const outDir = path.join(__dirname, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outWasm = path.join(outDir, "parser.wasm");
const parserTs = path.join(asGenDir, "parser.ts");

const ascPath = [
  path.resolve(__dirname, "node_modules/.bin/asc"),
  path.resolve(__dirname, "../../node_modules/.bin/asc"),
  "npx asc",
].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";

console.log("[csv] Compiling WebAssembly parser with asc...");
execSync(\`\${ascPath} \${parserTs} -o \${outWasm} --exportRuntime --enable threads --optimize --runtime stub\`, {
  stdio: "inherit",
  cwd: __dirname,
});
console.log("[csv] WebAssembly parser built successfully -> " + outWasm);

// Cleanup as-gen after WASM compilation
fs.rmSync(asGenDir, { recursive: true, force: true });
`;

  fs.writeFileSync(buildScriptPath, buildScriptContent, "utf-8");
  try {
    execSync(`npx tsx ${buildScriptPath}`, { stdio: "inherit", cwd: __dirname });
    if (fs.existsSync(outWasm)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.copyFileSync(outWasm, cacheWasm);
    }
  } finally {
    if (fs.existsSync(buildScriptPath)) fs.unlinkSync(buildScriptPath);
  }
}
