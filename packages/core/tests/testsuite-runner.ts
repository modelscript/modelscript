// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parallel test runner for OpenModelica-style .mo test files.
 *
 * Spawns child processes (testsuite-worker.ts) to run each test case in
 * isolation. This provides:
 *   - Full memory reclamation per test (no cross-test leaks / OOM)
 *   - Parallel execution across CPU cores
 *   - Arena-native flattening pipeline (no legacy ModelicaDAE)
 *
 * Usage:
 *   npx tsx tests/testsuite-runner.ts [testsuite-subdirectory ...]
 *
 * Examples:
 *   npx tsx tests/testsuite-runner.ts extends
 *   npx tsx tests/testsuite-runner.ts extends modification
 *
 * Options:
 *   --update      Rewrite expected output in .mo files to match actual
 *   --concurrency=N  Number of parallel workers (default: CPU count / 2)
 *   --legacy      Use legacy in-process flattener (flattenDAE) instead of arena
 *
 * If no arguments are given, all subdirectories under testsuite/ are run.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateHtmlReport } from "./ctrf-to-html.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface TestCaseMetadata {
  name: string;
  keywords: string;
  status: "correct" | "incorrect" | "skipped";
  description: string;
  arrayMode?: "scalarize" | "preserve";
  fmiVersion?: "2.0" | "3.0";
  simulate?: boolean;
}

interface TestCase {
  file: string;
  metadata: TestCaseMetadata;
  source: string;
  expectedResult: string;
  expectedSimulationResult?: string;
}

interface TestResult {
  name: string;
  file: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  cpuTime: number;
  message?: string;
  keywords?: string;
  testStatus?: string;
}

interface CtrfReport {
  results: {
    tool: { name: string };
    summary: {
      tests: number;
      passed: number;
      failed: number;
      pending: number;
      skipped: number;
      other: number;
      start: number;
      stop: number;
      cpuTime: number;
    };
    tests: {
      name: string;
      duration: number;
      cpuTime: number;
      status: "passed" | "failed" | "skipped" | "pending";
      rawStatus: string;
      type: string;
      filePath: string;
      retries: number;
      flaky: boolean;
      suite: string;
      message?: string;
      keywords?: string;
      testStatus?: string;
    }[];
  };
}

// ── .mo file parser ──────────────────────────────────────────────────────────

function parseTestFile(filePath: string): TestCase | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Parse metadata from header comments
  let name = "";
  let keywords = "";
  let status = "";
  const descriptionLines: string[] = [];

  for (const line of lines) {
    const nameMatch = line.match(/^\/\/\s*name:\s*(.+)/);
    if (nameMatch) {
      name = (nameMatch[1] ?? "").trim();
      continue;
    }

    const keywordsMatch = line.match(/^\/\/\s*keywords:\s*(.+)/);
    if (keywordsMatch) {
      keywords = (keywordsMatch[1] ?? "").trim();
      continue;
    }

    const statusMatch = line.match(/^\/\/\s*status:\s*(.+)/);
    if (statusMatch) {
      status = (statusMatch[1] ?? "").trim();
      continue;
    }

    // Description: comment lines after status, until first non-comment or blank
    if (status && line.startsWith("//")) {
      const descText = line.replace(/^\/\/\s?/, "").trim();
      if (descText) descriptionLines.push(descText);
      continue;
    }

    if (status && !line.startsWith("//")) {
      break;
    }
  }

  // Fall back to filename stem if no name header
  if (!name) name = path.basename(filePath, ".mo");
  if (!status) status = "correct";

  let arrayMode: "scalarize" | "preserve" | undefined = undefined;
  let fmiVersion: "2.0" | "3.0" | undefined = undefined;
  let simulate = false;
  for (const line of lines) {
    const amMatch = line.match(/^\/\/\s*arrayMode:\s*(preserve|scalarize)/);
    if (amMatch && amMatch[1]) arrayMode = amMatch[1] as "preserve" | "scalarize";
    const fmiMatch = line.match(/^\/\/\s*fmiVersion:\s*(2\.0|3\.0)/);
    if (fmiMatch && fmiMatch[1]) fmiVersion = fmiMatch[1] as "2.0" | "3.0";
    const simMatch = line.match(/^\/\/\s*simulate:\s*(true|false)/);
    if (simMatch && simMatch[1] === "true") simulate = true;
  }

  // Find the Result: / endResult block
  const resultStartIdx = lines.findIndex((l) => /^\/\/\s*Result:/.test(l));
  const resultEndIdx = lines.findIndex((l) => /^\/\/\s*endResult/.test(l));

  // Extract source: full file content up to Result: marker (preserves tree-sitter positions)
  const sourceEnd = resultStartIdx >= 0 ? resultStartIdx : lines.length;
  const source = lines.slice(0, sourceEnd).join("\n").trim();

  // Extract expected result (strip leading "// ")
  let expectedResult = "";
  if (resultStartIdx >= 0 && resultEndIdx > resultStartIdx) {
    expectedResult = lines
      .slice(resultStartIdx + 1, resultEndIdx)
      .map((l) => l.replace(/^\/\/\s?/, ""))
      .join("\n")
      .trim();
  }

  // Find the Simulation Result: / endSimulationResult block
  const simResultStartIdx = lines.findIndex((l) => /^\/\/\s*Simulation Result:/.test(l));
  const simResultEndIdx = lines.findIndex((l) => /^\/\/\s*endSimulationResult/.test(l));

  let expectedSimulationResult: string | undefined = undefined;
  if (simResultStartIdx >= 0 && simResultEndIdx > simResultStartIdx) {
    expectedSimulationResult = lines
      .slice(simResultStartIdx + 1, simResultEndIdx)
      .map((l) => l.replace(/^\/\/\s?/, ""))
      .join("\n")
      .trim();
  }

  return {
    file: filePath,
    metadata: {
      name,
      keywords,
      status: status === "incorrect" ? "incorrect" : status === "skipped" ? "skipped" : "correct",
      description: descriptionLines.join(" "),
      ...(arrayMode ? { arrayMode } : {}),
      ...(fmiVersion ? { fmiVersion } : {}),
      simulate,
    },
    source,
    expectedResult,
    ...(expectedSimulationResult !== undefined ? { expectedSimulationResult } : {}),
  };
}

// ── Worker spawning ──────────────────────────────────────────────────────────

const WORKER_SCRIPT = path.resolve(import.meta.dirname ?? __dirname, "testsuite-worker.ts");
const WORKER_TIMEOUT_MS = 120_000; // 2 minutes per test

function runTestInWorker(
  testCase: TestCase,
  testsuiteRoot: string,
  updateMode: boolean,
  omcMode = false,
): Promise<TestResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("npx", ["tsx", WORKER_SCRIPT], {
      cwd: path.resolve(import.meta.dirname ?? __dirname, ".."),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_OPTIONS: "--max-old-space-size=8192",
      },
    });

    // Send test case to worker via stdin
    const payload = JSON.stringify({ testCase, testsuiteRoot, updateMode, omcMode });
    child.stdin.write(payload);
    child.stdin.end();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, WORKER_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      const duration = Date.now() - start;

      // Try to parse the JSON result from stdout
      try {
        const lines = stdout.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          const result: TestResult = JSON.parse(lastLine);
          // Adjust duration to include spawn overhead
          result.duration = duration;
          resolve(result);
          return;
        }
      } catch {
        // Fall through to error handling
      }

      // Worker failed to produce valid output
      const isTimeout = code === null;
      const message = isTimeout
        ? `Worker timed out after ${WORKER_TIMEOUT_MS / 1000}s`
        : `Worker exited with code ${code}\n${stderr.slice(-2000)}`;

      resolve({
        name: path.basename(testCase.file),
        file: testCase.file,
        status: "failed",
        duration,
        cpuTime: 0,
        message,
        keywords: testCase.metadata.keywords,
        testStatus: testCase.metadata.status,
      });
    });
  });
}

// ── Console output ───────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function printResult(result: TestResult): void {
  const icon =
    result.status === "passed"
      ? `${GREEN}✓${RESET}`
      : result.status === "skipped"
        ? `${YELLOW}○${RESET}`
        : `${RED}✗${RESET}`;

  const duration = `${DIM}(${result.duration.toFixed(0)}ms, cpu ${result.cpuTime.toFixed(0)}ms)${RESET}`;
  console.log(`  ${icon} ${result.name} ${duration}`);

  if (result.message) {
    const indented = result.message
      .split("\n")
      .map((l) => `      ${l}`)
      .join("\n");
    console.log(indented);
  }
}

function printSummary(results: TestResult[], suiteLabel: string): void {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const total = results.length;

  console.log();
  console.log(`${BOLD}${suiteLabel}${RESET}`);
  console.log(
    `  Tests: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${YELLOW}${skipped} skipped${RESET}, ${total} total`,
  );
}

// ── CTRF reporter ────────────────────────────────────────────────────────────

function generateCtrfReport(results: TestResult[], startTime: number, stopTime: number): CtrfReport {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return {
    results: {
      tool: { name: "modelscript-testsuite" },
      summary: {
        tests: results.length,
        passed,
        failed,
        pending: skipped,
        skipped: 0,
        other: 0,
        start: Math.floor(startTime),
        stop: Math.floor(stopTime),
        cpuTime: Math.floor(results.reduce((sum, r) => sum + r.cpuTime, 0)),
      },
      tests: results.map((r) => ({
        name: r.name,
        duration: Math.floor(r.duration),
        cpuTime: Math.floor(r.cpuTime),
        status: r.status === "skipped" ? "pending" : r.status,
        rawStatus: r.status,
        type: "unit",
        filePath: r.file,
        retries: 0,
        flaky: false,
        suite: path.basename(path.dirname(r.file)),
        ...(r.message ? { message: r.message } : {}),
        ...(r.keywords ? { keywords: r.keywords } : {}),
        ...(r.testStatus ? { testStatus: r.testStatus } : {}),
      })),
    },
  };
}

// ── Recursive .mo directory discovery ────────────────────────────────────────

function findMoDirectories(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hasMoFiles = entries.some((e) => !e.isDirectory() && (e.name.endsWith(".mo") || e.name.endsWith(".mos")));

  if (hasMoFiles) {
    results.push(dir);
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...findMoDirectories(path.join(dir, entry.name)));
    }
  }

  return results;
}

// ── Concurrency limiter ──────────────────────────────────────────────────────

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      const task = tasks[idx];
      if (task) {
        results[idx] = await task();
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const testsuiteRoot = path.resolve(import.meta.dirname ?? __dirname, "../testsuite");

  // Parse arguments
  const rawArgs = process.argv.slice(2);
  const updateMode = rawArgs.includes("--update");
  const omcMode = rawArgs.includes("--omc");
  const concurrencyArg = rawArgs.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg
    ? parseInt(concurrencyArg.split("=")[1] ?? "4", 10)
    : Math.max(1, Math.floor(os.availableParallelism() / 2));
  const args = rawArgs.filter(
    (a) => a !== "--update" && a !== "--omc" && !a.startsWith("--concurrency=") && a !== "--legacy",
  );

  console.log(`${BOLD}Testsuite Runner${RESET} (concurrency=${concurrency}, pipeline=arena)`);
  console.log();

  // Determine which subdirectories (and optionally specific files) to run
  const suiteRuns = new Map<string, Set<string> | null>();

  if (args.length > 0) {
    for (const arg of args) {
      let root = path.resolve(testsuiteRoot, arg);
      if (!fs.existsSync(root)) {
        root = path.resolve(process.cwd(), arg);
      }
      if (!fs.existsSync(root)) {
        console.error(`${RED}Path not found: ${root}${RESET}`);
        continue;
      }

      const stat = fs.statSync(root);
      if (stat.isFile() && (root.endsWith(".mo") || root.endsWith(".mos"))) {
        const dir = path.dirname(root);
        const file = path.basename(root);
        if (!suiteRuns.has(dir)) {
          suiteRuns.set(dir, new Set());
        }
        const files = suiteRuns.get(dir);
        if (files) files.add(file);
      } else if (stat.isDirectory()) {
        const dirs = findMoDirectories(root);
        for (const d of dirs) {
          suiteRuns.set(d, null);
        }
      } else {
        console.error(`${RED}Not a valid directory or .mo file: ${root}${RESET}`);
      }
    }
  } else {
    const dirs = findMoDirectories(testsuiteRoot);
    for (const d of dirs) {
      suiteRuns.set(d, null);
    }
  }

  // Collect all test cases across all suites
  interface QueuedTest {
    testCase: TestCase;
    suiteName: string;
    suiteDir: string;
  }
  const allQueued: QueuedTest[] = [];
  const skippedResults: TestResult[] = [];

  for (const [suiteDir, specificFiles] of suiteRuns.entries()) {
    const suiteName = suiteDir.startsWith(testsuiteRoot) ? path.relative(testsuiteRoot, suiteDir) : "External";

    let moFiles = fs.readdirSync(suiteDir).filter((f) => f.endsWith(".mo") || f.endsWith(".mos"));

    if (specificFiles) {
      moFiles = moFiles.filter((f) => specificFiles.has(f));
    }

    moFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const moFile of moFiles) {
      const filePath = path.join(suiteDir, moFile);
      const testCase = parseTestFile(filePath);

      if (!testCase) {
        skippedResults.push({
          name: moFile,
          file: filePath,
          status: "skipped",
          duration: 0,
          cpuTime: 0,
          message: "Could not parse test metadata",
        });
        continue;
      }

      if (testCase.metadata.status === "skipped") {
        skippedResults.push({
          name: moFile,
          file: filePath,
          status: "skipped",
          duration: 0,
          cpuTime: 0,
          message: "Test marked as skipped",
        });
        continue;
      }

      // Skip .mos (OpenModelica Script) files — ModelScript has no parser for them
      if (moFile.endsWith(".mos")) {
        skippedResults.push({
          name: moFile,
          file: filePath,
          status: "skipped",
          duration: 0,
          cpuTime: 0,
          message: "Skipped: .mos (OpenModelica Script) files are not supported",
        });
        continue;
      }

      allQueued.push({ testCase, suiteName, suiteDir });
    }
  }

  console.log(`${BOLD}Queued ${allQueued.length} test(s) + ${skippedResults.length} skipped${RESET}`);
  console.log();

  const globalStart = Date.now();

  // Build task closures
  const tasks = allQueued.map(({ testCase }) => {
    return () => runTestInWorker(testCase, testsuiteRoot, updateMode, omcMode);
  });

  // Run all tests in parallel with concurrency limit
  const workerResults = await runWithConcurrency(tasks, concurrency);

  // Merge with skipped results and group by suite for display
  const suiteResults = new Map<string, TestResult[]>();
  for (let i = 0; i < allQueued.length; i++) {
    const q = allQueued[i];
    const result = workerResults[i];
    if (!q || !result) continue;
    let list = suiteResults.get(q.suiteName);
    if (!list) {
      list = [];
      suiteResults.set(q.suiteName, list);
    }
    list.push(result);
  }

  // Print results grouped by suite
  const allResults: TestResult[] = [...skippedResults];
  for (const [suiteName, results] of suiteResults.entries()) {
    console.log();
    console.log(`${BOLD}Suite: ${suiteName}${RESET} (${results.length} files)`);
    for (const result of results) {
      printResult(result);
    }
    printSummary(results, `Summary: ${suiteName}`);
    allResults.push(...results);
  }

  const globalStop = Date.now();

  // Print grand total
  if (suiteRuns.size > 1 || skippedResults.length > 0) {
    printSummary(allResults, "Grand Total");
    const elapsed = ((globalStop - globalStart) / 1000).toFixed(1);
    console.log(`  ${DIM}Wall time: ${elapsed}s${RESET}`);
  }

  // Write CTRF report (only if not running a single test)
  if (allResults.length > 1) {
    const ctrfDir = path.resolve(import.meta.dirname ?? __dirname, "../ctrf");
    fs.mkdirSync(ctrfDir, { recursive: true });

    const ctrfPath = path.join(ctrfDir, "ctrf-testsuite-report.json");
    const report = generateCtrfReport(allResults, globalStart, globalStop);
    fs.writeFileSync(ctrfPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n${DIM}CTRF report written to ${ctrfPath}${RESET}`);

    // Generate HTML report
    const htmlPath = path.join(ctrfDir, "ctrf-testsuite-report.html");
    generateHtmlReport(ctrfPath, htmlPath);
  }

  // Exit with error code if any tests failed
  const failedCount = allResults.filter((r) => r.status === "failed").length;
  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
