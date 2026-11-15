// SPDX-License-Identifier: AGPL-3.0-or-later

import { McapWriter, Mdf4Writer } from "@modelscript/exchange/telemetry";
import { trainWamResidual } from "@modelscript/simulate/wam";
import { parseUrdf } from "@modelscript/urdf/parser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_2DOF_ARM_URDF,
  generateDemoWamDataset,
  parseTelemetryLogToWamDataset,
  parseWamCsvDataset,
  simulateClosedLoopRobot,
} from "./wamLabEngine.ts";

describe("WAM Telemetry Log Ingestion & ABA Control", () => {
  it("parses MCAP binary buffer into WamTrainingDataset", () => {
    const t = new Float64Array([0, 0.5, 1.0]);
    const bytes = McapWriter.create([
      { topic: "q_shoulder", timestamps: t, values: new Float64Array([0.1, 0.4, 0.7]) },
      { topic: "dq_shoulder", timestamps: t, values: new Float64Array([0.6, 0.5, 0.3]) },
      { topic: "u_shoulder", timestamps: t, values: new Float64Array([1.2, 1.5, 1.1]) },
      { topic: "tau_res_shoulder", timestamps: t, values: new Float64Array([0.25, 0.35, 0.2]) },
    ]);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const dataset = parseTelemetryLogToWamDataset(buf, "rollout.mcap", ["shoulder"]);
    assert.equal(dataset.times.length, 3);
    assert.deepEqual(dataset.jointNames, ["shoulder"]);
    assert.ok(Math.abs(dataset.q[1]![0]! - 0.4) < 1e-6);
    assert.ok(Math.abs(dataset.tauResidual[2]![0]! - 0.2) < 1e-6);
  });

  it("disambiguates q_j1 vs q_j10, sorts timestamps, and finite-differences missing dq in MCAP", () => {
    const tUnsorted = new Float64Array([1.0, 0.0, 0.5]);
    const bytes = McapWriter.create([
      { topic: "/robot/q_j10", timestamps: tUnsorted, values: new Float64Array([99, 99, 99]) },
      { topic: "/robot/q_j1", timestamps: tUnsorted, values: new Float64Array([2.0, 0.0, 1.0]) },
      { topic: "/robot/tau_res_j1", timestamps: tUnsorted, values: new Float64Array([0.3, 0.1, 0.2]) },
    ]);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const dataset = parseTelemetryLogToWamDataset(buf, "unsorted.mcap", ["j1"]);
    assert.deepEqual(dataset.times, [0.0, 0.5, 1.0]);
    assert.ok(Math.abs(dataset.q[0]![0]! - 0.0) < 1e-6);
    assert.ok(Math.abs(dataset.q[1]![0]! - 1.0) < 1e-6);
    assert.ok(Math.abs(dataset.q[2]![0]! - 2.0) < 1e-6);
    // Finite difference of q=[0, 1, 2] over t=[0, 0.5, 1.0] => dq = 2.0 rad/s
    assert.ok(Math.abs(dataset.dq[1]![0]! - 2.0) < 1e-6);
  });

  it("parses MDF4 binary buffer into WamTrainingDataset", () => {
    const t = new Float64Array([0, 0.5, 1.0]);
    const bytes = Mdf4Writer.create([
      { name: "q_shoulder", timestamps: t, values: new Float64Array([0.0, 0.3, 0.6]) },
      { name: "dq_shoulder", timestamps: t, values: new Float64Array([0.5, 0.5, 0.5]) },
      { name: "u_shoulder", timestamps: t, values: new Float64Array([1.0, 1.2, 1.4]) },
      { name: "tau_res_shoulder", timestamps: t, values: new Float64Array([0.15, 0.22, 0.18]) },
    ]);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const dataset = parseTelemetryLogToWamDataset(buf, "bench.mf4", ["shoulder"]);
    assert.equal(dataset.times.length, 3);
    assert.ok(Math.abs(dataset.q[2]![0]! - 0.6) < 1e-6);
    assert.ok(Math.abs(dataset.tauResidual[1]![0]! - 0.22) < 1e-6);
  });

  it("parses out-of-order quoted CSV headers and computes missing dq via finite differences", () => {
    const csv = [
      '"tau_res_j1","q_j1","time","u_j1"',
      '"0.4","0.0","0.0","1.0"',
      '"0.5","0.5","0.5","1.5"',
      '"0.6","1.0","1.0","2.0"',
    ].join("\n");

    const dataset = parseWamCsvDataset(csv, ["j1"]);
    assert.deepEqual(dataset.times, [0.0, 0.5, 1.0]);
    assert.ok(Math.abs(dataset.q[1]![0]! - 0.5) < 1e-6);
    assert.ok(Math.abs(dataset.u[2]![0]! - 2.0) < 1e-6);
    assert.ok(Math.abs(dataset.tauResidual[0]![0]! - 0.4) < 1e-6);
    assert.ok(Math.abs(dataset.dq[1]![0]! - 1.0) < 1e-6);
  });

  it("improves Featherstone ABA closed-loop tracking RMSE after training WAM residual", () => {
    const robot = parseUrdf(DEFAULT_2DOF_ARM_URDF);
    const dataset = generateDemoWamDataset(robot);
    const trainedWam = trainWamResidual(dataset, {
      hiddenLayers: [16, 16],
      epochs: 120,
      learningRate: 0.018,
    });

    const baseline = simulateClosedLoopRobot(DEFAULT_2DOF_ARM_URDF, null, 3.0, 0.02);
    const hybrid = simulateClosedLoopRobot(DEFAULT_2DOF_ARM_URDF, trainedWam, 3.0, 0.02);

    assert.ok(Number.isFinite(baseline.trackingRmse) && baseline.trackingRmse > 0);
    assert.ok(
      hybrid.trackingRmse < baseline.trackingRmse,
      `Expected hybrid RMSE (${hybrid.trackingRmse}) < baseline RMSE (${baseline.trackingRmse})`,
    );
  });
});
