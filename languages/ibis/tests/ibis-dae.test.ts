// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ibisToModelica, lowerIbisToDae, parseIbis } from "../src/index.js";

const DAE_IBIS = `[IBIS Ver] 3.2
[Component] DAE_CHIP
[Package]
R_pkg 0.15 0.08 0.25
L_pkg 2.0nH 1.0nH 3.0nH
C_pkg 1.0pF 0.5pF 1.5pF
[Pin]
1 DATA_OUT DRV_OUT

[Model] DRV_OUT
Model_type Output
C_comp 1.5pF 1.0pF 2.0pF
[Voltage Range] 3.3V 3.0V 3.6V
[Pulldown]
-3.3 -0.050 -0.030 -0.070
 0.0  0.000  0.000  0.000
 0.4  0.015  0.010  0.020
 3.3  0.045  0.030  0.060
[Pullup]
-3.3 -0.050 -0.030 -0.070
 0.0  0.000  0.000  0.000
 0.4  0.015  0.010  0.020
 3.3  0.045  0.030  0.060
[Ramp]
dV/dt_r 1.0V/1.0ns 0.8V/1.2ns 1.2V/0.8ns
dV/dt_f 1.0V/1.0ns 0.8V/1.2ns 1.2V/0.8ns
R_load 50
[End]
`;

test("IBIS DAE: lowers package parasitics and buffer equations into square DAEBuilder", () => {
  const deck = parseIbis(DAE_IBIS);
  const dae = lowerIbisToDae(deck);

  const vars = dae.variables();
  const eqs = dae.equations();

  assert.ok(vars.length >= 4, `Expected >= 4 variables, got ${vars.length}`);
  assert.equal(
    vars.length,
    eqs.length,
    `DAE must be square: vars=${vars.length}, eqs=${eqs.length}`,
  );
  assert.notEqual(dae.lookupVariable("v_pin_DAE_CHIP_1"), -1);
  assert.notEqual(dae.lookupVariable("v_die_DAE_CHIP_1"), -1);
  assert.notEqual(dae.lookupVariable("i_pkg_DAE_CHIP_1"), -1);
});

test("IBIS Projection: generates valid Modelica code with electrical connectors", () => {
  const deck = parseIbis(DAE_IBIS);
  const mo = ibisToModelica(deck, "DaeTestDriver");

  assert.ok(mo.includes("model DaeTestDriver"));
  assert.ok(mo.includes("Modelica.Electrical.Analog.Interfaces.PositivePin"));
  assert.ok(mo.includes("der(i_pkg)"));
});
