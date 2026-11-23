// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createCanonicalPolyglotDemoBoard } from "../src/schema/canvas-document.js";
import {
  deserializeCanvasDocument,
  serializeCanvasDocument,
  validateCanvasDocument,
} from "../src/schema/serializer.js";
import { POLYGLOT_LANGUAGE_CATALOG, TileAdapterRegistry } from "../src/tiles/registry.js";

describe("106-Language TileAdapterRegistry & .mscanvas Serialization", () => {
  test("registers all 106 ModelScript languages with unique IDs across 7 archetypes", () => {
    const registry = new TileAdapterRegistry();
    assert.equal(registry.getLanguageCount(), 106);

    const seenIds = new Set<string>();
    for (const entry of POLYGLOT_LANGUAGE_CATALOG) {
      assert.ok(!seenIds.has(entry.languageId), `Duplicate languageId: ${entry.languageId}`);
      seenIds.add(entry.languageId);
      assert.ok(registry.getAdapter(entry.archetype), `Missing adapter for archetype ${entry.archetype}`);
    }
  });

  test("routes canonical 6-artifact board file extensions to the right archetypes", () => {
    const registry = new TileAdapterRegistry();

    assert.equal(registry.resolveDescriptor(undefined, "models/ActuatorPlant.mo").archetype, "schematic");
    assert.equal(registry.resolveDescriptor(undefined, "controls/controller.slx").archetype, "schematic");
    assert.equal(registry.resolveDescriptor(undefined, "ecad/driver_board.kicad_pcb").archetype, "ecad");
    assert.equal(registry.resolveDescriptor(undefined, "cad/housing.step").archetype, "cad3d");
    assert.equal(registry.resolveDescriptor(undefined, "reqs/system.reqif").archetype, "table");
    assert.equal(registry.resolveDescriptor(undefined, "studies/thermal.ms-uq").archetype, "analytics");
    assert.equal(registry.resolveDescriptor(undefined, "plant/actuator.fmu").archetype, "fmu");

    // Compound extensions resolve accurately
    assert.equal(registry.resolveDescriptor(undefined, "scans/brain.nii.gz").languageId, "nifti");
    assert.equal(registry.resolveDescriptor(undefined, "compliance/ssp.oscal.json").languageId, "oscal");
  });

  test("serializes and deserializes the canonical 6-artifact board deterministically", () => {
    const board = createCanonicalPolyglotDemoBoard();
    assert.equal(Object.keys(board.tiles).length, 6);
    assert.equal(validateCanvasDocument(board).length, 0);

    const json1 = serializeCanvasDocument(board);
    const parsed = deserializeCanvasDocument(json1);
    const json2 = serializeCanvasDocument(parsed);

    assert.equal(json1, json2);
    assert.equal(parsed.tiles.tile_step?.languageId, "step");
    assert.equal(parsed.tiles.tile_montecarlo?.archetype, "analytics");
  });
});
