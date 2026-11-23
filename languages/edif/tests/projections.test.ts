// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edifToModelica, edifToSpice } from "../src/index.js";

const DIVIDER_EDIF = `(edif simple_divider
  (edifVersion 2 0 0)
  (edifLevel 0)
  (external GENERIC
    (cell VCC (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction OUTPUT)))))
    (cell GND (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)))))
    (cell RES (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)) (port N (direction INOUT))))))
  (library WORK
    (cell DIV (cellType GENERIC)
      (view netlist (viewType NETLIST)
        (interface (port VOUT (direction OUTPUT)))
        (contents
          (instance V1 (viewRef netlist (cellRef VCC (libraryRef GENERIC))) (property V (number 5)))
          (instance G1 (viewRef netlist (cellRef GND (libraryRef GENERIC))))
          (instance R1 (viewRef netlist (cellRef RES (libraryRef GENERIC))) (property R (number 1000)))
          (instance R2 (viewRef netlist (cellRef RES (libraryRef GENERIC))) (property R (number 1000)))
          (net VCC (joined (portRef P (instanceRef V1)) (portRef P (instanceRef R1))))
          (net VOUT (joined (portRef VOUT) (portRef N (instanceRef R1)) (portRef P (instanceRef R2))))
          (net GND (joined (portRef P (instanceRef G1)) (portRef N (instanceRef R2))))))))
  (design DivDesign (cellRef DIV (libraryRef WORK))))`;

describe("@modelscript/edif Projections Suite (SPICE & Modelica)", () => {
  it("projects EDIF netlist to valid SPICE netlist cards", () => {
    const spice = edifToSpice(DIVIDER_EDIF);
    assert.ok(spice.includes("V_V1 VCC 0 DC 5"), `Missing V_V1 card in:\n${spice}`);
    assert.ok(spice.includes("R_R1 VCC VOUT 1000"), `Missing R_R1 card in:\n${spice}`);
    assert.ok(spice.includes("R_R2 VOUT 0 1000"), `Missing R_R2 card in:\n${spice}`);
    assert.ok(spice.includes(".OP"));
    assert.ok(spice.includes(".END"));
  });

  it("projects EDIF netlist to valid Modelica equations with KCL", () => {
    const mo = edifToModelica(DIVIDER_EDIF);
    assert.ok(mo.includes("model DivDesign"), `Missing model header in:\n${mo}`);
    assert.ok(mo.includes("parameter Real R_R1 = 1000;"));
    assert.ok(mo.includes("v_VCC - v_VOUT = R_R1 * i_R1;"));
    assert.ok(mo.includes("v_GND = 0.0;"));
    assert.ok(mo.includes("// KCL at VOUT"));
    assert.ok(mo.includes("end DivDesign;"));
  });
});
