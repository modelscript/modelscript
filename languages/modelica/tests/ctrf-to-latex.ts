// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Converts a CTRF JSON test report into a LaTeX table for the paper.
 *
 * Usage:
 *   npx tsx tests/ctrf-to-latex.ts [input.json] [output.tex]
 *
 * Examples:
 *   npx tsx tests/ctrf-to-latex.ts
 *   npx tsx tests/ctrf-to-latex.ts ctrf/ctrf-testsuite-report.json /home/omar/Desktop/amc2026-final/tables/flattening_correctness.tex
 */

import fs from "node:fs";
import path from "node:path";

interface CtrfTest {
  name: string;
  duration?: number;
  cpuTime?: number;
  status: string;
  suite?: string;
  message?: string;
}

interface CtrfReport {
  results: {
    summary: {
      tests: number;
      passed: number;
      failed: number;
      pending: number;
      start: number;
      stop: number;
      cpuTime?: number;
    };
    tests: CtrfTest[];
  };
}

const SECTIONS: [string, string[]][] = [
  ["Complex Instantiations", ["scodeinst"]],
  ["Object-Oriented \\& Architecture", ["modification", "connectors", "redeclare", "extends", "scoping", "packages"]],
  ["Data Structures \\& Types", ["arrays", "declarations", "records", "enums", "types"]],
  ["Mathematics \\& Logic", ["algorithms-functions", "built-in-functions", "equations", "operators"]],
  [
    "Advanced \\& External",
    [
      "others",
      "mosfiles",
      "msl",
      "ffi",
      "synchronous",
      "external-functions",
      "streams",
      "expandable",
      "asserts",
      "statemachines",
      "blocks",
      "external-objects",
      "modelica-output",
    ],
  ],
];

// Map sub-suites to parent suite names (e.g., subdirectories under mosfiles)
const MAIN_SUITES: Record<string, string> = {
  Duplicate: "mosfiles",
  FFITest: "mosfiles",
  Invalid: "mosfiles",
  "Modelica 3.1": "mosfiles",
  "Modelica 3.2": "mosfiles",
  "Modelica 3.2.1": "mosfiles",
  "Modelica 3.3 beta1": "mosfiles",
  "Modelica 3.5 beta1": "mosfiles",
  TestLibrary: "mosfiles",
};

export function generateLatexTable(inputPath: string, outputPath?: string): string {
  const report: CtrfReport = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  const { tests } = report.results;

  const stats = new Map<string, { total: number; passed: number }>();
  for (const t of tests) {
    let s = t.suite || "unknown";
    s = MAIN_SUITES[s] || s;
    const current = stats.get(s) || { total: 0, passed: 0 };
    current.total += 1;
    if (t.status === "passed") {
      current.passed += 1;
    }
    stats.set(s, current);
  }

  let totalModels = 0;
  let totalPassed = 0;

  const lines: string[] = [
    "\\begin{table}[H]",
    "    \\centering",
    "    \\caption{Flattening correctness results across the OpenModelica modelica flattening test suite categories.}",
    "    \\label{tab:flattening_results}",
    "    \\resizebox{\\columnwidth}{!}{",
    "    \\begin{tabular}{lrrr}",
    "        \\toprule",
    "        \\textbf{Category} & \\textbf{Total Models} & \\textbf{Passed} & \\textbf{Pass Rate} \\\\",
    "        \\midrule",
  ];

  for (const [sectionName, suiteList] of SECTIONS) {
    lines.push(`        \\multicolumn{4}{l}{\\textit{${sectionName}}} \\\\`);
    for (const s of suiteList) {
      const st = stats.get(s) || { total: 0, passed: 0 };
      const rate = st.total > 0 ? (st.passed / st.total) * 100 : 0.0;
      totalModels += st.total;
      totalPassed += st.passed;
      lines.push(`        \\hspace{1em} ${s} & ${st.total} & ${st.passed} & ${rate.toFixed(1)}\\% \\\\`);
    }
    lines.push("        \\midrule");
  }

  const overallRate = totalModels > 0 ? (totalPassed / totalModels) * 100 : 0.0;
  lines.push(
    `        \\textbf{Total} & \\textbf{${totalModels}} & \\textbf{${totalPassed}} & \\textbf{${overallRate.toFixed(1)}\\%} \\\\`,
  );
  lines.push("        \\bottomrule");
  lines.push("    \\end{tabular}");
  lines.push("    }");
  lines.push("\\end{table}");
  lines.push("");

  const latexContent = lines.join("\n");

  if (outputPath) {
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, latexContent, "utf-8");
    console.log(`LaTeX table successfully written to ${outputPath}`);

    // If writing to a tables/ directory, also update flattening_metrics.tex
    const metricsPath = path.join(outDir, "flattening_metrics.tex");
    const calcRate = (key: string): string => {
      const s = stats.get(key);
      if (!s || s.total === 0) return "0.0";
      return ((s.passed / s.total) * 100).toFixed(1);
    };
    const modRate = calcRate("modification");
    const arrRate = calcRate("arrays");
    const scodeRate = calcRate("scodeinst");

    const metricsContent = [
      `\\newcommand{\\FlatteningTotalModels}{${totalModels}}`,
      `\\newcommand{\\FlatteningPassedModels}{${totalPassed}}`,
      `\\newcommand{\\FlatteningOverallPassRate}{${overallRate.toFixed(1)}}`,
      `\\newcommand{\\FlatteningModificationsPassRate}{${modRate}}`,
      `\\newcommand{\\FlatteningArraysPassRate}{${arrRate}}`,
      `\\newcommand{\\FlatteningScodeinstPassRate}{${scodeRate}}`,
      "",
    ].join("\n");

    fs.writeFileSync(metricsPath, metricsContent, "utf-8");
    console.log(`LaTeX metrics successfully written to ${metricsPath}`);
  }

  return latexContent;
}

// Standalone execution
const input = process.argv[2] || "ctrf/ctrf-testsuite-report.json";
const output = process.argv[3];
const result = generateLatexTable(input, output);

if (!output) {
  console.log(result);
}
