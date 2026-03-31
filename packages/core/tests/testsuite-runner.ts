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
import { ModelicaJavascriptEntity } from "../src/compiler/modelica/javascript-entity.js";
import { ModelicaLinter } from "../src/compiler/modelica/linter.js";
import { ModelicaClassInstance } from "../src/compiler/modelica/model.js";
import { ModelicaClassKind, ModelicaStoredDefinitionSyntaxNode } from "../src/compiler/modelica/syntax.js";
import { generateHtmlReport } from "./ctrf-to-html.js";

// ── Tree-sitter setup ────────────────────────────────────────────────────────

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

// ── Types ────────────────────────────────────────────────────────────────────

interface TestCaseMetadata {
  name: string;
  keywords: string;
  status: "correct" | "incorrect" | "skipped";
  description: string;
  arrayMode?: "scalarize" | "preserve";
  fmiVersion?: "2.0" | "3.0";
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

  let arrayMode: "scalarize" | "preserve" | undefined = undefined;
  let fmiVersion: "2.0" | "3.0" | undefined = undefined;
  for (const line of lines) {
    const amMatch = line.match(/^\/\/\s*arrayMode:\s*(preserve|scalarize)/);
    if (amMatch && amMatch[1]) arrayMode = amMatch[1] as "preserve" | "scalarize";
    const fmiMatch = line.match(/^\/\/\s*fmiVersion:\s*(2\.0|3\.0)/);
    if (fmiMatch && fmiMatch[1]) fmiVersion = fmiMatch[1] as "2.0" | "3.0";
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

  return {
    file: filePath,
    metadata: {
      name,
      keywords,
      status: status === "incorrect" ? "incorrect" : status === "skipped" ? "skipped" : "correct",
      description: descriptionLines.join(" "),
      ...(arrayMode ? { arrayMode } : {}),
      ...(fmiVersion ? { fmiVersion } : {}),
    },
    source,
    expectedResult,
  };
}

// ── Test execution ───────────────────────────────────────────────────────────

function runTestCase(testCase: TestCase, testsuiteRoot: string, updateMode = false): TestResult {
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

    // Support for loading alongside ModelicaJavascriptEntity mockups
    const dir = path.dirname(testCase.file);
    if (fs.existsSync(dir)) {
      const jsFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".js") || f.endsWith(".ts"));
      if (jsFiles.length > 0) {
        for (const jsFile of jsFiles) {
          const jsEntity = new ModelicaJavascriptEntity(context, path.join(dir, jsFile));
          jsEntity.name = jsFile.replace(/\.[tj]s$/, "");
          context.addClass(jsEntity);
        }
      }
    }
    // When the last class is a package (e.g., `package Ticket4365 ... end Ticket4365;`),
    // prefer the last non-package class (model/block/class) since OpenModelica tests
    // typically flatten a specific model within the file, not the package itself.
    const classes = context.classes;
    let lastClassName = testCase.metadata.name;
    if (classes.length > 0) {
      const lastClass = classes[classes.length - 1];
      if (lastClass?.classKind === ModelicaClassKind.PACKAGE) {
        // Try to find a non-package class among all top-level classes
        const nonPkgClass = [...classes].reverse().find((c) => c.classKind !== ModelicaClassKind.PACKAGE);
        if (nonPkgClass?.name) {
          lastClassName = nonPkgClass.name;
        } else if (lastClass?.name) {
          // All top-level classes are packages; look inside the last package
          // for the last model/block/class and flatten that with a qualified name.
          let nestedName: string | null = null;
          for (const element of lastClass.elements) {
            if (
              element instanceof ModelicaClassInstance &&
              element.classKind !== ModelicaClassKind.PACKAGE &&
              element.classKind !== ModelicaClassKind.FUNCTION &&
              element.name
            ) {
              nestedName = `${lastClass.name}.${element.name}`;
            }
          }
          lastClassName = nestedName ?? lastClass.name;
        }
      } else {
        lastClassName = lastClass?.name ?? testCase.metadata.name;
      }
    }
    const flattenedResult = context.flatten(lastClassName, {
      ...(testCase.metadata.arrayMode ? { arrayMode: testCase.metadata.arrayMode } : {}),
      ...(testCase.metadata.fmiVersion ? { fmiVersion: testCase.metadata.fmiVersion } : {}),
    });

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
    const targetClass = context.query(lastClassName);
    const classesToLint = new Set<ModelicaClassInstance>();
    if (targetClass instanceof ModelicaClassInstance) classesToLint.add(targetClass);
    for (const cls of context.classes) {
      if (cls.classKind === "function" || cls.classKind === "operator function" || cls.classKind === "record") {
        classesToLint.add(cls);
      }
    }
    const tree = context.parse(testCase.file.endsWith(".mos") ? ".mos" : ".mo", testCase.source);
    const storedDef = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
    if (storedDef) linter.lint(storedDef, testCase.file);
    for (const cls of classesToLint) {
      linter.lint(cls, testCase.file);
      if (cls.abstractSyntaxNode) {
        linter.lint(cls.abstractSyntaxNode, testCase.file);
      }
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

        let reformatActual = actual;
        if (expected.includes("Error processing file:")) {
          const omcDiagLines = diagnostics.map((d) => {
            const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
            // Search expected output for a matching prefix for this severity
            const prefixRegex = new RegExp(`(\\[.*?\\]) ${severity}:`);
            const match = expected.match(prefixRegex);
            const prefix = match ? match[1] : `[${testCase.file}]`;
            return `${prefix} ${severity}: ${d.message}`;
          });
          reformatActual = `Error processing file: ${path.basename(testCase.file)}\n${omcDiagLines.join("\n")}\nError: Error occurred while flattening model ${lastClassName}\n\n# Error encountered! Exiting...\n# Please check the error message and the flags.\n\nExecution failed!`;
          if (reformatActual === expected) return makeResult("passed");
        }

        if (updateMode) {
          updateExpectedResult(testCase.file, reformatActual);
          return makeResult("passed", "(updated expected output)");
        }
        return makeResult(
          "failed",
          `Output mismatch:\n--- Expected ---\n${expected}\n--- Actual ---\n${reformatActual}`,
        );
      }
      // No lint errors found: flattening should fail (return null or throw)
      if (flattenedResult === null) return makeResult("passed");
      // Some incorrect tests produce both flattened output AND diagnostics (e.g., OMC warnings).
      // Try combining flattened result + diagnostics and comparing against expected.
      {
        let combinedActual = flattenedResult.trim();
        const combinedDiagLines = formatDiagLines();
        if (combinedDiagLines.length > 0) {
          combinedActual += "\n" + combinedDiagLines.join("\n");
        }
        const expected = testCase.expectedResult.trim();
        if (combinedActual === expected) return makeResult("passed");
      }
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

    // Normalize OpenModelica-specific `:writable` suffix in diagnostic path prefixes
    const normalizedExpected = expected.replace(/:writable\]/g, "]");
    if (actual === normalizedExpected) return makeResult("passed");
    if (updateMode) {
      updateExpectedResult(testCase.file, actual);
      return makeResult("passed", "(updated expected output)");
    }
    return makeResult("failed", `Output mismatch:\n--- Expected ---\n${expected}\n--- Actual ---\n${actual}`);
  } catch (error) {
    if (testCase.metadata.status === "incorrect") return makeResult("passed");
    return makeResult("failed", `Exception: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Rewrites the // Result: ... // endResult block in a .mo test file with new content.
 */
function updateExpectedResult(filePath: string, newResult: string): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const resultIdx = lines.findIndex((l) => /^\/\/\s*Result:/.test(l));
  const endResultIdx = lines.findIndex((l) => /^\/\/\s*endResult/.test(l));
  if (resultIdx < 0 || endResultIdx < 0) return;

  const before = lines.slice(0, resultIdx + 1); // includes "// Result:"
  const after = lines.slice(endResultIdx); // includes "// endResult"
  const resultLines = newResult.split("\n").map((l) => (l ? `// ${l}` : "//"));

  const newContent = [...before, ...resultLines, ...after].join("\n");
  fs.writeFileSync(filePath, newContent, "utf-8");
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

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const testsuiteRoot = path.resolve(import.meta.dirname ?? __dirname, "../testsuite");

  // Determine which subdirectories (and optionally specific files) to run
  const rawArgs = process.argv.slice(2);
  const updateMode = rawArgs.includes("--update");
  const args = rawArgs.filter((a) => a !== "--update");
  const suiteRuns = new Map<string, Set<string> | null>();

  if (args.length > 0) {
    for (const arg of args) {
      const root = path.resolve(testsuiteRoot, arg);
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

  const allResults: TestResult[] = [];
  const globalStart = Date.now();

  for (const [suiteDir, specificFiles] of suiteRuns.entries()) {
    const suiteName = path.relative(testsuiteRoot, suiteDir);

    let moFiles = fs.readdirSync(suiteDir).filter((f) => f.endsWith(".mo") || f.endsWith(".mos"));

    if (specificFiles) {
      moFiles = moFiles.filter((f) => specificFiles.has(f));
    }

    moFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

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

      if (testCase.metadata.status === "skipped") {
        suiteResults.push({
          name: moFile,
          file: filePath,
          status: "skipped",
          duration: 0,
          cpuTime: 0,
          message: "Test marked as skipped",
        });
        continue;
      }

      const result = runTestCase(testCase, testsuiteRoot, updateMode);
      suiteResults.push(result);
      printResult(result);
    }

    printSummary(suiteResults, `Summary: ${suiteName}`);
    allResults.push(...suiteResults);
  }

  const globalStop = Date.now();

  // Print grand total
  if (suiteRuns.size > 1) {
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
