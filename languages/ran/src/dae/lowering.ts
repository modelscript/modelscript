// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for Radio Access Networks & Microwave Link Budgets.
 * Lowers link parameters, path loss, atmospheric attenuation, SNR, fade margins,
 * and Shannon channel capacity directly into linear-memory DAEBuilder.
 */

import { BinOp, Causality, EqKind, IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import type { MicrowaveLink } from "../types.js";

export interface RanDaeLoweringResult {
  linkId: string;
  variableIndices: Record<string, number>;
  equationCount: number;
}

export interface RanLinkParams extends MicrowaveLink {
  rainRateMmPerHr?: number;
  bandwidthMhz?: number;
  noiseFigureDb?: number;
  rxSensitivityDbm?: number;
}

/**
 * Lowers a single MicrowaveLink or 5G C-Band / Millimeter-Wave backhaul link into DAEBuilder.
 */
export function lowerRanLinkToDae(
  builder: IDaeBuilder,
  link: RanLinkParams,
  prefix: string = link.id || "link",
): RanDaeLoweringResult {
  const p = `${prefix}_`;
  let eqCount = 0;

  // 1. Parameters & Inputs
  const vTxPower = builder.addVariable(
    `${p}tx_power_dbm`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.txPowerDbm,
  );
  const vTxGain = builder.addVariable(
    `${p}tx_gain_dbi`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.txAntennaGainDbi,
  );
  const vTxLoss = builder.addVariable(
    `${p}tx_loss_db`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.txFeederLossDb,
  );
  const vDist = builder.addVariable(
    `${p}distance_km`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.pathLengthKm,
  );
  const vFreq = builder.addVariable(
    `${p}freq_ghz`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.frequencyGhz,
  );
  const vRxGain = builder.addVariable(
    `${p}rx_gain_dbi`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.rxAntennaGainDbi,
  );
  const vRxLoss = builder.addVariable(
    `${p}rx_loss_db`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.rxFeederLossDb,
  );
  const vBw = builder.addVariable(
    `${p}bandwidth_mhz`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.bandwidthMhz ?? 56.0,
  );
  const vNf = builder.addVariable(
    `${p}noise_figure_db`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.noiseFigureDb ?? 4.0,
  );
  const vSens = builder.addVariable(
    `${p}rx_sensitivity_dbm`,
    VarType.Real,
    Variability.Parameter,
    Causality.Input,
    link.rxSensitivityDbm ?? -72.0,
  );

  // 2. Algebraic / Continuous Variables
  const vEirp = builder.addVariable(`${p}eirp_dbm`, VarType.Real, Variability.Continuous, Causality.Output);
  const vFspl = builder.addVariable(`${p}fspl_db`, VarType.Real, Variability.Continuous, Causality.Output);
  const vRainAtten = builder.addVariable(`${p}rain_atten_db`, VarType.Real, Variability.Continuous, Causality.Output);
  const vRxPower = builder.addVariable(`${p}rx_power_dbm`, VarType.Real, Variability.Continuous, Causality.Output);
  const vNoiseFloor = builder.addVariable(`${p}noise_floor_dbm`, VarType.Real, Variability.Continuous, Causality.Output);
  const vSnr = builder.addVariable(`${p}snr_db`, VarType.Real, Variability.Continuous, Causality.Output);
  const vFadeMargin = builder.addVariable(`${p}fade_margin_db`, VarType.Real, Variability.Continuous, Causality.Output);
  const vCapacity = builder.addVariable(`${p}capacity_mbps`, VarType.Real, Variability.Continuous, Causality.Output);

  // 3. Equations
  // eq 1: eirp_dbm = tx_power_dbm + tx_gain_dbi - tx_loss_db
  const eirpSum = builder.addBinaryExpr(BinOp.Add, builder.addName(vTxPower), builder.addName(vTxGain));
  const eirpRhs = builder.addBinaryExpr(BinOp.Sub, eirpSum, builder.addName(vTxLoss));
  builder.addEquation(EqKind.Simple, builder.addName(vEirp), eirpRhs);
  eqCount++;

  // eq 2: fspl_db = 92.45 + 20 * log10(freq_ghz) + 20 * log10(distance_km)
  // FSPL approximation in linear form: 92.45 + 20*log10(f0) + 20*log10(d0)
  const constFspl = 92.45 + 20 * Math.log10(link.frequencyGhz) + 20 * Math.log10(link.pathLengthKm);
  builder.addEquation(EqKind.Simple, builder.addName(vFspl), builder.addRealLiteral(constFspl));
  eqCount++;

  // eq 3: rain_atten_db = gamma_r * d_eff
  // ITU-R P.838 approximation for rain attenuation
  const rainRate = link.rainRateMmPerHr ?? 30.0;
  const kAlpha = 0.035 * Math.pow(rainRate, 1.15) * link.pathLengthKm;
  builder.addEquation(EqKind.Simple, builder.addName(vRainAtten), builder.addRealLiteral(kAlpha));
  eqCount++;

  // eq 4: rx_power_dbm = eirp_dbm - fspl_db - rain_atten_db + rx_gain_dbi - rx_loss_db
  const rx1 = builder.addBinaryExpr(BinOp.Sub, builder.addName(vEirp), builder.addName(vFspl));
  const rx2 = builder.addBinaryExpr(BinOp.Sub, rx1, builder.addName(vRainAtten));
  const rx3 = builder.addBinaryExpr(BinOp.Add, rx2, builder.addName(vRxGain));
  const rxRhs = builder.addBinaryExpr(BinOp.Sub, rx3, builder.addName(vRxLoss));
  builder.addEquation(EqKind.Simple, builder.addName(vRxPower), rxRhs);
  eqCount++;

  // eq 5: noise_floor_dbm = -174.0 + 10 * log10(bandwidth_hz) + noise_figure_db
  const bwHz = (link.bandwidthMhz ?? 56.0) * 1e6;
  const nfVal = -174.0 + 10 * Math.log10(bwHz) + (link.noiseFigureDb ?? 4.0);
  builder.addEquation(EqKind.Simple, builder.addName(vNoiseFloor), builder.addRealLiteral(nfVal));
  eqCount++;

  // eq 6: snr_db = rx_power_dbm - noise_floor_dbm
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vSnr),
    builder.addBinaryExpr(BinOp.Sub, builder.addName(vRxPower), builder.addName(vNoiseFloor)),
  );
  eqCount++;

  // eq 7: fade_margin_db = rx_power_dbm - rx_sensitivity_dbm
  builder.addEquation(
    EqKind.Simple,
    builder.addName(vFadeMargin),
    builder.addBinaryExpr(BinOp.Sub, builder.addName(vRxPower), builder.addName(vSens)),
  );
  eqCount++;

  // eq 8: capacity_mbps = bandwidth_mhz * log2(1 + 10^(snr / 10))
  // Approximated linear spectral efficiency for benchmark
  const estSnr = (link.txPowerDbm + link.txAntennaGainDbi - link.txFeederLossDb) - constFspl - kAlpha + link.rxAntennaGainDbi - link.rxFeederLossDb - nfVal;
  const snrLinear = Math.pow(10, Math.max(0, estSnr) / 10);
  const cap = (link.bandwidthMhz ?? 56.0) * Math.log2(1 + snrLinear);
  builder.addEquation(EqKind.Simple, builder.addName(vCapacity), builder.addRealLiteral(cap));
  eqCount++;

  return {
    linkId: link.id,
    variableIndices: {
      vTxPower,
      vTxGain,
      vTxLoss,
      vDist,
      vFreq,
      vRxGain,
      vRxLoss,
      vBw,
      vNf,
      vSens,
      vEirp,
      vFspl,
      vRainAtten,
      vRxPower,
      vNoiseFloor,
      vSnr,
      vFadeMargin,
      vCapacity,
    },
    equationCount: eqCount,
  };
}

/**
 * Lowers a multi-hop cellular backhaul or mesh network of MicrowaveLinks into DAEBuilder.
 */
export function lowerRanNetworkToDae(
  builder: IDaeBuilder,
  links: RanLinkParams[],
): { totalVariables: number; totalEquations: number; results: RanDaeLoweringResult[] } {
  let totalEqs = 0;
  const results: RanDaeLoweringResult[] = [];

  for (const link of links) {
    const res = lowerRanLinkToDae(builder, link);
    totalEqs += res.equationCount;
    results.push(res);
  }

  return {
    totalVariables: builder.getVarCount(),
    totalEquations: totalEqs,
    results,
  };
}
