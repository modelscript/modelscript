// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { GtfsCommand } from "../src/commands/gtfs.js";
import { HecRasCommand } from "../src/commands/hec-ras.js";
import { LandgemCommand } from "../src/commands/landgem.js";
import { ModflowCommand } from "../src/commands/modflow.js";
import { OcppCommand } from "../src/commands/ocpp.js";
import { OpenAdrCommand } from "../src/commands/openadr.js";
import { ToughCommand } from "../src/commands/tough.js";

const HEC_RAS_GEOM = `Geom Title=Columbia River Reach 1
Program Version=6.3.1
River Reach=Columbia,ReachA
Reach XY=3
0, 1000
500, 1500
1000, 2000

Type RM CEM CS= 1 ,1000    ,        ,
DESCRIPTION=Upstream Cross Section
Station Elevation Data= 5
0, 110  25, 98  50, 92  75, 98  100, 110
Cross Section Reach Lengths and Manning Values=
250, 250, 250, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=25,75
Exp/Contr=0.1,0.3

Type RM CEM CS= 1 ,750     ,        ,
DESCRIPTION=Downstream Cross Section
Station Elevation Data= 5
0, 108  20, 96  50, 90  80, 96  100, 108
Cross Section Reach Lengths and Manning Values=
250, 250, 250, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=20,80
`;

const OCPP_JSON = JSON.stringify({
  stations: [
    {
      id: "DEPOT-CHARGER-1",
      gridLimitKW: 150,
      evses: [
        {
          id: 1,
          connectors: [
            {
              id: 1,
              type: "CCS2",
              maxPowerKW: 100,
              status: "Charging",
              currentSession: {
                transactionId: "TX-100",
                evBatteryCapacityKWh: 300,
                currentSoC: 0.3,
                targetSoC: 0.9,
                departureMinutes: 120,
              },
            },
          ],
        },
      ],
    },
  ],
});

const OPENADR_JSON = JSON.stringify({
  programs: [
    {
      id: "PEAK_SHED_2026",
      name: "Emergency Grid Curtailment",
      events: [
        {
          id: "EVT-9001",
          status: "active",
          signalType: "level",
          targetVenId: "VEN-MUNICIPAL",
          intervals: [
            { start: "2026-08-01T15:00:00Z", durationSeconds: 3600, payload: 2 },
          ],
        },
      ],
    },
  ],
  events: [
    {
      id: "EVT-9001",
      status: "active",
      signalType: "level",
      targetVenId: "VEN-MUNICIPAL",
      intervals: [
        { start: "2026-08-01T15:00:00Z", durationSeconds: 3600, payload: 2 },
      ],
    },
  ],
});

const TOUGH_DAT = `ROCKS
GRAN1  2600.0  0.08  1.5E-14  1.5E-14  1.5E-14  2.5  1000.0
ELEME
A1101  GRAN1  1.0E5
CONNE
A1101A1102   50.0   50.0  1.0E4   0.0
GENER
A1101PROD1  MASS   20.0  1.4E6
INCON
A1101  1.2E7  260.0
`;

const MODFLOW_DIS6 = `BEGIN DIS6
  NLAY 1
  NROW 3
  NCOL 3
  DELR 100.0
  DELC 100.0
  TOP 50.0
  BOTM 0.0
END DIS6
BEGIN NPF
  K 15.0
  K33 1.5
  SS 1.0E-5
  SY 0.20
END NPF
BEGIN WEL
  1 2 2 -400.0
END WEL
`;

const LANDGEM_JSON = JSON.stringify({
  sites: [
    {
      name: "Valley Municipal Landfill",
      openYear: 2000,
      closeYear: 2025,
      params: {
        l0: 100.0,
        k: 0.04,
        nmocPpmv: 600,
        methaneContentPercent: 50,
      },
      cohorts: [
        { year: 2000, massMg: 150000 },
        { year: 2010, massMg: 180000 },
      ],
    },
  ],
  digesters: [
    {
      name: "Digester-1",
      volumeM3: 3000,
      temperatureC: 38.0,
      hrtDays: 22,
      feedCodGL: 50.0,
      ph: 7.2,
    },
  ],
});

const GTFS_FEED = `[ROUTES]
route_id,route_short_name,route_long_name,route_type
R1,14R,Mission Rapid,3

[STOPS]
stop_id,stop_name,stop_lat,stop_lon
S1,Mission & 16th,37.765,-122.419
S2,Mission & 24th,37.752,-122.418

[TRIPS]
route_id,trip_id
R1,T101

[STOP_TIMES]
trip_id,arrival_time,departure_time,stop_id,stop_sequence
T101,08:00:00,08:00:00,S1,1
T101,08:15:00,08:15:00,S2,2
`;

test("Utility Sector Expansion CLI Commands (msx hec-ras, ocpp, openadr, tough, modflow, landgem, gtfs)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_utility_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const hecFile = path.join(tmpDir, "columbia.g01");
  fs.writeFileSync(hecFile, HEC_RAS_GEOM, "utf-8");

  const ocppFile = path.join(tmpDir, "depot.ocpp");
  fs.writeFileSync(ocppFile, OCPP_JSON, "utf-8");

  const oadrFile = path.join(tmpDir, "event.oadr");
  fs.writeFileSync(oadrFile, OPENADR_JSON, "utf-8");

  const toughFile = path.join(tmpDir, "reservoir.tgh");
  fs.writeFileSync(toughFile, TOUGH_DAT, "utf-8");

  const mfFile = path.join(tmpDir, "aquifer.dis6");
  fs.writeFileSync(mfFile, MODFLOW_DIS6, "utf-8");

  const landgemFile = path.join(tmpDir, "valley.landgem");
  fs.writeFileSync(landgemFile, LANDGEM_JSON, "utf-8");

  const gtfsFile = path.join(tmpDir, "transit.gtfs");
  fs.writeFileSync(gtfsFile, GTFS_FEED, "utf-8");

  await t.test("msx hec-ras inspect, lint, profile, to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (HecRasCommand.handler as any)({ action: "inspect", files: [hecFile] });
      assert.ok(logs.some((l) => l.includes("USACE HEC-RAS Geometry")));

      logs.length = 0;
      await (HecRasCommand.handler as any)({ action: "profile", files: [hecFile], discharge: 200.0 });
      assert.ok(logs.some((l) => l.includes("1D Steady Backwater Profile")));
      assert.ok(logs.some((l) => l.includes("WSE=")));

      logs.length = 0;
      await (HecRasCommand.handler as any)({ action: "to-dae", files: [hecFile] });
      assert.ok(logs.some((l) => l.includes("Lowered hydraulic geometry to DAE arena:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ocpp inspect, lint, schedule, to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OcppCommand.handler as any)({ action: "inspect", files: [ocppFile] });
      assert.ok(logs.some((l) => l.includes("OCPP EV Charging Network")));

      logs.length = 0;
      await (OcppCommand.handler as any)({ action: "schedule", files: [ocppFile] });
      assert.ok(logs.some((l) => l.includes("Smart Charging Schedule Optimization")));
      assert.ok(logs.some((l) => l.includes("DEPOT-CHARGER-1")));

      logs.length = 0;
      await (OcppCommand.handler as any)({ action: "to-dae", files: [ocppFile] });
      assert.ok(logs.some((l) => l.includes("Lowered charging network to DAE arena:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx openadr inspect, lint, curtail, to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenAdrCommand.handler as any)({ action: "inspect", files: [oadrFile] });
      assert.ok(logs.some((l) => l.includes("OpenADR Demand Response Program")));

      logs.length = 0;
      await (OpenAdrCommand.handler as any)({ action: "curtail", files: [oadrFile], ven: "VEN-MUNICIPAL" });
      assert.ok(logs.some((l) => l.includes("OpenADR Curtailment Shed Evaluation")));

      logs.length = 0;
      await (OpenAdrCommand.handler as any)({ action: "to-dae", files: [oadrFile] });
      assert.ok(logs.some((l) => l.includes("Lowered demand response deck to DAE arena:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx tough inspect, lint, flash, to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (ToughCommand.handler as any)({ action: "inspect", files: [toughFile] });
      assert.ok(logs.some((l) => l.includes("LBNL TOUGH Geothermal Deck")));

      logs.length = 0;
      await (ToughCommand.handler as any)({ action: "flash", files: [toughFile] });
      assert.ok(logs.some((l) => l.includes("Geothermal Wellbore Flashing")));

      logs.length = 0;
      await (ToughCommand.handler as any)({ action: "to-dae", files: [toughFile] });
      assert.ok(logs.some((l) => l.includes("Lowered reservoir deck to DAE arena:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx modflow inspect, lint, balance, to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (ModflowCommand.handler as any)({ action: "inspect", files: [mfFile] });
      assert.ok(logs.some((l) => l.includes("USGS MODFLOW 6 Groundwater Model")));

      logs.length = 0;
      await (ModflowCommand.handler as any)({ action: "balance", files: [mfFile] });
      assert.ok(logs.some((l) => l.includes("Aquifer Water Budget & Drawdown")));

      logs.length = 0;
      await (ModflowCommand.handler as any)({ action: "to-dae", files: [mfFile] });
      assert.ok(logs.some((l) => l.includes("Lowered groundwater model to DAE arena:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx landgem inspect, lint, biogas, to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (LandgemCommand.handler as any)({ action: "inspect", files: [landgemFile] });
      assert.ok(logs.some((l) => l.includes("EPA LandGEM Landfill & Biogas Model")));

      logs.length = 0;
      await (LandgemCommand.handler as any)({ action: "biogas", files: [landgemFile] });
      assert.ok(logs.some((l) => l.includes("Methane Kinetics & Biogas Generation")));

      logs.length = 0;
      await (LandgemCommand.handler as any)({ action: "to-dae", files: [landgemFile] });
      assert.ok(logs.some((l) => l.includes("Lowered biogas model to DAE arena:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx gtfs inspect, lint, traction, depot, to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (GtfsCommand.handler as any)({ action: "inspect", files: [gtfsFile] });
      assert.ok(logs.some((l) => l.includes("GTFS Transit Feed")));

      logs.length = 0;
      await (GtfsCommand.handler as any)({ action: "traction", files: [gtfsFile] });
      assert.ok(logs.some((l) => l.includes("Kinematic Traction Power & SOC")));

      logs.length = 0;
      await (GtfsCommand.handler as any)({ action: "depot", files: [gtfsFile] });
      assert.ok(logs.some((l) => l.includes("Transit Depot Charging & Transformer Optimization")));

      logs.length = 0;
      await (GtfsCommand.handler as any)({ action: "to-dae", files: [gtfsFile] });
      assert.ok(logs.some((l) => l.includes("Lowered transit electrification model to DAE arena:")));
    } finally {
      console.log = origLog;
    }
  });
});
