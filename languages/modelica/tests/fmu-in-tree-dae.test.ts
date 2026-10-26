// SPDX-License-Identifier: AGPL-3.0-or-later

import { FmuSubsystemRegistry, initBltWasm, type FmuInstanceMetadata, type FmuSubsystem } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "../src/factory.js";
import { ModelicaFlattener } from "../src/flattener.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica In-Tree FMU Lowering & Co-Simulation", async () => {
  await initBltWasm();
  const { parser } = await createWasmParser(modelicaWasmPath);

  function createFlattenerForCode(code: string, uri = "memfs:/test/FmuTest.mo") {
    const tree = parser.parse(code);
    const ws = createModelicaWorkspaceIndex();
    ws.indexDocument(uri, () => tree.rootNode);
    const unified = ws.toUnified();
    const queryEngine = createModelicaQueryEngine(unified, {
      getText: (s, e) => code.substring(s, e),
      getNode: (s, e) => tree.rootNode.descendantForIndex(s, Math.max(s, e)),
    });
    const db = queryEngine.toQueryDB();
    const flattener = new ModelicaFlattener(db);
    return { flattener, unified, db, tree };
  }

  it("lowers a root-level FMU wrapper class directly into DAEBuilder with fmuInstances metadata", async () => {
    const code = `model ControllerFmu
  input Real error;
  output Real controlSignal;
  parameter Real kp = 10.0;
  parameter Real ki = 2.0;

  annotation(
    __ModelScript_fmuPath = "binaries/controller.fmu",
    __ModelScript_fmiVersion = "2.0",
    __ModelScript_guid = "{abcd-1234-ef56-7890}",
    __ModelScript_preferredKind = "cs",
    __ModelScript_csModelIdentifier = "Controller"
  );
end ControllerFmu;`;

    const { flattener, unified } = createFlattenerForCode(code);
    const rootId = unified.byName.get("ControllerFmu")?.[0];
    assert.ok(rootId !== undefined, "ControllerFmu should be indexed");

    const dae = flattener.flattenClass(rootId);

    // 1. Verify balance check passes without errors
    const errors = dae.diagnostics.filter((d: any) => d.severity === "error");
    assert.strictEqual(errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(errors)}`);

    // 2. Verify fmuInstances in extensionMetadata
    const fmuInstances = dae.extensionMetadata["fmuInstances"] as FmuInstanceMetadata[] | undefined;
    assert.ok(Array.isArray(fmuInstances), "extensionMetadata.fmuInstances should be an array");
    assert.strictEqual(fmuInstances.length, 1);

    const fmu0 = fmuInstances[0]!;
    assert.strictEqual(fmu0.instanceName, "");
    assert.strictEqual(fmu0.fmuPath, "binaries/controller.fmu");
    assert.strictEqual(fmu0.fmiVersion, "2.0");
    assert.strictEqual(fmu0.guid, "{abcd-1234-ef56-7890}");
    assert.strictEqual(fmu0.preferredKind, "cs");
    assert.strictEqual(fmu0.csModelIdentifier, "Controller");

    assert.ok(fmu0.inputs.includes("error"), "Expected 'error' in inputs");
    assert.ok(fmu0.outputs.includes("controlSignal"), "Expected 'controlSignal' in outputs");
    assert.ok(fmu0.parameters.includes("kp"), "Expected 'kp' in parameters");
    assert.ok(fmu0.parameters.includes("ki"), "Expected 'ki' in parameters");
  });

  it("lowers instantiated FMU component within a coupled continuous system without balance errors", async () => {
    const code = `model ClosedLoopSystem
  model FmuPlant
    input Real u;
    output Real y;
    parameter Real gain = 5.0;
    annotation(
      __ModelScript_fmuPath = "plant.fmu",
      __ModelScript_fmiVersion = "2.0",
      __ModelScript_preferredKind = "cs"
    );
  end FmuPlant;

  FmuPlant plant;
  Real ref = 1.0;
  Real x(start = 0.0);
equation
  plant.u = ref - plant.y;
  der(x) = plant.y;
end ClosedLoopSystem;`;

    const { flattener, unified } = createFlattenerForCode(code);
    const sysId = unified.byName.get("ClosedLoopSystem")?.[0];
    assert.ok(sysId !== undefined, "ClosedLoopSystem should be indexed");

    const dae = flattener.flattenClass(sysId);

    // Verify balance check passes
    const errors = dae.diagnostics.filter((d: any) => d.severity === "error");
    assert.strictEqual(errors.length, 0, `Expected 0 balance errors, got: ${JSON.stringify(errors)}`);

    // Verify FMU instance is registered for component 'plant'
    const fmuInstances = dae.extensionMetadata["fmuInstances"] as FmuInstanceMetadata[] | undefined;
    assert.ok(Array.isArray(fmuInstances), "Expected fmuInstances to be populated");
    assert.strictEqual(fmuInstances.length, 1);

    const fmuPlant = fmuInstances[0]!;
    assert.strictEqual(fmuPlant.instanceName, "plant");
    assert.strictEqual(fmuPlant.fmuPath, "plant.fmu");
    assert.ok(fmuPlant.inputs.includes("u"), "Expected plant input 'u'");
    assert.ok(fmuPlant.outputs.includes("y"), "Expected plant output 'y'");
    assert.ok(fmuPlant.parameters.includes("gain"), "Expected plant parameter 'gain'");

    // Verify variables in DAEBuilder
    assert.ok(dae.getVarIdxByName("plant.u") >= 0, "Expected plant.u in DAE");
    assert.ok(dae.getVarIdxByName("plant.y") >= 0, "Expected plant.y in DAE");
    assert.ok(dae.getVarIdxByName("x") >= 0, "Expected state x in DAE");
  });

  it("simulates a coupled FMU model with ArenaSimulator and dynamically steps the FMU subsystem", async () => {
    const code = `model ActuatorSystem
  model FmuActuator
    input Real command;
    output Real force;
    annotation(
      __ModelScript_fmuPath = "actuator.fmu"
    );
  end FmuActuator;

  FmuActuator act;
  Real pos(start = 0.0);
  Real vel(start = 0.0);
equation
  act.command = 10.0;
  der(pos) = vel;
  der(vel) = act.force - 0.1 * vel;
end ActuatorSystem;`;

    const { flattener, unified } = createFlattenerForCode(code);
    const sysId = unified.byName.get("ActuatorSystem")?.[0];
    assert.ok(sysId !== undefined);

    const dae = flattener.flattenClass(sysId);
    assert.strictEqual(dae.diagnostics.filter((d: any) => d.severity === "error").length, 0);

    // Provide a dynamic FMU mock subsystem via registry
    const registry = new FmuSubsystemRegistry();
    let stepsCalled = 0;

    const mockSubsystem: FmuSubsystem = {
      modelName: "FmuActuator",
      inputNames: ["command"],
      outputNames: ["force"],
      parameterNames: [],
      initialize(_start, _stop, _h) {},
      setInputs(inputs) {
        // Feedforward actuator with command gain 2.0
        const u = inputs.get("command") ?? 0;
        this.currentForce = u * 2.0;
      },
      doStep(_t, _h) {
        stepsCalled++;
      },
      getOutputs() {
        return new Map([["force", this.currentForce ?? 20.0]]);
      },
      terminate() {},
      currentForce: 20.0,
    } as any;

    registry.register("act", mockSubsystem);

    const simRes = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.5,
      fmuRegistry: registry,
    });

    assert.ok(stepsCalled > 0, `Expected doStep to be called during simulation, called ${stepsCalled} times`);
    assert.ok(simRes.t.length > 5, "Expected trajectory time points");

    // pos and vel should have increased due to constant positive force (20.0 N)
    const posIdx = simRes.states.indexOf("pos");
    const velIdx = simRes.states.indexOf("vel");
    assert.ok(posIdx >= 0, "pos should be in states");
    assert.ok(velIdx >= 0, "vel should be in states");

    const finalPos = simRes.y[simRes.y.length - 1]![posIdx]!;
    const finalVel = simRes.y[simRes.y.length - 1]![velIdx]!;

    assert.ok(finalVel > 1.0, `Expected positive velocity from actuator force, got ${finalVel}`);
    assert.ok(finalPos > 0.1, `Expected positive displacement, got ${finalPos}`);
  });

  it("extracts and preserves terminal mappings for bus-wrapped FMUs", async () => {
    const code = `model BusDevice
  Real in1;
  Real out1;
  annotation(
    __ModelScript_fmuPath = "bus_controller.fmu",
    __ModelScript_terminalMapping = {
      ("bus.in1", "in1"),
      ("bus.out1", "out1")
    }
  );
end BusDevice;`;

    const { flattener, unified } = createFlattenerForCode(code);
    const busId = unified.byName.get("BusDevice")?.[0];
    assert.ok(busId !== undefined);

    const dae = flattener.flattenClass(busId);
    const fmuInstances = dae.extensionMetadata["fmuInstances"] as FmuInstanceMetadata[];
    assert.ok(fmuInstances && fmuInstances.length === 1);

    const tm = fmuInstances[0]!.terminalMapping;
    assert.ok(Array.isArray(tm), "Expected terminalMapping array");
    assert.strictEqual(tm.length, 2);
    assert.deepStrictEqual(tm[0], { portMember: "bus.in1", fmuVar: "in1" });
    assert.deepStrictEqual(tm[1], { portMember: "bus.out1", fmuVar: "out1" });
  });
});
