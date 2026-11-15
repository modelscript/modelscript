// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelicaSurrogateEmitter } from "../src/surrogates/modelica-surrogate-emitter.js";
import {
  createWamEvalScratch,
  evaluateWamResidual,
  sanitizeModelicaIdent,
  trainWamResidual,
  type WamTrainingDataset,
} from "../src/surrogates/wam-residual-trainer.js";

describe("WAM Residual Trainer & Modelica Emitter", () => {
  it("learns nonlinear friction + gravity residual torque and emits valid Modelica block", () => {
    const nSamples = 80;
    const times: number[] = [];
    const q: number[][] = [];
    const dq: number[][] = [];
    const u: number[][] = [];
    const tauResidual: number[][] = [];

    for (let i = 0; i < nSamples; i++) {
      const t = (i / (nSamples - 1)) * 4.0;
      const q1 = Math.sin(1.2 * t);
      const q2 = 0.7 * Math.cos(1.5 * t);
      const dq1 = 1.2 * Math.cos(1.2 * t);
      const dq2 = -1.05 * Math.sin(1.5 * t);
      const u1 = 2.0 * Math.sin(t);
      const u2 = 1.5 * Math.cos(t);

      // Synthetic unmodeled physics: Coulomb/Stribeck friction + unmodeled gravity offset
      const res1 = 0.8 * Math.tanh(4.0 * dq1) + 0.35 * Math.sin(q1) + 0.1 * u1;
      const res2 = 0.6 * Math.tanh(4.0 * dq2) + 0.25 * Math.cos(q1 + q2);

      times.push(t);
      q.push([q1, q2]);
      dq.push([dq1, dq2]);
      u.push([u1, u2]);
      tauResidual.push([res1, res2]);
    }

    const dataset: WamTrainingDataset = {
      times,
      jointNames: ["shoulder", "elbow"],
      q,
      dq,
      u,
      tauResidual,
    };

    const progressEpochs: number[] = [];
    const trained = trainWamResidual(dataset, {
      hiddenLayers: [16, 16],
      epochs: 220,
      learningRate: 0.02,
      progressInterval: 55,
      onProgress: (p) => progressEpochs.push(p.epoch),
    });

    assert.ok(progressEpochs.length >= 4, "Expected progress callbacks during training");
    assert.ok(
      trained.lossHistory[trained.lossHistory.length - 1]! < trained.lossHistory[0]!,
      "Expected training loss to decrease",
    );
    assert.ok(trained.rSquared > 0.9, `Expected R^2 > 0.9, got ${trained.rSquared}`);

    const samplePred = evaluateWamResidual(trained, q[10]!, dq[10]!, u[10]!);
    const scratch = createWamEvalScratch(trained);
    const scratchPred = evaluateWamResidual(trained, q[10]!, dq[10]!, u[10]!, scratch);
    assert.equal(samplePred.length, 2);
    assert.deepEqual(scratchPred, samplePred);
    assert.ok(Math.abs(samplePred[0]! - tauResidual[10]![0]!) < 0.25);

    const modelica = ModelicaSurrogateEmitter.emitWamResidualModelica(trained, {
      modelName: "ArmWamResidual",
      omitWithin: true,
    });

    assert.ok(modelica.includes("block ArmWamResidual"));
    assert.ok(modelica.includes("input Real q_shoulder;"));
    assert.ok(modelica.includes("input Real dq_elbow;"));
    assert.ok(modelica.includes("input Real u_shoulder;"));
    assert.ok(modelica.includes("output Real tau_res_shoulder;"));
    assert.ok(modelica.includes("tanh("));
    assert.ok(modelica.includes("end ArmWamResidual;"));

    const matrixModelica = ModelicaSurrogateEmitter.emitWamResidualModelica(trained, {
      modelName: "ArmWamMatrix",
      omitWithin: true,
      useMatrixForm: true,
    });
    assert.ok(matrixModelica.includes("parameter Real W_0[16, 6]"));
    assert.ok(matrixModelica.includes("for o in 1:16 loop"));
    assert.ok(matrixModelica.includes("tanh("));
    assert.ok(matrixModelica.includes("end ArmWamMatrix;"));
  });

  it("sanitizes Modelica identifiers with digit prefixes and collision deduplication", () => {
    const used = new Set<string>();
    assert.equal(sanitizeModelicaIdent("1-arm.joint", used), "_1_arm_joint");
    assert.equal(sanitizeModelicaIdent("1 arm/joint", used), "_1_arm_joint_2");
    assert.equal(sanitizeModelicaIdent("", used), "ident");
  });

  it("handles constant features and single-sample datasets without NaN/Infinity", () => {
    const dataset: WamTrainingDataset = {
      times: [0],
      jointNames: ["1-joint"],
      q: [[0.5]],
      dq: [[0.0]],
      u: [[1.0]],
      tauResidual: [[0.25]],
    };

    const trained = trainWamResidual(dataset, {
      hiddenLayers: [4],
      epochs: 20,
      learningRate: 0.01,
    });
    assert.ok(Number.isFinite(trained.finalMse));
    for (const s of trained.inputStd) assert.equal(s, 1.0);
    const pred = evaluateWamResidual(trained, [0.5], [0.0], [1.0]);
    assert.ok(Number.isFinite(pred[0]));
  });
});
