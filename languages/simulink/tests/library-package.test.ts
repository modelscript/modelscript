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
});
