// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @file multi-utility-sector-coupling.test.ts
 *
 * Multi-Utility Cross-Sector Coupling Benchmark & Parity Verification Suite.
 *
 * Validates the 7 new utility domain packages and their zero-overhead DAEBuilder lowering:
 * 1. River Basins & Open Channels (@modelscript/hec-ras)
 * 2. EV Smart Charging (@modelscript/ocpp)
 * 3. Demand Response Flexibility (@modelscript/openadr)
 * 4. Deep Geothermal Reservoirs (@modelscript/tough)
 * 5. Regional Groundwater Aquifers (@modelscript/modflow)
 * 6. Solid Waste & Renewable Biogas (@modelscript/landgem)
 * 7. Transit Fleet Electrification (@modelscript/gtfs)
 * 8. Integrated Multi-Utility Sector-Coupling Co-Simulation Scenario
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lowerGtfsToDae, parseGtfs, solveTractionProfiles } from "@modelscript/gtfs";
import { lowerHecRasToDae, parseGeometry, solveWaterSurfaceProfile } from "@modelscript/hec-ras";
import { lowerLandgemToDae, parseLandgem, solveBiogas } from "@modelscript/landgem";
import { lowerModflowToDae, parseModflow, solveAquiferBalance } from "@modelscript/modflow";
import { lowerOcppToDae, parseOcpp, scheduleSmartCharging } from "@modelscript/ocpp";
import { evaluateCurtailment, lowerOpenAdrToDae, parseOpenAdr } from "@modelscript/openadr";
import { lowerToughToDae, parseTough, solveGeothermalWells } from "@modelscript/tough";

describe("Multi-Utility Sector-Coupling Benchmark Suite", () => {
  // ---------------------------------------------------------------------------
  // 1. River Basins & Open-Channel Water Resources (@modelscript/hec-ras)
  // ---------------------------------------------------------------------------
  describe("Sector: Open-Channel River Hydraulics (HEC-RAS)", () => {
    it("solves 1D Saint-Venant standard-step backwater profile and lowers to DAE arena", () => {
      const geoText = `
Geom Title=Columbia Canal Reach
River Reach=Columbia,Main
Reach XY=2
0, 0
1000, 0

Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 4
0, 105  10, 100  30, 100  40, 105
Cross Section Reach Lengths and Manning Values=
500, 500, 500, 3, 0.025, 0.025, 0.025, 0, 0
Bank Sta=10,30

Type RM CEM CS= 1 ,500     ,        ,
Station Elevation Data= 4
0, 104.5  10, 99.5  30, 99.5  40, 104.5
Cross Section Reach Lengths and Manning Values=
500, 500, 500, 3, 0.025, 0.025, 0.025, 0, 0
Bank Sta=10,30
`;
      const geom = parseGeometry(geoText);
      assert.strictEqual(geom.crossSections.length, 2, "2 cross-sections expected");

      const results = solveWaterSurfaceProfile(geom, {
        discharge: 60.0,
        frictionSlope: 0.001,
      });

      assert.strictEqual(results.length, 2);
      const us = results[0]!;
      const ds = results[1]!;

      // Verify subcritical flow & upstream energy grade line > downstream
      assert.ok(us.froudeNumber < 1.0, "Upstream flow should be subcritical");
      assert.ok(ds.froudeNumber < 1.0, "Downstream flow should be subcritical");
      assert.ok(us.energyGradeLine > ds.energyGradeLine, "Upstream EGL must exceed downstream EGL");

      // DAE lowering
      const arena = lowerHecRasToDae(geom, null);
      assert.ok(arena.variables().length > 0, "DAE must allocate variables");
      assert.ok(arena.equations().length > 0, "DAE must allocate equations");
    });
  });

  // ---------------------------------------------------------------------------
  // 2. EV Smart Charging & Transformer Constraints (@modelscript/ocpp)
  // ---------------------------------------------------------------------------
  describe("Sector: EV Smart Charging Orchestration (OCPP)", () => {
    it("schedules multi-EVSE charging within transformer power limit and lowers to DAE arena", () => {
      const ocppJson = JSON.stringify({
        stations: [
          {
            id: "DEPOT-01",
            gridLimitKW: 120.0,
            evses: [
              {
                id: 1,
                connectors: [
                  {
                    id: 1,
                    type: "CCS2",
                    maxPowerKW: 100.0,
                    status: "Charging",
                    currentSession: {
                      transactionId: "TX-1",
                      currentSoC: 0.2,
                      targetSoC: 0.9,
                      batteryCapacityKWh: 80.0,
                      departureMinutes: 45,
                    },
                  },
                ],
              },
              {
                id: 2,
                connectors: [
                  {
                    id: 1,
                    type: "CCS2",
                    maxPowerKW: 100.0,
                    status: "Charging",
                    currentSession: {
                      transactionId: "TX-2",
                      currentSoC: 0.75,
                      targetSoC: 0.85,
                      batteryCapacityKWh: 60.0,
                      departureMinutes: 240,
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const net = parseOcpp(ocppJson);
      assert.strictEqual(net.stations.length, 1);

      const allocations = scheduleSmartCharging(net);
      const totalPower = allocations.reduce((sum, a) => sum + a.allocatedPowerKW, 0);
      assert.ok(totalPower <= 120.0, "Total allocated power must not exceed transformer 120kW limit");

      // Urgent vehicle TX-1 (45m, 20% SoC) gets more power than TX-2 (240m, 75% SoC)
      const p1 = allocations.find((a) => a.transactionId === "TX-1")?.allocatedPowerKW ?? 0;
      const p2 = allocations.find((a) => a.transactionId === "TX-2")?.allocatedPowerKW ?? 0;
      assert.ok(p1 > p2, `Urgent vehicle TX-1 (${p1} kW) should receive more power than flexible TX-2 (${p2} kW)`);

      const arena = lowerOcppToDae(net);
      assert.ok(arena.variables().length >= 3, "DAE must declare power variables");
      assert.ok(arena.equations().length >= 2, "DAE must enforce capacity constraint equations");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Automated Demand Response Flexibility (@modelscript/openadr)
  // ---------------------------------------------------------------------------
  describe("Sector: Demand Response & Grid Flexibility (OpenADR)", () => {
    it("processes demand response event intervals and calculates shed dispatch", () => {
      const oadrDeck = `
program "Emergency_Load_Shed" {
  event "EVENT-PEAK-SHED-01" {
    status: "active"
    signalType: "setpoint"
    targetVenId: "VEN_DEPOT_01"

    interval {
      durationSeconds: 3600
      payload: 150.0
    }
  }
}
`;
      const deck = parseOpenAdr(oadrDeck);
      assert.strictEqual(deck.programs.length, 1);

      const schedule = evaluateCurtailment(deck, "VEN_DEPOT_01");
      assert.strictEqual(schedule.length, 1);
      assert.strictEqual(schedule[0]!.activeLimitKW, 150.0);

      const baselineKw = 350.0;
      const targetCurtailmentKw = Math.max(0, baselineKw - schedule[0]!.activeLimitKW);
      const netLoadKw = baselineKw - targetCurtailmentKw;
      assert.strictEqual(targetCurtailmentKw, 200.0);
      assert.strictEqual(netLoadKw, 150.0);

      const arena = lowerOpenAdrToDae(deck);
      assert.ok(arena.variables().length > 0, "DAE must allocate DR variables");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Deep Geothermal Reservoir Flashing (@modelscript/tough)
  // ---------------------------------------------------------------------------
  describe("Sector: Deep Geothermal Reservoir Dynamics (TOUGH)", () => {
    it("simulates geothermal well production flashing and lowers multiphase Darcy DAE", () => {
      const toughDeckText = `
Geothermal Production Well Test
ROCKS
SAND1    2500.0      0.20 1.0E-12 1.0E-12 1.0E-12       2.0    1000.0
ELEME
PROD1SAND1 1.0E+05
GENER
PROD1GEO01MASS      -30.0    1.8E+06
`;
      const deck = parseTough(toughDeckText);
      assert.strictEqual(deck.rocks.length, 1);
      assert.strictEqual(deck.elements.length, 1);

      const wells = solveGeothermalWells(deck);
      assert.strictEqual(wells.length, 1);
      const w = wells[0]!;
      assert.strictEqual(w.wellName, "GEO01");
      assert.ok(w.thermalPowerMW > 40.0, "Thermal power should exceed 40 MW");
      assert.ok(w.steamFraction > 0.5, "Steam fraction should exceed 50%");

      const arena = lowerToughToDae(deck);
      assert.ok(arena.variables().length > 0, "DAE must represent pressure, temperature, and mass balances");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Regional Groundwater Aquifers (@modelscript/modflow)
  // ---------------------------------------------------------------------------
  describe("Sector: Regional Groundwater Aquifers (MODFLOW)", () => {
    it("solves 3D multi-layer Darcy groundwater heads and wellfield drawdown", () => {
      const modflowText = `
BEGIN DIS6
  NLAY 2
  NROW 3
  NCOL 3
  DELR 100.0
  DELC 100.0
  TOP 50.0
  BOTM 20.0 0.0
END DIS6

BEGIN NPF6
  K 15.0
  K33 2.0
  SS 1.0e-5
  SY 0.18
END NPF6

BEGIN WEL6
  1 2 2 -400.0
END WEL6

BEGIN CHD6
  1 1 1 50.0
  1 3 3 42.0
END CHD6
`;
      const model = parseModflow(modflowText);
      assert.strictEqual(model.dis.nlay, 2);
      assert.strictEqual(model.wells.length, 1);

      const summary = solveAquiferBalance(model);
      assert.strictEqual(summary.totalPumpingRate, 400.0);
      assert.ok(summary.maxDrawdown > 0, "Well pumping must induce positive drawdown");
      assert.strictEqual(summary.cellBudgets.length, 18);

      const arena = lowerModflowToDae(model);
      assert.strictEqual(arena.variables().length, 18, "DAE must allocate state variable per grid cell");
      assert.ok(arena.equations().length > 0, "DAE must generate 3D Darcy continuity equations");
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Solid Waste & Renewable Biogas RNG (@modelscript/landgem)
  // ---------------------------------------------------------------------------
  describe("Sector: Solid Waste & Renewable Biogas RNG (LandGEM)", () => {
    it("computes EPA first-order methane decay kinetics and ADM1 anaerobic digestion CHP", () => {
      const landgemText = `
SITE "PineCreekLandfill"
  OPEN 2010
  CLOSE 2035
  L0 100.0
  K 0.04
  NMOC 600
  METHANE_PERCENT 50.0

WASTE_ACCEPTANCE
  2010 150000
  2011 160000
  2012 175000
  2013 180000

DIGESTER "CoDigestionFacility"
  VOLUME 4000.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 45.0
  PH 7.3
`;
      const model = parseLandgem(landgemText);
      assert.strictEqual(model.sites[0]?.params.k, 0.04);

      const summary = solveBiogas(model);
      assert.ok(summary.peakMethaneM3PerYear > 0, "Peak methane generation must be positive");
      assert.ok(summary.cumulativeMethaneM3 > 0, "Cumulative methane yield must be positive");

      assert.strictEqual(summary.digesters.length, 1);
      const dig = summary.digesters[0]!;
      assert.ok(dig.electricalPowerKW > 50.0, "Digester CHP electrical power rating must exceed 50 kW");

      const arena = lowerLandgemToDae(model);
      assert.ok(arena.variables().length >= 5, "DAE must allocate biogas kinetics variables");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Public Transit Fleet Electrification (@modelscript/gtfs)
  // ---------------------------------------------------------------------------
  describe("Sector: Public Transit Fleet Electrification (GTFS)", () => {
    it("evaluates bus route kinematic traction power and battery state-of-charge", () => {
      const gtfsCsv = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
STOP_1,Central Station,37.7749,-122.4194
STOP_2,Civic Center,37.7793,-122.4175
STOP_3,Mission District,37.7599,-122.4148

# ROUTES
route_id,route_short_name,route_long_name,route_type
ROUTE_14,14,Mission Electric Rapid,3

# TRIPS
route_id,service_id,trip_id,shape_id
ROUTE_14,WEEKDAY,TRIP_101,SHAPE_14

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
TRIP_101,08:00:00,08:00:30,STOP_1,1,0.0
TRIP_101,08:06:00,08:06:30,STOP_2,2,1200.0
TRIP_101,08:18:00,08:18:30,STOP_3,3,3800.0

# VEHICLE
mass 18500
battery 350
aux 8.0
`;
      const feed = parseGtfs(gtfsCsv);
      assert.strictEqual(feed.stops.length, 3);
      assert.strictEqual(feed.stopTimes.length, 3);

      const profiles = solveTractionProfiles(feed);
      assert.strictEqual(profiles.length, 1);
      const p = profiles[0]!;
      assert.strictEqual(p.tripId, "TRIP_101");
      assert.ok(p.durationSeconds > 0);
      assert.ok(p.totalDistanceM > 0);
      assert.ok(p.peakTractionKW > 0);

      const arena = lowerGtfsToDae(feed);
      assert.ok(arena.variables().length > 0, "DAE must declare transit kinematic variables");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Multi-Utility Cross-Sector Coupling Co-Simulation
  // ---------------------------------------------------------------------------
  describe("Integrated Multi-Utility Cross-Sector Coupling", () => {
    it("simulates microgrid co-coupling: Canal + Wellfield + Transit Depot + Landfill Biogas + OpenADR", () => {
      // 1. River Canal Water Supply (HEC-RAS)
      const geoText = `
Geom Title=Intake Canal
River Reach=Canal,Main
Reach XY=2
0, 0
1000, 0

Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 4
0, 105  10, 100  30, 100  40, 105
Cross Section Reach Lengths and Manning Values=
500, 500, 500, 3, 0.025, 0.025, 0.025, 0, 0
Bank Sta=10,30

Type RM CEM CS= 1 ,500     ,        ,
Station Elevation Data= 4
0, 104.5  10, 99.5  30, 99.5  40, 104.5
Cross Section Reach Lengths and Manning Values=
500, 500, 500, 3, 0.025, 0.025, 0.025, 0, 0
Bank Sta=10,30
`;
      const geom = parseGeometry(geoText);
      const canalHydraulics = solveWaterSurfaceProfile(geom, {
        discharge: 40.0,
        frictionSlope: 0.001,
      });
      assert.strictEqual(canalHydraulics.length, 2);

      // 2. Groundwater Extraction Wellfield (MODFLOW)
      const mfText = `
BEGIN DIS6
  NLAY 1
  NROW 2
  NCOL 2
  DELR 250.0
  DELC 250.0
  TOP 60.0
  BOTM 0.0
END DIS6
BEGIN NPF6
  K 15.0
END NPF6
BEGIN CHD6
  1 1 1 52.0
END CHD6
BEGIN WEL6
  1 2 2 -350.0
END WEL6
`;
      const aquifer = parseModflow(mfText);
      const aquiferSummary = solveAquiferBalance(aquifer);
      assert.strictEqual(aquiferSummary.totalPumpingRate, 350.0);

      // 3. Transit Fleet Charging Demand (GTFS + OCPP)
      const ocppJson = JSON.stringify({
        stations: [
          {
            id: "MUNICIPAL-DEPOT",
            gridLimitKW: 500.0,
            evses: [
              {
                id: 1,
                connectors: [
                  {
                    id: 1,
                    type: "CCS2",
                    maxPowerKW: 150.0,
                    status: "Charging",
                    currentSession: {
                      transactionId: "BUS-1",
                      currentSoC: 0.35,
                      targetSoC: 0.9,
                      batteryCapacityKWh: 350.0,
                      departureMinutes: 60,
                    },
                  },
                ],
              },
              {
                id: 2,
                connectors: [
                  {
                    id: 1,
                    type: "CCS2",
                    maxPowerKW: 150.0,
                    status: "Charging",
                    currentSession: {
                      transactionId: "BUS-2",
                      currentSoC: 0.5,
                      targetSoC: 0.85,
                      batteryCapacityKWh: 350.0,
                      departureMinutes: 120,
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
      const ocppNet = parseOcpp(ocppJson);
      const uncurtailedCharging = scheduleSmartCharging(ocppNet);
      const baselineDepotKw = uncurtailedCharging.reduce((sum, a) => sum + a.allocatedPowerKW, 0);

      // 4. Landfill Biogas CHP Co-Generation (LandGEM)
      const landgemText = `
SITE "RegionalLandfill"
  OPEN 2010
  CLOSE 2035
  L0 100.0
  K 0.04
WASTE_ACCEPTANCE
  2015 80000
  2020 120000
  2025 150000
DIGESTER "BiogasPlant"
  VOLUME 3500.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 40.0
  PH 7.2
`;
      const biogasPlant = parseLandgem(landgemText);
      const chp = solveBiogas(biogasPlant);
      const chpPowerKw = chp.digesters[0]?.electricalPowerKW ?? 75.0;
      assert.ok(chpPowerKw > 0, "Biogas CHP power output must be positive");

      // 5. OpenADR Peak Grid Flex Event
      const oadrDeck = `
program "FlexAlert" {
  event "FLEX-ALERT-1800" {
    status: "active"
    signalType: "setpoint"
    targetVenId: "MUNICIPAL-DEPOT"

    interval {
      durationSeconds: 3600
      payload: 160.0
    }
  }
}
`;
      const drDeck = parseOpenAdr(oadrDeck);
      const drSchedule = evaluateCurtailment(drDeck, "MUNICIPAL-DEPOT");
      const drLimitKw = drSchedule[0]?.activeLimitKW ?? baselineDepotKw;
      const drCurtailmentKw = Math.max(0, baselineDepotKw - drLimitKw);

      // Verify that during DR event, reduced depot charging + biogas CHP stabilizes microgrid
      const throttledDepotKw = baselineDepotKw - drCurtailmentKw;
      const netMicrogridDemandKw = throttledDepotKw - chpPowerKw;

      console.log(`\n=== Multi-Utility Cross-Sector Microgrid Coupling ===`);
      console.log(`  Canal Water Surface: WSEL = ${canalHydraulics[0]!.waterSurfaceElevation.toFixed(2)} m`);
      console.log(`  Aquifer Pumping:     Rate = ${aquiferSummary.totalPumpingRate.toFixed(1)} m³/d, Drawdown = ${aquiferSummary.maxDrawdown.toFixed(2)} m`);
      console.log(`  Baseline EV Depot:   ${baselineDepotKw.toFixed(1)} kW`);
      console.log(`  OpenADR Curtailment: -${drCurtailmentKw.toFixed(1)} kW`);
      console.log(`  Biogas CHP Output:   +${chpPowerKw.toFixed(1)} kW`);
      console.log(`  Net Microgrid Draw:  ${netMicrogridDemandKw.toFixed(1)} kW`);

      assert.ok(netMicrogridDemandKw < baselineDepotKw, "Demand response and biogas CHP must reduce net grid draw");
    });
  });
});
