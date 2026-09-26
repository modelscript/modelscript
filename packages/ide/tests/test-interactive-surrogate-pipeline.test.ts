// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CaeParametricSampler,
  CaeSnapshotExtractor,
  CaeSurrogateBridge,
  ModelicaSurrogateEmitter,
} from "@modelscript/simulate";
import assert from "node:assert";
import { describe, it } from "node:test";
import { reconstructSurrogate } from "../src/webview/cad-viewer/surrogate-live-explorer.js";

describe("Interactive ROM Surrogate Generation & Modelica .mo Export Pipeline", () => {
  const cantileverDeck = `
*HEADING
Cantilever beam under tip load
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 0.5, 0.866, 0.0
4, 0.5, 0.288, 0.816
*ELEMENT, TYPE=C3D4, ELSET=BEAM
1, 1, 2, 3, 4
*NSET, NSET=FIXED
1, 2, 3
*NSET, NSET=TIP
4
*MATERIAL, NAME=STEEL
*ELASTIC
210.0e9, 0.30
*STEP
*STATIC
*BOUNDARY
FIXED, 1, 3, 0.0
*CLOAD
TIP, 3, -5000.0
*END STEP
`;

  it("samples FEA operating envelope across parametric load and modulus sweeps", () => {
    const runs = CaeParametricSampler.sampleFeaDeck(cantileverDeck, {
      loadMultipliers: [0.6, 0.8, 1.0, 1.2, 1.4],
      modulusMultipliers: [0.9, 1.0, 1.1],
    });

    assert.strictEqual(runs.length, 15, "Should generate 5 loads * 3 moduli = 15 runs");
    for (const run of runs) {
      assert.ok(run.scalarOutputs.maxStress > 0, "Max stress must be positive");
      assert.ok(run.scalarOutputs.maxDisplacement > 0, "Max displacement must be positive");
      assert.ok(run.fields.vonMisesStress.length === 4, "4 nodes should have von Mises stresses");
      assert.ok(run.fields.displacements.length === 12, "4 nodes * 3 DOF = 12 displacements");
    }

    // Monotonicity check: at baseline modulus (210 GPa), higher loadMultiplier => higher maxStress
    const baselineModulusRuns = runs.filter((r) => Math.abs(r.parameters.youngsModulus - 210.0) < 1.0);
    assert.strictEqual(baselineModulusRuns.length, 5);
    for (let i = 1; i < baselineModulusRuns.length; i++) {
      assert.ok(
        baselineModulusRuns[i]!.scalarOutputs.maxStress > baselineModulusRuns[i - 1]!.scalarOutputs.maxStress,
        "Stress must scale monotonically with load factor",
      );
    }
  });

  it("extracts 3D snapshot matrix and trains POD-Galerkin surrogate with high fidelity", () => {
    const runs = CaeParametricSampler.sampleFeaDeck(cantileverDeck, {
      loadMultipliers: [0.5, 0.75, 1.0, 1.25, 1.5],
      modulusMultipliers: [1.0],
    });

    const dataset = CaeSnapshotExtractor.extractFromRuns(runs, {
      targetField: "vonMisesStress",
    });

    assert.strictEqual(dataset.numSnapshots, 5);
    assert.strictEqual(dataset.numFeatures, 4);
    assert.ok(dataset.parameterNames.includes("loadScale"));
    assert.ok(dataset.parameterNames.includes("youngsModulus"));
    assert.ok(dataset.scalarOutputNames.includes("maxStress"));

    // Train POD surrogate
    const surrogate = CaeSurrogateBridge.train(dataset, {
      energyThreshold: 0.999,
      maxModes: 4,
      polynomialDegree: 2,
    });

    assert.ok(surrogate.podSurrogate.numModes >= 1, "Must retain at least 1 mode");
    assert.ok(surrogate.metrics.capturedEnergy > 0.99, "Must capture >99% energy");

    // Evaluation
    const pred1 = surrogate.evaluate({ loadScale: 1.0, youngsModulus: 210.0 });
    const pred2 = surrogate.evaluate({ loadScale: 1.5, youngsModulus: 210.0 });
    assert.ok(
      pred2.scalarOutputs.maxStress > pred1.scalarOutputs.maxStress,
      "Surrogate prediction must reflect load increase",
    );
    assert.strictEqual(pred1.field.length, 4, "Reconstructed field must match node count");
  });

  it("synthesizes valid Modelica (.mo) component code and FMI 3.0 C sources", () => {
    const runs = CaeParametricSampler.sampleFeaDeck(cantileverDeck, {
      loadMultipliers: [0.6, 0.8, 1.0, 1.2, 1.4],
      modulusMultipliers: [1.0],
    });
    const dataset = CaeSnapshotExtractor.extractFromRuns(runs, { targetField: "vonMisesStress" });
    const surrogate = CaeSurrogateBridge.train(dataset, { maxModes: 3, polynomialDegree: 2 });

    const modelName = "Cantilever_Surrogate";
    const moCode = ModelicaSurrogateEmitter.emitModelica(surrogate, {
      modelName,
      packageName: "ModelScript.Surrogates",
      parameterUnits: {
        loadScale: "Real",
        youngsModulus: "Modelica.Units.SI.Pressure",
      },
      outputUnits: {
        maxStress: "Modelica.Units.SI.Pressure",
        maxDisplacement: "Modelica.Units.SI.Length",
      },
    });

    assert.ok(moCode.includes(`model ${modelName}`), "Must declare Modelica model");
    assert.ok(moCode.includes("parameter Real loadScale"), "Must declare loadScale parameter");
    assert.ok(moCode.includes("Modelica.Units.SI.Pressure maxStress"), "Must declare physical output with SI units");
    assert.ok(moCode.includes("protected Real a_mode_0"), "Must declare latent mode coordinates");
    assert.ok(moCode.includes("equation"), "Must have equation section");
    assert.ok(moCode.includes("annotation("), "Must include metadata annotation");
    assert.ok(moCode.includes(`end ${modelName};`), "Must close model");

    // FMI 3.0 export
    const fmi = ModelicaSurrogateEmitter.emitFmi3CSource(surrogate, modelName);
    assert.ok(fmi.header.includes(`${modelName}_evaluate`), "Header must declare evaluate function");
    assert.ok(fmi.source.includes("FMI3_POLY_COLS"), "C source must evaluate polynomial basis");
    assert.ok(fmi.modelDescriptionXml.includes('fmiVersion="3.0"'), "XML must be FMI 3.0 compliant");
    assert.ok(fmi.modelDescriptionXml.includes('name="loadScale"'), "XML must declare loadScale input");
    assert.ok(fmi.modelDescriptionXml.includes('name="maxStress"'), "XML must declare maxStress output");
  });

  it("reconstructs 3D fields and physical scalars client-side in real-time (60 FPS ROM Twin)", () => {
    const runs = CaeParametricSampler.sampleFeaDeck(cantileverDeck, {
      loadMultipliers: [0.6, 0.8, 1.0, 1.2, 1.4],
      modulusMultipliers: [1.0],
    });
    const dataset = CaeSnapshotExtractor.extractFromRuns(runs, { targetField: "vonMisesStress" });
    const surrogate = CaeSurrogateBridge.train(dataset, { maxModes: 3, polynomialDegree: 2 });
    const dataPayload = surrogate.toData();

    assert.strictEqual(dataPayload.numFeatures, 4);
    assert.ok(dataPayload.numModes >= 1);
    assert.strictEqual(dataPayload.latentCoeffs.length, dataPayload.numModes);
    assert.strictEqual(dataPayload.scalarCoeffs.length, dataPayload.scalarOutputNames.length);

    // Client-side reconstruct at 1.0x load
    const t0 = performance.now();
    const result10 = reconstructSurrogate(dataPayload, { loadScale: 1.0, youngsModulus: 210.0 });
    const dt = performance.now() - t0;

    assert.ok(dt < 5.0, `Reconstruction took ${dt.toFixed(3)}ms (must be <5ms for 60 FPS)`);
    assert.strictEqual(result10.field.length, 4);
    assert.ok(result10.scalars.maxStress > 0);

    // Reconstruct at 2.0x load
    const result20 = reconstructSurrogate(dataPayload, { loadScale: 2.0, youngsModulus: 210.0 });
    assert.ok(
      result20.scalars.maxStress > result10.scalars.maxStress,
      "Doubling load in twin slider must increase predicted stress",
    );
  });

  it("samples aerodynamic CFD envelope and generates aerodynamic Modelica surrogate", () => {
    const baselineMesh = {
      positions: [-1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, -1, 0.5, 0],
      indices: [0, 1, 2, 0, 2, 3],
    };

    const cfdRuns = CaeParametricSampler.sampleCfdEnvelope(baselineMesh, {
      velocities: [30, 45, 60],
      anglesOfAttackDeg: [0, 5, 10],
    });

    assert.strictEqual(cfdRuns.length, 9, "3 velocities * 3 AoA = 9 CFD runs");
    for (const r of cfdRuns) {
      assert.ok(r.fields.pressure.length === 4, "4 surface nodes should have pressure");
      assert.ok(r.fields.velocity.length === 12, "4 nodes * 3 DOF = 12 velocity components");
      assert.ok(r.scalarOutputs.dragForce > 0, "Drag force must be positive");
      assert.ok(r.scalarOutputs.liftForce !== undefined, "Lift force must be defined");
    }

    const cfdDataset = CaeSnapshotExtractor.extractFromRuns(cfdRuns, { targetField: "pressure" });
    const cfdSurrogate = CaeSurrogateBridge.train(cfdDataset, { maxModes: 4, polynomialDegree: 2 });

    const cfdMo = ModelicaSurrogateEmitter.emitModelica(cfdSurrogate, {
      modelName: "Airfoil_Aero_Surrogate",
      parameterUnits: {
        freestreamVelocity: "Modelica.Units.SI.Velocity",
        angleOfAttackDeg: "Modelica.Units.SI.Angle",
      },
      outputUnits: {
        liftForce: "Modelica.Units.SI.Force",
        dragForce: "Modelica.Units.SI.Force",
        maxPressure: "Modelica.Units.SI.Pressure",
      },
    });

    assert.ok(cfdMo.includes("model Airfoil_Aero_Surrogate"));
    assert.ok(cfdMo.includes("Modelica.Units.SI.Velocity freestreamVelocity"));
    assert.ok(cfdMo.includes("Modelica.Units.SI.Force liftForce"));
    assert.ok(cfdMo.includes("Modelica.Units.SI.Force dragForce"));
  });
});
