// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Radio Access Networks (RAN) Industrial Benchmark Runner:
 * 5G C-Band Massive-MIMO & Multi-Hop Backhaul Network with NSMA Pattern Interpolation,
 * FCC OET-65 MPE RF Safety, ITU-R P.530 Propagation & DAE Arena Lowering.
 */

import { DAEBuilder } from "@modelscript/runtime";
import { parseNsmaAdf } from "../src/parser/nsma-parser.js";
import { interpolateAntennaGain } from "../src/solvers/pattern-interpolator.js";
import { computeFresnelRadiusMeters } from "../src/solvers/fresnel.js";
import { computeFsplDb } from "../src/solvers/itu-r-p530.js";
import { evaluateSiteMpe, type RfEmitterConfig } from "../src/em-safety/mpe-solver.js";
import { lowerRanNetworkToDae, type RanLinkParams } from "../src/dae/lowering.js";

export interface RanBenchmarkResult {
  name: string;
  numSectors: number;
  numBackhaulLinks: number;
  antennaPeakGainDbi: number;
  interpolatedBoresightGainDbi: number;
  mpeMaxTer: number;
  isMpeCompliant: boolean;
  totalBackhaulCapacityMbps: number;
  variableCount: number;
  equationCount: number;
  daeLoweringTimeMs: number;
  propagationTimeMs: number;
  totalTimeMs: number;
}

export const SAMPLE_NSMA_5G_PATTERN = `REVNUM: 1.01
PATTYP: C
DESCR1: 5G C-Band 64T64R Massive MIMO Active Antenna
DESCR2: 3.5 GHz - 3.8 GHz n78 Sub-6 Macro Sector
MANUF: ModelScript Networks
MODEL: MSX-RAN-3500-64T
GAIN: 24.5
GAINU: DBI
FRQREC: 3500.0 3800.0
POLARZ: D
DTILTE: 6.0
DTILTM: 0.0
NOAVAL: 8
0.0 0.0
5.0 0.4
10.0 1.8
15.0 4.2
30.0 12.5
60.0 22.0
90.0 26.5
180.0 32.0
NOEVAL: 8
0.0 0.0
2.0 1.5
4.0 6.0
6.0 15.0
10.0 22.0
30.0 25.0
90.0 30.0
180.0 32.0
`;

export function runRanBenchmark(): RanBenchmarkResult {
  const t0 = performance.now();

  // 1. NSMA Pattern Parsing & 3D Interpolation
  const antenna = parseNsmaAdf(SAMPLE_NSMA_5G_PATTERN);
  const boresightGain = interpolateAntennaGain(antenna, 0.0, antenna.electricalDowntiltDeg);

  // 2. MPE Safety Analysis (FCC OET Bulletin 65 & ICNIRP) across 3 collocated sectors
  const emitters: RfEmitterConfig[] = [
    {
      id: "Alpha-Sector-3.5GHz",
      frequencyMhz: 3500,
      inputPowerWatts: 200,
      cableLossDb: 1.0,
      peakGainDbi: antenna.peakGainDbi,
      coordinates: [0, 0, 30],
      azimuthDeg: 0,
      mechanicalTiltDeg: 2,
      electricalDowntiltDeg: 0,
    },
    {
      id: "Beta-Sector-3.5GHz",
      frequencyMhz: 3500,
      inputPowerWatts: 200,
      cableLossDb: 1.0,
      peakGainDbi: antenna.peakGainDbi,
      coordinates: [0, 0, 30],
      azimuthDeg: 120,
      mechanicalTiltDeg: 2,
      electricalDowntiltDeg: 0,
    },
    {
      id: "Gamma-Sector-3.5GHz",
      frequencyMhz: 3500,
      inputPowerWatts: 200,
      cableLossDb: 1.0,
      peakGainDbi: antenna.peakGainDbi,
      coordinates: [0, 0, 30],
      azimuthDeg: 240,
      mechanicalTiltDeg: 2,
      electricalDowntiltDeg: 0,
    },
  ];

  // Evaluate ground-level exposure at 50m distance
  const mpeReport = evaluateSiteMpe(emitters, [[0, 50, 2]]);

  // 3. Microwave Backhaul Link Calculations
  const tProp0 = performance.now();
  const backhaulLinks: RanLinkParams[] = [
    {
      id: "MW_Hub_Node1",
      txSiteName: "CentralHub",
      rxSiteName: "Node1",
      frequencyGhz: 18.0,
      pathLengthKm: 4.5,
      txPowerDbm: 24.0,
      txAntennaGainDbi: 38.0,
      rxAntennaGainDbi: 38.0,
      txFeederLossDb: 1.5,
      rxFeederLossDb: 1.5,
      requiredMarginDb: 25.0,
      polarization: "V",
      bandwidthMhz: 56.0,
      noiseFigureDb: 4.5,
      rxSensitivityDbm: -72.0,
      rainRateMmPerHr: 35.0,
    },
    {
      id: "MW_Hub_Node2",
      txSiteName: "CentralHub",
      rxSiteName: "Node2",
      frequencyGhz: 23.0,
      pathLengthKm: 3.2,
      txPowerDbm: 22.0,
      txAntennaGainDbi: 40.0,
      rxAntennaGainDbi: 40.0,
      txFeederLossDb: 1.8,
      rxFeederLossDb: 1.8,
      requiredMarginDb: 25.0,
      polarization: "H",
      bandwidthMhz: 112.0,
      noiseFigureDb: 5.0,
      rxSensitivityDbm: -70.0,
      rainRateMmPerHr: 35.0,
    },
    {
      id: "MW_Node1_Node3",
      txSiteName: "Node1",
      rxSiteName: "Node3",
      frequencyGhz: 23.0,
      pathLengthKm: 2.1,
      txPowerDbm: 20.0,
      txAntennaGainDbi: 36.0,
      rxAntennaGainDbi: 36.0,
      txFeederLossDb: 1.2,
      rxFeederLossDb: 1.2,
      requiredMarginDb: 20.0,
      polarization: "V",
      bandwidthMhz: 56.0,
      noiseFigureDb: 4.5,
      rxSensitivityDbm: -72.0,
      rainRateMmPerHr: 30.0,
    },
    {
      id: "MW_Node2_Node4",
      txSiteName: "Node2",
      rxSiteName: "Node4",
      frequencyGhz: 38.0,
      pathLengthKm: 1.5,
      txPowerDbm: 18.0,
      txAntennaGainDbi: 42.0,
      rxAntennaGainDbi: 42.0,
      txFeederLossDb: 2.0,
      rxFeederLossDb: 2.0,
      requiredMarginDb: 20.0,
      polarization: "V",
      bandwidthMhz: 112.0,
      noiseFigureDb: 6.0,
      rxSensitivityDbm: -68.0,
      rainRateMmPerHr: 30.0,
    },
  ];

  let totalCap = 0;
  for (const l of backhaulLinks) {
    const fspl = computeFsplDb(l.frequencyGhz, l.pathLengthKm);
    const fresnelRadius = computeFresnelRadiusMeters(l.frequencyGhz, l.pathLengthKm, l.pathLengthKm / 2);
    // Link capacity calculation
    const rxLevel = l.txPowerDbm + l.txAntennaGainDbi - l.txFeederLossDb - fspl + l.rxAntennaGainDbi - l.rxFeederLossDb;
    const noise = -174.0 + 10 * Math.log10((l.bandwidthMhz ?? 56) * 1e6) + (l.noiseFigureDb ?? 4.5);
    const snr = rxLevel - noise;
    const snrLin = Math.pow(10, Math.max(0, snr) / 10);
    const cap = (l.bandwidthMhz ?? 56) * Math.log2(1 + snrLin);
    totalCap += cap;
  }
  const propagationTimeMs = performance.now() - tProp0;

  // 4. DAE Arena Lowering
  const tDae0 = performance.now();
  const builder = new DAEBuilder();
  const daeResult = lowerRanNetworkToDae(builder, backhaulLinks);
  const daeLoweringTimeMs = performance.now() - tDae0;

  const totalTimeMs = performance.now() - t0;

  return {
    name: "5G C-Band Massive-MIMO & Multi-Hop Backhaul Network",
    numSectors: 3,
    numBackhaulLinks: backhaulLinks.length,
    antennaPeakGainDbi: antenna.peakGainDbi,
    interpolatedBoresightGainDbi: boresightGain,
    mpeMaxTer: mpeReport.maxTerGeneralPopulation,
    isMpeCompliant: mpeReport.maxTerGeneralPopulation <= 1.0,
    totalBackhaulCapacityMbps: totalCap,
    variableCount: daeResult.totalVariables,
    equationCount: daeResult.totalEquations,
    daeLoweringTimeMs,
    propagationTimeMs,
    totalTimeMs,
  };
}
