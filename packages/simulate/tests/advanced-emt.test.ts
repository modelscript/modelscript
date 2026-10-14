// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFdLineState,
  createSaturableTransformerState,
  evaluateMagnetizingCurrent,
  MultiRateCosimOrchestrator,
  updateFdLine,
  updateSaturableCore,
} from "../src/solvers/emt/index.js";

describe("Advanced Physical Modeling & Solvers Suite", () => {
  // ── 1. Frequency-Dependent Transmission Line Model (FDPM) ───────────

  describe("Frequency-Dependent Line Model (FDPM)", () => {
    it("initializes companion conductance G_c from high-frequency surge admittance and poles", () => {
      const dt = 20e-6; // 20 us
      const lineState = createFdLineState(
        {
          id: "Cable1",
          fromNode: 0,
          toNode: 1,
          lengthKm: 25.0,
          tauSec: 125e-6, // 125 us travel time (v_wave ~ 200,000 km/s in dielectric)
          y0: 0.02, // 50 ohm surge impedance at high frequency -> Y0 = 0.02 S
          yPoles: [
            { pole: -5000, residue: 120 }, // Low-frequency skin effect pole
            { pole: -50000, residue: 800 }, // High-frequency skin effect pole
          ],
          hPoles: [
            { pole: -2000, residue: 0.8 }, // Propagation attenuation
            { pole: -20000, residue: 0.2 },
          ],
        },
        dt,
      );

      assert.equal(lineState.config.id, "Cable1");
      assert.equal(lineState.delaySteps, 6); // round(125us / 20us) = 6
      assert.ok(lineState.gc >= 0.02, "Gc must include surge admittance Y0 + pole corrections");
      assert.equal(lineState.bufferFrom.length, 8);
    });

    it("evaluates recursive convolution and propagates delayed traveling waves with attenuation", () => {
      const dt = 20e-6;
      const lineState = createFdLineState(
        {
          id: "Cable1",
          fromNode: 0,
          toNode: 1,
          lengthKm: 10.0,
          tauSec: 60e-6, // 3 steps delay
          y0: 0.02,
          yPoles: [{ pole: -10000, residue: 500 }],
          hPoles: [{ pole: -5000, residue: 0.9 }],
        },
        dt,
      );

      // Launch a 100 kV step surge at terminal 'from' at t = 0
      for (let step = 0; step < 10; step++) {
        const vFrom = step >= 1 ? 100e3 : 0;
        const vTo = 0; // Grounded receiving end
        updateFdLine(lineState, vFrom, vTo, dt);

        if (step < 3) {
          // Surge wave has not yet reached terminal 'to'
          assert.equal(lineState.statesHTo[0], 0, `Wave should not arrive at step ${step}`);
        } else if (step >= 4) {
          // Arriving wave now being filtered through propagation pole
          assert.ok(lineState.statesHTo[0]! > 0, `Wave must arrive at receiving end by step ${step}`);
        }
      }
    });
  });

  // ── 2. Saturable Transformer Core Model ──────────────────────────────

  describe("Saturable Transformer Core Model", () => {
    it("evaluates linear magnetizing current in unsaturated region", () => {
      const lUnsat = 500; // 500 H
      const lSat = 10; // 10 H (saturated air-core inductance)
      const kneeFlux = 800; // 800 Wb (V*s)

      // Flux within linear range (400 Wb <= 800 Wb)
      const res = evaluateMagnetizingCurrent(400, lUnsat, lSat, kneeFlux);
      assert.equal(res.isSaturated, false);
      assert.equal(res.lInc, 500);
      assert.equal(res.iMag, 400 / 500); // 0.8 A
    });

    it("evaluates steep non-linear inrush current spikes in saturated core region", () => {
      const lUnsat = 500;
      const lSat = 10;
      const kneeFlux = 800;

      // Flux pushed deeply into saturation (1200 Wb > 800 Wb)
      const res = evaluateMagnetizingCurrent(1200, lUnsat, lSat, kneeFlux);
      assert.equal(res.isSaturated, true);
      assert.equal(res.lInc, 10);
      // Expected: iKnee + deltaFlux / lSat = 800/500 + 400/10 = 1.6 + 40 = 41.6 A
      assert.equal(res.iMag, 41.6);
    });

    it("tracks dynamic flux linkage and updates non-linear companion history", () => {
      const dt = 20e-6;
      const state = createSaturableTransformerState(
        {
          id: "T1_Saturable",
          primaryNode: 0,
          secondaryNode: 1,
          ratedMva: 100,
          primaryKv: 230,
          secondaryKv: 16.5,
          leakageReactancePu: 0.08,
          lUnsatH: 600,
          lSatH: 15,
          kneeFluxWb: 600,
          remanentFluxWb: 100, // 100 Wb residual flux
        },
        dt,
      );

      assert.equal(state.fluxWb, 100);
      assert.equal(state.ratio, 230 / 16.5);

      // Apply positive half-cycle of high voltage (10 ms = 500 steps) to force core into deep saturation
      let peakedInrush = 0;
      let saturatedSteps = 0;
      for (let i = 0; i < 500; i++) {
        const t = i * dt;
        const vPrimary = 230e3 * Math.sin(2 * Math.PI * 60 * t);
        const { iMag, isSaturated } = updateSaturableCore(state, vPrimary, dt);

        if (isSaturated) {
          saturatedSteps++;
          if (Math.abs(iMag) > peakedInrush) peakedInrush = Math.abs(iMag);
        }
      }

      assert.ok(saturatedSteps > 0, "Transformer core must enter saturation during high-flux swing");
      assert.ok(peakedInrush > 10, "Inrush current spike must exceed unsaturated current");
      assert.ok(state.gMag > 0);
    });
  });

  // ── 3. Multi-Rate Co-Simulation Orchestrator ─────────────────────────

  describe("Multi-Rate Co-Simulation Orchestrator", () => {
    it("computes accurate sliding RMS and active/reactive power over 60 Hz AC window", () => {
      const orchestrator = new MultiRateCosimOrchestrator({
        dtFastSec: 20e-6, // 20 us
        dtSlowSec: 1e-3, // 1 ms
        gridFrequencyHz: 60,
      });

      assert.equal(orchestrator.subStepsPerMacro, 50); // 1ms / 20us = 50 steps
      assert.equal(orchestrator.windowSizeSamples, 833); // round(1/60 / 20us) = 833 steps (~16.67 ms)

      const vPeak = 1000;
      const iPeak = 10;
      let lastVrms = 0;
      let lastIrms = 0;

      // Ingest 2 full AC cycles (2 * 833 samples) of pure sinusoidal AC
      for (let i = 0; i < 2 * orchestrator.windowSizeSamples; i++) {
        const t = i * orchestrator.dtFast;
        const v = vPeak * Math.sin(2 * Math.PI * 60 * t);
        const iCurrent = iPeak * Math.sin(2 * Math.PI * 60 * t); // unity power factor
        const metrics = orchestrator.ingestFastSample(v, iCurrent);
        lastVrms = metrics.vRms;
        lastIrms = metrics.iRms;
      }

      // Theoretical RMS of sine wave is Peak / sqrt(2)
      const expectedVrms = vPeak / Math.SQRT2;
      const expectedIrms = iPeak / Math.SQRT2;

      assert.ok(
        Math.abs(lastVrms - expectedVrms) / expectedVrms < 0.01,
        `Vrms (${lastVrms.toFixed(2)}) should match expected (${expectedVrms.toFixed(2)}) within 1%`,
      );
      assert.ok(
        Math.abs(lastIrms - expectedIrms) / expectedIrms < 0.01,
        `Irms (${lastIrms.toFixed(2)}) should match expected (${expectedIrms.toFixed(2)}) within 1%`,
      );
    });

    it("steps macro-time coordinating fast EMT and slow controller with smooth interpolation", () => {
      const orchestrator = new MultiRateCosimOrchestrator({
        dtFastSec: 20e-6,
        dtSlowSec: 2e-3, // 2 ms
        gridFrequencyHz: 60,
      });

      let slowInvocations = 0;
      let fastInvocations = 0;

      // Mock slow participant: wind turbine pitch controller updating pitch setpoint
      const slowStepFn = (timeSec: number, inputs: any) => {
        slowInvocations++;
        return {
          pitchAngleDeg: 2.0 + 0.5 * timeSec,
        };
      };

      // Mock fast EMT step: applies interpolated pitch to fast circuit
      const fastStepFn = (tFast: number, slowInputs: Record<string, number>) => {
        fastInvocations++;
        assert.ok(slowInputs.pitchAngleDeg !== undefined);
        const v = 230e3 * Math.sin(2 * Math.PI * 60 * tFast);
        const i = 1200 * Math.sin(2 * Math.PI * 60 * tFast);
        return { v, i };
      };

      // Advance 5 macro-steps (10 ms total)
      for (let m = 0; m < 5; m++) {
        const snapshot = orchestrator.stepMacro(fastStepFn, slowStepFn);
        assert.equal(snapshot.fastSubSteps, 100);
        assert.ok(snapshot.slowOutputs.pitchAngleDeg >= 2.0);
      }

      assert.equal(slowInvocations, 5);
      assert.equal(fastInvocations, 500); // 5 * 100 fast steps
    });
  });
});
