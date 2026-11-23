// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";
import { exportCanvasToSspXml } from "../src/schema/serializer.js";
import { resolveAnchorWorldPoint, type Mat4 } from "../src/threads/anchor-projector.js";
import { synthesizeThreadsForCanvas } from "../src/threads/thread-synthesizer.js";
import { computeCanvasBlastRadius, routeCanvasWire, validateFmiWire } from "../src/threads/wire-router.js";

describe("Live Visual Threads, Anchor Projection, FMI Validation & Blast Radius", () => {
  test("projects 3D STEP feature pins to 2D tile coordinates and collapses at macro LOD", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const stepTile = board.tiles.tile_step!;
    const identityMat4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    const livePin = resolveAnchorWorldPoint(stepTile, "body.mass", {
      isSource: true,
      lod: "interactive",
      cad3DCtx: { viewProjectionMatrix: identityMat4 },
    });
    // model3DPosition is [0, 0.2, 0] -> NDC x=0 (center of tile width), y=0.2 (40% down content area)
    assert.ok(Math.abs(livePin.world.x - (stepTile.bounds.x + stepTile.bounds.width * 0.5)) < 1e-6);
    assert.equal(livePin.clamped, false);

    // At macro LOD, collapses cleanly to top perimeter edge
    const macroPin = resolveAnchorWorldPoint(stepTile, "body.mass", {
      isSource: true,
      lod: "macro",
      cad3DCtx: { viewProjectionMatrix: identityMat4 },
    });
    assert.equal(macroPin.world.y, stepTile.bounds.y);
  });

  test("clamps scrolled ReqIF table row anchors to tile boundaries", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const reqTile = board.tiles.tile_reqif!;
    const scrolled = resolveAnchorWorldPoint(reqTile, "REQ-014", {
      isSource: false,
      lod: "interactive",
      tableCtx: { headerHeightPx: 64, rowHeightPx: 32, scrollTopPx: 500 },
    });
    assert.equal(scrolled.clamped, true);
    assert.equal(scrolled.world.y, reqTile.bounds.y + 64);
  });

  test("validates FMI wire causality, data types, and suggests physical unit conversions", () => {
    const degOut = {
      path: "theta",
      label: "theta",
      kind: "fmi-output" as const,
      dataType: "Real" as const,
      unit: "deg",
    };
    const radIn = { path: "phi", label: "phi", kind: "fmi-input" as const, dataType: "Real" as const, unit: "rad" };

    const res = validateFmiWire(degOut, radIn);
    assert.equal(res.valid, true);
    assert.equal(res.status, "unit-mismatch");
    assert.ok(res.suggestedTransformExpr?.includes("0.017453"));

    // Invalid causality: input -> output
    const bad = validateFmiWire(radIn, degOut);
    assert.equal(bad.valid, false);
    assert.equal(bad.status, "conflict");
    assert.equal(bad.errors.length, 2);
  });

  test("routes FMI orthogonal pipes and Digital Thread bezier ribbons cleanly", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const wire = board.wires.wire_fmi_cmd!;
    const src = resolveAnchorWorldPoint(board.tiles.tile_simulink!, wire.source.anchorPath, { isSource: true });
    const dst = resolveAnchorWorldPoint(board.tiles.tile_modelica!, wire.target.anchorPath, { isSource: false });
    const fmiGeom = routeCanvasWire(wire, src, dst);
    assert.ok(fmiGeom.svgPath.startsWith("M "));
    assert.ok(fmiGeom.svgPath.includes(" L "));

    const paramWire = board.wires.wire_param_mass!;
    const pSrc = resolveAnchorWorldPoint(board.tiles.tile_step!, paramWire.source.anchorPath, { isSource: true });
    const pDst = resolveAnchorWorldPoint(board.tiles.tile_modelica!, paramWire.target.anchorPath, { isSource: false });
    const paramGeom = routeCanvasWire(paramWire, pSrc, pDst);
    assert.ok(paramGeom.svgPath.includes(" C "));
  });

  test("synthesizes ThreadHypergraph alignments without clobbering user FMI wires", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const merged = synthesizeThreadsForCanvas(board, [
      {
        slot: 42,
        relation: "aligned",
        status: "conflict",
        liveValue: "1.4 vs 1.9 K/W",
        endpoints: [
          { artifactUri: "ecad/driver_board.kicad_pcb", anchorPath: "board.R_th" },
          { artifactUri: "models/ActuatorPlant.mo", anchorPath: "thermal.R_th" },
        ],
      },
    ]);

    // User-authored FMI wires are preserved
    assert.ok(merged.wire_fmi_cmd);
    assert.ok(merged.wire_fmi_fb);
    // New conflict thread synthesized between KiCad and Modelica
    const synthesized = Object.values(merged).find((w) => w.threadSlot === 42);
    assert.ok(synthesized);
    assert.equal(synthesized.status, "conflict");
    assert.equal(synthesized.source.tileId, "tile_kicad");
    assert.equal(synthesized.target.tileId, "tile_modelica");
  });

  test("computes causal Blast Radius across the 6-artifact board and exports SSP XML", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const blast = computeCanvasBlastRadius(board, "tile_step", "body.mass");

    assert.equal(blast.tileDistances.tile_step, 0);
    assert.equal(blast.tileDistances.tile_modelica, 1);
    assert.equal(blast.tileDistances.tile_reqif, 1);
    assert.equal(blast.tileDistances.tile_montecarlo, 1);
    // Reaches Simulink via Modelica feedback wire at hop 2
    assert.equal(blast.tileDistances.tile_simulink, 2);

    const sspXml = exportCanvasToSspXml(board);
    assert.ok(sspXml.includes("<ssd:SystemStructureDescription"));
    assert.ok(sspXml.includes('startElement="tile_simulink" startConnector="u_cmd"'));
    assert.ok(sspXml.includes('endElement="tile_modelica" endConnector="motor.u"'));
  });
});
