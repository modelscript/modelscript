// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export interface PackViolation {
  package: string;
  rule: string;
  message: string;
}

function getWorkspacePackages(): string[] {
  const rootPkgPath = path.join(REPO_ROOT, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
  const workspaces: string[] = rootPkg.workspaces || [];
  const packagePaths: string[] = [];

  for (const pattern of workspaces) {
    if (pattern.endsWith("/*")) {
      const parentDir = path.join(REPO_ROOT, pattern.slice(0, -2));
      if (!fs.existsSync(parentDir)) continue;
      for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
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

export function isIncludedByFilesWhitelist(relTarget: string, filesList: string[]): boolean {
  const cleanTarget = relTarget.replace(/^\.\//, "").replace(/\\/g, "/");
  // package.json, README.md, LICENSE/COPYING are always included by npm pack
  if (
    cleanTarget === "package.json" ||
    /^readme(\.|$)/i.test(cleanTarget) ||
    /^(license|copying)(\.|$)/i.test(cleanTarget)
  ) {
    return true;
  }

  for (const rawPattern of filesList) {
    const pat = rawPattern.replace(/^\.\//, "").replace(/\/+$/, "").replace(/\\/g, "/");
    if (!pat || pat.startsWith("!")) continue;
    if (cleanTarget === pat || cleanTarget.startsWith(`${pat}/`)) {
      return true;
    }
    if (pat.includes("*")) {
      const regexStr =
        "^" +
        pat
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\/\*\*\//g, "__SLASH_GLOBSTAR_SLASH__")
          .replace(/\*\*/g, "__GLOBSTAR__")
          .replace(/\*/g, "[^/]*")
          .replace(/__SLASH_GLOBSTAR_SLASH__/g, "(?:/.*)?/")
          .replace(/__GLOBSTAR__/g, ".*") +
        "$";
      if (new RegExp(regexStr).test(cleanTarget)) {
        return true;
      }
    }
  }

  return false;
}

function collectExportTargets(exportsField: unknown): string[] {
  const targets: string[] = [];
  function visit(val: unknown): void {
    if (typeof val === "string") {
      if (!val.includes("*")) {
        targets.push(val);
      }
    } else if (val && typeof val === "object") {
      for (const sub of Object.values(val)) {
        visit(sub);
      }
    }
  }
  visit(exportsField);
  return targets;
}

export function checkPublishablePackageWhitelist(pkgJsonPath: string): PackViolation[] {
  const violations: PackViolation[] = [];
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
  if (pkg["private"] === true) return violations;

  const pkgName = (pkg["name"] as string) || path.relative(REPO_ROOT, pkgDir).replace(/\\/g, "/");
  const filesList = Array.isArray(pkg["files"]) ? (pkg["files"] as string[]) : [];
  if (filesList.length === 0) return violations;

  const targetsToCheck = new Set<string>();
  if (typeof pkg["main"] === "string") targetsToCheck.add(pkg["main"]);
  if (typeof pkg["types"] === "string") targetsToCheck.add(pkg["types"]);
  if (typeof pkg["bin"] === "string") {
    targetsToCheck.add(pkg["bin"]);
  } else if (pkg["bin"] && typeof pkg["bin"] === "object") {
    for (const binTarget of Object.values(pkg["bin"] as Record<string, unknown>)) {
      if (typeof binTarget === "string") targetsToCheck.add(binTarget);
    }
  }
  for (const expTarget of collectExportTargets(pkg["exports"])) {
    targetsToCheck.add(expTarget);
  }

  for (const target of targetsToCheck) {
    if (!isIncludedByFilesWhitelist(target, filesList)) {
      violations.push({
        package: pkgName,
        rule: "entrypoint-excluded-from-files",
        message: `Entrypoint "${target}" is not covered by the "files" whitelist (${JSON.stringify(filesList)}) and will be missing from published npm tarballs.`,
      });
    }
  }

  // Check for leaked scratch files inside whitelisted dist/build directories
  const distDir = path.join(pkgDir, "dist");
  if (fs.existsSync(distDir) && isIncludedByFilesWhitelist("dist/index.js", filesList)) {
    function scanForScratch(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (/^scratch($|[_.-])/i.test(entry.name)) {
          const rel = path.relative(pkgDir, full).replace(/\\/g, "/");
          violations.push({
            package: pkgName,
            rule: "scratch-artifact-in-dist",
            message: `Scratch artifact "${rel}" exists inside publishable dist/ directory and would leak into npm tarballs.`,
          });
        } else if (entry.isDirectory()) {
          scanForScratch(full);
        }
      }
    }
    scanForScratch(distDir);
  }

  return violations;
}

export function checkRootOverrides(pruneStale = false): {
  violations: PackViolation[];
  staleOverrides: string[];
  pruned: number;
} {
  const violations: PackViolation[] = [];
  const staleOverrides: string[] = [];
  const rootPkgPath = path.join(REPO_ROOT, "package.json");
  const lockPath = path.join(REPO_ROOT, "package-lock.json");

  if (!fs.existsSync(rootPkgPath) || !fs.existsSync(lockPath)) {
    return { violations, staleOverrides, pruned: 0 };
  }

  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8")) as Record<string, unknown>;
  const overrides = (rootPkg["overrides"] as Record<string, unknown> | undefined) || {};
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as {
    packages?: Record<string, { version?: string }>;
  };
  const lockPackages = lock.packages || {};

  // Build set of all package names present anywhere in package-lock.json
  const presentInLock = new Set<string>();
  for (const key of Object.keys(lockPackages)) {
    if (!key) continue;
    const nmIdx = key.lastIndexOf("node_modules/");
    if (nmIdx >= 0) {
      const pkgName = key.slice(nmIdx + "node_modules/".length);
      presentInLock.add(pkgName);
    }
  }

  // Also include workspace package names
  for (const pkgPath of getWorkspacePackages()) {
    try {
      const wPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { name?: string };
      if (wPkg.name) presentInLock.add(wPkg.name);
    } catch {
      // ignore
    }
  }

  let pruned = 0;
  const nextOverrides: Record<string, unknown> = {};
  for (const [overrideKey, overrideVal] of Object.entries(overrides)) {
    // Strip version selector if key is e.g. "foo@^1.0.0"
    const atIdx = overrideKey.startsWith("@") ? overrideKey.indexOf("@", 1) : overrideKey.indexOf("@");
    const pkgName = atIdx > 0 ? overrideKey.slice(0, atIdx) : overrideKey;

    if (!presentInLock.has(pkgName)) {
      staleOverrides.push(overrideKey);
      if (pruneStale) {
        pruned++;
      } else {
        violations.push({
          package: "package.json#overrides",
          rule: "stale-override",
          message: `Override key "${overrideKey}" is not present anywhere in package-lock.json. Run "npx tsx scripts/verify-pack-install.ts --prune-overrides".`,
        });
      }
    } else {
      nextOverrides[overrideKey] = overrideVal;
    }
  }

  if (pruneStale && pruned > 0) {
    rootPkg["overrides"] = nextOverrides;
    fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n", "utf-8");
  }

  return { violations, staleOverrides, pruned };
}

export function verifyNpmPackDryRun(pkgDir: string): PackViolation[] {
  const violations: PackViolation[] = [];
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const distDir = path.join(pkgDir, "dist");
  if (!fs.existsSync(pkgJsonPath) || !fs.existsSync(distDir)) return violations;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
  const pkgName = (pkg["name"] as string) || path.relative(REPO_ROOT, pkgDir).replace(/\\/g, "/");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

  const res = childProcess.spawnSync(npmCmd, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pkgDir,
    encoding: "utf-8",
    timeout: 20000,
    shell: process.platform === "win32",
  });

  if (res.status !== 0) {
    violations.push({
      package: pkgName,
      rule: "npm-pack-failed",
      message: `npm pack --dry-run failed with status ${res.status}: ${(res.stderr || "").trim().slice(0, 200)}`,
    });
    return violations;
  }

  try {
    const parsed = JSON.parse(res.stdout) as { files?: { path: string }[] }[];
    const packedFiles = new Set((parsed[0]?.files || []).map((f) => f.path.replace(/\\/g, "/")));

    const declaredTargets = new Set<string>(collectExportTargets(pkg["exports"]));
    if (typeof pkg["main"] === "string") declaredTargets.add(pkg["main"]);
    if (typeof pkg["types"] === "string") declaredTargets.add(pkg["types"]);
    if (typeof pkg["bin"] === "string") {
      declaredTargets.add(pkg["bin"]);
    } else if (pkg["bin"] && typeof pkg["bin"] === "object") {
      for (const binTarget of Object.values(pkg["bin"] as Record<string, unknown>)) {
        if (typeof binTarget === "string") declaredTargets.add(binTarget);
      }
    }

    for (const expTarget of declaredTargets) {
      const clean = expTarget.replace(/^\.\//, "");
      if (!packedFiles.has(clean)) {
        violations.push({
          package: pkgName,
          rule: "missing-in-npm-pack-tarball",
          message: `Export target "${clean}" was not included in 'npm pack --dry-run' tarball output.`,
        });
      }
    }
  } catch (err) {
    violations.push({
      package: pkgName,
      rule: "npm-pack-json-parse",
      message: `Failed to parse npm pack JSON output: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return violations;
}

export const CORE_PACK_TARGETS = [
  "packages/dsl",
  "packages/runtime",
  "packages/simulate",
  "packages/cad",
  "packages/exchange",
  "packages/mcp",
  "packages/diagram",
  "packages/lsp",
  "languages/modelica",
  "apps/cli",
] as const;

export const ESM_IMPORT_TARGETS = [
  "packages/dsl",
  "packages/runtime",
  "packages/simulate",
  "packages/cad",
  "packages/exchange",
  "packages/mcp",
  "packages/diagram",
  "packages/lsp",
  "languages/modelica",
] as const;

const ESM_IMPORT_ENTRYPOINTS: Record<string, string> = {
  "packages/diagram": "dist/polyglot-diagram-builder.js",
  "languages/modelica": "dist/src/index.js",
};

export async function verifyCoreEsmImports(pkgDirs: string[]): Promise<{
  violations: PackViolation[];
  importedCount: number;
}> {
  const violations: PackViolation[] = [];
  let importedCount = 0;

  for (const pkgDir of pkgDirs) {
    const pkgJsonPath = path.join(pkgDir, "package.json");
    const relDir = path.relative(REPO_ROOT, pkgDir).replace(/\\/g, "/");
    const relEntry = ESM_IMPORT_ENTRYPOINTS[relDir] ?? "dist/index.js";
    const entryPath = path.join(pkgDir, relEntry);
    if (!fs.existsSync(pkgJsonPath) || !fs.existsSync(entryPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
    const pkgName = (pkg["name"] as string) || path.relative(REPO_ROOT, pkgDir).replace(/\\/g, "/");

    try {
      const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
      if (!mod || typeof mod !== "object" || Object.keys(mod).length === 0) {
        violations.push({
          package: pkgName,
          rule: "esm-smoke-empty-namespace",
          message: `Dynamic ESM import of "${path.relative(REPO_ROOT, entryPath).replace(/\\/g, "/")}" resolved to an empty module namespace.`,
        });
      } else {
        importedCount++;
      }
    } catch (err) {
      violations.push({
        package: pkgName,
        rule: "esm-smoke-import-failed",
        message: `Dynamic ESM import of "${path.relative(REPO_ROOT, entryPath).replace(/\\/g, "/")}" threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { violations, importedCount };
}

async function run(): Promise<void> {
  const pruneOverrides = process.argv.includes("--prune-overrides");
  const packagePaths = getWorkspacePackages();
  const allViolations: PackViolation[] = [];

  for (const pkgPath of packagePaths) {
    allViolations.push(...checkPublishablePackageWhitelist(pkgPath));
  }

  const overrideResult = checkRootOverrides(pruneOverrides);
  if (pruneOverrides && overrideResult.pruned > 0) {
    console.log(
      `✓ Pruned ${overrideResult.pruned} stale override(s) from root package.json: ${overrideResult.staleOverrides.join(", ")}`,
    );
  }
  allViolations.push(...overrideResult.violations);

  // Run npm pack --dry-run verification on core publishable SDK packages if built
  const corePublishableDirs = CORE_PACK_TARGETS.map((rel) => path.join(REPO_ROOT, rel));
  let packedChecked = 0;
  for (const dir of corePublishableDirs) {
    if (fs.existsSync(path.join(dir, "dist"))) {
      allViolations.push(...verifyNpmPackDryRun(dir));
      packedChecked++;
    }
  }

  const esmSmokeDirs = ESM_IMPORT_TARGETS.map((rel) => path.join(REPO_ROOT, rel));
  const esmResult = await verifyCoreEsmImports(esmSmokeDirs);
  allViolations.push(...esmResult.violations);

  if (allViolations.length > 0) {
    console.error(`\n❌ Found ${allViolations.length} package tarball / override integrity violation(s):\n`);
    for (const v of allViolations) {
      console.error(`  [${v.package}] (${v.rule}): ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ All publishable workspace whitelists, root overrides, ${packedChecked} core npm-pack tarball(s), and ${esmResult.importedCount} ESM entrypoint import(s) passed verification.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
