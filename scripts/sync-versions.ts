// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getWorkspacePackages, REPO_ROOT } from "./lib/workspaces.js";

const __filename = fileURLToPath(import.meta.url);

function getTargetWorkspaceJsonPaths(): string[] {
  return getWorkspacePackages({ excludeExamples: true, excludeIdeGithubFs: true });
}

function resolveTargetVersion(currentVersion: string, requested?: string): string {
  if (!requested) return currentVersion;
  const trimmed = requested.replace(/^v/, "").trim();
  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (trimmed === "patch" || trimmed === "minor" || trimmed === "major") {
    if (!match) {
      throw new Error(`Cannot compute ${trimmed} bump from non-numeric version "${currentVersion}".`);
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (trimmed === "major") return `${major + 1}.0.0`;
    if (trimmed === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid version "${requested}". ModelScript requires clean numeric SemVer (major.minor.patch, e.g. 0.1.0) for VS Code Marketplace (vsce) and Tauri desktop bundler compatibility.`,
    );
  }
  return trimmed;
}

export function syncVersions(options?: { checkOnly?: boolean; explicitVersion?: string }): {
  version: string;
  mismatches: string[];
  updated: string[];
} {
  const checkOnly = options?.checkOnly ?? process.argv.includes("--check");
  const versionFlag = process.argv.find((a) => a.startsWith("--version="));
  const positionalArg =
    options?.explicitVersion === undefined && !checkOnly
      ? process.argv.slice(2).find((a) => !a.startsWith("-"))
      : undefined;
  const runtimePkgPath = path.join(REPO_ROOT, "packages", "runtime", "package.json");
  const runtimePkg = JSON.parse(fs.readFileSync(runtimePkgPath, "utf-8"));
  const requestedVersion =
    options?.explicitVersion || (versionFlag ? versionFlag.slice("--version=".length) : positionalArg);
  const canonicalVersion: string = resolveTargetVersion(runtimePkg.version, requestedVersion);

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

  // 7. Synchronize embedded source version constants
  const sourceVersionPins: Array<{
    relPath: string;
    pattern: RegExp;
    replace: (ver: string) => string;
  }> = [
    {
      relPath: "apps/web/src/config.ts",
      pattern: /export const ANSATZ_VERSION\s*=\s*"([^"]+)"/,
      replace: (ver) => `export const ANSATZ_VERSION = "${ver}"`,
    },
    {
      relPath: "packages/mcp/src/main.ts",
      pattern: /const SERVER_VERSION\s*=\s*"([^"]+)"/,
      replace: (ver) => `const SERVER_VERSION = "${ver}"`,
    },
    {
      relPath: "packages/dsl/src/codegen/ide/extension-generator.ts",
      pattern: /let workspaceVersion\s*=\s*"([^"]+)"/,
      replace: (ver) => `let workspaceVersion = "${ver}"`,
    },
    {
      relPath: "apps/api/src/routes/admin.ts",
      pattern:
        /const buildVersion\s*=\s*process\.env\["MSX_BUILD_SHA"\]\s*\|\|\s*process\.env\["IMAGE_TAG"\]\s*\|\|\s*"([^"]+)"/,
      replace: (ver) => `const buildVersion = process.env["MSX_BUILD_SHA"] || process.env["IMAGE_TAG"] || "${ver}"`,
    },
    {
      relPath: "apps/cli/src/main.ts",
      pattern: /let pkgVersion\s*=\s*"([^"]+)"/,
      replace: (ver) => `let pkgVersion = "${ver}"`,
    },
    {
      relPath: "apps/desktop/src/index.ts",
      pattern: /appVersion:\s*"([^"]+)"/,
      replace: (ver) => `appVersion: "${ver}"`,
    },
  ];

  for (const pin of sourceVersionPins) {
    const absPath = path.join(REPO_ROOT, pin.relPath);
    if (!fs.existsSync(absPath)) continue;
    const raw = fs.readFileSync(absPath, "utf-8");
    const match = raw.match(pin.pattern);
    if (match && match[1] !== canonicalVersion) {
      mismatches.push(`${pin.relPath} (found ${match[1]}, expected ${canonicalVersion})`);
      if (!checkOnly) {
        const nextRaw = raw.replace(pin.pattern, pin.replace(canonicalVersion));
        fs.writeFileSync(absPath, nextRaw, "utf-8");
        updated.push(pin.relPath);
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
      console.error("\nRun 'npm run sync:versions' to synchronize workspace versions.\n");
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
