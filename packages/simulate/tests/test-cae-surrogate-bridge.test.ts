// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CaeSnapshotExtractor,
  CaeSurrogateBridge,
  ModelicaSurrogateEmitter,
  type CaeRunResult,
} from "../src/surrogates/index.js";

describe("Track 4: CAE Continuum-to-System Surrogate ROM Pipeline", () => {
  // Synthesize 10 parametric 3D simulation runs (e.g. angle of attack & velocity sweep)
  const numNodes = 200;
  const numRuns = 12;
  const mockRuns: CaeRunResult[] = [];

  for (let j = 0; j < numRuns; j++) {
    const v_inlet = 20.0 + j * 5.0; // 20 to 75 m/s
    const aoa = (j * 2.0 * Math.PI) / 180.0; // 0 to 22 deg

    // Physical spatial field: von Mises stress / pressure field distributed over 200 nodes
    const field = new Float32Array(numNodes);
    for (let i = 0; i < numNodes; i++) {
      const x = i / numNodes;
      field[i] = (100.0 + 2.5 * v_inlet + 50.0 * Math.sin(aoa + x * Math.PI)) * (1.0 + 0.1 * Math.cos(2 * x));
    }

    // Scalar outputs: drag force, lift force, max stress
    const dragForce = 0.5 * 1.225 * v_inlet * v_inlet * 0.03 + 25.0 * Math.sin(aoa);
    const liftForce = 0.5 * 1.225 * v_inlet * v_inlet * 0.25 * Math.sin(aoa + 0.05);
    const maxStress = Math.max(...field);

    mockRuns.push({
      runId: `sim_run_${j}`,
      parameters: { v_inlet, aoa },
      scalarOutputs: { dragForce, liftForce, maxStress },
      fields: {
        vonMisesStress: field,
      },
    });
  }

  it("extracts aligned 3D field snapshot dataset from simulation runs", () => {
    const dataset = CaeSnapshotExtractor.extractFromRuns(mockRuns, {
      targetField: "vonMisesStress",
      expectedFeatures: numNodes,
    });

    assert.equal(dataset.numSnapshots, numRuns);
    assert.equal(dataset.numFeatures, numNodes);
    assert.deepEqual(dataset.parameterNames, ["v_inlet", "aoa"]);
    assert.ok(dataset.scalarOutputNames.includes("dragForce"));
    assert.ok(dataset.scalarOutputNames.includes("maxStress"));
    assert.equal(dataset.snapshots.length, numNodes * numRuns);
  });

  it("trains high-performance POD-Galerkin surrogate with Sirovich snapshot reduction", () => {
    const dataset = CaeSnapshotExtractor.extractFromRuns(mockRuns, {
      targetField: "vonMisesStress",
    });

    const surrogate = CaeSurrogateBridge.train(dataset, {
      energyThreshold: 0.999,
      maxModes: 6,
      polynomialDegree: 2,
      validationSplit: 0.2,
    });

    assert.ok(
      surrogate.metrics.capturedEnergy >= 0.99,
      `Captured energy ${surrogate.metrics.capturedEnergy} should be >= 99%`,
    );
    assert.ok(surrogate.metrics.numModes <= 6);
    assert.ok(surrogate.metrics.r2.dragForce! > 0.95, `Drag R² ${surrogate.metrics.r2.dragForce} should be > 0.95`);

    // Test evaluation at an interpolated operating condition
    const pred = surrogate.evaluate({ v_inlet: 45.0, aoa: 0.15 });
    assert.ok(pred.scalarOutputs.dragForce! > 0);
    assert.ok(pred.scalarOutputs.maxStress! > 100);
    assert.equal(pred.field.length, numNodes);
  });

  it("lowers POD surrogate equations directly into IDaeBuilder linear memory arena", () => {
    const dataset = CaeSnapshotExtractor.extractFromRuns(mockRuns, {
      targetField: "vonMisesStress",
    });

    const surrogate = CaeSurrogateBridge.train(dataset, {
      energyThreshold: 0.999,
      maxModes: 4,
    });

    const builder = new DAEBuilder();
    const vId = builder.addVariable("v_inlet", 0, 0, 1);
    const aoaId = builder.addVariable("aoa", 0, 0, 1);

    const lowered = surrogate.lowerToDae(
      builder,
      { v_inlet: vId, aoa: aoaId },
      { outputPrefix: "rom", computeLatent: true },
    );

    assert.ok(lowered.scalarVarIds.dragForce !== undefined);
    assert.ok(lowered.scalarVarIds.maxStress !== undefined);
    assert.equal(lowered.latentVarIds.length, surrogate.podSurrogate.numModes);

    // Verify DAE has compiled equations
    assert.ok(builder.getEqCount() >= 3);
  });

  it("synthesizes Modelica (.mo) component code and FMI 3.0 C headers", () => {
    const dataset = CaeSnapshotExtractor.extractFromRuns(mockRuns, {
      targetField: "vonMisesStress",
    });

    const surrogate = CaeSurrogateBridge.train(dataset, {
      energyThreshold: 0.999,
      maxModes: 4,
    });

    const moCode = ModelicaSurrogateEmitter.emitModelica(surrogate, {
      modelName: "WingRootStressSurrogate",
      packageName: "Airframe.Surrogates",
      parameterUnits: {
        v_inlet: "Modelica.Units.SI.Velocity",
        aoa: "Modelica.Units.SI.Angle",
      },
      outputUnits: {
        dragForce: "Modelica.Units.SI.Force",
        maxStress: "Modelica.Units.SI.Stress",
      },
    });

    assert.ok(moCode.includes("within Airframe.Surrogates;"));
    assert.ok(moCode.includes("model WingRootStressSurrogate"));
    assert.ok(moCode.includes("parameter Modelica.Units.SI.Velocity v_inlet"));
    assert.ok(moCode.includes("Modelica.Units.SI.Force dragForce"));
    assert.ok(moCode.includes("end WingRootStressSurrogate;"));

    const fmi3 = ModelicaSurrogateEmitter.emitFmi3CSource(surrogate, "wing_rom_fmu");
    assert.ok(fmi3.header.includes("wing_rom_fmu_evaluate"));
    assert.ok(fmi3.modelDescriptionXml.includes('<fmiModelDescription fmiVersion="3.0"'));
  });
});
