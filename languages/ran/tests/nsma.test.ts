// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import {
  type AntennaPatternDeck,
  interpolateAntennaGain,
  parseNsmaAdf,
  parsePlanetPat,
  ranLanguage,
} from "../src/index.js";

const SAMPLE_NSMA_ADF = `REVNUM: 1.01
PATTYP: C
DESCR1: 65deg 18dBi Dual-Pol Base Station Antenna
DESCR2: 1710-2170MHz
MANUF: ModelScript Wireless
MODEL: MSX-HEX-65-18
GAIN: 18.0
GAINU: DBI
FRQREC: 1710.0 2170.0
POLARZ: D
DTILTE: 2.0
DTILTM: 0.0
NOAVAL: 13
0.0 0.0
30.0 2.8
32.5 3.0
60.0 12.0
90.0 22.0
120.0 25.0
150.0 28.0
180.0 30.0
210.0 28.0
240.0 25.0
270.0 22.0
300.0 12.0
330.0 2.8
NOEVAL: 9
0.0 0.0
3.5 3.0
7.0 12.0
15.0 20.0
30.0 25.0
90.0 30.0
270.0 30.0
345.0 20.0
356.5 3.0
`;

const SAMPLE_PLANET_PAT = `NAME CellSector_Panel
FREQUENCY 1900
GAIN 17.5
TILT 4.0
POLARIZATION V
HORIZONTAL 5
0 0.0
32.5 3.0
90 20.0
180 28.0
270 20.0
VERTICAL 5
0 0.0
3.5 3.0
10 15.0
90 25.0
270 25.0
`;

test("NSMA WG16 & Planet antenna pattern parser and 3D interpolator", async (t) => {
  await t.test("parses NSMA .adf antenna pattern", () => {
    const deck = parseNsmaAdf(SAMPLE_NSMA_ADF, "sector.adf");
    assert.equal(deck.model, "MSX-HEX-65-18");
    assert.equal(deck.peakGainDbi, 18.0);
    assert.equal(deck.polarization, "Dual");
    assert.equal(deck.electricalDowntiltDeg, 2.0);
    assert.ok(deck.horizontalCut);
    assert.ok(deck.verticalCut);

    // 3 dB half-power beamwidth should be ~65 deg
    const hBw = deck.horizontalBeamwidthDeg ?? 0;
    assert.ok(hBw >= 60 && hBw <= 70);
    // Front-to-back ratio around 180 deg should be ~30 dB
    const f2b = deck.frontToBackRatioDb ?? 0;
    assert.ok(f2b >= 25);
  });

  await t.test("parses Planet .pat antenna pattern", () => {
    const deck = parsePlanetPat(SAMPLE_PLANET_PAT, "panel.pat");
    assert.equal(deck.name, "CellSector_Panel");
    assert.equal(deck.peakGainDbi, 17.5);
    assert.equal(deck.nominalFrequencyMhz, 1900);
    assert.equal(deck.electricalDowntiltDeg, 4.0);
    assert.ok(deck.horizontalCut);
    assert.ok(deck.verticalCut);
  });

  await t.test("interpolates 3D radiation gain envelope", () => {
    const deck = parseNsmaAdf(SAMPLE_NSMA_ADF, "sector.adf");

    // At boresight azimuth (0 deg) and effective elevation equal to tilt (2.0 deg), gain should be peak (18.0 dBi)
    const peak = interpolateAntennaGain(deck, 0.0, 2.0);
    assert.ok(Math.abs(peak - 18.0) < 0.1, `Expected peak ~18.0 dBi, got ${peak}`);

    // At 65/2 = 32.5 deg azimuth off-axis, gain should drop by 3 dB (to ~15.0 dBi)
    const halfPower = interpolateAntennaGain(deck, 32.5, 2.0);
    assert.ok(Math.abs(halfPower - 15.0) < 0.2, `Expected ~15.0 dBi at half-power edge, got ${halfPower}`);

    // At 180 deg back-lobe, gain should drop by front-to-back ratio (~30 dB down to -12 dBi)
    const backLobe = interpolateAntennaGain(deck, 180.0, 2.0);
    assert.ok(backLobe <= -10.0, `Expected backlobe <= -10.0 dBi, got ${backLobe}`);
  });

  await t.test("UnifiedWorkspace(ranLanguage) indexes antenna files and exposes symbols", () => {
    const ws = new UnifiedWorkspace(ranLanguage);
    const uri = "file:///workspace/antennas/sector.adf";

    ws.setDocument(uri, SAMPLE_NSMA_ADF);
    assert.equal(ws.fileCount, 1);
    assert.ok(ws.hasDocument(uri));

    const deck = ws.getParsedModel<AntennaPatternDeck>(uri);
    assert.ok(deck);
    assert.equal(deck.model, "MSX-HEX-65-18");

    const found = ws.findSymbolsByName("MSX-HEX-65-18");
    assert.ok(found.length > 0, "Should index antenna model as symbol");
  });
});
