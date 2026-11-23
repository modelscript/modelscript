// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSdl, sdlToModelica } from "../src/index.js";

describe("SDL-88 to Modelica State-Machine Projection", () => {
  it("projects SDL-88 processes, states, transitions, and timers to Modelica 3.3+ state machines", () => {
    const src = `
      SYSTEM CallSetup;
        SIGNAL OffHook, DialTone, Connect;
        BLOCK SubscriberBlock;
          PROCESS Originator;
            DCL retries Integer := 0;
            TIMER T303;
            START;
              NEXTSTATE Idle;
            STATE Idle;
              INPUT OffHook;
                SET(NOW + 4.0, T303);
                NEXTSTATE Calling;
            ENDSTATE Idle;
            STATE Calling;
              INPUT Connect;
                RESET(T303);
                NEXTSTATE Connected;
              INPUT T303;
                TASK retries := retries + 1;
                NEXTSTATE Idle;
            ENDSTATE Calling;
            STATE Connected;
              INPUT OffHook;
                NEXTSTATE Idle;
            ENDSTATE Connected;
          ENDPROCESS Originator;
        ENDBLOCK SubscriberBlock;
      ENDSYSTEM CallSetup;
    `;

    const mo = sdlToModelica(parseSdl(src));
    assert.ok(mo.includes("package CallSetup"));
    assert.ok(mo.includes("package SubscriberBlock"));
    assert.ok(mo.includes("model Originator"));
    assert.ok(mo.includes("block State_Idle"));
    assert.ok(mo.includes("block State_Calling"));
    assert.ok(mo.includes("block State_Connected"));
    assert.ok(mo.includes("initialState(Idle);"));
    assert.ok(mo.includes("transition(Idle, Calling, sig_OffHook"));
    assert.ok(mo.includes("transition(Calling, Connected, sig_Connect"));
    assert.ok(mo.includes("der(T303_rem) = if T303_active then -1.0 else 0.0;"));
    assert.ok(mo.includes("model SystemAssembly"));
  });
});
