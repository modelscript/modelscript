// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Downloads and caches prebuilt Dawn WebGPU binaries from
 * `eliemichel/WebGPU-distribution` into `.cache/dawn-<platform>-<arch>/`
 * and writes `packages/native/generated/dawn_paths.cmake` with
 * `DAWN_INCLUDE_DIR` and `DAWN_LIBRARY` for CMake (`-DMS_ENABLE_DAWN=ON`).
 *
 * Usage:
 *   npx tsx scripts/build/fetch-dawn.ts [--dry-run] [--force] [--version=dawn-v7139]
 *                                       [--platform=<platform>] [--arch=<arch>]
 *
 * Environment overrides:
 *   DAWN_DIR       Use an existing local Dawn installation (skips download)
 *   DAWN_VERSION   Override pinned release tag (default: dawn-v7139)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GENERATED_DIR = path.join(REPO_ROOT, "packages", "native", "generated");
const CMAKE_OUT_PATH = path.join(GENERATED_DIR, "dawn_paths.cmake");

const DEFAULT_DAWN_VERSION = "dawn-v7139";

interface DawnTargetSpec {
  readonly platformKey: string;
  readonly distributionSubdir: string;
  readonly libCandidates: readonly string[];
}

const DAWN_TARGETS: Record<string, DawnTargetSpec> = {
  "linux-x64": {
    platformKey: "linux-x64",
    distributionSubdir: "linux-x86_64",
    libCandidates: ["libwebgpu_dawn.so", "libwebgpu_dawn.a", "libdawn_native.so"],
  },
  "linux-arm64": {
    platformKey: "linux-arm64",
    distributionSubdir: "linux-aarch64",
    libCandidates: ["libwebgpu_dawn.so", "libwebgpu_dawn.a", "libdawn_native.so"],
  },
  "darwin-arm64": {
    platformKey: "darwin-arm64",
    distributionSubdir: "macos-aarch64",
    libCandidates: ["libwebgpu_dawn.dylib", "libwebgpu_dawn.a"],
  },
  "darwin-x64": {
    platformKey: "darwin-x64",
    distributionSubdir: "macos-x86_64",
    libCandidates: ["libwebgpu_dawn.dylib", "libwebgpu_dawn.a"],
  },
  "win32-x64": {
    platformKey: "win32-x64",
    distributionSubdir: "windows-x86_64",
    libCandidates: ["webgpu_dawn.lib", "webgpu_dawn.dll.lib", "dawn_native.lib"],
  },
};

function parseArg(prefix: string): string | undefined {
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const TARGET_PLATFORM = parseArg("--platform=") ?? process.platform;
const TARGET_ARCH = parseArg("--arch=") ?? process.arch;
const DAWN_VERSION = parseArg("--version=") ?? process.env["DAWN_VERSION"] ?? DEFAULT_DAWN_VERSION;

function toCmakePath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

function getDownloadUrls(version: string, spec: DawnTargetSpec): string[] {
  const base = "https://github.com/eliemichel/WebGPU-distribution";
  return [
    `${base}/releases/download/${version}/WebGPU-distribution-${version}-${spec.distributionSubdir}.zip`,
    `${base}/archive/refs/tags/${version}.zip`,
  ];
}

function walkFiles(dir: string, maxDepth = 6): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const visit = (current: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        results.push(full);
      }
    }
  };

  visit(dir, 0);
  return results;
}

interface ResolvedDawnPaths {
  includeDir: string;
  libraryPath: string;
}

function locateDawnInDir(rootDir: string, spec: DawnTargetSpec): ResolvedDawnPaths | null {
  const files = walkFiles(rootDir);

  // Locate include directory containing webgpu/webgpu.h (or dawn/webgpu.h)
  let includeDir: string | null = null;
  for (const f of files) {
    const normalized = f.replace(/\\/g, "/");
    if (normalized.endsWith("/include/webgpu/webgpu.h")) {
      includeDir = path.dirname(path.dirname(f));
      break;
    }
    if (!includeDir && normalized.endsWith("/webgpu/webgpu.h")) {
      includeDir = path.dirname(path.dirname(f));
    }
  }

  // Locate Dawn library, preferring paths matching the target distributionSubdir
  let libraryPath: string | null = null;
  for (const candidate of spec.libCandidates) {
    const matches = files.filter((f) => path.basename(f) === candidate);
    if (matches.length === 0) continue;
    const preferred = matches.find((f) => f.replace(/\\/g, "/").includes(spec.distributionSubdir));
    libraryPath = preferred ?? matches[0] ?? null;
    if (libraryPath) break;
  }

  if (!includeDir || !libraryPath) {
    return null;
  }
  return { includeDir, libraryPath };
}

function formatCmakeFile(includeDir: string, libraryPath: string): string {
  return [
    "# Auto-generated by scripts/build/fetch-dawn.ts — do not edit manually.",
    `set(DAWN_INCLUDE_DIR "${toCmakePath(includeDir)}")`,
    `set(DAWN_LIBRARY "${toCmakePath(libraryPath)}")`,
    "",
  ].join("\n");
}

function writeCmakePaths(resolved: ResolvedDawnPaths, dryRun: boolean): void {
  const content = formatCmakeFile(resolved.includeDir, resolved.libraryPath);
  if (dryRun) {
    console.log(`[fetch-dawn] [dry-run] Would write ${path.relative(REPO_ROOT, CMAKE_OUT_PATH)}:`);
    console.log(content.trimEnd());
    return;
  }
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(CMAKE_OUT_PATH, content, "utf8");
  console.log(`[fetch-dawn] Wrote ${path.relative(REPO_ROOT, CMAKE_OUT_PATH)}`);
  console.log(`[fetch-dawn]   DAWN_INCLUDE_DIR=${toCmakePath(resolved.includeDir)}`);
  console.log(`[fetch-dawn]   DAWN_LIBRARY=${toCmakePath(resolved.libraryPath)}`);
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

function extractZip(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }

  try {
    execFileSync("unzip", ["-qo", archivePath, "-d", destDir], { stdio: "inherit" });
  } catch {
    // Fallback to bsdtar/tar if unzip is unavailable
    execFileSync("tar", ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
  }
}

function printOfflineInstructions(platformKey: string, cacheDir: string, version: string, reason: string): void {
  console.warn(`[fetch-dawn] Could not download prebuilt Dawn (${version}) for ${platformKey}: ${reason}`);
  console.warn("");
  console.warn("To enable Dawn native WebGPU manually or offline:");
  console.warn(
    `  1. Download a Dawn release archive from https://github.com/eliemichel/WebGPU-distribution/releases (tag: ${version})`,
  );
  console.warn(`  2. Extract it into: ${path.relative(REPO_ROOT, cacheDir)}/`);
  console.warn("     OR set DAWN_DIR=/path/to/dawn (containing include/webgpu/webgpu.h and libwebgpu_dawn.*)");
  console.warn("     OR pass DAWN_INCLUDE_DIR and DAWN_LIBRARY directly to CMake.");
  console.warn("  3. Re-run: npx tsx scripts/build/fetch-dawn.ts");
  console.warn("");
  console.warn("To build CPU-only without Dawn, run: pnpm --filter @modelscript/native run build:native");
}

async function main(): Promise<void> {
  const platformKey = `${TARGET_PLATFORM}-${TARGET_ARCH}`;
  const spec = DAWN_TARGETS[platformKey];
  if (!spec) {
    const supported = Object.keys(DAWN_TARGETS).join(", ");
    console.warn(`[fetch-dawn] Unsupported platform/arch "${platformKey}". Supported targets: ${supported}.`);
    console.warn("[fetch-dawn] Set DAWN_DIR=/path/to/local/dawn to use a custom build.");
    return;
  }

  const cacheDir = path.join(REPO_ROOT, ".cache", `dawn-${platformKey}`);

  // 1. Honor pre-existing DAWN_DIR environment variable
  const envDawnDir = process.env["DAWN_DIR"];
  if (envDawnDir) {
    const resolvedEnvDir = path.resolve(envDawnDir);
    console.log(`[fetch-dawn] Using DAWN_DIR=${resolvedEnvDir}`);
    const resolved = locateDawnInDir(resolvedEnvDir, spec);
    if (resolved) {
      writeCmakePaths(resolved, DRY_RUN);
      return;
    }
    console.warn(
      `[fetch-dawn] DAWN_DIR="${resolvedEnvDir}" does not contain both webgpu/webgpu.h and one of [${spec.libCandidates.join(", ")}].`,
    );
    console.warn("[fetch-dawn] Verify DAWN_DIR or set DAWN_INCLUDE_DIR and DAWN_LIBRARY explicitly.");
    return;
  }

  // 2. Dry-run mode: print plan without touching network or filesystem
  const urls = getDownloadUrls(DAWN_VERSION, spec);
  if (DRY_RUN) {
    const cached = locateDawnInDir(cacheDir, spec);
    console.log(`[fetch-dawn] [dry-run] Target:    ${platformKey} (${spec.distributionSubdir})`);
    console.log(`[fetch-dawn] [dry-run] Version:   ${DAWN_VERSION}`);
    console.log(`[fetch-dawn] [dry-run] Cache dir: ${path.relative(REPO_ROOT, cacheDir)}`);
    console.log(`[fetch-dawn] [dry-run] Cached:    ${cached ? "yes" : "no"}`);
    if (cached && !FORCE) {
      writeCmakePaths(cached, true);
    } else {
      console.log("[fetch-dawn] [dry-run] Download URLs (in priority order):");
      for (const u of urls) {
        console.log(`[fetch-dawn] [dry-run]   - ${u}`);
      }
      const previewInclude = path.join(cacheDir, "include");
      const previewLib = path.join(cacheDir, "bin", spec.distributionSubdir, spec.libCandidates[0] ?? "libwebgpu_dawn.so");
      writeCmakePaths({ includeDir: previewInclude, libraryPath: previewLib }, true);
    }
    return;
  }

  // 3. Reuse cached binaries if already present
  if (!FORCE) {
    const cached = locateDawnInDir(cacheDir, spec);
    if (cached) {
      console.log(`[fetch-dawn] Using cached Dawn binaries in ${path.relative(REPO_ROOT, cacheDir)}`);
      writeCmakePaths(cached, false);
      return;
    }
  }

  // 4. Download & extract prebuilt Dawn archive
  const archivePath = path.join(cacheDir, `dawn-${DAWN_VERSION}-${spec.distributionSubdir}.zip`);
  let downloaded = false;
  let lastError = "unknown error";

  for (const url of urls) {
    try {
      console.log(`[fetch-dawn] Downloading ${url}...`);
      await downloadFile(url, archivePath);
      downloaded = true;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!downloaded) {
    printOfflineInstructions(platformKey, cacheDir, DAWN_VERSION, lastError);
    return;
  }

  try {
    console.log(`[fetch-dawn] Extracting archive into ${path.relative(REPO_ROOT, cacheDir)}...`);
    extractZip(archivePath, cacheDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printOfflineInstructions(platformKey, cacheDir, DAWN_VERSION, `extraction failed: ${msg}`);
    return;
  }

  const resolved = locateDawnInDir(cacheDir, spec);
  if (!resolved) {
    printOfflineInstructions(
      platformKey,
      cacheDir,
      DAWN_VERSION,
      `archive did not contain webgpu/webgpu.h and one of [${spec.libCandidates.join(", ")}]`,
    );
    return;
  }

  writeCmakePaths(resolved, false);
}

main().catch((err) => {
  console.warn(`[fetch-dawn] Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
});
