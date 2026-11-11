// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { getOpticalTopology, opticalLanguage, parseOpenRoadmTopology } from "../src/index.js";

const SAMPLE_OPENROADM_NETWORK = {
  "network-name": "US-NorthEast-ROADM-Ring",
  nodes: [
    {
      "node-id": "ROADM-NYC",
      name: "New York Hub",
      "node-type": "rdm",
      degrees: [
        { "degree-number": 1, "max-wavelengths": 96 },
        { "degree-number": 2, "max-wavelengths": 96 },
      ],
      srgs: [{ "srg-number": 1, "max-add-drop": 96, colorless: true, directionless: true, contentionless: true }],
      latitude: 40.7128,
      longitude: -74.006,
    },
    {
      "node-id": "ROADM-BOS",
      name: "Boston Hub",
      "node-type": "rdm",
      degrees: [
        { "degree-number": 1, "max-wavelengths": 96 },
        { "degree-number": 2, "max-wavelengths": 96 },
      ],
      srgs: [{ "srg-number": 1, "max-add-drop": 96, colorless: true, directionless: true, contentionless: false }],
      latitude: 42.3601,
      longitude: -71.0589,
    },
    {
      "node-id": "ILA-HARTFORD",
      name: "Hartford In-Line Amplifier",
      "node-type": "ila",
      degrees: [{ "degree-number": 1, "max-wavelengths": 96 }],
      latitude: 41.7658,
      longitude: -72.6734,
    },
  ],
  links: [
    {
      "link-id": "SPAN-NYC-HARTFORD",
      "source-node": "ROADM-NYC",
      "dest-node": "ILA-HARTFORD",
      "length-km": 180.0,
      "fiber-type": "SSMF",
      "loss-coef": 0.21,
      dispersion: 16.7,
      pmd: 0.04,
      gamma: 1.3,
      amplifiers: [
        { id: "EDFA-NYC-BOOSTER", type: "edfa", "gain-db": 15.0, "noise-figure-db": 5.0, "max-power-dbm": 21.0 },
      ],
      srlg: ["SRLG-I95-CORRIDOR"],
    },
    {
      "link-id": "SPAN-HARTFORD-BOS",
      "source-node": "ILA-HARTFORD",
      "dest-node": "ROADM-BOS",
      "length-km": 160.0,
      "fiber-type": "SSMF",
      "loss-coef": 0.2,
      dispersion: 16.7,
      pmd: 0.04,
      gamma: 1.3,
      amplifiers: [
        { id: "EDFA-HARTFORD-PRE", type: "edfa", "gain-db": 18.0, "noise-figure-db": 5.2, "max-power-dbm": 21.0 },
      ],
      srlg: ["SRLG-MASS-PIKE"],
    },
  ],
  channels: [
    {
      "service-name": "SERVICE-100G-NYC-BOS",
      "source-node": "ROADM-NYC",
      "dest-node": "ROADM-BOS",
      "frequency-thz": 193.1,
      "baud-rate": 64,
      modulation: "PM-16QAM",
      "launch-power-dbm": 1.0,
      "required-osnr-db": 16.5,
      path: ["SPAN-NYC-HARTFORD", "SPAN-HARTFORD-BOS"],
    },
  ],
};

test("OpenROADM MSA & GNPy network parser and indexer", async (t) => {
  await t.test("parses multi-degree ROADM topology and spans", () => {
    const topo = parseOpenRoadmTopology(SAMPLE_OPENROADM_NETWORK);
    assert.equal(topo.name, "US-NorthEast-ROADM-Ring");
    assert.equal(topo.nodes.size, 3);
    assert.equal(topo.spans.size, 2);
    assert.equal(topo.channels.size, 1);

    const nycNode = topo.getNode("ROADM-NYC");
    assert.ok(nycNode);
    assert.equal(nycNode.nodeType, "rdm");
    assert.equal(nycNode.degrees.length, 2);
    assert.equal(nycNode.srgs[0].isContentionless, true);

    const span1 = topo.getSpan("SPAN-NYC-HARTFORD");
    assert.ok(span1);
    assert.equal(span1.lengthKm, 180.0);
    assert.equal(span1.attenuationDbPerKm, 0.21);
    assert.deepEqual(span1.srlgIds, ["SRLG-I95-CORRIDOR"]);

    const ch = topo.channels.get("SERVICE-100G-NYC-BOS");
    assert.ok(ch);
    assert.equal(ch.modulation, "PM-16QAM");
    assert.equal(ch.pathSpanIds.length, 2);
  });

  await t.test("indexes OpenROADM topologies in UnifiedWorkspace", () => {
    const ws = new UnifiedWorkspace(opticalLanguage);
    const uri = "file:///workspace/northeast_roadm.json";

    ws.setDocument(uri, JSON.stringify(SAMPLE_OPENROADM_NETWORK));
    assert.equal(ws.fileCount, 1);

    const topo = getOpticalTopology(ws, uri);
    assert.ok(topo);
    assert.equal(topo.name, "US-NorthEast-ROADM-Ring");

    const found = ws.findSymbolsByName("New York Hub");
    assert.ok(found.length > 0, "Should index node name as symbol");
  });
});
