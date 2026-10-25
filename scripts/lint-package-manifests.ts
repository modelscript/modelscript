// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

interface Violation {
  file: string;
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

export function checkPackageManifest(pkgJsonPath: string): Violation[] {
  const violations: Violation[] = [];
  const relPath = path.relative(REPO_ROOT, pkgJsonPath);
  const pkgDir = path.dirname(pkgJsonPath);

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  } catch (err) {
    violations.push({
      file: relPath,
      rule: "valid-json",
      message: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
    });
    return violations;
  }

  const scripts = (pkg["scripts"] as Record<string, string> | undefined) || {};

  // 1. Validate "lint" script
  if (scripts["lint"]) {
    const lintCmd = scripts["lint"].trim();

    // Must be standard ESLint
    if (!lintCmd.startsWith("eslint ")) {
      violations.push({
        file: relPath,
        rule: "standard-lint-command",
        message: `Standard "lint" script must invoke ESLint (found: "${lintCmd}"). Non-ESLint linters must use scoped names like "lint:<tool>".`,
      });
    } else {
      // Must include --no-warn-ignored
      if (!lintCmd.includes("--no-warn-ignored")) {
        violations.push({
          file: relPath,
          rule: "eslint-no-warn-ignored",
          message: `ESLint command in "lint" script must include "--no-warn-ignored".`,
        });
      }

      // Check that referenced paths in eslint command actually exist
      // e.g. "eslint src tests --no-warn-ignored" -> check that "src" and "tests" exist
      const tokens = lintCmd.split(/\s+/).slice(1); // skip "eslint"
      for (const token of tokens) {
        if (token.startsWith("-")) continue; // flag or option
        // Skip globs or extensions like . or **/* or *.ts
        if (token === "." || token.includes("*") || token.endsWith(".ts") || token.endsWith(".js")) continue;

        const targetPath = path.join(pkgDir, token);
        if (!fs.existsSync(targetPath)) {
          violations.push({
            file: relPath,
            rule: "lint-target-exists",
            message: `Directory or path "${token}" referenced in "lint" script does not exist in ${relPath}.`,
          });
        }
      }
    }
  }

  return violations;
}

function run(): void {
  const packagePaths = getWorkspacePackages();
  const allViolations: Violation[] = [];

  for (const pkgPath of packagePaths) {
    const violations = checkPackageManifest(pkgPath);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    console.error(`\nFound ${allViolations.length} package manifest violation(s):\n`);
    for (const v of allViolations) {
      console.error(`  ${v.file}: [${v.rule}] ${v.message}`);
    }
    console.error("\nPlease correct these package.json issues before committing.\n");
    process.exit(1);
  }

  console.log(`✓ All ${packagePaths.length} workspace package manifests conform to repository standards.`);
}

if (process.argv[1] === __filename) {
  run();
}
