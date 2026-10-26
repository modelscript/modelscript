// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { EnergyPlusCommand } from "../src/commands/energyplus.js";

const SAMPLE_IDF = `
Building,
  TwoZoneOffice,           !- Name
  0.0,                     !- North Axis [deg]
  Suburbs,                 !- Terrain
  0.04,                    !- Loads Convergence Tolerance Value [W]
  0.4,                     !- Temperature Convergence Tolerance Value [deltaC]
  FullExterior,            !- Solar Distribution
  25,                      !- Maximum Number of Warmup Days
  6;                       !- Minimum Number of Warmup Days

Zone,
  ZoneNorth,               !- Name
  0.0,                     !- Direction of Relative North [deg]
  0.0, 0.0, 0.0,           !- Origin [X, Y, Z]
  1,                       !- Type
  1,                       !- Multiplier
  3.0,                     !- Ceiling Height [m]
  120.0;                   !- Volume [m3]

Material,
  ConcreteWall,            !- Name
  MediumRough,             !- Roughness
  0.20,                    !- Thickness [m]
  1.75,                    !- Conductivity [W/m-K]
  2200.0,                  !- Density [kg/m3]
  900.0,                   !- Specific Heat [J/kg-K]
  0.90,                    !- Thermal Absorptance
  0.65,                    !- Solar Absorptance
  0.65;                    !- Visible Absorptance

Construction,
  ExtWallConst,            !- Name
  ConcreteWall;            !- Outside Layer

BuildingSurface:Detailed,
  WallNorthExt,            !- Name
  Wall,                    !- Surface Type
  ExtWallConst,            !- Construction Name
  ZoneNorth,               !- Zone Name
  Outdoors,                !- Outside Boundary Condition
  ,                        !- Outside Boundary Condition Object
  SunExposed,              !- Sun Exposure
  WindExposed,             !- Wind Exposure
  0.5,                     !- View Factor to Ground
  4,                       !- Number of Vertices
  0.0, 5.0, 3.0,
  0.0, 5.0, 0.0,
  5.0, 5.0, 0.0,
  5.0, 5.0, 3.0;
`;

test("EnergyPlus CLI Commands (msx energyplus inspect, lint, to-modelica, to-dae)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "languages/energyplus/tests/scratch_energyplus_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const idfFile = path.join(tmpDir, "office.idf");
  fs.writeFileSync(idfFile, SAMPLE_IDF, "utf-8");

  await t.test("msx energyplus inspect & summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EnergyPlusCommand.handler as any)({
        action: "inspect",
        files: [idfFile],
      });
      assert.ok(logs.some((l) => l.includes("TwoZoneOffice")));
      assert.ok(logs.some((l) => l.includes("ZoneNorth")));
      assert.ok(logs.some((l) => l.includes("Thermal Zones: 1")));

      // Test summary alias with json format and out
      const summaryOut = path.join(tmpDir, "summary.json");
      await (EnergyPlusCommand.handler as any)({
        action: "summary",
        files: [idfFile],
        format: "json",
        out: summaryOut,
      });
      assert.ok(fs.existsSync(summaryOut));
      const summaryData = JSON.parse(fs.readFileSync(summaryOut, "utf-8"));
      assert.equal(summaryData.zonesCount, 1);
      assert.equal(summaryData.zones[0].name, "ZoneNorth");
      assert.equal(summaryData.surfacesCount, 1);
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx energyplus lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EnergyPlusCommand.handler as any)({
        action: "lint",
        files: [idfFile],
      });
      assert.ok(logs.some((l) => l.includes("0 diagnostics reported")));

      logs.length = 0;
      await (EnergyPlusCommand.handler as any)({
        action: "lint",
        files: [idfFile],
        format: "json",
      });
      const parsed = JSON.parse(logs.join(""));
      assert.ok(Array.isArray(parsed));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx energyplus to-modelica", async () => {
    const outFile = path.join(tmpDir, "office.mo");

    await (EnergyPlusCommand.handler as any)({
      action: "to-modelica",
      files: [idfFile],
      out: outFile,
    });

    assert.ok(fs.existsSync(outFile));
    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.includes("model TwoZoneOffice"));
    assert.ok(content.includes("ZoneNorth"));
  });

  await t.test("msx energyplus to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      const daeOut = path.join(tmpDir, "dae_meta.json");
      await (EnergyPlusCommand.handler as any)({
        action: "to-dae",
        files: [idfFile],
        out: daeOut,
      });
      assert.ok(logs.some((l) => l.includes("Lowered EnergyPlus building model into linear DAE arena:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(fs.existsSync(daeOut));
      const meta = JSON.parse(fs.readFileSync(daeOut, "utf-8"));
      assert.ok(meta.varCount > 0);
      assert.ok(meta.eqCount > 0);
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx energyplus thermal-balance", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      const tbOut = path.join(tmpDir, "tb_result.json");
      await (EnergyPlusCommand.handler as any)({
        action: "thermal-balance",
        files: [idfFile],
        tamb: 15.0,
        format: "json",
        out: tbOut,
      });
      assert.ok(fs.existsSync(tbOut));
      const tbData = JSON.parse(fs.readFileSync(tbOut, "utf-8"));
      assert.equal(tbData.ambientTemp, 15.0);
      assert.ok(tbData.zones.length === 1);
      assert.equal(tbData.zones[0].zone, "ZoneNorth");
      assert.ok(tbData.zones[0].totalUA > 0);
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx energyplus sync", async () => {
    const modifiedMo = `model TwoZoneOffice
  Modelica.Thermal.HeatTransfer.Sources.FixedHeatFlow q_int_ZoneNorth(Q_flow = 2500.0);
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor wall_WallNorthExt(G = 45.0);
end TwoZoneOffice;`;
    const moFile = path.join(tmpDir, "office_mod.mo");
    fs.writeFileSync(moFile, modifiedMo, "utf-8");

    const syncedIdf = path.join(tmpDir, "office_synced.idf");
    await (EnergyPlusCommand.handler as any)({
      action: "sync",
      files: [idfFile],
      "from-modelica": moFile,
      out: syncedIdf,
    });

    assert.ok(fs.existsSync(syncedIdf));
    const syncedContent = fs.readFileSync(syncedIdf, "utf-8");
    assert.ok(syncedContent.includes("TwoZoneOffice"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
