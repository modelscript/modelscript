// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * scripts/consolidate-coverage.ts
 *
 * Consolidates all LCOV coverage reports (*lcov*.info) across the monorepo
 * into a single unified report for GitHub CI and local development.
 *
 * Features:
 *   - Automatic package discovery across packages/*, languages/*, apps/*
 *   - Path normalization to ensure all source paths are repo-relative
 *   - Metrics aggregation: Lines, Branches, Functions (hit / total / percentage)
 *   - Unified LCOV output (lcov-consolidated.info) for Codecov / IDE extensions
 *   - Formatted console table & GitHub Actions Step Summary ($GITHUB_STEP_SUMMARY)
 *   - Zero external dependencies
 *
 * Usage:
 *   npx tsx scripts/consolidate-coverage.ts [options]
 *
 * Options:
 *   --dir=<path>             Base directory or directory of coverage artifacts (default: repo root)
 *   --github-step-summary    Append markdown summary table to $GITHUB_STEP_SUMMARY
 *   --output-lcov=<path>     Path to write consolidated LCOV file (default: "coverage/lcov-consolidated.info")
 *   --output-json=<path>     Path to write coverage summary JSON (default: "coverage/coverage-summary.json")
 *   --output-md=<path>       Path to write markdown summary
 *   --threshold=<pct>        Minimum overall line coverage percentage (fails with exit code 1 if below)
 *   --silent                 Suppress stdout console table
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

interface FileCoverage {
  sourceFile: string;
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
  functionsFound: number;
  functionsHit: number;
  rawRecords: string[];
}

interface PackageCoverage {
  packageName: string;
  projectPath: string;
  files: Map<string, FileCoverage>;
  totalLF: number;
  totalLH: number;
  totalBF: number;
  totalBH: number;
  totalFF: number;
  totalFH: number;
}

interface CliOptions {
  searchDir: string;
  githubStepSummary: boolean;
  outputLcov?: string;
  outputJson?: string;
  outputMd?: string;
  threshold?: number;
  silent: boolean;
}

function parseCliArgs(): CliOptions {
  const options: CliOptions = {
    searchDir: process.cwd(),
    githubStepSummary: false,
    silent: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--github-step-summary") {
      options.githubStepSummary = true;
    } else if (arg === "--silent") {
      options.silent = true;
    } else if (arg.startsWith("--dir=")) {
      options.searchDir = path.resolve(arg.slice(6));
    } else if (arg.startsWith("--output-lcov=")) {
      options.outputLcov = path.resolve(arg.slice(14));
    } else if (arg.startsWith("--output-json=")) {
      options.outputJson = path.resolve(arg.slice(14));
    } else if (arg.startsWith("--output-md=")) {
      options.outputMd = path.resolve(arg.slice(12));
    } else if (arg.startsWith("--threshold=")) {
      options.threshold = parseFloat(arg.slice(12));
    }
  }

  return options;
}

/**
 * Recursively find all lcov.info or *lcov*.info files.
 */
function findLcovFiles(dir: string, baseDir: string = dir): { filePath: string; relativeDir: string }[] {
  const results: { filePath: string; relativeDir: string }[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".nx" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        fullPath === path.join(baseDir, "coverage")
      ) {
        continue;
      }
      results.push(...findLcovFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if ((lower === "lcov.info" || lower.endsWith(".lcov") || lower.includes("lcov")) && !lower.endsWith(".json")) {
        const relativeDir = path.dirname(path.relative(baseDir, fullPath));
        results.push({ filePath: fullPath, relativeDir });
      }
    }
  }

  return results;
}

/**
 * Determine project root package name and base path.
 */
function resolveProjectInfo(filePath: string, repoRoot: string): { packageName: string; projectRelDir: string } {
  let curr = path.dirname(filePath);
  while (curr !== repoRoot && curr !== path.dirname(curr)) {
    const pkgJsonPath = path.join(curr, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const relDir = path.relative(repoRoot, curr);
        return {
          packageName: pkg.name || relDir,
          projectRelDir: relDir,
        };
      } catch (err) {
        void err;
      }
    }
    curr = path.dirname(curr);
  }

  const fallbackRel = path.relative(repoRoot, path.dirname(filePath));
  return { packageName: fallbackRel || "root", projectRelDir: fallbackRel };
}

/**
 * Parse a single LCOV file into structured coverage records.
 */
function parseLcovContent(content: string, projectRelDir: string, repoRoot: string): FileCoverage[] {
  const lines = content.split(/\r?\n/);
  const files: FileCoverage[] = [];

  let currentFile: FileCoverage | null = null;
  let rawLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("SF:")) {
      const origPath = trimmed.slice(3).trim();
      let normalizedPath: string;

      if (path.isAbsolute(origPath)) {
        normalizedPath = path.relative(repoRoot, origPath);
      } else {
        if (origPath.startsWith(projectRelDir) || origPath.startsWith("./" + projectRelDir)) {
          normalizedPath = origPath.replace(/^\.\//, "");
        } else {
          normalizedPath = path.join(projectRelDir, origPath);
        }
      }

      currentFile = {
        sourceFile: normalizedPath,
        linesFound: 0,
        linesHit: 0,
        branchesFound: 0,
        branchesHit: 0,
        functionsFound: 0,
        functionsHit: 0,
        rawRecords: [],
      };
      rawLines = [`SF:${normalizedPath}`];
    } else if (trimmed === "end_of_record") {
      if (currentFile) {
        rawLines.push("end_of_record");
        currentFile.rawRecords = rawLines;
        files.push(currentFile);
        currentFile = null;
        rawLines = [];
      }
    } else if (currentFile) {
      rawLines.push(trimmed);
      if (trimmed.startsWith("LF:")) {
        currentFile.linesFound = parseInt(trimmed.slice(3), 10) || 0;
      } else if (trimmed.startsWith("LH:")) {
        currentFile.linesHit = parseInt(trimmed.slice(3), 10) || 0;
      } else if (trimmed.startsWith("BRF:")) {
        currentFile.branchesFound = parseInt(trimmed.slice(4), 10) || 0;
      } else if (trimmed.startsWith("BRH:")) {
        currentFile.branchesHit = parseInt(trimmed.slice(4), 10) || 0;
      } else if (trimmed.startsWith("FNF:")) {
        currentFile.functionsFound = parseInt(trimmed.slice(4), 10) || 0;
      } else if (trimmed.startsWith("FNH:")) {
        currentFile.functionsHit = parseInt(trimmed.slice(4), 10) || 0;
      }
    }
  }

  return files;
}

function pct(hit: number, total: number): string {
  if (total === 0) return "100.0%";
  return ((hit / total) * 100).toFixed(1) + "%";
}

function pctNum(hit: number, total: number): number {
  if (total === 0) return 100.0;
  return parseFloat(((hit / total) * 100).toFixed(2));
}

function getBadge(percentage: number): string {
  if (percentage >= 80) return "🟢";
  if (percentage >= 50) return "🟡";
  return "🔴";
}

export function main() {
  const options = parseCliArgs();
  const repoRoot = process.cwd();

  const lcovFiles = findLcovFiles(options.searchDir, repoRoot);

  if (lcovFiles.length === 0) {
    if (!options.silent) {
      console.log(`[consolidate-coverage] No LCOV files found in ${options.searchDir}.`);
    }
    return;
  }

  const packageMap = new Map<string, PackageCoverage>();
  const allMergedRecords: string[] = [];

  for (const { filePath } of lcovFiles) {
    const { packageName, projectRelDir } = resolveProjectInfo(filePath, repoRoot);

    if (!packageMap.has(packageName)) {
      packageMap.set(packageName, {
        packageName,
        projectPath: projectRelDir,
        files: new Map(),
        totalLF: 0,
        totalLH: 0,
        totalBF: 0,
        totalBH: 0,
        totalFF: 0,
        totalFH: 0,
      });
    }

    const pkgCov = packageMap.get(packageName)!;
    const content = fs.readFileSync(filePath, "utf-8");
    const parsedFiles = parseLcovContent(content, projectRelDir, repoRoot);

    for (const file of parsedFiles) {
      pkgCov.files.set(file.sourceFile, file);
      allMergedRecords.push(...file.rawRecords);
    }
  }

  // Aggregate totals
  let grandTotalLF = 0;
  let grandTotalLH = 0;
  let grandTotalBF = 0;
  let grandTotalBH = 0;
  let grandTotalFF = 0;
  let grandTotalFH = 0;

  for (const pkg of packageMap.values()) {
    for (const file of pkg.files.values()) {
      pkg.totalLF += file.linesFound;
      pkg.totalLH += file.linesHit;
      pkg.totalBF += file.branchesFound;
      pkg.totalBH += file.branchesHit;
      pkg.totalFF += file.functionsFound;
      pkg.totalFH += file.functionsHit;
    }
    grandTotalLF += pkg.totalLF;
    grandTotalLH += pkg.totalLH;
    grandTotalBF += pkg.totalBF;
    grandTotalBH += pkg.totalBH;
    grandTotalFF += pkg.totalFF;
    grandTotalFH += pkg.totalFH;
  }

  const overallLinePct = pctNum(grandTotalLH, grandTotalLF);
  const overallBranchPct = pctNum(grandTotalBH, grandTotalBF);
  const overallFuncPct = pctNum(grandTotalFH, grandTotalFF);

  // Generate Markdown Summary
  let md = `## 📊 Test Code Coverage Summary\n\n`;
  md +=
    `**Overall Coverage**: ${getBadge(overallLinePct)} **${overallLinePct.toFixed(1)}% Lines** (${grandTotalLH}/${grandTotalLF}) | ` +
    `**${overallBranchPct.toFixed(1)}% Branches** (${grandTotalBH}/${grandTotalBF}) | ` +
    `**${overallFuncPct.toFixed(1)}% Functions** (${grandTotalFH}/${grandTotalFF})\n\n`;

  md += `| Package | Lines | Line % | Branches | Branch % | Functions | Func % |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

  const sortedPackages = Array.from(packageMap.values()).sort((a, b) => a.packageName.localeCompare(b.packageName));

  for (const pkg of sortedPackages) {
    const lPct = pctNum(pkg.totalLH, pkg.totalLF);
    const bPct = pctNum(pkg.totalBH, pkg.totalBF);
    const fPct = pctNum(pkg.totalFH, pkg.totalFF);
    md +=
      `| \`${pkg.packageName}\` | ${pkg.totalLH}/${pkg.totalLF} | ${getBadge(lPct)} ${lPct.toFixed(1)}% | ` +
      `${pkg.totalBH}/${pkg.totalBF} | ${bPct.toFixed(1)}% | ` +
      `${pkg.totalFH}/${pkg.totalFF} | ${fPct.toFixed(1)}% |\n`;
  }

  // Write outputs
  const outputLcovPath = options.outputLcov || path.join(repoRoot, "coverage", "lcov-consolidated.info");
  fs.mkdirSync(path.dirname(outputLcovPath), { recursive: true });
  fs.writeFileSync(outputLcovPath, allMergedRecords.join("\n") + "\n", "utf-8");

  const summaryJson = {
    summary: {
      lines: { total: grandTotalLF, hit: grandTotalLH, percentage: overallLinePct },
      branches: { total: grandTotalBF, hit: grandTotalBH, percentage: overallBranchPct },
      functions: { total: grandTotalFF, hit: grandTotalFH, percentage: overallFuncPct },
    },
    packages: sortedPackages.map((pkg) => ({
      name: pkg.packageName,
      path: pkg.projectPath,
      lines: { total: pkg.totalLF, hit: pkg.totalLH, percentage: pctNum(pkg.totalLH, pkg.totalLF) },
      branches: { total: pkg.totalBF, hit: pkg.totalBH, percentage: pctNum(pkg.totalBH, pkg.totalBF) },
      functions: { total: pkg.totalFF, hit: pkg.totalFH, percentage: pctNum(pkg.totalFH, pkg.totalFF) },
      filesCount: pkg.files.size,
    })),
  };

  const outputJsonPath = options.outputJson || path.join(repoRoot, "coverage", "coverage-summary.json");
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, JSON.stringify(summaryJson, null, 2), "utf-8");

  if (options.outputMd) {
    fs.mkdirSync(path.dirname(options.outputMd), { recursive: true });
    fs.writeFileSync(options.outputMd, md, "utf-8");
  }

  if (options.githubStepSummary && process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "\n" + md + "\n", "utf-8");
    } catch (err) {
      console.error("[consolidate-coverage] Failed to write to GITHUB_STEP_SUMMARY:", err);
    }
  }

  // Console output
  if (!options.silent) {
    console.log("\n=======================================================");
    console.log("             TEST CODE COVERAGE SUMMARY                ");
    console.log("=======================================================");
    console.log(`Overall Lines:     ${grandTotalLH}/${grandTotalLF} (${overallLinePct.toFixed(1)}%)`);
    console.log(`Overall Branches:  ${grandTotalBH}/${grandTotalBF} (${overallBranchPct.toFixed(1)}%)`);
    console.log(`Overall Functions: ${grandTotalFH}/${grandTotalFF} (${overallFuncPct.toFixed(1)}%)`);
    console.log("-------------------------------------------------------");
    console.log("Package Breakdown:");
    for (const pkg of sortedPackages) {
      const lPct = pct(pkg.totalLH, pkg.totalLF);
      console.log(`  ${pkg.packageName.padEnd(28)} Lines: ${lPct.padStart(6)} (${pkg.totalLH}/${pkg.totalLF})`);
    }
    console.log("=======================================================");
    console.log(`Consolidated LCOV written to: ${path.relative(repoRoot, outputLcovPath)}`);
    console.log(`Coverage Summary JSON:       ${path.relative(repoRoot, outputJsonPath)}\n`);
  }

  if (options.threshold !== undefined && overallLinePct < options.threshold) {
    console.error(
      `[consolidate-coverage] Line coverage ${overallLinePct.toFixed(1)}% is below required threshold ${options.threshold}%!`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
