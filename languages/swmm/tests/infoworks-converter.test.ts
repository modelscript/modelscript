// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { parseInfoWorksDatabase, serializeSwmm, type InfoWorksTableRows } from "../src/index.js";

describe("SWMM Legacy Incumbent Converter: Autodesk / Innovyze InfoWorks ICM", () => {
  it("1. Parses in-memory InfoWorks ICM table dictionaries", () => {
    const tables: InfoWorksTableRows = {
      hw_node: [
        { node_id: "MH_100", ground_level: 25.5, chamber_floor: 22.0, node_type: "MANHOLE" },
        { node_id: "MH_101", ground_level: 24.0, chamber_floor: 20.5, node_type: "MANHOLE" },
        { node_id: "OUTFALL_RIVER", ground_level: 18.0, chamber_floor: 17.5, node_type: "OUTFALL" },
      ],
      hw_conduit: [
        {
          conduit_id: "SEWER_LINE_1",
          us_node_id: "MH_100",
          ds_node_id: "MH_101",
          length: 85.0,
          conduit_width: 0.6,
          conduit_height: 0.6,
          conduit_shape: "CIRCULAR",
          roughness: 0.013,
        },
        {
          conduit_id: "BOX_CULVERT_2",
          us_node_id: "MH_101",
          ds_node_id: "OUTFALL_RIVER",
          length: 120.0,
          conduit_width: 1.5,
          conduit_height: 1.0,
          conduit_shape: "RECTANGULAR",
          roughness: 0.015,
        },
      ],
      hw_subcatchment: [
        {
          subcatchment_id: "CATCH_URBAN_NORTH",
          outlet_node_id: "MH_100",
          total_area: 4.5, // 4.5 ha
          impervious_percent: 65.0,
          catchment_width: 150.0,
          catchment_slope: 1.5,
        },
      ],
      hw_weir: [
        {
          weir_id: "CSO_OVERFLOW_WEIR",
          us_node_id: "MH_101",
          ds_node_id: "OUTFALL_RIVER",
          crest: 22.5,
          discharge_coeff: 0.58,
        },
      ],
      hw_pump: [
        {
          pump_id: "LIFT_STATION_PUMP",
          us_node_id: "MH_100",
          ds_node_id: "MH_101",
        },
      ],
    };

    const deck = parseInfoWorksDatabase(tables);

    // Verify junctions
    assert.strictEqual(deck.junctions.size, 2);
    const mh100 = deck.junctions.get("MH_100");
    assert.ok(mh100);
    assert.strictEqual(mh100.elevation, 22.0);
    assert.strictEqual(mh100.maxDepth, 3.5); // 25.5 - 22.0

    // Verify outfall
    assert.strictEqual(deck.outfalls.size, 1);
    assert.ok(deck.outfalls.has("OUTFALL_RIVER"));

    // Verify conduits and cross sections
    assert.strictEqual(deck.conduits.size, 2);
    assert.strictEqual(deck.crossSections.size, 2);

    const c1 = deck.conduits.get("SEWER_LINE_1")!;
    assert.strictEqual(c1.inletNode, "MH_100");
    assert.strictEqual(c1.outletNode, "MH_101");
    assert.strictEqual(c1.length, 85.0);

    const xs1 = deck.crossSections.get("SEWER_LINE_1")!;
    assert.strictEqual(xs1.shape, "CIRCULAR");
    assert.strictEqual(xs1.geom1, 0.6);

    const xs2 = deck.crossSections.get("BOX_CULVERT_2")!;
    assert.strictEqual(xs2.shape, "RECT_CLOSED");
    assert.strictEqual(xs2.geom1, 1.0);
    assert.strictEqual(xs2.geom2, 1.5);

    // Verify subcatchment
    assert.strictEqual(deck.subcatchments.size, 1);
    const sc = deck.subcatchments.get("CATCH_URBAN_NORTH")!;
    assert.strictEqual(sc.outlet, "MH_100");
    assert.strictEqual(sc.area, 4.5);
    assert.strictEqual(sc.impervPct, 65.0);

    // Verify weir and pump
    assert.strictEqual(deck.weirs.size, 1);
    assert.strictEqual(deck.pumps.size, 1);

    // Roundtrip serialize to valid SWMM .inp
    const inpText = serializeSwmm(deck);
    assert.ok(inpText.includes("[JUNCTIONS]"));
    assert.ok(inpText.includes("MH_100"));
    assert.ok(inpText.includes("[CONDUITS]"));
    assert.ok(inpText.includes("SEWER_LINE_1"));
    assert.ok(inpText.includes("[SUBCATCHMENTS]"));
    assert.ok(inpText.includes("CATCH_URBAN_NORTH"));
  });

  it("2. Reads and converts real InfoWorks ICM SQLite file via node:sqlite", () => {
    const scratchDir = path.join(process.cwd(), "languages", "swmm", "tests", ".scratch");
    fs.mkdirSync(scratchDir, { recursive: true });
    const sqlitePath = path.join(scratchDir, "infoworks_network.sqlite");

    try {
      const db = new DatabaseSync(sqlitePath);

      db.exec(`
        CREATE TABLE hw_node (node_id TEXT PRIMARY KEY, chamber_floor REAL, ground_level REAL, node_type TEXT);
        INSERT INTO hw_node VALUES ('Node_A', 15.0, 18.0, 'MANHOLE'), ('Node_Outfall', 10.0, 12.0, 'OUTFALL');

        CREATE TABLE hw_conduit (conduit_id TEXT PRIMARY KEY, us_node_id TEXT, ds_node_id TEXT, length REAL, conduit_width REAL, roughness REAL);
        INSERT INTO hw_conduit VALUES ('Trunk_1', 'Node_A', 'Node_Outfall', 200.0, 0.9, 0.012);
      `);
      db.close();

      const deck = parseInfoWorksDatabase(sqlitePath);
      assert.strictEqual(deck.junctions.size, 1);
      assert.strictEqual(deck.outfalls.size, 1);
      assert.strictEqual(deck.conduits.size, 1);
      assert.ok(deck.junctions.has("Node_A"));
      assert.ok(deck.outfalls.has("Node_Outfall"));
      assert.ok(deck.conduits.has("Trunk_1"));
    } finally {
      if (fs.existsSync(sqlitePath)) {
        fs.unlinkSync(sqlitePath);
      }
      if (fs.existsSync(scratchDir)) {
        fs.rmdirSync(scratchDir);
      }
    }
  });
});
