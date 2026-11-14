// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { simulateArena } from "@modelscript/simulate";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

const HARMONIC_MO = `model HarmonicOscillator
  Real x(start = 1.0, fixed = true);
  Real v(start = 0.0, fixed = true);
equation
  der(x) = v;
  der(v) = -x;
end HarmonicOscillator;
`;

export const modelicaBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "modelica",
  referenceTool: "OpenModelica (omc) / Analytical Cosine",
  defaultTolerance: 1e-4,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const { parser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", parser as never);
    await initBltWasm();

    const ctx = new Context(new NodeFileSystem());
    const uri = "file:///HarmonicOscillator.mo";
    ctx.load(HARMONIC_MO, uri);

    const t0 = performance.now();
    const arena = ctx.flattenArena("HarmonicOscillator", undefined, uri);
    const d1 = performance.now() - t0;

    if (!arena) {
      return [
        {
          id: "modelica-harmonic-flatten",
          name: "HarmonicOscillator Arena Flattening",
          scale: "micro",
          referenceTool: "OpenModelica (omc) / Analytical Cosine",
          metricKind: "dae-parity",
          threshold: 0,
          measuredError: 1,
          passed: false,
          durationMs: d1,
          details: "flattenArena returned null",
        },
      ];
    }

    const t1 = performance.now();
    const res = simulateArena(arena, { startTime: 0, stopTime: 2 * Math.PI, step: 0.01, solver: "dopri5" });
    const d2 = performance.now() - t1;

    const xIdx = arena.variables().findIndex((v) => v.name === "x");
    const xFinal = xIdx >= 0 ? (res.y[res.y.length - 1]?.[xIdx] ?? 0) : 0;
    const err = Math.abs(xFinal - 1.0);

    const nonDerVars = arena.variables().filter((v) => !v.name.startsWith("der("));

    return [
      {
        id: "modelica-harmonic-flatten",
        name: "HarmonicOscillator Arena Flattening (DAEBuilder)",
        scale: "micro",
        referenceTool: "OpenModelica (omc) / Analytical Cosine",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: Math.abs(nonDerVars.length - arena.eqCount),
        passed: nonDerVars.length === arena.eqCount && arena.eqCount === 2,
        durationMs: d1,
        details: `${nonDerVars.length} vars x ${arena.eqCount} eqs (${arena.varCount} arena slots)`,
      },
      {
        id: "modelica-harmonic-dopri5",
        name: "HarmonicOscillator DOPRI5 1-Period (2*pi) Analytical Parity",
        scale: "standard",
        referenceTool: "OpenModelica (omc) / Analytical Cosine",
        metricKind: "max-relative-error",
        threshold: 1e-4,
        measuredError: err,
        passed: err < 1e-4,
        durationMs: d2,
        details: `x(2pi)=${xFinal.toFixed(6)} (exact 1.0), err=${err.toExponential(2)}`,
      },
    ];
  },
};

if (process.argv[1]?.endsWith("modelica-benchmark-runner.ts")) {
  console.log(JSON.stringify(await modelicaBenchmarkAdapter.runCases({ tolerance: 1e-4 }), null, 2));
}
