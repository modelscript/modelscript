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

import { simulateArena } from "@modelscript/compiler/simulator";

import { ModelicaClassKind } from "@modelscript/modelica/ast";
import Modelica from "@modelscript/modelica/parser";
import { ModelicaClassInstance } from "@modelscript/modelica/semantic-model";
import { ArenaDAEPrinter } from "@modelscript/symbolics";
import { StringWriter } from "@modelscript/utils";
import { execSync } from "node:child_process";
import path from "node:path";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

function cleanOmcOutput(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.includes("Warning:") || trimmed.includes("Warning ")) return false;
      if (trimmed.startsWith("[") && trimmed.includes("]")) return false;
      return true;
    })
    .join("\n")
    .trim();
}

// ── Tree-sitter setup ────────────────────────────────────────────────────────

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

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

function updateExpectedResult(filePath: string, newResult: string, newSimResult?: string): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const resultIdx = lines.findIndex((l) => /^\/\/\s*Result:/.test(l));
  const endResultIdx = lines.findIndex((l) => /^\/\/\s*endResult/.test(l));
  const endSimResultIdx = lines.findIndex((l) => /^\/\/\s*endSimulationResult/.test(l));

  const formatBlock = (header: string, footer: string, text: string) => {
    return `// ${header}\n${text
      .split("\n")
      .map((l) => (l ? `// ${l}` : "//"))
      .join("\n")}\n// ${footer}`;
  };

  const before = resultIdx >= 0 ? lines.slice(0, resultIdx) : lines;
  const resultStr = formatBlock("Result:", "endResult", newResult);
  let newContent = before.join("\n") + (before.length > 0 ? "\n" : "") + resultStr;

  if (newSimResult !== undefined) {
    const simResultStr = formatBlock("Simulation Result:", "endSimulationResult", newSimResult);
    newContent += "\n" + simResultStr;
  }

  let afterStart = lines.length;
  if (endSimResultIdx >= 0) afterStart = endSimResultIdx + 1;
  else if (endResultIdx >= 0) afterStart = endResultIdx + 1;

  const after = lines.slice(afterStart);
  // remove leading empty lines from after
  while (after.length > 0 && after[0].trim() === "") after.shift();

  if (after.length > 0) newContent += "\n\n" + after.join("\n");
  else newContent += "\n";

  fs.writeFileSync(filePath, newContent, "utf-8");
}

function formatSimulationCsv(csvContent: string): string {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return "";
  const rawHeaders = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  const keepIndices: number[] = [];
  const headers: string[] = [];
  for (let i = 0; i < rawHeaders.length; i++) {
    const h = rawHeaders[i];
    if (h.startsWith("der(") || h.startsWith("$")) continue;
    keepIndices.push(i);
    headers.push(h);
  }

  const columns: number[][] = headers.map(() => []);

  let lastTime: number | null = null;
  const timeIndex = keepIndices.findIndex((idx) => rawHeaders[idx] === "time");

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => parseFloat(v.trim()));

    // Skip duplicate time points (common in OMC output at end of simulation or events)
    if (timeIndex >= 0) {
      const t = vals[keepIndices[timeIndex]];
      if (t === lastTime) continue;
      lastTime = t;
    }

    for (let c = 0; c < keepIndices.length; c++) {
      columns[c].push(vals[keepIndices[c]]);
    }
  }

  const result: string[] = [];
  for (let c = 0; c < headers.length; c++) {
    const vals = columns[c].map((v) => {
      const rounded = Number(v.toFixed(4));
      // Add -0 to 0 normalization
      return Object.is(rounded, -0) ? 0 : rounded;
    });
    result.push(`${headers[c]}: ${vals.join(", ")}`);
  }
  return result.join("\n");
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

function runTestCase(testCase: TestCase, testsuiteRoot: string, updateMode: boolean, omcMode = false): TestResult {
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

    let omcExpected = "";
    if (omcMode) {
      try {
        const cmd = `echo "instantiate(${lastClassName});" | omc ${testCase.file}`;
        const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
        omcExpected = cleanOmcOutput(output);
        testCase.expectedResult = omcExpected;

        if (testCase.metadata.simulate || testCase.expectedSimulationResult !== undefined) {
          const mosFile = path.join(path.dirname(testCase.file), `${lastClassName}_sim.mos`);
          const simCmd = `loadFile("${path.basename(testCase.file)}");\nsimulate(${lastClassName}, outputFormat="csv", stopTime=1.0, stepSize=0.1);\n`;
          fs.writeFileSync(mosFile, simCmd, "utf-8");
          execSync(`omc ${mosFile}`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "ignore"],
            cwd: path.dirname(testCase.file),
          });
          const csvFile = path.join(path.dirname(testCase.file), `${lastClassName}_res.csv`);
          if (fs.existsSync(csvFile)) {
            const omcExpectedSim = formatSimulationCsv(fs.readFileSync(csvFile, "utf-8"));
            testCase.expectedSimulationResult = omcExpectedSim;
            fs.unlinkSync(csvFile);
          } else {
            testCase.expectedSimulationResult = `Simulation failed to produce CSV.`;
          }
          fs.unlinkSync(mosFile);
        }

        updateExpectedResult(testCase.file, omcExpected, testCase.expectedSimulationResult);
      } catch (err) {
        omcExpected = `Error running OMC: ${err instanceof Error ? err.message : err}`;
        testCase.expectedResult = omcExpected;
        updateExpectedResult(testCase.file, omcExpected, testCase.expectedSimulationResult);
      }
    }

    const formatMismatch = (expectedStr: string, actualStr: string, prefix = "Output mismatch"): string => {
      return `${prefix}:\n--- Expected ---\n${expectedStr}\n--- Actual ---\n${actualStr}`;
    };

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

    // ── Build line offset index for byte → row/col conversion ──
    const lineOffsets: number[] = [0];
    for (let i = 0; i < testCase.source.length; i++) {
      if (testCase.source[i] === "\n") lineOffsets.push(i + 1);
    }
    const byteToPosition = (byte: number): { row: number; column: number } => {
      // Binary search for the line containing this byte
      let lo = 0;
      let hi = lineOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((lineOffsets[mid] ?? 0) <= byte) lo = mid;
        else hi = mid - 1;
      }
      return { row: lo, column: byte - (lineOffsets[lo] ?? 0) };
    };

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
        let range: DiagEntry["range"] = diag.range as DiagEntry["range"];
        const rangeRec = diag.range as Record<string, unknown> | null;
        if (rangeRec && typeof rangeRec.startByte === "number" && typeof rangeRec.endByte === "number") {
          range = {
            startPosition: byteToPosition(rangeRec.startByte),
            endPosition: byteToPosition(rangeRec.endByte),
          };
        }
        diagnostics.push({
          type: diag.severity,
          code: diag.code,
          message: diag.message,
          resource: null,
          range,
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

      // Convert startByte/endByte from LintDiagnostic to row/col positions
      let range: DiagEntry["range"] = null;
      if (typeof d.startByte === "number" && typeof d.endByte === "number") {
        range = {
          startPosition: byteToPosition(d.startByte),
          endPosition: byteToPosition(d.endByte),
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
              const prefix = relPath ? `${relPath.split(path.sep).join("/")}:` : "";
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
              // Use actual diagnostic range (from LintDiagnostic byte offsets)
              let prefix = `[${testCase.file}]`;
              if (d.range && d.range.startPosition && d.range.endPosition) {
                const relPath = path.relative(testsuiteRoot, testCase.file);
                const relPathParts = relPath.split(path.sep).join("/");
                const sp = d.range.startPosition;
                const ep = d.range.endPosition;
                prefix = `[${relPathParts}:${sp.row + 1}:${sp.column + 1}-${ep.row + 1}:${ep.column + 1}:writable]`;
              }
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
        return makeResult("failed", formatMismatch(expected, reformatActual));
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
            // Use actual diagnostic range (from LintDiagnostic byte offsets)
            let prefix = `[${testCase.file}]`;
            if (d.range && d.range.startPosition && d.range.endPosition) {
              const relPath = path.relative(testsuiteRoot, testCase.file);
              const relPathParts = relPath.split(path.sep).join("/");
              const sp = d.range.startPosition;
              const ep = d.range.endPosition;
              prefix = `[${relPathParts}:${sp.row + 1}:${sp.column + 1}-${ep.row + 1}:${ep.column + 1}:writable]`;
            }
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
        return makeResult("failed", formatMismatch(expected, reformatActual));
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

    let flatteningPassed = actual === normalizedExpected;
    if (!flatteningPassed) {
      if (updateMode) {
        updateExpectedResult(testCase.file, actual, testCase.expectedSimulationResult);
        flatteningPassed = true;
      } else {
        return makeResult("failed", formatMismatch(normalizedExpected, actual));
      }
    }

    if (flatteningPassed && testCase.expectedSimulationResult !== undefined) {
      let simulationActual = "";
      if (arena) {
        try {
          const simRes = simulateArena(arena, { startTime: 0, stopTime: 10.0, step: 0.1, solver: "dopri5" });
          const resultLines: string[] = [];
          const timeVals = simRes.t.map((v) => {
            const rounded = Number(v.toFixed(4));
            return Object.is(rounded, -0) ? 0 : rounded;
          });
          resultLines.push(`time: ${timeVals.join(", ")}`);

          for (let i = 0; i < simRes.states.length; i++) {
            const varName = simRes.states[i];
            const varVals = simRes.y.map((row) => {
              const rounded = Number(row[i].toFixed(4));
              return Object.is(rounded, -0) ? 0 : rounded;
            });
            resultLines.push(`${varName}: ${varVals.join(", ")}`);
          }

          simulationActual = resultLines.join("\n");
        } catch (e) {
          simulationActual = `Error during Arena simulation: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        simulationActual = "Flattening returned null";
      }

      if (simulationActual === testCase.expectedSimulationResult) {
        return makeResult("passed", updateMode ? "(updated expected output)" : undefined);
      }

      if (updateMode && !omcMode) {
        updateExpectedResult(testCase.file, actual, simulationActual);
        return makeResult("passed", "(updated expected output)");
      }

      return makeResult(
        "failed",
        formatMismatch(testCase.expectedSimulationResult, simulationActual, "Simulation Output mismatch"),
      );
    }

    return makeResult("passed", updateMode ? "(updated expected output)" : undefined);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const expected = stripWarnings(testCase.expectedResult.trim());

    const severity = "Error";
    // Use file-level prefix since we don't have byte offsets for thrown errors
    const prefix = `[${testCase.file}]`;

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
    return makeResult("failed", formatMismatch(expected, reformatActual, "Output mismatch (Exception)"));
  }
}

// ── Main: read test case from stdin, run, write result to stdout ─────────────

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString("utf-8");
  const { testCase, testsuiteRoot, updateMode, omcMode } = JSON.parse(input) as {
    testCase: TestCase;
    testsuiteRoot: string;
    updateMode: boolean;
    omcMode?: boolean;
  };

  const result = runTestCase(testCase, testsuiteRoot, updateMode, omcMode || false);

  // Write result as JSON to stdout (parent reads this)
  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((err) => {
  console.error("[Worker] Fatal:", err);
  process.exit(1);
});
