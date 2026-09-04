// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Builds and caches the unified SymbolIndex and Model List for MSL 4.0/4.1.
 *
 * Usage:
 *   npx tsx tests/build-msl-index.ts [--version=4.0.0|4.1.0] [--force]
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
let version = "4.0.0";
let force = false;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--version=")) {
    version = arg.split("=")[1].trim();
  } else if (arg === "--force" || arg === "-f") {
    force = true;
  }
}

const repoRoot = path.resolve(__dirname, "../../..");
const cacheDir = path.join(repoRoot, ".cache");
fs.mkdirSync(cacheDir, { recursive: true });

const indexCachePath = path.join(cacheDir, `msl-${version}-symbol-index.json`);
const modelsCachePath = path.join(cacheDir, `msl-${version}-models.json`);

export interface DiscoveredModel {
  fqn: string;
  name: string;
  file: string;
  isExample: boolean;
  package: string;
}

export function discoverModelsFromIndex(rawSymbols: [number, any][], mslDir: string): DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  for (const [, sym] of rawSymbols) {
    if (
      sym.kind === "Class" &&
      sym.ruleName === "class_definition" &&
      sym.resourceId &&
      sym.resourceId.startsWith(mslDir)
    ) {
      const rel = path.relative(mslDir, sym.resourceId);
      const dirParts = rel.replace(/\.mo$/, "").split(path.sep);
      let fqn: string;
      if (dirParts[dirParts.length - 1] === sym.name) {
        fqn = ["Modelica", ...dirParts].join(".");
      } else if (dirParts[dirParts.length - 1] === "package") {
        fqn = ["Modelica", ...dirParts.slice(0, -1), sym.name].join(".");
      } else {
        fqn = ["Modelica", ...dirParts, sym.name].join(".");
      }
      const isExample = fqn.includes(".Examples.");
      const pkg = fqn.split(".").slice(0, 3).join(".");
      models.push({
        fqn,
        name: sym.name,
        file: sym.resourceId,
        isExample,
        package: pkg,
      });
    }
  }
  models.sort((a, b) => a.fqn.localeCompare(b.fqn));
  return models;
}

if (!force && fs.existsSync(indexCachePath) && fs.existsSync(modelsCachePath)) {
  console.log(`[build-msl-index] Symbol index and model cache already exist at:`);
  console.log(`  ${indexCachePath}`);
  console.log(`  ${modelsCachePath}`);
  console.log(`(Use --force to rebuild)`);
  process.exit(0);
}

if (!force && fs.existsSync(indexCachePath)) {
  console.log(`[build-msl-index] Loading cached SymbolIndex from ${indexCachePath}...`);
  const raw = JSON.parse(fs.readFileSync(indexCachePath, "utf-8"));
  const discovered = discoverModelsFromIndex(raw.symbols, raw.mslDir);
  const examplesCount = discovered.filter((m) => m.isExample).length;
  console.log(`[build-msl-index] Found ${discovered.length} models (${examplesCount} in Examples packages)`);
  fs.writeFileSync(modelsCachePath, JSON.stringify(discovered, null, 2), "utf-8");
  console.log(`[build-msl-index] Saved model list to ${modelsCachePath}`);
  console.log(`[build-msl-index] Done!`);
  process.exit(0);
}

// Locate MSL directory
const candidatePaths = [
  path.join(repoRoot, "scripts", "msl", `Modelica ${version}`),
  path.join(process.env.HOME || "", `.openmodelica/libraries/Modelica ${version}+maint.om`),
  path.join(process.env.HOME || "", `.openmodelica/libraries/Modelica ${version}`),
];

const mslDir = candidatePaths.find((p) => fs.existsSync(p) && fs.existsSync(path.join(p, "package.mo")));

if (!mslDir) {
  console.error(`[build-msl-index] MSL ${version} directory not found! Checked:`);
  for (const c of candidatePaths) console.error("  " + c);
  console.error(`Please run: node scripts/download-msl.cjs --version=${version} --extract`);
  process.exit(1);
}

console.log(`[build-msl-index] Using MSL ${version} at: ${mslDir}`);

// Initialize parser
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

const context = new Context(new NodeFileSystem());

const t0 = Date.now();
let fileCount = 0;
const origRegister = context.workspaceIndex.register.bind(context.workspaceIndex);
context.workspaceIndex.register = function (uri: string, loader?: () => any, parentFQN?: string) {
  fileCount++;
  if (fileCount % 100 === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const rss = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
    process.stdout.write(`  Indexed ${fileCount}/2508 files (${elapsed}s, RSS: ${rss}MB)...\n`);
  }
  if ((globalThis as any).gc && (fileCount % 100 === 0 || process.memoryUsage().rss > 1024 * 1024 * 1024)) {
    (globalThis as any).gc();
  }
  if ((facade as any)?.exports?.checkpointMemory) {
    (facade as any).exports.checkpointMemory();
  }
  let res = 0;
  try {
    res = origRegister(
      uri,
      () => {
        if (typeof loader === "function") {
          const node = loader();
          if (node && node.type !== "ERROR") {
            return node;
          }
        }
        return null;
      },
      parentFQN,
    );
  } catch {
    // skip failed file
  }
  if ((facade as any)?.exports?.rollbackMemory) {
    (facade as any).exports.rollbackMemory();
  }
  return res;
};

console.log(`[build-msl-index] Indexing MSL package tree...`);
await context.addLibrary(mslDir);
console.log(`\n[build-msl-index] Indexed ${fileCount} files in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

const symbolIndex = context.queryEngine.index;
console.log(`[build-msl-index] Total symbols: ${symbolIndex.symbols.size}`);

// 1. Serialize SymbolIndex
console.log(`[build-msl-index] Serializing SymbolIndex to ${indexCachePath}...`);
const serialized = {
  version,
  mslDir,
  symbols: Array.from(symbolIndex.symbols.entries()),
  byName: Array.from(symbolIndex.byName.entries()),
  childrenOf: Array.from(symbolIndex.childrenOf.entries()),
};
fs.writeFileSync(indexCachePath, JSON.stringify(serialized), "utf-8");
console.log(
  `[build-msl-index] Saved symbol index (${(fs.statSync(indexCachePath).size / (1024 * 1024)).toFixed(2)} MB)`,
);

// 2. Discover and classify all models
console.log(`[build-msl-index] Discovering models...`);
// 2. Discover and classify all models
console.log(`[build-msl-index] Discovering models...`);
const discoveredModels = discoverModelsFromIndex(serialized.symbols, mslDir);
const examplesCount = discoveredModels.filter((m) => m.isExample).length;
console.log(`[build-msl-index] Found ${discoveredModels.length} models (${examplesCount} in Examples packages)`);

fs.writeFileSync(modelsCachePath, JSON.stringify(discoveredModels, null, 2), "utf-8");
console.log(`[build-msl-index] Saved model list to ${modelsCachePath}`);
console.log(`[build-msl-index] Done!`);
