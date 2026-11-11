// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FiberErrorCode, lintFiberNetwork, parseFiberGis, type FiberDiagnostic } from "../src/index.js";

const VALID_OSP_GEOJSON = {
  name: "Clean-FTTx-Network",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.9851, 40.7488] },
      properties: { id: "CO_1", name: "Central Office 1", "node-type": "central-office" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.98, 40.752] },
      properties: { id: "POLE_1", name: "Utility Pole 1", "node-type": "pole" },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-73.9851, 40.7488],
          [-73.98, 40.752],
        ],
      },
      properties: {
        id: "CABLE_1",
        name: "Distribution Cable 1",
        from: "CO_1",
        to: "POLE_1",
        strands: 24,
        length: 250,
        slack: 10,
        "helix-factor": 1.02,
      },
    },
  ],
  splices: [
    {
      id: "SPLICE_1",
      closure: "POLE_1",
      tray: 1,
      in: "CABLE_1",
      "in-strand": 1,
      out: "CABLE_1",
      "out-strand": 2,
      type: "fusion",
      loss: 0.05,
    },
  ],
};

const INVALID_OSP_GEOJSON = {
  name: "Faulty-FTTx-Network",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [200.0, 95.0] }, // invalid lon > 180, lat > 90
      properties: { id: "BAD_NODE", name: "Bad Node", "node-type": "manhole" },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [200.0, 95.0],
          [200.1, 95.1],
        ],
      },
      properties: {
        id: "BAD_CABLE",
        name: "Broken Cable",
        from: "BAD_NODE",
        to: "NON_EXISTENT_NODE", // unresolved node
        strands: 17, // 17 is not divisible by 12 fibers/tube
        length: 1500, // excessive span length > 300m
        slack: 0,
        "helix-factor": 1.0,
      },
    },
  ],
  splices: [
    {
      id: "BAD_SPLICE",
      closure: "BAD_NODE",
      tray: 1,
      in: "BAD_CABLE",
      "in-strand": 1,
      out: "BAD_CABLE",
      "out-strand": 2,
      type: "fusion",
      loss: 0.45, // fusion loss 0.45 exceeds 0.1 dB limit
    },
  ],
};

describe("Fiber Outside Plant Linter & Diagnostic Suite (@modelscript/fiber)", () => {
  it("validates compliant outside plant network without diagnostics", () => {
    const network = parseFiberGis(VALID_OSP_GEOJSON);
    const diags: FiberDiagnostic[] = lintFiberNetwork(network);
    const errors = diags.filter((d) => d.severity === "error");
    assert.equal(errors.length, 0, "Valid network should produce 0 error diagnostics");
  });

  it("detects invalid coordinates (FIBER1006)", () => {
    const network = parseFiberGis(INVALID_OSP_GEOJSON);
    const diags = lintFiberNetwork(network);
    const coordDiag = diags.find((d) => d.code === FiberErrorCode.INVALID_COORDINATES.code);
    assert.ok(coordDiag, "Should detect out-of-range coordinates FIBER1006");
    assert.equal(coordDiag.severity, "error");
    assert.equal(coordDiag.elementId, "BAD_NODE");
  });

  it("detects unresolved node references (FIBER1002)", () => {
    const network = parseFiberGis(INVALID_OSP_GEOJSON);
    const diags = lintFiberNetwork(network);
    const nodeDiag = diags.find(
      (d) => d.code === FiberErrorCode.UNRESOLVED_NODE_REFERENCE.code && d.message.includes("NON_EXISTENT_NODE"),
    );
    assert.ok(nodeDiag, "Should flag missing node reference FIBER1002");
    assert.equal(nodeDiag.severity, "error");
  });

  it("detects excessive span length (FIBER1001)", () => {
    const network = parseFiberGis(INVALID_OSP_GEOJSON);
    const diags = lintFiberNetwork(network, { maxAerialSpanMeters: 300 });
    const spanDiag = diags.find((d) => d.code === FiberErrorCode.EXCESSIVE_SPAN_LENGTH.code);
    assert.ok(spanDiag, "Should flag excessive span length FIBER1001");
    assert.equal(spanDiag.severity, "warning");
    assert.equal(spanDiag.elementId, "BAD_CABLE");
  });

  it("detects invalid strand count not multiple of fibers per tube (FIBER1004)", () => {
    const network = parseFiberGis(INVALID_OSP_GEOJSON);
    const diags = lintFiberNetwork(network);
    const strandDiag = diags.find((d) => d.code === FiberErrorCode.INVALID_STRAND_COUNT.code);
    assert.ok(strandDiag, "Should flag non-standard strand count FIBER1004");
    assert.equal(strandDiag.severity, "error");
  });

  it("detects excessive fusion splice loss (FIBER1003)", () => {
    const network = parseFiberGis(INVALID_OSP_GEOJSON);
    const diags = lintFiberNetwork(network, { maxSpliceLossFusionDb: 0.1 });
    const spliceDiag = diags.find((d) => d.code === FiberErrorCode.EXCESSIVE_SPLICE_LOSS.code);
    assert.ok(spliceDiag, "Should flag high loss splice FIBER1003");
    assert.equal(spliceDiag.severity, "warning");
    assert.equal(spliceDiag.elementId, "BAD_SPLICE");
  });
});
