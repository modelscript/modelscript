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

  await t.test("msx energyplus inspect", async () => {
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
      await (EnergyPlusCommand.handler as any)({
        action: "to-dae",
        files: [idfFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered EnergyPlus building model into linear DAE arena:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx energyplus thermal-balance", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EnergyPlusCommand.handler as any)({
        action: "thermal-balance",
        files: [idfFile],
        tamb: 15.0,
      });
      assert.ok(logs.some((l) => l.includes("Steady-State Thermal Balance")));
      assert.ok(logs.some((l) => l.includes("Zone ZoneNorth")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
