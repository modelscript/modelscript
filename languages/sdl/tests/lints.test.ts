// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSdl, parseSdl } from "../src/index.js";

describe("SDL-88 Static Analysis & Lints (SDL1001–SDL5006)", () => {
  it("produces zero errors on a well-formed SDL-88 system", () => {
    const src = `
      SYSTEM Clean;
        SIGNAL Ping, Pong;
        CHANNEL C1
          FROM B1 TO B2 WITH Ping;
          FROM B2 TO B1 WITH Pong;
        ENDCHANNEL C1;
        BLOCK B1;
          SIGNALROUTE R1
            FROM P1 TO ENV WITH Ping;
            FROM ENV TO P1 WITH Pong;
          CONNECT C1 AND R1;
          PROCESS P1;
            TIMER T1;
            START;
              OUTPUT Ping VIA R1;
              SET(NOW + 1.0, T1);
              NEXTSTATE WaitPong;
            STATE WaitPong;
              INPUT Pong;
                RESET(T1);
                NEXTSTATE WaitPong;
              INPUT T1;
                OUTPUT Ping VIA R1;
                SET(NOW + 1.0, T1);
                NEXTSTATE WaitPong;
            ENDSTATE WaitPong;
          ENDPROCESS P1;
        ENDBLOCK B1;
        BLOCK B2;
          SIGNALROUTE R2
            FROM ENV TO P2 WITH Ping;
            FROM P2 TO ENV WITH Pong;
          CONNECT C1 AND R2;
          PROCESS P2;
            START;
              NEXTSTATE Idle;
            STATE Idle;
              INPUT Ping;
                OUTPUT Pong VIA R2;
                NEXTSTATE Idle;
            ENDSTATE Idle;
          ENDPROCESS P2;
        ENDBLOCK B2;
      ENDSYSTEM Clean;
    `;
    const diags = lintSdl(parseSdl(src));
    const errors = diags.filter((d) => d.severity === "error");
    assert.strictEqual(errors.length, 0, `Unexpected errors: ${errors.map((e) => e.message).join("; ")}`);
  });

  it("detects SDL1001 syntax error and SDL2001 duplicate SYSTEM", () => {
    const src = `
      SYSTEM S1; ENDSYSTEM S1;
      SYSTEM S2; /* unclosed
    `;
    const diags = lintSdl(parseSdl(src));
    assert.ok(diags.some((d) => d.id === "SDL1001"));
    assert.ok(diags.some((d) => d.id === "SDL2001"));
  });

  it("detects SDL2002 duplicate BLOCK, SDL2003 duplicate PROCESS, SDL2004 duplicate STATE", () => {
    const src = `
      SYSTEM Dup;
        SIGNAL Go;
        BLOCK B;
          PROCESS P;
            START; NEXTSTATE S;
            STATE S; INPUT Go; NEXTSTATE S; ENDSTATE S;
            STATE S; INPUT Go; NEXTSTATE S; ENDSTATE S;
          ENDPROCESS P;
          PROCESS P;
            START; NEXTSTATE S;
            STATE S; INPUT Go; NEXTSTATE S; ENDSTATE S;
          ENDPROCESS P;
        ENDBLOCK B;
        BLOCK B;
        ENDBLOCK B;
      ENDSYSTEM Dup;
    `;
    const diags = lintSdl(parseSdl(src));
    assert.ok(diags.some((d) => d.id === "SDL2002"));
    assert.ok(diags.some((d) => d.id === "SDL2003"));
    assert.ok(diags.some((d) => d.id === "SDL2004"));
  });

  it("detects SDL3001 undefined signal, SDL3002 undefined timer, SDL3003 undefined state", () => {
    const src = `
      SYSTEM Undef;
        BLOCK B;
          PROCESS P;
            START;
              SET(NOW + 1.0, GhostTimer);
              NEXTSTATE RealState;
            STATE RealState;
              INPUT GhostSig;
                OUTPUT AlsoGhost;
                NEXTSTATE MissingState;
            ENDSTATE RealState;
          ENDPROCESS P;
        ENDBLOCK B;
      ENDSYSTEM Undef;
    `;
    const diags = lintSdl(parseSdl(src));
    assert.ok(diags.some((d) => d.id === "SDL3001"));
    assert.ok(diags.some((d) => d.id === "SDL3002"));
    assert.ok(diags.some((d) => d.id === "SDL3003"));
  });

  it("detects SDL4001 unreachable state and SDL4002 deadlock/sink state", () => {
    const src = `
      SYSTEM Reach;
        SIGNAL Step;
        BLOCK B;
          PROCESS P;
            START; NEXTSTATE S1;
            STATE S1;
              INPUT Step;
                NEXTSTATE SinkState;
            ENDSTATE S1;
            STATE SinkState;
            ENDSTATE SinkState;
            STATE OrphanState;
              INPUT Step;
                NEXTSTATE S1;
            ENDSTATE OrphanState;
          ENDPROCESS P;
        ENDBLOCK B;
      ENDSYSTEM Reach;
    `;
    const diags = lintSdl(parseSdl(src));
    assert.ok(diags.some((d) => d.id === "SDL4001" && d.symbolName === "OrphanState"));
    assert.ok(diags.some((d) => d.id === "SDL4002" && d.symbolName === "SinkState"));
  });

  it("detects SDL5001 unmatched NEXTSTATE, SDL5002 missing START, SDL5003/SDL5004 disconnected routes, SDL5005/SDL5006", () => {
    const src = `
      SYSTEM Struct;
        SIGNAL Used, NeverUsed;
        CHANNEL OrphanChan
          FROM B TO GhostBlock WITH Used;
        ENDCHANNEL OrphanChan;
        BLOCK B;
          SIGNALROUTE OrphanRoute
            FROM P TO ENV WITH Used;
          PROCESS P;
            TIMER NeverArmed;
            STATE S1;
              INPUT Used;
                TASK x := 1;
              INPUT NeverArmed;
                NEXTSTATE S1;
            ENDSTATE S1;
          ENDPROCESS P;
        ENDBLOCK B;
      ENDSYSTEM Struct;
    `;
    const diags = lintSdl(parseSdl(src));
    assert.ok(diags.some((d) => d.id === "SDL5001"));
    assert.ok(diags.some((d) => d.id === "SDL5002"));
    assert.ok(diags.some((d) => d.id === "SDL5003"));
    assert.ok(diags.some((d) => d.id === "SDL5004"));
    assert.ok(diags.some((d) => d.id === "SDL5005"));
    assert.ok(diags.some((d) => d.id === "SDL5006"));
  });
});
