// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edifToDae, lowerEdifToDae, parseEdif } from "../src/index.js";

const RLC_EDIF = `(edif rlc_filter
  (edifVersion 2 0 0)
  (edifLevel 0)
  (external GENERIC
    (cell VCC (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction OUTPUT)))))
    (cell GND (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)))))
    (cell RES (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)) (port N (direction INOUT)))))
    (cell CAP (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)) (port N (direction INOUT)))))
    (cell IND (cellType GENERIC) (view netlist (viewType NETLIST) (interface (port P (direction INOUT)) (port N (direction INOUT))))))
  (library WORK
    (cell RLC (cellType GENERIC)
      (view netlist (viewType NETLIST)
        (interface (port VOUT (direction OUTPUT)))
        (contents
          (instance V1 (viewRef netlist (cellRef VCC (libraryRef GENERIC))) (property V (number 10)))
          (instance G1 (viewRef netlist (cellRef GND (libraryRef GENERIC))))
          (instance R1 (viewRef netlist (cellRef RES (libraryRef GENERIC))) (property R (number 100)))
          (instance L1 (viewRef netlist (cellRef IND (libraryRef GENERIC))) (property L (number (e 10 -3))))
          (instance C1 (viewRef netlist (cellRef CAP (libraryRef GENERIC))) (property C (number (e 1 -6))))
          (net VCC (joined (portRef P (instanceRef V1)) (portRef P (instanceRef R1))))
          (net N1 (joined (portRef N (instanceRef R1)) (portRef P (instanceRef L1))))
          (net VOUT (joined (portRef VOUT) (portRef N (instanceRef L1)) (portRef P (instanceRef C1))))
          (net GND (joined (portRef P (instanceRef G1)) (portRef N (instanceRef C1))))))))
  (design RlcDesign (cellRef RLC (libraryRef WORK))))`;

describe("@modelscript/edif DAE Lowering Suite", () => {
  it("lowers RLC passive netlist with KCL node equations and dynamic states directly into IDaeBuilder", () => {
    const doc = parseEdif(RLC_EDIF);
    const variables: Array<{ name: string; startVal: number }> = [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];

    const mockBuilder = {
      addVariable: (name: string, _t: number, _v: number, _c: number, startVal: number) => {
        variables.push({ name, startVal });
        return variables.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: () => 100 + equations.length,
      addRealLiteral: () => 200,
      addName: (varId: number) => 300 + varId,
      addDer: (varId: number) => 400 + varId,
      lookupVariable: () => -1,
    };

    const res = lowerEdifToDae(mockBuilder as never, doc);
    assert.ok(res.stateVarIndices.length >= 2, "Expected dynamic states for CAP (vc) and IND (i)");
    assert.ok(res.kclEquationCount >= 2, "Expected KCL equations at internal nodes N1 and VOUT");
    assert.ok(res.equationCount >= 7, "Expected supply, passive, and KCL equations");
    assert.ok(
      variables.some((v) => v.name === "v_VOUT"),
      "Expected node voltage v_VOUT",
    );
    assert.ok(
      variables.some((v) => v.name === "vc_C1"),
      "Expected capacitor voltage state vc_C1",
    );
    assert.ok(
      variables.some((v) => v.name === "i_L1"),
      "Expected inductor current state i_L1",
    );
  });

  it("constructs a real linear-memory DAEBuilder arena via edifToDae", () => {
    const dae = edifToDae(RLC_EDIF);
    assert.ok(dae.varCount >= 8, "Expected node voltages, branch currents, and states in DAEBuilder");
    assert.ok(dae.eqCount >= 7, "Expected constitutive and KCL equations in DAEBuilder");
  });
});
