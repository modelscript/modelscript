// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { fiberLanguage, getFiberNetwork, parseFiberGis, resolveStrandColor } from "../src/index.js";

const SAMPLE_OSP_GEOJSON = {
  name: "Metro-FTTx-Feeder",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.9851, 40.7488] },
      properties: { id: "CO_MIDTOWN", name: "Midtown Central Office", "node-type": "central-office" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.98, 40.752] },
      properties: { id: "MH_42ND_5TH", name: "Manhole 42nd & 5th", "node-type": "manhole" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.975, 40.755] },
      properties: { id: "FST_LEXINGTON", name: "Splice Closure Lexington", "node-type": "splice-closure" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.97, 40.758] },
      properties: { id: "BLDG_GRAND_CENTRAL", name: "Grand Central Commercial", "node-type": "customer-premise" },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-73.9851, 40.7488],
          [-73.98, 40.752],
          [-73.975, 40.755],
        ],
      },
      properties: {
        id: "CABLE-FEEDER-144",
        name: "Midtown Feeder Cable",
        from: "CO_MIDTOWN",
        to: "FST_LEXINGTON",
        strands: 144,
        length: 2200,
        slack: 50,
        "helix-factor": 1.03,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-73.975, 40.755],
          [-73.97, 40.758],
        ],
      },
      properties: {
        id: "CABLE-DIST-24",
        name: "Grand Central Lateral",
        from: "FST_LEXINGTON",
        to: "BLDG_GRAND_CENTRAL",
        strands: 24,
        length: 800,
        slack: 20,
        "helix-factor": 1.02,
      },
    },
  ],
  splices: [
    {
      id: "SPLICE-FST-01",
      closure: "FST_LEXINGTON",
      tray: 1,
      in: "CABLE-FEEDER-144",
      "in-strand": 1,
      out: "CABLE-DIST-24",
      "out-strand": 1,
      type: "fusion",
      loss: 0.04,
    },
  ],
};

test("ANSI/TIA-598-D color code registry and OSP cadastre parser", async (t) => {
  await t.test("resolves TIA-598-D strand and buffer tube colors", () => {
    // Strand 1: Blue tube, Blue fiber
    const s1 = resolveStrandColor(1);
    assert.equal(s1.tubeColor.name, "Blue");
    assert.equal(s1.fiberColor.name, "Blue");
    assert.equal(s1.tubeHasStripe, false);

    // Strand 2: Blue tube, Orange fiber
    const s2 = resolveStrandColor(2);
    assert.equal(s2.tubeColor.name, "Blue");
    assert.equal(s2.fiberColor.name, "Orange");

    // Strand 12: Blue tube, Aqua fiber
    const s12 = resolveStrandColor(12);
    assert.equal(s12.tubeColor.name, "Blue");
    assert.equal(s12.fiberColor.name, "Aqua");

    // Strand 13: Orange tube, Blue fiber
    const s13 = resolveStrandColor(13);
    assert.equal(s13.tubeColor.name, "Orange");
    assert.equal(s13.fiberColor.name, "Blue");

    // Strand 72: Tube 6 (White), Fiber 12 (Aqua)
    const s72 = resolveStrandColor(72);
    assert.equal(s72.tubeNumber, 6);
    assert.equal(s72.tubeColor.name, "White");
    assert.equal(s72.fiberColor.name, "Aqua");

    // Strand 145: Tube 13 (Blue with stripe), Fiber 1 (Blue)
    const s145 = resolveStrandColor(145);
    assert.equal(s145.tubeNumber, 13);
    assert.equal(s145.tubeColor.name, "Blue");
    assert.equal(s145.tubeHasStripe, true);
  });

  await t.test("parses GeoJSON outside plant network", () => {
    const net = parseFiberGis(SAMPLE_OSP_GEOJSON);
    assert.equal(net.name, "Metro-FTTx-Feeder");
    assert.equal(net.nodes.size, 4);
    assert.equal(net.cables.size, 2);
    assert.equal(net.splices.length, 1);

    const co = net.getNode("CO_MIDTOWN");
    assert.ok(co);
    assert.equal(co.nodeType, "central-office");

    const feeder = net.getCable("CABLE-FEEDER-144");
    assert.ok(feeder);
    assert.equal(feeder.strandCount, 144);
    assert.equal(feeder.sheathLengthMeters, 2200);
  });

  await t.test("traces optical strand across cables and fusion splices", () => {
    const net = parseFiberGis(SAMPLE_OSP_GEOJSON);
    const trace = net.traceStrand("CABLE-FEEDER-144", 1);

    // Should include: Hop 1 (Feeder Strand 1) -> Hop 2 (Fusion Splice) -> Hop 3 (Lateral Strand 1)
    assert.equal(trace.length, 3);
    assert.equal(trace[0]?.cableId, "CABLE-FEEDER-144");
    assert.equal(trace[0]?.strandNumber, 1);
    assert.ok((trace[0]?.lengthMeters ?? 0) > 2200);

    assert.equal(trace[1]?.cableId, "Splice_FST_LEXINGTON");
    assert.equal(trace[1]?.lossDb, 0.04);

    assert.equal(trace[2]?.cableId, "CABLE-DIST-24");
    assert.equal(trace[2]?.strandNumber, 1);
  });

  await t.test("UnifiedWorkspace indexes OSP network and exposes symbols", () => {
    const ws = new UnifiedWorkspace(fiberLanguage);
    const uri = "file:///workspace/metro_osp.geojson";

    ws.setDocument(uri, JSON.stringify(SAMPLE_OSP_GEOJSON));
    assert.equal(ws.fileCount, 1);
    assert.ok(ws.hasDocument(uri));

    const net = getFiberNetwork(ws, uri);
    assert.ok(net);
    assert.equal(net.name, "Metro-FTTx-Feeder");

    const found = ws.findSymbolsByName("Midtown Feeder Cable");
    assert.ok(found.length > 0, "Should index cable as symbol");
  });
});
