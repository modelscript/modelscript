// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { runFortranBenchmark, ORBITAL_PROPULSION_FORTRAN_SRC } from "./fortran-benchmark-runner.js";

describe("@modelscript/fortran Industrial Benchmark Suite", () => {
  test("executes 6-DOF orbital dynamics & propulsion benchmark with DAE lowering and formal certification", async () => {
    const res = await runFortranBenchmark();

    assert.equal(res.name, "Fortran 6-DOF Orbital Dynamics & Propulsion System");
    assert.ok(res.variableCount >= 15, `Expected >= 15 variables, got ${res.variableCount}`);
    assert.ok(res.equationCount >= 10, `Expected >= 10 equations, got ${res.equationCount}`);
    assert.equal(res.stateCount, 6, "Expected 6 orbital state variables (3 position + 3 velocity)");
    assert.equal(res.inputCount, 5, "Expected 5 input variables (p_c, a_throat, c_f, mass_dry, mass_fuel)");
    assert.equal(res.outputCount, 5, "Expected 5 output variables (thrust, mass_total, alt_out, speed_out, energy_out)");

    assert.equal(res.isCertifiedSafe, true, "Formal verification should certify orbital routine safe");
    assert.equal(res.definiteBugCount, 0, "No definite bugs should be found in verified routine");
    assert.ok(res.provenSafeCount >= 2, "Should prove safety of operations");

    assert.ok(res.simulationSteps >= 10, "Should simulate at least 10 time steps");
    assert.ok(res.daeLoweringTimeMs < 100, `DAE lowering should be fast, got ${res.daeLoweringTimeMs}ms`);
    assert.ok(res.totalTimeMs < 1000, `Total benchmark time should be < 1000ms, got ${res.totalTimeMs}ms`);
  });

  test("validates Fortran source structure contains required subroutines and intrinsic functions", () => {
    assert.ok(ORBITAL_PROPULSION_FORTRAN_SRC.includes("subroutine orbital_flight_dynamics"));
    assert.ok(ORBITAL_PROPULSION_FORTRAN_SRC.includes("SD(1) = S(4)"));
    assert.ok(ORBITAL_PROPULSION_FORTRAN_SRC.includes("SD(4) ="));
    assert.ok(ORBITAL_PROPULSION_FORTRAN_SRC.includes("end subroutine orbital_flight_dynamics"));
  });
});
