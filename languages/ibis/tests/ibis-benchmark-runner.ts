// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for ANSI/EIA-656 IBIS (Input/Output Buffer Information Specification).
 *
 * Evaluates:
 * 1. 10 Gbps SerDes differential I/O buffer with package parasitics and die capacitance
 * 2. Non-linear I/V table interpolation and driver output impedance characterization
 * 3. High-speed lossy channel simulation with FFE / CTLE / DFE algorithmic equalization (IBIS-AMI)
 * 4. Statistical eye-diagram opening (eye height, eye width, BER 1e-12)
 * 5. Structurally square DAE linear memory arena lowering and Modelica projection
 */

import assert from "node:assert/strict";
import {
  calculateOutputResistance,
  evaluateBufferCurrent,
  ibisToModelica,
  lowerIbisToDae,
  parseIbis,
  simulateIbisChannel,
  type IbisDeck,
} from "../src/index.js";

export const IBIS_SERDES_10G_BENCHMARK = `[IBIS Ver] 5.0
[File Name] serdes_10g_benchmark.ibs
[File Rev] 2.0
[Date] November 9, 2026
| High-Speed 10 Gbps Differential SerDes Transceiver Benchmark

[Component] SERDES_10G_CHIP
[Manufacturer] ModelScript High-Speed Silicon
[Package]
| variable   typ          min          max
R_pkg        0.1200       0.0600       0.1800
L_pkg        1.100nH      0.600nH      1.600nH
C_pkg        0.650pF      0.350pF      0.950pF

[Pin] signal_name model_name R_pin L_pin C_pin
1     VDD         POWER
2     VSS         GND
3     TX_P        SERDES_TX_DIFF
4     TX_N        SERDES_TX_DIFF
5     RX_P        SERDES_RX_DIFF
6     RX_N        SERDES_RX_DIFF

[Model] SERDES_TX_DIFF
Model_type Output
Polarity Non-Inverting
C_comp 0.85pF 0.60pF 1.10pF
[Voltage Range] 1.0V 0.95V 1.05V

[Pulldown]
| Voltage   I(typ)       I(min)       I(max)
-1.000      -0.0350      -0.0250      -0.0450
 0.000       0.0000       0.0000       0.0000
 0.200       0.0065       0.0045       0.0085
 0.500       0.0160       0.0120       0.0200
 1.000       0.0280       0.0210       0.0350

[Pullup]
| Voltage   I(typ)       I(min)       I(max)
-1.000      -0.0350      -0.0250      -0.0450
 0.000       0.0000       0.0000       0.0000
 0.200       0.0065       0.0045       0.0085
 0.500       0.0160       0.0120       0.0200
 1.000       0.0280       0.0210       0.0350

[GND Clamp]
-0.800      -0.0400      -0.0250      -0.0600
 0.000       0.0000       0.0000       0.0000
 1.000       0.0000       0.0000       0.0000

[Ramp]
dV/dt_r 0.6V/35ps 0.5V/45ps 0.7V/28ps
dV/dt_f 0.6V/35ps 0.5V/45ps 0.7V/28ps
R_load 50

[Algorithmic Model]
Executable Linux_gcc_64 libtx_ami.so tx_ami.ami
TX_Tap_Weights -0.12 0.82 -0.06
CTLE_Gain_dB 7.5
DFE_Taps 0.09 0.035 0.015
[End Algorithmic Model]

[Model] SERDES_RX_DIFF
Model_type Input
C_comp 0.60pF 0.45pF 0.80pF
[Voltage Range] 1.0V 0.95V 1.05V
Vinl = 0.4V
Vinh = 0.6V

[GND Clamp]
-0.800      -0.0400      -0.0250      -0.0600
 0.000       0.0000       0.0000       0.0000
 1.000       0.0000       0.0000       0.0000

[End]
`;

export interface IbisBenchmarkMetrics {
  componentsCount: number;
  pinsCount: number;
  modelsCount: number;
  rOnLowOhms: number;
  rOnHighOhms: number;
  unequalizedEyeHeightV: number;
  equalizedEyeHeightV: number;
  equalizedEyeWidthPs: number;
  eyeHeightBer1e12V: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
  modelicaLines: number;
}

export function runIbisBenchmark(
  deckContent = IBIS_SERDES_10G_BENCHMARK,
): IbisBenchmarkMetrics {
  const deck: IbisDeck = parseIbis(deckContent, "serdes_benchmark.ibs");

  assert.equal(deck.components.size, 1);
  assert.equal(deck.models.size, 2);

  const comp = deck.components.get("SERDES_10G_CHIP")!;
  assert.equal(comp.pins.size, 6);

  const txModel = deck.models.get("SERDES_TX_DIFF")!;
  assert.ok(txModel.algorithmicModel);

  // 1. Output resistance characterization
  const { rOnLow, rOnHigh } = calculateOutputResistance(txModel);
  assert.ok(rOnLow > 10.0 && rOnLow < 60.0, `Expected realistic R_on low: ${rOnLow}`);
  assert.ok(rOnHigh > 10.0 && rOnHigh < 60.0, `Expected realistic R_on high: ${rOnHigh}`);

  // 2. High-speed lossy channel simulation (10 Gbps, 15 dB Nyquist loss)
  const unequalized = simulateIbisChannel(txModel, {
    dataRateGbps: 10,
    channelLossDb: 15,
    txTapWeights: [1.0],
    ctleGainDb: 0,
    dfeTaps: [],
  });

  const equalized = simulateIbisChannel(txModel, {
    dataRateGbps: 10,
    channelLossDb: 15,
  });

  assert.ok(
    equalized.eyeHeightV > unequalized.eyeHeightV,
    `Equalization must increase eye height: ${equalized.eyeHeightV} > ${unequalized.eyeHeightV}`,
  );
  assert.ok(
    equalized.eyeWidthPs > 20.0,
    `Equalized eye width must be open (> 20 ps): ${equalized.eyeWidthPs} ps`,
  );
  assert.ok(
    equalized.eyeHeightBer1e12V > 0,
    `Statistical eye at BER 1e-12 must remain open: ${equalized.eyeHeightBer1e12V} > 0`,
  );

  // 3. Lower to DAEBuilder linear memory arena
  const dae = lowerIbisToDae(deck);
  const vars = dae.variables();
  const eqs = dae.equations();
  assert.ok(vars.length >= 8, `Expected >= 8 variables in DAE arena, got ${vars.length}`);
  assert.equal(vars.length, eqs.length, "DAE arena must be structurally square (N_vars == N_eqs)");

  // 4. Project to Modelica
  const mo = ibisToModelica(deck, "SerDes10GDriver");
  assert.ok(mo.includes("model SerDes10GDriver"));
  assert.ok(mo.includes("PositivePin"));
  assert.ok(mo.includes("der(i_pkg)"));

  return {
    componentsCount: deck.components.size,
    pinsCount: comp.pins.size,
    modelsCount: deck.models.size,
    rOnLowOhms: rOnLow,
    rOnHighOhms: rOnHigh,
    unequalizedEyeHeightV: unequalized.eyeHeightV,
    equalizedEyeHeightV: equalized.eyeHeightV,
    equalizedEyeWidthPs: equalized.eyeWidthPs,
    eyeHeightBer1e12V: equalized.eyeHeightBer1e12V,
    daeVarCount: vars.length,
    daeEqCount: eqs.length,
    isSquare: vars.length === eqs.length,
    modelicaLines: mo.split("\n").length,
  };
}
