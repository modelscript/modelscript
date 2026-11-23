// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sdlToDae } from "../src/index.js";

describe("SDL-88 Direct DAEBuilder Arena Lowering", () => {
  it("lowers EFSM states, DCL variables, channels, and TIMER countdown ODEs into DAEBuilder", () => {
    const src = `
      SYSTEM WatchdogSys;
        SIGNAL Kick, Alarm;
        CHANNEL C_WD
          FROM WdBlock TO ENV WITH Alarm;
        ENDCHANNEL C_WD;
        BLOCK WdBlock;
          PROCESS Watchdog;
            DCL misses Integer := 0;
            DCL armed Boolean := TRUE;
            TIMER T_wd;
            START;
              SET(NOW + 2.0, T_wd);
              NEXTSTATE Monitoring;
            STATE Monitoring;
              INPUT Kick;
                RESET(T_wd);
                SET(NOW + 2.0, T_wd);
                NEXTSTATE Monitoring;
              INPUT T_wd;
                TASK misses := misses + 1;
                OUTPUT Alarm TO ENV;
                NEXTSTATE Fault;
            ENDSTATE Monitoring;
            STATE Fault;
              INPUT Kick;
                SET(NOW + 2.0, T_wd);
                NEXTSTATE Monitoring;
            ENDSTATE Fault;
          ENDPROCESS Watchdog;
        ENDBLOCK WdBlock;
      ENDSYSTEM WatchdogSys;
    `;

    const { builder, lowering } = sdlToDae(src);
    assert.strictEqual(lowering.stateVarIndices.length, 1);
    assert.strictEqual(lowering.timerVarIndices.length, 1);
    assert.ok(lowering.equationCount >= 6, `Expected >= 6 equations, got ${lowering.equationCount}`);

    // Verify linear-memory DAE variables exist
    assert.notStrictEqual(builder.lookupVariable("WdBlock_Watchdog_state"), -1);
    assert.notStrictEqual(builder.lookupVariable("WdBlock_Watchdog_misses"), -1);
    assert.notStrictEqual(builder.lookupVariable("WdBlock_Watchdog_armed"), -1);
    assert.notStrictEqual(builder.lookupVariable("WdBlock_Watchdog_T_wd_rem"), -1);
    assert.notStrictEqual(builder.lookupVariable("WdBlock_Watchdog_T_wd_active"), -1);
    assert.notStrictEqual(builder.lookupVariable("ch_C_WD_delay"), -1);

    const enc = lowering.stateEncoding.get("WdBlock_Watchdog");
    assert.ok(enc);
    assert.strictEqual(enc.get("MONITORING"), 1);
    assert.strictEqual(enc.get("FAULT"), 2);
  });
});
