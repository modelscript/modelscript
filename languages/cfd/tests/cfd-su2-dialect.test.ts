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

  it("parses recursive OpenFOAM case dictionaries into canonical CfdModelData", () => {
    const dialect = getCfdDialect("openfoam");
    assert.strictEqual(dialect.id, "openfoam");

    const foamContent = `
application     simpleFoam;
startFrom       startTime;
startTime       0;
stopTime        1000;
deltaT          1;

boundaryField
{
    inlet
    {
        type            fixedValue;
        value           uniform (15.5 0 0);
    }
    outlet
    {
        type            zeroGradient;
    }
    wing
    {
        type            noSlip;
    }
}
`;

    const parsed = dialect.parse(foamContent);
    assert.strictEqual(parsed.dialect, "openfoam");
    assert.strictEqual(parsed.mathProblem, "simpleFoam");
    assert.strictEqual(parsed.inletMarker, "inlet");
    assert.deepStrictEqual(parsed.inletVelocity, [15.5, 0, 0]);
    assert.strictEqual(parsed.freestreamVelocity, 15.5);
    assert.strictEqual(parsed.outletMarker, "outlet");
    assert.ok(parsed.wallMarkers.includes("wing"));
    assert.strictEqual(parsed.directives.get("boundaryField.inlet.type"), "fixedValue");
    assert.strictEqual(parsed.directives.get("application"), "simpleFoam");
  });

  it("materializes scientific notation, powers, and safe math functions", () => {
    const dialect = getCfdDialect("su2");
    const template = `
REYNOLDS= {{ 1e5 * 2.5 }}
KINEMATIC_VISCOSITY= {{ 1.5e-5 / 1.225 }}
SQRT_VAL= {{ sqrt(16) }}
TRIG_VAL= {{ sind(90) }}
POWER_VAL= {{ 2 ^ 3 }}
NEG_POWER= {{ -(2 ^ 2) }}
PI_VAL= {{ PI }}
`;
    const materialized = dialect.materialize(template);
    assert.ok(materialized.includes("REYNOLDS= 250000"));
    assert.ok(materialized.includes("SQRT_VAL= 4"));
    assert.ok(materialized.includes("TRIG_VAL= 1"));
    assert.ok(materialized.includes("POWER_VAL= 8"));
    assert.ok(materialized.includes("NEG_POWER= -4"));
    assert.ok(materialized.includes("3.141593") || materialized.includes("3.14159"));
  });

  it("captures structured diagnostics on evaluation errors", () => {
    const dialect = getCfdDialect("su2");
    const diagnostics: any[] = [];
    const template = `BAD_EXPR= {{ unknown_var * 2 }}`;
    const materialized = dialect.materialize(template, { diagnostics });
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].severity, "error");
    assert.ok(diagnostics[0].message.includes("unresolved") || diagnostics[0].message.includes("Unresolved"));
    assert.ok(materialized.includes("BAD_EXPR= unknown_var * 2"));
  });

  it("parses SU2 inline comments and multi-marker declarations", () => {
    const dialect = getCfdDialect("su2");
    const config = `
% Header comment
MESH_FILENAME= wing_mesh.su2 % Surface mesh
MATH_PROBLEM= NAVIER_STOKES # Solver type
FREESTREAM_VELOCITY= ( 20.0, 5.0 ) % 2D velocity
MARKER_EULER= ( upper_surface, lower_surface, tip )
MARKER_HEATFLUX= ( body1, 0.0, body2, 150.0 )
`;
    const parsed = dialect.parse(config);
    assert.strictEqual(parsed.meshFilename, "wing_mesh.su2");
    assert.strictEqual(parsed.mathProblem, "NAVIER_STOKES");
    assert.deepStrictEqual(parsed.inletVelocity, [20.0, 5.0, 0.0]);
    assert.strictEqual(parsed.wallMarkers.length, 5);
    assert.ok(parsed.wallMarkers.includes("upper_surface"));
    assert.ok(parsed.wallMarkers.includes("lower_surface"));
    assert.ok(parsed.wallMarkers.includes("tip"));
    assert.ok(parsed.wallMarkers.includes("body1"));
    assert.ok(parsed.wallMarkers.includes("body2"));
    assert.ok(parsed.markers.has("tip"));
    assert.deepStrictEqual(parsed.markers.get("body2")?.options, [150]);
  });

  it("safely escapes regex characters when applying boundary actions", async () => {
    const { applyBoundaryActionToConfig } = await import("../src/index.js");
    const baseConfig = "MARKER_INLET= ( surf[1], 10.0 )\n";
    const updated = applyBoundaryActionToConfig(
      baseConfig,
      {
        kind: "inlet",
        targetId: "surf[1]",
        magnitude: 20.0,
      },
      "su2",
    );

    assert.ok(updated.includes("MARKER_INLET= ( surf[1], 20.00"));
    // Ensure it replaced rather than duplicated
    assert.strictEqual(updated.trim().split("\n").length, 1);
  });

  it("derives density, freestream velocity, lift, and drag coefficients from compressible SU2 RANS directives", async () => {
    const { extractCfdSlicingProperties } = await import("../src/index.js");
    const su2Deck = `
SOLVER= RANS
MACH_NUMBER= 0.5
AOA= 4.0
REYNOLDS_NUMBER= 3.0e6
FREESTREAM_PRESSURE= 101325.0
FREESTREAM_TEMPERATURE= 288.15
REF_LENGTH= 1.0
REF_AREA= 0.2
`;
    const props = extractCfdSlicingProperties(su2Deck);
    // Ideal gas density at 101325 Pa, 288.15 K = ~1.225 kg/m^3
    assert.ok(Math.abs(props.density - 1.225) < 0.01);
    // Speed of sound at 288.15 K is ~340.3 m/s -> Mach 0.5 is ~170.15 m/s
    assert.ok(Math.abs(props.freeStreamVelocity - 170.15) < 1.0);
    assert.strictEqual(props.machNumber, 0.5);
    assert.strictEqual(props.reynoldsNumber, 3.0e6);
    assert.ok(props.cl !== undefined && props.cl > 0.3 && props.cl < 0.6);
    assert.ok(props.cd > 0.01 && props.cd < 0.1);
    assert.ok(props.dragForce !== undefined && props.dragForce > 0);
    assert.ok(props.liftForce !== undefined && props.liftForce > props.dragForce!);
  });

  it("parses both 6-tuple and 5-tuple MARKER_INLET directives in SU2", () => {
    const dialect = getCfdDialect("su2");

    // 6-tuple: ( name, T0, V_or_P0, nx, ny, nz )
    const parsed6 = dialect.parse(`
MARKER_INLET= ( inlet_patch, 288.15, 10.0, 0.0, 0.0, -1.0 )
`);
    assert.strictEqual(parsed6.inletMarker, "inlet_patch");
    assert.strictEqual(parsed6.freestreamVelocity, 10.0);
    assert.deepStrictEqual(parsed6.inletVelocity, [0.0, 0.0, -10.0]);

    // 5-tuple: ( name, velMag, nx, ny, nz )
    const parsed5 = dialect.parse(`
MARKER_INLET= ( inlet_patch, 15.0, 1.0, 0.0, 0.0 )
`);
    assert.strictEqual(parsed5.inletMarker, "inlet_patch");
    assert.strictEqual(parsed5.freestreamVelocity, 15.0);
    assert.deepStrictEqual(parsed5.inletVelocity, [15.0, 0.0, 0.0]);
  });

  it("classifies OpenFOAM boundary patches by both patch name and type instead of BC value directive alone", () => {
    const dialect = getCfdDialect("openfoam");
    const foamContent = `
application     pimpleFoam;
boundaryField
{
    inlet
    {
        type            freestreamVelocity;
        freestreamValue uniform (20 0 0);
    }
    outlet
    {
        type            fixedValue;
        value           uniform 0;
    }
    fuselage_wall
    {
        type            zeroGradient;
    }
    symmetry_side
    {
        type            symmetryPlane;
    }
}
`;
    const parsed = dialect.parse(foamContent);
    assert.strictEqual(parsed.inletMarker, "inlet");
    assert.deepStrictEqual(parsed.inletVelocity, [20, 0, 0]);
    assert.strictEqual(parsed.outletMarker, "outlet");
    assert.ok(parsed.wallMarkers.includes("fuselage_wall"));
    assert.strictEqual(parsed.markers.get("outlet")?.type, "OUTLET");
    assert.strictEqual(parsed.markers.get("fuselage_wall")?.type, "WALL");
    assert.strictEqual(parsed.markers.get("symmetry_side")?.type, "SYMMETRY");
  });

  it("evaluates multi-regime aerodynamic and crossflow drag with proper wing aspect ratio S/c^2", async () => {
    const { extractCfdSlicingProperties } = await import("../src/index.js");

    // Vertical climb / crossflow (90 deg AOA via 6-tuple MARKER_INLET along -z)
    const verticalClimbDeck = `
SOLVER= INC_RANS
FREESTREAM_VELOCITY= ( 0.0, 0.0, -10.0 )
FREESTREAM_DENSITY= 1.225
REF_AREA= 0.12
REF_LENGTH= 0.45
REYNOLDS_NUMBER= 3.0e5
MARKER_INLET= ( inlet_patch, 288.15, 10.0, 0.0, 0.0, -1.0 )
`;
    const climbProps = extractCfdSlicingProperties(verticalClimbDeck);
    assert.strictEqual(climbProps.freeStreamVelocity, 10.0);
    assert.strictEqual(climbProps.cd, 0.8);
    assert.strictEqual(climbProps.cl, 0);

    // High-aspect-ratio wing (c = 0.2 m, S = 1.6 m^2 -> AR = S/c^2 = 40) vs low-AR wing (c = 0.5 m, S = 1.0 m^2 -> AR = 4)
    const highArWing = extractCfdSlicingProperties(`
SOLVER= RANS
MACH_NUMBER= 0.3
AOA= 5.0
REYNOLDS_NUMBER= 2.0e6
REF_LENGTH= 0.2
REF_AREA= 1.6
`);
    const lowArWing = extractCfdSlicingProperties(`
SOLVER= RANS
MACH_NUMBER= 0.3
AOA= 5.0
REYNOLDS_NUMBER= 2.0e6
REF_LENGTH= 0.5
REF_AREA= 1.0
`);
    // High-AR wing has higher lift slope and lower induced drag share at same AOA
    assert.ok(highArWing.cl! > lowArWing.cl!);
  });
});
