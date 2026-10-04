// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Converts a CTRF JSON test report into a LaTeX table for academic papers and benchmarking.
 * Supports comparing WASM and JS/TS implementations side-by-side or formatting single-backend reports.
 *
 * Usage:
 *   npx tsx tests/ctrf-to-latex.ts [input.json] [output.tex]
 *   npx tsx tests/ctrf-to-latex.ts [wasm.json] [js.json] [output.tex]
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
  extra?: {
    backend?: string;
    [key: string]: unknown;
  };
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

function normalizeSuite(s: string): string {
  // Strip backend suffixes like "arrays (wasm)" or "arrays (js)"
  const clean = s.replace(/\s*\((?:wasm|js|ts)\)$/i, "").trim();
  return MAIN_SUITES[clean] || clean;
}

function getTestBackend(t: CtrfTest): string {
  if (t.extra?.backend) return String(t.extra.backend);
  if (t.name.includes("[wasm]")) return "wasm";
  if (t.name.includes("[js]") || t.name.includes("[ts]")) return "js";
  return "";
}

export function generateLatexTable(inputPath1: string, inputPath2OrOut?: string, finalOut?: string): string {
  let wasmReport: CtrfReport | null = null;
  let jsReport: CtrfReport | null = null;
  let singleReport: CtrfReport | null = null;
  let outputPath: string | undefined;

  if (inputPath2OrOut && inputPath2OrOut.endsWith(".json")) {
    // Two input files: wasm and js
    const rep1: CtrfReport = JSON.parse(fs.readFileSync(inputPath1, "utf-8"));
    const rep2: CtrfReport = JSON.parse(fs.readFileSync(inputPath2OrOut, "utf-8"));
    outputPath = finalOut;

    if (inputPath1.includes("wasm")) {
      wasmReport = rep1;
      jsReport = rep2;
    } else {
      jsReport = rep1;
      wasmReport = rep2;
    }
  } else {
    // Single input file
    outputPath = inputPath2OrOut;
    singleReport = JSON.parse(fs.readFileSync(inputPath1, "utf-8"));

    const tests = singleReport.results.tests;
    const hasWasm = tests.some((t) => getTestBackend(t) === "wasm");
    const hasJs = tests.some((t) => getTestBackend(t) === "js" || getTestBackend(t) === "ts");

    if (hasWasm && hasJs) {
      wasmReport = {
        results: {
          ...singleReport.results,
          tests: tests.filter((t) => getTestBackend(t) === "wasm"),
        },
      };
      jsReport = {
        results: {
          ...singleReport.results,
          tests: tests.filter((t) => getTestBackend(t) === "js" || getTestBackend(t) === "ts"),
        },
      };
    }
  }

  // Dual-backend comparison mode
  if (wasmReport && jsReport) {
    const wasmStats = new Map<string, { total: number; passed: number }>();
    const jsStats = new Map<string, { total: number; passed: number }>();

    for (const t of wasmReport.results.tests) {
      const s = normalizeSuite(t.suite || "unknown");
      const cur = wasmStats.get(s) || { total: 0, passed: 0 };
      cur.total += 1;
      if (t.status === "passed") cur.passed += 1;
      wasmStats.set(s, cur);
    }

    for (const t of jsReport.results.tests) {
      const s = normalizeSuite(t.suite || "unknown");
      const cur = jsStats.get(s) || { total: 0, passed: 0 };
      cur.total += 1;
      if (t.status === "passed") cur.passed += 1;
      jsStats.set(s, cur);
    }

    let totalModels = 0;
    let wasmTotalPassed = 0;
    let jsTotalPassed = 0;

    const lines: string[] = [
      "\\begin{table}[H]",
      "    \\centering",
      "    \\caption{Flattening correctness comparison between WebAssembly and JavaScript implementations across the OpenModelica test suite.}",
      "    \\label{tab:flattening_comparison}",
      "    \\resizebox{\\columnwidth}{!}{",
      "    \\begin{tabular}{lrrrrr}",
      "        \\toprule",
      "        \\textbf{Category} & \\textbf{Total} & \\textbf{JS Passed} & \\textbf{JS Rate} & \\textbf{WASM Passed} & \\textbf{WASM Rate} \\\\",
      "        \\midrule",
    ];

    for (const [sectionName, suiteList] of SECTIONS) {
      lines.push(`        \\multicolumn{6}{l}{\\textit{${sectionName}}} \\\\`);
      for (const s of suiteList) {
        const j = jsStats.get(s) || { total: 0, passed: 0 };
        const w = wasmStats.get(s) || { total: 0, passed: 0 };
        const total = Math.max(j.total, w.total);
        const jRate = total > 0 ? (j.passed / total) * 100 : 0.0;
        const wRate = total > 0 ? (w.passed / total) * 100 : 0.0;

        totalModels += total;
        jsTotalPassed += j.passed;
        wasmTotalPassed += w.passed;

        lines.push(
          `        \\hspace{1em} ${s} & ${total} & ${j.passed} & ${jRate.toFixed(1)}\\% & ${w.passed} & ${wRate.toFixed(1)}\\% \\\\`,
        );
      }
      lines.push("        \\midrule");
    }

    const jsOverallRate = totalModels > 0 ? (jsTotalPassed / totalModels) * 100 : 0.0;
    const wasmOverallRate = totalModels > 0 ? (wasmTotalPassed / totalModels) * 100 : 0.0;

    lines.push(
      `        \\textbf{Total} & \\textbf{${totalModels}} & \\textbf{${jsTotalPassed}} & \\textbf{${jsOverallRate.toFixed(1)}\\%} & \\textbf{${wasmTotalPassed}} & \\textbf{${wasmOverallRate.toFixed(1)}\\%} \\\\`,
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
      console.log(`LaTeX comparison table written to ${outputPath}`);

      const metricsPath = path.join(outDir, "flattening_metrics.tex");
      const metricsContent = [
        `\\newcommand{\\FlatteningTotalModels}{${totalModels}}`,
        `\\newcommand{\\FlatteningJsPassedModels}{${jsTotalPassed}}`,
        `\\newcommand{\\FlatteningJsOverallPassRate}{${jsOverallRate.toFixed(1)}}`,
        `\\newcommand{\\FlatteningWasmPassedModels}{${wasmTotalPassed}}`,
        `\\newcommand{\\FlatteningWasmOverallPassRate}{${wasmOverallRate.toFixed(1)}}`,
        "",
      ].join("\n");
      fs.writeFileSync(metricsPath, metricsContent, "utf-8");
      console.log(`LaTeX metrics successfully written to ${metricsPath}`);
    }

    return latexContent;
  }

  // Single-backend mode (default)
  const rep = singleReport!;
  const stats = new Map<string, { total: number; passed: number }>();
  for (const t of rep.results.tests) {
    const s = normalizeSuite(t.suite || "unknown");
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
if (process.argv[1] && (process.argv[1].endsWith("ctrf-to-latex.ts") || process.argv[1].endsWith("ctrf-to-latex.js"))) {
  const arg1 = process.argv[2] || "ctrf/ctrf-testsuite-report.json";
  const arg2 = process.argv[3];
  const arg3 = process.argv[4];
  const result = generateLatexTable(arg1, arg2, arg3);

  if (!arg2 || (arg2.endsWith(".json") && !arg3)) {
    console.log(result);
  }
}
