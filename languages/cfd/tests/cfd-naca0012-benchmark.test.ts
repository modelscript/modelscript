// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCfdDialect } from "../src/index.js";

describe("SU2 Aerodynamic NACA 0012 Transonic Benchmark", () => {
  const naca0012Su2Template = `% ─────────────────────────────────────────────────────────────────────────────
% SU2 Aerodynamic Configuration: NACA 0012 Airfoil Transonic Benchmark
% Validation case: NASA Langley Turbulence Modeling Resource (TMR)
% ─────────────────────────────────────────────────────────────────────────────

SOLVER= RANS
KIND_TURB_MODEL= SPALART_ALLMARAS
MATH_PROBLEM= NAVIER_STOKES

% Flight Condition
MACH_NUMBER= {{ Aero.mach }}
AOA= {{ Aero.aoa }}
SIDESLIP_ANGLE= 0.0
FREESTREAM_TEMPERATURE= 288.15
FREESTREAM_DENSITY= {{ Aero.rho }}
FREESTREAM_PRESSURE= 101325.0
REYNOLDS_NUMBER= {{ Aero.reynolds }}
REYNOLDS_LENGTH= 1.0

% Reference values for non-dimensional force coefficients
REF_ORIGIN_MOMENT_X= 0.25
REF_ORIGIN_MOMENT_Y= 0.00
REF_ORIGIN_MOMENT_Z= 0.00
REF_AREA= 1.0
REF_LENGTH= 1.0

% Boundary Markers
MARKER_HEATFLUX= ( airfoil, 0.0 )
MARKER_FAR= ( farfield )
MARKER_PLOTTING= ( airfoil )
MARKER_MONITORING= ( airfoil )

% Convergence & Numerical Discretization
NUM_METHOD_GRAD= GREEN_GAUSS
CFL_NUMBER= 5.0
CONV_NUM_METHOD_FLOW= ROE
TIME_DISCRE_FLOW= EULER_IMPLICIT
ITER= {{ Aero.maxIterations }}
CONV_CRITERIA= RESIDUAL
CONV_RESIDUAL_MINVAL= -12.0
`;

  it("materializes NACA 0012 flight conditions across AoA sweep", () => {
    const dialect = getCfdDialect("su2");

    const cases = [
      { mach: 0.75, aoa: 0.0, rho: 1.225, reynolds: 6.5e6, maxIterations: 500 },
      { mach: 0.799, aoa: 1.25, rho: 1.184, reynolds: 9.0e6, maxIterations: 1000 },
      { mach: 0.85, aoa: 2.5, rho: 1.05, reynolds: 12.0e6, maxIterations: 1500 },
    ];

    for (const c of cases) {
      const materialized = dialect.materialize(naca0012Su2Template, {
        evaluator: {
          "Aero.mach": c.mach,
          "Aero.aoa": c.aoa,
          "Aero.rho": c.rho,
          "Aero.reynolds": c.reynolds,
          "Aero.maxIterations": c.maxIterations,
        },
      });

      assert.ok(materialized.includes(`MACH_NUMBER= ${c.mach}`));
      assert.ok(materialized.includes(`AOA= ${c.aoa}`));
      assert.ok(materialized.includes(`FREESTREAM_DENSITY= ${c.rho}`));
      assert.ok(materialized.includes(`REYNOLDS_NUMBER= ${c.reynolds}`));
      assert.ok(materialized.includes(`ITER= ${c.maxIterations}`));

      // Parse materialized configuration
      const parsed = dialect.parse(materialized);
      assert.strictEqual(parsed.dialect, "su2");
      assert.strictEqual(parsed.mathProblem, "NAVIER_STOKES");
      assert.strictEqual(parsed.machNumber, c.mach);
      assert.strictEqual(parsed.reynoldsNumber, c.reynolds);
      assert.strictEqual(parsed.density, c.rho);
      assert.ok(parsed.wallMarkers.includes("airfoil"));
      assert.ok(parsed.markers.has("farfield"));
    }
  });

  it("validates boundary condition topology and numerical schema", () => {
    const dialect = getCfdDialect("su2");
    const materialized = dialect.materialize(naca0012Su2Template, {
      evaluator: {
        "Aero.mach": 0.8,
        "Aero.aoa": 1.25,
        "Aero.rho": 1.225,
        "Aero.reynolds": 6500000,
        "Aero.maxIterations": 800,
      },
    });

    const parsed = dialect.parse(materialized);
    assert.strictEqual(parsed.directives.get("SOLVER"), "RANS");
    assert.strictEqual(parsed.directives.get("KIND_TURB_MODEL"), "SPALART_ALLMARAS");
    assert.strictEqual(parsed.directives.get("CONV_NUM_METHOD_FLOW"), "ROE");
    assert.strictEqual(parsed.directives.get("REF_ORIGIN_MOMENT_X"), "0.25");
  });
});
