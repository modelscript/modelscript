// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { decodeMessage, encodeMessage, type TimeSyncPing, type TimeSyncPong } from "../src/cosim/mqtt/protocol.js";
import {
  createUnsContext,
  parseTimeSyncTopic,
  sessionTimeSyncTopic,
  sessionTimeSyncWildcard,
} from "../src/cosim/mqtt/topics.js";
import { SessionManager } from "../src/cosim/session.js";

test("SessionManager: options configuration and toJSON serialization", () => {
  const sm = new SessionManager({ staleTtlMs: 5000 });

  const session = sm.createSession({ startTime: 0, stopTime: 5, stepSize: 0.005 }, 2.0, "newton", 1e-5, "newton", {
    p1: { y: ["u"] },
  });

  assert.strictEqual(session.experiment.startTime, 0);
  assert.strictEqual(session.experiment.stopTime, 5);
  assert.strictEqual(session.experiment.stepSize, 0.005);
  assert.strictEqual(session.realtimeFactor, 2.0);
  assert.strictEqual(session.masterAlgorithm, "newton");
  assert.strictEqual(session.richardsonTolerance, 1e-5);
  assert.strictEqual(session.autoRemediateLoops, "newton");
  assert.deepStrictEqual(session.directFeedthrough, { p1: { y: ["u"] } });

  const json = session.toJSON();
  assert.strictEqual(json["masterAlgorithm"], "newton");
  assert.strictEqual(json["richardsonTolerance"], 1e-5);
  assert.strictEqual(json["autoRemediateLoops"], "newton");
  assert.strictEqual(json["realtimeFactor"], 2.0);
  assert.strictEqual(json["state"], "created");

  sm.dispose();
});

test("MQTT Time Synchronization: topic parsing and message codecs", () => {
  const ctx = createUnsContext("factory1", "cellA");
  const topic = sessionTimeSyncTopic(ctx, "session-123", "fmu-motor");

  assert.strictEqual(topic, "modelscript/site/factory1/area/cellA/line/session-123/cell/fmu-motor/timesync");

  const wildcard = sessionTimeSyncWildcard(ctx, "session-123");
  assert.strictEqual(wildcard, "modelscript/site/factory1/area/cellA/line/session-123/cell/+/timesync");

  const parsed = parseTimeSyncTopic(topic);
  assert.notStrictEqual(parsed, null);
  assert.strictEqual(parsed?.sessionId, "session-123");
  assert.strictEqual(parsed?.participantId, "fmu-motor");

  // Non-timesync topic parsing should return null
  assert.strictEqual(parseTimeSyncTopic("modelscript/site/default/area/default/line/s1/status"), null);

  // Ping codec roundtrip
  const ping: TimeSyncPing = {
    type: "ping",
    sessionId: "session-123",
    participantId: "fmu-motor",
    seq: 42,
    t1: 1000.5,
  };
  const pingBuf = encodeMessage(ping);
  const pingDecoded = decodeMessage<TimeSyncPing>(pingBuf);
  assert.deepStrictEqual(pingDecoded, ping);

  // Pong codec roundtrip
  const pong: TimeSyncPong = {
    type: "pong",
    sessionId: "session-123",
    participantId: "fmu-motor",
    seq: 42,
    t1: 1000.5,
    t2: 1010.2,
    t3: 1011.0,
  };
  const pongBuf = encodeMessage(pong);
  const pongDecoded = decodeMessage<TimeSyncPong>(pongBuf);
  assert.deepStrictEqual(pongDecoded, pong);
});
