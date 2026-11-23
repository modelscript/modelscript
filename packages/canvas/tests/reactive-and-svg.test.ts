// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";
import { exportCanvasToSvg } from "../src/schema/svg-export.js";
import { propagateParameterEdit } from "../src/threads/reactive-propagator.js";

describe("Reactive Parameter Propagation & Vector SVG Export", () => {
  test("propagates STEP housing mass change to Modelica and flips ReqIF REQ-014 to FAIL when exceeding 2.5 kg", () => {
    const board = createCanonicalPolyglotDemoBoard();

    // Increase housing mass from 2.14 kg -> 2.75 kg (exceeds REQ-014 <= 2.5 kg)
    const result = propagateParameterEdit(board, {
      tileId: "tile_step",
      anchorPath: "body.mass",
      numericValue: 2.75,
      autoSync: true,
    });

    assert.equal(result.document.tiles.tile_step?.pinnedAnchors?.[0]?.currentValue, "2.75 kg");
    // Modelica housing.mass synced automatically
    const modelicaMass = result.document.tiles.tile_modelica?.pinnedAnchors?.find((a) => a.path === "housing.mass");
    assert.equal(modelicaMass?.currentValue, "2.75 kg");

    // ReqIF REQ-014 flips to FAIL and marks wire_req_mass as conflict
    assert.deepEqual(result.failedRequirements, ["REQ-014"]);
    const req014 = result.document.tiles.tile_reqif?.pinnedAnchors?.find((a) => a.path === "REQ-014");
    assert.equal(req014?.currentValue, "FAIL (2.75 kg)");
    assert.equal(result.document.tiles.tile_reqif?.health, "error");
    assert.equal(result.document.wires.wire_req_mass?.status, "conflict");
  });

  test("marks downstream tiles and wires stale when autoSync is disabled", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const result = propagateParameterEdit(board, {
      tileId: "tile_step",
      anchorPath: "body.mass",
      numericValue: 2.3,
      autoSync: false,
    });

    assert.equal(result.document.wires.wire_param_mass?.status, "stale");
    assert.equal(result.document.tiles.tile_modelica?.health, "stale");
    assert.equal(result.failedRequirements.length, 0);
  });

  test("exports a standalone vector SVG containing all frames, 6 tiles, wires, and legend", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const svg = exportCanvasToSvg(board);

    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes('data-tile-id="tile_modelica"'));
    assert.ok(svg.includes('data-tile-id="tile_simulink"'));
    assert.ok(svg.includes('data-tile-id="tile_kicad"'));
    assert.ok(svg.includes('data-tile-id="tile_step"'));
    assert.ok(svg.includes('data-tile-id="tile_reqif"'));
    assert.ok(svg.includes('data-tile-id="tile_montecarlo"'));
    assert.ok(svg.includes('data-wire-id="wire_fmi_cmd"'));
    assert.ok(svg.includes('data-role="legend"'));
    assert.ok(svg.trimEnd().endsWith("</svg>"));
  });
});
