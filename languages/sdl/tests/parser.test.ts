// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSdl, sdlIndexing } from "../src/index.js";

const SAMPLE_SDL = `
/* Alternating-Bit Protocol Skeleton */
SYSTEM TelecomABP;
  SIGNAL DataReq(Integer), Frame(Integer, Integer), Ack(Integer), DataInd(Integer);
  CHANNEL C_Data
    FROM SenderBlock TO ReceiverBlock WITH Frame;
    FROM ReceiverBlock TO SenderBlock WITH Ack;
  ENDCHANNEL C_Data;

  BLOCK SenderBlock;
    SIGNALROUTE SR_S
      FROM Sender TO ENV WITH Frame;
      FROM ENV TO Sender WITH Ack;
    CONNECT C_Data AND SR_S;

    PROCESS Sender(1, 1);
      DCL seq Integer := 0;
      DCL payload Integer := 0;
      TIMER T_retx;

      START;
        TASK seq := 0;
        NEXTSTATE Idle;

      STATE Idle;
        INPUT DataReq(payload);
          OUTPUT Frame(payload, seq) VIA SR_S;
          SET(NOW + 1.0, T_retx);
          NEXTSTATE WaitAck;
      ENDSTATE Idle;

      STATE WaitAck;
        INPUT Ack(seq);
          RESET(T_retx);
          TASK seq := 1 - seq;
          NEXTSTATE Idle;
        INPUT T_retx;
          OUTPUT Frame(payload, seq) VIA SR_S;
          SET(NOW + 1.0, T_retx);
          NEXTSTATE -;
      ENDSTATE WaitAck;
    ENDPROCESS Sender;
  ENDBLOCK SenderBlock;

  BLOCK ReceiverBlock;
    SIGNALROUTE SR_R
      FROM ENV TO Receiver WITH Frame;
      FROM Receiver TO ENV WITH Ack;
    CONNECT C_Data AND SR_R;

    PROCESS Receiver(1, 1);
      DCL expected Integer := 0;
      DCL rxPayload Integer := 0;
      DCL rxSeq Integer := 0;

      START;
        NEXTSTATE Ready;

      STATE Ready;
        INPUT Frame(rxPayload, rxSeq);
          DECISION rxSeq = expected;
            (TRUE):
              OUTPUT DataInd(rxPayload) TO ENV;
              OUTPUT Ack(rxSeq) VIA SR_R;
              TASK expected := 1 - expected;
              NEXTSTATE Ready;
            ELSE:
              OUTPUT Ack(rxSeq) VIA SR_R;
              NEXTSTATE -;
          ENDDECISION;
      ENDSTATE Ready;
    ENDPROCESS Receiver;
  ENDBLOCK ReceiverBlock;
ENDSYSTEM TelecomABP;
`;

describe("SDL-88 PR Parser", () => {
  it("parses SYSTEM, BLOCK, PROCESS, CHANNEL, SIGNALROUTE, CONNECT, SIGNAL, DCL, TIMER, STATE, DECISION", () => {
    const model = parseSdl(SAMPLE_SDL);
    assert.strictEqual(model.name, "TelecomABP");
    assert.strictEqual(model.syntaxErrors.length, 0);
    assert.strictEqual(model.signals.length, 4);
    assert.strictEqual(model.channels.length, 1);
    assert.strictEqual(model.channels[0]?.paths.length, 2);
    assert.strictEqual(model.blocks.length, 2);

    const sender = model.blocks[0]?.processes[0];
    assert.ok(sender);
    assert.strictEqual(sender.name, "Sender");
    assert.strictEqual(sender.variables.length, 2);
    assert.strictEqual(sender.timers.length, 1);
    assert.strictEqual(sender.timers[0]?.name, "T_retx");
    assert.ok(sender.start);
    assert.strictEqual(sender.states.length, 2);

    const receiver = model.blocks[1]?.processes[0];
    assert.ok(receiver);
    const readyInput = receiver.states[0]?.inputs[0];
    assert.ok(readyInput);
    assert.strictEqual(readyInput.transition.actions[0]?.kind, "decision");
    if (readyInput.transition.actions[0]?.kind === "decision") {
      assert.strictEqual(readyInput.transition.actions[0].branches.length, 2);
    }
  });

  it("handles STOP terminator and /* */ comments", () => {
    const src = `
      /* Header comment */
      SYSTEM OneShot;
        SIGNAL Halt;
        BLOCK B;
          PROCESS P;
            START;
              NEXTSTATE Running;
            STATE Running;
              INPUT Halt;
                /* Stop process */
                STOP;
            ENDSTATE Running;
          ENDPROCESS P;
        ENDBLOCK B;
      ENDSYSTEM OneShot;
    `;
    const model = parseSdl(src);
    assert.strictEqual(model.syntaxErrors.length, 0);
    const term = model.blocks[0]?.processes[0]?.states[0]?.inputs[0]?.transition.terminator;
    assert.strictEqual(term?.kind, "stop");
  });

  it("reports syntax errors for unterminated comments and missing ENDSYSTEM", () => {
    const bad = `SYSTEM Broken; /* unclosed comment`;
    const model = parseSdl(bad);
    assert.ok(model.syntaxErrors.length >= 1);
  });

  it("supports UnifiedWorkspace indexing via sdlIndexing", () => {
    assert.strictEqual(sdlIndexing.canIndex("protocol.sdl", ""), true);
    assert.strictEqual(sdlIndexing.canIndex("protocol.pr", ""), true);
    assert.strictEqual(sdlIndexing.canIndex("notes.txt", SAMPLE_SDL), true);
    assert.strictEqual(sdlIndexing.canIndex("notes.txt", "plain text"), false);

    const symbols: Array<{ name: string; kind: string }> = [];
    sdlIndexing.indexFile({
      uri: "abp.sdl",
      text: SAMPLE_SDL,
      setParsedModel: () => undefined,
      addSymbol: (name: string, kind: string) => {
        symbols.push({ name, kind });
        return symbols.length;
      },
    } as never);

    assert.ok(symbols.some((s) => s.name === "TelecomABP" && s.kind === "Package"));
    assert.ok(symbols.some((s) => s.name === "SenderBlock" && s.kind === "Module"));
    assert.ok(symbols.some((s) => s.name === "Sender" && s.kind === "Class"));
    assert.ok(symbols.some((s) => s.name === "WaitAck" && s.kind === "EnumMember"));
  });
});
