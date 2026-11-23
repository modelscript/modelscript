// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHec1Deck } from "../src/index.js";

describe("@modelscript/hec1 — Fixed & Free-Format Card Deck Parser", () => {
  it("parses classic 8-column fixed-format USACE HEC-1 card deck with blank leading fields", () => {
    // Columns: 1-2 code, 3-8 F1, 9-16 F2, 17-24 F3, 25-32 F4
    const deckText = [
      "* USACE HEC-1 FIXED-FORMAT TEST WATERSHED",
      "ID  CASTRO VALLEY WATERSHED 100-YR STORM",
      "IT    15  16JAN73     0000     100",
      "IO     5       0",
      "KK SUB1  UPPER SUBBASIN",
      "KM  CLARK UH WITH SCS CURVE NUMBER",
      "BA   5.5",
      "PB   4.2",
      "PI  0.10    0.30    0.80    1.50    1.00    0.50",
      "LS          78.0    15.0",
      "UC   1.5     2.0",
      "BF  10.0     0.0     1.0",
      "KK RCH1  MAIN CHANNEL REACH",
      "RM     3     1.5    0.20",
      "ZZ",
    ].join("\n");

    const deck = parseHec1Deck(deckText);
    assert.equal(deck.parseErrors.length, 0, `Unexpected parse errors: ${JSON.stringify(deck.parseErrors)}`);
    assert.equal(deck.hasEndCard, true);
    assert.equal(deck.titleLines[0], "CASTRO VALLEY WATERSHED 100-YR STORM");
    assert.equal(deck.timeControl?.nmin, 15);
    assert.equal(deck.timeControl?.nq, 100);
    assert.equal(deck.outputControl?.iprint, 5);
    assert.equal(deck.stationOrder.length, 2);

    const sub1 = deck.stations.get("SUB1");
    assert.ok(sub1);
    assert.equal(sub1.kind, "subbasin");
    assert.equal(sub1.area, 5.5);
    assert.equal(sub1.precipitationTotal, 4.2);
    assert.deepEqual(sub1.precipitationIncrements, [0.1, 0.3, 0.8, 1.5, 1.0, 0.5]);
    assert.equal(sub1.loss?.method, "SCS");
    if (sub1.loss?.method === "SCS") {
      assert.equal(sub1.loss.strtl, undefined); // Blank F1 preserved in fixed-format!
      assert.equal(sub1.loss.curveNumber, 78.0);
      assert.equal(sub1.loss.rtimp, 15.0);
    }
    assert.equal(sub1.unitHydrograph?.method, "Clark");
    if (sub1.unitHydrograph?.method === "Clark") {
      assert.equal(sub1.unitHydrograph.tc, 1.5);
      assert.equal(sub1.unitHydrograph.r, 2.0);
    }
    assert.equal(sub1.baseflow?.strtq, 10.0);

    const rch1 = deck.stations.get("RCH1");
    assert.ok(rch1);
    assert.equal(rch1.kind, "route");
    assert.equal(rch1.muskingum?.nstps, 3);
    assert.equal(rch1.muskingum?.amskk, 1.5);
    assert.equal(rch1.muskingum?.x, 0.2);
  });

  it("parses comma-delimited and whitespace-delimited free-format HEC-1 decks", () => {
    const deckText = [
      "ID FREE FORMAT TWO-BRANCH WATERSHED",
      "IT,30,01MAY85,0600,80",
      "KK,NORTH,North Tributary",
      "BA,8.25",
      "PC,0.2,0.7,1.8,3.2,4.0",
      "LS,,72,10",
      "UD,1.25",
      "KK SOUTH South Tributary",
      "BA 6.5",
      "PB 4.0",
      "LU 0.4 0.15 5",
      "US 1.8 0.62",
      "KK JUNC1 Confluence",
      "HC 2",
      "ZW A=BASIN B=JUNC1 C=FLOW F=OBS",
      "ZZ",
    ].join("\n");

    const deck = parseHec1Deck(deckText);
    assert.equal(deck.parseErrors.length, 0);
    assert.equal(deck.hasEndCard, true);
    assert.deepEqual(deck.stationOrder, ["NORTH", "SOUTH", "JUNC1"]);

    const north = deck.stations.get("NORTH")!;
    assert.equal(north.area, 8.25);
    assert.deepEqual(north.precipitationCumulative, [0.2, 0.7, 1.8, 3.2, 4.0]);
    assert.equal(north.loss?.method, "SCS");
    if (north.loss?.method === "SCS") {
      assert.equal(north.loss.strtl, undefined);
      assert.equal(north.loss.curveNumber, 72);
      assert.equal(north.loss.rtimp, 10);
    }
    assert.equal(north.unitHydrograph?.method, "SCS");
    if (north.unitHydrograph?.method === "SCS") {
      assert.equal(north.unitHydrograph.tlag, 1.25);
    }

    const south = deck.stations.get("SOUTH")!;
    assert.equal(south.loss?.method, "Uniform");
    assert.equal(south.unitHydrograph?.method, "Snyder");
    if (south.unitHydrograph?.method === "Snyder") {
      assert.equal(south.unitHydrograph.tp, 1.8);
      assert.equal(south.unitHydrograph.cp, 0.62);
    }

    const junc = deck.stations.get("JUNC1")!;
    assert.equal(junc.kind, "combine");
    assert.equal(junc.combineCount, 2);
    assert.ok(junc.dssWritePath?.includes("B=JUNC1"));
  });

  it("records parse errors for unknown card codes and malformed lines", () => {
    const deckText = ["ID BAD DECK", "IT 15 01JAN80 0000 40", "QX 1.0 2.0", "12345 INVALID", "ZZ"].join("\n");
    const deck = parseHec1Deck(deckText);
    assert.equal(deck.parseErrors.length, 2);
    assert.ok(deck.parseErrors[0]!.message.includes("QX"));
  });
});
