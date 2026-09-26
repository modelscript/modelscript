import asc from "assemblyscript/asc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootShimFiles } from "../src/src-gen/runtime-templates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeDir = path.resolve(__dirname, "../src/codegen/runtime");
const runtimeWasmDir = path.resolve(__dirname, "../../runtime/src/wasm");
const rootShimMap = new Map(rootShimFiles.map((s) => [s.filename, s.content]));

function collectTsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

// Exclude arena.ts shim and parser loop files that require dynamically generated grammar tables (MAX_TERMINAL_ID, lex, etc.)
const files = collectTsFiles(runtimeDir).filter((f) => !f.endsWith("arena.ts") && !f.includes("/parser/"));

console.log(`Verifying ${files.length} AssemblyScript runtime source files...`);

let hasError = false;

for (const file of files) {
  const rel = path.relative(runtimeDir, file);
  let stderrOutput = "";
  const stderrStream = {
    write(chunk) {
      stderrOutput += chunk;
    },
  };

  const flags = [file, "--enable", "threads", "--noEmit", "--disableWarning", "235"];
  const { error } = await asc.main(flags, {
    stderr: stderrStream,
    readFile(filename) {
      if (fs.existsSync(filename)) {
        return fs.readFileSync(filename, "utf-8");
      }
      const relToRuntime = path.relative(runtimeDir, filename);
      if (!relToRuntime.startsWith("..")) {
        const wasmPath = path.join(runtimeWasmDir, relToRuntime);
        if (fs.existsSync(wasmPath)) {
          return fs.readFileSync(wasmPath, "utf-8");
        }
        if (fs.existsSync(`${wasmPath}.ts`)) {
          return fs.readFileSync(`${wasmPath}.ts`, "utf-8");
        }
      }
      const baseName = path.basename(filename);
      const baseNameWithExt = baseName.endsWith(".ts") ? baseName : `${baseName}.ts`;
      if (rootShimMap.has(baseNameWithExt)) {
        return rootShimMap.get(baseNameWithExt);
      }
      if (baseName === "graph.ts" || baseName === "graph") {
        return `export function initQueryArena(): void {}\nexport function resetQueryArena(): void {}\nexport function clearDiagnostics(): void {}\n`;
      }
      if (baseName === "parser.ts" || baseName === "parser") {
        return `export const inputEncoding: u32 = 0;\n`;
      }
      const rootWasmPath = path.join(runtimeWasmDir, baseName.endsWith(".ts") ? baseName : `${baseName}.ts`);
      if (fs.existsSync(rootWasmPath)) {
        return fs.readFileSync(rootWasmPath, "utf-8");
      }
      return null;
    },
  });

  if (error) {
    console.error(`❌ ${rel} failed AssemblyScript type check:\n${stderrOutput}`);
    hasError = true;
  } else {
    console.log(`✅ ${rel}`);
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log("All AssemblyScript runtime files passed type checking!");
}
