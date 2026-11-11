// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import {
  createSorDocument,
  getOpticalSorDocument,
  opticalLanguage,
  parseSor,
  setOpticalSorDocument,
  writeSor,
  type SorDocument,
  type SorKeyEvent,
} from "../src/index.js";

test("Telcordia/Bellcore .sor binary codec and metrics", async (t) => {
  const numPoints = 500;
  const powerDb = new Float64Array(numPoints);
  const distanceMeters = new Float64Array(numPoints);

  // Simulate a 10 km fiber span with 0.20 dB/km slope, a 0.1 dB splice at 5 km, and end at 10 km
  const totalLengthMeters = 10000;
  const stepMeters = totalLengthMeters / numPoints;
  for (let i = 0; i < numPoints; i++) {
    const d = i * stepMeters;
    distanceMeters[i] = d;
    let attenuation = (d / 1000) * 0.2; // 0.20 dB/km
    if (d >= 5000) attenuation += 0.1; // splice loss
    powerDb[i] = 30.0 - attenuation; // 30 dB reference backscatter
  }

  const events: SorKeyEvent[] = [
    {
      eventNumber: 1,
      distanceMeters: 0,
      slopeDbPerKm: 0.2,
      eventLossDb: 0.25,
      reflectanceDb: -42.5,
      eventCode: "1999",
      eventType: "reflective",
      leadInLossDb: 0.25,
      comments: "Launch connector",
    },
    {
      eventNumber: 2,
      distanceMeters: 5000,
      slopeDbPerKm: 0.195,
      eventLossDb: 0.08,
      reflectanceDb: Number.NEGATIVE_INFINITY,
      eventCode: "0999",
      eventType: "non-reflective",
      leadInLossDb: 1.33,
      comments: "Fusion splice enclosure #4",
    },
    {
      eventNumber: 3,
      distanceMeters: 10000,
      slopeDbPerKm: 0.2,
      eventLossDb: 2.1,
      reflectanceDb: -28.0,
      eventCode: "2999",
      eventType: "end-of-fiber",
      leadInLossDb: 2.45,
      comments: "End of fiber / Remote terminal ODF",
    },
  ];

  const mockDoc: SorDocument = createSorDocument(
    "2.0",
    [],
    {
      cableId: "CABLE-METRO-EAST-01",
      fiberId: "STRAND-12",
      fiberType: "G.652.D",
      nominalWavelengthNm: 1550,
      originLocation: "CentralOffice_Alpha",
      terminateLocation: "CellSite_Bravo",
      cableCode: "OSP-48F",
      currentCondition: "BC",
      operator: "FieldTech_99",
      comments: "Pre-commissioning baseline",
    },
    {
      supplierName: "ModelScript Optical",
      otdrName: "MSX-OTDR-1000",
      otdrSerialNumber: "SN-2026-9988",
      moduleName: "SM-1550-HD",
      moduleSerialNumber: "MOD-4411",
      softwareVersion: "v1.4.0",
    },
    {
      dateTime: new Date("2026-11-09T00:00:00Z"),
      distanceUnits: "km",
      actualWavelengthNm: 1550.0,
      acquisitionOffset: 0,
      pulseWidthNs: 100,
      sampleSpacingNs: 200.0,
      numPoints,
      refractiveIndex: 1.4682,
      backscatterCoefficientDb: -79.0,
      numAverages: 5000,
      rangeKm: 20.0,
      frontPanelLossDb: 0.15,
    },
    {
      numPoints,
      scalingFactor: 1000,
      powerDb,
      distanceMeters,
    },
    events,
    4242,
  );

  await t.test("serializes and parses Telcordia .sor binary", () => {
    const binaryData = writeSor(mockDoc);
    assert.ok(binaryData.byteLength > 500, "Serialized binary should have non-trivial size");

    const parsed = parseSor(binaryData);
    assert.equal(parsed.version, "2.0");
    assert.equal(parsed.genParams.cableId, "CABLE-METRO-EAST-01");
    assert.equal(parsed.genParams.fiberId, "STRAND-12");
    assert.equal(parsed.genParams.nominalWavelengthNm, 1550);
    assert.equal(parsed.supParams.supplierName, "ModelScript Optical");
    assert.equal(parsed.fxdParams.refractiveIndex, 1.4682);
    assert.equal(parsed.dataPoints.numPoints, numPoints);

    // Verify key events
    assert.equal(parsed.keyEvents.length, 3);
    assert.equal(parsed.keyEvents[0].eventType, "reflective");
    assert.equal(parsed.keyEvents[0].comments, "Launch connector");
    assert.equal(parsed.keyEvents[1].eventType, "non-reflective");
    assert.equal(parsed.keyEvents[2].eventType, "end-of-fiber");
  });

  await t.test("computes attenuation, LSA slope, and span metrics accurately", () => {
    const binaryData = writeSor(mockDoc);
    const parsed = parseSor(binaryData);

    const twoPtLoss = parsed.computeTwoPointLoss(1000, 4000);
    // Over 3 km, at 0.20 dB/km, expected loss is ~0.60 dB
    assert.ok(Math.abs(twoPtLoss - 0.6) < 0.05, `Expected ~0.60 dB two-point loss, got ${twoPtLoss}`);

    const lsaSlope = parsed.computeLsaSlope(500, 4500);
    // Expected slope is ~0.20 dB/km
    assert.ok(Math.abs(lsaSlope - 0.2) < 0.02, `Expected ~0.20 dB/km LSA slope, got ${lsaSlope}`);

    const fiberLength = parsed.fiberLengthMeters();
    assert.ok(Math.abs(fiberLength - 10000) < 100, `Expected ~10000m length, got ${fiberLength}`);
  });

  await t.test("UnifiedWorkspace indexes .sor files and exposes symbols", () => {
    const binaryData = writeSor(mockDoc);
    const ws = new UnifiedWorkspace(opticalLanguage);
    const uri = "file:///workspace/metro_span.sor";

    setOpticalSorDocument(ws, uri, binaryData);
    assert.equal(ws.fileCount, 1);
    assert.ok(ws.hasDocument(uri));

    const sorDoc = getOpticalSorDocument(ws, uri);
    assert.ok(sorDoc);
    assert.equal(sorDoc.genParams.cableId, "CABLE-METRO-EAST-01");

    const syms = ws.findSymbolsByName("STRAND-12");
    assert.ok(syms.length > 0, "Should index fiberId as symbol");
  });
});
