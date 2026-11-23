// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGpss } from "../src/parser/index.js";

const BARBERSHOP_DECK = `
* MODEL: GordonBarbershop
* Geoffrey Gordon (1961) Classic Single-Barber Queueing Model
      GENERATE 18,6         ; Customers arrive every 18 +/- 6 minutes
      QUEUE    LINE         ; Enter waiting line
      SEIZE    JOE          ; Capture barber Joe
      DEPART   LINE         ; Leave waiting line
      ADVANCE  16,4         ; Haircut takes 16 +/- 4 minutes
      RELEASE  JOE          ; Free barber Joe
      TERMINATE 1           ; Customer exits
      START    100          ; Simulate 100 customers
      END
`;

describe("GPSS Parser", () => {
  it("parses Geoffrey Gordon's classic barbershop deck with comments and operands", () => {
    const model = parseGpss(BARBERSHOP_DECK);

    assert.strictEqual(model.name, "GordonBarbershop");
    assert.strictEqual(model.syntaxErrors.length, 0);
    assert.strictEqual(model.blocks.length, 7);
    assert.strictEqual(model.hasStart, true);
    assert.strictEqual(model.hasEnd, true);
    assert.strictEqual(model.startCount, 100);
    assert.ok(model.facilities.has("JOE"));
    assert.ok(model.queues.has("LINE"));

    assert.strictEqual(model.blocks[0]!.opcode, "GENERATE");
    assert.deepStrictEqual(model.blocks[0]!.operands, ["18", "6"]);
    assert.strictEqual(model.blocks[4]!.opcode, "ADVANCE");
    assert.deepStrictEqual(model.blocks[4]!.operands, ["16", "4"]);
  });

  it("parses labeled blocks, STORAGE, FUNCTION data pairs, TABLE, EQU, TEST, GATE, and omitted operands", () => {
    const deck = `
; MODEL: MultiServerShop
CHAIRS STORAGE 3
BARBER EQU 1,F
EXPON FUNCTION RN1,C4
0,0/.5,.693/.9,2.303/.99,4.605
WAIT TABLE M1,10,10,20
      GENERATE 10,FN$EXPON,,,2
      QUEUE    LOBBY
      TEST G   Q$LOBBY,10,ENTER_SHOP
      TRANSFER ,BALK
ENTER_SHOP ENTER CHAIRS,1
      DEPART   LOBBY
      ADVANCE  25,FN$EXPON
      LEAVE    CHAIRS,1
      TABULATE WAIT
      TERMINATE 1
BALK  TERMINATE 1
      START    200
      END
`;
    const model = parseGpss(deck);

    assert.strictEqual(model.name, "MultiServerShop");
    assert.strictEqual(model.syntaxErrors.length, 0);
    assert.strictEqual(model.storages.get("CHAIRS")?.capacity, 3);
    assert.strictEqual(model.equs.get("BARBER")?.value, 1);
    assert.strictEqual(model.functions.get("EXPON")?.points.length, 4);
    assert.strictEqual(model.functions.get("EXPON")?.mode, "C");
    assert.strictEqual(model.tables.get("WAIT")?.argument, "M1");
    assert.ok(model.labels.has("ENTER_SHOP"));
    assert.ok(model.labels.has("BALK"));

    // Omitted positional operands C and D in GENERATE 10,FN$EXPON,,,2
    assert.deepStrictEqual(model.blocks[0]!.operands, ["10", "FN$EXPON", "", "", "2"]);
    // TEST G auxiliary operator
    assert.strictEqual(model.blocks[2]!.opcode, "TEST");
    assert.strictEqual(model.blocks[2]!.auxOperator, "G");
    assert.deepStrictEqual(model.blocks[2]!.operands, ["Q$LOBBY", "10", "ENTER_SHOP"]);
    // Unconditional TRANSFER ,BALK
    assert.strictEqual(model.blocks[3]!.opcode, "TRANSFER");
    assert.deepStrictEqual(model.blocks[3]!.operands, ["", "BALK"]);
  });

  it("supports STORAGE S$NAME,cap control syntax and reports unrecognized opcodes", () => {
    const deck = `
      STORAGE S$TELLERS,4
      GENERATE 5,1
      BOGUS_OP 1,2
      TERMINATE 1
      START 10
`;
    const model = parseGpss(deck);
    assert.strictEqual(model.storages.get("TELLERS")?.capacity, 4);
    assert.strictEqual(model.syntaxErrors.length, 1);
    assert.ok(model.syntaxErrors[0]!.message.includes("BOGUS_OP"));
  });
});
