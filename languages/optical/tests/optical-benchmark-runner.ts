// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for OpenROADM / Optical Long-Haul DWDM Transmission & Photonic Network Modeling.
 *
 * Evaluates:
 * 1. Multi-span 800 Gbps coherent DWDM link (6 spans x 100 km = 600 km SSMF fiber)
 * 2. Gaussian Noise (GN-model) non-linear interference (NLI) efficiency
 * 3. Optical Signal-to-Noise Ratio (OSNR) and Generalized SNR (GSNR) margin
 * 4. Dynamic EDFA gain saturation ODE lowering to DAEBuilder linear arena
 */

import assert from "node:assert/strict";
import {
  computeSpanNli,
  createEmptyOpticalTopology,
  lowerOpticalEdfaToDae,
  solveChannelTransmission,
  type OpticalChannel,
  type OpticalNode,
  type OpticalSpan,
  type TransmissionMetrics,
} from "../src/index.js";

export interface OpticalBenchmarkMetrics {
  totalSpans: number;
  totalLengthKm: number;
  baudRateGbaud: number;
  nliEfficiencyPerW2: number;
  gsnrDb: number;
  osnrMarginDb: number;
  edfaDaeVarCount: number;
  edfaDaeEqCount: number;
}

export function runOpticalBenchmark(): OpticalBenchmarkMetrics {
  // 1. Evaluate Gaussian Noise Model (GN-model) for coherent 800G channel
  const nli = computeSpanNli({
    lengthKm: 100.0,
    attenuationDbPerKm: 0.2,
    dispersionPsPerNmKm: 16.7,
    nonLinearCoeffPerWKm: 1.3,
    wavelengthNm: 1550.0,
    baudRateGbaud: 64.0,
    totalChannels: 48,
    channelSpacingGhz: 75.0,
  });

  assert.ok(nli.effectiveLengthKm > 0 && nli.effectiveLengthKm < 100.0);
  assert.ok(nli.nliEfficiencyPerW2 > 0);

  // 2. Build 6-span transcontinental DWDM link (600 km)
  const topo = createEmptyOpticalTopology("TransCon-800G-Backbone");

  const nodeA: OpticalNode = {
    id: "ROADM-EAST",
    name: "New York Hub",
    nodeType: "rdm",
    degrees: [{ degreeNumber: 1, maxWavelengths: 96 }],
    srgs: [{ srgNumber: 1, maxAddDropWavelengths: 96, isColorless: true, isDirectionless: true, isContentionless: true }],
    ports: [],
  };

  const nodeB: OpticalNode = {
    id: "ROADM-WEST",
    name: "Chicago Hub",
    nodeType: "rdm",
    degrees: [{ degreeNumber: 1, maxWavelengths: 96 }],
    srgs: [{ srgNumber: 1, maxAddDropWavelengths: 96, isColorless: true, isDirectionless: true, isContentionless: true }],
    ports: [],
  };

  topo.addNode(nodeA);
  topo.addNode(nodeB);

  const spanIds: string[] = [];
  const numSpans = 6;
  for (let i = 1; i <= numSpans; i++) {
    const spanId = `SPAN-NY-CHI-${i}`;
    spanIds.push(spanId);
    const span: OpticalSpan = {
      id: spanId,
      fromNodeId: i === 1 ? "ROADM-EAST" : `ILA-${i - 1}`,
      toNodeId: i === numSpans ? "ROADM-WEST" : `ILA-${i}`,
      lengthKm: 100.0,
      fiberType: "SSMF",
      attenuationDbPerKm: 0.20,
      dispersionPsPerNmKm: 16.7,
      pmdPsPerSqrtKm: 0.04,
      nonLinearCoeffPerWKm: 1.3,
      amplifiers: [
        {
          id: `EDFA-INLINE-${i}`,
          ampType: "edfa",
          gainDb: 20.0,
          noiseFigureDb: 5.5,
          maxOutputPowerDbm: 21.0,
        },
      ],
    };
    topo.addSpan(span);
  }

  const channel: OpticalChannel = {
    id: "CH-800G-TERABIT",
    sourceNodeId: "ROADM-EAST",
    destinationNodeId: "ROADM-WEST",
    centerFrequencyThz: 193.1,
    baudRateGbaud: 64.0,
    modulation: "PM-16QAM",
    launchPowerDbm: 0.0,
    requiredOsnrDb: 18.0,
    pathSpanIds: spanIds,
  };
  topo.addChannel(channel);

  const metrics: TransmissionMetrics = solveChannelTransmission(topo, channel);

  assert.equal(metrics.totalLengthKm, 600.0);
  assert.ok(metrics.gsnrDb > 14.0, `Expected GSNR > 14 dB, got ${metrics.gsnrDb}`);
  assert.ok(metrics.osnrMarginDb > 0, `Expected positive OSNR margin, got ${metrics.osnrMarginDb}`);

  // 3. Lower dynamic EDFA gain saturation state equations to DAEBuilder linear arena
  const dae = lowerOpticalEdfaToDae({
    smallSignalGainDb: 22.0,
    saturationPowerMilliwatts: 20.0,
    fluorescenceLifetimeMs: 10.0,
  });

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  // Variables: G_0, P_sat, tau, P_in, G, P_out (6 variables)
  // Equations: 3 parameters + P_out + der(G) (5 equations)
  assert.equal(varCount, 6);
  assert.equal(eqCount, 5);

  return {
    totalSpans: numSpans,
    totalLengthKm: metrics.totalLengthKm,
    baudRateGbaud: 64.0,
    nliEfficiencyPerW2: nli.nliEfficiencyPerW2,
    gsnrDb: metrics.gsnrDb,
    osnrMarginDb: metrics.osnrMarginDb,
    edfaDaeVarCount: varCount,
    edfaDaeEqCount: eqCount,
  };
}

if (process.argv[1]?.endsWith("optical-benchmark-runner.ts")) {
  const m = runOpticalBenchmark();
  console.log("Optical Benchmark Results:", m);
}
