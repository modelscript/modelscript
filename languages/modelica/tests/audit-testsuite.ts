// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TestsuitePool, type TestCase, type TestResult } from "./testsuite-pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseTestsuiteRoot = path.resolve(__dirname, "../testsuite");
const flatteningRoot = path.resolve(baseTestsuiteRoot, "OpenModelica/flattening/modelica");
const WORKER_SCRIPT = path.resolve(__dirname, "testsuite-worker.ts");

function parseTestFile(filePath: string): TestCase | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

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
    if (status && line.startsWith("//")) {
      const descText = line.replace(/^\/\/\s?/, "").trim();
      if (descText && !descText.toLowerCase().startsWith("xfail:")) {
        descriptionLines.push(descText);
      }
      continue;
    }
    if (status && !line.startsWith("//")) break;
  }

  if (!name) name = path.basename(filePath, ".mo");
  if (!status) status = "correct";

  let arrayMode: "scalarize" | "preserve" | undefined = undefined;
  let fmiVersion: "2.0" | "3.0" | undefined = undefined;
  let simulate = false;
  let xfail: boolean | string | undefined = undefined;

  for (const line of lines) {
    const xfMatch = line.match(/^\/\/\s*xfail:\s*(.+)/i);
    if (xfMatch && xfMatch[1]) {
      const val = xfMatch[1].trim();
      xfail = val === "true" ? true : val === "false" ? false : val;
    }
    const amMatch = line.match(/^\/\/\s*arrayMode:\s*(preserve|scalarize)/);
    if (amMatch && amMatch[1]) arrayMode = amMatch[1] as "preserve" | "scalarize";
    const fmiMatch = line.match(/^\/\/\s*fmiVersion:\s*(2\.0|3\.0)/);
    if (fmiMatch && fmiMatch[1]) fmiVersion = fmiMatch[1] as "2.0" | "3.0";
    const simMatch = line.match(/^\/\/\s*simulate:\s*(true|false)/);
    if (simMatch && simMatch[1] === "true") simulate = true;
  }

  const resultStartIdx = lines.findIndex((l) => /^\/\/\s*Result:/.test(l));
  const resultEndIdx = lines.findIndex((l) => /^\/\/\s*endResult/.test(l));

  const sourceEnd = resultStartIdx >= 0 ? resultStartIdx : lines.length;
  const source = lines.slice(0, sourceEnd).join("\n").trim();

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
      ...(xfail !== undefined ? { xfail } : {}),
      simulate,
    },
    source,
    expectedResult,
  };
}

function findMoFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMoFiles(full));
    } else if (entry.name.endsWith(".mo") || entry.name.endsWith(".mos")) {
      results.push(full);
    }
  }
  return results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

interface FailureCategorization {
  category: string;
  subCategory: string;
  reason: string;
}

function categorizeFailure(testCase: TestCase, result: TestResult): FailureCategorization {
  const msg = result.message ?? "";
  const exp = testCase.expectedResult;

  if (msg.includes("timed out after")) {
    return {
      category: "Compiler Hang / Infinite Loop",
      subCategory: "Timeout",
      reason: "Worker timed out after execution threshold",
    };
  }

  if (
    msg.includes("RuntimeError: unreachable") ||
    msg.includes("memory access out of bounds") ||
    msg.includes("wasm-function")
  ) {
    return {
      category: "WASM Kernel Panic / Unreachable",
      subCategory: "AssemblyScript / WASM Exception",
      reason: "WASM trap during AST lowering or diagnostic extraction",
    };
  }

  if (msg.includes("Cannot instantiate") && msg.includes("due to class specialization")) {
    return {
      category: "Class Specialization & Instantiation Restrictions",
      subCategory: "Package / Partial Instantiation Restriction",
      reason: "Package or partial class directly instantiated without model context",
    };
  }

  if (msg.includes("[M5001]") || msg.includes("Type mismatch in equation")) {
    return {
      category: "Type Checking & Type Inference",
      subCategory: "Equation Type Mismatch (M5001)",
      reason: "Type mismatch between equation LHS and RHS",
    };
  }

  if (
    msg.includes("[M3001]") ||
    msg.includes("Type mismatch in binding") ||
    msg.includes("Type mismatch in modifier")
  ) {
    return {
      category: "Type Checking & Type Inference",
      subCategory: "Binding / Modifier Type Mismatch (M3001/M3002)",
      reason: "Component declaration binding or class modifier expression type incompatibility",
    };
  }

  if (msg.includes("Variable") && msg.includes("not found in scope")) {
    return {
      category: "Name Resolution & Scope Lookup",
      subCategory: "Variable Not Found (M2002)",
      reason: "Identifier lookup failed in hierarchical Salsa scopes",
    };
  }

  if (msg.includes("Class") && msg.includes("not found in scope")) {
    return {
      category: "Name Resolution & Scope Lookup",
      subCategory: "Class Not Found (M2003)",
      reason: "Class or type specifier not resolved in lexical/inherited scopes",
    };
  }

  if (msg.includes("Constant") && msg.includes("has no value")) {
    return {
      category: "Variability & Constant Folding",
      subCategory: "Unbound Constant Evaluation",
      reason: "Constant declaration missing initial binding or evaluated before resolution",
    };
  }

  if (msg.includes("Redeclaration of") || msg.includes("redeclare")) {
    return {
      category: "Inheritance & Modifications",
      subCategory: "Redeclaration Rules",
      reason: "Redeclare element modifier or class constraint mismatch",
    };
  }

  if (msg.includes("smooth(") || msg.includes("actual_stream") || msg.includes(".s1.f") || msg.includes(".s2.f")) {
    return {
      category: "Connection & Stream Semantics",
      subCategory: "Stream Connect Equations / smooth()",
      reason: "Stream connector flow-reversal equation formatting or smooth() wrapper",
    };
  }

  if (msg.includes("Expected flattening to fail but got result")) {
    return {
      category: "Diagnostic & Error Parity",
      subCategory: "Missing Negative Diagnostic",
      reason: "Test expected semantic failure but flattener succeeded",
    };
  }

  if (msg.includes("Flattening returned null (expected a result)")) {
    return {
      category: "Diagnostic & Error Parity",
      subCategory: "Unexpected Semantic Error",
      reason: "Flattener emitted blocking diagnostic on valid model",
    };
  }

  if (msg.includes("Output mismatch:")) {
    // Check if difference is binding in declaration vs equation section
    if (
      (msg.includes("equation\n") || msg.includes("equation")) &&
      (exp.includes(" = ") || msg.includes(" = ")) &&
      !msg.includes("Error:")
    ) {
      if (msg.includes("parameter ") || msg.includes("Integer ") || msg.includes("Real ")) {
        return {
          category: "DAE Printer & Emission Format",
          subCategory: "Binding in Declaration vs Equation Section",
          reason: "Literal bindings emitted as simple equations instead of declaration initializers",
        };
      }
    }

    if (msg.includes("Error processing file:") && exp.includes("Error processing file:")) {
      return {
        category: "Diagnostic & Error Parity",
        subCategory: "Diagnostic Message / Location Text Mismatch",
        reason: "Different diagnostic message wording, file path format, or line:col span from OMC",
      };
    }

    if (msg.includes(".+") || msg.includes(".-") || msg.includes(".*") || msg.includes("./")) {
      return {
        category: "Array & Matrix Operations",
        subCategory: "Element-wise Operators",
        reason: "Array element-wise vs scalarized operator representation diff",
      };
    }

    if (msg.includes("[") && msg.includes("]")) {
      return {
        category: "Array & Matrix Operations",
        subCategory: "Array Slicing / Scalarization",
        reason: "Array dimension scalarization or indexing discrepancy",
      };
    }

    return {
      category: "DAE Printer & Emission Format",
      subCategory: "Equation Ordering / Sign Normalization",
      reason: "Equations, variables, or comment annotations emitted in different order or polarity",
    };
  }

  return {
    category: "Other / Uncategorized",
    subCategory: "General Mismatch",
    reason: msg.slice(0, 100),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const includeScodeinst = args.includes("--all") || args.includes("scodeinst");
  const specificSuites = args.filter((a) => !a.startsWith("--"));

  console.log("===============================================================================");
  console.log("       ModelScript OpenModelica Flattening Testsuite Comprehensive Audit       ");
  console.log("===============================================================================\n");

  const entries = fs.readdirSync(flatteningRoot, { withFileTypes: true });
  const allSubdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const suitesToRun = allSubdirs.filter((s) => {
    if (specificSuites.length > 0) return specificSuites.includes(s);
    if (s === "scodeinst" && !includeScodeinst) return false;
    return true;
  });

  console.log(`Suites selected (${suitesToRun.length}):`, suitesToRun.join(", "));
  console.log(`Concurrency: 8 workers, Timeout per test: 12,000ms\n`);

  const pool = new TestsuitePool({
    concurrency: 8,
    workerScript: WORKER_SCRIPT,
    cwd: path.resolve(__dirname, ".."),
    testsuiteRoot: baseTestsuiteRoot,
    updateMode: false,
    omcMode: false,
    timeoutMs: 12_000,
    maxTestsPerWorker: 25,
  });

  interface SuiteReport {
    suite: string;
    total: number;
    passed: number;
    xpass: number;
    xfail: number;
    regressions: number;
    skipped: number;
    durationMs: number;
  }

  interface FullAuditResult {
    timestamp: string;
    summary: {
      totalTests: number;
      passed: number;
      xpass: number;
      xfail: number;
      regressions: number;
      skipped: number;
      effectivePassRate: string;
    };
    suites: SuiteReport[];
    categoryBreakdown: Record<
      string,
      {
        total: number;
        regressions: number;
        xfails: number;
        subCategories: Record<string, number>;
        sampleTests: { file: string; status: string; subCategory: string; reason: string }[];
      }
    >;
    regressionsList: { file: string; suite: string; category: string; subCategory: string; message: string }[];
    xpassList: { file: string; suite: string }[];
  }

  const allResults: { testCase: TestCase; result: TestResult; suite: string }[] = [];
  const suiteReports: SuiteReport[] = [];

  try {
    for (const suite of suitesToRun) {
      const suiteDir = path.join(flatteningRoot, suite);
      const moFiles = findMoFiles(suiteDir);

      let suitePassed = 0;
      let suiteXPass = 0;
      let suiteXFail = 0;
      let suiteRegressions = 0;
      let suiteSkipped = 0;
      const suiteStart = Date.now();

      const validTests: TestCase[] = [];
      for (const file of moFiles) {
        if (file.endsWith(".mos") || path.basename(file) === "Bug3817.mo") {
          suiteSkipped++;
          continue;
        }
        const tc = parseTestFile(file);
        if (!tc || tc.metadata.status === "skipped") {
          suiteSkipped++;
          continue;
        }
        validTests.push(tc);
      }

      process.stdout.write(`Running suite '${suite}' (${validTests.length} tests)... `);

      const suiteTestPromises = validTests.map(async (tc) => {
        const res = await pool.runTest(tc);
        allResults.push({ testCase: tc, result: res, suite });

        if (res.status === "passed") {
          if (res.xfail) suiteXPass++;
          else suitePassed++;
        } else if (res.status === "failed") {
          if (res.xfail) suiteXFail++;
          else suiteRegressions++;
        } else {
          suiteSkipped++;
        }
      });

      await Promise.all(suiteTestPromises);
      const suiteDuration = Date.now() - suiteStart;

      console.log(
        `done (${suiteDuration}ms) -> Pass: ${suitePassed}, XPass: ${suiteXPass}, Regress: ${suiteRegressions}, XFail: ${suiteXFail}, Skip: ${suiteSkipped}`,
      );

      suiteReports.push({
        suite,
        total: validTests.length + suiteSkipped,
        passed: suitePassed,
        xpass: suiteXPass,
        xfail: suiteXFail,
        regressions: suiteRegressions,
        skipped: suiteSkipped,
        durationMs: suiteDuration,
      });
    }
  } finally {
    await pool.shutdown();
  }

  // Aggregate Category Breakdown
  const categoryBreakdown: FullAuditResult["categoryBreakdown"] = {};
  const regressionsList: FullAuditResult["regressionsList"] = [];
  const xpassList: FullAuditResult["xpassList"] = [];

  let totalPassed = 0;
  let totalXPass = 0;
  let totalXFail = 0;
  let totalRegressions = 0;
  let totalSkipped = 0;

  for (const report of suiteReports) {
    totalPassed += report.passed;
    totalXPass += report.xpass;
    totalXFail += report.xfail;
    totalRegressions += report.regressions;
    totalSkipped += report.skipped;
  }

  for (const { testCase, result, suite } of allResults) {
    if (result.status === "passed" && result.xfail) {
      xpassList.push({ file: path.relative(flatteningRoot, testCase.file), suite });
    }

    if (result.status === "failed") {
      const cat = categorizeFailure(testCase, result);
      if (!categoryBreakdown[cat.category]) {
        categoryBreakdown[cat.category] = {
          total: 0,
          regressions: 0,
          xfails: 0,
          subCategories: {},
          sampleTests: [],
        };
      }
      const c = categoryBreakdown[cat.category]!;
      c.total++;
      if (result.xfail) {
        c.xfails++;
      } else {
        c.regressions++;
        regressionsList.push({
          file: path.relative(flatteningRoot, testCase.file),
          suite,
          category: cat.category,
          subCategory: cat.subCategory,
          message: (result.message ?? "").slice(0, 250),
        });
      }
      c.subCategories[cat.subCategory] = (c.subCategories[cat.subCategory] ?? 0) + 1;
      if (c.sampleTests.length < 5) {
        c.sampleTests.push({
          file: path.relative(flatteningRoot, testCase.file),
          status: result.xfail ? "xfail" : "regression",
          subCategory: cat.subCategory,
          reason: cat.reason,
        });
      }
    }
  }

  const grandTotal = totalPassed + totalXPass + totalXFail + totalRegressions + totalSkipped;
  const effectivePassRate =
    grandTotal > 0 ? (((totalPassed + totalXPass) / (grandTotal - totalSkipped)) * 100).toFixed(1) + "%" : "0%";

  const auditReport: FullAuditResult = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTests: grandTotal,
      passed: totalPassed,
      xpass: totalXPass,
      xfail: totalXFail,
      regressions: totalRegressions,
      skipped: totalSkipped,
      effectivePassRate,
    },
    suites: suiteReports,
    categoryBreakdown,
    regressionsList,
    xpassList,
  };

  const ctrfDir = path.resolve(__dirname, "../ctrf");
  fs.mkdirSync(ctrfDir, { recursive: true });
  const outPath = path.join(ctrfDir, "audit-summary.json");
  fs.writeFileSync(outPath, JSON.stringify(auditReport, null, 2), "utf-8");

  console.log("\n===============================================================================");
  console.log("                              AUDIT SUMMARY                                    ");
  console.log("===============================================================================");
  console.log(`Total Tests Run:     ${grandTotal}`);
  console.log(`Passed (baseline):   ${totalPassed}`);
  console.log(`XPass (unexpected):  ${totalXPass} (marked xfail but now passing!)`);
  console.log(`Regressions:         ${totalRegressions} (unexpected failures - highest priority)`);
  console.log(`XFail (expected):    ${totalXFail}`);
  console.log(`Skipped:             ${totalSkipped}`);
  console.log(`Effective Pass Rate: ${effectivePassRate}`);
  console.log(`Report written to:   ${outPath}\n`);

  console.log("=== Category Breakdown ===");
  for (const [catName, data] of Object.entries(categoryBreakdown)) {
    console.log(`\n* ${catName}: ${data.total} total (${data.regressions} regressions, ${data.xfails} xfails)`);
    for (const [sub, count] of Object.entries(data.subCategories)) {
      console.log(`    - ${sub}: ${count}`);
    }
  }

  if (regressionsList.length > 0) {
    console.log(`\n=== Unexpected Regressions (${regressionsList.length}) ===`);
    for (const reg of regressionsList) {
      console.log(`  ! [${reg.suite}] ${reg.file} -> ${reg.subCategory}`);
    }
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
