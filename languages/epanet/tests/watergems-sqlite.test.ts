// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { parseWaterGemsDatabase, serializeInp, type DatabaseTableRows } from "../src/index.js";

describe("EPANET Legacy Incumbent Converter: Bentley WaterGEMS & Innovyze InfoWater", () => {
  it("1. Parses in-memory Bentley WaterGEMS table dictionaries with label mappings", () => {
    const tableData: DatabaseTableRows = {
      HMIModelingElementPath: [
        { ID: 101, Label: "J_Highland" },
        { ID: 102, Label: "J_Downtown" },
        { ID: 201, Label: "P_Main_A" },
        { ID: 301, Label: "R_Clearwell" },
        { ID: 401, Label: "T_Standpipe" },
        { ID: 501, Label: "PU_Booster_1" },
        { ID: 601, Label: "PRV_Zone_East" },
      ],
      HMIJunction: [
        { ID: 101, Elevation: 250.5, Demand: 45.0, PatternID: "RESIDENTIAL" },
        { ID: 102, Elevation: 180.0, Demand: 120.0, PatternID: "COMMERCIAL" },
      ],
      HMIReservoir: [{ ID: 301, Elevation: 150.0, Head: 165.0 }],
      HMITank: [
        {
          ID: 401,
          Elevation: 280.0,
          OperatingLevelInitial: 12.0,
          OperatingLevelMinimum: 2.0,
          OperatingLevelMaximum: 25.0,
          Diameter: 40.0,
        },
      ],
      HMIPipe: [
        {
          ID: 201,
          StartNodeID: 101,
          StopNodeID: 102,
          Length: 1200.0,
          Diameter: 12.0,
          Roughness: 130.0,
          MinorLoss: 0.5,
          Status: "OPEN",
          HasCheckValve: 1, // HAMMER non-return valve
        },
      ],
      HMIPump: [
        {
          ID: 501,
          StartNodeID: 301,
          StopNodeID: 101,
          PumpDefinitionID: "CURVE_BOOSTER",
          Power: 75.0,
          Status: "OPEN",
        },
      ],
      HMIValve: [
        {
          ID: 601,
          StartNodeID: 102,
          StopNodeID: 101,
          Diameter: 8.0,
          ValveType: "PRV",
          Setting: 45.0,
        },
      ],
      HMICurvePoint: [
        { CurveID: "CURVE_BOOSTER", Flow: 0.0, Head: 120.0 },
        { CurveID: "CURVE_BOOSTER", Flow: 500.0, Head: 100.0 },
        { CurveID: "CURVE_BOOSTER", Flow: 1000.0, Head: 60.0 },
      ],
      HMIPattern: [
        {
          PatternID: "RESIDENTIAL",
          Mult_1: 0.6,
          Mult_2: 0.5,
          Mult_3: 0.7,
          Mult_4: 1.2,
        },
      ],
    };

    const net = parseWaterGemsDatabase(tableData, { flowUnits: "GPM" });

    // 1. Verify junctions and resolved labels
    assert.strictEqual(net.junctions.length, 2);
    const jHighland = net.junctions.find((j) => j.id === "J_Highland");
    assert.ok(jHighland, "J_Highland must be resolved from element label table");
    assert.strictEqual(jHighland.elevation, 250.5);
    assert.strictEqual(jHighland.demand, 45.0);

    // 2. Verify reservoir & tank
    assert.strictEqual(net.reservoirs.length, 1);
    assert.strictEqual(net.reservoirs[0]!.id, "R_Clearwell");
    assert.strictEqual(net.reservoirs[0]!.totalHead, 165.0);

    assert.strictEqual(net.tanks.length, 1);
    assert.strictEqual(net.tanks[0]!.id, "T_Standpipe");
    assert.strictEqual(net.tanks[0]!.diameter, 40.0);

    // 3. Verify pipe with HAMMER check valve
    assert.strictEqual(net.pipes.length, 1);
    const p1 = net.pipes[0]!;
    assert.strictEqual(p1.id, "P_Main_A");
    assert.strictEqual(p1.node1, "J_Highland");
    assert.strictEqual(p1.node2, "J_Downtown");
    assert.strictEqual(p1.status, "CV", "HasCheckValve flag must translate to status CV");

    // 4. Verify pump and curve
    assert.strictEqual(net.pumps.length, 1);
    assert.strictEqual(net.pumps[0]!.id, "PU_Booster_1");

    assert.strictEqual(net.curves.length, 1);
    assert.strictEqual(net.curves[0]!.id, "CURVE_BOOSTER");
    assert.strictEqual(net.curves[0]!.points.length, 3);

    // 5. Verify roundtrip to valid EPANET INP
    const inpText = serializeInp(net);
    assert.ok(inpText.includes("[JUNCTIONS]"));
    assert.ok(inpText.includes("J_Highland"));
    assert.ok(inpText.includes("[PIPES]"));
    assert.ok(inpText.includes("P_Main_A"));
    assert.ok(inpText.includes("CV"));
  });

  it("2. Parses Innovyze InfoWater database schema", () => {
    const infoWaterTables: DatabaseTableRows = {
      IW_JUNCTION: [
        { JUNC_ID: "J10", ELEV: 15.2, DEMAND: 22.5, PATTERN: "P1" },
        { JUNC_ID: "J20", ELEV: 12.0, DEMAND: 50.0, PATTERN: "P1" },
      ],
      IW_RESERVOIR: [{ RES_ID: "RES_LAKE", TOTAL_HEAD: 45.0 }],
      IW_PIPE: [
        {
          PIPE_ID: "PIPE_TRANSMISSION",
          US_NODE: "RES_LAKE",
          DS_NODE: "J10",
          LENGTH: 500.0,
          DIAM: 300.0,
          ROUGHNESS: 110.0,
          STATUS: "OPEN",
        },
      ],
      IW_VALVE: [
        {
          VALVE_ID: "PRV_1",
          US_NODE: "J10",
          DS_NODE: "J20",
          DIAM: 200.0,
          VALVE_TYPE: "PRV",
          SETTING: 25.0,
        },
      ],
    };

    const net = parseWaterGemsDatabase(infoWaterTables, { flowUnits: "LPS" });
    assert.strictEqual(net.junctions.length, 2);
    assert.strictEqual(net.reservoirs.length, 1);
    assert.strictEqual(net.pipes.length, 1);
    assert.strictEqual(net.valves.length, 1);
    assert.strictEqual(net.valves[0]!.id, "PRV_1");
    assert.strictEqual(net.valves[0]!.setting, 25.0);
  });

  it("3. Reads and converts real Bentley SQLite file (.wtg.sqlite) via node:sqlite", () => {
    // Create an actual SQLite database file in a scratch directory
    const scratchDir = path.join(process.cwd(), "languages", "epanet", "tests", ".scratch");
    fs.mkdirSync(scratchDir, { recursive: true });
    const sqlitePath = path.join(scratchDir, "model.wtg.sqlite");

    try {
      const db = new DatabaseSync(sqlitePath);

      // Create Bentley tables
      db.exec(`
        CREATE TABLE HMIModelingElementPath (ID INTEGER PRIMARY KEY, Label TEXT);
        INSERT INTO HMIModelingElementPath VALUES (1, 'Reservoir_Supply'), (2, 'Node_City'), (3, 'Pipeline_1');

        CREATE TABLE HMIReservoir (ID INTEGER PRIMARY KEY, Head REAL);
        INSERT INTO HMIReservoir VALUES (1, 150.0);

        CREATE TABLE HMIJunction (ID INTEGER PRIMARY KEY, Elevation REAL, Demand REAL);
        INSERT INTO HMIJunction VALUES (2, 80.0, 35.0);

        CREATE TABLE HMIPipe (
          ID INTEGER PRIMARY KEY,
          StartNodeID INTEGER,
          StopNodeID INTEGER,
          Length REAL,
          Diameter REAL,
          Roughness REAL,
          Status TEXT
        );
        INSERT INTO HMIPipe VALUES (3, 1, 2, 2500.0, 16.0, 125.0, 'OPEN');
      `);
      db.close();

      // Convert using ModelScript's native parseWaterGemsDatabase
      const net = parseWaterGemsDatabase(sqlitePath, { flowUnits: "GPM" });

      assert.strictEqual(net.reservoirs.length, 1);
      assert.strictEqual(net.reservoirs[0]!.id, "Reservoir_Supply");
      assert.strictEqual(net.reservoirs[0]!.totalHead, 150.0);

      assert.strictEqual(net.junctions.length, 1);
      assert.strictEqual(net.junctions[0]!.id, "Node_City");
      assert.strictEqual(net.junctions[0]!.elevation, 80.0);

      assert.strictEqual(net.pipes.length, 1);
      assert.strictEqual(net.pipes[0]!.id, "Pipeline_1");
      assert.strictEqual(net.pipes[0]!.node1, "Reservoir_Supply");
      assert.strictEqual(net.pipes[0]!.node2, "Node_City");
    } finally {
      // Clean up scratch file
      if (fs.existsSync(sqlitePath)) {
        fs.unlinkSync(sqlitePath);
      }
      if (fs.existsSync(scratchDir)) {
        fs.rmdirSync(scratchDir);
      }
    }
  });
});
