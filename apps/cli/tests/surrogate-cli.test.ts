// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportROMToONNX, trainROM } from "@modelscript/simulate";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Surrogate } from "../src/commands/surrogate.js";

describe("MSC CLI Surrogate Command (Export Formats, Guardrails, ONNX Import)", () => {
  const tmpDir = path.resolve(process.cwd(), "scratch_test_surrogate_cli");
  const onnxPath = path.join(tmpDir, "test_model.onnx.json");
  const moPath = path.join(tmpDir, "Cooler_Surrogate.mo");
  const cPath = path.join(tmpDir, "Cooler_surrogate.c");
  const reportPath = path.join(tmpDir, "surrogate_report.json");

  before(async () => {
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a mock ONNX graph file using exportROMToONNX
    const dummyRom = trainROM({
      data: {
        inputs: [
          [290.0, 1.0],
          [310.0, 2.0],
          [330.0, 3.0],
        ],
        outputs: [[300.0], [315.0], [325.0]],
        inputNames: ["inlet_temp", "mass_flow"],
        outputNames: ["outlet_temp"],
        snapshotTimes: [0.0],
        isTransient: false,
        wallClockMs: 1,
        failedSamples: 0,
        totalSamples: 3,
      },
      architecture: "mlp",
      hiddenLayers: [8, 8],
      activation: "tanh",
      epochs: 50,
      learningRate: 0.01,
      seed: 42,
    });

    const onnxData = exportROMToONNX(dummyRom, "Cooler");
    await fs.writeFile(onnxPath, JSON.stringify(onnxData, null, 2), "utf-8");
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("imports ONNX model and exports Modelica block with active extrapolation guardrails", async () => {
    await Surrogate.handler({
      name: "Cooler",
      fromOnnx: onnxPath,
      format: "mo",
      "input-bounds": "inlet_temp:280.0:350.0,mass_flow:0.5:5.0",
      inputBounds: "inlet_temp:280.0:350.0,mass_flow:0.5:5.0",
      "extrapolation-guardrails": true,
      extrapolationGuardrails: true,
      "extrapolation-flag": true,
      extrapolationFlag: true,
      "extrapolation-level": "warning",
      extrapolationLevel: "warning",
      "out-file": moPath,
      outFile: moPath,
      report: reportPath,
      strategy: "latin-hypercube",
      "num-samples": 10,
      numSamples: 10,
      architecture: "mlp",
    } as any);

    const moContent = await fs.readFile(moPath, "utf-8");
    assert.ok(moContent.includes("block Cooler_Surrogate"));
    assert.ok(moContent.includes("input Real inlet_temp"));
    assert.ok(moContent.includes("input Real mass_flow"));
    assert.ok(moContent.includes("output Real outlet_temp"));
    assert.ok(moContent.includes("output Boolean isExtrapolating"));
    assert.ok(moContent.includes("assert(inlet_temp >= 280.0 and inlet_temp <= 350.0"));
    assert.ok(moContent.includes("assert(mass_flow >= 0.5 and mass_flow <= 5.0"));
    assert.ok(moContent.includes("isExtrapolating ="));
    assert.ok(moContent.includes("algorithm"));
    assert.ok(moContent.includes("Modelica.Math.tanh"));

    const reportContent = JSON.parse(await fs.readFile(reportPath, "utf-8"));
    assert.equal(reportContent.model, "Cooler");
    assert.deepEqual(reportContent.parameterBounds.inlet_temp, { min: 280, max: 350 });
  });

  test("imports ONNX model and exports zero-allocation C evaluation kernel", async () => {
    await Surrogate.handler({
      name: "Cooler",
      fromOnnx: onnxPath,
      format: "c",
      "out-file": cPath,
      outFile: cPath,
      report: reportPath,
      strategy: "latin-hypercube",
      "num-samples": 10,
      numSamples: 10,
      architecture: "mlp",
    } as any);

    const cContent = await fs.readFile(cPath, "utf-8");
    assert.ok(cContent.includes("#include <math.h>"));
    assert.ok(cContent.includes("static const double W0") || cContent.includes("static const double W_0"));
    assert.ok(cContent.includes("void Cooler_evaluate") || cContent.includes("rom_evaluate"));
  });

  test("surrogatizes and replaces submodel component in parent Modelica file", async () => {
    const systemMoPath = path.join(tmpDir, "System.mo");
    const replacedMoPath = path.join(tmpDir, "System_Surrogatized.mo");

    const systemMoContent = `model System
  Source pump;
  HeatExchanger cooler(A = 15.0);
  Sink reservoir;
equation
  connect(pump.port, cooler.port_a);
  connect(cooler.port_b, reservoir.port);
end System;`;

    await fs.writeFile(systemMoPath, systemMoContent, "utf-8");

    await Surrogate.handler({
      name: "Cooler",
      paths: [systemMoPath],
      fromOnnx: onnxPath,
      format: "mo",
      "out-file": moPath,
      outFile: moPath,
      "replace-component": "cooler",
      replaceComponent: "cooler",
      "replace-out": replacedMoPath,
      replaceOut: replacedMoPath,
      report: reportPath,
      strategy: "latin-hypercube",
      "num-samples": 10,
      numSamples: 10,
      architecture: "mlp",
    } as any);

    const replacedContent = await fs.readFile(replacedMoPath, "utf-8");
    assert.ok(
      replacedContent.includes("Cooler_Surrogate cooler(A = 15.0);"),
      "Declaration must be replaced with Cooler_Surrogate",
    );
    assert.ok(
      replacedContent.includes("connect(pump.port, cooler.port_a);"),
      "Connector wiring port_a must remain valid and intact",
    );
    assert.ok(
      replacedContent.includes("connect(cooler.port_b, reservoir.port);"),
      "Connector wiring port_b must remain valid and intact",
    );
  });
});
