import { buildParser } from "@modelscript/language";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sysml2Language } from "./src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const languagePath = path.join(__dirname, "src", "language.ts");
const result = buildParser(sysml2Language, { sourcePath: languagePath });

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

const ascPath =
  [
    path.resolve(__dirname, "node_modules/.bin/asc"),
    path.resolve(__dirname, "../../node_modules/.bin/asc"),
    "npx asc",
  ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";

console.log("[sysml2] Compiling WebAssembly parser with asc...");
execSync(`${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`, {
  stdio: "inherit",
  cwd: __dirname,
});
console.log("[sysml2] WebAssembly parser built successfully -> " + outWasm);

// Cleanup as-gen after WASM compilation
fs.rmSync(asGenDir, { recursive: true, force: true });
