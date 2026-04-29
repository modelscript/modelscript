import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const grammarPath = path.join(__dirname, "grammar.js");
const wasmPath = path.join(__dirname, "tree-sitter-step.wasm");

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
  console.log("[step] Building tree-sitter-step.wasm...");

  const pkgPath = path.join(__dirname, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const originalType = pkg.type;

  try {
    // tree-sitter-cli requires CJS-style package.json
    delete pkg.type;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    execSync("npx --yes tree-sitter-cli build --wasm", { stdio: "inherit", cwd: __dirname });
  } catch (err) {
    console.error("[step] Failed to build WASM:", err.message);
    process.exitCode = 1;
  } finally {
    if (originalType) {
      pkg.type = originalType;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    }
  }
} else {
  console.log("[step] tree-sitter-step.wasm is up to date.");
}
