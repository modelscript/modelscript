// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * scripts/consolidate-test-reports.ts
 *
 * Consolidates all Common Test Report Format (CTRF) test reports across the monorepo
 * into a single hierarchical report for GitHub CI and local development.
 *
 * Architecture:
 *   Tier 1: Core Monorepo Unit & Integration Tests (packages/*, languages/* unit tests)
 *   Tier 2: Modelica OMC Conformance Tests (Dual Backend: WASM vs JS with xfail tracking)
 *   Tier 3: Modelica Standard Library (MSL) Parity & Verification (flatten, simulate, diagram, icon)
 *
 * Usage:
 *   npx tsx scripts/consolidate-test-reports.ts [options]
 *
 * Options:
 *   --dir=<path>             Directory to search for CTRF JSON files (default: "ctrf-artifacts" or ".")
 *   --github-step-summary    Append markdown summary to $GITHUB_STEP_SUMMARY
 *   --output-json=<path>     Path to write consolidated CTRF JSON file
 *   --output-html=<path>     Path to write interactive single-file HTML dashboard
 *   --output-md=<path>       Path to write markdown summary file
 *   --check-failed           Exit with code 1 if any non-xfail test failed
 *   --silent                 Suppress stdout console table
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export interface CtrfTest {
  name: string;
  status: "passed" | "failed" | "skipped" | "pending" | "other";
  rawStatus?: string;
  duration?: number;
  cpuTime?: number;
  filePath?: string;
  suite?: string;
  type?: string;
  retries?: number;
  flaky?: boolean;
  message?: string;
  trace?: string;
  extra?: {
    backend?: string;
    xfail?: boolean | string;
    cpuMs?: number;
    peakMemoryMB?: number;
    tolerance?: number;
    rmse?: number;
    [key: string]: unknown;
  };
}

export interface CtrfReport {
  results?: {
    tool?: { name: string; version?: string };
    environment?: Record<string, unknown>;
    summary?: {
      tests: number;
      passed: number;
      failed: number;
      pending: number;
      skipped: number;
      other?: number;
      start: number;
      stop: number;
      cpuTime?: number;
    };
    tests: CtrfTest[];
  };
  report?: {
    reportFormat: "CTRF";
    results: {
      tool?: { name: string };
      summary?: any;
      tests: CtrfTest[];
    };
  };
}

export type TestTier = "unit" | "omc" | "msl";

export interface EnrichedTest extends CtrfTest {
  tier: TestTier;
  group: string;
  backend?: "wasm" | "js" | "hybrid" | "all";
  isXfail?: boolean;
}

export interface TierSummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  durationMs: number;
  groups: Map<
    string,
    {
      name: string;
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      durationMs: number;
      // Dual backend metrics for OMC
      wasmPassed?: number;
      wasmTotal?: number;
      jsPassed?: number;
      jsTotal?: number;
    }
  >;
}

// ── CLI Parsing ─────────────────────────────────────────────────────────────

interface CliOptions {
  searchDir: string;
  githubStepSummary: boolean;
  outputJson?: string;
  outputHtml?: string;
  outputMd?: string;
  checkFailed: boolean;
  silent: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    searchDir: "",
    githubStepSummary: process.argv.includes("--github-step-summary") || Boolean(process.env.GITHUB_STEP_SUMMARY),
    checkFailed: process.argv.includes("--check-failed"),
    silent: process.argv.includes("--silent"),
  };

  for (const arg of args) {
    if (arg.startsWith("--dir=")) {
      opts.searchDir = path.resolve(arg.slice(6));
    } else if (arg.startsWith("--output-json=")) {
      opts.outputJson = path.resolve(arg.slice(14));
    } else if (arg.startsWith("--output-html=")) {
      opts.outputHtml = path.resolve(arg.slice(14));
    } else if (arg.startsWith("--output-md=")) {
      opts.outputMd = path.resolve(arg.slice(12));
    }
  }

  if (!opts.searchDir) {
    const defaultArtifactsDir = path.resolve(process.cwd(), "ctrf-artifacts");
    if (fs.existsSync(defaultArtifactsDir)) {
      opts.searchDir = defaultArtifactsDir;
    } else {
      opts.searchDir = process.cwd();
    }
  }

  return opts;
}

// ── File Discovery ──────────────────────────────────────────────────────────

function findCtrfFiles(dir: string, maxDepth = 6, currentDepth = 0): string[] {
  const results: string[] = [];
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return results;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".nx" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findCtrfFiles(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        // Exclude our own consolidated output if re-running
        if (entry.name === "ctrf-consolidated.json") continue;
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore directories that cannot be read
  }

  return results;
}

// ── Tier & Group Classification ─────────────────────────────────────────────

function classifyTest(test: CtrfTest, toolName: string, filePath: string): EnrichedTest {
  const rawTool = (toolName || "").toLowerCase();
  const rawFile = (filePath || test.filePath || "").toLowerCase();
  const testName = test.name || "";
  const extra = test.extra || {};

  const isXfail = Boolean(
    test.rawStatus === "xfail" ||
    test.rawStatus === "xpass" ||
    extra.xfail === true ||
    extra.xfail === "true" ||
    (typeof extra.xfail === "string" && extra.xfail.length > 0),
  );

  // Detect backend
  let backend: "wasm" | "js" | "hybrid" | undefined;
  if (extra.backend === "wasm" || testName.includes("[wasm]") || rawTool.includes("(wasm)")) {
    backend = "wasm";
  } else if (
    extra.backend === "js" ||
    extra.backend === "ts" ||
    testName.includes("[js]") ||
    testName.includes("[ts]") ||
    rawTool.includes("(js)")
  ) {
    backend = "js";
  } else if (extra.backend === "hybrid" || testName.includes("[hybrid]")) {
    backend = "hybrid";
  }

  // 1. Tier 3: MSL Verification & Parity
  if (
    rawTool.includes("msl-verification") ||
    testName.includes("[flatten]") ||
    testName.includes("[simulate]") ||
    testName.includes("[diagram]") ||
    testName.includes("[icon]") ||
    test.suite?.toLowerCase().includes("msl")
  ) {
    let stage = "general";
    if (testName.includes("[flatten]") || rawTool.includes("flatten")) stage = "flatten (DAE)";
    else if (testName.includes("[simulate]") || rawTool.includes("simulate")) stage = "simulate (ODE/DAE)";
    else if (testName.includes("[diagram]") || rawTool.includes("diagram")) stage = "diagram (Schematic)";
    else if (testName.includes("[icon]") || rawTool.includes("icon")) stage = "icon (Visuals)";

    return {
      ...test,
      tier: "msl",
      group: stage,
      backend,
      isXfail,
    };
  }

  // 2. Tier 2: Modelica OMC Conformance Tests
  if (
    rawTool.includes("modelscript-testsuite") ||
    rawFile.includes("testsuite/openmodelica") ||
    rawFile.includes("testsuite/modelica") ||
    test.suite?.includes("algorithms-functions") ||
    test.suite?.includes("scodeinst")
  ) {
    let category = "general";
    const suiteName = test.suite || "";
    // Clean up backend tag in suite if present
    const cleanSuite = suiteName.replace(/\s*\((wasm|js|ts)\)/i, "").trim();

    if (cleanSuite) {
      category = cleanSuite;
    } else if (rawFile.includes("flattening/modelica/")) {
      const parts = rawFile.split("flattening/modelica/")[1]?.split("/");
      if (parts && parts.length > 0) category = parts[0];
    } else if (rawFile.includes("testsuite/")) {
      const parts = rawFile.split("testsuite/")[1]?.split("/");
      if (parts && parts.length > 1) category = `${parts[0]}/${parts[1]}`;
    }

    return {
      ...test,
      tier: "omc",
      group: category,
      backend: backend || "wasm",
      isXfail,
    };
  }

  // 3. Tier 1: Core Monorepo Unit & Integration Tests
  let pkgName = toolName;
  if (!pkgName || pkgName === "node-test" || pkgName === "jest") {
    // Infer from file path
    if (rawFile.includes("packages/")) {
      const parts = rawFile.split("packages/")[1]?.split("/");
      pkgName = parts ? `@modelscript/${parts[0]}` : "@modelscript/packages";
    } else if (rawFile.includes("languages/")) {
      const parts = rawFile.split("languages/")[1]?.split("/");
      pkgName = parts ? `@modelscript/${parts[0]}` : "@modelscript/languages";
    } else if (rawFile.includes("apps/")) {
      const parts = rawFile.split("apps/")[1]?.split("/");
      pkgName = parts ? `@modelscript/${parts[0]}` : "@modelscript/apps";
    } else {
      pkgName = "@modelscript/core";
    }
  }

  return {
    ...test,
    tier: "unit",
    group: pkgName,
    backend,
    isXfail,
  };
}

// ── Formatting Helpers ──────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Main Consolidation Engine ───────────────────────────────────────────────

export function consolidateReports(opts: CliOptions): {
  tests: EnrichedTest[];
  tiers: Record<TestTier, TierSummary>;
  overall: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    durationMs: number;
    hasFailure: boolean;
  };
  markdownSummary: string;
} {
  const jsonFiles = findCtrfFiles(opts.searchDir);

  const seenTestKeys = new Set<string>();
  const enrichedTests: EnrichedTest[] = [];

  for (const file of jsonFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      if (!content.includes('"tests"')) continue;
      const parsed: CtrfReport = JSON.parse(content);
      const data = parsed.results || parsed.report?.results;
      if (!data || !Array.isArray(data.tests)) continue;

      const toolName = data.tool?.name || "";

      // Deduplication: if combined report and separate wasm/js reports both exist,
      // skip combined report if individual wasm/js report files exist in the same directory.
      const dirName = path.dirname(file);
      const fileName = path.basename(file);
      if (fileName === "ctrf-testsuite-report.json") {
        const hasWasm = fs.existsSync(path.join(dirName, "ctrf-testsuite-report-wasm.json"));
        const hasJs = fs.existsSync(path.join(dirName, "ctrf-testsuite-report-js.json"));
        if (hasWasm || hasJs) continue;
      }

      for (const t of data.tests) {
        const enriched = classifyTest(t, toolName, t.filePath || file);

        // Unique identity key
        const identityKey = `${enriched.tier}::${enriched.group}::${enriched.name}::${enriched.backend || ""}`;
        if (seenTestKeys.has(identityKey)) continue;
        seenTestKeys.add(identityKey);

        enrichedTests.push(enriched);
      }
    } catch {
      // Ignore unparseable or non-CTRF JSON files
    }
  }

  // Initialize Tier Aggregators
  const tiers: Record<TestTier, TierSummary> = {
    unit: {
      name: "Core Monorepo Unit & Integration Tests",
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      durationMs: 0,
      groups: new Map(),
    },
    omc: {
      name: "Modelica OMC Conformance (Dual Engine)",
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      durationMs: 0,
      groups: new Map(),
    },
    msl: {
      name: "Modelica Standard Library (MSL) Parity & Verification",
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      durationMs: 0,
      groups: new Map(),
    },
  };

  let totalDurationMs = 0;
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalFlaky = 0;

  for (const t of enrichedTests) {
    const tier = tiers[t.tier];
    const isPassed = t.status === "passed";
    // If marked xfail, treat failure as expected (counted under skipped/xfail, not unexpected failure)
    const isFailed = t.status === "failed" && !t.isXfail;
    const isSkipped = t.status === "skipped" || t.status === "pending" || t.isXfail;
    const isFlaky = Boolean(t.flaky);
    const dur = Math.max(0, t.duration || 0);

    tier.total++;
    totalTests++;
    totalDurationMs += dur;
    tier.durationMs += dur;

    if (isPassed) {
      tier.passed++;
      totalPassed++;
    } else if (isFailed) {
      tier.failed++;
      totalFailed++;
    } else {
      tier.skipped++;
      totalSkipped++;
    }

    if (isFlaky) {
      tier.flaky++;
      totalFlaky++;
    }

    // Group-level aggregation
    let grp = tier.groups.get(t.group);
    if (!grp) {
      grp = {
        name: t.group,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 0,
        wasmPassed: 0,
        wasmTotal: 0,
        jsPassed: 0,
        jsTotal: 0,
      };
      tier.groups.set(t.group, grp);
    }

    grp.total++;
    grp.durationMs += dur;
    if (isPassed) grp.passed++;
    else if (isFailed) grp.failed++;
    else grp.skipped++;

    if (t.tier === "omc") {
      if (t.backend === "wasm") {
        grp.wasmTotal = (grp.wasmTotal || 0) + 1;
        if (isPassed) grp.wasmPassed = (grp.wasmPassed || 0) + 1;
      } else {
        grp.jsTotal = (grp.jsTotal || 0) + 1;
        if (isPassed) grp.jsPassed = (grp.jsPassed || 0) + 1;
      }
    }
  }

  const overall = {
    total: totalTests,
    passed: totalPassed,
    failed: totalFailed,
    skipped: totalSkipped,
    flaky: totalFlaky,
    durationMs: totalDurationMs,
    hasFailure: totalFailed > 0,
  };

  // ── Generate Markdown ───────────────────────────────────────────────────

  const statusBadge = overall.hasFailure ? "🔴 **FAILED**" : "🟢 **PASSED**";
  const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : "100.0";

  let md = `# 🧪 ModelScript Test Suite Summary\n\n`;
  md += `| Overall Status | Total Tests | Passed | Failed | Skipped / XFail | Flaky | Duration |\n`;
  md += `|:--------------:|:-----------:|:------:|:------:|:---------------:|:-----:|:--------:|\n`;
  md += `| ${statusBadge} | **${totalTests.toLocaleString()}** | **${totalPassed.toLocaleString()}** | **${totalFailed}** | **${totalSkipped.toLocaleString()}** | **${totalFlaky}** | **${formatDuration(totalDurationMs)}** |\n\n`;

  // Tier 1 Section
  const t1 = tiers.unit;
  md += `### 📦 Test Suite Breakdown\n\n`;
  md += `<details open>\n`;
  md += `<summary><b>1. Core Monorepo Unit & Integration Tests (${t1.passed.toLocaleString()} / ${t1.total.toLocaleString()} Passed)</b></summary>\n\n`;
  md += `| Package / Workspace | Total | Passed | Failed | Skipped | Duration | Status |\n`;
  md += `|:--------------------|:-----:|:------:|:------:|:-------:|:--------:|:------:|\n`;

  const sortedT1Groups = Array.from(t1.groups.values()).sort((a, b) => b.total - a.total);
  for (const g of sortedT1Groups) {
    const icon = g.failed > 0 ? "❌" : "✅";
    md += `| \`${g.name}\` | ${g.total} | ${g.passed} | ${g.failed} | ${g.skipped} | ${formatDuration(g.durationMs)} | ${icon} |\n`;
  }
  if (sortedT1Groups.length === 0) {
    md += `| *(No unit test results detected)* | - | - | - | - | - | ⚪ |\n`;
  }
  md += `\n</details>\n\n`;

  // Tier 2 Section (OMC Dual Engine)
  const t2 = tiers.omc;
  md += `<details open>\n`;
  md += `<summary><b>2. Modelica OMC Conformance — Dual Backend (${t2.passed.toLocaleString()} / ${t2.total.toLocaleString()} Passed)</b></summary>\n\n`;
  md += `| Category / Folder | Total Cases | WASM Engine | JS/TS Engine | Parity Rate | Status |\n`;
  md += `|:------------------|:-----------:|:-----------:|:------------:|:-----------:|:------:|\n`;

  const sortedT2Groups = Array.from(t2.groups.values()).sort((a, b) => b.total - a.total);
  for (const g of sortedT2Groups) {
    const wasmStr = g.wasmTotal ? `${g.wasmPassed} / ${g.wasmTotal}` : "—";
    const jsStr = g.jsTotal ? `${g.jsPassed} / ${g.jsTotal}` : "—";
    let parityStr = "100%";
    if (g.wasmTotal && g.jsTotal) {
      const wasmPct = g.wasmPassed! / g.wasmTotal;
      const jsPct = g.jsPassed! / g.jsTotal;
      const diff = Math.abs(wasmPct - jsPct) * 100;
      parityStr = diff < 0.1 ? "100%" : `${(100 - diff).toFixed(1)}%`;
    }
    const icon = g.failed > 0 ? "❌" : "✅";
    md += `| \`${g.name}\` | ${g.total} | ${wasmStr} | ${jsStr} | ${parityStr} | ${icon} |\n`;
  }
  if (sortedT2Groups.length === 0) {
    md += `| *(No OMC conformance results detected)* | - | - | - | - | ⚪ |\n`;
  }
  md += `\n</details>\n\n`;

  // Tier 3 Section (MSL Verification)
  const t3 = tiers.msl;
  md += `<details open>\n`;
  md += `<summary><b>3. Modelica Standard Library (MSL) Parity & Verification (${t3.passed.toLocaleString()} / ${t3.total.toLocaleString()} Passed)</b></summary>\n\n`;
  md += `| Stage / Domain | Models Tested | Passed | Failed / Diverged | Pass Rate | Status |\n`;
  md += `|:---------------|:-------------:|:------:|:-----------------:|:---------:|:------:|\n`;

  const sortedT3Groups = Array.from(t3.groups.values()).sort((a, b) => b.total - a.total);
  for (const g of sortedT3Groups) {
    const rate = g.total > 0 ? `${((g.passed / g.total) * 100).toFixed(1)}%` : "100%";
    const icon = g.failed > 0 ? "❌" : "✅";
    md += `| **${g.name}** | ${g.total} | ${g.passed} | ${g.failed} | ${rate} | ${icon} |\n`;
  }
  if (sortedT3Groups.length === 0) {
    md += `| *(No MSL benchmark runs recorded in this build)* | - | - | - | - | ⚪ |\n`;
  }
  md += `\n</details>\n\n`;

  // Failed Tests Detail Section
  const failures = enrichedTests.filter((t) => t.status === "failed" && !t.isXfail);
  if (failures.length > 0) {
    md += `### ⚠️ Failed Tests (${failures.length})\n\n`;
    md += `<details open>\n<summary><b>Click to expand failed test details</b></summary>\n\n`;
    md += `| Test Name | Tier / Package | Message |\n`;
    md += `|:----------|:---------------|:--------|\n`;
    for (const f of failures.slice(0, 50)) {
      const msg = f.message ? f.message.split("\n")[0].slice(0, 120) : "Failed without error message";
      const groupBadge = `\`${f.tier}\` · \`${f.group}\``;
      md += `| **${f.name}** | ${groupBadge} | \`${msg}\` |\n`;
    }
    if (failures.length > 50) {
      md += `\n*... and ${failures.length - 50} more failure(s) omitted from table.*`;
    }
    md += `\n</details>\n\n`;
  }

  return {
    tests: enrichedTests,
    tiers,
    overall,
    markdownSummary: md,
  };
}

// ── Interactive HTML Dashboard Generator ────────────────────────────────────

function generateHtmlDashboard(
  tests: EnrichedTest[],
  tiers: Record<TestTier, TierSummary>,
  overall: { total: number; passed: number; failed: number; skipped: number; durationMs: number },
  outputPath: string,
): void {
  const passRate = overall.total > 0 ? ((overall.passed / overall.total) * 100).toFixed(1) : "100.0";
  const durSec = (overall.durationMs / 1000).toFixed(1);

  // Group tests by Tier -> Group for HTML display
  const tierCards = [
    {
      id: "unit",
      title: "Core Monorepo Units",
      tier: tiers.unit,
      accent: "#388bfd",
    },
    {
      id: "omc",
      title: "OMC Conformance (Dual Engine)",
      tier: tiers.omc,
      accent: "#bc8cff",
    },
    {
      id: "msl",
      title: "MSL Parity & Benchmarks",
      tier: tiers.msl,
      accent: "#3fb950",
    },
  ];

  let testRowsHtml = "";
  for (const t of tests) {
    const isPassed = t.status === "passed";
    const isFailed = t.status === "failed" && !t.isXfail;
    const statusClass = isPassed ? "pass" : isFailed ? "fail" : "skip";
    const statusLabel = isPassed ? "PASSED" : isFailed ? "FAILED" : t.isXfail ? "XFAIL" : "SKIPPED";
    const backendAttr = t.backend || "all";
    const durationStr = formatDuration(t.duration || 0);

    const messagePre =
      t.message || t.trace
        ? `<pre class="err-pre">${escapeHtml(t.message || "")}\n${escapeHtml(t.trace || "")}</pre>`
        : "";

    testRowsHtml += `
    <tr class="test-row ${statusClass}" data-tier="${t.tier}" data-status="${statusClass}" data-backend="${backendAttr}" data-name="${escapeHtml(t.name.toLowerCase())}" data-group="${escapeHtml(t.group.toLowerCase())}">
      <td class="status-cell"><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td class="name-cell">
        <div class="test-title">${escapeHtml(t.name)}</div>
        <div class="test-meta"><code>${escapeHtml(t.group)}</code> · <span class="tier-tag">${t.tier.toUpperCase()}</span> ${t.backend ? `· <span class="be-tag">${t.backend.toUpperCase()}</span>` : ""} ${t.filePath ? `· <span class="file-path">${escapeHtml(t.filePath)}</span>` : ""}</div>
        ${messagePre}
      </td>
      <td class="dur-cell">${durationStr}</td>
    </tr>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ModelScript Consolidated Test Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 24px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #30363d;
    }
    .title-area h1 { font-size: 1.8rem; color: #f0f6fc; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .title-area p { color: #8b949e; font-size: 0.85rem; margin-top: 4px; }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }
    .kpi-card .val { font-size: 1.8rem; font-weight: 700; }
    .kpi-card .lbl { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
    .kpi-card.total .val { color: #58a6ff; }
    .kpi-card.pass .val { color: #3fb950; }
    .kpi-card.fail .val { color: #f85149; }
    .kpi-card.skip .val { color: #d29922; }
    .kpi-card.dur .val { color: #79c0ff; font-size: 1.4rem; }
    .kpi-card.rate .val { color: #bc8cff; }

    .tiers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .tier-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
    }
    .tier-box h3 { font-size: 1rem; color: #f0f6fc; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .tier-box .pct-pill { font-size: 0.8rem; padding: 2px 8px; border-radius: 10px; background: rgba(56,139,253,0.15); color: #58a6ff; }
    .tier-stat-line { display: flex; justify-content: space-between; font-size: 0.85rem; color: #8b949e; margin-bottom: 6px; }

    .filter-panel {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .search-input {
      background: #0d1117;
      border: 1px solid #30363d;
      color: #f0f6fc;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.9rem;
      min-width: 240px;
      flex: 1;
    }
    .search-input:focus { outline: none; border-color: #58a6ff; }
    .pill-group { display: flex; gap: 6px; align-items: center; }
    .pill-lbl { font-size: 0.8rem; color: #8b949e; font-weight: 600; margin-right: 2px; }
    .pill {
      background: rgba(255,255,255,0.06);
      border: 1px solid #30363d;
      border-radius: 14px;
      padding: 4px 12px;
      font-size: 0.8rem;
      color: #c9d1d9;
      cursor: pointer;
      transition: all 0.15s;
    }
    .pill:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .pill.active { background: #388bfd; color: #fff; border-color: transparent; }

    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
    th { text-align: left; padding: 10px 14px; background: #21262d; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #30363d; }
    td { padding: 10px 14px; border-bottom: 1px solid #21262d; font-size: 0.88rem; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr.fail { background: rgba(248,81,73,0.06); }
    .status-cell { width: 100px; }
    .dur-cell { width: 90px; text-align: right; color: #8b949e; font-family: monospace; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .badge.pass { background: #0d3320; color: #3fb950; border: 1px solid rgba(63,185,80,0.3); }
    .badge.fail { background: #3d1214; color: #f85149; border: 1px solid rgba(248,81,73,0.3); }
    .badge.skip { background: #3d2e00; color: #d29922; border: 1px solid rgba(210,153,34,0.3); }

    .test-title { font-weight: 600; color: #f0f6fc; }
    .test-meta { font-size: 0.75rem; color: #8b949e; margin-top: 2px; }
    .tier-tag { color: #58a6ff; font-weight: 600; }
    .be-tag { color: #bc8cff; font-weight: 600; }
    .err-pre {
      margin-top: 8px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 0.78rem;
      color: #f85149;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 250px;
      overflow-y: auto;
    }
    .footer { text-align: center; color: #484f58; font-size: 0.8rem; margin-top: 32px; }
  </style>
  <script>
    const filterState = {
      search: "",
      tier: "all",
      status: "all",
      backend: "all"
    };

    function setPill(type, value, btn) {
      filterState[type] = value;
      const group = btn.parentElement;
      group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    }

    function onSearchInput(input) {
      filterState.search = input.value.trim().toLowerCase();
      applyFilters();
    }

    function applyFilters() {
      const rows = document.querySelectorAll('tbody tr.test-row');
      let visibleCount = 0;

      rows.forEach(row => {
        const tier = row.getAttribute('data-tier') || '';
        const status = row.getAttribute('data-status') || '';
        const backend = row.getAttribute('data-backend') || '';
        const name = row.getAttribute('data-name') || '';
        const group = row.getAttribute('data-group') || '';

        const matchTier = filterState.tier === 'all' || tier === filterState.tier;
        const matchStatus = filterState.status === 'all' || status === filterState.status;
        const matchBackend = filterState.backend === 'all' || backend === filterState.backend || (filterState.backend === 'js' && backend === 'ts');
        const matchSearch = !filterState.search || name.includes(filterState.search) || group.includes(filterState.search);

        if (matchTier && matchStatus && matchBackend && matchSearch) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      const countDisplay = document.getElementById('visible-count');
      if (countDisplay) countDisplay.textContent = visibleCount.toLocaleString();
    }
  </script>
</head>
<body>
  <div class="header">
    <div class="title-area">
      <h1>🧪 ModelScript Test Report</h1>
      <p>Hierarchical Verification Dashboard · Generated ${new Date().toISOString()}</p>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-card total"><div class="val">${overall.total.toLocaleString()}</div><div class="lbl">Total Tests</div></div>
    <div class="kpi-card pass"><div class="val">${overall.passed.toLocaleString()}</div><div class="lbl">Passed</div></div>
    <div class="kpi-card fail"><div class="val">${overall.failed.toLocaleString()}</div><div class="lbl">Failed</div></div>
    <div class="kpi-card skip"><div class="val">${overall.skipped.toLocaleString()}</div><div class="lbl">Skipped / XFail</div></div>
    <div class="kpi-card rate"><div class="val">${passRate}%</div><div class="lbl">Pass Rate</div></div>
    <div class="kpi-card dur"><div class="val">${durSec}s</div><div class="lbl">Duration</div></div>
  </div>

  <div class="tiers-grid">
    ${tierCards
      .map(
        (c) => `
      <div class="tier-box" style="border-top: 3px solid ${c.accent};">
        <h3>${c.title} <span class="pct-pill">${c.tier.total > 0 ? ((c.tier.passed / c.tier.total) * 100).toFixed(1) : 100}%</span></h3>
        <div class="tier-stat-line"><span>Passed:</span><strong style="color:#3fb950">${c.tier.passed.toLocaleString()} / ${c.tier.total.toLocaleString()}</strong></div>
        <div class="tier-stat-line"><span>Failed:</span><strong style="color:${c.tier.failed > 0 ? "#f85149" : "#8b949e"}">${c.tier.failed}</strong></div>
        <div class="tier-stat-line"><span>Skipped/XFail:</span><span>${c.tier.skipped.toLocaleString()}</span></div>
        <div class="tier-stat-line"><span>Duration:</span><span>${formatDuration(c.tier.durationMs)}</span></div>
      </div>`,
      )
      .join("")}
  </div>

  <div class="filter-panel">
    <input type="text" class="search-input" placeholder="Search tests, suites, or packages..." oninput="onSearchInput(this)" />

    <div class="pill-group">
      <span class="pill-lbl">Tier:</span>
      <button class="pill active" onclick="setPill('tier', 'all', this)">All</button>
      <button class="pill" onclick="setPill('tier', 'unit', this)">Units</button>
      <button class="pill" onclick="setPill('tier', 'omc', this)">OMC</button>
      <button class="pill" onclick="setPill('tier', 'msl', this)">MSL</button>
    </div>

    <div class="pill-group">
      <span class="pill-lbl">Status:</span>
      <button class="pill active" onclick="setPill('status', 'all', this)">All</button>
      <button class="pill" onclick="setPill('status', 'pass', this)">Passed</button>
      <button class="pill" onclick="setPill('status', 'fail', this)">Failed</button>
      <button class="pill" onclick="setPill('status', 'skip', this)">Skipped</button>
    </div>

    <div class="pill-group">
      <span class="pill-lbl">Backend:</span>
      <button class="pill active" onclick="setPill('backend', 'all', this)">All</button>
      <button class="pill" onclick="setPill('backend', 'wasm', this)">WASM</button>
      <button class="pill" onclick="setPill('backend', 'js', this)">JS</button>
    </div>

    <div style="font-size:0.8rem; color:#8b949e; margin-left:auto;">
      Showing <strong id="visible-count" style="color:#f0f6fc">${overall.total.toLocaleString()}</strong> of ${overall.total.toLocaleString()}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="status-cell">Status</th>
        <th>Test Case & Diagnostics</th>
        <th class="dur-cell">Duration</th>
      </tr>
    </thead>
    <tbody>
      ${testRowsHtml}
    </tbody>
  </table>

  <div class="footer">
    ModelScript Compiler & Verification Pipeline · Generated with CTRF Consolidated Reporter
  </div>
</body>
</html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf-8");
  const kb = (Buffer.byteLength(html, "utf-8") / 1024).toFixed(1);
  console.log(`[consolidate-test-reports] Wrote unified HTML report to: ${outputPath} (${kb} KB)`);
}

// ── Entry Point ─────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs();

  const { tests, tiers, overall, markdownSummary } = consolidateReports(opts);

  // Print to console unless silent
  if (!opts.silent) {
    console.log(markdownSummary);
  }

  // Write to GitHub Step Summary if running in GitHub Actions
  if (opts.githubStepSummary && process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary + "\n", "utf-8");
      console.log(`[consolidate-test-reports] Appended test summary to $GITHUB_STEP_SUMMARY`);
    } catch (err) {
      console.error("[consolidate-test-reports] Failed to write to GITHUB_STEP_SUMMARY:", err);
    }
  }

  // Write markdown file if requested
  if (opts.outputMd) {
    try {
      fs.mkdirSync(path.dirname(opts.outputMd), { recursive: true });
      fs.writeFileSync(opts.outputMd, markdownSummary, "utf-8");
      console.log(`[consolidate-test-reports] Wrote markdown summary to: ${opts.outputMd}`);
    } catch (err) {
      console.error("[consolidate-test-reports] Failed to write markdown summary file:", err);
    }
  }

  // Write consolidated CTRF JSON report
  if (opts.outputJson) {
    try {
      const consolidatedReport = {
        results: {
          tool: {
            name: "modelscript-consolidated-suite",
            version: "1.0.0",
          },
          summary: {
            tests: overall.total,
            passed: overall.passed,
            failed: overall.failed,
            skipped: overall.skipped,
            pending: 0,
            other: 0,
            start: Date.now() - overall.durationMs,
            stop: Date.now(),
          },
          tests: tests.map((t) => ({
            name: t.name,
            status: t.status,
            rawStatus: t.rawStatus,
            duration: t.duration || 0,
            filePath: t.filePath,
            suite: `${t.tier.toUpperCase()} > ${t.group}`,
            extra: {
              tier: t.tier,
              group: t.group,
              backend: t.backend,
              ...(t.extra || {}),
            },
            ...(t.message ? { message: t.message } : {}),
            ...(t.trace ? { trace: t.trace } : {}),
          })),
        },
      };

      fs.mkdirSync(path.dirname(opts.outputJson), { recursive: true });
      fs.writeFileSync(opts.outputJson, JSON.stringify(consolidatedReport, null, 2), "utf-8");
      console.log(`[consolidate-test-reports] Wrote consolidated CTRF JSON to: ${opts.outputJson}`);
    } catch (err) {
      console.error("[consolidate-test-reports] Failed to write consolidated CTRF JSON:", err);
    }
  }

  // Write interactive HTML dashboard
  if (opts.outputHtml) {
    try {
      generateHtmlDashboard(tests, tiers, overall, opts.outputHtml);
    } catch (err) {
      console.error("[consolidate-test-reports] Failed to write HTML report:", err);
    }
  }

  if (opts.checkFailed && overall.hasFailure) {
    console.error(`\n[consolidate-test-reports] Check failed: ${overall.failed} unexpected test failure(s) found.`);
    process.exit(1);
  }
}

main();
