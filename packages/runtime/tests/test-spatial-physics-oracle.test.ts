// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SemanticTheoryCoordinator, SpatialPhysicsOracle } from "../src/index.js";

describe("SpatialPhysicsOracle: Continuum Mechanics, FEA & CAD Formal Verification", () => {
  it("verifies FEA material yield integrity and margin of safety (SAT vs UNSAT)", () => {
    const oracle = new SpatialPhysicsOracle();

    // 1. SAT: Titanium Ti-6Al-4V aerospace bracket under rated flight load
    // Yield strength = 880 MPa, Safety Factor Sf = 1.5 -> Allowable = 586.67 MPa
    // Max simulated von Mises stress = 420 MPa (< 586.67 MPa)
    oracle.assertStressMeasurement({
      partName: "TiBracket_01",
      maxVonMisesPa: 420e6,
      yieldStrengthPa: 880e6,
      safetyFactor: 1.5,
      ultimateStrengthPa: 950e6,
      ultimateSafetyFactor: 2.0,
      loadCase: "2.5G_PullUp",
    });

    const satRes = oracle.checkSat();
    assert.equal(satRes.isSat, true, "Bracket within allowable stress must be SAT");

    const model = oracle.getModel();
    assert.ok(model.stresses["TiBracket_01"]);
    assert.equal(model.stresses["TiBracket_01"].status, "SAT");
    assert.ok(model.stresses["TiBracket_01"].marginOfSafety > 0);

    // 2. UNSAT: Overload condition exceeding allowable yield stress
    oracle.assertStressMeasurement({
      partName: "TiBracket_01",
      maxVonMisesPa: 640e6, // Exceeds allowable 586.67 MPa
      yieldStrengthPa: 880e6,
      safetyFactor: 1.5,
    });

    const unsatRes = oracle.checkSat();
    assert.equal(unsatRes.isSat, false, "Overloaded bracket exceeding allowable yield stress must be UNSAT");
    assert.ok(unsatRes.conflict, "Conflict clause must be emitted");
    assert.match(unsatRes.conflict.explanation, /Material Yield Stress Failure/);
    assert.ok(unsatRes.conflict.culpritEntities.includes("TiBracket_01"));
    assert.match(unsatRes.conflict.explanation, /Margin of safety MS = -0.083 < 0/);
  });

  it("detects ultimate tensile stress failure when ultimate safety factor is violated", () => {
    const oracle = new SpatialPhysicsOracle();

    // Yield = 500 MPa (Sf = 1.0 -> allow 500 MPa)
    // Ultimate = 600 MPa (Sf_ult = 1.5 -> allow 400 MPa)
    // Stress = 450 MPa: Passes yield with Sf=1.0, but fails ultimate with Sf=1.5!
    oracle.assertStressMeasurement({
      partName: "PressureVesselShell",
      maxVonMisesPa: 450e6,
      yieldStrengthPa: 500e6,
      safetyFactor: 1.0,
      ultimateStrengthPa: 600e6,
      ultimateSafetyFactor: 1.5,
    });

    const res = oracle.checkSat();
    assert.equal(res.isSat, false, "Must fail ultimate tensile stress criterion");
    assert.ok(res.conflict);
    assert.match(res.conflict.explanation, /Material Ultimate Tensile Stress Failure/);
    assert.ok(res.conflict.culpritEntities.includes("PressureVesselShell"));
  });

  it("verifies structural deflection limits on cantilever wing spar", () => {
    const oracle = new SpatialPhysicsOracle();

    // 1. Normal gust deflection: 180 mm <= 250 mm allowable
    oracle.assertDeflectionMeasurement({
      partName: "CompositeWingSpar",
      maxDisplacementMeters: 0.18,
      allowableDisplacementMeters: 0.25,
      direction: "z",
      location: "wing_tip",
    });

    assert.equal(oracle.checkSat().isSat, true);

    // 2. Severe gust: 285 mm > 250 mm allowable
    oracle.assertDeflectionMeasurement({
      partName: "CompositeWingSpar",
      maxDisplacementMeters: 0.285,
      allowableDisplacementMeters: 0.25,
      direction: "z",
      location: "wing_tip",
    });

    const res = oracle.checkSat();
    assert.equal(res.isSat, false);
    assert.ok(res.conflict);
    assert.match(res.conflict.explanation, /Structural Deflection Exceeded/);
    assert.match(res.conflict.explanation, /CompositeWingSpar/);
    assert.match(res.conflict.explanation, /285\.000 mm/);
    assert.match(res.conflict.explanation, /250\.000 mm/);
  });

  it("verifies Fluid-Structure Interaction (FSI) 3D force equilibrium at wet boundary", () => {
    const oracle = new SpatialPhysicsOracle();

    // 1. Balanced FSI: Fluid aero load balanced by structural reaction
    // F_fluid + F_solid = [0, 0, 0]
    oracle.assertFsiForceEquilibrium({
      interfaceName: "HydrofoilWetSurface",
      fluidForce: [1250.0, -80.0, 4800.0],
      solidForce: [-1250.0, 80.0, -4800.0],
      tolerance: 5.0,
    });

    assert.equal(oracle.checkSat().isSat, true, "Balanced FSI interface must be SAT");

    // 2. Unbalanced FSI: Fluid aerodynamic pressure spike without structural counter-reaction
    oracle.assertFsiForceEquilibrium({
      interfaceName: "HydrofoilWetSurface",
      fluidForce: [1250.0, -80.0, 5300.0], // +500 N lift spike
      solidForce: [-1250.0, 80.0, -4800.0],
      tolerance: 10.0,
    });

    const res = oracle.checkSat();
    assert.equal(res.isSat, false, "FSI disequilibrium must trigger conflict clause");
    assert.ok(res.conflict);
    assert.match(res.conflict.explanation, /FSI Interface Force Disequilibrium/);
    assert.match(res.conflict.explanation, /500\.00 N/);
  });

  it("checks CAD solid B-Rep topology, watertightness and volume validity", () => {
    const oracle = new SpatialPhysicsOracle();

    // 1. Valid closed watertight B-Rep
    oracle.assertSolidGeometry({
      solidName: "ImpellerBlade",
      isWatertight: true,
      volumeM3: 0.00145,
      surfaceAreaM2: 0.082,
      boundingBox: {
        min: [-0.05, -0.05, 0.0],
        max: [0.05, 0.05, 0.12],
      },
    });

    assert.equal(oracle.checkSat().isSat, true);

    // 2. Open / non-watertight CAD shell
    oracle.reset();
    oracle.assertSolidGeometry({
      solidName: "DefectiveHousing",
      isWatertight: false,
      nonManifoldEdgeCount: 4,
      volumeM3: 0.003,
    });

    const unsatWatertight = oracle.checkSat();
    assert.equal(unsatWatertight.isSat, false);
    assert.match(unsatWatertight.conflict!.explanation, /Non-Watertight B-Rep Conflict/);
    assert.match(unsatWatertight.conflict!.explanation, /4 non-manifold edges/);

    // 3. Inverted / zero volume solid
    oracle.reset();
    oracle.assertSolidGeometry({
      solidName: "InvertedSolid",
      isWatertight: true,
      volumeM3: -0.0005,
    });

    const unsatVolume = oracle.checkSat();
    assert.equal(unsatVolume.isSat, false);
    assert.match(unsatVolume.conflict!.explanation, /Inverted\/Degenerate Geometry Conflict/);
  });

  it("supports trail-based pushLevel and popLevel backtracking", () => {
    const oracle = new SpatialPhysicsOracle();

    oracle.assertStressMeasurement({
      partName: "TurbineDisk",
      maxVonMisesPa: 300e6,
      yieldStrengthPa: 600e6,
      safetyFactor: 1.5, // Allowable 400 MPa -> SAT
    });

    assert.equal(oracle.checkSat().isSat, true);

    // Push level
    oracle.pushLevel();

    // Assert transient overspeed failure at level 1
    oracle.assertStressMeasurement({
      partName: "TurbineDisk",
      maxVonMisesPa: 480e6, // Exceeds 400 MPa allowable
      yieldStrengthPa: 600e6,
      safetyFactor: 1.5,
    });

    assert.equal(oracle.checkSat().isSat, false, "Level 1 must be UNSAT");

    // Pop level back to level 0
    oracle.popLevel();

    assert.equal(oracle.checkSat().isSat, true, "After popLevel, state must revert to SAT");
  });

  it("coordinates with SemanticTheoryCoordinator and Nelson-Oppen bound propagation", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const oracle = new SpatialPhysicsOracle();
    coordinator.registerOracle(oracle);

    // Assert valid FEA stress literal via coordinator
    coordinator.assertLiteral({
      predicate: "stressMeasurement",
      args: [
        {
          partName: "LandingGearStrut",
          maxVonMisesPa: 350e6,
          yieldStrengthPa: 700e6,
          safetyFactor: 1.4, // Allowable = 500 MPa
        },
      ],
      domain: "spatial_physics",
    });

    const satRes = coordinator.checkSat();
    assert.equal(satRes.isSat, true, "Coordinator checkSat must be SAT");

    // Check that equalities were propagated into coordinator
    const sharedEqs = coordinator.querySat().sharedEqualities;
    const stressEq = sharedEqs.find((e) => e.varA === "LandingGearStrut.max_von_mises");
    assert.ok(stressEq, "max_von_mises interval must be shared");
    assert.deepEqual(stressEq.bounds, [0, 350e6]);

    // Now impose an external specification bound via coordinator: max_von_mises <= 300 MPa
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["LandingGearStrut.max_von_mises", "<=", 300e6],
      domain: "spatial_physics",
    });

    const unsatRes = coordinator.checkSat();
    assert.equal(unsatRes.isSat, false, "Coordinator must detect conflict between FEA stress and external bound");
    assert.ok(unsatRes.conflict);
    assert.match(unsatRes.conflict.explanation, /Stress Bound Constraint Violation/);
    assert.ok(unsatRes.conflict.culpritEntities.includes("LandingGearStrut"));
  });
});
