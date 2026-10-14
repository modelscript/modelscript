// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { SysML2DaeLowerer } from "../src/sysml2-dae-lowerer.js";

describe("SysML v2 Native WASM GLR CST Flattener & DAE Lowerer", () => {
  it("lowers inheritance (:>) by inheriting attributes and parameters from superclasses", async () => {
    await initBltWasm();
    const source = `
      part def BaseVehicle {
        attribute mass : Real = 1500.0;
        attribute dragCoeff : Real = 0.32;
      }

      part def ElectricVehicle :> BaseVehicle {
        attribute batteryCapacity : Real = 82.0;
        attribute motorPower : Real = 220.0;
      }
    `;

    const result = await SysML2DaeLowerer.lowerCst(source);
    assert.strictEqual(result.rootName, "ElectricVehicle");
    assert(result.parameters.includes("mass"), "Inherited mass should be in parameters");
    assert(result.parameters.includes("dragCoeff"), "Inherited dragCoeff should be in parameters");
    assert(result.parameters.includes("batteryCapacity"), "batteryCapacity should be in parameters");
    assert(result.parameters.includes("motorPower"), "motorPower should be in parameters");

    const arena = result.arena;
    assert.strictEqual(arena.varCount, 4);
    assert.strictEqual(arena.getVarStartValue(0), 1500.0);
  });

  it("lowers array multiplicities ([4]) into indexed sub-instances", async () => {
    await initBltWasm();
    const source = `
      part def WheelAssembly {
        attribute radius : Real = 0.33;
        attribute pressure : Real = 2.4;
      }

      part def Car {
        part wheels : WheelAssembly[4];
      }
    `;

    const result = await SysML2DaeLowerer.lowerCst(source);
    assert.strictEqual(result.rootName, "Car");

    // Must have wheels[1] through wheels[4]
    for (let i = 1; i <= 4; i++) {
      assert(result.parameters.includes(`wheels[${i}].radius`), `wheels[${i}].radius missing`);
      assert(result.parameters.includes(`wheels[${i}].pressure`), `wheels[${i}].pressure missing`);
    }

    assert.strictEqual(result.arena.varCount, 8);
  });

  it("lowers physical ports with conjugation (~) and balances Kirchhoff potential and flow", async () => {
    await initBltWasm();
    const source = `
      port def Pin {
        attribute v : Real;
        flow i : Real;
      }

      part def Resistor {
        port p : Pin;
        port n : ~Pin;
        attribute R : Real = 100.0;
      }

      part def Circuit {
        part r1 : Resistor;
        part r2 : Resistor;
        connection c1 connect r1.n to r2.p;
      }
    `;

    const result = await SysML2DaeLowerer.lowerCst(source);
    assert.strictEqual(result.rootName, "Circuit");

    // c1 connects r1.n (~Pin, conjugated) to r2.p (Pin, regular)
    // Should generate:
    // 1. Equal potentials: r1.n.v == r2.p.v
    // 2. Sum of currents: (-r1.n.i) + r2.p.i == 0.0 (conjugated inverts sign)
    assert(result.eqCount >= 2, `Expected at least 2 equations for port connection, got ${result.eqCount}`);
  });

  it("lowers assert constraint equations and detects differential states der(x)", async () => {
    await initBltWasm();
    const source = `
      part def ThermalMass {
        attribute C : Real = 500.0;
        attribute T : Real = 293.15;
        attribute qIn : Real = 1500.0;
        attribute startTime : Real = 0.0;
        attribute stopTime : Real = 60.0;
        attribute step : Real = 0.1;

        assert constraint {
          C * der(T) == qIn
        }
      }
    `;

    const result = await SysML2DaeLowerer.lowerCst(source);
    assert.strictEqual(result.rootName, "ThermalMass");
    assert(result.states.includes("T"), "T should be identified as a continuous state");
    assert(result.derivatives.includes("der(T)"), "der(T) should be recorded in derivatives");
    assert(result.parameters.includes("C"), "C should be in parameters");
    assert(result.parameters.includes("qIn"), "qIn should be in parameters");
    assert.strictEqual(result.eqCount, 1);

    const arena = result.arena;
    assert.strictEqual(arena.experiment.startTime, 0.0);
    assert.strictEqual(arena.experiment.stopTime, 60.0);
    assert.strictEqual(arena.experiment.interval, 0.1);
  });
});
