// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

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
  extra?: { xfail?: boolean | string };
}

interface CtrfReport {
  results: {
    tests: CtrfTest[];
  };
}

const reportPath = path.resolve(import.meta.dirname, "../ctrf/ctrf-testsuite-report.json");
const report: CtrfReport = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
const failed = report.results.tests.filter((t) => t.status === "failed");

console.log("Analyzing Phase 2 tests (Flattener AST / Code Generation & Formatting)...");

const phase2Tests = failed.filter((t) => {
  const m = t.message || "";
  return m.includes("Output mismatch:") && !m.includes("Error processing file:");
});

console.log(`Found ${phase2Tests.length} tests with output mismatches.\n`);

// Group by subcategory
const groups: Record<string, { tests: CtrfTest[]; count: number }> = {
  arrays: { tests: [], count: 0 },
  final_modifier: { tests: [], count: 0 },
  equation_order: { tests: [], count: 0 },
  declarations: { tests: [], count: 0 },
  algorithm: { tests: [], count: 0 },
  attributes: { tests: [], count: 0 },
  other: { tests: [], count: 0 },
};

for (const t of phase2Tests) {
  const m = t.message || "";
  if (/\[\d+(,\s*\d+)*\]/.test(m) && (t.suite === "arrays" || m.includes("fill(") || m.includes("{"))) {
    groups.arrays.tests.push(t);
    groups.arrays.count++;
  } else if (m.includes("final parameter") || m.includes("final Real") || m.includes("final Integer")) {
    groups.final_modifier.tests.push(t);
    groups.final_modifier.count++;
  } else if (m.includes("algorithm") || m.includes("when ") || m.includes("for ") || m.includes("while ")) {
    groups.algorithm.tests.push(t);
    groups.algorithm.count++;
  } else if (m.includes("start =") || m.includes("fixed =") || m.includes("min =") || m.includes("max =")) {
    groups.attributes.tests.push(t);
    groups.attributes.count++;
  } else if (m.includes("equation")) {
    groups.equation_order.tests.push(t);
    groups.equation_order.count++;
  } else if (m.includes("parameter ") || m.includes("Real ") || m.includes("Integer ")) {
    groups.declarations.tests.push(t);
    groups.declarations.count++;
  } else {
    groups.other.tests.push(t);
    groups.other.count++;
  }
}

for (const [key, g] of Object.entries(groups)) {
  console.log(`=== ${key.toUpperCase()}: ${g.count} tests ===`);
  for (const t of g.tests.slice(0, 3)) {
    console.log(`  • [${t.suite}] ${t.name}`);
    const lines = (t.message || "").split("\n");
    const diffStart = lines.findIndex((l) => l.includes("--- Expected ---"));
    if (diffStart >= 0) {
      console.log(`    Diff preview:`);
      for (const dl of lines.slice(diffStart, diffStart + 12)) {
        console.log(`      ${dl}`);
      }
    } else {
      console.log(`    ${lines.slice(0, 5).join(" | ")}`);
    }
  }
  console.log();
}
