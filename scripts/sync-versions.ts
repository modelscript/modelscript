// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function getTargetWorkspaceJsonPaths(): string[] {
  const rootPkgPath = path.join(REPO_ROOT, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
  const workspaces: string[] = rootPkg.workspaces || [];
  const packagePaths: string[] = [];

  for (const pattern of workspaces) {
    if (pattern.startsWith("packages/examples") || pattern === "apps/ide/github-fs") {
      continue;
    }
    if (pattern.endsWith("/*")) {
      const parentDir = path.join(REPO_ROOT, pattern.slice(0, -2));
      if (!fs.existsSync(parentDir)) continue;
      const entries = fs.readdirSync(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const candidate = path.join(parentDir, entry.name, "package.json");
          if (fs.existsSync(candidate)) {
            packagePaths.push(candidate);
          }
        }
      }
    } else {
      const candidate = path.join(REPO_ROOT, pattern, "package.json");
      if (fs.existsSync(candidate)) {
        packagePaths.push(candidate);
      }
    }
  }

  return packagePaths.sort();
}

export function syncVersions(options?: { checkOnly?: boolean; explicitVersion?: string }): {
  version: string;
  mismatches: string[];
  updated: string[];
} {
  const checkOnly = options?.checkOnly ?? process.argv.includes("--check");
  const versionArg = process.argv.find((a) => a.startsWith("--version="));
  const runtimePkgPath = path.join(REPO_ROOT, "packages", "runtime", "package.json");
  const runtimePkg = JSON.parse(fs.readFileSync(runtimePkgPath, "utf-8"));
  const canonicalVersion: string =
    options?.explicitVersion || (versionArg ? versionArg.slice("--version=".length) : runtimePkg.version);

  const mismatches: string[] = [];
  const updated: string[] = [];

  // 1. Root package.json + all workspace package.json files
  const allPkgPaths = [path.join(REPO_ROOT, "package.json"), ...getTargetWorkspaceJsonPaths()];
  const updatedRelDirs = new Map<string, string>();

  for (const pkgPath of allPkgPaths) {
    const relPath = path.relative(REPO_ROOT, pkgPath).replace(/\\/g, "/");
    const relDir = path.dirname(relPath) === "." ? "" : path.dirname(relPath);
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);

    updatedRelDirs.set(relDir, canonicalVersion);

    if (pkg.version !== canonicalVersion) {
      mismatches.push(`${relPath} (found ${pkg.version}, expected ${canonicalVersion})`);
      if (!checkOnly) {
        pkg.version = canonicalVersion;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
        updated.push(relPath);
      }
    }
  }

  // 2. Tauri configuration (apps/desktop/src-tauri/tauri.conf.json)
  const tauriConfPath = path.join(REPO_ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json");
  if (fs.existsSync(tauriConfPath)) {
    const relPath = path.relative(REPO_ROOT, tauriConfPath).replace(/\\/g, "/");
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
    if (tauriConf.version !== canonicalVersion) {
      mismatches.push(`${relPath} (found ${tauriConf.version}, expected ${canonicalVersion})`);
      if (!checkOnly) {
        tauriConf.version = canonicalVersion;
        fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n", "utf-8");
        updated.push(relPath);
      }
    }
  }

  // 3. Tauri Rust Cargo.toml (apps/desktop/src-tauri/Cargo.toml)
  const cargoTomlPath = path.join(REPO_ROOT, "apps", "desktop", "src-tauri", "Cargo.toml");
  if (fs.existsSync(cargoTomlPath)) {
    const relPath = path.relative(REPO_ROOT, cargoTomlPath).replace(/\\/g, "/");
    const cargoContent = fs.readFileSync(cargoTomlPath, "utf-8");
    const versionMatch = cargoContent.match(/^version\s*=\s*"([^"]+)"/m);
    const currentCargoVersion = versionMatch ? versionMatch[1] : undefined;
    if (currentCargoVersion && currentCargoVersion !== canonicalVersion) {
      mismatches.push(`${relPath} (found ${currentCargoVersion}, expected ${canonicalVersion})`);
      if (!checkOnly) {
        const nextCargo = cargoContent.replace(/^version\s*=\s*"[^"]+"/m, `version = "${canonicalVersion}"`);
        fs.writeFileSync(cargoTomlPath, nextCargo, "utf-8");
        updated.push(relPath);
      }
    }
  }

  // 4. Built VS Code extension manifests (if present on disk)
  const extManifestCandidates = [
    path.join(REPO_ROOT, "dist", "extension", "package.json"),
    path.join(REPO_ROOT, "apps", "ide", "dist", "extension", "package.json"),
  ];
  for (const extPkgPath of extManifestCandidates) {
    if (fs.existsSync(extPkgPath)) {
      const relPath = path.relative(REPO_ROOT, extPkgPath).replace(/\\/g, "/");
      const extPkg = JSON.parse(fs.readFileSync(extPkgPath, "utf-8"));
      if (extPkg.version !== canonicalVersion && !checkOnly) {
        extPkg.version = canonicalVersion;
        fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n", "utf-8");
        updated.push(relPath);
      }
    }
  }

  // 5. Synchronize package-lock.json workspace entries
  const lockfilePath = path.join(REPO_ROOT, "package-lock.json");
  if (fs.existsSync(lockfilePath)) {
    const lock = JSON.parse(fs.readFileSync(lockfilePath, "utf-8"));
    let lockChanged = false;
    if (lock.version !== canonicalVersion) {
      mismatches.push(`package-lock.json#version (found ${lock.version}, expected ${canonicalVersion})`);
      if (!checkOnly) {
        lock.version = canonicalVersion;
        lockChanged = true;
      }
    }
    if (lock.packages && typeof lock.packages === "object") {
      for (const [relDir, ver] of updatedRelDirs.entries()) {
        const entry = lock.packages[relDir];
        if (entry && typeof entry === "object" && entry.version !== ver) {
          mismatches.push(`package-lock.json#packages["${relDir}"] (found ${entry.version}, expected ${ver})`);
          if (!checkOnly) {
            entry.version = ver;
            lockChanged = true;
          }
        }
      }
    }
    if (lockChanged && !checkOnly) {
      fs.writeFileSync(lockfilePath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
      updated.push("package-lock.json");
    }
  }

  // 6. Synchronize apps/docs/docs/.vitepress/theme/data/languages.generated.json
  const docsLangsPath = path.join(
    REPO_ROOT,
    "apps",
    "docs",
    "docs",
    ".vitepress",
    "theme",
    "data",
    "languages.generated.json",
  );
  if (fs.existsSync(docsLangsPath)) {
    const relPath = path.relative(REPO_ROOT, docsLangsPath).replace(/\\/g, "/");
    const docsLangs = JSON.parse(fs.readFileSync(docsLangsPath, "utf-8"));
    if (Array.isArray(docsLangs)) {
      let docsChanged = false;
      for (const entry of docsLangs) {
        if (entry && typeof entry === "object" && entry.version !== canonicalVersion) {
          mismatches.push(
            `${relPath}#${entry.slug || entry.pkgName} (found ${entry.version}, expected ${canonicalVersion})`,
          );
          if (!checkOnly) {
            entry.version = canonicalVersion;
            docsChanged = true;
          }
        }
      }
      if (docsChanged && !checkOnly) {
        fs.writeFileSync(docsLangsPath, JSON.stringify(docsLangs, null, 2) + "\n", "utf-8");
        updated.push(relPath);
      }
    }
  }

  return { version: canonicalVersion, mismatches, updated };
}

function run(): void {
  const checkOnly = process.argv.includes("--check");
  const { version, mismatches, updated } = syncVersions({ checkOnly });

  if (checkOnly) {
    if (mismatches.length > 0) {
      console.error(`\nFound ${mismatches.length} version synchronization mismatch(es) (expected ${version}):\n`);
      for (const m of mismatches) {
        console.error(`  - ${m}`);
      }
      console.error("\nRun 'npx tsx scripts/sync-versions.ts' to synchronize workspace versions.\n");
      process.exit(1);
    }
    console.log(`✓ All workspace packages, lockfile entries, and Tauri manifests match version ${version}.`);
    return;
  }

  if (updated.length > 0) {
    console.log(`✓ Synchronized ${updated.length} manifest(s) to version ${version}.`);
  } else {
    console.log(`✓ All manifests already at version ${version}.`);
  }
}

if (process.argv[1] === __filename) {
  run();
}
