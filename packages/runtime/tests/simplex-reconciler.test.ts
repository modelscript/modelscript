// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { PhysicsSimplexReconciler, type ReconcileProblem } from "../src/interop/simplex_reconciler.js";

test("PhysicsSimplexReconciler — Multi-Domain Parameter Conflict Relaxation", async (t) => {
  await t.test("Resolves single-parameter discrepancy within physical bounds", () => {
    const problem: ReconcileProblem = {
      name: "BatteryBusVoltage",
      parameters: {
        V_bus: {
          name: "V_bus",
          unit: "V",
          bounds: { min: 10.0, max: 48.0 },
          proposals: [
            { domain: "sysml2", value: 24.0, unit: "V", weight: 1.0 },
            { domain: "modelica", value: 12.0, unit: "V", weight: 1.0 },
          ],
        },
      },
    };

    const result = PhysicsSimplexReconciler.reconcile(problem);
    assert.strictEqual(result.status, "OPTIMAL");
    assert.ok(result.parameters["V_bus"]);

    const vBus = result.parameters["V_bus"]!.optimalValue;
    assert.ok(vBus >= 10.0 && vBus <= 48.0, `V_bus (${vBus}) must respect [10, 48] bounds`);
    assert.ok(vBus >= 12.0 && vBus <= 24.0, `V_bus (${vBus}) should settle between 12V and 24V`);

    const dev = result.parameters["V_bus"]!.domainDeviations;
    assert.ok(dev["sysml2"] !== undefined);
    assert.ok(dev["modelica"] !== undefined);
  });

  await t.test("Resolves multi-variable coupled physical envelope constraints", () => {
    // Battery Pack with Voltage and Current subject to Power / Thermal dissipation limit
    // V_bus in [10, 50], I_max in [5, 40]
    // Thermal limit: 1.5 * V_bus + 2.0 * I_max <= 90
    const problem: ReconcileProblem = {
      name: "PowertrainSizing",
      parameters: {
        V_bus: {
          name: "V_bus",
          unit: "V",
          bounds: { min: 10.0, max: 50.0 },
          proposals: [
            { domain: "sysml2", value: 48.0, unit: "V", weight: 1.0 },
            { domain: "modelica", value: 24.0, unit: "V", weight: 2.0 }, // Modelica has higher priority
          ],
        },
        I_max: {
          name: "I_max",
          unit: "A",
          bounds: { min: 5.0, max: 40.0 },
          proposals: [
            { domain: "sysml2", value: 30.0, unit: "A", weight: 1.0 },
            { domain: "modelica", value: 15.0, unit: "A", weight: 1.0 },
          ],
        },
      },
      constraints: [
        {
          name: "ThermalDissipationLimit",
          type: "le",
          coefficients: { V_bus: 1.5, I_max: 2.0 },
          rhs: 90.0,
        },
      ],
    };

    const result = PhysicsSimplexReconciler.reconcile(problem);
    assert.strictEqual(result.status, "OPTIMAL");

    const v = result.parameters["V_bus"]!.optimalValue;
    const i = result.parameters["I_max"]!.optimalValue;

    // Verify thermal dissipation constraint holds
    const thermalLoad = 1.5 * v + 2.0 * i;
    assert.ok(thermalLoad <= 90.0001, `Thermal load (${thermalLoad}) must satisfy <= 90 constraint`);
  });

  await t.test("Detects strictly contradictory infeasible physical constraints", () => {
    const problem: ReconcileProblem = {
      name: "ImpossibleEnvelope",
      parameters: {
        mass: {
          name: "mass",
          unit: "kg",
          bounds: { min: 1.0, max: 10.0 },
          proposals: [{ domain: "cad", value: 5.0, unit: "kg" }],
        },
      },
      constraints: [
        {
          name: "LowerConstraint",
          type: "ge",
          coefficients: { mass: 1.0 },
          rhs: 8.0,
        },
        {
          name: "UpperConstraint",
          type: "le",
          coefficients: { mass: 1.0 },
          rhs: 4.0,
        },
      ],
    };

    const result = PhysicsSimplexReconciler.reconcile(problem);
    assert.strictEqual(result.status, "INFEASIBLE");
    assert.ok(result.activeConstraints.length > 0);
  });
});
