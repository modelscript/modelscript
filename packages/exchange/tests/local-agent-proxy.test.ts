// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import http from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";
import { Orchestrator } from "../src/cosim/orchestrator.js";
import type { CoSimParticipant } from "../src/cosim/participant.js";
import {
  LocalAgentProxyParticipant,
  MockLocalAgentServer,
  WebSocketAgentTransport,
} from "../src/cosim/participants/local-agent-proxy.js";
import { CoSimSession } from "../src/cosim/session.js";

test("LocalAgentProxy: Probe Capabilities and Latency Ping", async () => {
  const server = new MockLocalAgentServer();
  const transport = server.createClientTransport();

  const participant = new LocalAgentProxyParticipant({
    id: "SimulinkVehiclePlant",
    modelIdentifier: "C:/Projects/VehicleDynamics.slx",
    transport,
  });

  const caps = await participant.probe();
  assert.strictEqual(caps.version, "1.0.0-mock");
  assert.strictEqual(caps.platform, "linux");
  assert.strictEqual(caps.arch, "x64");
  assert.ok(caps.supportedSolvers.includes("simulink"));
  assert.strictEqual(caps.canGetAndSetState, true);
  assert.strictEqual(caps.providesDirectionalDerivatives, true);

  const pingMs = await participant.ping();
  assert.ok(pingMs >= 0, "Ping RTT should be non-negative");
});

test("LocalAgentProxy: Initialization and Metadata Propagation", async () => {
  const server = new MockLocalAgentServer();
  const transport = server.createClientTransport();

  const participant = new LocalAgentProxyParticipant({
    id: "AmesimEngine",
    modelIdentifier: "models/amesim/DieselEngine.ame",
    transport,
  });

  assert.strictEqual(participant.metadata.variables.length, 0);

  await participant.initialize(0.0, 1.0, 0.01);

  // Verify variables discovered from native model
  assert.strictEqual(participant.metadata.variables.length, 2);
  const uVar = participant.metadata.variables.find((v) => v.name === "u");
  const yVar = participant.metadata.variables.find((v) => v.name === "y");
  assert.ok(uVar && uVar.causality === "input");
  assert.ok(yVar && yVar.causality === "output");

  // Verify capabilities and direct feedthrough
  assert.strictEqual(participant.canGetAndSetState, true);
  assert.strictEqual(participant.providesDirectionalDerivatives, true);
  assert.ok(participant.directFeedthrough?.y?.includes("u"));

  await participant.terminate();
});

test("LocalAgentProxy: Pipelined Zero-Latency Step Exchange", async () => {
  const server = new MockLocalAgentServer();
  const transport = server.createClientTransport();

  const participant = new LocalAgentProxyParticipant({
    id: "NativePlant",
    modelIdentifier: "Engine_win64.fmu",
    transport,
    pipelinedExchange: true,
  });

  await participant.initialize(0.0, 1.0, 0.01);

  // Inject input u = 10.0
  await participant.setInputs(new Map([["u", 10.0]]));

  // Advance step (internally exchanges inputs + step + outputs in a single micro-RPC)
  await participant.doStep(0.0, 0.01);

  const outputs = await participant.getOutputs();
  // Server logic: y = 2.0 * u + state (state = (-0.5*0 + 10) * 0.01 = 0.1)
  // y = 20.0 + 0.1 = 20.1
  const yVal = outputs.get("y") as number;
  assert.ok(Math.abs(yVal - 20.1) < 1e-4, `Output y should be ~20.1, got ${yVal}`);

  // Check telemetry
  assert.strictEqual(participant.telemetry.totalSteps, 1);
  assert.ok(participant.telemetry.totalRpcDurationMs >= 0);

  await participant.terminate();
});

test("LocalAgentProxy: State Save and Rollback (fmi2GetFMUstate/fmi2SetFMUstate RPC)", async () => {
  const server = new MockLocalAgentServer();
  const transport = server.createClientTransport();

  const participant = new LocalAgentProxyParticipant({
    id: "StatefulPlant",
    modelIdentifier: "Controller_x64.dll",
    transport,
  });

  await participant.initialize(0.0, 1.0, 0.01);

  // Step 1: u = 5.0
  await participant.setInputs(new Map([["u", 5.0]]));
  await participant.doStep(0.0, 0.01);
  const out1 = (await participant.getOutputs()).get("y") as number;

  // Snapshot state after Step 1
  const stateSnapshot = await participant.getState();
  assert.ok(stateSnapshot !== undefined, "State snapshot handle must be returned");

  // Step 2: u = 100.0 (drastic change)
  await participant.setInputs(new Map([["u", 100.0]]));
  await participant.doStep(0.01, 0.01);
  const out2 = (await participant.getOutputs()).get("y") as number;
  assert.ok(out2 > out1 + 150.0, "Output must have jumped after input 100");

  // Rollback to state after Step 1
  await participant.setState(stateSnapshot);

  // Re-step Step 2 with u = 5.0 instead
  await participant.setInputs(new Map([["u", 5.0]]));
  await participant.doStep(0.01, 0.01);
  const out2RolledBack = (await participant.getOutputs()).get("y") as number;

  assert.ok(
    Math.abs(out2RolledBack - out1) < 1.0,
    `Rolled-back step output should be close to ~${out1}, got ${out2RolledBack}`,
  );

  await participant.freeState(stateSnapshot);
  await participant.terminate();
});

test("LocalAgentProxy: Directional Derivative Evaluation", async () => {
  const server = new MockLocalAgentServer();
  const transport = server.createClientTransport();

  const participant = new LocalAgentProxyParticipant({
    id: "DifferentiableModel",
    modelIdentifier: "NonlinearPlant.fmu",
    transport,
  });

  await participant.initialize(0.0, 1.0, 0.01);

  // dy/du in mock server is 2.0
  const dvUnknown = await participant.getDirectionalDerivative([1], [0], [3.5]);
  assert.strictEqual(dvUnknown.length, 1);
  assert.strictEqual(dvUnknown[0], 7.0, "3.5 * 2.0 = 7.0");

  await participant.terminate();
});

test("LocalAgentProxy: End-to-End Orchestrator Multi-Participant Co-Simulation", async () => {
  const session = new CoSimSession(
    "desktop-bridge-session",
    { startTime: 0.0, stopTime: 0.03, stepSize: 0.01 },
    0,
    "gauss-seidel",
  );

  // Participant 1: Local desktop native plant via bridge
  const server = new MockLocalAgentServer();
  const transport = server.createClientTransport();
  const nativePlant = new LocalAgentProxyParticipant({
    id: "NativePlant",
    modelIdentifier: "Simulink_Bogie.slx",
    transport,
  });

  // Participant 2: Lightweight pure JS controller
  let ctrlInput = 0.0;
  let ctrlOutput = 1.0;
  const jsController: CoSimParticipant = {
    id: "JsController",
    modelName: "ProportionalControl",
    metadata: {
      participantId: "JsController",
      modelName: "ProportionalControl",
      type: "js-simulator",
      classKind: "model",
      variables: [
        { name: "measuredY", causality: "input", type: "Real" },
        { name: "controlCmd", causality: "output", type: "Real" },
      ],
      timestamp: new Date().toISOString(),
    },
    async initialize() {
      ctrlInput = 0.0;
      ctrlOutput = 1.0;
    },
    async doStep() {
      // Simple feedback: controlCmd = 10.0 - 0.1 * measuredY
      ctrlOutput = Math.max(0.0, 10.0 - 0.1 * ctrlInput);
    },
    async getOutputs() {
      return new Map([["controlCmd", ctrlOutput]]);
    },
    async setInputs(values) {
      const val = values.get("measuredY");
      if (typeof val === "number") ctrlInput = val;
    },
    async terminate() {},
  };

  session.addParticipant(nativePlant);
  session.addParticipant(jsController);

  // Coupling: Controller.controlCmd -> NativePlant.u
  session.addCoupling({
    from: { participantId: "JsController", variableName: "controlCmd" },
    to: { participantId: "NativePlant", variableName: "u" },
  });

  // Coupling: NativePlant.y -> Controller.measuredY (with delay to avoid algebraic loop)
  session.addCoupling({
    from: { participantId: "NativePlant", variableName: "y" },
    to: { participantId: "JsController", variableName: "measuredY" },
    isDelayed: true,
  });

  let stepCount = 0;
  const orchestrator = new Orchestrator(session, null, {
    onStep: () => {
      stepCount++;
    },
  });

  await orchestrator.run();

  assert.strictEqual(session.state, "completed");
  assert.strictEqual(stepCount, 3, "Must complete 3 co-simulation steps");
  assert.strictEqual(nativePlant.telemetry.totalSteps, 3);
});

test("LocalAgentProxy: Real WebSocket Network Transport (Node.js ws)", async () => {
  // Start an ephemeral real HTTP/WebSocket server
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer });

  let serverReceivedInit = false;
  let serverStepCount = 0;

  wss.on("connection", (ws) => {
    ws.on("message", (msg) => {
      const req = JSON.parse(msg.toString());
      if (req.cmd === "AGENT_PROBE") {
        ws.send(
          JSON.stringify({
            id: req.id,
            status: "OK",
            payload: {
              version: "2.1.0",
              platform: "linux",
              arch: "x64",
              supportedSolvers: ["fmu-native"],
              canGetAndSetState: false,
              providesDirectionalDerivatives: false,
            },
          }),
        );
      } else if (req.cmd === "AGENT_INIT") {
        serverReceivedInit = true;
        ws.send(
          JSON.stringify({
            id: req.id,
            status: "OK",
            payload: {
              modelName: "RealWsModel",
              variables: [
                { name: "u", causality: "input", type: "Real" },
                { name: "y", causality: "output", type: "Real", start: 0.0 },
              ],
            },
          }),
        );
      } else if (req.cmd === "AGENT_STEP_EXCHANGE") {
        serverStepCount++;
        ws.send(
          JSON.stringify({
            id: req.id,
            status: "OK",
            payload: {
              time: req.payload.currentTime + req.payload.stepSize,
              outputs: { y: (req.payload.inputs?.u ?? 0.0) * 3.0 },
            },
          }),
        );
      } else if (req.cmd === "AGENT_TERMINATE") {
        ws.send(JSON.stringify({ id: req.id, status: "OK", payload: {} }));
      }
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as any).port;
  const wsUrl = `ws://127.0.0.1:${port}/cosim`;

  try {
    const transport = new WebSocketAgentTransport(wsUrl);
    const participant = new LocalAgentProxyParticipant({
      id: "RealWsParticipant",
      modelIdentifier: "NativeHardware.dll",
      transport,
    });

    const caps = await participant.probe();
    assert.strictEqual(caps.version, "2.1.0");

    await participant.initialize(0.0, 1.0, 0.01);
    assert.strictEqual(serverReceivedInit, true);

    await participant.setInputs(new Map([["u", 4.0]]));
    await participant.doStep(0.0, 0.01);

    const outputs = await participant.getOutputs();
    assert.strictEqual(outputs.get("y"), 12.0); // 4.0 * 3.0 = 12.0
    assert.strictEqual(serverStepCount, 1);

    await participant.terminate();
  } finally {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((res) => wss.close(() => res()));
    await new Promise<void>((res) => httpServer.close(() => res()));
  }
});
