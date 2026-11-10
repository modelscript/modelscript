// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeEmitterExclusionBoundary,
  computeEmitterPowerDensity,
  evaluateFaaPart77Notice,
  evaluateSiteMpe,
  getFccMpeLimits,
  type ProposedTowerStructure,
  type RfEmitterConfig,
  type RunwaySpecification,
} from "../src/index.js";

test("FCC OET Bulletin 65 & ICNIRP RF Safety (MPE) Solver Suite", async (t) => {
  await t.test("evaluates frequency-dependent MPE limits across spectrum", () => {
    // FM Broadcast (100 MHz)
    const fm = getFccMpeLimits(100.0);
    assert.equal(fm.generalPopulationMilliwattsPerCm2, 0.2);
    assert.equal(fm.occupationalMilliwattsPerCm2, 1.0);

    // Cellular 850 MHz (f / 1500 and f / 300)
    const cell850 = getFccMpeLimits(850.0);
    assert.equal(Math.round(cell850.generalPopulationMilliwattsPerCm2 * 1000) / 1000, 0.567);
    assert.equal(Math.round(cell850.occupationalMilliwattsPerCm2 * 1000) / 1000, 2.833);

    // PCS / AWS / C-Band / mmWave (>= 1500 MHz)
    const cband = getFccMpeLimits(3700.0);
    assert.equal(cband.generalPopulationMilliwattsPerCm2, 1.0);
    assert.equal(cband.occupationalMilliwattsPerCm2, 5.0);
  });

  await t.test("computes single emitter power density and boundary exclusion distances", () => {
    const emitter: RfEmitterConfig = {
      id: "C-BAND-SEC-1",
      coordinates: [0, 0, 30], // 30m tower height
      azimuthDeg: 0, // Boresight due North
      mechanicalTiltDeg: 0,
      electricalDowntiltDeg: 2,
      frequencyMhz: 3700, // C-Band
      inputPowerWatts: 40.0,
      cableLossDb: 1.0, // net ~31.8W
      peakGainDbi: 18.0, // linear ~63.1
    };

    // Main-beam exclusion distance
    const boundary = computeEmitterExclusionBoundary(emitter, 2.56);
    assert.ok(boundary.mainBeamExclusionDistanceGeneralPopMeters > 5.0, "Gen Pop exclusion should be > 5m");
    assert.ok(boundary.mainBeamExclusionDistanceOccupationalMeters < boundary.mainBeamExclusionDistanceGeneralPopMeters);

    // Power density at 50m on boresight
    const pdAt50m = computeEmitterPowerDensity(emitter, [0, 50, 30], 2.56);
    assert.ok(pdAt50m > 0, "Power density should be positive");
    assert.ok(pdAt50m / 10.0 < 1.0, "At 50m, power density should be below 1.0 mW/cm^2 general pop limit");
  });

  await t.test("evaluates collocated multi-antenna site Total Exposure Ratio (TER)", () => {
    const emitters: RfEmitterConfig[] = [
      {
        id: "ANT-LOW-BAND",
        coordinates: [0, 0, 25],
        azimuthDeg: 0,
        mechanicalTiltDeg: 0,
        electricalDowntiltDeg: 0,
        frequencyMhz: 700,
        inputPowerWatts: 60.0,
        cableLossDb: 1.5,
        peakGainDbi: 15.0,
      },
      {
        id: "ANT-MID-BAND",
        coordinates: [0, 0, 28],
        azimuthDeg: 0,
        mechanicalTiltDeg: 0,
        electricalDowntiltDeg: 0,
        frequencyMhz: 1900,
        inputPowerWatts: 40.0,
        cableLossDb: 1.0,
        peakGainDbi: 18.0,
      },
    ];

    // Evaluate on ground at 10m from tower base (x=0, y=10, z=2m human height)
    const report = evaluateSiteMpe(emitters, [[0, 10, 2], [0, 100, 2]]);
    assert.equal(report.emitters.length, 2);
    assert.equal(report.evaluationPoints.length, 2);
    assert.ok(report.maxTerGeneralPopulation > 0);
    assert.ok(report.maxTerOccupational < report.maxTerGeneralPopulation);
    assert.ok(report.requiredSignageNotice !== undefined);
  });
});

test("FAA 14 CFR Part 77 Airspace Obstruction Evaluation Suite", async (t) => {
  const airportRunway: RunwaySpecification = {
    airportCode: "JFK",
    runwayId: "04L",
    runwayLengthFeet: 12079, // > 3200 ft -> 100:1 slope within 20,000 ft
    runwayElevationAmslFeet: 13.0,
    latitude: 40.6397,
    longitude: -73.7789,
    isInstrumentRunway: true,
  };

  await t.test("determines Notice Required for tower exceeding 200 ft AGL baseline", () => {
    const tallTower: ProposedTowerStructure = {
      siteId: "TOWER-RURAL-01",
      latitude: 41.5000,
      longitude: -74.5000, // remote, far from airports
      groundElevationAmslFeet: 500.0,
      structureHeightAglFeet: 250.0, // > 200 ft
    };

    const res = evaluateFaaPart77Notice(tallTower, []);
    assert.equal(res.requiresFaaNotice, true);
    assert.equal(res.obstructionStandardFindings.exceeds200FtAglThreshold, true);
    assert.equal(res.form74601Data.noticeFilingDetermination, "NOTICE_REQUIRED");
    assert.ok(res.form74601Data.recommendedMarkingAndLighting.includes("Red"));
  });

  await t.test("determines Notice Required for tower penetrating 100:1 runway approach slope", () => {
    // Site located 10,000 ft (approx 1.6 nm) from JFK runway 04L
    // At 10,000 ft, 100:1 allowable height above runway = 100 ft
    // If ground is 20 ft AMSL and tower is 120 ft AGL -> 140 ft AMSL -> penetrations!
    const runwayNearTower: ProposedTowerStructure = {
      siteId: "TOWER-AIRPORT-APPROACH",
      latitude: 40.6650,
      longitude: -73.7789,
      groundElevationAmslFeet: 20.0,
      structureHeightAglFeet: 120.0, // < 200 ft AGL, but close to runway!
    };

    const res = evaluateFaaPart77Notice(runwayNearTower, [airportRunway]);
    assert.equal(res.requiresFaaNotice, true);
    assert.equal(res.obstructionStandardFindings.exceeds200FtAglThreshold, false);
    assert.equal(res.obstructionStandardFindings.exceedsAirportSurfaceStandard, true);
    assert.ok(res.nearestRunwayCheck?.isSlopePenetrated);
  });

  await t.test("determines Notice NOT Required for short tower far from airport", () => {
    const smallCell: ProposedTowerStructure = {
      siteId: "SMALL-CELL-01",
      latitude: 41.5000,
      longitude: -74.5000,
      groundElevationAmslFeet: 500.0,
      structureHeightAglFeet: 45.0, // standard small cell on utility pole
    };

    const res = evaluateFaaPart77Notice(smallCell, [airportRunway]);
    assert.equal(res.requiresFaaNotice, false);
    assert.equal(res.form74601Data.noticeFilingDetermination, "NOTICE_NOT_REQUIRED");
    assert.equal(res.form74601Data.recommendedMarkingAndLighting, "None");
  });
});
