// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Standalone test runner for OpenModelica-style .mo test files.
 *
 * Reads every .mo file from a testsuite directory, parses the embedded metadata
 * and expected result, runs the ModelScript flattener, compares the output, and
 * writes results to the console AND a CTRF JSON report.
 *
 * Usage:
 *   npx tsx tests/testsuite-runner.ts [testsuite-subdirectory ...]
 *
 * Examples:
 *   npx tsx tests/testsuite-runner.ts extends
 *   npx tsx tests/testsuite-runner.ts extends modification
 *
 * If no arguments are given, all subdirectories under testsuite/ are run.
 */

import Modelica from "@modelscript/tree-sitter-modelica";
import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";
import { NodeFileSystem } from "../../../packages/cli/src/util/filesystem.js";
import { Context } from "../src/compiler/context.js";
import { ModelicaLinter } from "../src/compiler/modelica/linter.js";
import { generateHtmlReport } from "./ctrf-to-html.js";

// ── Tree-sitter setup ────────────────────────────────────────────────────────

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

// ── Types ────────────────────────────────────────────────────────────────────

interface TestCaseMetadata {
  name: string;
  keywords: string;
  status: "correct" | "incorrect";
  description: string;
}

interface TestCase {
  file: string;
  metadata: TestCaseMetadata;
  source: string;
  expectedResult: string;
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
  if (!status) return null;

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

  return {
    file: filePath,
    metadata: {
      name,
      keywords,
      status: status === "incorrect" ? "incorrect" : "correct",
      description: descriptionLines.join(" "),
    },
    source,
    expectedResult,
  };
}

// ── Test execution ───────────────────────────────────────────────────────────

function runTestCase(testCase: TestCase, testsuiteRoot: string): TestResult {
  const start = performance.now();
  const cpuStart = process.cpuUsage();

  /** Capture CPU time in ms since cpuStart (user + system). */
  const cpuMs = () => {
    const delta = process.cpuUsage(cpuStart);
    return (delta.user + delta.system) / 1000;
  };

  /** Build a TestResult with common fields pre-filled. */
  const makeResult = (status: "passed" | "failed" | "skipped", message?: string): TestResult => ({
    name: path.basename(testCase.file),
    keywords: testCase.metadata.keywords,
    testStatus: testCase.metadata.status,
    file: testCase.file,
    status,
    duration: performance.now() - start,
    cpuTime: cpuMs(),
    ...(message ? { message } : {}),
  });

  try {
    const context = new Context(new NodeFileSystem());
    context.load(testCase.source);

    // Flatten the last top-level class from the loaded source
    const classes = context.classes;
    const lastClassName =
      classes.length > 0 ? (classes[classes.length - 1]?.name ?? testCase.metadata.name) : testCase.metadata.name;
    const flattenedResult = context.flatten(lastClassName);

    // Run the linter to collect diagnostics
    interface DiagEntry {
      type: string;
      code: number;
      message: string;
      resource: string | null;
      range: import("../src/util/tree-sitter.js").Range | null;
    }
    const diagnostics: DiagEntry[] = [];
    const linter = new ModelicaLinter(
      (
        type: string,
        code: number,
        message: string,
        resource: string | null | undefined,
        range: import("../src/util/tree-sitter.js").Range | null | undefined,
      ) => {
        // Collect diagnostics, excluding noisy rules for flattening tests
        if (code !== 4004) {
          diagnostics.push({ type, code, message, resource: resource ?? null, range: range ?? null });
        }
      },
    );
    for (const cls of context.classes) {
      linter.lint(cls, testCase.file);
    }

    // Format collected diagnostics into lines
    const formatDiagLines = () =>
      diagnostics.map((d) => {
        const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
        const codeStr = d.code > 0 ? `[M${d.code}] ` : "";
        if (d.range) {
          const r = d.range;
          const startPos = `${r.startPosition.row + 1}:${r.startPosition.column + 1}`;
          const endPos = `${r.endPosition.row + 1}:${r.endPosition.column + 1}`;
          const relPath = d.resource ? path.relative(testsuiteRoot, d.resource) : "";
          const prefix = relPath ? `${relPath.split(path.sep).slice(1).join("/")}:` : "";
          return `[${prefix}${startPos}-${endPos}] ${severity}: ${codeStr}${d.message}`;
        }
        return `${severity}: ${codeStr}${d.message}`;
      });

    if (testCase.metadata.status === "incorrect") {
      // For incorrect tests: compare lint errors against expected output
      const diagLines = formatDiagLines();
      if (diagLines.length > 0) {
        const actual = diagLines.join("\n");
        const expected = testCase.expectedResult.trim();
        if (actual === expected) return makeResult("passed");
        return makeResult("failed", `Output mismatch:\n--- Expected ---\n${expected}\n--- Actual ---\n${actual}`);
      }
      // No lint errors found: flattening should fail (return null or throw)
      if (flattenedResult === null) return makeResult("passed");
      return makeResult("failed", `Expected flattening to fail but got result:\n${flattenedResult}`);
    }

    // For correct tests: compare flattened output with expected
    if (flattenedResult === null) {
      return makeResult("failed", "Flattening returned null (expected a result)");
    }

    let actual = flattenedResult.trim();
    const diagLines = formatDiagLines();
    if (diagLines.length > 0) {
      actual += "\n" + diagLines.join("\n");
    }
    const expected = testCase.expectedResult.trim();

    if (actual === expected) return makeResult("passed");
    return makeResult("failed", `Output mismatch:\n--- Expected ---\n${expected}\n--- Actual ---\n${actual}`);
  } catch (error) {
    if (testCase.metadata.status === "incorrect") return makeResult("passed");
    return makeResult("failed", `Exception: ${error instanceof Error ? error.message : String(error)}`);
  }
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
      .map((l) => `      ${DIM}${l}${RESET}`)
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
  const hasMoFiles = entries.some((e) => !e.isDirectory() && e.name.endsWith(".mo"));

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

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const testsuiteRoot = path.resolve(import.meta.dirname ?? __dirname, "../testsuite");

  // Determine which subdirectories to run
  const args = process.argv.slice(2);
  let suiteDirs: string[];

  if (args.length > 0) {
    // Resolve arguments as paths relative to testsuite root
    const roots = args.map((arg) => path.resolve(testsuiteRoot, arg));
    suiteDirs = roots.flatMap((root) => {
      if (!fs.existsSync(root)) {
        console.error(`${RED}Path not found: ${root}${RESET}`);
        return [];
      }
      return findMoDirectories(root);
    });
  } else {
    suiteDirs = findMoDirectories(testsuiteRoot);
  }

  const allResults: TestResult[] = [];
  const globalStart = Date.now();

  for (const suiteDir of suiteDirs) {
    const suiteName = path.relative(testsuiteRoot, suiteDir);

    const moFiles = fs
      .readdirSync(suiteDir)
      .filter((f) => f.endsWith(".mo"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (moFiles.length === 0) continue;

    console.log();
    console.log(`${BOLD}Suite: ${suiteName}${RESET} (${moFiles.length} files)`);

    const suiteResults: TestResult[] = [];

    for (const moFile of moFiles) {
      const filePath = path.join(suiteDir, moFile);
      const testCase = parseTestFile(filePath);

      if (!testCase) {
        suiteResults.push({
          name: moFile,
          file: filePath,
          status: "skipped",
          duration: 0,
          cpuTime: 0,
          message: "Could not parse test metadata",
        });
        continue;
      }

      const result = runTestCase(testCase, testsuiteRoot);
      suiteResults.push(result);
      printResult(result);
    }

    printSummary(suiteResults, `Summary: ${suiteName}`);
    allResults.push(...suiteResults);
  }

  const globalStop = Date.now();

  // Print grand total
  if (suiteDirs.length > 1) {
    printSummary(allResults, "Grand Total");
  }

  // Write CTRF report
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

main();
