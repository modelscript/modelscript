// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { getCfdDialect } from "../src/index.js";

describe("@modelscript/cfd Dialect Architecture", () => {
  it("resolves the 'su2' dialect by id and extension", () => {
    const dialectById = getCfdDialect("su2");
    const dialectByExt = getCfdDialect(".cfg");

    assert.strictEqual(dialectById.id, "su2");
    assert.strictEqual(dialectByExt.id, "su2");
  });

  it("materializes embedded expressions with parameter bindings using the dialect", () => {
    const dialect = getCfdDialect("su2");

    const template = `% CFD Config for {{ Flight.modelName }}
MATH_PROBLEM= NAVIER_STOKES
MACH_NUMBER= {{ Flight.mach }}
REYNOLDS_NUMBER= {{ Flight.reynolds }}
FREESTREAM_DENSITY= {{ Atmosphere.rho }}
FREESTREAM_VELOCITY= ( {{ Flight.speed }}, 0.0, 0.0 )
MARKER_INLET= ( inlet_patch, {{ Flight.speed }}, 1.0, 0.0, 0.0 )
MARKER_HEATFLUX= ( drone_surface, {{ Flight.heatFlux * 2.0 }} )
`;

    const parameters = {
      "Flight.modelName": "AeroDroneX",
      "Flight.mach": 0.15,
      "Flight.reynolds": 250000,
      "Atmosphere.rho": 1.225,
      "Flight.speed": 18.5,
      "Flight.heatFlux": 120.0,
    };

    const materialized = dialect.materialize(template, { evaluator: parameters });

    assert.ok(materialized.includes("% CFD Config for AeroDroneX"));
    assert.ok(materialized.includes("MACH_NUMBER= 0.15"));
    assert.ok(materialized.includes("REYNOLDS_NUMBER= 250000"));
    assert.ok(materialized.includes("FREESTREAM_DENSITY= 1.225"));
    assert.ok(materialized.includes("FREESTREAM_VELOCITY= ( 18.5, 0.0, 0.0 )"));
    assert.ok(materialized.includes("MARKER_INLET= ( inlet_patch, 18.5, 1.0, 0.0, 0.0 )"));
    assert.ok(materialized.includes("MARKER_HEATFLUX= ( drone_surface, 240 )"));
  });

  it("parses directives, vectors, and marker surfaces into canonical CfdModelData", () => {
    const dialect = getCfdDialect("su2");

    const configText = `MATH_PROBLEM= NAVIER_STOKES
MACH_NUMBER= 0.25
REYNOLDS_NUMBER= 500000
FREESTREAM_DENSITY= 1.225
FREESTREAM_VELOCITY= ( 25.0, 0.0, 0.0 )
MARKER_INLET= ( inlet_surf, 25.0, 1.0, 0.0, 0.0 )
MARKER_OUTLET= ( outlet_surf, 0.0 )
MARKER_HEATFLUX= ( wing_wall, 0.0 )
MARKER_ISOTHERMAL= ( motor_wall, 350.0 )
`;

    const parsed = dialect.parse(configText);

    assert.strictEqual(parsed.dialect, "su2");
    assert.strictEqual(parsed.mathProblem, "NAVIER_STOKES");
    assert.strictEqual(parsed.machNumber, 0.25);
    assert.strictEqual(parsed.reynoldsNumber, 500000);
    assert.strictEqual(parsed.density, 1.225);
    assert.deepStrictEqual(parsed.inletVelocity, [25.0, 0.0, 0.0]);
    assert.strictEqual(parsed.inletMarker, "inlet_surf");
    assert.strictEqual(parsed.outletMarker, "outlet_surf");
    assert.ok(parsed.wallMarkers.includes("wing_wall"));
    assert.ok(parsed.wallMarkers.includes("motor_wall"));
    assert.ok(parsed.markers.has("inlet_surf"));
    assert.ok(parsed.markers.has("motor_wall"));
  });
});
