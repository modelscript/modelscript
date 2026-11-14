// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parseGtmModel, runGtSuiteSimulation } from "../src/index.js";

const ENGINE_GTM = `MODEL: GateValidationEngine
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.0, EFF = 0.76, MASS_FLOW = 0.14)
  PLENUM = plenum (VOL = 0.0035, P = 175000, T = 315)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40)
  TURB = turbo_turbine (ER = 1.9, EFF = 0.72)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> PLENUM.in
  PLENUM.port1 -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

export const gtsuiteBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "gtsuite",
  referenceTool: "Gamma Technologies GT-SUITE / 1D Crank-Angle Engine",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const model = parseGtmModel(ENGINE_GTM);
    const res = await runGtSuiteSimulation(model, ENGINE_GTM, {
      forceWasmFallback: true,
      durationSeconds: 0.05,
    });
    const d1 = performance.now() - t0;

    return [
      {
        id: "gtsuite-turbo-engine-sim",
        name: "3000 RPM Turbocharged SI Engine Cycle Simulation",
        scale: "standard",
        referenceTool: "Gamma Technologies GT-SUITE / 1D Crank-Angle Engine",
        metricKind: "exact",
        threshold: 0,
        measuredError: res.trajectories.length > 50 && res.summary.meanTorqueNm > 0 ? 0 : 1,
        passed: res.trajectories.length > 50 && res.summary.meanTorqueNm > 0,
        durationMs: d1,
        details: `steps=${res.trajectories.length}, meanTorque=${res.summary.meanTorqueNm.toFixed(2)}Nm`,
      },
    ];
  },
};
