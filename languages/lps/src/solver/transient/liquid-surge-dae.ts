// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Transient Liquid Surge & Water Hammer Solver.
 *
 * Implements Joukowsky wave propagation and rapid emergency shutdown (ESD)
 * valve closure pressure spikes for liquid transmission pipelines (ASME B31.4).
 */

import type { InlineValve, LpsModel, LpsPipe } from "../../types.js";
import { LiquidProperties } from "../eos/liquid-properties.js";
import { SlackLineSolver, type SlackLineSegmentResult } from "./slack-line-solver.js";

export interface SurgeResult {
  pipeName: string;
  valveName: string;
  steadyVelocity: number; // m/s
  waveSpeed: number; // m/s
  joukowskyDeltaP: number; // Pa
  peakSurgePressure: number; // Pa
  minimumPressure: number; // Pa
  maopExceeded: boolean;
  cavitationOccurred: boolean;
  slackSegment?: SlackLineSegmentResult | undefined;
  timeSeries: { time: number; pressure: number; velocity: number }[];
}

export class LiquidSurgeSolver {
  /**
   * Evaluates acoustic water hammer pressure spikes during rapid valve closure.
   */
  static evaluateValveClosureSurge(
    model: LpsModel,
    pipe: LpsPipe,
    valve: InlineValve,
    initialFlowRateM3PerSec = 0.5,
  ): SurgeResult {
    const area = Math.PI * (pipe.diameter / 2) ** 2;
    const v0 = initialFlowRateM3PerSec / area;

    // Default liquid properties (diesel / crude)
    const product = model.batches?.products[0] ?? {
      id: "crude",
      name: "Crude Oil",
      densityAtRef: 850.0,
      viscosityAtRef: 0.005,
      bulkModulus: 1.4e9,
      vaporPressure: 40e3,
    };

    const wallThickness = pipe.wallThickness ?? 0.0127; // 0.5 inch default
    const waveSpeed = LiquidProperties.getWaveSpeed(
      product.bulkModulus,
      product.densityAtRef,
      pipe.diameter,
      wallThickness,
    );

    // Joukowsky instant closure pressure rise: Delta P = rho * a * Delta v
    const deltaP = product.densityAtRef * waveSpeed * v0;

    // Time for wave reflection round trip: t_pipe = 2 * L / a
    const roundTripTime = (2 * pipe.length) / waveSpeed;
    const closingTime = Math.max(0.1, valve.closingTimeSeconds);

    // Effective surge rise factor (effective fraction for non-instantaneous closure)
    let effectiveRise = deltaP;
    if (closingTime > roundTripTime) {
      effectiveRise = deltaP * (roundTripTime / closingTime);
    }

    const basePressure = 30e5; // 30 bar base
    const peakSurgePressure = basePressure + effectiveRise;
    const minimumPressure = Math.max(0, basePressure - effectiveRise * 0.8);

    const maopLimit = pipe.maop * 1.1; // ASME B31.4 allows 10% transient surge over MAOP
    const maopExceeded = peakSurgePressure > maopLimit;
    const cavitationOccurred = minimumPressure <= product.vaporPressure;

    let slackSegment: SlackLineSegmentResult | undefined;
    if (cavitationOccurred || minimumPressure <= product.vaporPressure) {
      const fromZ = model.nodes.find((n) => n.name === pipe.fromNode)?.elevation ?? 100;
      const toZ = model.nodes.find((n) => n.name === pipe.toNode)?.elevation ?? 0;
      slackSegment = SlackLineSolver.evaluateSegment(pipe, fromZ, toZ, minimumPressure, initialFlowRateM3PerSec, {
        densityKgM3: product.densityAtRef,
        vaporPressurePa: product.vaporPressure,
        bulkModulusPa: product.bulkModulus,
      });
    }

    // Generate time series snapshot
    const timeSeries: { time: number; pressure: number; velocity: number }[] = [];
    const dt = 0.05;
    for (let t = 0; t <= closingTime * 2; t += dt) {
      const fracClosed = Math.min(1.0, t / closingTime);
      const currentV = v0 * (1.0 - fracClosed);
      let p = basePressure;
      if (t <= closingTime) {
        p += effectiveRise * fracClosed;
      } else {
        // Post-closure acoustic ringdown oscillation
        const decay = Math.exp(-0.5 * (t - closingTime));
        p += effectiveRise * decay * Math.cos((2 * Math.PI * (t - closingTime)) / roundTripTime);
      }
      timeSeries.push({ time: t, pressure: p, velocity: currentV });
    }

    return {
      pipeName: pipe.name,
      valveName: valve.name,
      steadyVelocity: v0,
      waveSpeed,
      joukowskyDeltaP: deltaP,
      peakSurgePressure,
      minimumPressure,
      maopExceeded,
      cavitationOccurred,
      slackSegment,
      timeSeries,
    };
  }
}
