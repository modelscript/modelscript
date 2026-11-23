// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEdifLogic, flattenEdifNetlist, solveEdifDc } from "../src/index.js";

/**
 * Hierarchical 2-stage RC voltage divider:
 * - Subcircuit `RcStage` contains series R (1 kOhm) + shunt C (100 nF) to GND
 * - Top circuit `TopDivider` cascades `U1:RcStage` (R=1k) -> `MID` -> `U2:RcStage` (R=2k) -> `VOUT`,
 *   with a load resistor `RL` (3 kOhm) from `VOUT` to `GND`, and `VCC` = 12 V.
 *
 * At DC, capacitors are open circuits, so the series chain is:
 *   R_total = 1k + 2k + 3k = 6 kOhm
 *   I_dc    = 12 V / 6 kOhm = 2.0 mA
 *   V_MID   = 12 V * (2k + 3k) / 6k = 10.0 V
 *   V_OUT   = 12 V * 3k / 6k = 6.0 V
 */
const HIERARCHICAL_RC_DIVIDER_EDIF = `(edif hierarchical_rc_divider
  (edifVersion 2 0 0)
  (edifLevel 0)
  (external GENERIC
    (cell VCC (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction OUTPUT)))))
    (cell GND (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)))))
    (cell RES (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)) (port N (direction INOUT)))))
    (cell CAP (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)) (port N (direction INOUT))))))
  (library WORK
    (cell RcStage1k
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port IN (direction INPUT))
          (port OUT (direction OUTPUT))
          (port GND (direction INOUT)))
        (contents
          (instance R_SER (viewRef netlist (cellRef RES (libraryRef GENERIC))) (property R (number 1000)))
          (instance C_SHUNT (viewRef netlist (cellRef CAP (libraryRef GENERIC))) (property C (string "100nF")))
          (net N_IN (joined (portRef IN) (portRef P (instanceRef R_SER))))
          (net N_OUT (joined (portRef OUT) (portRef N (instanceRef R_SER)) (portRef P (instanceRef C_SHUNT))))
          (net N_GND (joined (portRef GND) (portRef N (instanceRef C_SHUNT)))))))
    (cell RcStage2k
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port IN (direction INPUT))
          (port OUT (direction OUTPUT))
          (port GND (direction INOUT)))
        (contents
          (instance R_SER (viewRef netlist (cellRef RES (libraryRef GENERIC))) (property R (number 2000)))
          (instance C_SHUNT (viewRef netlist (cellRef CAP (libraryRef GENERIC))) (property C (string "100nF")))
          (net N_IN (joined (portRef IN) (portRef P (instanceRef R_SER))))
          (net N_OUT (joined (portRef OUT) (portRef N (instanceRef R_SER)) (portRef P (instanceRef C_SHUNT))))
          (net N_GND (joined (portRef GND) (portRef N (instanceRef C_SHUNT)))))))
    (cell TopDivider
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port VOUT (direction OUTPUT)))
        (contents
          (instance V_SUP (viewRef netlist (cellRef VCC (libraryRef GENERIC))) (property V (number 12)))
          (instance G_REF (viewRef netlist (cellRef GND (libraryRef GENERIC))))
          (instance U1 (viewRef netlist (cellRef RcStage1k (libraryRef WORK))))
          (instance U2 (viewRef netlist (cellRef RcStage2k (libraryRef WORK))))
          (instance R_LOAD (viewRef netlist (cellRef RES (libraryRef GENERIC))) (property R (number 3000)))
          (net VCC (joined (portRef P (instanceRef V_SUP)) (portRef IN (instanceRef U1))))
          (net MID (joined (portRef OUT (instanceRef U1)) (portRef IN (instanceRef U2))))
          (net VOUT (joined (portRef VOUT) (portRef OUT (instanceRef U2)) (portRef P (instanceRef R_LOAD))))
          (net GND (joined (portRef P (instanceRef G_REF)) (portRef GND (instanceRef U1)) (portRef GND (instanceRef U2)) (portRef N (instanceRef R_LOAD))))))))
  (design DividerDesign (cellRef TopDivider (libraryRef WORK))))`;

/**
 * Hierarchical Half-Adder EDIF 2.0.0 netlist:
 * - Subcircuit `HalfAdderCell` contains `XOR2` (SUM = A ^ B) and `AND2` (CARRY = A & B)
 * - Top circuit `TopHalfAdder` instantiates `U_HA:HalfAdderCell`
 */
const HIERARCHICAL_HALF_ADDER_EDIF = `(edif half_adder
  (edifVersion 2 0 0)
  (edifLevel 0)
  (external GENERIC
    (cell XOR2 (cellType GENERIC)
      (view netlist (viewType NETLIST)
        (interface (port A (direction INPUT)) (port B (direction INPUT)) (port Y (direction OUTPUT)))))
    (cell AND2 (cellType GENERIC)
      (view netlist (viewType NETLIST)
        (interface (port A (direction INPUT)) (port B (direction INPUT)) (port Y (direction OUTPUT))))))
  (library WORK
    (cell HalfAdderCell
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port A (direction INPUT))
          (port B (direction INPUT))
          (port SUM (direction OUTPUT))
          (port CARRY (direction OUTPUT)))
        (contents
          (instance G_XOR (viewRef netlist (cellRef XOR2 (libraryRef GENERIC))))
          (instance G_AND (viewRef netlist (cellRef AND2 (libraryRef GENERIC))))
          (net N_A (joined (portRef A) (portRef A (instanceRef G_XOR)) (portRef A (instanceRef G_AND))))
          (net N_B (joined (portRef B) (portRef B (instanceRef G_XOR)) (portRef B (instanceRef G_AND))))
          (net N_SUM (joined (portRef SUM) (portRef Y (instanceRef G_XOR))))
          (net N_CARRY (joined (portRef CARRY) (portRef Y (instanceRef G_AND)))))))
    (cell TopHalfAdder
      (cellType GENERIC)
      (view netlist
        (viewType NETLIST)
        (interface
          (port IN_A (direction INPUT))
          (port IN_B (direction INPUT))
          (port OUT_SUM (direction OUTPUT))
          (port OUT_CARRY (direction OUTPUT)))
        (contents
          (instance U_HA (viewRef netlist (cellRef HalfAdderCell (libraryRef WORK))))
          (net A (joined (portRef IN_A) (portRef A (instanceRef U_HA))))
          (net B (joined (portRef IN_B) (portRef B (instanceRef U_HA))))
          (net SUM (joined (portRef OUT_SUM) (portRef SUM (instanceRef U_HA))))
          (net CARRY (joined (portRef OUT_CARRY) (portRef CARRY (instanceRef U_HA))))))))
  (design HalfAdderDesign (cellRef TopHalfAdder (libraryRef WORK))))`;

function relErr(actual: number, expected: number): number {
  const denom = Math.max(1e-12, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

describe("@modelscript/edif Benchmark Suite", () => {
  it("flattens and solves hierarchical 2-stage RC voltage divider within tight DC tolerance", () => {
    const tolerance = 1e-6;
    const flat = flattenEdifNetlist(HIERARCHICAL_RC_DIVIDER_EDIF);

    // 2 stages * (RES + CAP) + V_SUP + G_REF + R_LOAD = 7 leaf instances
    assert.strictEqual(flat.instances.length, 7);
    assert.ok(flat.instances.some((i) => i.name === "U1/R_SER"));
    assert.ok(flat.instances.some((i) => i.name === "U2/C_SHUNT"));

    const dc = solveEdifDc(flat);
    assert.strictEqual(dc.converged, true);

    const vMid = dc.nodeVoltages["MID"]!;
    const vOut = dc.nodeVoltages["VOUT"]!;
    const iLoad = dc.branchCurrents["R_LOAD"]!;
    const expectedVMid = 10.0;
    const expectedVOut = 6.0;
    const expectedILoad = 0.002; // 2.0 mA

    assert.ok(
      relErr(vMid, expectedVMid) < tolerance,
      `V_MID relErr=${relErr(vMid, expectedVMid)} exceeded tolerance=${tolerance} (actual=${vMid})`,
    );
    assert.ok(
      relErr(vOut, expectedVOut) < tolerance,
      `V_OUT relErr=${relErr(vOut, expectedVOut)} exceeded tolerance=${tolerance} (actual=${vOut})`,
    );
    assert.ok(
      relErr(iLoad, expectedILoad) < tolerance,
      `I_LOAD relErr=${relErr(iLoad, expectedILoad)} exceeded tolerance=${tolerance} (actual=${iLoad})`,
    );
  });

  it("flattens and verifies full truth table of hierarchical Half-Adder EDIF netlist", () => {
    const flat = flattenEdifNetlist(HIERARCHICAL_HALF_ADDER_EDIF);
    assert.strictEqual(flat.instances.length, 2);
    assert.ok(flat.instances.some((i) => i.name === "U_HA/G_XOR"));
    assert.ok(flat.instances.some((i) => i.name === "U_HA/G_AND"));

    const truthTable: Array<{ a: 0 | 1; b: 0 | 1; sum: 0 | 1; carry: 0 | 1 }> = [
      { a: 0, b: 0, sum: 0, carry: 0 },
      { a: 0, b: 1, sum: 1, carry: 0 },
      { a: 1, b: 0, sum: 1, carry: 0 },
      { a: 1, b: 1, sum: 0, carry: 1 },
    ];

    for (const row of truthTable) {
      const res = evaluateEdifLogic(flat, { IN_A: row.a, IN_B: row.b });
      assert.strictEqual(res.settled, true);
      assert.strictEqual(res.outputValues["OUT_SUM"], row.sum, `SUM mismatch for (${row.a}, ${row.b})`);
      assert.strictEqual(res.outputValues["OUT_CARRY"], row.carry, `CARRY mismatch for (${row.a}, ${row.b})`);
    }
  });
});
