// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BPA_3_BUS_IPF, IEEE_14_BUS_CDF, IEEE_5_BUS_CDF } from "../src/catalog/ieee-cdf-std-schemas.js";
import { detectIeeeCdfFormat, parseBpaIpf, parseIeeeCdf } from "../src/parser/index.js";

describe("@modelscript/ieee-cdf Parser Suite", () => {
  it("parses fixed-column IEEE CDF 1973 14-bus deck with all sections", () => {
    assert.strictEqual(detectIeeeCdfFormat(IEEE_14_BUS_CDF), "ieee-cdf");
    const net = parseIeeeCdf(IEEE_14_BUS_CDF);

    assert.strictEqual(net.format, "ieee-cdf");
    assert.strictEqual(net.hasTitleCard, true);
    assert.strictEqual(net.hasEndOfData, true);
    assert.strictEqual(net.title.mvaBase, 100.0);
    assert.strictEqual(net.title.year, 1962);
    assert.strictEqual(net.title.season, "W");
    assert.strictEqual(net.buses.length, 14);
    assert.strictEqual(net.branches.length, 20);
    assert.strictEqual(net.lossZones.length, 1);
    assert.strictEqual(net.interchanges.length, 1);
    assert.strictEqual(net.parseIssues.length, 0);

    const bus1 = net.buses[0]!;
    assert.strictEqual(bus1.busNumber, 1);
    assert.strictEqual(bus1.type, 3);
    assert.strictEqual(bus1.finalVoltagePu, 1.06);
    assert.strictEqual(bus1.desiredVoltsPu, 1.06);

    const bus9 = net.buses.find((b) => b.busNumber === 9)!;
    assert.strictEqual(bus9.type, 0);
    assert.strictEqual(bus9.shuntB, 0.19);
    assert.strictEqual(bus9.loadMw, 29.5);
    assert.strictEqual(bus9.loadMvar, 16.6);

    const xfmr47 = net.branches.find((br) => br.fromBus === 4 && br.toBus === 7)!;
    assert.strictEqual(xfmr47.type, 1);
    assert.strictEqual(xfmr47.x, 0.20912);
    assert.strictEqual(xfmr47.tapRatio, 0.978);
  });

  it("parses free-format IEEE CDF decks with quoted bus names and tie lines", () => {
    const freeFormat = `01/01/73 TEST 100.0 1973 S FREE_FORMAT_CASE
BUS DATA FOLLOWS
1 "Slack Bus" 1 1 3 1.05 0.0 0.0 0.0 100.0 0.0 230.0 1.05 0.0 0.0 0.0 0.0 0
2 "Load Bus" 1 1 0 1.00 0.0 80.0 20.0 0.0 0.0 230.0 0.0 0.0 0.0 0.0 0.0 0
-999
BRANCH DATA FOLLOWS
1 2 1 1 1 0 0.01 0.05 0.02 150 150 150 0 0 0.0 0.0
-999
TIE LINES FOLLOWS
1 1 2 2 1
-999
END OF DATA
`;
    const net = parseIeeeCdf(freeFormat);
    assert.strictEqual(net.buses.length, 2);
    assert.strictEqual(net.buses[0]!.name, "Slack Bus");
    assert.strictEqual(net.buses[1]!.name, "Load Bus");
    assert.strictEqual(net.branches.length, 1);
    assert.strictEqual(net.branches[0]!.r, 0.01);
    assert.strictEqual(net.branches[0]!.x, 0.05);
    assert.strictEqual(net.tieLines.length, 1);
    assert.strictEqual(net.tieLines[0]!.meteredBus, 1);
    assert.strictEqual(net.tieLines[0]!.nonMeteredBus, 2);
  });

  it("parses BPA IPF decks with B , BE, BQ, BS, L , T , E , R , and C  cards", () => {
    assert.strictEqual(detectIeeeCdfFormat(BPA_3_BUS_IPF), "bpa-ipf");
    const net = parseIeeeCdf(BPA_3_BUS_IPF);
    assert.strictEqual(net.format, "bpa-ipf");
    assert.strictEqual(net.title.mvaBase, 100.0);
    assert.strictEqual(net.buses.length, 3);
    assert.strictEqual(net.branches.length, 3);
    assert.strictEqual(net.comments.length, 1);

    const bpaFull = `(POWERFLOW, CASEID=BPA_ALL_CARDS, MVA_BASE=100.0)
C  Test all BPA card types
BS SWING 230.0 V=1.05 ANG=0.0
BQ PV1   230.0 PG=50.0 QMAX=60.0 QMIN=-30.0 V=1.02
BE PV2   115.0 PG=30.0 QMAX=40.0 QMIN=-20.0 V=1.01
B  LOAD1 115.0 PL=70.0 QL=25.0
L  SWING PV1   1 R=0.01 X=0.05 B2=0.01
T  PV1   PV2   1 R=0.00 X=0.10 TAP=0.98 SHIFT=2.5
E  PV2   LOAD1 1 R=0.02 X=0.08 B=0.02
R  PV1   PV2   TMAX=1.10 TMIN=0.90 STEP=0.0125
(END)
`;
    const full = parseBpaIpf(bpaFull);
    assert.strictEqual(full.buses.length, 4);
    assert.strictEqual(full.buses[0]!.type, 3);
    assert.strictEqual(full.buses[1]!.type, 2);
    assert.strictEqual(full.buses[2]!.type, 2);
    assert.strictEqual(full.buses[3]!.type, 0);
    assert.strictEqual(full.branches.length, 3);

    const xfmr = full.branches[1]!;
    assert.strictEqual(xfmr.tapRatio, 0.98);
    assert.strictEqual(xfmr.phaseShiftDeg, 2.5);
    assert.strictEqual(xfmr.type, 2); // upgraded by R  regulator card
    assert.strictEqual(xfmr.maxTapOrShift, 1.1);
    assert.strictEqual(xfmr.minTapOrShift, 0.9);
  });

  it("parses embedded IEEE 5-bus network cleanly", () => {
    const net = parseIeeeCdf(IEEE_5_BUS_CDF);
    assert.strictEqual(net.buses.length, 5);
    assert.strictEqual(net.branches.length, 7);
    assert.strictEqual(net.hasTitleCard, true);
    assert.strictEqual(net.hasEndOfData, true);
    assert.strictEqual(net.parseIssues.length, 0);
  });
});
