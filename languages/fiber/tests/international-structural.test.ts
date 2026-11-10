// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateCsaCableLoading,
  evaluateCsaPoleStress,
  auditCsaClearances,
  type CsaPoleAnalysisConfig,
  type CsaCableAttachmentConfig,
} from "../src/structural/csa-loading.js";
import {
  calculateEurocodePeakWindPressure,
  evaluateEurocodeMastLoading,
  type EurocodeMastLoadingConfig,
} from "../src/structural/eurocode-loading.js";

describe("CSA C22.3 No. 1 Overhead Structural Loading Suite", () => {
  const fiberCable: CsaCableAttachmentConfig = {
    id: "cable-fiber-csa",
    type: "telecom-fiber",
    attachmentHeightMeters: 7.5,
    bareCableDiameterMm: 15.0,
    bareCableWeightKgPerM: 0.25,
    spanLengthMeters: 50.0,
  };

  it("calculates CSA Severe Loading district with 19 mm radial ice", () => {
    const severe = calculateCsaCableLoading(fiberCable, "severe");
    assert.equal(severe.bareDiameterMm, 15.0);
    // Iced diameter: 15 + 2 * 19 = 53 mm
    assert.equal(severe.icedDiameterMm, 53.0);
    // Vertical gravity force should account for heavy 19mm glaze ice weight (density 913 kg/m^3)
    assert.ok(severe.verticalGravityLoadNewtonsPerMeter > 15.0);
    // Transverse wind force = 400 Pa * (0.053 m) = 21.2 N/m
    assert.ok(Math.abs(severe.transverseWindLoadNewtonsPerMeter - 21.2) < 0.2);
    // Total transverse force over 50m span ~ 1060 N
    assert.ok(Math.abs(severe.totalTransverseLoadNewtons - 1060) < 10);
  });

  it("evaluates CSA 015 wood pole bending stress with Grade 1 vs Grade 2 resistance factors", () => {
    const poleConfigGrade1: CsaPoleAnalysisConfig = {
      poleId: "pole-hydro-quebec-1",
      species: "western-red-cedar",
      overallLengthMeters: 12.0, // 40 ft pole
      circumferenceAtGroundLineMeters: 0.95,
      circumferenceAtTopMeters: 0.55,
      constructionGrade: "grade-1", // phi = 0.65
      loadingDistrict: "heavy",
      attachments: [
        fiberCable,
        {
          id: "cable-secondary-power",
          type: "power-secondary",
          attachmentHeightMeters: 9.0,
          bareCableDiameterMm: 25.0,
          bareCableWeightKgPerM: 0.85,
          spanLengthMeters: 50.0,
        },
      ],
    };

    const reportGrade1 = evaluateCsaPoleStress(poleConfigGrade1);
    assert.equal(reportGrade1.standard, "CSA_C22_3_NO1");
    assert.equal(reportGrade1.resistanceFactorPhi, 0.65);
    assert.equal(reportGrade1.settingDepthMeters, 1.8); // 0.1 * 12 + 0.6 = 1.8 m

    // Grade 2 should have higher capacity (phi = 0.80)
    const poleConfigGrade2: CsaPoleAnalysisConfig = {
      ...poleConfigGrade1,
      constructionGrade: "grade-2",
    };
    const reportGrade2 = evaluateCsaPoleStress(poleConfigGrade2);
    assert.equal(reportGrade2.resistanceFactorPhi, 0.80);
    assert.ok(reportGrade2.resistingMomentCapacityNm > reportGrade1.resistingMomentCapacityNm);
    assert.ok(reportGrade2.poleCapacityUtilizationPercent < reportGrade1.poleCapacityUtilizationPercent);
  });

  it("audits CSA C22.3 Table 1 road clearance and Table 3 vertical power separation", () => {
    // Compliant setup
    const compliant = auditCsaClearances({
      voltageLevel: "secondary-under-750V",
      powerHeightMeters: 8.5,
      commHeightMeters: 7.5, // 1.0 m separation >= 1.0 m required
      roadType: "provincial-highway",
      commMidSpanSagMeters: 1.8, // Mid-span height = 7.5 - 1.8 = 5.7 m >= 5.3 m required
    });
    assert.equal(compliant.isSeparationCompliant, true);
    assert.equal(compliant.isRoadClearanceCompliant, true);
    assert.equal(compliant.violations.length, 0);

    // Violation setup (insufficient separation for 22 kV primary)
    const violated = auditCsaClearances({
      voltageLevel: "primary-up-to-22kV", // requires 1.8 m
      powerHeightMeters: 8.5,
      commHeightMeters: 7.5, // only 1.0 m separation
      roadType: "railway", // requires 6.7 m
      commMidSpanSagMeters: 1.8, // mid-span = 5.7 m < 6.7 m
    });
    assert.equal(violated.isSeparationCompliant, false);
    assert.equal(violated.isRoadClearanceCompliant, false);
    assert.equal(violated.violations.length, 2);
  });
});

describe("Eurocode EN 1991-1-4 & EN 50341 Mast Structural Loading Suite", () => {
  it("calculates peak velocity pressure across Eurocode terrain categories", () => {
    const vb = 26.0; // 26 m/s basic wind speed
    const height = 20.0; // 20m above ground

    // Category 0 (Sea/Coastal) should experience much higher peak pressure than Category IV (Urban)
    const qpCoastal = calculateEurocodePeakWindPressure(height, vb, "0");
    const qpUrban = calculateEurocodePeakWindPressure(height, vb, "IV");

    assert.ok(qpCoastal > 1000.0); // Typically > 1000 Pa
    assert.ok(qpUrban < qpCoastal * 0.5); // Dense urban friction reduces wind significantly
  });

  it("evaluates Eurocode 3 ULS mast utilization under ISO 12494 ice class G2", () => {
    const mastConfig: EurocodeMastLoadingConfig = {
      mastId: "euro-monopole-cell",
      basicWindVelocityMPerS: 25.0,
      terrainCategory: "II",
      iceClass: "G2", // 20 mm radial glaze ice
      overallHeightMeters: 18.0,
      groundSectionModulusM3: 0.0025, // 2500 cm^3
      characteristicYieldStrengthMpa: 355.0, // S355 steel
      partialFactorGammaM: 1.10,
      cables: [
        {
          id: "feeders-and-fiber",
          attachmentHeightMeters: 16.0,
          bareDiameterMm: 30.0,
          bareWeightKgPerM: 1.5,
          spanLengthMeters: 40.0,
        },
      ],
    };

    const report = evaluateEurocodeMastLoading(mastConfig);
    assert.equal(report.standard, "EN_50341_EUROCODE");
    assert.equal(report.iceClass, "G2");
    assert.ok(report.designBendingMomentEdNm > 0);
    assert.ok(report.designResistanceMomentRdNm > 500000); // S355 steel section capacity
    assert.ok(report.utilizationRatioPercent > 0 && report.utilizationRatioPercent < 100);
    assert.equal(report.isCompliant, true);
  });
});
