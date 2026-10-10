// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CtrfTest {
  name: string;
  duration: number;
  cpuTime: number;
  status: "passed" | "failed" | "skipped" | "pending";
  rawStatus: string;
  type: string;
  filePath: string;
  suite: string;
  message?: string;
  keywords?: string;
  testStatus?: string;
  extra?: {
    xfail?: boolean | string;
    backend?: string;
  };
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
    tests: CtrfTest[];
  };
}

interface FailureClassification {
  id: string;
  category: string;
  subCategory: string;
  reason: string;
}

export function classifyFailure(test: CtrfTest): FailureClassification {
  const msg = test.message ?? "";
  const isIncorrectTest = test.testStatus === "incorrect";

  // 1. Timeout / Crashes
  if (msg.includes("timed out after")) {
    return {
      id: "CRASH_TIMEOUT",
      category: "Compiler Hang / Infinite Loop",
      subCategory: "Worker Timeout",
      reason: "Compilation or flattening exceeded timeout threshold",
    };
  }
  if (
    msg.includes("RuntimeError: unreachable") ||
    msg.includes("memory access out of bounds") ||
    msg.includes("wasm-function")
  ) {
    return {
      id: "CRASH_WASM_PANIC",
      category: "WASM Kernel Panic / Unreachable",
      subCategory: "WASM Memory / Assertion Trap",
      reason: "WASM memory access trap or unreachable instruction triggered during AST lowering",
    };
  }

  // 2. Negative Tests (Expected compile failure, but flattener succeeded)
  if (msg.includes("Expected flattening to fail but got result")) {
    if (msg.includes("redeclare") || test.filePath.includes("redeclare")) {
      return {
        id: "NEG_REDECLARE",
        category: "Negative Tests: Missing Semantic Validation",
        subCategory: "Missing Redeclare Validation",
        reason: "Invalid redeclaration accepted without compile-time error",
      };
    }
    if (msg.includes("modification") || test.filePath.includes("modification")) {
      return {
        id: "NEG_MODIFICATION",
        category: "Negative Tests: Missing Semantic Validation",
        subCategory: "Missing Modification Validation",
        reason: "Invalid or duplicate modification accepted without error",
      };
    }
    if (test.filePath.includes("types") || msg.includes("type")) {
      return {
        id: "NEG_TYPE_CHECK",
        category: "Negative Tests: Missing Semantic Validation",
        subCategory: "Missing Type Checking Validation",
        reason: "Type mismatch or invalid type operation accepted without error",
      };
    }
    if (test.filePath.includes("arrays") || msg.includes("array") || msg.includes("dimension")) {
      return {
        id: "NEG_ARRAY_DIMS",
        category: "Negative Tests: Missing Semantic Validation",
        subCategory: "Missing Array Dimension Validation",
        reason: "Invalid array dimension, bounds, or dimension modifier accepted without error",
      };
    }
    return {
      id: "NEG_OTHER",
      category: "Negative Tests: Missing Semantic Validation",
      subCategory: "Missing Static Semantics Diagnostic",
      reason: "Invalid model specification accepted without error",
    };
  }

  // 3. Diagnostic text / formatting mismatch in negative tests
  if (isIncorrectTest || msg.includes("Error processing file:")) {
    if (msg.includes("Syntax Error") || msg.includes("syntax error")) {
      return {
        id: "DIAG_SYNTAX_VS_SEMANTIC",
        category: "Diagnostic Formatting & Location Discrepancies",
        subCategory: "Syntax Error vs Semantic Error Mismatch",
        reason: "Parser threw syntax error where OMC expected a semantic check, or vice versa",
      };
    }
    return {
      id: "DIFF_DIAGNOSTIC_FORMATTING",
      category: "Diagnostic Formatting & Location Discrepancies",
      subCategory: "Diagnostic Message / Location Span Mismatch",
      reason: "Diagnostic wording, error code, or source line:col range differs from OMC expectation",
    };
  }

  // 4. Parser & Grammar syntax errors on valid models
  if (msg.includes("Syntax error:") || msg.includes("Failed to parse") || msg.includes("Parse error")) {
    if (msg.includes("algorithm") || msg.includes("when ") || msg.includes("for ")) {
      return {
        id: "SYNTAX_ALGORITHM_SECTION",
        category: "Parser & Grammar",
        subCategory: "Algorithm Section Syntax",
        reason: "Syntax error in algorithm statements or conditional branches",
      };
    }
    if (msg.includes("replaceable") || msg.includes("extends")) {
      return {
        id: "SYNTAX_REPLACEABLE_EXTENDS",
        category: "Parser & Grammar",
        subCategory: "Replaceable / Extends Syntax",
        reason: "Syntax error parsing replaceable element or extends clause",
      };
    }
    if (msg.includes("package") || test.filePath.includes("msl") || test.filePath.includes("packages")) {
      return {
        id: "SYNTAX_MSL_PACKAGE",
        category: "Parser & Grammar",
        subCategory: "Package & Encapsulation Syntax",
        reason: "Parser rejected nested package declaration or qualification syntax",
      };
    }
    return {
      id: "SYNTAX_OTHER",
      category: "Parser & Grammar",
      subCategory: "General Syntax Parse Failure",
      reason: "Native GLR parser rejected valid Modelica construct",
    };
  }

  // 5. Semantic Errors on Valid Models (Flattening returned null)
  if (msg.includes("Flattening returned null") || msg.includes("Diagnostics:")) {
    if (msg.includes("[M2002]") || (msg.includes("Variable") && msg.includes("not found in scope"))) {
      return {
        id: "SEM_M2002_VAR_NOT_FOUND",
        category: "Name Resolution & Scope",
        subCategory: "Variable Not Found (M2002)",
        reason: "Identifier lookup failed in hierarchical or lexical scope",
      };
    }
    if (msg.includes("[M2003]") || (msg.includes("Class") && msg.includes("not found in scope"))) {
      return {
        id: "SEM_M2003_CLASS_NOT_FOUND",
        category: "Name Resolution & Scope",
        subCategory: "Class Not Found (M2003)",
        reason: "Class or type specifier not resolved in lexical/inherited scopes",
      };
    }
    if (msg.includes("[M5001]") || msg.includes("Type mismatch in equation")) {
      return {
        id: "SEM_M5001_EQ_TYPE_MISMATCH",
        category: "Type Checking & Semantics",
        subCategory: "Equation Type Mismatch (M5001)",
        reason: "Type mismatch between equation LHS and RHS",
      };
    }
    if (msg.includes("[M3001]") || msg.includes("Type mismatch in binding")) {
      return {
        id: "SEM_M3001_BINDING_MISMATCH",
        category: "Type Checking & Semantics",
        subCategory: "Binding Type Mismatch (M3001)",
        reason: "Component declaration binding expression type incompatibility",
      };
    }
    if (msg.includes("[M4019]") || msg.includes("marked replaceable") || msg.includes("Redeclaration of")) {
      return {
        id: "SEM_M4019_REDECLARE",
        category: "Redeclaration & Subtyping",
        subCategory: "Redeclare Requires Replaceable (M4019)",
        reason: "Redeclaration rejected because target element was not marked replaceable",
      };
    }
    if (
      msg.includes("[M3003]") ||
      msg.includes("[M3004]") ||
      msg.includes("connect") ||
      msg.includes("plug-compatible")
    ) {
      return {
        id: "SEM_M3003_CONNECTOR",
        category: "Connections & Connectors",
        subCategory: "Connector Compatibility (M3003/M3004)",
        reason: "Connect statement rejected due to plug compatibility or connector check",
      };
    }
    if (msg.includes("specialization") || msg.includes("class specialization")) {
      return {
        id: "SEM_PACKAGE_SPECIALIZATION",
        category: "Class Specialization & Instantiation Restrictions",
        subCategory: "Class Specialization Restriction",
        reason: "Package or partial class directly instantiated without model context",
      };
    }
    return {
      id: "SEM_OTHER_DIAGNOSTIC",
      category: "Semantic Diagnostics & Analysis",
      subCategory: "Unexpected Semantic Error",
      reason: "Flattener emitted blocking diagnostic on valid model",
    };
  }

  // 6. DAE Lowering & Formatting Output Mismatches
  if (msg.includes("Output mismatch:")) {
    // Array indexing / slicing
    if (
      /\[\d+(,\s*\d+)*\]/.test(msg) ||
      msg.includes("fill(") ||
      msg.includes("cat(") ||
      msg.includes(".-") ||
      msg.includes(".+") ||
      msg.includes(".*") ||
      msg.includes("./") ||
      test.suite === "arrays"
    ) {
      return {
        id: "DIFF_ARRAY_LOWERING",
        category: "Arrays & DAE Lowering",
        subCategory: "Array Expansion / Indexing / Slicing",
        reason: "Differences in scalarized array indexing, multi-index layout, or element-wise operators",
      };
    }

    // Final prefix formatting
    if (
      msg.includes("final parameter") ||
      msg.includes("final Real") ||
      msg.includes("final Integer") ||
      msg.includes("final Boolean")
    ) {
      return {
        id: "DIFF_FINAL_PREFIX",
        category: "Flattener AST / Code Generation",
        subCategory: "Modifier 'final' Prefix Discrepancy",
        reason: "Flattener emits 'final' attribute differently from OMC output formatting",
      };
    }

    // Attributes (start, fixed, min, max)
    if (msg.includes("start =") || msg.includes("fixed =") || msg.includes("min =") || msg.includes("max =")) {
      return {
        id: "DIFF_ATTRIBUTES",
        category: "Flattener AST / Code Generation",
        subCategory: "Attribute Modifiers (start / fixed / min / max)",
        reason: "Discrepancy in merged attribute modifiers or start value evaluation",
      };
    }

    // Algorithm sections
    if (msg.includes("algorithm") || msg.includes("when ") || msg.includes("for ") || msg.includes("while ")) {
      return {
        id: "DIFF_ALGORITHM",
        category: "Algorithms & Statements",
        subCategory: "Algorithm Section Lowering Discrepancy",
        reason: "Algorithm statements (when/while/for/assign) lowered or formatted differently",
      };
    }

    // Equation ordering / polarity
    if (msg.includes("equation") && (msg.includes("der(") || msg.includes(" = "))) {
      return {
        id: "DIFF_EQUATION_ORDERING",
        category: "Flattener AST / Code Generation",
        subCategory: "Equation Ordering / Expression Canonicalization",
        reason: "Order of flattened equations or expression parenthesis/canonical form differs from OMC",
      };
    }

    // Component declarations ordering
    if (msg.includes("parameter ") || msg.includes("Real ") || msg.includes("Integer ")) {
      return {
        id: "DIFF_COMPONENT_ORDERING",
        category: "Flattener AST / Code Generation",
        subCategory: "Component Declaration Discrepancy",
        reason: "Variable typing, ordering, or prefix emission differs from OMC ground truth",
      };
    }

    return {
      id: "DIFF_OTHER_FORMATTING",
      category: "Flattener AST / Code Generation",
      subCategory: "Output Text Formatting / Canonical Diff",
      reason: "General text diff against OMC ground truth",
    };
  }

  return {
    id: "OTHER_UNCATEGORIZED",
    category: "Other / Uncategorized",
    subCategory: "Unclassified Mismatch",
    reason: msg.slice(0, 100),
  };
}

async function main() {
  const reportPath = path.resolve(__dirname, "../ctrf/ctrf-testsuite-report.json");
  if (!fs.existsSync(reportPath)) {
    console.error(`Report file not found: ${reportPath}`);
    process.exit(1);
  }

  const report: CtrfReport = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  const tests = report.results.tests ?? [];

  const passedTests = tests.filter((t) => t.status === "passed");
  const failedTests = tests.filter((t) => t.status === "failed");
  const skippedTests = tests.filter((t) => t.status === "skipped" || t.status === "pending");

  const xpassTests = passedTests.filter((t) => Boolean(t.extra?.xfail));
  const baselinePassed = passedTests.filter((t) => !t.extra?.xfail);
  const expectedFails = failedTests.filter((t) => Boolean(t.extra?.xfail));
  const regressions = failedTests.filter((t) => !t.extra?.xfail);

  console.log(`\nLoaded ${tests.length} test results:`);
  console.log(`  Passed (Baseline):     ${baselinePassed.length}`);
  console.log(`  Passed (XPass):        ${xpassTests.length}`);
  console.log(`  Failed (Regressions):  ${regressions.length}`);
  console.log(`  Failed (XFail):        ${expectedFails.length}`);
  console.log(`  Skipped:               ${skippedTests.length}`);

  // Group by suite
  const suiteStats: Record<
    string,
    { total: number; passed: number; xpass: number; regressions: number; xfail: number; skipped: number }
  > = {};
  for (const t of tests) {
    if (!suiteStats[t.suite]) {
      suiteStats[t.suite] = { total: 0, passed: 0, xpass: 0, regressions: 0, xfail: 0, skipped: 0 };
    }
    const s = suiteStats[t.suite]!;
    s.total++;
    if (t.status === "passed") {
      if (t.extra?.xfail) s.xpass++;
      else s.passed++;
    } else if (t.status === "failed") {
      if (t.extra?.xfail) s.xfail++;
      else s.regressions++;
    } else {
      s.skipped++;
    }
  }

  // Classify failures
  interface CategoryAgg {
    category: string;
    total: number;
    regressions: number;
    xfails: number;
    subCategories: Record<
      string,
      {
        subCategory: string;
        reason: string;
        total: number;
        regressions: number;
        xfails: number;
        examples: string[];
      }
    >;
  }

  interface DetailedRootCause {
    id: string;
    title: string;
    description: string;
    regressions: number;
    xfails: number;
    total: number;
    suites: Record<string, number>;
    examples: { file: string; suite: string; snippet: string }[];
  }

  const categoryMap = new Map<string, CategoryAgg>();
  const detailedMap = new Map<string, DetailedRootCause>();

  for (const t of failedTests) {
    const cls = classifyFailure(t);
    const isXfail = Boolean(t.extra?.xfail);

    // High level category aggregation
    if (!categoryMap.has(cls.category)) {
      categoryMap.set(cls.category, {
        category: cls.category,
        total: 0,
        regressions: 0,
        xfails: 0,
        subCategories: {},
      });
    }
    const cat = categoryMap.get(cls.category)!;
    cat.total++;
    if (isXfail) cat.xfails++;
    else cat.regressions++;

    if (!cat.subCategories[cls.subCategory]) {
      cat.subCategories[cls.subCategory] = {
        subCategory: cls.subCategory,
        reason: cls.reason,
        total: 0,
        regressions: 0,
        xfails: 0,
        examples: [],
      };
    }
    const sub = cat.subCategories[cls.subCategory]!;
    sub.total++;
    if (isXfail) sub.xfails++;
    else sub.regressions++;
    const relFile = path.relative(path.resolve(__dirname, "../testsuite/OpenModelica/flattening/modelica"), t.filePath);
    if (sub.examples.length < 5 && !sub.examples.includes(relFile)) {
      sub.examples.push(relFile);
    }

    // Detailed root cause aggregation
    if (!detailedMap.has(cls.id)) {
      detailedMap.set(cls.id, {
        id: cls.id,
        title: `${cls.category}: ${cls.subCategory}`,
        description: cls.reason,
        regressions: 0,
        xfails: 0,
        total: 0,
        suites: {},
        examples: [],
      });
    }
    const det = detailedMap.get(cls.id)!;
    det.total++;
    if (isXfail) det.xfails++;
    else det.regressions++;
    det.suites[t.suite] = (det.suites[t.suite] ?? 0) + 1;
    if (det.examples.length < 5) {
      det.examples.push({
        file: t.name,
        suite: t.suite,
        snippet: (t.message ?? "").slice(0, 200),
      });
    }
  }

  const categorizedList = Array.from(categoryMap.values())
    .map((c) => ({
      category: c.category,
      total: c.total,
      regressions: c.regressions,
      xfails: c.xfails,
      subCategories: Object.values(c.subCategories).sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);

  const detailedList = Array.from(detailedMap.values()).sort((a, b) => b.total - a.total);

  const ctrfDir = path.resolve(__dirname, "../ctrf");
  fs.writeFileSync(path.join(ctrfDir, "categorized-failures.json"), JSON.stringify(categorizedList, null, 2) + "\n");
  fs.writeFileSync(path.join(ctrfDir, "detailed-root-causes.json"), JSON.stringify(detailedList, null, 2) + "\n");

  console.log(`\nWrote updated categorizations to:`);
  console.log(`  - ${path.join(ctrfDir, "categorized-failures.json")}`);
  console.log(`  - ${path.join(ctrfDir, "detailed-root-causes.json")}`);
}

main().catch(console.error);
