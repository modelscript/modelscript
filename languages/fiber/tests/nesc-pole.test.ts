// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditPoleMakeReady,
  computeNescCableLoading,
  computeSpanTension,
  evaluatePoleLoading,
  type AerialCableSpecification,
  type PoleAttachmentLoad,
  type PoleAttachmentPosition,
  type PoleSpecification,
} from "../src/index.js";

describe("NESC Rule 250 & ANSI O5.1 Pole Structural FEA Suite", () => {
  const standardCable: AerialCableSpecification = {
    id: "FIBER-48F-ADSS",
    name: "48-Fiber All-Dielectric Self-Supporting Cable",
    outerDiameterInches: 0.55,
    weightLbsPerFt: 0.12,
    ratedBreakingStrengthLbs: 4500.0,
  };

  it("calculates NESC Rule 250 Heavy, Medium, and Light cable unit loading", () => {
    // 1. Heavy District: 0.50" radial ice, 4 psf wind, 0.30 lb/ft K-factor
    const heavy = computeNescCableLoading(standardCable, "heavy");
    assert.equal(heavy.district, "heavy");
    assert.equal(heavy.bareDiameterInches, 0.55);
    assert.equal(heavy.icedDiameterInches, 1.55); // 0.55 + 2 * 0.50
    assert.ok(heavy.verticalIceWeightLbsPerFt > 0.6, "Ice weight should be > 0.6 lb/ft");
    assert.ok(heavy.transverseWindLoadLbsPerFt > 0.5, "Wind load should be > 0.5 lb/ft");
    assert.ok(heavy.nescResultantLoadLbsPerFt > 1.1, "Resultant should be > 1.1 lb/ft with K-factor");

    // 2. Medium District: 0.25" radial ice, 4 psf wind, 0.20 lb/ft K-factor
    const medium = computeNescCableLoading(standardCable, "medium");
    assert.equal(medium.district, "medium");
    assert.equal(medium.icedDiameterInches, 1.05); // 0.55 + 2 * 0.25
    assert.ok(medium.nescResultantLoadLbsPerFt < heavy.nescResultantLoadLbsPerFt);

    // 3. Light District: 0.0" radial ice, 9 psf wind, 0.05 lb/ft K-factor
    const light = computeNescCableLoading(standardCable, "light");
    assert.equal(light.district, "light");
    assert.equal(light.icedDiameterInches, 0.55);
    assert.equal(light.verticalIceWeightLbsPerFt, 0.0);
    assert.ok(light.transverseWindLoadLbsPerFt > 0.4);
  });

  it("evaluates catenary span tension and sag within NESC Rule 261H limits", () => {
    const heavyLoading = computeNescCableLoading(standardCable, "heavy");
    const span = computeSpanTension(heavyLoading, 200.0, {
      targetSagRatioPercent: 2.0, // 4 ft sag on 200 ft span
      ratedBreakingStrengthLbs: 4500.0,
    });

    assert.equal(span.spanLengthFeet, 200.0);
    assert.equal(span.sagFeet, 4.0);
    assert.ok(span.horizontalTensionLbs > 1000.0, "Tension should be > 1,000 lbs");
    assert.ok(span.safetyFactor > 1.5, "Safety factor should be > 1.5");
    assert.equal(span.isWithinTensionLimit, true);
  });

  it("evaluates ANSI O5.1 wood pole bending capacity and % pole loading", () => {
    const pole: PoleSpecification = {
      poleId: "POLE-DIST-101",
      species: "southern-yellow-pine",
      poleClass: "4",
      lengthFeet: 40.0,
    };

    // Attachments: Primary at 33 ft, Secondary at 28 ft, Telco at 22 ft, CATV at 21 ft, Proposed Fiber at 20 ft
    const attachments: PoleAttachmentLoad[] = [
      {
        attachmentId: "PRI-1",
        description: "3-Phase 13.2kV Primary Power",
        heightAboveGroundFeet: 33.0,
        transverseWindForceLbs: 95.0,
        tensionForceLbs: 120.0,
      },
      {
        attachmentId: "SEC-1",
        description: "120/240V Triplex Secondary Neutral",
        heightAboveGroundFeet: 28.0,
        transverseWindForceLbs: 65.0,
        tensionForceLbs: 50.0,
      },
      {
        attachmentId: "COMM-TELCO",
        description: "Incumbent Telco Copper 100-pr",
        heightAboveGroundFeet: 22.0,
        transverseWindForceLbs: 40.0,
        tensionForceLbs: 25.0,
      },
      {
        attachmentId: "COMM-FIBER",
        description: "Proposed 48-Fiber Strand Attachment",
        heightAboveGroundFeet: 20.0,
        transverseWindForceLbs: 25.0,
        tensionForceLbs: 15.0,
      },
    ];

    const resultGradeC = evaluatePoleLoading(pole, attachments, {
      grade: "C-elsewhere",
      windPressurePsf: 4.0,
    });

    assert.equal(resultGradeC.poleId, "POLE-DIST-101");
    assert.equal(resultGradeC.species, "Southern Yellow Pine");
    assert.equal(resultGradeC.poleClass, "Class 4");
    assert.equal(resultGradeC.settingDepthFeet, 6.0); // 10% of 40 + 2 = 6 ft
    assert.equal(resultGradeC.heightAboveGroundFeet, 34.0);
    assert.ok(resultGradeC.sectionModulusCubicInches > 120.0);
    assert.ok(resultGradeC.nominalBendingCapacityFtLbs > 80000.0);
    assert.ok(resultGradeC.percentPoleLoading > 0.0);
    assert.ok(resultGradeC.percentPoleLoading < 100.0, "Pole should have adequate capacity under Grade C");
    assert.equal(resultGradeC.isCompliant, true);

    // Overloaded case with Grade B crossing factors and heavy line turn
    const heavyAttachments: PoleAttachmentLoad[] = attachments.map((a) => ({
      ...a,
      tensionForceLbs: a.tensionForceLbs * 8.0, // Heavy dead-end / sharp corner
    }));

    const resultOverloaded = evaluatePoleLoading(pole, heavyAttachments, {
      grade: "B",
      guy: {
        guyId: "GUY-01",
        attachmentHeightFeet: 28.0,
        leadDistanceFeet: 20.0,
      },
    });

    assert.equal(resultOverloaded.constructionGrade, "B");
    assert.ok(resultOverloaded.guyAnalysis !== undefined);
    assert.ok(resultOverloaded.guyAnalysis!.requiredGuyTensionLbs > 1000.0);
    assert.ok(resultOverloaded.guyAnalysis!.guyAngleDeg > 30.0);
  });

  it("audits NESC Table 235-5 vertical clearances and detects safety zone violations", () => {
    const existing: PoleAttachmentPosition[] = [
      {
        id: "PRI-1",
        ownerName: "Utility Electric",
        utilityType: "electric-primary",
        heightAboveGroundFeet: 33.0,
      },
      {
        id: "SEC-1",
        ownerName: "Utility Electric",
        utilityType: "electric-secondary",
        heightAboveGroundFeet: 28.0,
      },
      {
        id: "XFMR-DRIP",
        ownerName: "Utility Electric",
        utilityType: "electric-equipment",
        heightAboveGroundFeet: 26.5, // Drip loop
      },
      {
        id: "TELCO-1",
        ownerName: "Verizon",
        utilityType: "telco-incumbent",
        heightAboveGroundFeet: 21.0,
      },
    ];

    // Case 1: Non-compliant proposed fiber placed at 25.0 ft AGL (violates 30" drip loop and 40" secondary)
    const proposedViolating: PoleAttachmentPosition = {
      id: "FIBER-PROP",
      ownerName: "FiberNet Metro",
      utilityType: "third-party-fiber",
      heightAboveGroundFeet: 25.0, // 28.0 - 25.0 = 3 ft = 36 inches (< 40"), 26.5 - 25.0 = 1.5 ft = 18 inches (< 30")
      midSpanSagFeet: 2.5,
    };

    const audit1 = auditPoleMakeReady("POLE-7721", existing, proposedViolating, {
      crossing: "roadway",
    });

    assert.equal(audit1.isPermitApprovedWithoutChanges, false);
    assert.ok(audit1.clearanceViolations.length >= 2);
    assert.ok(audit1.clearanceViolations.some((v) => v.violationCode === "CWSZ_SECONDARY"));
    assert.ok(audit1.clearanceViolations.some((v) => v.violationCode === "CWSZ_DRIP_LOOP"));
    assert.ok(audit1.makeReadyRecommendations.length > 0);
    assert.ok(audit1.jointUseExhibitText.includes("MAKE-READY WORK ORDER REQUIRED"));

    // Case 2: Compliant proposed fiber placed at 22.5 ft AGL
    // 28.0 - 22.5 = 5.5 ft = 66" (> 40"), 26.5 - 22.5 = 4.0 ft = 48" (> 30"), 22.5 - 21.0 = 1.5 ft = 18" (> 12")
    const proposedCompliant: PoleAttachmentPosition = {
      id: "FIBER-PROP-OK",
      ownerName: "FiberNet Metro",
      utilityType: "third-party-fiber",
      heightAboveGroundFeet: 22.5,
      midSpanSagFeet: 2.0, // 22.5 - 2.0 = 20.5 ft ground clearance (> 15.5 ft roadway requirement)
    };

    const audit2 = auditPoleMakeReady("POLE-7721", existing, proposedCompliant, {
      crossing: "roadway",
    });

    assert.equal(audit2.isPermitApprovedWithoutChanges, true);
    assert.equal(audit2.clearanceViolations.length, 0);
    assert.ok(audit2.jointUseExhibitText.includes("APPROVED (Zero Make-Ready Required)"));
  });
});
