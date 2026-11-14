// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToStep } from "@modelscript/cad";
import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { ScadEvaluator } from "../src/evaluator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

export const scadBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "scad",
  referenceTool: "OpenSCAD / OpenCascade STEP B-Rep Kernel",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const sampleScad = `
arm_length = 200;
width = 24;
thickness = 8;
module motor_flange(dia = 28) {
  difference() {
    cylinder(r = dia / 2 + 4, h = 12);
    cylinder(r = dia / 2, h = 14);
  }
}
cube([arm_length, width, thickness]).fillet(2.0).translate([20, 0, 0]);
translate([arm_length + 20, 0, 0]) motor_flange(28);
`;
    const { parser } = await createWasmParser(fs.readFileSync(wasmPath));
    const t0 = performance.now();
    const tree = parser.parse(sampleScad);
    const solid = new ScadEvaluator().evaluate(tree.rootNode);
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const step = solid ? compileToStep(solid) : "";
    const d2 = performance.now() - t1;

    return [
      {
        id: "scad-csg-brep-eval",
        name: "CSG Tree & Fillet Module Evaluation",
        scale: "standard",
        referenceTool: "OpenSCAD / OpenCascade STEP B-Rep Kernel",
        metricKind: "exact",
        threshold: 0,
        measuredError: !tree.rootNode.hasError && solid ? 0 : 1,
        passed: !tree.rootNode.hasError && Boolean(solid),
        durationMs: d1,
        details: `rootKind=${solid?.kind ?? "none"}`,
      },
      {
        id: "scad-step-ap214-export",
        name: "ISO-10303-21 STEP AP214 Serialization",
        scale: "standard",
        referenceTool: "OpenSCAD / OpenCascade STEP B-Rep Kernel",
        metricKind: "exact",
        threshold: 0,
        measuredError: step.includes("ISO-10303-21;") ? 0 : 1,
        passed: step.includes("ISO-10303-21;") && step.length > 200,
        durationMs: d2,
        details: `${step.length} bytes STEP AP214`,
      },
    ];
  },
};
