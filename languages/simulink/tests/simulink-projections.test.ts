// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMdl } from "../src/parser/index.js";
import { simulinkToModelica } from "../src/projections/index.js";

describe("Simulink Modelica.Blocks Projections (@modelscript/simulink)", () => {
  it("should project Simulink blocks and connections to standard Modelica 3.x", () => {
    const mdl = `Model {
  Name "PIDController"
  System {
    Name "PIDController"
    Block {
      BlockType Constant
      Name "Setpoint"
      Value 100.0
    }
    Block {
      BlockType Sum
      Name "ErrorCalc"
      Inputs "+-"
    }
    Block {
      BlockType Gain
      Name "Kp"
      Gain 1.2
    }
    Block {
      BlockType Integrator
      Name "Ki_Int"
      InitialCondition 0.0
    }
    Block {
      BlockType Outport
      Name "ControlSignal"
    }
    Line {
      SrcBlock "Setpoint"
      SrcPort 1
      DstBlock "ErrorCalc"
      DstPort 1
    }
    Line {
      SrcBlock "ErrorCalc"
      SrcPort 1
      DstBlock "Kp"
      DstPort 1
    }
    Line {
      SrcBlock "Kp"
      SrcPort 1
      DstBlock "Ki_Int"
      DstPort 1
    }
    Line {
      SrcBlock "Ki_Int"
      SrcPort 1
      DstBlock "ControlSignal"
      DstPort 1
    }
  }
}`;
    const model = parseMdl(mdl);
    const mo = simulinkToModelica(model);

    assert.ok(mo.includes("model PIDController"));
    assert.ok(mo.includes("Modelica.Blocks.Sources.Constant Setpoint(k=100);"));
    assert.ok(mo.includes("Modelica.Blocks.Math.Feedback ErrorCalc;"));
    assert.ok(mo.includes("Modelica.Blocks.Math.Gain Kp(k=1.2);"));
    assert.ok(mo.includes("Modelica.Blocks.Continuous.Integrator Ki_Int(y_start=0);"));
    assert.ok(mo.includes("Modelica.Blocks.Interfaces.RealOutput ControlSignal;"));

    assert.ok(mo.includes("equation"));
    assert.ok(mo.includes("connect(Setpoint.y, ErrorCalc.u1);"));
    assert.ok(mo.includes("connect(ErrorCalc.y, Kp.u);"));
    assert.ok(mo.includes("connect(Kp.y, Ki_Int.u);"));
    assert.ok(mo.includes("connect(Ki_Int.y, ControlSignal.inPort);"));
    assert.ok(mo.includes("end PIDController;"));
  });
});
