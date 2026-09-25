// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeSu2Config } from "@modelscript/cfd";
import { materializeCalculixDeck } from "@modelscript/fea";
import { loadCfgToLbm, loadInpToFea } from "@modelscript/simulate";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("Cross-Domain Digital Thread: SysML v2 -> Parametric Decks (.inpt / .cfgt) -> WASM Solvers", () => {
  it("synchronizes SysML v2 attributes into CalculiX and SU2 decks and executes in-WASM physics", () => {
    // 1. SysML v2 System Attributes
    const sysmlAttributes: Record<string, number | string> = {
      "DroneArm.name": "CarbonDroneArm",
      "DroneArm.youngsModulus": 70e9,
      "DroneArm.poissonsRatio": 0.33,
      "DroneArm.thrustForce": 25.0,
      "DroneArm.inletVelocity": 18.0,
      "Atmosphere.airDensity": 1.225,
    };

    // 2. Parametric CalculiX Deck (.inpt)
    const inptTemplate = `** CalculiX Parametric Deck for {{ DroneArm.name }}
*HEADING
Automated 3D Structural FEA
*NODE
1, 0.0, 0.0, 0.0
2, 0.5, 0.0, 0.0
3, 0.0, 0.05, 0.0
4, 0.0, 0.0, 0.025
*ELEMENT, TYPE=C3D4, ELSET=ARM_BODY
1, 1, 2, 3, 4
*MATERIAL, NAME=ALUMINUM
*ELASTIC
 {{ DroneArm.youngsModulus }}, {{ DroneArm.poissonsRatio }}
*STEP
*STATIC
*BOUNDARY
 1, 1, 3
*CLOAD
 2, 2, {{ DroneArm.thrustForce * 1.5 }}
*END STEP
`;

    // 3. Parametric SU2 CFD Config (.cfgt)
    const cfgtTemplate = `% SU2 Parametric CFD Config for {{ DroneArm.name }}
MATH_PROBLEM= NAVIER_STOKES
MACH_NUMBER= 0.15
FREESTREAM_DENSITY= {{ Atmosphere.airDensity }}
FREESTREAM_VELOCITY= ( {{ DroneArm.inletVelocity }}, 0.0, 0.0 )
MARKER_INLET= ( inlet, {{ DroneArm.inletVelocity }}, 1.0, 0.0, 0.0 )
MARKER_HEATFLUX= ( arm_wall, 0.0 )
`;

    // 4. Materialize on-demand
    const materializedInp = materializeCalculixDeck(inptTemplate, { evaluator: sysmlAttributes });
    const materializedCfg = materializeSu2Config(cfgtTemplate, { evaluator: sysmlAttributes });

    // Verify FEA materialization
    assert.ok(materializedInp.includes("70000000000, 0.33") || materializedInp.includes("7e+10, 0.33"));
    assert.ok(materializedInp.includes("2, 2, 37.5"));

    // Verify CFD materialization
    assert.ok(materializedCfg.includes("FREESTREAM_DENSITY= 1.225"));
    assert.ok(materializedCfg.includes("FREESTREAM_VELOCITY= ( 18, 0.0, 0.0 )"));
    assert.ok(materializedCfg.includes("MARKER_INLET= ( inlet, 18, 1.0, 0.0, 0.0 )"));

    // 5. Ingest into in-WASM FeaSolver and step physics
    const feaSetup = loadInpToFea(materializedInp);
    const feaRes = feaSetup.solver.step(feaSetup.bcs);
    assert.ok(feaRes.maxDisplacement > 0);
    assert.ok(feaRes.maxVonMisesStress > 0);

    // 6. Ingest into in-WASM LbmGridConfig
    const lbmConfig = loadCfgToLbm(materializedCfg, { nx: 64, ny: 32, nz: 32 });
    assert.strictEqual(lbmConfig.density, 1.225);
    assert.deepStrictEqual(lbmConfig.inletVelocity, [18, 0, 0]);
    assert.ok(lbmConfig.tau > 0.5);

    // 7. Reactive Update: Engineer changes requirements in SysML v2
    sysmlAttributes["DroneArm.thrustForce"] = 50.0;
    sysmlAttributes["DroneArm.inletVelocity"] = 30.0;

    const rematerializedInp = materializeCalculixDeck(inptTemplate, { evaluator: sysmlAttributes });
    const rematerializedCfg = materializeSu2Config(cfgtTemplate, { evaluator: sysmlAttributes });

    assert.ok(rematerializedInp.includes("2, 2, 75")); // 50.0 * 1.5
    assert.ok(rematerializedCfg.includes("FREESTREAM_VELOCITY= ( 30, 0.0, 0.0 )"));

    // Verify that new physics step reflects higher load
    const updatedFeaSetup = loadInpToFea(rematerializedInp);
    const updatedFeaRes = updatedFeaSetup.solver.step(updatedFeaSetup.bcs);
    assert.ok(
      updatedFeaRes.maxDisplacement > feaRes.maxDisplacement,
      "Displacement should increase under higher thrust",
    );
  });
});
