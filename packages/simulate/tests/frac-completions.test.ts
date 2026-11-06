// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  bpmToM3PerSec,
  calculateCarterLeakoffRate,
  calculatePerforationFriction,
  calculatePowerLawFanningFriction,
  calculateSlurryDensity,
  estimateFractureParametersMhe,
  FracStageEngine,
  integrateHydrostaticPressure,
  parseFracTelemetryCsv,
  pascalsToPsi,
  ppaToKgPerM3,
  psiToPascals,
  ScreenoutDetector,
  solveCrossClusterFlowSplit,
  solveWellboreHydraulics,
  stepStageErosion,
  theoreticalPknCompliance,
  type FracTelemetrySample,
  type StageCompletionConfig,
  type WellboreGeometry,
} from "../src/twin/frac/index.js";

describe("Hydraulic Completions & Real-Time Frac Analytics Suite (@modelscript/simulate/twin/frac)", () => {
  // Test wellbore survey: 3000m TVD, 4500m MD (1500m horizontal lateral)
  const sampleSurvey: WellboreGeometry = {
    wellName: "Wolfcamp-3H",
    totalMeasuredDepth: 4500.0,
    trueVerticalDepth: 3000.0,
    maopPascals: psiToPascals(10500.0), // ~72.4 MPa
    surveyStations: [
      { measuredDepth: 0.0, trueVerticalDepth: 0.0, inclinationDeg: 0.0, innerDiameter: 0.1214 },
      { measuredDepth: 2500.0, trueVerticalDepth: 2500.0, inclinationDeg: 0.0, innerDiameter: 0.1214 },
      { measuredDepth: 3200.0, trueVerticalDepth: 3000.0, inclinationDeg: 90.0, innerDiameter: 0.1214 },
      { measuredDepth: 4500.0, trueVerticalDepth: 3000.0, inclinationDeg: 90.0, innerDiameter: 0.1214 },
    ],
  };

  // Test stage: 5 clusters, 0.42" perfs (0.01067m), 6 shots/cluster
  const sampleStage: StageCompletionConfig = {
    stageNumber: 14,
    casingDiameterMeters: 0.1214,
    closurePressurePascals: psiToPascals(6800.0), // ~46.9 MPa
    youngsModulusPascals: 3.2e10, // 32 GPa
    poissonsRatio: 0.24,
    clusters: [
      {
        clusterIndex: 0,
        measuredDepth: 4420.0,
        shotCount: 6,
        initialDiameterMeters: 0.010668,
        initialCd: 0.62,
      },
      {
        clusterIndex: 1,
        measuredDepth: 4440.0,
        shotCount: 6,
        initialDiameterMeters: 0.010668,
        initialCd: 0.62,
      },
      {
        clusterIndex: 2,
        measuredDepth: 4460.0,
        shotCount: 6,
        initialDiameterMeters: 0.010668,
        initialCd: 0.62,
      },
      {
        clusterIndex: 3,
        measuredDepth: 4480.0,
        shotCount: 6,
        initialDiameterMeters: 0.010668,
        initialCd: 0.62,
      },
      {
        clusterIndex: 4,
        measuredDepth: 4500.0,
        shotCount: 6,
        initialDiameterMeters: 0.010668,
        initialCd: 0.62,
      },
    ],
  };

  describe("1. Slurry Hydraulics & Mixture Density", () => {
    it("computes exact mass/volume balance slurry density", () => {
      // 0 ppa -> 1000 kg/m³
      const rhoClean = calculateSlurryDensity(0.0);
      assert.strictEqual(rhoClean, 1000.0);

      // 2 PPA = ~239.65 kg/m³ sand added to 1000 kg/m³ water (sand rho = 2650 kg/m³)
      // Volume = 1 + 239.65 / 2650 = 1.09043 m³
      // Mass = 1000 + 239.65 = 1239.65 kg
      // Expected rho = 1239.65 / 1.09043 = 1136.8 kg/m³ (~9.48 ppg)
      const conc2Ppa = ppaToKgPerM3(2.0);
      const rhoSlurry = calculateSlurryDensity(conc2Ppa, 1000.0, 2650.0);
      assert(rhoSlurry > 1130.0 && rhoSlurry < 1145.0, `Calculated slurry density: ${rhoSlurry}`);
    });

    it("evaluates hydrostatic pressure and power-law friction", () => {
      const rho = 1050.0;
      const pHyd = integrateHydrostaticPressure(sampleSurvey, rho);
      // Hydrostatic for 3000m TVD at 1050 kg/m³: rho * g * h = 1050 * 9.80665 * 3000 ~ 30.89 MPa (~4480 psi)
      assert(pHyd > 30.0e6 && pHyd < 32.0e6);

      // Power-law friction factor
      const fanningFric = calculatePowerLawFanningFriction(50000.0, 0.72);
      assert(fanningFric > 0.003 && fanningFric < 0.02);
    });

    it("translates surface treating pressure to BHTP accurately", () => {
      const sample: FracTelemetrySample = {
        timeSeconds: 120.0,
        surfacePressurePascals: psiToPascals(8200.0), // 8200 psi
        slurryRateM3PerSec: bpmToM3PerSec(85.0), // 85 bpm (~0.225 m³/s)
        proppantConcentrationKgPerM3: ppaToKgPerM3(1.5),
      };

      const hydraulics = solveWellboreHydraulics(sample, sampleSurvey);
      assert(hydraulics.slurryDensityKgPerM3 > 1050.0);
      assert(hydraulics.hydrostaticPressurePascals > 30.0e6);
      assert(hydraulics.pipeFrictionPressurePascals > 1.0e6);
      // BHTP = P_surf + P_hyd - P_fric
      const expectedBhtp =
        sample.surfacePressurePascals + hydraulics.hydrostaticPressurePascals - hydraulics.pipeFrictionPressurePascals;
      assert.strictEqual(hydraulics.bottomHoleTreatingPressurePascals, expectedBhtp);
    });
  });

  describe("2. Multi-Cluster Perforation Friction & Dynamic Erosion", () => {
    it("calculates perforation pressure drop adhering to orifice hydraulics", () => {
      const rate = 0.04; // m³/s (~15 bpm into 1 cluster)
      const shots = 6;
      const diam = 0.010668; // 0.42 in
      const cd = 0.65;
      const rho = 1100.0;

      const { pressureDropPascals, perforationVelocity } = calculatePerforationFriction(rate, shots, diam, cd, rho);

      assert(perforationVelocity > 50.0 && perforationVelocity < 100.0, `Velocity: ${perforationVelocity}`);
      assert(
        pressureDropPascals > 2.0e6,
        `dP_perf: ${pressureDropPascals} Pa (~${pascalsToPsi(pressureDropPascals)} psi)`,
      );
    });

    it("solves cross-cluster flow allocation and enforces strict mass conservation", () => {
      const totalRate = bpmToM3PerSec(80.0); // 80 bpm total
      const bhtp = psiToPascals(9500.0);
      const rho = 1050.0;

      const initialErosion = sampleStage.clusters.map((c) => ({
        clusterIndex: c.clusterIndex,
        currentDiameterMeters: c.initialDiameterMeters,
        currentCd: c.initialCd,
        cumulativeProppantKg: 0.0,
        allocatedRateM3PerSec: 0.0,
        rateSharePercent: 20.0,
        perforationVelocityMetersPerSec: 0.0,
        perforationPressureDropPascals: 0.0,
        isActive: true,
      }));

      const allocated = solveCrossClusterFlowSplit(totalRate, sampleStage, initialErosion, rho, bhtp);

      assert.strictEqual(allocated.length, 5);
      const sumAllocated = allocated.reduce((sum, c) => sum + c.allocatedRateM3PerSec, 0.0);
      // Flow split must equal total rate within 1e-4 tolerance
      assert(Math.abs(sumAllocated - totalRate) < 1e-4);

      // All 5 identical initial clusters should share approximately equal rates (~20% each)
      for (const c of allocated) {
        assert(c.rateSharePercent > 17.0 && c.rateSharePercent < 23.0);
        assert(c.isActive);
      }
    });

    it("demonstrates progressive perforation erosion over proppant pumping", () => {
      let stageSummary = {
        timeSeconds: 0.0,
        clusters: sampleStage.clusters.map((c) => ({
          clusterIndex: c.clusterIndex,
          currentDiameterMeters: c.initialDiameterMeters,
          currentCd: c.initialCd,
          cumulativeProppantKg: 0.0,
          allocatedRateM3PerSec: 0.0,
          rateSharePercent: 20.0,
          perforationVelocityMetersPerSec: 0.0,
          perforationPressureDropPascals: 0.0,
          isActive: true,
        })),
        clusterEfficiencyPercent: 100.0,
        averagePerfFrictionPascals: 0.0,
        totalProppantPumpedKg: 0.0,
      };

      const rate = bpmToM3PerSec(85.0);
      const propConc = ppaToKgPerM3(2.5); // heavy sand
      const rho = calculateSlurryDensity(propConc);
      const bhtp = psiToPascals(9800.0);

      // Pump for 600 seconds (10 minutes)
      for (let step = 0; step < 60; step++) {
        stageSummary = stepStageErosion(sampleStage, stageSummary, rate, propConc, rho, bhtp, 10.0);
      }

      // Assert that perforations eroded (diameter increased, Cd increased)
      for (const c of stageSummary.clusters) {
        assert(
          c.currentDiameterMeters > 0.010668,
          `Eroded diameter should be > 0.42", got: ${c.currentDiameterMeters}`,
        );
        assert(c.currentCd > 0.62, `Eroded Cd should be > 0.62, got: ${c.currentCd}`);
        assert(c.cumulativeProppantKg > 0.0);
      }
      assert(stageSummary.totalProppantPumpedKg > 10000.0);
    });
  });

  describe("3. Dynamic Fracture Compliance & MHE Calibration", () => {
    it("verifies PKN compliance and Carter leak-off equations", () => {
      const pknComp = theoreticalPknCompliance(100.0, 40.0, 3.0e10, 0.25);
      assert(pknComp > 1e-6 && pknComp < 1e-2);

      const leakoff = calculateCarterLeakoffRate(2.5e-4, 5000.0, 300.0);
      assert(leakoff > 0.05 && leakoff < 0.3);
    });

    it("calibrates fracture compliance and closure stress via MHE (L-BFGS-B)", () => {
      // Synthesize 10 rolling window observations with ground-truth compliance Cf = 2.5e-4
      const syntheticSamples = [];
      for (let t = 60; t <= 150; t += 10) {
        syntheticSamples.push({
          timeSeconds: t,
          bhtpPascals: psiToPascals(7400.0 + (t - 60) * 2.0),
          slurryRateM3PerSec: bpmToM3PerSec(80.0),
          perfFrictionPascals: psiToPascals(800.0),
        });
      }

      const mheResult = estimateFractureParametersMhe(syntheticSamples, {
        priorClosureStressPascals: psiToPascals(6800.0),
        priorCompliance: 2.0e-4,
        priorTortuosity: 1.5e7,
      });

      assert(mheResult.calibratedComplianceM3PerPa > 1e-6);
      assert(mheResult.calibratedClosureStressPa > 30.0e6);
      assert(mheResult.residualRmsPascals >= 0.0);
    });
  });

  describe("4. Nolte-Smith Diagnostic & Screen-Out Early Warning", () => {
    it("classifies Mode I normal propagation when slope is modest (b ~ 0.2)", () => {
      const detector = new ScreenoutDetector({ maopPascals: psiToPascals(10000.0) });

      // Stable slow pressure buildup
      let diag;
      for (let t = 10; t <= 100; t += 10) {
        const pNet = psiToPascals(800.0 + t * 1.5);
        const pSurf = psiToPascals(7500.0 + t * 1.5);
        diag = detector.evaluate(t, pNet, pSurf);
      }

      assert(diag !== undefined);
      assert.strictEqual(diag.regime, "MODE_I_STABLE_PROPAGATION");
      assert.strictEqual(diag.alarmLevel, "NORMAL");
    });

    it("escalates to WARNING and EMERGENCY_SHUTDOWN on rapid screen-out pressure spike", () => {
      const detector = new ScreenoutDetector({ maopPascals: psiToPascals(10000.0) });

      // Simulate a violent screen-out pressure surge: 8000 psi -> 9900 psi in 40 seconds
      let diag;
      for (let i = 0; i < 8; i++) {
        const t = 200 + i * 5;
        const pNet = psiToPascals(1000.0 + i * 300.0);
        const pSurf = psiToPascals(8000.0 + i * 250.0);
        diag = detector.evaluate(t, pNet, pSurf);
      }

      assert(diag !== undefined);
      // High slope (b > 1.0) and high pressure should trigger early warning or emergency shutdown
      assert(
        diag.regime === "MODE_III_TIP_SCREENOUT" || diag.regime === "MODE_IV_NEAR_WELLBORE_SCREENOUT",
        `Regime: ${diag.regime}`,
      );
      assert(
        diag.alarmLevel === "WARNING" || diag.alarmLevel === "EMERGENCY_SHUTDOWN",
        `Alarm level: ${diag.alarmLevel}`,
      );
      assert(diag.timeToScreenoutSeconds !== null && diag.timeToScreenoutSeconds < 120.0);
    });
  });

  describe("5. End-to-End FracStageEngine & Telemetry Streaming", () => {
    it("parses CSV telemetry and streams through FracStageEngine into circular ring buffer", () => {
      const csvData = `
# Time(s), SurfaceP(psi), SlurryRate(bpm), PropConc(ppa)
0,   7200, 40.0, 0.0
10,  7400, 60.0, 0.25
20,  7800, 80.0, 0.50
30,  8100, 85.0, 1.00
40,  8300, 85.0, 1.50
50,  8450, 85.0, 2.00
60,  8600, 85.0, 2.50
`;

      const samples = parseFracTelemetryCsv(csvData, "FIELD");
      assert.strictEqual(samples.length, 7);

      const engine = new FracStageEngine({
        survey: sampleSurvey,
        stage: sampleStage,
      });

      let finalSnapshot;
      for (const s of samples) {
        finalSnapshot = engine.processSample(s);
      }

      assert(finalSnapshot !== undefined);
      assert.strictEqual(finalSnapshot.timeSeconds, 60.0);
      assert(finalSnapshot.hydraulics.bottomHoleTreatingPressurePascals > 35.0e6);
      assert(finalSnapshot.erosion.clusterEfficiencyPercent >= 80.0);
      assert(finalSnapshot.compliance.complianceM3PerPascal > 0.0);

      // Ring buffer should contain 7 pushed snapshots
      assert.strictEqual(engine.buffer.getSampleCount(), 7);
      const timeRange = engine.buffer.getTimeRange();
      assert(timeRange !== null);
      assert.strictEqual(timeRange.startTime, 0.0);
      assert.strictEqual(timeRange.endTime, 60.0);
    });
  });
});
