// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHec2Deck } from "../src/index.js";

describe("@modelscript/hec2 — Dual Fixed-Format & Free-Format Card Parser", () => {
  it("parses classic 8-column fixed-format Fortran punch-card HEC-2 decks", () => {
    const fixedDeck = [
      "T1  PRISMATIC RECTANGULAR CHANNEL BENCHMARK",
      "T2  FIXED-FORMAT 8-COLUMN CARD DECK",
      "C   CLASSIC USACE HEC-2 SUBCRITICAL BACKWATER PROFILE",
      "J1                              0.001                   1000.0   105.0",
      "NC  .035    .035    .025      .1      .3",
      "X1  1000       4     0.0    50.0     0.0     0.0     0.0",
      "GR 120.0     0.0   100.0     0.0   100.0    50.0   120.0    50.0",
      "X1  2000       4     0.0    50.0  1000.0  1000.0  1000.0",
      "GR 121.0     0.0   101.0     0.0   101.0    50.0   121.0    50.0",
      "EJ",
      "ER",
    ].join("\n");

    const deck = parseHec2Deck(fixedDeck);
    assert.equal(deck.parseErrors.length, 0);
    assert.equal(deck.units, "US");
    assert.deepEqual(deck.titles, ["PRISMATIC RECTANGULAR CHANNEL BENCHMARK", "FIXED-FORMAT 8-COLUMN CARD DECK"]);
    assert.equal(deck.hasEndJob, true);
    assert.equal(deck.hasEndRun, true);
    assert.ok(deck.jobCard);
    assert.equal(deck.jobCard.strt, 0.001);
    assert.equal(deck.jobCard.q, 1000.0);
    assert.equal(deck.jobCard.wsel, 105.0);

    assert.equal(deck.crossSections.length, 2);
    const xs1 = deck.crossSections[0]!;
    assert.equal(xs1.secno, 1000);
    assert.equal(xs1.numst, 4);
    assert.equal(xs1.stchl, 0);
    assert.equal(xs1.stchr, 50);
    assert.equal(xs1.manning.left, 0.035);
    assert.equal(xs1.manning.right, 0.035);
    assert.equal(xs1.manning.channel, 0.025);
    assert.equal(xs1.contractionCoef, 0.1);
    assert.equal(xs1.expansionCoef, 0.3);
    assert.equal(xs1.grPoints.length, 4);
    assert.deepEqual(xs1.grPoints[0], { elevation: 120, station: 0 });
    assert.deepEqual(xs1.grPoints[2], { elevation: 100, station: 50 });

    const xs2 = deck.crossSections[1]!;
    assert.equal(xs2.secno, 2000);
    assert.equal(xs2.xlch, 1000);
    assert.equal(xs2.manning.channel, 0.025); // Inherited from NC card
  });

  it("parses comma-delimited and whitespace-delimited free-format decks with multi-line GR, NH, QT, SB/BT", () => {
    const freeDeck = [
      "T1  NATURAL COMPOUND CHANNEL WITH BRIDGE",
      "T3  METRIC SI FREE-FORMAT RUN",
      "J1,0,2,0,0,0.0005,1,0,250.0,15.5",
      "J2,1,0,0,0,0,0,0,0,0,0",
      "QT,3,100,250,500",
      "NC,0.06,0.06,0.03,0.1,0.3",
      "X1,100,7,20,60,0,0,0",
      "GR,20,0,16,10,15,20,10,30,10,50",
      "GR,15,60,20,80",
      "NC,0.06,0.06,0.03,0.3,0.5",
      "NH,3,0.06,20,0.03,60,0.06,80",
      "SB,1.25,1.5,2.6,30,4,120,2,10.5,10.2",
      "BT,2,0,20,18,80,20,18",
      "X1 200 7 20 60 300 300 300",
      "GR 20.5 0 16.5 10 15.5 20 10.5 30 10.5 50",
      "GR 15.5 60 20.5 80",
      "EJ",
    ].join("\n");

    const deck = parseHec2Deck(freeDeck);
    assert.equal(deck.parseErrors.length, 0);
    assert.equal(deck.units, "SI");
    assert.ok(deck.dischargeTable);
    assert.deepEqual(deck.dischargeTable.discharges, [100, 250, 500]);
    assert.equal(deck.crossSections.length, 2);

    const xs1 = deck.crossSections[0]!;
    assert.equal(xs1.grPoints.length, 7);
    assert.equal(xs1.grPoints[6]?.station, 80);

    const xs2 = deck.crossSections[1]!;
    assert.equal(xs2.secno, 200);
    assert.equal(xs2.xlch, 300);
    assert.equal(xs2.contractionCoef, 0.3);
    assert.equal(xs2.expansionCoef, 0.5);
    assert.ok(xs2.horizontalManning && xs2.horizontalManning.length === 3);
    assert.ok(xs2.bridge);
    assert.equal(xs2.bridge.xk, 1.25);
    assert.equal(xs2.bridge.bridgeTable?.length, 2);
  });

  it("supports repeated cross-section (NUMST=0) with elevation offset PXSECE", () => {
    const deckText = [
      "T1  REPEATED SECTION TEST",
      "J1,0,0,0,0,0.001,1,0,50,12.0",
      "NC,0.03,0.03,0.02,0.1,0.3",
      "X1,0,4,0,10,0,0,0",
      "GR,20,0,10,0,10,10,20,10",
      "X1,1000,0,0,0,1000,1000,1000,0,1.0",
      "EJ",
    ].join("\n");

    const deck = parseHec2Deck(deckText);
    assert.equal(deck.crossSections.length, 2);
    const xs2 = deck.crossSections[1]!;
    assert.equal(xs2.grPoints.length, 4);
    assert.equal(xs2.grPoints[1]?.elevation, 11.0);
    assert.equal(xs2.stchr, 10);
  });
});
