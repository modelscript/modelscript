// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  calculateOutputResistance,
  evaluateBufferCurrent,
  ibisToModelica,
  IbisWorkspaceIndex,
  lintIbis,
  lowerIbisToDae,
  parseIbis,
  serializeIbis,
  simulateIbisChannel,
} from "../src/index.js";

const SAMPLE_IBIS = `[IBIS Ver] 3.2
[File Name] sample_io.ibs
[File Rev] 1.0
[Date] October 26, 2026
| Sample IBIS 3.3V LVCMOS I/O Buffer

[Component] TX_CHIP
[Manufacturer] ModelScript Microelectronics
[Package]
| variable   typ          min          max
R_pkg        0.1500       0.0800       0.2500
L_pkg        3.200nH      1.500nH      5.000nH
C_pkg        1.200pF      0.600pF      2.000pF

[Pin] signal_name model_name R_pin L_pin C_pin
1     VDD         POWER
2     VSS         GND
3     DATA_OUT    LVCMOS_33_OUT
4     DATA_IN     LVCMOS_33_IN

[Model] LVCMOS_33_OUT
Model_type Output
Polarity Non-Inverting
C_comp 2.5pF 1.8pF 3.2pF
[Voltage Range] 3.3V 3.0V 3.6V

[Pulldown]
| Voltage   I(typ)       I(min)       I(max)
-3.300      -0.0800      -0.0500      -0.1200
 0.000       0.0000       0.0000       0.0000
 0.400       0.0160       0.0100       0.0240
 3.300       0.0500       0.0350       0.0700

[Pullup]
| Voltage   I(typ)       I(min)       I(max)
-3.300      -0.0700      -0.0450      -0.1000
 0.000       0.0000       0.0000       0.0000
 0.400       0.0150       0.0090       0.0220
 3.300       0.0480       0.0320       0.0650

[GND Clamp]
| Voltage   I(typ)       I(min)       I(max)
-1.000      -0.0500      -0.0300      -0.0800
 0.000       0.0000       0.0000       0.0000
 3.300       0.0000       0.0000       0.0000

[Ramp]
dV/dt_r 1.2V/0.8ns 0.9V/1.0ns 1.5V/0.6ns
dV/dt_f 1.2V/0.8ns 0.9V/1.0ns 1.5V/0.6ns
R_load 50

[Model] LVCMOS_33_IN
Model_type Input
C_comp 1.5pF 1.0pF 2.0pF
[Voltage Range] 3.3V 3.0V 3.6V
Vinl = 0.8V
Vinh = 2.0V
[GND Clamp]
-1.000      -0.0500      -0.0300      -0.0800
 0.000       0.0000       0.0000       0.0000
 3.300       0.0000       0.0000       0.0000

[End]
`;

const FLAWED_IBIS = `[IBIS Ver] 3.2
[Component] BROKEN_CHIP
[Package]
R_pkg -0.5 -0.8 -0.2
L_pkg 2.0nH 1.0nH 3.0nH
C_pkg 1.0pF 0.5pF 1.5pF
[Pin]
1 DATA UNDEFINED_MODEL_NAME

[Model] BAD_RANGE_MODEL
Model_type Output
C_comp -1.0pF -1.5pF -0.5pF
[Voltage Range] 3.3V 3.6V 3.0V
[Pulldown]
0.0 0.000 0.000 0.000
1.0 0.050 0.030 0.070
2.0 0.020 0.010 0.030
[End]
`;

test("IBIS Parser: parses components, packages, and pins accurately", () => {
  const deck = parseIbis(SAMPLE_IBIS, "sample.ibs");
  assert.strictEqual(deck.ibisVer, "3.2");
  assert.strictEqual(deck.components.size, 1);

  const comp = deck.components.get("TX_CHIP");
  assert(comp !== undefined);
  assert.strictEqual(comp.name, "TX_CHIP");
  assert.strictEqual(comp.package.rPkg.typ, 0.15);
  assert(Math.abs(comp.package.lPkg.typ - 3.2e-9) < 1e-12);
  assert(Math.abs(comp.package.cPkg.typ - 1.2e-12) < 1e-15);

  assert.strictEqual(comp.pins.size, 4);
  const pin3 = comp.pins.get("3");
  assert(pin3 !== undefined);
  assert.strictEqual(pin3.signalName, "DATA_OUT");
  assert.strictEqual(pin3.modelName, "LVCMOS_33_OUT");
});

test("IBIS Parser: parses buffer models, I/V tables, and slew ramps", () => {
  const deck = parseIbis(SAMPLE_IBIS);
  assert.strictEqual(deck.models.size, 2);

  const outMod = deck.models.get("LVCMOS_33_OUT");
  assert(outMod !== undefined);
  assert.strictEqual(outMod.modelType, "Output");
  assert.strictEqual(outMod.voltageRange.typ, 3.3);
  assert(Math.abs(outMod.cComp.typ - 2.5e-12) < 1e-15);

  assert(outMod.pulldown !== undefined);
  assert.strictEqual(outMod.pulldown.length, 4);
  assert.strictEqual(outMod.pullup?.length, 4);

  assert(outMod.ramp !== undefined);
  assert(outMod.ramp.dvDtRising.typ > 0);
});

test("IBIS Serializer: round-trips AST back to valid IBIS format", () => {
  const deck = parseIbis(SAMPLE_IBIS);
  const serialized = serializeIbis(deck);
  assert(serialized.includes("[Component] TX_CHIP"));
  assert(serialized.includes("[Model] LVCMOS_33_OUT"));
  assert(serialized.includes("[Pulldown]"));

  const reparsed = parseIbis(serialized);
  assert.strictEqual(reparsed.components.size, 1);
  assert.strictEqual(reparsed.models.size, 2);
});

test("IBIS Linter: detects missing pin model binding (M8305)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  const pinDiag = diags.find((d) => d.code === 8305);
  assert(pinDiag !== undefined, "Expected M8305 for UNDEFINED_MODEL_NAME");
});

test("IBIS Linter: detects invalid voltage range (M8317)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  const vDiag = diags.find((d) => d.code === 8317);
  assert(vDiag !== undefined, "Expected M8317 for inverted voltage range");
});

test("IBIS Linter: detects non-monotonic I/V curve (M8303)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  const monoDiag = diags.find((d) => d.code === 8303);
  assert(monoDiag !== undefined, "Expected M8303 for non-monotonic pulldown curve");
});

test("IBIS Linter: detects negative package parasitics and die capacitance (M8320, M8321)", () => {
  const deck = parseIbis(FLAWED_IBIS);
  const diags = lintIbis(deck);
  const rDiag = diags.find((d) => d.code === 8321);
  const cDiag = diags.find((d) => d.code === 8320);
  assert(rDiag !== undefined, "Expected M8321 for negative R_pkg");
  assert(cDiag !== undefined, "Expected M8320 for negative C_comp");
});

test("IBIS Buffer Solver: evaluates dynamic currents and driver output resistance", () => {
  const deck = parseIbis(SAMPLE_IBIS);
  const outMod = deck.models.get("LVCMOS_33_OUT")!;

  const { rOnLow, rOnHigh } = calculateOutputResistance(outMod);
  assert(rOnLow > 5 && rOnLow < 50, `Expected reasonable R_on low, got ${rOnLow}`);
  assert(rOnHigh > 5 && rOnHigh < 50, `Expected reasonable R_on high, got ${rOnHigh}`);

  const currHigh = evaluateBufferCurrent(outMod, 3.0, 1);
  assert(currHigh.iTotal > 0, "Expected positive source current when driven HIGH near Vcc");

  const currLow = evaluateBufferCurrent(outMod, 0.5, 0);
  assert(currLow.iTotal < 0, "Expected negative sink current when driven LOW");
});

test("IBIS DAE Lowering: compiles package RLC and driver into DAEBuilder linear memory", () => {
  const deck = parseIbis(SAMPLE_IBIS);
  const dae = lowerIbisToDae(deck);

  const vars = dae.variables();
  const eqs = dae.equations();

  assert(vars.length >= 8, `Expected at least 8 DAE variables, got ${vars.length}`);
  assert(eqs.length >= 3, `Expected at least 3 equations, got ${eqs.length}`);
  assert.strictEqual(
    vars.length,
    eqs.length,
    `Expected structurally square IBIS DAE (N_vars=${vars.length} === N_eqs=${eqs.length})`,
  );

  // Check pin variables
  assert.notStrictEqual(dae.lookupVariable("v_pin_TX_CHIP_3"), -1);
  assert.notStrictEqual(dae.lookupVariable("v_die_TX_CHIP_3"), -1);
  assert.notStrictEqual(dae.lookupVariable("i_pkg_TX_CHIP_3"), -1);
  assert.notStrictEqual(dae.lookupVariable("L_pkg_TX_CHIP_3"), -1);
});

test("IBIS Linter: detects clamping diode current divergence > 10A (M8318)", () => {
  const ibs = `[IBIS Ver] 3.2
[Component] CLAMP_CHIP
[Package]
R_pkg 0.1 0.05 0.2
L_pkg 1.0nH 0.5nH 2.0nH
C_pkg 1.0pF 0.5pF 1.5pF
[Pin]
1 IO1 CLAMP_MOD

[Model] CLAMP_MOD
Model_type Input
C_comp 1.5pF 1.0pF 2.0pF
[Voltage Range] 3.3V 3.0V 3.6V
[GND Clamp]
-1.0 -25.0 -15.0 -35.0
 0.0   0.0   0.0   0.0
 3.3   0.0   0.0   0.0
[End]
`;
  const deck = parseIbis(ibs);
  const diags = lintIbis(deck);
  assert(
    diags.some((d) => d.code === 8318),
    "Expected M8318 for clamp current > 10A",
  );
});

test("IBIS Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseIbis(SAMPLE_IBIS);
  const mo = ibisToModelica(deck, "LVCMOS_Driver");

  assert(mo.includes("model LVCMOS_Driver"));
  assert(mo.includes("PositivePin pad"));
  assert(mo.includes("NegativePin gnd"));
  assert(mo.includes("L_pkg * der(i_pkg) ="));
  assert(mo.includes("C_comp * der(v_die) ="));
  assert(mo.includes("end LVCMOS_Driver;"));
});

test("IBIS Workspace Index: indexes multi-file symbols accurately", () => {
  const indexer = new IbisWorkspaceIndex();
  const uri = "file:///models/sample.ibs";
  indexer.indexFile(uri, SAMPLE_IBIS);

  assert.strictEqual(indexer.has(uri), true);
  const fileIdx = indexer.getFileIndex(uri);
  assert(fileIdx !== undefined);

  const txChipSyms = fileIdx.byName.get("TX_CHIP");
  assert(txChipSyms !== undefined && txChipSyms.length > 0);

  const modSyms = fileIdx.byName.get("LVCMOS_33_OUT");
  assert(modSyms !== undefined && modSyms.length > 0);
});

test("IBIS-AMI Channel Solver: parses [Algorithmic Model] and opens degraded eye with FFE/CTLE/DFE equalization", () => {
  const amiIbis = `[IBIS Ver] 5.0
[File Name] serdes_10g.ibs
[Component] SERDES_TX
[Package]
R_pkg 0.10 0.05 0.15
L_pkg 1.0nH 0.5nH 1.5nH
C_pkg 0.5pF 0.3pF 0.8pF
[Pin] signal_name model_name R_pin L_pin C_pin
1 TX_P SERDES_10G_TX

[Model] SERDES_10G_TX
Model_type Output
C_comp 0.8pF 0.6pF 1.0pF
[Voltage Range] 1.0V 0.95V 1.05V
[Pulldown]
0.0 0.000 0.000 0.000
0.2 0.005 0.004 0.006
1.0 0.025 0.020 0.030
[Pullup]
0.0 0.000 0.000 0.000
0.2 0.005 0.004 0.006
1.0 0.025 0.020 0.030
[Algorithmic Model]
Executable Linux_gcc_64 libtx_ami.so tx_ami.ami
TX_Tap_Weights -0.10 0.80 -0.10
CTLE_Gain_dB 6.0
DFE_Taps 0.08 0.03
[End Algorithmic Model]
[End]
`;

  const deck = parseIbis(amiIbis);
  const mod = deck.models.get("SERDES_10G_TX");
  assert(mod !== undefined);
  assert(mod.algorithmicModel !== undefined);
  assert.strictEqual(mod.algorithmicModel.executables.length, 1);
  assert.deepStrictEqual(mod.algorithmicModel.txTapWeights, [-0.1, 0.8, -0.1]);
  assert.strictEqual(mod.algorithmicModel.ctleGainDb, 6.0);
  assert.deepStrictEqual(mod.algorithmicModel.dfeTaps, [0.08, 0.03]);

  // Simulate unequalized lossy channel (14 dB insertion loss at Nyquist)
  const unequalized = simulateIbisChannel(mod, {
    dataRateGbps: 10,
    channelLossDb: 14,
    txTapWeights: [1.0],
    ctleGainDb: 0,
    dfeTaps: [],
  });

  // Simulate equalized channel using TX FFE + RX CTLE + RX DFE from [Algorithmic Model]
  const equalized = simulateIbisChannel(mod, {
    dataRateGbps: 10,
    channelLossDb: 14,
  });

  assert(
    equalized.eyeHeightV > unequalized.eyeHeightV,
    `Expected FFE/CTLE/DFE equalization to increase eyeHeightV (${equalized.eyeHeightV} > ${unequalized.eyeHeightV})`,
  );
  assert(
    equalized.eyeWidthPs >= unequalized.eyeWidthPs,
    `Expected equalized eyeWidthPs (${equalized.eyeWidthPs}) >= unequalized (${unequalized.eyeWidthPs})`,
  );
  assert(
    equalized.eyeHeightBer1e12V > 0,
    `Expected open statistical eye at BER 1e-12, got ${equalized.eyeHeightBer1e12V}`,
  );
});
