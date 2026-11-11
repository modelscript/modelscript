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
let library = "Modelica";
let version = "4.0.0";
let force = false;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--library=") || arg.startsWith("--lib=")) {
    library = arg.split("=")[1].trim();
  } else if (arg.startsWith("--version=")) {
    version = arg.split("=")[1].trim();
  } else if (arg === "--force" || arg === "-f") {
    force = true;
  }
}

const libNorm = library.toLowerCase();
const isMsl = libNorm === "modelica" || libNorm === "msl";
const isOpenIpsl = libNorm === "openipsl";
const rootPkgName = isMsl ? "Modelica" : isOpenIpsl ? "OpenIPSL" : library;
const libSlug = isMsl ? "msl" : isOpenIpsl ? "openipsl" : library.toLowerCase();

if (isOpenIpsl && !process.argv.some((a) => a.startsWith("--version="))) {
  version = "3.1.0";
}

const repoRoot = path.resolve(__dirname, "../../..");
const cacheDir = path.join(repoRoot, ".cache");
fs.mkdirSync(cacheDir, { recursive: true });

const indexCachePath = path.join(cacheDir, `${libSlug}-${version}-symbol-index.json`);
const modelsCachePath = path.join(cacheDir, `${libSlug}-${version}-models.json`);

export interface DiscoveredModel {
  fqn: string;
  name: string;
  file: string;
  isExample: boolean;
  package: string;
}

export function discoverModelsFromIndex(
  rawSymbols: [number, any][],
  libDir: string,
  rootPkgName = "Modelica",
): DiscoveredModel[] {
  const symMap = new Map<number, any>(rawSymbols);

  function getFullFQN(id: number): string {
    const parts: string[] = [];
    let curr = symMap.get(id);
    while (curr) {
      if (curr.name) parts.unshift(curr.name);
      if (curr.parentId == null || curr.parentId === curr.id) break;
      curr = symMap.get(curr.parentId);
    }
    return parts.join(".");
  }

  const models: DiscoveredModel[] = [];
  const seenFqns = new Set<string>();

  for (const [id, sym] of rawSymbols) {
    if (
      sym.kind === "Class" &&
      sym.ruleName === "class_definition" &&
      sym.resourceId &&
      sym.resourceId.startsWith(libDir)
    ) {
      const parent = sym.parentId != null ? symMap.get(sym.parentId) : null;
      const parentPrefix = parent?.metadata?.classPrefixes || parent?.metadata?.classKind;
      const parentIsPackage = !parent || parentPrefix === "package" || parent.kind === "Package";

      // Only include classes whose parent is a package or root (filter out inner classes/replacements inside models)
      if (!parentIsPackage) continue;

      const fqn = getFullFQN(id);
      if (!fqn.startsWith(`${rootPkgName}.`) && fqn !== rootPkgName) continue;
      if (seenFqns.has(fqn)) continue;
      seenFqns.add(fqn);

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
  const discovered = discoverModelsFromIndex(raw.symbols, raw.mslDir || raw.libDir, rootPkgName);
  const examplesCount = discovered.filter((m) => m.isExample).length;
  console.log(`[build-msl-index] Found ${discovered.length} models (${examplesCount} in Examples packages)`);
  fs.writeFileSync(modelsCachePath, JSON.stringify(discovered, null, 2), "utf-8");
  console.log(`[build-msl-index] Saved model list to ${modelsCachePath}`);
  console.log(`[build-msl-index] Done!`);
  process.exit(0);
}

// Locate library directory
const candidatePaths = isMsl
  ? [
      path.join(repoRoot, "scripts", "msl", `Modelica ${version}`),
      path.join(repoRoot, "data", "libraries", "Modelica", version, "extracted", "Modelica"),
      path.join(process.env.HOME || "", `.openmodelica/libraries/Modelica ${version}+maint.om`),
      path.join(process.env.HOME || "", `.openmodelica/libraries/Modelica ${version}`),
    ]
  : [
      path.join(repoRoot, "data", "libraries", rootPkgName, version, "extracted", rootPkgName),
      path.join(repoRoot, "data", "libraries", rootPkgName, "extracted", rootPkgName),
      path.join(process.env.HOME || "", `.openmodelica/libraries/${rootPkgName} ${version}`),
      path.join(process.env.HOME || "", `.openmodelica/libraries/${rootPkgName}`),
      path.join(process.env.MODELICAPATH || "", rootPkgName),
    ];

const libDir = candidatePaths.find((p) => p && fs.existsSync(p) && fs.existsSync(path.join(p, "package.mo")));

if (!libDir) {
  console.error(`[build-msl-index] Library ${rootPkgName} ${version} directory not found! Checked:`);
  for (const c of candidatePaths) if (c) console.error("  " + c);
  if (isMsl) {
    console.error(`Please run: node scripts/download-msl.cjs --version=${version} --extract`);
  } else {
    console.error(`Please run: npx tsx scripts/sync-stdlibs.ts --lang=modelica`);
  }
  process.exit(1);
}

console.log(`[build-msl-index] Using ${rootPkgName} ${version} at: ${libDir}`);

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

if (!isMsl) {
  const mslCandidates = [
    path.join(repoRoot, "data", "libraries", "Modelica", "4.0.0", "extracted", "Modelica"),
    path.join(repoRoot, "data", "libraries", "Modelica", "4.1.0", "extracted", "Modelica"),
    path.join(process.env.HOME || "", ".openmodelica", "libraries", "Modelica 4.0.0+maint.om"),
    path.join(process.env.HOME || "", ".openmodelica", "libraries", "Modelica 4.1.0+maint.om"),
    path.join(repoRoot, "scripts", "msl", "Modelica 4.0.0"),
  ];
  const mslPath = mslCandidates.find((p) => p && fs.existsSync(p) && fs.existsSync(path.join(p, "package.mo")));
  if (mslPath) {
    console.log(`[build-msl-index] Pre-loading MSL dependency from: ${mslPath}`);
    await context.addLibrary(mslPath, { skipIndex: true });
  }
}

console.log(`[build-msl-index] Indexing ${rootPkgName} package tree...`);
await context.addLibrary(libDir);
console.log(`\n[build-msl-index] Indexed ${fileCount} files in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

const symbolIndex = context.queryEngine.index;
console.log(`[build-msl-index] Total symbols: ${symbolIndex.symbols.size}`);

// 1. Serialize SymbolIndex
console.log(`[build-msl-index] Serializing SymbolIndex to ${indexCachePath}...`);
const serialized = {
  version,
  library: rootPkgName,
  libDir,
  mslDir: libDir, // for backward compatibility with existing tasks
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
const discoveredModels = discoverModelsFromIndex(serialized.symbols, libDir, rootPkgName);
const examplesCount = discoveredModels.filter((m) => m.isExample).length;
console.log(`[build-msl-index] Found ${discoveredModels.length} models (${examplesCount} in Examples packages)`);

fs.writeFileSync(modelsCachePath, JSON.stringify(discoveredModels, null, 2), "utf-8");
console.log(`[build-msl-index] Saved model list to ${modelsCachePath}`);
console.log(`[build-msl-index] Done!`);
