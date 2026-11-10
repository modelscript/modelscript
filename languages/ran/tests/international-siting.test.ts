// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMpeLimits,
  evaluateSiteMpe,
  type RfEmitterConfig,
} from "../src/em-safety/mpe-solver.js";
import {
  evaluateIcaoAirspaceObstruction,
  evaluateTransportCanadaAirspaceObstruction,
  type IcaoAerodromeConfig,
  type ProposedStructureSiting,
} from "../src/siting/international-airspace.js";

describe("International RF Radiation Safety (MPE) Suite", () => {
  it("evaluates Health Canada Safety Code 6 (2015/2021) frequency limits", () => {
    // 850 MHz (Cellular 850)
    const sc6_850 = getMpeLimits(850, "HEALTH_CANADA_SC6");
    assert.equal(sc6_850.standard, "HEALTH_CANADA_SC6");
    // Gen pop: 0.02619 * 850^0.6834 / 10 W/m^2 -> mW/cm^2
    const expected850GenPop = (0.02619 * Math.pow(850, 0.6834)) / 10.0;
    assert.ok(Math.abs(sc6_850.generalPopulationMilliwattsPerCm2 - expected850GenPop) < 1e-4);
    assert.ok(sc6_850.occupationalMilliwattsPerCm2 > sc6_850.generalPopulationMilliwattsPerCm2);

    // 10 GHz (Microwave)
    const sc6_10g = getMpeLimits(10000, "HEALTH_CANADA_SC6");
    assert.equal(sc6_10g.generalPopulationMilliwattsPerCm2, 1.0);
    assert.equal(sc6_10g.occupationalMilliwattsPerCm2, 5.0);
  });

  it("evaluates ICNIRP 2020 / EU CENELEC EN 50383 reference levels", () => {
    // 900 MHz: f / 2000 mW/cm^2 = 0.45 mW/cm^2
    const icnirp900 = getMpeLimits(900, "ICNIRP_2020");
    assert.equal(icnirp900.generalPopulationMilliwattsPerCm2, 0.45);
    assert.equal(icnirp900.occupationalMilliwattsPerCm2, 2.25);

    // 3500 MHz (5G C-Band): 1.0 mW/cm^2
    const cenelec3500 = getMpeLimits(3500, "EU_CENELEC_EN50383");
    assert.equal(cenelec3500.generalPopulationMilliwattsPerCm2, 1.0);
    assert.equal(cenelec3500.occupationalMilliwattsPerCm2, 5.0);
  });

  it("evaluates strict Swiss NISV and Italian CEI 211 precautionary limits", () => {
    const swiss900 = getMpeLimits(900, "SWISS_ORNI_NISV");
    assert.equal(swiss900.generalPopulationMilliwattsPerCm2, 0.00424); // 4 V/m limit

    const italy1800 = getMpeLimits(1800, "ITALY_CEI_211");
    assert.equal(italy1800.generalPopulationMilliwattsPerCm2, 0.010); // 6 V/m limit

    // A 40W cellular antenna will have larger exclusion zone under Swiss NISV than under FCC
    const emitter: RfEmitterConfig = {
      id: "ant-swiss",
      coordinates: [0, 0, 30],
      azimuthDeg: 0,
      mechanicalTiltDeg: 0,
      electricalDowntiltDeg: 0,
      frequencyMhz: 1800,
      inputPowerWatts: 40,
      cableLossDb: 1.0,
      peakGainDbi: 18.0,
    };

    const fccReport = evaluateSiteMpe([emitter], [[0, 20, 30]], { standard: "FCC_OET65" });
    const swissReport = evaluateSiteMpe([emitter], [[0, 20, 30]], { standard: "SWISS_ORNI_NISV" });

    assert.ok(swissReport.boundaries[0]!.mainBeamExclusionDistanceGeneralPopMeters > fccReport.boundaries[0]!.mainBeamExclusionDistanceGeneralPopMeters);
  });
});

describe("International Airspace Siting (ICAO & Transport Canada) Suite", () => {
  const cdgAirport: IcaoAerodromeConfig = {
    id: "LFPG",
    name: "Paris Charles de Gaulle (ICAO)",
    elevationMslMeters: 119.0,
    latitude: 49.0097,
    longitude: 2.5479,
    runwayCode: "4",
    runwayType: "precision-cat-II-III",
    runwayLengthMeters: 4200,
  };

  const pearsonAirport: IcaoAerodromeConfig = {
    id: "CYYZ",
    name: "Toronto Pearson International",
    elevationMslMeters: 173.0,
    latitude: 43.6777,
    longitude: -79.6248,
    runwayCode: "4",
    runwayType: "precision-cat-II-III",
    runwayLengthMeters: 3389,
  };

  it("evaluates ICAO Annex 14 Inner Horizontal and Conical Surface penetrations", () => {
    // Structure 2 km from CDG runway (within 4 km Inner Horizontal Surface radius)
    // Inner Horizontal limit = 119 + 45 = 164 m MSL
    const structureInsideInner: ProposedStructureSiting = {
      id: "cell-tower-cdg",
      latitude: 49.0200,
      longitude: 2.5600,
      groundElevationMslMeters: 120.0,
      structureHeightAglMeters: 50.0, // Tip = 170 m MSL > 164 m MSL
    };

    const report = evaluateIcaoAirspaceObstruction(structureInsideInner, cdgAirport);
    assert.equal(report.standard, "ICAO_ANNEX14");
    assert.equal(report.isNotificationMandatory, true);
    assert.equal(report.regulatorySubmissionData.eTodArea, "Area 2");
    assert.ok(report.notificationReasons.some((r) => r.includes("Inner Horizontal")));
  });

  it("evaluates Transport Canada CAR 601.23 nationwide 90m ceiling and 6km approach slope", () => {
    // 1. Structure in rural Ontario, 100m tall (exceeds 90m CAR 601.23(a) limit)
    const tallRuralTower: ProposedStructureSiting = {
      id: "tower-rural-on",
      latitude: 45.0000,
      longitude: -78.0000,
      groundElevationMslMeters: 300.0,
      structureHeightAglMeters: 95.0,
    };
    const tcRuralReport = evaluateTransportCanadaAirspaceObstruction(tallRuralTower, pearsonAirport);
    assert.equal(tcRuralReport.isNotificationMandatory, true);
    assert.ok(tcRuralReport.notificationReasons.some((r) => r.includes("CAR 601.23(a) 90 m")));

    // 2. Short tower near Toronto Pearson airport (3 km away) that penetrates 60:1 approach surface
    // Pearson elevation = 173m MSL. At 3,000m, 60:1 slope allows 173 + 3000/60 = 223 m MSL.
    // If ground is 180m and tower is 50m, tip is 230m MSL > 223m MSL.
    const towerNearPearson: ProposedStructureSiting = {
      id: "tower-pearson-vicinity",
      latitude: 43.6900,
      longitude: -79.6000, // ~2.4 km away
      groundElevationMslMeters: 180.0,
      structureHeightAglMeters: 50.0, // Tip = 230 m MSL
    };
    const tcVicinityReport = evaluateTransportCanadaAirspaceObstruction(towerNearPearson, pearsonAirport);
    assert.equal(tcVicinityReport.isNotificationMandatory, true);
    assert.equal(tcVicinityReport.regulatorySubmissionData.navCanadaLupRequired, true);
    assert.ok(tcVicinityReport.notificationReasons.some((r) => r.includes("Transport Canada 6 km aerodrome approach surface")));
  });
});
