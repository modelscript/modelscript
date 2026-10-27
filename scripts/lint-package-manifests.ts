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

  // 2. Non-private publishable package requirements
  const isPrivate = pkg["private"] === true;
  if (!isPrivate) {
    if (pkg["license"] !== "AGPL-3.0-or-later") {
      violations.push({
        file: relPath,
        rule: "required-license",
        message: `Publishable package must specify "license": "AGPL-3.0-or-later" (found: ${JSON.stringify(pkg["license"])}).`,
      });
    }

    const files = pkg["files"];
    if (!Array.isArray(files) || files.length === 0) {
      violations.push({
        file: relPath,
        rule: "required-files",
        message: `Publishable package must declare a non-empty "files" whitelist array.`,
      });
    }

    if (!pkg["exports"] && !pkg["bin"] && !pkg["main"]) {
      violations.push({
        file: relPath,
        rule: "required-entrypoint",
        message: `Publishable package must specify at least one of "exports", "bin", or "main".`,
      });
    }
  }

  // 3. Workspace README.md existence, header, and table integrity
  violations.push(...checkWorkspaceReadme(pkgDir));

  return violations;
}

const EXPECTED_BISMILLAH_LINE_1 = '<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>';
const EXPECTED_BISMILLAH_LINE_2 = '<div align="center">In the name of Allah, the Compassionate, the Merciful</div>';

function checkMarkdownTables(relReadmePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Detect a Markdown table delimiter row: | :--- | --- |
    if (/^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line) && i > 0) {
      const prevLine = lines[i - 1]!;
      if (/^\s*\|.*\|\s*$/.test(prevLine)) {
        const delimCols = line.trim().slice(1, -1).split("|").length;
        const headerCols = prevLine.trim().slice(1, -1).replace(/\\\|/g, "").split("|").length;
        if (delimCols !== headerCols) {
          violations.push({
            file: relReadmePath,
            rule: "readme-table-columns",
            message: `Markdown table at line ${i} has ${headerCols} header column(s) but ${delimCols} delimiter column(s) (check for unescaped '|' in formulas).`,
          });
        }
      }
    }
  }

  return violations;
}

function checkWorkspaceReadme(pkgDir: string): Violation[] {
  const violations: Violation[] = [];
  const readmePath = path.join(pkgDir, "README.md");
  const relReadmePath = path.relative(REPO_ROOT, readmePath).replace(/\\/g, "/");

  if (!fs.existsSync(readmePath)) {
    violations.push({
      file: relReadmePath,
      rule: "readme-exists",
      message: `Workspace package is missing a README.md file at ${relReadmePath}.`,
    });
    return violations;
  }

  const content = fs.readFileSync(readmePath, "utf-8");
  if (content.trim().length === 0) {
    violations.push({
      file: relReadmePath,
      rule: "readme-exists",
      message: `Workspace README.md at ${relReadmePath} cannot be empty.`,
    });
    return violations;
  }

  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== EXPECTED_BISMILLAH_LINE_1 || lines[1]?.trim() !== EXPECTED_BISMILLAH_LINE_2) {
    violations.push({
      file: relReadmePath,
      rule: "readme-bismillah-header",
      message: `README.md must begin with the standard 2-line UTF-8 Bismillah header.`,
    });
  }

  violations.push(...checkMarkdownTables(relReadmePath, content));
  return violations;
}

function checkCrossWorkspaceRules(packagePaths: string[]): Violation[] {
  const violations: Violation[] = [];
  const privatePackageNames = new Set<string>();
  const parsedManifests: { relPath: string; pkg: Record<string, unknown> }[] = [];

  for (const pkgPath of packagePaths) {
    const relPath = path.relative(REPO_ROOT, pkgPath).replace(/\\/g, "/");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
      parsedManifests.push({ relPath, pkg });
      if (pkg["private"] === true && typeof pkg["name"] === "string") {
        privatePackageNames.add(pkg["name"]);
      }
    } catch {
      // Handled in checkPackageManifest
    }
  }

  // 4. Ensure no publishable package depends on a private workspace package in "dependencies"
  for (const { relPath, pkg } of parsedManifests) {
    if (pkg["private"] === true) continue;
    const deps = (pkg["dependencies"] as Record<string, string> | undefined) || {};
    for (const depName of Object.keys(deps)) {
      if (privatePackageNames.has(depName)) {
        violations.push({
          file: relPath,
          rule: "no-private-dependency",
          message: `Publishable package cannot list private workspace package "${depName}" in "dependencies".`,
        });
      }
    }
  }

  // 5. Ensure Dockerfile contains COPY <relPath> <relDir>/ for every workspace package.json
  const dockerfilePath = path.join(REPO_ROOT, "Dockerfile");
  if (fs.existsSync(dockerfilePath)) {
    const dockerfileContent = fs.readFileSync(dockerfilePath, "utf-8");
    for (const { relPath } of parsedManifests) {
      const relDir = path.posix.dirname(relPath);
      const expectedCopyPattern = new RegExp(
        `^COPY\\s+${relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${relDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?\\s*$`,
        "m",
      );
      if (!expectedCopyPattern.test(dockerfileContent)) {
        violations.push({
          file: "Dockerfile",
          rule: "dockerfile-workspace-copy",
          message: `Missing "COPY ${relPath} ${relDir}/" in Dockerfile builder stage for workspace package "${relPath}".`,
        });
      }
    }
  }

  // 6. Validate root README.md and ensure every top-level apps/*, packages/*, and languages/* workspace is linked
  const rootReadmePath = path.join(REPO_ROOT, "README.md");
  if (fs.existsSync(rootReadmePath)) {
    const rootReadme = fs.readFileSync(rootReadmePath, "utf-8");
    violations.push(...checkWorkspaceReadme(REPO_ROOT));
    for (const { relPath } of parsedManifests) {
      const relDir = path.posix.dirname(relPath);
      if (/^(apps|packages|languages)\/[^/]+$/.test(relDir)) {
        if (!rootReadme.includes(`./${relDir}/`) && !rootReadme.includes(`./${relDir})`)) {
          violations.push({
            file: "README.md",
            rule: "readme-root-link",
            message: `Top-level workspace "${relDir}" is not linked in the root README.md.`,
          });
        }
      }
    }
  }

  return violations;
}

async function run(): Promise<void> {
  const packagePaths = getWorkspacePackages();
  const allViolations: Violation[] = [];

  for (const pkgPath of packagePaths) {
    const violations = checkPackageManifest(pkgPath);
    allViolations.push(...violations);
  }

  allViolations.push(...checkCrossWorkspaceRules(packagePaths));

  const { syncVersions } = await import("./sync-versions.js");
  const versionResult = syncVersions({ checkOnly: true });
  for (const mismatch of versionResult.mismatches) {
    allViolations.push({
      file: mismatch.split(":")[0] || "package.json",
      rule: "version-sync",
      message: `Version mismatch (${mismatch}); expected canonical version ${versionResult.version}. Run "npm run sync:versions".`,
    });
  }

  if (allViolations.length > 0) {
    console.error(`\nFound ${allViolations.length} package manifest / README violation(s):\n`);
    for (const v of allViolations) {
      console.error(`  ${v.file}: [${v.rule}] ${v.message}`);
    }
    console.error("\nPlease correct these package.json or README.md issues before committing.\n");
    process.exit(1);
  }

  console.log(
    `✓ All ${packagePaths.length} workspace package manifests, READMEs, Dockerfile layer copies, and version pins (${versionResult.version}) conform to repository standards.`,
  );
}

if (process.argv[1] === __filename) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
