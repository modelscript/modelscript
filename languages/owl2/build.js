import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Step 0: Regenerate grammar.js (and other artifacts) from language.ts
const languagePath = path.join(__dirname, "language.ts");
const cliPath = path.resolve(__dirname, "..", "..", "packages", "compiler", "src", "cli.ts");
const grammarPath = path.join(__dirname, "grammar.js");

const srcGenPath = path.join(__dirname, "src-gen");

let shouldGenerate = true;
if (fs.existsSync(grammarPath) && fs.existsSync(srcGenPath)) {
  const langStats = fs.statSync(languagePath);
  const grammarStats = fs.statSync(grammarPath);
  if (langStats.mtimeMs <= grammarStats.mtimeMs) {
    shouldGenerate = false;
  }
}

if (shouldGenerate) {
  console.log("[owl2] Generating artifacts from language.ts...");
  try {
    execSync(`npx tsx ${cliPath} generate ${languagePath}`, { stdio: "inherit", cwd: __dirname });
  } catch (err) {
    console.error("[owl2] Failed to generate artifacts:", err.message);
    process.exitCode = 1;
  }
}

const wasmPath = path.join(__dirname, "tree-sitter-owl2.wasm");

let shouldBuild = false;

if (!fs.existsSync(wasmPath)) {
  shouldBuild = true;
} else {
  const grammarStats = fs.statSync(grammarPath);
  const wasmStats = fs.statSync(wasmPath);
  if (grammarStats.mtimeMs > wasmStats.mtimeMs) {
    shouldBuild = true;
  }
}

if (shouldBuild) {
  console.log("grammar.js is newer than tree-sitter-owl2.wasm. Rebuilding WASM...");

  const pkgPath = path.join(__dirname, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const originalType = pkg.type;

  try {
    delete pkg.type;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    execSync("npx --yes tree-sitter-cli generate", { stdio: "inherit", cwd: __dirname });
    let retries = 5;
    while (retries > 0) {
      try {
        execSync("npx --yes tree-sitter-cli build --wasm", { stdio: "inherit", cwd: __dirname });
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        console.warn(`[WASM Build] Failed (likely due to concurrent wasi-sdk extraction), retrying in 3s...`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
      }
    }
  } catch (err) {
    console.error("Failed to build WASM:", err.message);
    process.exitCode = 1;
  } finally {
    if (originalType) {
      pkg.type = originalType;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    }
  }
} else {
  console.log("tree-sitter-owl2.wasm is up to date.");
}
