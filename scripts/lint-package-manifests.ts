// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getWorkspacePackages, REPO_ROOT } from "./lib/workspaces.js";
import { syncVersions } from "./sync-versions.js";

const __filename = fileURLToPath(import.meta.url);

export interface ManifestViolation {
  file: string;
  rule: string;
  message: string;
}

type Violation = ManifestViolation;

const STABLE_LANGUAGES = new Set([
  "modelscript",
  "modelica",
  "sysml2",
  "ssp",
  "reqif",
  "owl2",
  "csv",
  "pscad",
  "spice",
  "olga",
  "lps",
  "gensys",
  "step",
  "scad",
]);

const BETA_LANGUAGES = new Set([
  "opendrive",
  "adams",
  "easy5",
  "rocets",
  "urdf",
  "ccsds",
  "epanet",
  "gtsuite",
  "plcopen",
  "simulink",
  "autosar",
  "c",
  "energyplus",
  "simpack",
  "verilog-a",
]);

const CORE_FOUNDATIONAL_LANGUAGES = new Set(["ssp", "csv"]);

export function getExpectedMetadata(relDir: string): {
  tier: "stable" | "beta" | "preview";
  category: "core" | "language" | "app" | "example" | "ee";
} {
  const norm = relDir.replace(/\\/g, "/");
  if (norm === "ee" || norm.startsWith("ee/")) {
    return { tier: "stable", category: "ee" };
  }
  if (norm.startsWith("apps/")) {
    return { tier: "stable", category: "app" };
  }
  if (norm.startsWith("packages/examples/")) {
    return { tier: "stable", category: "example" };
  }
  if (norm.startsWith("packages/")) {
    return { tier: "stable", category: "core" };
  }
  const slug = path.posix.basename(norm);
  if (STABLE_LANGUAGES.has(slug)) {
    return { tier: "stable", category: "language" };
  }
  if (BETA_LANGUAGES.has(slug)) {
    return { tier: "beta", category: "language" };
  }
  return { tier: "preview", category: "language" };
}

function countPackageTestFiles(pkgDir: string): number {
  const testsDir = path.join(pkgDir, "tests");
  if (!fs.existsSync(testsDir)) return 0;
  let count = 0;
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("scratch") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))) {
        count++;
      }
    }
  }
  walk(testsDir);
  return count;
}

export function syncMaturityMetadata(packagePaths: string[]): number {
  let updatedCount = 0;
  for (const pkgPath of packagePaths) {
    const relPath = path.relative(REPO_ROOT, pkgPath).replace(/\\/g, "/");
    const relDir = path.posix.dirname(relPath);
    const expected = getExpectedMetadata(relDir);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    const current = pkg["modelscript"] as { tier?: string; category?: string } | undefined;
    if (!current || current.tier !== expected.tier || current.category !== expected.category) {
      pkg["modelscript"] = expected;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
      updatedCount++;
    }
  }
  return updatedCount;
}

export function checkPackageManifest(pkgJsonPath: string): Violation[] {
  const violations: Violation[] = [];
  const relPath = path.relative(REPO_ROOT, pkgJsonPath).replace(/\\/g, "/");
  const pkgDir = path.dirname(pkgJsonPath);
  const relDir = path.posix.dirname(relPath);
  const isEnterprisePkg = relDir === "ee" || relDir.startsWith("ee/");

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

  // 1b. Validate "test" script uses universal test-runner.js
  if (scripts["test"]) {
    const testCmd = scripts["test"].trim();
    const delegatedCmd = testCmd === "npm run test:unit" ? (scripts["test:unit"] ?? "") : testCmd;
    if (!delegatedCmd.includes("scripts/test-runner.js")) {
      violations.push({
        file: relPath,
        rule: "standard-test-runner",
        message: `Workspace "test" script must invoke "scripts/test-runner.js" for unified CTRF reporting, coverage, and Nx flag handling (found: "${testCmd}").`,
      });
    }
  }

  // 2. Non-private publishable package requirements & Enterprise Edition guardrails
  const isPrivate = pkg["private"] === true;
  if (isEnterprisePkg) {
    if (!isPrivate) {
      violations.push({
        file: relPath,
        rule: "ee-must-be-private",
        message: `Enterprise Edition package under ee/ must specify "private": true.`,
      });
    }
    if (pkg["license"] !== "LicenseRef-ModelScript-Enterprise") {
      violations.push({
        file: relPath,
        rule: "ee-required-license",
        message: `Enterprise Edition package must specify "license": "LicenseRef-ModelScript-Enterprise" (found: ${JSON.stringify(pkg["license"])}).`,
      });
    }
  } else if (!isPrivate) {
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

  // 2b. Validate "modelscript" maturity metadata & test-suite thresholds
  const meta = pkg["modelscript"] as { tier?: string; category?: string } | undefined;
  const validTiers = new Set(["stable", "beta", "preview"]);
  const validCategories = new Set(["core", "language", "app", "example", "ee"]);
  if (
    !meta ||
    typeof meta !== "object" ||
    !validTiers.has(meta.tier ?? "") ||
    !validCategories.has(meta.category ?? "")
  ) {
    violations.push({
      file: relPath,
      rule: "required-maturity-metadata",
      message: `Package must declare "modelscript": { "tier": "stable" | "beta" | "preview", "category": "core" | "language" | "app" | "example" | "ee" }. Run "npx tsx scripts/lint-package-manifests.ts --sync-tiers".`,
    });
  } else if (relDir.startsWith("languages/")) {
    const slug = path.posix.basename(relDir);
    const testCount = countPackageTestFiles(pkgDir);
    if (meta.tier === "stable" && !CORE_FOUNDATIONAL_LANGUAGES.has(slug) && testCount < 4) {
      violations.push({
        file: relPath,
        rule: "tier-test-threshold",
        message: `Language "${slug}" is marked "stable" but only has ${testCount} test file(s) (minimum 4 required for stable tier).`,
      });
    } else if (meta.tier === "beta" && testCount < 5) {
      violations.push({
        file: relPath,
        rule: "tier-test-threshold",
        message: `Language "${slug}" is marked "beta" but only has ${testCount} test file(s) (minimum 5 required for beta tier).`,
      });
    } else if (testCount < 1) {
      violations.push({
        file: relPath,
        rule: "tier-test-threshold",
        message: `Language "${slug}" must have at least 1 unit/integration test file in tests/.`,
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

  // 7. Ensure shared devDependencies in workspaces match root package.json#devDependencies
  const rootPkgPath = path.join(REPO_ROOT, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8")) as {
    devDependencies?: Record<string, string>;
  };
  const rootDevDeps = rootPkg.devDependencies || {};
  for (const { relPath, pkg } of parsedManifests) {
    const devDeps = (pkg["devDependencies"] as Record<string, string> | undefined) || {};
    for (const [depName, depVer] of Object.entries(devDeps)) {
      const expectedVer = rootDevDeps[depName];
      if (expectedVer && depVer !== expectedVer) {
        violations.push({
          file: relPath,
          rule: "dev-dependency-version-sync",
          message: `devDependency "${depName}" has version "${depVer}" but root package.json specifies "${expectedVer}". Run "npx tsx scripts/lint-package-manifests.ts --sync".`,
        });
      }
    }
  }

  // 8. Ensure every packages/* and languages/* SDK workspace has a path entry in root tsconfig.json
  const rootTsconfigPath = path.join(REPO_ROOT, "tsconfig.json");
  if (fs.existsSync(rootTsconfigPath)) {
    const rootTsconfig = JSON.parse(fs.readFileSync(rootTsconfigPath, "utf-8")) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const tsPaths = rootTsconfig.compilerOptions?.paths || {};
    for (const { relPath, pkg } of parsedManifests) {
      const relDir = path.posix.dirname(relPath);
      if (!/^(packages|languages)\/[^/]+$/.test(relDir)) continue;
      const pkgName = pkg["name"];
      if (typeof pkgName !== "string" || !pkgName.startsWith("@modelscript/")) continue;
      if (!tsPaths[pkgName] || !tsPaths[`${pkgName}/*`]) {
        violations.push({
          file: "tsconfig.json",
          rule: "tsconfig-workspace-paths",
          message: `Workspace "${pkgName}" (${relDir}) is missing "${pkgName}" or "${pkgName}/*" in root tsconfig.json#compilerOptions.paths.`,
        });
      }
    }
  }

  return violations;
}

export function syncSharedDevDependencies(packagePaths: string[] = getWorkspacePackages()): number {
  const rootPkgPath = path.join(REPO_ROOT, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8")) as {
    devDependencies?: Record<string, string>;
  };
  const rootDevDeps = rootPkg.devDependencies || {};
  let updatedCount = 0;

  for (const pkgPath of packagePaths) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    const devDeps = pkg["devDependencies"] as Record<string, string> | undefined;
    if (!devDeps) continue;
    let changed = false;
    for (const [depName, depVer] of Object.entries(devDeps)) {
      const expectedVer = rootDevDeps[depName];
      if (expectedVer && depVer !== expectedVer) {
        devDeps[depName] = expectedVer;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
      updatedCount++;
    }
  }

  return updatedCount;
}

export function generateDockerfileManifestCopies(packagePaths: string[] = getWorkspacePackages()): string {
  const relPaths = packagePaths
    .map((p) => path.relative(REPO_ROOT, p).replace(/\\/g, "/"))
    .sort((a, b) => a.localeCompare(b));

  const appsAndEe = relPaths.filter((p) => p.startsWith("apps/") || p.startsWith("ee/"));
  const packages = relPaths.filter((p) => p.startsWith("packages/"));
  const languages = relPaths.filter((p) => p.startsWith("languages/"));

  const toCopyLines = (items: string[]) =>
    items.map((relPath) => `COPY ${relPath} ${path.posix.dirname(relPath)}/`).join("\n");

  return [
    "# Apps & Enterprise Edition manifests",
    toCopyLines(appsAndEe),
    "",
    "# Packages manifests",
    toCopyLines(packages),
    "",
    "# Languages manifests",
    toCopyLines(languages),
  ].join("\n");
}

export function syncDockerfileManifests(packagePaths: string[] = getWorkspacePackages()): boolean {
  const dockerfilePath = path.join(REPO_ROOT, "Dockerfile");
  if (!fs.existsSync(dockerfilePath)) return false;

  const content = fs.readFileSync(dockerfilePath, "utf-8");
  const startMarker = "# Apps & Enterprise Edition manifests";
  const endMarker = "RUN --mount=type=cache,target=/root/.npm";
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return false;

  const generatedBlock = generateDockerfileManifestCopies(packagePaths) + "\n";
  const nextContent = content.slice(0, startIdx) + generatedBlock + content.slice(endIdx);
  if (nextContent !== content) {
    fs.writeFileSync(dockerfilePath, nextContent, "utf-8");
    return true;
  }
  return false;
}

export function checkAllManifests(packagePaths: string[] = getWorkspacePackages()): {
  packageCount: number;
  version: string;
  violations: Violation[];
} {
  const allViolations: Violation[] = [];

  for (const pkgPath of packagePaths) {
    const violations = checkPackageManifest(pkgPath);
    allViolations.push(...violations);
  }

  allViolations.push(...checkCrossWorkspaceRules(packagePaths));

  const versionResult = syncVersions({ checkOnly: true });
  for (const mismatch of versionResult.mismatches) {
    allViolations.push({
      file: mismatch.split(":")[0] || "package.json",
      rule: "version-sync",
      message: `Version mismatch (${mismatch}); expected canonical version ${versionResult.version}. Run "npm run sync:versions".`,
    });
  }

  return {
    packageCount: packagePaths.length,
    version: versionResult.version,
    violations: allViolations,
  };
}

function run(): void {
  const packagePaths = getWorkspacePackages();
  const syncAll = process.argv.includes("--sync");

  if (syncAll || process.argv.includes("--sync-tiers")) {
    const updated = syncMaturityMetadata(packagePaths);
    console.log(`✓ Synchronized "modelscript" maturity metadata across ${updated} workspace manifest(s).`);
  }

  if (syncAll || process.argv.includes("--sync-dev-deps")) {
    const updatedDeps = syncSharedDevDependencies(packagePaths);
    if (updatedDeps > 0) {
      console.log(`✓ Synchronized shared devDependencies across ${updatedDeps} workspace manifest(s).`);
    }
  }

  if (syncAll || process.argv.includes("--sync-dockerfile")) {
    const updatedDockerfile = syncDockerfileManifests(packagePaths);
    if (updatedDockerfile) {
      console.log(`✓ Synchronized workspace manifest COPY lines in Dockerfile.`);
    }
  }

  const { packageCount, version, violations: allViolations } = checkAllManifests(packagePaths);

  if (allViolations.length > 0) {
    console.error(`\nFound ${allViolations.length} package manifest / README violation(s):\n`);
    for (const v of allViolations) {
      console.error(`  ${v.file}: [${v.rule}] ${v.message}`);
    }
    console.error("\nPlease correct these package.json or README.md issues before committing.\n");
    process.exit(1);
  }

  console.log(
    `✓ All ${packageCount} workspace package manifests, READMEs, Dockerfile layer copies, and version pins (${version}) conform to repository standards.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  run();
}
