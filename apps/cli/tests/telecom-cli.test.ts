// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSorDocument, writeSor } from "@modelscript/optical";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { FiberCommand } from "../src/commands/fiber.js";
import { OpticalCommand } from "../src/commands/optical.js";
import { RanCommand } from "../src/commands/ran.js";

test("Telecom Utilities CLI Commands Suite (optical, ran, fiber)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_telecom_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  // Generate synthetic .sor trace file
  const sorFile = path.join(tmpDir, "test_trace.sor");
  const doc = createSorDocument(
    "2.0",
    [],
    {
      cableId: "CLI-TRUNK-01",
      fiberId: "STRAND-1",
      fiberType: "G.652.D",
      nominalWavelengthNm: 1550,
      originLocation: "CentralOffice-A",
      terminateLocation: "CellSite-B",
      cableCode: "OSP-48F",
      currentCondition: "Good",
      operator: "CLI-Tester",
      comments: "Automated CLI integration test",
    },
    {
      supplierName: "Viavi",
      otdrName: "SmartOTDR",
      otdrSerialNumber: "SN-987",
      moduleName: "1550nm",
      moduleSerialNumber: "MOD-02",
      softwareVersion: "2.1",
    },
    {
      dateTime: new Date("2026-11-09T00:00:00Z"),
      distanceUnits: "km",
      actualWavelengthNm: 1550,
      acquisitionOffset: 0,
      pulseWidthNs: 50,
      sampleSpacingNs: 1.0,
      numPoints: 50,
      refractiveIndex: 1.4682,
      backscatterCoefficientDb: -79.0,
      numAverages: 500,
      rangeKm: 5.0,
      frontPanelLossDb: 0.1,
    },
    {
      numPoints: 50,
      scalingFactor: 1000,
      powerDb: new Float64Array(50),
      distanceMeters: new Float64Array(50),
    },
    [
      {
        eventNumber: 1,
        distanceMeters: 2500,
        slopeDbPerKm: 0.2,
        eventLossDb: 0.12,
        reflectanceDb: -58.0,
        eventCode: "0999",
        eventType: "non-reflective",
        leadInLossDb: 0.5,
        comments: "Splice enclosure #1",
      },
      {
        eventNumber: 2,
        distanceMeters: 5000,
        slopeDbPerKm: 0.2,
        eventLossDb: 1.5,
        reflectanceDb: -28.0,
        eventCode: "2999",
        eventType: "end-of-fiber",
        leadInLossDb: 1.0,
        comments: "Patch panel B",
      },
    ],
  );
  fs.writeFileSync(sorFile, writeSor(doc));

  // Generate synthetic GeoJSON fiber route file
  const geojsonFile = path.join(tmpDir, "route.geojson");
  const sampleGeoJson = {
    type: "FeatureCollection",
    name: "MetroTrunkRoute",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-74.006, 40.7128] },
        properties: { id: "CO-1", name: "Central Office Manhattan", "node-type": "central-office" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-74.016, 40.7228] },
        properties: { id: "MH-1", name: "Splice Manhole Broadway", "node-type": "manhole" },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-74.006, 40.7128],
            [-74.016, 40.7228],
            [-74.026, 40.7328],
          ],
        },
        properties: {
          id: "CABLE-TRUNK-A",
          name: "Trunk Cable Alpha",
          fromNodeId: "CO-1",
          toNodeId: "MH-1",
          strandCount: 72,
          fibersPerTube: 12,
          fiberType: "G.652.D",
          sheathLengthMeters: 2500,
          slackLengthMeters: 50,
          helixFactor: 1.03,
          conduitId: "CONDUIT-BROADWAY",
        },
      },
    ],
  };
  fs.writeFileSync(geojsonFile, JSON.stringify(sampleGeoJson, null, 2), "utf-8");

  await t.test("msx optical inspect / otdr", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (OpticalCommand.handler as any)({
        action: "inspect",
        files: [sorFile],
      });
      assert.ok(logs.some((l) => l.includes("Telcordia GR-196 / SR-4731 OTDR Trace")));
      assert.ok(logs.some((l) => l.includes("CLI-TRUNK-01")));
      assert.ok(logs.some((l) => l.includes("PASS (Telcordia GR-196-CORE Compliant)")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx optical gsnr solver", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (OpticalCommand.handler as any)({
        action: "gsnr",
        distance: 240,
        "span-len": 80,
        baud: 64,
        power: 0.0,
        "edfa-nf": 5.5,
        fiber: "SSMF",
      });
      assert.ok(logs.some((l) => l.includes("DWDM Generalized Optical Transmission Solver")));
      assert.ok(logs.some((l) => l.includes("Accumulated GSNR:")));
      assert.ok(logs.some((l) => l.includes("✓ FEASIBLE")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx optical to-dae EDFA lowering", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (OpticalCommand.handler as any)({
        action: "to-dae",
      });
      assert.ok(logs.some((l) => l.includes("Lowered Dynamic EDFA to Linear DAE Arena")));
      assert.ok(logs.some((l) => l.includes("Equations Count:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ran microwave budget", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (RanCommand.handler as any)({
        action: "microwave",
        freq: 11.0,
        dist: 12.0,
        "tx-power": 18.0,
        "tx-gain": 38.0,
        "rx-gain": 38.0,
        "rain-rate": 42.0,
        "rx-threshold": -72.0,
        polarization: "V",
      });
      assert.ok(logs.some((l) => l.includes("Line-of-Sight Microwave Link Budget")));
      assert.ok(logs.some((l) => l.includes("Free Space Path Loss:")));
      assert.ok(logs.some((l) => l.includes("Five-Nines Verdict:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ran fresnel clearance", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (RanCommand.handler as any)({
        action: "fresnel",
        freq: 11.0,
        dist: 15.0,
        "tx-height": 45.0,
        "rx-height": 35.0,
        "obstacle-dist": 7.5,
        "obstacle-elev": 10.0,
      });
      assert.ok(logs.some((l) => l.includes("Microwave Fresnel Clearance Profile")));
      assert.ok(logs.some((l) => l.includes("Midpoint 1st Fresnel F1:")));
      assert.ok(logs.some((l) => l.includes("Clearance Ratio (F1):")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx fiber color code", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (FiberCommand.handler as any)({
        action: "color",
        strand: 14,
      });
      assert.ok(logs.some((l) => l.includes("ANSI/TIA-598-D Color Code Assignment")));
      assert.ok(logs.some((l) => l.includes("Strand Index:  #14")));
      assert.ok(logs.some((l) => l.includes("Orange"))); // Fiber 2 in Tube 2 is Orange
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx fiber locate / otdr-fault", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (FiberCommand.handler as any)({
        action: "locate",
        files: [geojsonFile],
        distance: 1030,
        helix: 1.03,
      });
      assert.ok(logs.some((l) => l.includes("OTDR-to-GIS Precision Fault Localization")));
      assert.ok(logs.some((l) => l.includes("Physical Sheath Distance:")));
      assert.ok(logs.some((l) => l.includes("GPS Coordinate")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx fiber srlg audit", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await (FiberCommand.handler as any)({
        action: "srlg",
        files: [geojsonFile],
      });
      assert.ok(logs.some((l) => l.includes("Shared Risk Link Group (SRLG) Diversity Audit")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup scratch directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
