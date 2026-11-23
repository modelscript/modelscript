// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSlamDeck, parseSlamExpr } from "../src/parser/index.js";

describe("@modelscript/slam — Parser", () => {
  it("parses control statements, network nodes, continuous state equations, and semicolon comments", () => {
    const deck = `
; Pritsker Tanker-Refinery Combined Discrete-Continuous Model
GEN, PRITSKER, TANKER_REFINERY, 1/1/1979, 1;
LIMITS, 4, 3, 100;
CONTINUOUS, 2, 1, 0.01, 0.1, 0.1;
INTLC, SS(1)=0.0, SS(2)=150.0, XX(1)=1.0, XX(2)=1.0;
INITIALIZE, 0.0, 20.0;

; Continuous tank & refinery equations
DD(1) = 300.0 * XX(1) - 150.0 * XX(2);
DD(2) = 150.0 * XX(2) - 100.0;
SS(3) = SS(1) + SS(2);

NETWORK;
  RESOURCE/BERTH(1), 1;
  GATE/PORT, OPEN, 2;
  CREATE, EXPON(5.0), 0.0, 1, 10, 1; arrive every ~5 days
  ARR   AWAIT(1), BERTH/1, , 1;
        ASSIGN, XX(1)=1.0, 1;
        ACTIVITY/1, 2.0, 1.0, DONE;
  DONE  FREE, BERTH/1, 1;
        CLOSE, PORT, 1;
        OPEN, PORT, 1;
        COLCT, INT(1), TIME IN SYSTEM, 1;
        TERMINATE, 10;
  DET1  DETECT, SS(1), XP, 150.0, 0.01, 1;
        ASSIGN, XX(1)=0.0, 1;
        TERMINATE;
ENDNETWORK;
FIN;
`;

    const model = parseSlamDeck(deck);
    assert.equal(model.syntaxErrors.length, 0);
    assert.equal(model.name, "TANKER_REFINERY");
    assert.equal(model.gen?.analyst, "PRITSKER");
    assert.equal(model.gen?.runs, 1);
    assert.equal(model.limits?.mfil, 4);
    assert.equal(model.limits?.matr, 3);
    assert.equal(model.limits?.mnentries, 100);
    assert.equal(model.continuous?.nnequations, 2);
    assert.equal(model.continuous?.nnstates, 1);
    assert.equal(model.continuous?.dtmin, 0.01);
    assert.equal(model.continuous?.dtmax, 0.1);
    assert.equal(model.initialize?.ttbeg, 0.0);
    assert.equal(model.initialize?.ttfin, 20.0);
    assert.equal(model.intlc.length, 4);
    assert.equal(model.stateEquations.length, 3);
    assert.equal(model.stateEquations[0]?.lhsKind, "DD");
    assert.equal(model.stateEquations[0]?.index, 1);
    assert.equal(model.stateEquations[2]?.lhsKind, "SS");
    assert.equal(model.stateEquations[2]?.index, 3);
    assert.equal(model.hasNetwork, true);
    assert.equal(model.hasEndNetwork, true);
    assert.equal(model.hasFin, true);
    assert.ok(model.resources.has("BERTH"));
    assert.equal(model.resources.get("BERTH")?.resourceUnits, 1);
    assert.ok(model.gates.has("PORT"));
    assert.equal(model.gates.get("PORT")?.gateInitialOpen, true);
    assert.ok(model.labels.has("ARR"));
    assert.ok(model.labels.has("DONE"));
    assert.ok(model.labels.has("DET1"));
  });

  it("parses QUEUE nodes and arithmetic/distribution expressions", () => {
    const deck = `
GEN, ANALYST, MM1_QUEUE, 1/1/1979, 1;
NETWORK;
  CREATE, EXPON(1.0), 0.0, 1;
  Q1 QUEUE(1), 0, 50;
     ACTIVITY/1, EXPON(0.6);
     COLCT, INT(1), SYS_TIME;
     TERMINATE;
ENDNETWORK;
FIN;
`;
    const model = parseSlamDeck(deck);
    assert.equal(model.syntaxErrors.length, 0);
    const qNode = model.nodes.find((n) => n.type === "QUEUE");
    assert.ok(qNode);
    assert.equal(qNode.fileNumber, 1);
    assert.equal(qNode.capacity, 50);

    const expr = parseSlamExpr("300.0 * XX(1) - 150.0 * SS(2) + EXPON(2.5)");
    assert.equal(expr.kind, "binary");
    assert.equal(expr.op, "+");
  });

  it("records syntax errors for unknown statements", () => {
    const model = parseSlamDeck("UNKNOWN_STMT, 1, 2;\nFIN;\n");
    assert.equal(model.syntaxErrors.length, 1);
    assert.ok(model.syntaxErrors[0]?.message.includes("UNKNOWN_STMT"));
  });
});
