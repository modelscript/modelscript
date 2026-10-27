// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

interface Violation {
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

  return packagePaths;
}

export function checkDistIntegrity(pkgJsonPath: string): Violation[] {
  const violations: Violation[] = [];
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const pkgName = pkg.name || path.relative(REPO_ROOT, pkgDir).replace(/\\/g, "/");
  const distDir = path.join(pkgDir, "dist");

  // Only check packages that have or produce a dist/ directory
  if (!fs.existsSync(distDir)) {
    return violations;
  }

  // 1. Verify "exports" map targets exist in dist/
  if (pkg.exports && typeof pkg.exports === "object") {
    function checkExportEntry(val: unknown, exportPath: string) {
      if (typeof val === "string") {
        if (val.startsWith("./dist/") && !val.includes("*")) {
          const targetFile = path.join(pkgDir, val);
          if (!fs.existsSync(targetFile)) {
            violations.push({
              package: pkgName,
              rule: "missing-dist-export",
              message: `Export "${exportPath}" points to "${val}" which does not exist in dist/.`,
            });
          } else if (fs.statSync(targetFile).size === 0) {
            violations.push({
              package: pkgName,
              rule: "empty-dist-export",
              message: `Export "${exportPath}" points to "${val}" which is empty (0 bytes).`,
            });
          }
        }
      } else if (val && typeof val === "object") {
        for (const [subKey, subVal] of Object.entries(val)) {
          checkExportEntry(subVal, `${exportPath}.${subKey}`);
        }
      }
    }

    for (const [exportKey, exportVal] of Object.entries(pkg.exports)) {
      checkExportEntry(exportVal, exportKey);
    }
  }

  // 2. Non-TS asset parity: Check that .wasm and .js/.d.ts in src/ have corresponding dist/ files
  const srcDir = path.join(pkgDir, "src");
  if (fs.existsSync(srcDir)) {
    function findNonTsAssets(dir: string, baseDir: string = dir): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "scratch") continue;
          results.push(...findNonTsAssets(full, baseDir));
        } else if (entry.isFile()) {
          const rel = path.relative(baseDir, full).replace(/\\/g, "/");
          // Look for .wasm assets or src-gen bindings that are required at runtime
          if (entry.name.endsWith(".wasm") || rel.includes("src-gen/bindings.js")) {
            results.push(rel);
          }
        }
      }
      return results;
    }

    const nonTsAssets = findNonTsAssets(srcDir);
    for (const assetRel of nonTsAssets) {
      const distCandidate = path.join(distDir, assetRel);
      if (!fs.existsSync(distCandidate)) {
        violations.push({
          package: pkgName,
          rule: "untranspiled-asset-missing-in-dist",
          message: `Source asset "src/${assetRel}" is not present in "dist/${assetRel}". Ensure the build script copies it.`,
        });
      }
    }
  }

  return violations;
}

function run(): void {
  const packagePaths = getWorkspacePackages();
  const allViolations: Violation[] = [];

  for (const pkgPath of packagePaths) {
    const violations = checkDistIntegrity(pkgPath);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    console.error(`\nFound ${allViolations.length} dist integrity violation(s):\n`);
    for (const v of allViolations) {
      console.error(`  [${v.package}] (${v.rule}): ${v.message}`);
    }
    console.error("\nPlease rebuild the affected packages or ensure asset-copy scripts run.\n");
    process.exit(1);
  }

  console.log(`✓ All built workspace packages passed dist integrity verification.`);
}

if (process.argv[1] === __filename) {
  run();
}
