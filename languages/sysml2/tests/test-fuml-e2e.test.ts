// SPDX-License-Identifier: AGPL-3.0-or-later
import { StateKind, WasmRtcStateMachine } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } from "../src/factory.js";
import { SysML2FumlBridge } from "../src/fuml-bridge.js";
import { GenericModelicaBridge } from "../transformers/generic-modelica-bridge.js";

test("SysML v2 Discrete Execution & Standard Library E2E Suite", async (t) => {
  await t.test("verifies expanded KerML stdlib contains Base, Control, Transfers, and Performances", () => {
    const ws = createSysML2WorkspaceIndex();
    const uri = loadEmbeddedKerMLStdlib(ws);
    assert.strictEqual(uri, "sysml2://stdlib/KerML.sysml");

    const unified = ws.toUnified();
    const names = Array.from(unified.symbols.values()).map((s) => s.name);
    assert.strictEqual(unified.symbols.size, 125);

    assert.ok(names.includes("Base"), "Should include Base package");
    assert.ok(names.includes("Control"), "Should include Control package");
    assert.ok(names.includes("Transfers"), "Should include Transfers package");
    assert.ok(names.includes("Performances"), "Should include Performances package");
    assert.ok(names.includes("DecisionNode"), "Should include DecisionNode");
    assert.ok(names.includes("MergeNode"), "Should include MergeNode");
    assert.ok(names.includes("Performance"), "Should include Performance");
    assert.ok(names.includes("Flow"), "Should include Flow");
  });

  await t.test("executes end-to-end flight control discrete telemetry activity", () => {
    const flightModel = `
action def FlightTelemetryPipeline {
  action readSensors {
    assign altitude := 150;
    assign battery := 92;
  }
  action computeGuidance {
    assign targetAltitude := 200;
    assign throttleCorrection := targetAltitude - altitude;
  }
  action applyActuators {
    assign motorRpm := 5000 + throttleCorrection * 20;
  }

  first readSensors then computeGuidance;
  first computeGuidance then applyActuators;
}
`;

    const engine = SysML2FumlBridge.compile(flightModel);
    engine.init();

    // Step 1: Initial fires
    const s1 = engine.step();
    assert.strictEqual(s1.firedNodeIds.length, 1);

    // Step 2: readSensors fires
    const s2 = engine.step();
    assert.strictEqual(s2.firedNodeIds.length, 1);
    assert.strictEqual(engine.getVariables().altitude, 150);
    assert.strictEqual(engine.getVariables().battery, 92);

    // Step 3: computeGuidance fires (throttleCorrection = 200 - 150 = 50)
    const s3 = engine.step();
    assert.strictEqual(s3.firedNodeIds.length, 1);
    assert.strictEqual(engine.getVariables().throttleCorrection, 50);

    // Step 4: applyActuators fires (motorRpm = 5000 + 50 * 20 = 6000)
    const s4 = engine.step();
    assert.strictEqual(s4.firedNodeIds.length, 1);
    assert.strictEqual(engine.getVariables().motorRpm, 6000);

    // Step 5: Final fires
    const s5 = engine.step();
    assert.strictEqual(s5.isCompleted, true);
    assert.strictEqual(engine.isFinished(), true);
  });

  await t.test("executes autonomous drone hierarchical state machine with RTC lifecycle", () => {
    const sm = new WasmRtcStateMachine();
    const flightLog: string[] = [];

    // Root states
    const sInit = sm.addState("initial", StateKind.Initial);
    const sLanded = sm.addState("Landed", StateKind.Simple, {
      entryAction: () => flightLog.push("enter:Landed"),
      exitAction: () => flightLog.push("exit:Landed"),
    });

    // InFlight composite state with nested substates
    const sInFlight = sm.addState("InFlight", StateKind.Composite, {
      entryAction: () => flightLog.push("enter:InFlight"),
      exitAction: () => flightLog.push("exit:InFlight"),
    });

    const sInFlightInit = sm.addState("inFlightInit", StateKind.Initial, {
      parentId: sInFlight,
    });
    const sHover = sm.addState("Hovering", StateKind.Simple, {
      parentId: sInFlight,
      entryAction: () => flightLog.push("enter:Hovering"),
      exitAction: () => flightLog.push("exit:Hovering"),
    });
    const sNavigating = sm.addState("Navigating", StateKind.Simple, {
      parentId: sInFlight,
      entryAction: () => flightLog.push("enter:Navigating"),
      exitAction: () => flightLog.push("exit:Navigating"),
    });

    // Transitions
    sm.addTransition(sInit, sLanded);
    sm.addTransition(sLanded, sInFlight, {
      trigger: "takeOff",
      effect: (ctx) => {
        ctx.altitude = 10;
      },
    });
    sm.addTransition(sInFlightInit, sHover);
    sm.addTransition(sHover, sNavigating, {
      trigger: "waypointReceived",
      guard: (ctx) => ctx.gpsLocked === true,
      effect: (ctx, payload) => {
        ctx.targetWaypoint = payload.wp;
      },
    });
    sm.addTransition(sNavigating, sHover, { trigger: "waypointReached" });
    sm.addTransition(sInFlight, sLanded, {
      trigger: "land",
      effect: (ctx) => {
        ctx.altitude = 0;
      },
    });

    sm.init({ gpsLocked: true, altitude: 0 });
    assert.deepStrictEqual(sm.getActiveStateNames(), ["Landed"]);

    // Command: takeOff -> should enter InFlight and child Hovering
    sm.postEvent("takeOff");
    sm.step();
    assert.ok(sm.getActiveStateNames().includes("InFlight"));
    assert.ok(sm.getActiveStateNames().includes("Hovering"));
    assert.strictEqual(sm.getContext().altitude, 10);

    // Command: waypointReceived -> transitions inside InFlight from Hovering to Navigating
    sm.postEvent("waypointReceived", { wp: "WP-Alpha" });
    sm.step();
    assert.ok(sm.getActiveStateNames().includes("Navigating"));
    assert.strictEqual(sm.getContext().targetWaypoint, "WP-Alpha");

    // Command: waypointReached -> returns to Hovering
    sm.postEvent("waypointReached");
    sm.step();
    assert.ok(sm.getActiveStateNames().includes("Hovering"));

    // Command: land -> exits Hovering and InFlight, enters Landed
    sm.postEvent("land");
    sm.step();
    assert.deepStrictEqual(sm.getActiveStateNames(), ["Landed"]);
    assert.strictEqual(sm.getContext().altitude, 0);

    // Verify complete action trace
    assert.deepStrictEqual(flightLog, [
      "enter:Landed",
      "exit:Landed",
      "enter:InFlight",
      "enter:Hovering",
      "exit:Hovering",
      "enter:Navigating",
      "exit:Navigating",
      "enter:Hovering",
      "exit:Hovering",
      "exit:InFlight",
      "enter:Landed",
    ]);
  });

  await t.test("seamlessly integrates conjugated port bridge with multi-domain definitions", () => {
    const actuatorSysml = `
part def HydraulicActuator {
  attribute maxPressure : Real = 250.0;
  port fluidIn : Pin;
  port ~fluidReturn : Pin;
  port pistonRod : Flange;
  port ~reactionCase : Flange;
  port positionFeedback : ~RealInput;
}
`;

    const parsed = GenericModelicaBridge.parseSysML2(actuatorSysml);
    assert.strictEqual(parsed.name, "HydraulicActuator");
    assert.strictEqual(parsed.ports.length, 5);

    const modelica = GenericModelicaBridge.emitModelica(parsed);
    assert.ok(modelica.includes("PositivePin fluidIn;"));
    assert.ok(modelica.includes("NegativePin fluidReturn;"));
    assert.ok(modelica.includes("Flange_a pistonRod;"));
    assert.ok(modelica.includes("Flange_b reactionCase;"));
    assert.ok(modelica.includes("RealOutput positionFeedback;"));
  });
});
