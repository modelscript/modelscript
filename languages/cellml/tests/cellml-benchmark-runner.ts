// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerCellmlToDae } from "../src/dae/index.js";
import { parseCellml } from "../src/parser/index.js";
import { solveCellml } from "../src/solvers/index.js";

const DECAY_CELLML = `<?xml version="1.0" encoding="UTF-8"?>
<model name="first_order_decay" xmlns="http://www.cellml.org/cellml/1.0#">
  <component name="env">
    <variable name="time" units="second" public_interface="out"/>
  </component>
  <component name="kinetics">
    <variable name="time" units="second" public_interface="in"/>
    <variable name="C" units="dimensionless" initial_value="1.0"/>
    <variable name="k" units="dimensionless" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>C</ci></apply>
        <apply><minus/><apply><times/><ci>k</ci><ci>C</ci></apply></apply>
      </apply>
    </math>
  </component>
  <connection>
    <map_components component_1="env" component_2="kinetics"/>
    <map_variables variable_1="time" variable_2="time"/>
  </connection>
</model>`;

export const cellmlBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "cellml",
  referenceTool: "OpenCOR / CellML 1.0 RK4 Analytical",
  defaultTolerance: 1e-4,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseCellml(DECAY_CELLML);
    const rk4 = solveCellml(doc, { duration: 2.0, dt: 0.01, method: "rk4" });
    const d1 = performance.now() - t0;

    const series = rk4.states["kinetics.C"] ?? [];
    const cFinal = series[series.length - 1] ?? 0;
    const exact = Math.exp(-1.0);
    const err = Math.abs(cFinal - exact) / exact;

    const t1 = performance.now();
    const dae = lowerCellmlToDae(doc);
    const d2 = performance.now() - t1;

    return [
      {
        id: "cellml-rk4-ode-parity",
        name: "CellML 1.0 First-Order ODE RK4 Analytical Parity",
        scale: "micro",
        referenceTool: "OpenCOR / CellML 1.0 RK4 Analytical",
        metricKind: "max-relative-error",
        threshold: 1e-4,
        measuredError: err,
        passed: err < 1e-4 && rk4.stepsCount === 200,
        durationMs: d1,
        details: `C(2)=${cFinal.toFixed(6)} (exact ${exact.toFixed(6)}), err=${err.toExponential(2)}`,
      },
      {
        id: "cellml-dae-square",
        name: "CellML to DAEBuilder Square Arena Lowering",
        scale: "micro",
        referenceTool: "OpenCOR / CellML 1.0 RK4 Analytical",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: Math.abs(dae.getVarCount() - dae.getEqCount()),
        passed: dae.getVarCount() > 0 && dae.getVarCount() === dae.getEqCount(),
        durationMs: d2,
        details: `${dae.getVarCount()}x${dae.getEqCount()} DAE`,
      },
    ];
  },
};
