// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica 3.7 Standard Annotations & ModelScript Extensions", async () => {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  await initBltWasm();

  it("1. extracts experiment(Algorithm='tsit5', StartTime=1.0, StopTime=5.0, Tolerance=1e-5, NumberOfIntervals=200) and auto-dispatches solver", () => {
    const ctx = new Context(new NodeFileSystem());
    const src = `
model ExperimentTest
  Real x(start = 1.0);
equation
  der(x) = -0.5 * x;
  annotation(experiment(
    StartTime = 1.0,
    StopTime = 5.0,
    Tolerance = 1e-5,
    NumberOfIntervals = 200,
    Algorithm = "tsit5"
  ));
end ExperimentTest;
`;
    ctx.load(src, "file:///ExperimentTest.mo");
    const arena = ctx.flattenArena("ExperimentTest", undefined, "file:///ExperimentTest.mo", { backend: "ts" });
    assert.ok(arena, "Arena flattening should succeed");

    assert.strictEqual(arena.experiment.startTime, 1.0);
    assert.strictEqual(arena.experiment.stopTime, 5.0);
    assert.strictEqual(arena.experiment.tolerance, 1e-5);
    assert.strictEqual(arena.experiment.numberOfIntervals, 200);
    assert.strictEqual(arena.experiment.algorithm, "tsit5");

    // Simulate without specifying solver: it should automatically pick tsit5
    const res = simulateArena(arena);
    assert.strictEqual(res.t[0], 1.0);
    assert.ok(Math.abs(res.t[res.t.length - 1] - 5.0) < 1e-6);
    // Analytical solution: x(5) = x(1) * exp(-0.5 * 4) = 1.0 * exp(-2.0) = 0.135335
    const finalX = res.y[res.y.length - 1][0];
    assert.ok(Math.abs(finalX - Math.exp(-2.0)) < 1e-3, `Final x was ${finalX}`);
  });

  it("2. filters variables tagged with annotation(HideResult=true) unless in debug mode", () => {
    const ctx = new Context(new NodeFileSystem());
    const src = `
model HideResultTest
  Real statePublic(start = 2.0);
  Real stateHidden(start = 3.0) annotation(HideResult = true);
equation
  der(statePublic) = -statePublic;
  der(stateHidden) = -2.0 * stateHidden;
end HideResultTest;
`;
    ctx.load(src, "file:///HideResultTest.mo");
    const arena = ctx.flattenArena("HideResultTest", undefined, "file:///HideResultTest.mo", { backend: "ts" });
    assert.ok(arena);

    // Verify hiddenVarIndices was populated
    const hiddenVarIdx = arena.findVar("stateHidden");
    assert.ok(hiddenVarIdx >= 0);
    assert.ok(arena.hiddenVarIndices.has(hiddenVarIdx));

    // Standard simulation: stateHidden must be omitted from output
    const res = simulateArena(arena, { startTime: 0, stopTime: 1.0, step: 0.1 });
    assert.ok(res.states.includes("statePublic"));
    assert.ok(!res.states.includes("stateHidden"), "stateHidden should be filtered out from output");
    assert.strictEqual(res.states.length, 1);
    assert.strictEqual(res.y[0].length, 1);

    // Debug simulation: stateHidden should be preserved
    const resDebug = simulateArena(arena, { startTime: 0, stopTime: 1.0, step: 0.1, debug: true });
    assert.ok(resDebug.states.includes("statePublic"));
    assert.ok(resDebug.states.includes("stateHidden"), "stateHidden should be preserved when debug=true");
    assert.strictEqual(resDebug.states.length, 2);
    assert.strictEqual(resDebug.y[0].length, 2);
  });

  it("3. promotes parameter with annotation(Evaluate=true) to constant folding", () => {
    const ctx = new Context(new NodeFileSystem());
    const src = `
model EvaluateTest
  parameter Real k = 3.0 annotation(Evaluate = true);
  Real x(start = 1.0);
equation
  der(x) = -k * x;
end EvaluateTest;
`;
    ctx.load(src, "file:///EvaluateTest.mo");
    const arena = ctx.flattenArena("EvaluateTest", undefined, "file:///EvaluateTest.mo", { backend: "ts" });
    assert.ok(arena);

    const res = simulateArena(arena, { startTime: 0, stopTime: 1.0, step: 0.1 });
    // Analytical solution: x(1) = 1.0 * exp(-3.0 * 1) = 0.049787
    const finalX = res.y[res.y.length - 1][0];
    assert.ok(Math.abs(finalX - Math.exp(-3.0)) < 1e-3, `Final x was ${finalX}`);
  });

  it("4. extracts equation-level __modelscript_diffusion into arena.diffusionExprIds for SDEs", () => {
    const ctx = new Context(new NodeFileSystem());
    const src = `
model DiffusionTest
  Real x(start = 0.0);
equation
  der(x) = -x annotation(__modelscript_diffusion = 0.75);
end DiffusionTest;
`;
    ctx.load(src, "file:///DiffusionTest.mo");
    const arena = ctx.flattenArena("DiffusionTest", undefined, "file:///DiffusionTest.mo", { backend: "ts" });
    assert.ok(arena);

    const xIdx = arena.findVar("x");
    assert.ok(xIdx >= 0);
    assert.ok(arena.diffusionExprIds.has(xIdx), "x should have a registered diffusion expression ID");
    const diffExprId = arena.diffusionExprIds.get(xIdx)!;
    assert.strictEqual(arena.getExprRealValue(diffExprId), 0.75);
  });

  it("5. extracts __modelscript_webgpu and __modelscript_bvp domain annotations", () => {
    const ctx = new Context(new NodeFileSystem());
    const src = `
model HardwareAndBvpTest
  Real y(start = 0.0);
equation
  der(y) = 1.0;
  annotation(
    __modelscript_webgpu(
      workgroupSize = 128,
      precision = "f32",
      parallelInstances = 5000
    ),
    __modelscript_bvp(
      boundaryConditions = {"y(0) == 0.0", "y(1) == 2.5"},
      method = "collocation",
      intervals = 25
    )
  );
end HardwareAndBvpTest;
`;
    ctx.load(src, "file:///HardwareAndBvpTest.mo");
    const arena = ctx.flattenArena("HardwareAndBvpTest", undefined, "file:///HardwareAndBvpTest.mo");
    assert.ok(arena);

    // WebGPU metadata
    assert.ok(arena.extensionMetadata.webgpu);
    assert.strictEqual(arena.extensionMetadata.webgpu.workgroupSize, 128);
    assert.strictEqual(arena.extensionMetadata.webgpu.precision, "f32");
    assert.strictEqual(arena.extensionMetadata.webgpu.parallelInstances, 5000);

    // BVP metadata
    assert.ok(arena.extensionMetadata.bvp);
    assert.strictEqual(arena.extensionMetadata.bvp.method, "collocation");
    assert.strictEqual(arena.extensionMetadata.bvp.intervals, 25);
    assert.deepStrictEqual(arena.extensionMetadata.bvp.boundaryConditions, ["y(0) == 0.0", "y(1) == 2.5"]);
  });

  it("6. extracts multi-physics and MBSE metadata (SysML, OWL, Telemetry, FEAMesh, CFDFlow)", () => {
    const ctx = new Context(new NodeFileSystem());
    const src = `
model MultiDomainModel
  Real p(start = 1.0);
equation
  der(p) = 0.0;
  annotation(
    SysML(
      satisfies = "REQ-THERMAL-101",
      allocatedBlock = "ThermalSubsystem::Heater",
      verificationStatus = "verified"
    ),
    OWL(
      iri = "https://w3id.org/digitaltwin#Heater",
      ontology = "thermal.ttl"
    ),
    Telemetry(
      topic = "plant/heater/pressure",
      protocol = "mqtt",
      publishRateHz = 100,
      qualityOfService = 2
    ),
    FEAMesh(
      cadUri = "models/bracket.step",
      meshType = "Tet10",
      material = "Titanium",
      loadConnector = "flange.f",
      feedbackDeflection = "flange.s"
    ),
    CFDFlow(
      grid = {64, 32, 32},
      dx = 0.002,
      turbulenceModel = "smagorinsky_les",
      velocityVariable = "inlet.v",
      dragForceVariable = "f_drag"
    )
  );
end MultiDomainModel;
`;
    ctx.load(src, "file:///MultiDomainModel.mo");
    const arena = ctx.flattenArena("MultiDomainModel", undefined, "file:///MultiDomainModel.mo");
    assert.ok(arena);

    const mbse = arena.extensionMetadata.mbse;
    assert.ok(mbse);
    assert.strictEqual(mbse.sysml?.[0]?.satisfies, "REQ-THERMAL-101");
    assert.strictEqual(mbse.sysml?.[0]?.allocatedBlock, "ThermalSubsystem::Heater");
    assert.strictEqual(mbse.owl?.[0]?.iri, "https://w3id.org/digitaltwin#Heater");
    assert.strictEqual(mbse.telemetry?.[0]?.topic, "plant/heater/pressure");
    assert.strictEqual(mbse.telemetry?.[0]?.publishRateHz, 100);

    const fea = arena.extensionMetadata.feaMesh;
    assert.ok(fea && fea.length > 0);
    assert.strictEqual(fea[0].cadUri, "models/bracket.step");
    assert.strictEqual(fea[0].meshType, "Tet10");
    assert.strictEqual(fea[0].material, "Titanium");

    const cfd = arena.extensionMetadata.cfdFlow;
    assert.ok(cfd && cfd.length > 0);
    assert.deepStrictEqual(cfd[0].grid, [64, 32, 32]);
    assert.strictEqual(cfd[0].dx, 0.002);
    assert.strictEqual(cfd[0].turbulenceModel, "smagorinsky_les");
  });
});
