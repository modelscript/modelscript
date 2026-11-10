// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseIbis, serializeIbis } from "../src/index.js";

const SAMPLE_IBIS = `[IBIS Ver] 3.2
[File Name] sample_parser.ibs
[File Rev] 1.0
[Date] November 9, 2026

[Component] TEST_CHIP
[Manufacturer] ModelScript Microelectronics
[Package]
| variable   typ          min          max
R_pkg        0.1500       0.0800       0.2500
L_pkg        3.200nH      1.500nH      5.000nH
C_pkg        1.200pF      0.600pF      2.000pF

[Pin] signal_name model_name R_pin L_pin C_pin
1     VDD         POWER
2     VSS         GND
3     DATA_OUT    LVCMOS_OUT
4     DATA_IN     LVCMOS_IN

[Model] LVCMOS_OUT
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
-1.000      -0.0500      -0.0300      -0.0800
 0.000       0.0000       0.0000       0.0000
 3.300       0.0000       0.0000       0.0000

[Ramp]
dV/dt_r 1.2V/0.8ns 0.9V/1.0ns 1.5V/0.6ns
dV/dt_f 1.2V/0.8ns 0.9V/1.0ns 1.5V/0.6ns
R_load 50

[Model] LVCMOS_IN
Model_type Input
C_comp 1.5pF 1.0pF 2.0pF
[Voltage Range] 3.3V 3.0V 3.6V
Vinl = 0.8V
Vinh = 2.0V

[End]
`;

test("IBIS Parser: parses header, component, and pin definitions", () => {
  const deck = parseIbis(SAMPLE_IBIS, "test.ibs");
  assert.equal(deck.ibisVer, "3.2");
  assert.equal(deck.components.size, 1);

  const comp = deck.components.get("TEST_CHIP")!;
  assert.ok(comp);
  assert.equal(comp.name, "TEST_CHIP");
  assert.equal(comp.pins.size, 4);

  const pin3 = comp.pins.get("3")!;
  assert.equal(pin3.signalName, "DATA_OUT");
  assert.equal(pin3.modelName, "LVCMOS_OUT");
});

test("IBIS Parser: parses buffer models, tables, and ramps", () => {
  const deck = parseIbis(SAMPLE_IBIS);
  assert.equal(deck.models.size, 2);

  const outModel = deck.models.get("LVCMOS_OUT")!;
  assert.equal(outModel.modelType, "Output");
  assert.equal(outModel.voltageRange.typ, 3.3);
  assert.ok(outModel.pulldown && outModel.pulldown.length === 4);
  assert.ok(outModel.pullup && outModel.pullup.length === 4);
  assert.ok(outModel.ramp);
  assert.ok(outModel.ramp.dvDtRising.typ > 0);
});

test("IBIS Parser: serializes and roundtrips without information loss", () => {
  const deck = parseIbis(SAMPLE_IBIS);
  const text = serializeIbis(deck);
  assert.ok(text.includes("[Component] TEST_CHIP"));
  assert.ok(text.includes("[Model] LVCMOS_OUT"));

  const reparsed = parseIbis(text);
  assert.equal(reparsed.components.size, 1);
  assert.equal(reparsed.models.size, 2);
});
