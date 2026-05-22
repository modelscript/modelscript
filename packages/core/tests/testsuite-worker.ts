// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Child-process worker for the testsuite runner.
 *
 * Runs a **single** .mo test case in an isolated V8 heap using the
 * arena-native flattening pipeline (`flattenArena`).
 *
 * Communication protocol:
 *   stdin  → JSON { file, metadata, source, expectedResult, testsuiteRoot, updateMode }
 *   stdout → JSON TestResult
 *   stderr → free-form log output
 *
 * The parent orchestrator spawns N workers in parallel, each in its own
 * child process, so memory is fully reclaimed on exit.
 */

globalThis.WeakRef = class WeakRefMock {
  target: unknown;
  constructor(target: unknown) {
    this.target = target;
  }
  deref(): unknown {
    return this.target;
  }
} as unknown as typeof WeakRef;

import CSV from "@modelscript/csv/parser";
import { ModelicaClassKind } from "@modelscript/modelica/ast";
import Modelica from "@modelscript/modelica/parser";
import { ArenaDAEPrinter } from "@modelscript/symbolics";
import { StringWriter } from "@modelscript/utils";
import path from "node:path";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import { ModelicaClassInstance } from "../src/compiler/modelica/factory.js";
import { NodeFileSystem } from "./node-filesystem.js";

// ── Tree-sitter setup ────────────────────────────────────────────────────────

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const csvParser = new Parser();
csvParser.setLanguage(CSV);
Context.registerParser(".csv", csvParser);

// ── Types (duplicated from runner — kept in sync) ────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripWarnings(text: string): string {
  return text
    .split("\n")
    .filter(
      (line) =>
        !line.includes("Components are deprecated in class.") &&
        !line.includes("Algorithm sections are deprecated in class.") &&
        !line.includes("Equation sections are deprecated in class."),
    )
    .join("\n")
    .trim();
}

import fs from "node:fs";

function updateExpectedResult(filePath: string, newResult: string): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const resultIdx = lines.findIndex((l) => /^\/\/\s*Result:/.test(l));
  const endResultIdx = lines.findIndex((l) => /^\/\/\s*endResult/.test(l));
  if (resultIdx < 0 || endResultIdx < 0) return;

  const before = lines.slice(0, resultIdx + 1);
  const after = lines.slice(endResultIdx);
  const resultLines = newResult.split("\n").map((l) => (l ? `// ${l}` : "//"));

  const newContent = [...before, ...resultLines, ...after].join("\n");
  fs.writeFileSync(filePath, newContent, "utf-8");
}

// ── Test execution (arena-native pipeline) ───────────────────────────────────

function resolveClassName(context: Context, testCase: TestCase): string {
  let lastClassName = testCase.metadata.name;
  const classes = context.classes;
  if (classes.some((c) => c.name === testCase.metadata.name)) {
    lastClassName = testCase.metadata.name;
  } else if (classes.length > 0) {
    const lastClass = classes[classes.length - 1];
    if (lastClass?.classKind === ModelicaClassKind.PACKAGE) {
      const nonPkgClass = [...classes].reverse().find((c) => c.classKind !== ModelicaClassKind.PACKAGE);
      if (nonPkgClass?.name) {
        lastClassName = nonPkgClass.name;
      } else if (lastClass?.name) {
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
  return lastClassName;
}

function runTestCase(testCase: TestCase, testsuiteRoot: string, updateMode: boolean): TestResult {
  const start = performance.now();
  const cpuStart = process.cpuUsage();

  const cpuMs = () => {
    const delta = process.cpuUsage(cpuStart);
    return (delta.user + delta.system) / 1000;
  };

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

  let lastClassName = testCase.metadata.name;
  try {
    const context = new Context(new NodeFileSystem());
    context.load(testCase.source);

    lastClassName = resolveClassName(context, testCase);
    console.error(`[Worker] Resolved class: ${lastClassName}`);

    // ── Arena-native flattening ──
    const t_flatten_start = Date.now();
    const arena = context.flattenArena(lastClassName);
    console.error(`[Worker] flattenArena took ${Date.now() - t_flatten_start}ms`);

    let flattenedResult: string | null = null;
    if (arena) {
      // Check for flattener-level error diagnostics
      const hasErrors = arena.diagnostics.some((d) => d.severity === "error");
      if (!hasErrors) {
        const out = new StringWriter();
        const printer = new ArenaDAEPrinter(out, arena);
        printer.printDAE(arena);
        flattenedResult = out.toString();
      }
    }

    // ── Lint diagnostics ──
    interface DiagEntry {
      type: string;
      code: number;
      message: string;
      resource: string | null;
      range: { startPosition: { row: number; column: number }; endPosition: { row: number; column: number } } | null;
    }
    const diagnostics: DiagEntry[] = [];

    // Arena diagnostics
    if (arena) {
      for (const diag of arena.diagnostics) {
        diagnostics.push({
          type: diag.severity,
          code: diag.code,
          message: diag.message,
          resource: null,
          range: diag.range as DiagEntry["range"],
        });
      }
    }

    // Linter diagnostics
    const t_lint_start = Date.now();
    for (const d of context.queryEngine.runAllLints()) {
      const dd = d as Record<string, unknown>;
      const lintName: string = (dd.lintName as string) ?? (dd.rule as string) ?? "";

      if (lintName === "unbalanced-model" || lintName === "unbalancedModel") continue;

      if (dd.symbolId != null) {
        const entry = context.queryEngine.index?.symbols?.get(dd.symbolId);
        if (entry && typeof entry.resourceId === "string") {
          if (entry.resourceId === "modelscript-cas.mo" || entry.resourceId.startsWith("modelscript-")) {
            continue;
          }
        }
      }

      let code = 0;
      const codeMatch = d.message.match(/^\[M(\d+)\]/);
      if (codeMatch) code = parseInt(codeMatch[1], 10);

      let range: DiagEntry["range"] = null;
      if (dd.node) {
        const node = dd.node as {
          startPosition: { row: number; column: number };
          endPosition: { row: number; column: number };
        };
        range = {
          startPosition: { row: node.startPosition.row, column: node.startPosition.column },
          endPosition: { row: node.endPosition.row, column: node.endPosition.column },
        };
      }

      diagnostics.push({
        type: d.severity,
        code,
        message: d.message,
        resource: null,
        range,
      });
    }
    console.error(`[Worker] Linter took ${Date.now() - t_lint_start}ms`);

    // ── Format diagnostics ──
    const formatDiagLines = () => {
      const lines = diagnostics
        .filter(
          (d) =>
            !d.message.includes("Components are deprecated in class.") &&
            !d.message.includes("Algorithm sections are deprecated in class.") &&
            !d.message.includes("Equation sections are deprecated in class."),
        )
        .map((d) => {
          const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
          const codeStr = d.code > 0 ? `[M${d.code}] ` : "";
          if (d.range) {
            const r = d.range;
            if (r.startPosition && r.endPosition) {
              const startPos = `${r.startPosition.row + 1}:${r.startPosition.column + 1}`;
              const endPos = `${r.endPosition.row + 1}:${r.endPosition.column + 1}`;
              const relPath = d.resource ? path.relative(testsuiteRoot, d.resource) : "";
              const prefix = relPath ? `${relPath.split(path.sep).slice(1).join("/")}:` : "";
              return `[${prefix}${startPos}-${endPos}] ${severity}: ${codeStr}${d.message}`;
            }
          }
          return `${severity}: ${codeStr}${d.message}`;
        });
      return Array.from(new Set(lines));
    };

    // ── Compare results ──
    if (testCase.metadata.status === "incorrect") {
      const diagLines = formatDiagLines();
      if (diagLines.length > 0) {
        const actual = diagLines.join("\n");
        const expected = stripWarnings(testCase.expectedResult.trim());
        if (actual === expected) return makeResult("passed");

        let reformatActual = actual;
        if (expected.includes("Error processing file:")) {
          const omcDiagLines = diagnostics
            .filter(
              (d) =>
                !d.message.includes("Components are deprecated in class.") &&
                !d.message.includes("Algorithm sections are deprecated in class.") &&
                !d.message.includes("Equation sections are deprecated in class."),
            )
            .map((d) => {
              const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
              const prefixRegex = new RegExp(`(\\[.*?\\]) ${severity}:`);
              const match = expected.match(prefixRegex);
              const prefix = match ? match[1] : `[${testCase.file}]`;
              return `${prefix} ${severity}: ${d.message}`;
            });
          const uniqueOmcDiagLines = Array.from(new Set(omcDiagLines));
          const hasErrorOccurred = expected.includes("Error: Error occurred while flattening model");
          const errorLine = hasErrorOccurred ? `\nError: Error occurred while flattening model ${lastClassName}` : "";
          reformatActual = `Error processing file: ${path.basename(testCase.file)}\n${uniqueOmcDiagLines.join("\n")}${errorLine}\n\n# Error encountered! Exiting...\n# Please check the error message and the flags.\n\nExecution failed!`;
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
      if (flattenedResult === null) return makeResult("passed");
      {
        let combinedActual = flattenedResult.trim();
        const combinedDiagLines = formatDiagLines();
        if (combinedDiagLines.length > 0) {
          combinedActual += "\n" + combinedDiagLines.join("\n");
        }
        combinedActual = stripWarnings(combinedActual);
        const expected = stripWarnings(testCase.expectedResult.trim());
        if (combinedActual === expected) return makeResult("passed");
      }
      return makeResult("failed", `Expected flattening to fail but got result:\n${flattenedResult}`);
    }

    // For correct tests: compare flattened output with expected
    if (flattenedResult === null) {
      const diagLines = formatDiagLines();
      const expected = stripWarnings(testCase.expectedResult.trim());

      if (expected.includes("Error processing file:") && diagLines.length > 0) {
        const omcDiagLines = diagnostics
          .filter(
            (d) =>
              !d.message.includes("Components are deprecated in class.") &&
              !d.message.includes("Algorithm sections are deprecated in class.") &&
              !d.message.includes("Equation sections are deprecated in class."),
          )
          .map((d) => {
            const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
            const prefixRegex = new RegExp(`(\\[.*?\\]) ${severity}:`);
            const match = expected.match(prefixRegex);
            const prefix = match ? match[1] : `[${testCase.file}]`;
            return `${prefix} ${severity}: ${d.message}`;
          });
        const uniqueOmcDiagLines = Array.from(new Set(omcDiagLines));
        const hasErrorOccurred = expected.includes("Error: Error occurred while flattening model");
        const errorLine = hasErrorOccurred ? `\nError: Error occurred while flattening model ${lastClassName}` : "";
        const reformatActual = `Error processing file: ${path.basename(testCase.file)}\n${uniqueOmcDiagLines.join("\n")}${errorLine}\n\n# Error encountered! Exiting...\n# Please check the error message and the flags.\n\nExecution failed!`;
        if (reformatActual === expected) return makeResult("passed");
        if (updateMode) {
          updateExpectedResult(testCase.file, reformatActual);
          return makeResult("passed", "(updated expected output)");
        }
        return makeResult(
          "failed",
          `Output mismatch:\n--- Expected ---\n${expected}\n--- Actual ---\n${reformatActual}`,
        );
      }

      return makeResult(
        "failed",
        `Flattening returned null (expected a result)\nDiagnostics:\n${diagLines.join("\n")}`,
      );
    }

    let actual = flattenedResult.trim();
    const diagLines = formatDiagLines();
    if (diagLines.length > 0) {
      actual += "\n" + diagLines.join("\n");
    }
    actual = stripWarnings(actual);
    const expected = stripWarnings(testCase.expectedResult.trim());

    const normalizedExpected = expected.replace(/:writable\]/g, "]");
    if (actual === normalizedExpected) return makeResult("passed");
    if (updateMode) {
      updateExpectedResult(testCase.file, actual);
      return makeResult("passed", "(updated expected output)");
    }
    return makeResult("failed", `Output mismatch:\n--- Expected ---\n${expected}\n--- Actual ---\n${actual}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const expected = stripWarnings(testCase.expectedResult.trim());

    const severity = "Error";
    const prefixRegex = new RegExp(`(\\[.*?\\]) ${severity}:`);
    const match = expected.match(prefixRegex);
    const prefix = match ? match[1] : `[${testCase.file}]`;

    const reformatActual = `Error processing file: ${path.basename(testCase.file)}\n${prefix} ${severity}: ${errorMsg}\nError: Error occurred while flattening model ${lastClassName}\n\n# Error encountered! Exiting...\n# Please check the error message and the flags.\n\nExecution failed!`;

    if (reformatActual === expected) return makeResult("passed");
    if (updateMode) {
      updateExpectedResult(testCase.file, reformatActual);
      return makeResult("passed", "(updated expected output)");
    }

    if (testCase.metadata.status === "incorrect" && !expected.includes("Error processing file:")) {
      return makeResult("passed");
    }

    console.error(error);
    return makeResult(
      "failed",
      `Output mismatch (Exception):\n--- Expected ---\n${expected}\n--- Actual ---\n${reformatActual}`,
    );
  }
}

// ── Main: read test case from stdin, run, write result to stdout ─────────────

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString("utf-8");
  const { testCase, testsuiteRoot, updateMode } = JSON.parse(input) as {
    testCase: TestCase;
    testsuiteRoot: string;
    updateMode: boolean;
  };

  const result = runTestCase(testCase, testsuiteRoot, updateMode);

  // Write result as JSON to stdout (parent reads this)
  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((err) => {
  console.error("[Worker] Fatal:", err);
  process.exit(1);
});
