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

function cleanOmcOutput(text: string, keepDiagnosticLines = false): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.includes("Warning:") || trimmed.includes("Warning ")) return false;
      // For correct tests, strip OMC's [file:line:col] annotation lines.
      // For incorrect tests, these ARE the expected diagnostic output — keep them.
      if (!keepDiagnosticLines && trimmed.startsWith("[") && trimmed.includes("]")) return false;
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
        const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
        omcExpected = cleanOmcOutput(output, testCase.metadata.status === "incorrect");
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
        // execSync throws when OMC exits with non-zero (expected for `status: incorrect` tests).
        // The error object has .stdout/.stderr with the actual OMC diagnostic output.
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        const omcOutput = (execErr.stdout ?? "") + (execErr.stderr ?? "");
        const cleaned = cleanOmcOutput(omcOutput, true);
        if (cleaned) {
          // Normalize absolute paths to relative (matching ModelScript's format)
          const absPath = testCase.file;
          const relPath = path.relative(testsuiteRoot, absPath).split(path.sep).join("/");
          const baseName = path.basename(absPath);
          omcExpected = cleaned
            .replace(`Error processing file: ${absPath}`, `Error processing file: ${baseName}`)
            .replaceAll(absPath, relPath);
        } else {
          omcExpected = `Error running OMC: ${err instanceof Error ? err.message : err}`;
        }
        testCase.expectedResult = omcExpected;
        updateExpectedResult(testCase.file, omcExpected, testCase.expectedSimulationResult);
      }
    }

    const formatMismatch = (expectedStr: string, actualStr: string, prefix = "Output mismatch"): string => {
      const expLines = expectedStr.split("\n");
      const actLines = actualStr.split("\n");
      const contextWindow = 2;
      const maxDiffOutputLines = 40; // truncate output after this many lines

      // ── LCS-based diff (Myers O(ND) algorithm) ──
      // Produces a list of edit operations: 'equal', 'delete', 'insert'
      type EditOp =
        | { kind: "equal"; expIdx: number; actIdx: number }
        | { kind: "delete"; expIdx: number }
        | { kind: "insert"; actIdx: number };

      const computeEdits = (a: string[], b: string[]): EditOp[] => {
        const n = a.length;
        const m = b.length;
        const max = n + m;
        // For very large inputs, fall back to simple line-by-line to avoid O(N²) cost
        if (max > 2000) {
          const ops: EditOp[] = [];
          const minLen = Math.min(n, m);
          for (let i = 0; i < minLen; i++) {
            if (a[i] === b[i]) ops.push({ kind: "equal", expIdx: i, actIdx: i });
            else {
              ops.push({ kind: "delete", expIdx: i });
              ops.push({ kind: "insert", actIdx: i });
            }
          }
          for (let i = minLen; i < n; i++) ops.push({ kind: "delete", expIdx: i });
          for (let i = minLen; i < m; i++) ops.push({ kind: "insert", actIdx: i });
          return ops;
        }

        // Myers algorithm: find shortest edit script
        const v = new Map<number, number>();
        v.set(1, 0);
        const trace: Map<number, number>[] = [];

        outer: for (let d = 0; d <= max; d++) {
          const vSnap = new Map(v);
          trace.push(vSnap);
          for (let k = -d; k <= d; k += 2) {
            let x: number;
            if (k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))) {
              x = v.get(k + 1) ?? 0;
            } else {
              x = (v.get(k - 1) ?? 0) + 1;
            }
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
              x++;
              y++;
            }
            v.set(k, x);
            if (x >= n && y >= m) break outer;
          }
        }

        // Backtrack to find the actual edits
        const edits: EditOp[] = [];
        let cx = n,
          cy = m;
        for (let d = trace.length - 1; d >= 0; d--) {
          const k = cx - cy;
          const vPrev = d > 0 ? (trace[d - 1] as Map<number, number>) : new Map([[1, 0]]);
          let prevK: number;
          if (k === -d || (k !== d && (vPrev.get(k - 1) ?? 0) < (vPrev.get(k + 1) ?? 0))) {
            prevK = k + 1;
          } else {
            prevK = k - 1;
          }
          const prevX = vPrev.get(prevK) ?? 0;
          const prevY = prevX - prevK;

          // Diagonal (equal) moves
          let tx = cx,
            ty = cy;
          while (tx > prevX && ty > prevY && tx > 0 && ty > 0) {
            tx--;
            ty--;
            edits.push({ kind: "equal", expIdx: tx, actIdx: ty });
          }

          // The edit move
          if (d > 0) {
            if (cx === prevX && cy > 0) {
              cy--;
              edits.push({ kind: "insert", actIdx: cy });
            } else if (cx > 0) {
              cx--;
              edits.push({ kind: "delete", expIdx: cx });
            }
          }
          cx = prevX;
          cy = prevY;
        }
        edits.reverse();
        return edits;
      };

      const edits = computeEdits(expLines, actLines);

      // ── Build unified diff hunks ──
      interface HunkLine {
        tag: " " | "-" | "+";
        text: string;
        lineNo: number;
      }
      const allDiffLines: HunkLine[] = [];
      for (const op of edits) {
        if (op.kind === "equal") {
          allDiffLines.push({ tag: " ", text: expLines[op.expIdx] as string, lineNo: op.expIdx + 1 });
        } else if (op.kind === "delete") {
          allDiffLines.push({ tag: "-", text: expLines[op.expIdx] as string, lineNo: op.expIdx + 1 });
        } else {
          allDiffLines.push({ tag: "+", text: actLines[op.actIdx] as string, lineNo: op.actIdx + 1 });
        }
      }

      // Find change indices and expand with context
      const changeIndices = new Set<number>();
      for (let i = 0; i < allDiffLines.length; i++) {
        if ((allDiffLines[i] as HunkLine).tag !== " ") {
          for (let c = Math.max(0, i - contextWindow); c <= Math.min(allDiffLines.length - 1, i + contextWindow); c++) {
            changeIndices.add(c);
          }
        }
      }

      if (changeIndices.size === 0) return `${prefix}: (no visible diff)`;

      const visible = [...changeIndices].sort((a, b) => a - b);

      // Inline character diff marker
      const inlineDiff = (exp: string, act: string): string => {
        let first = 0;
        while (first < exp.length && first < act.length && exp[first] === act[first]) first++;
        let lastE = exp.length - 1,
          lastA = act.length - 1;
        while (lastE > first && lastA > first && exp[lastE] === act[lastA]) {
          lastE--;
          lastA--;
        }
        return " ".repeat(first) + "^".repeat(Math.max(1, Math.max(lastE - first + 1, lastA - first + 1)));
      };

      // ANSI color codes for diff output
      const R = "\x1b[0m"; // reset
      const RED = "\x1b[31m";
      const GRN = "\x1b[32m";
      const DIM = "\x1b[2m";
      const CYN = "\x1b[36m";

      const output: string[] = [`${prefix}:`];
      let lastVisIdx = -2;
      let outputLineCount = 0;
      let truncated = false;

      for (const vi of visible) {
        if (outputLineCount >= maxDiffOutputLines) {
          truncated = true;
          break;
        }

        // Hunk separator
        if (vi > lastVisIdx + 1 && lastVisIdx >= 0) {
          output.push(`${DIM}      ···${R}`);
        }
        lastVisIdx = vi;

        const dl = allDiffLines[vi] as HunkLine;
        const lineNoStr = String(dl.lineNo).padStart(3);

        if (dl.tag === " ") {
          output.push(`${DIM}   ${lineNoStr}  ${dl.text}${R}`);
          outputLineCount++;
        } else if (dl.tag === "-") {
          output.push(`${RED}  -${lineNoStr}  ${dl.text}${R}`);
          outputLineCount++;
          // Check if the next visible entry is a matching "+" for inline diff
          const nextVi = visible[visible.indexOf(vi) + 1];
          if (nextVi === vi + 1 && allDiffLines[nextVi]?.tag === "+") {
            const nextDl = allDiffLines[nextVi] as HunkLine;
            output.push(`${GRN}  +${String(nextDl.lineNo).padStart(3)}  ${nextDl.text}${R}`);
            outputLineCount++;
            const marker = inlineDiff(dl.text, nextDl.text);
            output.push(`${DIM}${CYN}       ${marker}${R}`);
            // Skip the "+" entry since we consumed it
            visible.splice(visible.indexOf(nextVi), 1);
          }
        } else {
          output.push(`${GRN}  +${lineNoStr}  ${dl.text}${R}`);
          outputLineCount++;
        }
      }

      if (truncated) {
        const totalChanges = allDiffLines.filter((l) => l.tag !== " ").length;
        output.push(`${DIM}      ... (${totalChanges} total changed lines, showing first ${maxDiffOutputLines})${R}`);
      }

      if (expLines.length !== actLines.length) {
        output.push(`${DIM}      (expected ${expLines.length} lines, got ${actLines.length} lines)${R}`);
      }

      // Full expected/actual for reference
      output.push(`--- Expected ---`);
      for (const l of expLines) output.push(`${DIM}${l}${R}`);
      output.push(`--- Actual ---`);
      for (const l of actLines) output.push(`${DIM}${l}${R}`);

      return output.join("\n");
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

    // Strip line:col ranges from diagnostic bracket prefixes for range-insensitive comparison
    // e.g. "[path/file.mo:12:3-12:9:writable] Error: ..." → "[path/file.mo:writable] Error: ..."
    const stripDiagRanges = (text: string): string =>
      text.replace(/\[([^\]]*\.mo):\d+:\d+-\d+:\d+:writable\]/g, "[$1:writable]");

    // ── Compare results ──
    if (testCase.metadata.status === "incorrect") {
      const diagLines = formatDiagLines();
      if (diagLines.length > 0) {
        const actual = diagLines.join("\n");
        const expected = stripWarnings(testCase.expectedResult.trim());
        if (stripDiagRanges(actual) === stripDiagRanges(expected)) return makeResult("passed");

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
          // Match OMC's output order: boilerplate first, then diagnostics
          reformatActual = `Error processing file: ${path.basename(testCase.file)}\n# Error encountered! Exiting...\n# Please check the error message and the flags.\n\n${uniqueOmcDiagLines.join("\n")}${errorLine}\n\nExecution failed!`;
          if (stripDiagRanges(reformatActual) === stripDiagRanges(expected)) return makeResult("passed");
        }

        if (updateMode && !omcMode) {
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
        if (updateMode && !omcMode) {
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
      if (updateMode && !omcMode) {
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
    if (updateMode && !omcMode) {
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
