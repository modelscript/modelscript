// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SIMULINK_BLOCK_SPECS,
  createFmuSimulinkBlockInstance,
  fmuToSimulinkBlock,
  getSimulinkSchemasFromLibraries,
  instantiateSimulinkWasmBlock,
  lookupSimulinkBlockSchema,
  lowerSimulinkToDae,
  parseMdl,
  registerBuiltInSimulinkLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/simulink-std-lib");

describe("@modelscript/simulink — Cleanroom Standard Blockset Library (modelscript.yaml, WASM Runtime & FMU Linking)", () => {
  it("loads @modelscript/simulink-std-lib via modelscript.yaml with symbols, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected simulink-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/simulink-std-lib");
    assert.equal(pkg.manifest.language, "simulink");
    assert.equal(pkg.symbols.length, SIMULINK_BLOCK_SPECS.length);
    assert.equal(pkg.diagrams.length, SIMULINK_BLOCK_SPECS.length);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected cleanroom SVG icon for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.length > 5, `Expected provenance citation for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and alias resolution", () => {
    registerBuiltInSimulinkLibrarySync();
    const schemas = getSimulinkSchemasFromLibraries();
    assert.ok(schemas.length >= SIMULINK_BLOCK_SPECS.length);

    assert.equal(lookupSimulinkBlockSchema("simulink/Continuous/Integrator")?.name, "Integrator");
    assert.equal(lookupSimulinkBlockSchema("simulink/Continuous/PID Controller")?.name, "PID");
    assert.equal(lookupSimulinkBlockSchema("simulink/Lookup Tables/1-D Lookup Table")?.name, "Lookup_nD");
  });

  it("executes core Continuous, Discrete, Nonlinear, and Lookup blocks accurately in runtime.wasm", () => {
    // 1. First-order TransferFcn H(s) = 1 / (s + 1) step response -> 1 - e^-t
    const tf = instantiateSimulinkWasmBlock("TransferFcn", { Num0: 0, Num1: 1, Den0: 1, Den1: 1 });
    assert.ok(tf);
    tf.init();
    let yTf = 0;
    const dt = 0.01;
    for (let k = 0; k < 100; k++) {
      yTf = tf.step(k * dt, dt, [1.0]);
    }
    const exact1s = 1 - Math.exp(-1.0);
    assert.ok(Math.abs(yTf - exact1s) < 1e-3, `Expected H(s)=1/(s+1) at t=1s ~ ${exact1s}, got ${yTf}`);

    // 2. PID controller with anti-windup clamping
    const pid = instantiateSimulinkWasmBlock("PID", {
      P: 2.0,
      I: 1.0,
      D: 0.0,
      UpperSaturationLimit: 3.0,
      LowerSaturationLimit: -3.0,
    });
    assert.ok(pid);
    pid.init();
    const yPid1 = pid.step(0.0, 0.1, [1.0]);
    assert.ok(yPid1 > 2.0 && yPid1 <= 3.0);
    const yPidSat = pid.step(0.1, 0.1, [10.0]);
    assert.equal(yPidSat, 3.0);

    // 3. UnitDelay (1/z)
    const ud = instantiateSimulinkWasmBlock("UnitDelay", { InitialCondition: 5.0 });
    assert.ok(ud);
    ud.init();
    assert.equal(ud.step(0.0, 0.1, [9.0]), 5.0);
    assert.equal(ud.step(0.1, 0.1, [12.0]), 9.0);

    // 4. 1-D Lookup Table interpolation
    const lut = instantiateSimulinkWasmBlock("Lookup_nD", { x0: 0, x1: 1, x2: 2, y0: 0, y1: 1, y2: 4 });
    assert.ok(lut);
    lut.init();
    assert.ok(Math.abs(lut.step(0, 0.1, [1.5]) - 2.5) < 1e-9);

    // 5. Saturation & Relay
    const sat = instantiateSimulinkWasmBlock("Saturate", { UpperLimit: 2.0, LowerLimit: -2.0 });
    assert.ok(sat);
    sat.init();
    assert.equal(sat.step(0, 0.1, [5.0]), 2.0);
    assert.equal(sat.step(0, 0.1, [-5.0]), -2.0);
  });

  it("matches exact analytical step response for 2nd-order underdamped TransferFcn within < 1e-3", () => {
    const wn = 2.0;
    const zeta = 0.25;
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const phi = Math.acos(zeta);

    const tf2 = instantiateSimulinkWasmBlock("TransferFcn", {
      Num: [wn * wn],
      Den: [1.0, 2.0 * zeta * wn, wn * wn],
    });
    assert.ok(tf2);
    assert.equal(tf2.init(), 2);

    const dt = 0.005;
    let maxErr = 0;
    for (let k = 1; k <= 800; k++) {
      const t = k * dt;
      const y = tf2.step(t, dt, [1.0]);
      const yExact = 1.0 - (Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t + phi);
      maxErr = Math.max(maxErr, Math.abs(y - yExact));
    }
    assert.ok(maxErr < 1e-3, `Expected 2nd-order TransferFcn max error < 1e-3, got ${maxErr}`);
  });

  it("matches exact cos(t) trajectory for 2x2 harmonic oscillator StateSpace within < 1e-3", () => {
    const ss = instantiateSimulinkWasmBlock("StateSpace", {
      A: [
        [0, 1],
        [-1, 0],
      ],
      B: [[0], [0]],
      C: [
        [1, 0],
        [0, 1],
      ],
      D: [[0], [0]],
      X0: [1.0, 0.0],
    });
    assert.ok(ss);
    assert.equal(ss.init(), 2);

    const dt = 0.005;
    let maxErrX1 = 0;
    let maxErrX2 = 0;
    for (let k = 1; k <= 1200; k++) {
      const t = k * dt;
      const y1 = ss.step(t, dt, [0.0]);
      const y2 = ss.getOutput(1);
      maxErrX1 = Math.max(maxErrX1, Math.abs(y1 - Math.cos(t)));
      maxErrX2 = Math.max(maxErrX2, Math.abs(y2 - -Math.sin(t)));
    }
    assert.ok(maxErrX1 < 1e-3, `Expected harmonic oscillator cos(t) max error < 1e-3, got ${maxErrX1}`);
    assert.ok(maxErrX2 < 1e-3, `Expected harmonic oscillator -sin(t) max error < 1e-3, got ${maxErrX2}`);
  });

  it("evaluates 10-point 1D Lookup_nD and 2D bilinear Lookup_nD accurately", () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ys = xs.map((x) => x * x);
    const lut1d = instantiateSimulinkWasmBlock("Lookup_nD", {
      Breakpoints1: xs,
      Table: ys,
    });
    assert.ok(lut1d);
    lut1d.init();

    assert.ok(Math.abs(lut1d.step(0, 0.1, [-2.0]) - 0.0) < 1e-9);
    assert.ok(Math.abs(lut1d.step(0, 0.1, [3.5]) - 12.5) < 1e-9);
    assert.ok(Math.abs(lut1d.step(0, 0.1, [7.25]) - 52.75) < 1e-9);
    assert.ok(Math.abs(lut1d.step(0, 0.1, [12.0]) - 81.0) < 1e-9);

    // 2D bilinear grid lookup z(x, y) = x + y
    const lut2d = instantiateSimulinkWasmBlock("Lookup_nD", {
      Breakpoints1: [0, 1, 2],
      Breakpoints2: [0, 10, 20],
      Table: [
        [0, 10, 20],
        [1, 11, 21],
        [2, 12, 22],
      ],
    });
    assert.ok(lut2d);
    lut2d.init();
    assert.ok(Math.abs(lut2d.step(0, 0.1, [0.5, 15.0]) - 15.5) < 1e-9);
    assert.ok(Math.abs(lut2d.step(0, 0.1, [1.25, 5.0]) - 6.25) < 1e-9);
  });

  it("implements exact ring-buffer TransportDelay with linear interpolation", () => {
    const tau = 0.25;
    const td = instantiateSimulinkWasmBlock("TransportDelay", {
      InitialOutput: -1.0,
      DelayTime: tau,
    });
    assert.ok(td);
    td.init();

    const dt = 0.01;
    for (let k = 0; k <= 100; k++) {
      const t = k * dt;
      const u = Math.sin(2.0 * t);
      const y = td.step(t, dt, [u]);
      if (t < tau - 1e-9) {
        assert.equal(y, -1.0, `Expected InitialOutput before t=tau at t=${t}`);
      } else {
        const expected = Math.sin(2.0 * (t - tau));
        assert.ok(Math.abs(y - expected) < 1e-6, `Expected delayed sin at t=${t}: ${expected}, got ${y}`);
      }
    }

    // Sub-step fractional delay linear interpolation on a ramp u(t) = 3*t
    const tdFrac = instantiateSimulinkWasmBlock("TransportDelay", {
      InitialOutput: 0.0,
      DelayTime: 0.255,
    });
    assert.ok(tdFrac);
    tdFrac.init();
    for (let k = 0; k <= 60; k++) {
      const t = k * dt;
      const y = tdFrac.step(t, dt, [3.0 * t]);
      if (t >= 0.26) {
        const expected = 3.0 * (t - 0.255);
        assert.ok(Math.abs(y - expected) < 1e-9, `Expected interpolated ramp at t=${t}: ${expected}, got ${y}`);
      }
    }
  });

  it("implements Backlash hysteresis, CoulombViscousFriction, SecondOrderIntegrator, and Stateflow Chart", () => {
    // 1. Backlash deadband play hysteresis (width = 1.0 -> half-width = 0.5)
    const bl = instantiateSimulinkWasmBlock("Backlash", { BacklashWidth: 1.0, InitialOutput: 0.0 });
    assert.ok(bl);
    bl.init();
    assert.equal(bl.step(0.0, 0.1, [0.4]), 0.0); // inside deadband
    assert.equal(bl.step(0.1, 0.1, [1.0]), 0.5); // pushed up
    assert.equal(bl.step(0.2, 0.1, [2.0]), 1.5); // pushed up
    assert.equal(bl.step(0.3, 0.1, [1.5]), 1.5); // reversal inside play deadband
    assert.equal(bl.step(0.4, 0.1, [1.0]), 1.5); // still at deadband edge
    assert.equal(bl.step(0.5, 0.1, [0.5]), 1.0); // pulled down
    assert.equal(bl.step(0.6, 0.1, [-1.0]), -0.5); // pulled down

    // 2. Coulomb & Viscous Friction
    const cvf = instantiateSimulinkWasmBlock("CoulombViscousFriction", { Offset: 0.2, Gain: 2.0 });
    assert.ok(cvf);
    cvf.init();
    assert.equal(cvf.step(0, 0.1, [0.0]), 0.0);
    assert.ok(Math.abs(cvf.step(0, 0.1, [1.5]) - 3.2) < 1e-9);
    assert.ok(Math.abs(cvf.step(0, 0.1, [-1.5]) - -3.2) < 1e-9);

    // 3. SecondOrderIntegrator (position + velocity with upper position saturation)
    const int2 = instantiateSimulinkWasmBlock("SecondOrderIntegrator", {
      InitialCondition: 0.0,
      UpperSaturationLimit: 2.0,
      LowerSaturationLimit: -2.0,
      InitialConditionDXDT: 0.0,
    });
    assert.ok(int2);
    assert.equal(int2.init(), 2);
    const dt = 0.01;
    for (let k = 1; k <= 50; k++) {
      int2.step(k * dt, dt, [4.0]);
    }
    // At t = 0.5s with a = 4.0: x = 0.5*a*t^2 = 0.5, v = a*t = 2.0
    assert.ok(Math.abs(int2.getOutput(0) - 0.5) < 1e-9);
    assert.ok(Math.abs(int2.getOutput(1) - 2.0) < 1e-9);
    for (let k = 51; k <= 150; k++) {
      int2.step(k * dt, dt, [4.0]);
    }
    // Clamped at UpperSaturationLimit = 2.0, velocity halted at 0.0
    assert.equal(int2.getOutput(0), 2.0);
    assert.equal(int2.getOutput(1), 0.0);

    // 4. Cleanroom Stateflow Chart FSM (guard + temporal after() transition)
    const chart = instantiateSimulinkWasmBlock("Chart", {
      InitialState: 0,
      Transitions: [
        [0, 1, 0, 4, 1.0, 10.0], // State 0 -> 1 when u0 >= 1.0, output = 10.0
        [1, 2, -2, 4, 0.2, 5.0], // State 1 -> 2 after(0.2, sec), output = 5.0
        [2, 0, 0, 3, 0.0, 0.0], // State 2 -> 0 when u0 <= 0.0, output = 0.0
      ],
    });
    assert.ok(chart);
    chart.init();
    assert.equal(chart.step(0.0, 0.1, [0.5]), 0.0); // stays in state 0
    assert.equal(chart.getOutput(1), 0);
    assert.equal(chart.step(0.1, 0.1, [1.5]), 10.0); // transitions 0 -> 1
    assert.equal(chart.getOutput(1), 1);
    assert.equal(chart.step(0.2, 0.1, [1.5]), 10.0); // elapsed = 0.1 < 0.2, stays in 1
    assert.equal(chart.step(0.3, 0.1, [1.5]), 5.0); // elapsed = 0.2 >= 0.2, transitions 1 -> 2
    assert.equal(chart.getOutput(1), 2);
    assert.equal(chart.step(0.4, 0.1, [0.0]), 0.0); // transitions 2 -> 0
    assert.equal(chart.getOutput(1), 0);
  });

  it("projects and links an FMI 2.0/3.0 vendor FMU via S-Function", () => {
    const proj = fmuToSimulinkBlock({
      modelName: "PlantFmu",
      variables: [
        { name: "K_gain", causality: "parameter", type: "Real", valueReference: 1, start: 4.5 },
        { name: "u", causality: "input", type: "Real", valueReference: 2 },
        { name: "y", causality: "output", type: "Real", valueReference: 3 },
      ],
    });
    assert.equal(proj.blockType, "S-Function");
    assert.equal(proj.parameters["K_gain"], 4.5);

    const inst = createFmuSimulinkBlockInstance(proj.blockName, (_t, _dt, inputs) => 4.5 * (inputs[0] ?? 0));
    assert.equal(inst.step(0, 0.01, [2.0]), 9.0);
  });

  it("automatically registers stdlib and falls back to cleanroom schema defaults during DAE lowering", () => {
    // Blocks omit Gain, InitialCondition, UpperLimit, LowerLimit, Time, Before, After
    const mdl = `Model {
  Name "DefaultFallbackTest"
  System {
    Name "DefaultFallbackTest"
    Block {
      BlockType Step
      Name "StepSrc"
    }
    Block {
      BlockType Gain
      Name "UnitGain"
    }
    Block {
      BlockType Saturation
      Name "Sat1"
    }
    Block {
      BlockType Integrator
      Name "Int1"
    }
    Line {
      SrcBlock "StepSrc"
      SrcPort 1
      DstBlock "UnitGain"
      DstPort 1
    }
    Line {
      SrcBlock "UnitGain"
      SrcPort 1
      DstBlock "Sat1"
      DstPort 1
    }
    Line {
      SrcBlock "Sat1"
      SrcPort 1
      DstBlock "Int1"
      DstPort 1
    }
  }
}`;
    const dae = lowerSimulinkToDae(parseMdl(mdl));
    assert.ok(globalLibraryRegistry.getPackagesForLanguage("simulink").length > 0);
    assert.ok(dae.lookupVariable("StepSrc.y") >= 0);
    assert.ok(dae.lookupVariable("UnitGain.y") >= 0);
    assert.ok(dae.lookupVariable("Sat1.y") >= 0);
    assert.ok(dae.lookupVariable("Int1.y") >= 0);
    assert.equal(dae.varCount, 4);
    assert.equal(dae.eqCount, 4);
  });
});
