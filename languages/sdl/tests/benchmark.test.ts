// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeSdlReachability, parseSdl, simulateSdl } from "../src/index.js";

const ALTERNATING_BIT_PROTOCOL_SDL = `
SYSTEM AlternatingBitProtocol;
  SIGNAL DataReq(Integer), Frame(Integer, Integer), Ack(Integer), DataInd(Integer);

  CHANNEL C_Link
    FROM SenderBlock TO ReceiverBlock WITH Frame;
    FROM ReceiverBlock TO SenderBlock WITH Ack;
  ENDCHANNEL C_Link;

  BLOCK SenderBlock;
    SIGNALROUTE SR_Sender
      FROM Sender TO ENV WITH Frame;
      FROM ENV TO Sender WITH Ack;
    CONNECT C_Link AND SR_Sender;

    PROCESS Sender(1, 1);
      DCL seq Integer := 0;
      DCL curPayload Integer := 0;
      DCL rxAck Integer := 0;
      DCL retxCount Integer := 0;
      TIMER T_retx;

      START;
        TASK seq := 0, retxCount := 0;
        NEXTSTATE Idle;

      STATE Idle;
        INPUT DataReq(curPayload);
          OUTPUT Frame(curPayload, seq) VIA SR_Sender;
          SET(NOW + 1.0, T_retx);
          NEXTSTATE WaitAck;
      ENDSTATE Idle;

      STATE WaitAck;
        INPUT Ack(rxAck);
          DECISION rxAck = seq;
            (TRUE):
              RESET(T_retx);
              TASK seq := 1 - seq;
              NEXTSTATE Idle;
            ELSE:
              NEXTSTATE WaitAck;
          ENDDECISION;
        INPUT T_retx;
          TASK retxCount := retxCount + 1;
          OUTPUT Frame(curPayload, seq) VIA SR_Sender;
          SET(NOW + 1.0, T_retx);
          NEXTSTATE WaitAck;
      ENDSTATE WaitAck;
    ENDPROCESS Sender;
  ENDBLOCK SenderBlock;

  BLOCK ReceiverBlock;
    SIGNALROUTE SR_Receiver
      FROM ENV TO Receiver WITH Frame;
      FROM Receiver TO ENV WITH Ack;
    CONNECT C_Link AND SR_Receiver;

    PROCESS Receiver(1, 1);
      DCL expected Integer := 0;
      DCL rxPayload Integer := 0;
      DCL rxSeq Integer := 0;

      START;
        TASK expected := 0;
        NEXTSTATE Ready;

      STATE Ready;
        INPUT Frame(rxPayload, rxSeq);
          DECISION rxSeq = expected;
            (TRUE):
              OUTPUT DataInd(rxPayload) TO ENV;
              OUTPUT Ack(rxSeq) VIA SR_Receiver;
              TASK expected := 1 - expected;
              NEXTSTATE Ready;
            ELSE:
              OUTPUT Ack(rxSeq) VIA SR_Receiver;
              NEXTSTATE Ready;
          ENDDECISION;
      ENDSTATE Ready;
    ENDPROCESS Receiver;
  ENDBLOCK ReceiverBlock;
ENDSYSTEM AlternatingBitProtocol;
`;

describe("SDL-88 Telecom Protocol Benchmarks (ABP, Timer Precision, Reachability)", () => {
  it("achieves 100% in-order message delivery parity on Alternating-Bit Protocol under frame & ACK loss", () => {
    const model = parseSdl(ALTERNATING_BIT_PROTOCOL_SDL);
    const payloads = [101, 202, 303, 404];
    const channelDelay = 0.05;
    const retxTimeout = 1.0;

    // Inject 4 DataReq packets spaced 3.0s apart; drop 1st Frame and 2nd Ack to force retransmissions
    const sim = simulateSdl(model, {
      maxTime: 20.0,
      channelDelays: { C_Link: channelDelay },
      initialSignals: payloads.map((val, idx) => ({
        time: idx * 3.0,
        targetProcess: "Sender",
        signal: "DataReq",
        args: [val],
      })),
      dropPredicate: ({ signal, transmissionIndex }) => {
        // Drop very first Frame (tx #1) and second Ack (tx #2)
        if (signal === "Frame" && transmissionIndex === 1) return true;
        if (signal === "Ack" && transmissionIndex === 2) return true;
        return false;
      },
    });

    // Verify exact message-delivery parity: all 4 payloads delivered in-order, zero duplicates
    const delivered = sim.envOutputs.filter((o) => o.signal === "DataInd").map((o) => o.args[0]);
    assert.deepStrictEqual(delivered, payloads, "ABP must deliver all payloads in exact order without duplicates");
    assert.strictEqual(sim.droppedCount, 2, "Exactly 2 packets should have been dropped by unreliable channel");

    // Verify Sender retransmitted twice due to the 2 drops
    const senderSnap = sim.processStates["Sender"];
    assert.ok(senderSnap);
    assert.strictEqual(senderSnap.state, "Idle");
    assert.strictEqual(senderSnap.variables["retxCount"], 2);

    // Verify timer expiry timing precision with explicit relErr / tolerance assertions
    assert.strictEqual(sim.timerExpiries.length, 2, "Expected exactly 2 T_retx timer expiries");
    const tolerance = 1e-9;
    for (const exp of sim.timerExpiries) {
      const actualDuration = exp.time - exp.armedAt;
      const relErr = Math.abs(actualDuration - retxTimeout) / retxTimeout;
      assert.ok(
        relErr <= tolerance,
        `Timer ${exp.timer} expiry relErr=${relErr} exceeded tolerance=${tolerance} (actual=${actualDuration}, expected=${retxTimeout})`,
      );
    }

    // Verify first packet (dropped at t=0, retx at t=1.0, delivered at t=1.05) timing accuracy
    const firstInd = sim.envOutputs.find((o) => o.signal === "DataInd");
    assert.ok(firstInd);
    const expectedFirstDelivery = retxTimeout + channelDelay;
    const deliveryRelErr = Math.abs(firstInd.time - expectedFirstDelivery) / expectedFirstDelivery;
    assert.ok(
      deliveryRelErr <= tolerance,
      `First delivery time relErr=${deliveryRelErr} exceeded tolerance=${tolerance}`,
    );
  });

  it("verifies Watchdog timer expiry timing precision against reference duration", () => {
    const wdSrc = `
      SYSTEM WatchdogBench;
        SIGNAL Kick, Alarm;
        BLOCK Wd;
          PROCESS Supervisor;
            TIMER T_wd;
            START;
              SET(NOW + 2.5, T_wd);
              NEXTSTATE Active;
            STATE Active;
              INPUT Kick;
                RESET(T_wd);
                SET(NOW + 2.5, T_wd);
                NEXTSTATE Active;
              INPUT T_wd;
                OUTPUT Alarm TO ENV;
                NEXTSTATE Fault;
            ENDSTATE Active;
            STATE Fault;
              INPUT Kick;
                SET(NOW + 2.5, T_wd);
                NEXTSTATE Active;
            ENDSTATE Fault;
          ENDPROCESS Supervisor;
        ENDBLOCK Wd;
      ENDSYSTEM WatchdogBench;
    `;
    const model = parseSdl(wdSrc);
    // Kick at t = 1.0s (resets timer to 3.5s), then stop kicking -> alarm at t = 3.5s
    const sim = simulateSdl(model, {
      maxTime: 10.0,
      initialSignals: [{ time: 1.0, targetProcess: "Supervisor", signal: "Kick" }],
    });

    const alarm = sim.envOutputs.find((o) => o.signal === "Alarm");
    assert.ok(alarm, "Watchdog should emit Alarm after missed heartbeat");
    const expectedAlarmTime = 3.5;
    const tolerance = 1e-9;
    const relErr = Math.abs(alarm.time - expectedAlarmTime) / expectedAlarmTime;
    assert.ok(relErr <= tolerance, `Watchdog alarm relErr=${relErr} exceeded tolerance=${tolerance}`);
    assert.strictEqual(sim.processStates["Supervisor"]?.state, "Fault");
  });

  it("verifies reachability and deadlock-freedom on ABP and detects deadlocks on faulty specs", () => {
    const abpReport = analyzeSdlReachability(parseSdl(ALTERNATING_BIT_PROTOCOL_SDL));
    assert.strictEqual(abpReport.isDeadlockFree, true);
    assert.strictEqual(abpReport.allStatesReachable, true);
    assert.strictEqual(abpReport.processes.length, 2);
    assert.strictEqual(abpReport.processes[0]?.hasCycles, true);

    const faulty = `
      SYSTEM FaultyCall;
        SIGNAL Setup;
        BLOCK B;
          PROCESS CallCtrl;
            START; NEXTSTATE Idle;
            STATE Idle;
              INPUT Setup;
                NEXTSTATE DeadEnd;
            ENDSTATE Idle;
            STATE DeadEnd;
            ENDSTATE DeadEnd;
            STATE UnreachableError;
              INPUT Setup;
                NEXTSTATE Idle;
            ENDSTATE UnreachableError;
          ENDPROCESS CallCtrl;
        ENDBLOCK B;
      ENDSYSTEM FaultyCall;
    `;
    const faultyReport = analyzeSdlReachability(parseSdl(faulty));
    assert.strictEqual(faultyReport.isDeadlockFree, false);
    assert.strictEqual(faultyReport.allStatesReachable, false);
    assert.deepStrictEqual(faultyReport.processes[0]?.deadlockStates, ["DeadEnd"]);
    assert.deepStrictEqual(faultyReport.processes[0]?.unreachableStates, ["UnreachableError"]);
  });
});
