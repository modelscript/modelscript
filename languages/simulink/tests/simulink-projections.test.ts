// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMdl, parseSlx } from "../src/parser/index.js";
import { simulinkToModelica } from "../src/projections/index.js";

describe("Simulink Modelica.Blocks Projections (@modelscript/simulink)", () => {
  it("should project SLX DiscreteFilter block diagram to Modelica.Blocks.Discrete.TransferFunction", () => {
    const slxXml = `<System Name="SuspensionControl">
  <Block BlockType="Inport" Name="DamperError"/>
  <Block BlockType="DiscreteFilter" Name="LeadLag">
    <P Name="Numerator">[0.1, -0.09]</P>
    <P Name="Denominator">[1.0, -0.95]</P>
    <P Name="SampleTime">0.001</P>
  </Block>
  <Block BlockType="Outport" Name="ActuatorCmd"/>
  <Line><P Name="Src">DamperError#out:1</P><P Name="Dst">LeadLag#in:1</P></Line>
  <Line><P Name="Src">LeadLag#out:1</P><P Name="Dst">ActuatorCmd#in:1</P></Line>
</System>`;
    const model = parseSlx(slxXml);
    const mo = simulinkToModelica(model);
    assert.ok(mo.includes("model SuspensionControl"));
    assert.ok(mo.includes("Modelica.Blocks.Interfaces.RealInput DamperError;"));
    assert.ok(
      mo.includes(
        "Modelica.Blocks.Discrete.TransferFunction LeadLag(b={0.1, -0.09}, a={1, -0.95}, samplePeriod=0.001);",
      ),
    );
    assert.ok(mo.includes("Modelica.Blocks.Interfaces.RealOutput ActuatorCmd;"));
    assert.ok(mo.includes("connect(DamperError.y, LeadLag.u);"));
    assert.ok(mo.includes("connect(LeadLag.y, ActuatorCmd.inPort);"));
    assert.ok(mo.includes("end SuspensionControl;"));
  });

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
