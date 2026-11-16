// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm, performBltTransformationArena } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeSteadyStateInit,
  ensureBuiltInPsseLibraryRegistered,
  lowerPsseToDae,
  parseDyr,
  parseRaw,
  simulatePsseTransient,
} from "../src/index.js";

const THREE_BUS_TEST_RAW = `0, 100.0, 33, 0, 1, 60.0 / 3-BUS FULL DAE TEST
THREE BUS FULL DAE
TEST CASE
1, 'SLACK_GEN   ', 138.0, 3, 1, 1, 1, 1.03, 0.0
2, 'IBR_BUS     ', 138.0, 2, 1, 1, 1, 1.02, 0.0
3, 'LOAD_BUS    ', 138.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 1, 1, 120.0, 40.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 75.0, 20.0, 200.0, -100.0, 1.03, 0, 100.0, 0.002, 0.18, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
2, '1 ', 48.0, 10.0, 150.0, -80.0, 1.02, 0, 100.0, 0.0, 0.20, 0.0, 0.0, 1.0, 1, 100.0, 150.0, 0.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 3, '1 ', 0.008, 0.065, 0.04, 250.0, 280.0, 300.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 25.0
2, 3, '1 ', 0.010, 0.075, 0.04, 250.0, 280.0, 300.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 30.0
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
0 / END OF TRANSFORMER DATA
Q
`;

describe("PSS/E Full Multi-State DAE Lowering, Steady-State Equilibrium & Fault Transients", () => {
  it("computes exact Park d/q steady-state initialization satisfying algebraic stator & swing equilibrium", async () => {
    await Promise.all([ensureBuiltInPsseLibraryRegistered(), initBltWasm()]);
    const c = parseRaw(THREE_BUS_TEST_RAW);
    c.dyr = parseDyr(`
1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 1.0 1.8 1.7 0.30 0.55 0.20 0.14 0.09 0.35 /
1 'ESAC1A' '1' 0.02 0.0 0.0 200.0 0.04 8.0 -6.0 0.8 0.03 1.0 0.2 0.35 1.0 3.1 0.03 4.2 0.1 /
1 'HYGOV'  '1' 0.05 0.3 5.0 0.05 0.5 0.2 1.0 0.0 1.2 1.2 0.5 0.08 /
1 'PSS2B'  '1' 1 0 3 0 5 1 5.0 5.0 0.0 5.0 0.0 5.0 0.5 1.0 0.5 0.1 10.0 0.25 0.04 0.15 0.03 0.0 0.0 0.1 -0.1 /
2 'REGC_A' '1' 1 0.02 10.0 0.9 0.4 1.22 1.2 0.8 0.4 -1.3 0.02 0.7 999.0 -999.0 0.7 /
2 'REEC_A' '1' 0 0 1 1 0 0.85 1.15 0.01 -0.05 0.05 2.0 1.05 -1.05 1.0 0.0 0.0 0.0 0.05 0.436 -0.436 1.1 0.9 0.0 0.1 0.0 40.0 0.0 0.02 99.0 -99.0 1.0 0.0 1.3 0.02 /
2 'REPC_A' '1' 2 1 2 '1' 0 1 1 0.02 18.0 5.0 0.0 0.05 0.7 0.0 0.0 0.0 0.1 -0.1 -0.002 0.002 0.436 -0.436 1.0 0.5 0.25 -0.0006 0.0006 99.0 -99.0 1.0 0.0 0.1 20.0 0.0 /
3 'CMPLDW' '1' 1 1.0 0.04 0.04 1.0 0.25 0.2 0.15 0.2 0.1 0.6 0.033 0.12 0.12 0.08 30.0 5.0 /
3 'SVSMO1' '1' 0 0.01 50.0 0.1 0.5 0.02 1.5 -1.0 0.03 /
`);

    const steady = computeSteadyStateInit(c);
    const g1 = steady.gens.get("1_1")!;
    assert.ok(g1);
    const resD = g1.psippd0 - (g1.vq0 + g1.ra * g1.iq0 + g1.xdpp * g1.id0);
    const resQ = g1.psippq0 - (g1.vd0 + g1.ra * g1.id0 - g1.xqpp * g1.iq0);
    const resTm = g1.tm0 - (g1.pPu + g1.ra * (g1.id0 * g1.id0 + g1.iq0 * g1.iq0));
    assert.ok(Math.abs(resD) < 1e-12, `d-axis stator flux residual ${resD}`);
    assert.ok(Math.abs(resQ) < 1e-12, `q-axis stator flux residual ${resQ}`);
    assert.ok(Math.abs(resTm) < 1e-12, `steady-state torque balance residual ${resTm}`);

    // Lower full coupled transient DAE (both piecewise and smoothLimits modes)
    const daePiecewise = lowerPsseToDae(c, { mode: "transient", smoothLimits: false });
    assert.ok(daePiecewise.getVarCount() > 50);
    assert.equal(
      daePiecewise.getVarCount(),
      daePiecewise.getEqCount(),
      "Coupled 3-bus GENROU+IBR+CMPLDW+SVSMO1 DAE must be square",
    );

    const daeSmooth = lowerPsseToDae(c, { mode: "transient", smoothLimits: true });
    assert.equal(daeSmooth.getVarCount(), daeSmooth.getEqCount(), "Smooth-limit DAE must also be square");

    // Verify powerflow mode retains classical PV/Slack structure cleanly
    const daePf = lowerPsseToDae(c, { mode: "powerflow" });
    assert.equal(daePf.getVarCount(), daePf.getEqCount());

    // Run closed-loop ArenaSimulator over 10s steady-state horizon (GENROU+ESAC1A+HYGOV+PSS2B+REGC_A+CMPLDW+SVSMO1 -> machine-precision flat line!)
    const cFlat = parseRaw(THREE_BUS_TEST_RAW);
    cFlat.dyr = parseDyr(`
1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 1.0 1.8 1.7 0.30 0.55 0.20 0.14 0.09 0.35 /
1 'ESAC1A' '1' 0.02 0.0 0.0 200.0 0.04 8.0 -6.0 0.8 0.03 1.0 0.2 0.35 1.0 3.1 0.03 4.2 0.1 /
1 'HYGOV'  '1' 0.05 0.3 5.0 0.05 0.5 0.2 1.0 0.0 1.2 1.2 0.5 0.08 /
1 'PSS2B'  '1' 1 0 3 0 5 1 5.0 5.0 0.0 5.0 0.0 5.0 0.5 1.0 0.5 0.1 10.0 0.25 0.04 0.15 0.03 0.0 0.0 0.1 -0.1 /
2 'REGC_A' '1' 1 0.02 10.0 0.9 0.4 1.22 1.2 0.8 0.4 -1.3 0.02 0.7 999.0 -999.0 0.7 /
3 'CMPLDW' '1' 1 1.0 0.04 0.04 1.0 0.25 0.2 0.15 0.2 0.1 0.6 0.033 0.12 0.12 0.08 30.0 5.0 /
3 'SVSMO1' '1' 0 0.05 15.0 0.1 0.5 0.10 1.5 -1.0 0.03 /
`);
    const flatDae = lowerPsseToDae(cFlat, { mode: "transient", smoothLimits: false });
    const flatSim = simulateArena(flatDae, {
      startTime: 0,
      stopTime: 10.0,
      step: 0.05,
      solver: "rk4",
      outputs: ["Vr_1", "delta_1_1", "B_svc_SVSMO1_3_0"],
    });
    assert.ok(flatSim.t.length >= 200, `Expected 10s flat-run trajectory (>= 200 pts), got ${flatSim.t.length}`);
    let maxDrift = 0;
    for (let col = 0; col < flatSim.states.length; col++) {
      const y0 = flatSim.y[0]![col]!;
      for (let row = 1; row < flatSim.y.length; row++) {
        maxDrift = Math.max(maxDrift, Math.abs(flatSim.y[row]![col]! - y0));
      }
    }
    assert.ok(maxDrift < 1e-9, `Expected 10s closed-loop flat-start drift < 1e-9, got ${maxDrift}`);

    // Run ABI v2 WASM-coupled transient fault simulation (all 9 models including REEC_A + REPC_A)
    const sim = simulatePsseTransient(c, {
      stopTime: 1.0,
      timeStep: 0.02,
      faultBus: 3,
      faultStartSec: 0.2,
      faultClearSec: 0.32,
      faultSusceptancePu: 5.0,
      useWasmStdLib: true,
    });
    assert.equal(sim.summary.convergedPowerFlow, true);
    assert.equal(sim.summary.stable, true);
    assert.ok(sim.t.length >= 40);
  });

  it("lowers OEL, UEL, COMP, GENTPJ, ESST4B, GGOV1, PSS4B, REGFM_A1, and relays cleanly", () => {
    const c = parseRaw(THREE_BUS_TEST_RAW);
    c.dyr = parseDyr(`
1 'GENTPJ' '1' 6.5 0.035 1.0 0.05 4.5 1.0 1.8 1.7 0.30 0.55 0.20 0.14 0.09 0.35 0.05 /
1 'ESST4B' '1' 0.02 10.0 10.0 1.0 -0.87 0.02 1.0 0.0 1.0 -0.87 0.0 5.0 0.0 8.0 0.1 0.0 0.0 /
1 'MAXEX1' '1' 1 2.8 4.5 10.0 2.0 0.05 -0.5 /
1 'UEL1'   '1' 1 1.0 0.2 -0.4 2.0 1.0 0.2 0.5 0.5 0.0 /
1 'COMP'   '1' 0.0 -0.05 /
1 'GGOV1'  '1' 1 0.04 1.0 0.05 -0.05 10.0 2.0 0.0 1.0 1.0 0.15 0.5 1.5 0.2 0.1 0.0 0.0 3.0 2.0 0.67 1.0 0.0 0.1 -0.1 /
1 'PSS4B'  '1' 1 1 5.0 0.08 15.0 0.65 25.0 2.0 0.15 -0.15 0.075 -0.075 0.15 -0.15 0.15 -0.15 /
1 'FRQTPAT' '1' 0 57.0 62.5 0.2 0.05 /
2 'REGFM_A1' '1' 1 1 0.05 0.05 0.02 0.02 0.01 0.15 1.2 2.0 /
3 'LDSHBL' '1' 0 59.3 0.15 0.05 0.1 58.9 0.15 0.05 0.1 58.5 0.15 0.05 0.1 /
`);

    const dae = lowerPsseToDae(c, { mode: "transient" });
    assert.ok(dae.getVarCount() > 50);
    assert.equal(
      dae.getVarCount(),
      dae.getEqCount(),
      "Full GENTPJ+ESST4B+OEL+UEL+COMP+GGOV1+PSS4B+GFM+Relays DAE must be square",
    );
  });

  it("verifies IEEE 9-bus, Kundur 2-area, and WECC IBR benchmarks (BLT + 10s flat-start + fault transient)", async () => {
    await Promise.all([ensureBuiltInPsseLibraryRegistered(), initBltWasm()]);
    const suiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../testsuite");

    for (const [name, faultBus] of [
      ["ieee9", 7],
      ["kundur2area", 7],
      ["wecc_ibr", 5],
    ] as const) {
      const rawText = fs.readFileSync(path.join(suiteDir, `${name}.raw`), "utf-8");
      const dyrText = fs.readFileSync(path.join(suiteDir, `${name}.dyr`), "utf-8");
      const c = parseRaw(rawText);
      c.dyr = parseDyr(dyrText);

      const dae = lowerPsseToDae(c, { mode: "transient", smoothLimits: false });
      assert.equal(dae.getVarCount(), dae.getEqCount(), `${name} DAE must be structurally square`);
      const blt = performBltTransformationArena(dae);
      assert.equal(blt.sortedEquations.length, dae.getEqCount(), `${name} BLT must causalize 100% of equations`);

      const sim = simulatePsseTransient(c, {
        stopTime: 1.5,
        timeStep: 0.02,
        faultBus,
        faultStartSec: 0.2,
        faultClearSec: 0.3,
        faultSusceptancePu: 4.0,
        useWasmStdLib: true,
      });
      assert.equal(sim.summary.convergedPowerFlow, true, `${name} AC power flow must converge`);
      assert.equal(sim.summary.stable, true, `${name} fault transient must remain angle-stable`);
      assert.ok(sim.summary.minBusVoltagePu < 0.95, `${name} fault must depress bus voltage`);

      if (name === "ieee9") {
        const flatSim = simulateArena(dae, {
          startTime: 0,
          stopTime: 10.0,
          step: 0.1,
          solver: "rk4",
          outputs: ["Vr_1", "delta_1_1", "delta_2_1", "delta_3_1"],
        });
        assert.ok(flatSim.t.length >= 100, "Expected 10s IEEE 9-bus flat-run trajectory");
        let maxDrift = 0;
        for (let col = 0; col < flatSim.states.length; col++) {
          const y0 = flatSim.y[0]![col]!;
          for (let row = 1; row < flatSim.y.length; row++) {
            maxDrift = Math.max(maxDrift, Math.abs(flatSim.y[row]![col]! - y0));
          }
        }
        assert.ok(maxDrift < 1e-7, `Expected IEEE 9-bus 10s flat-start drift < 1e-7, got ${maxDrift}`);
      }
    }
  });
});
