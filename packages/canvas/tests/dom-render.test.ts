// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";
import { SpatialCanvas } from "../src/ui/SpatialCanvas.js";

describe("SpatialCanvas React DOM Rendering Verification", () => {
  test("renders all 6 polyglot tiles, visual threads, lens toolbar, co-sim controls, and minimap", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const html = renderToStaticMarkup(
      React.createElement(SpatialCanvas, {
        document: board,
        width: 1440,
        height: 900,
        onTileMove: () => undefined,
        onTileResize: () => undefined,
        onTileDrop: () => undefined,
        onWireCreate: () => undefined,
        onParameterEdit: () => undefined,
        onCommentCreate: () => undefined,
        onExportSsp: () => undefined,
      }),
    );

    assert.ok(html.includes('data-testid="polyglot-spatial-canvas"'));
    // All 6 canonical polyglot artifacts rendered
    assert.ok(html.includes('data-tile-id="tile_simulink"'));
    assert.ok(html.includes('data-tile-id="tile_modelica"'));
    assert.ok(html.includes('data-tile-id="tile_kicad"'));
    assert.ok(html.includes('data-tile-id="tile_step"'));
    assert.ok(html.includes('data-tile-id="tile_reqif"'));
    assert.ok(html.includes('data-tile-id="tile_montecarlo"'));

    // Visual threads, FMI signal pipes, and interactive controls rendered
    assert.ok(html.includes('id="wire-path-wire_fmi_cmd"'));
    assert.ok(html.includes('id="wire-path-wire_param_mass"'));
    assert.ok(html.includes("Blast Radius"));
    assert.ok(html.includes("▶ Run Co-Sim"));
    assert.ok(html.includes("+ Drop Artifact (106 langs)"));
    assert.ok(html.includes("Export .ssp"));
    assert.ok(html.includes("PASS (2.14 kg)"));
  });
});
