// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSimulinkToDae } from "../src/dae/index.js";
import { parseMdl } from "../src/parser/index.js";

describe("Simulink DAE Arena Lowering (@modelscript/simulink)", () => {
  it("should lower Integrator, Gain, Sum, and Constant into continuous DAE equations", () => {
    const mdl = `Model {
  Name "FirstOrderLag"
  System {
    Name "FirstOrderLag"
    Block {
      BlockType Constant
      Name "U_in"
      Value 5.0
    }
    Block {
      BlockType Sum
      Name "Sum1"
      Inputs "+-"
    }
    Block {
      BlockType Gain
      Name "Gain1"
      Gain 2.0
    }
    Block {
      BlockType Integrator
      Name "Integrator1"
      InitialCondition 0.0
    }
    Line {
      SrcBlock "U_in"
      SrcPort 1
      DstBlock "Sum1"
      DstPort 1
    }
    Line {
      SrcBlock "Sum1"
      SrcPort 1
      DstBlock "Gain1"
      DstPort 1
    }
    Line {
      SrcBlock "Gain1"
      SrcPort 1
      DstBlock "Integrator1"
      DstPort 1
    }
    Line {
      SrcBlock "Integrator1"
      SrcPort 1
      DstBlock "Sum1"
      DstPort 2
    }
  }
}`;
    const model = parseMdl(mdl);
    const dae = lowerSimulinkToDae(model);

    assert.ok(dae.varCount >= 4, "Must register variables for all blocks");
    assert.ok(dae.eqCount >= 4, "Must register equations for all blocks");

    const uInIdx = dae.lookupVariable("U_in.y");
    const sumIdx = dae.lookupVariable("Sum1.y");
    const gainIdx = dae.lookupVariable("Gain1.y");
    const intIdx = dae.lookupVariable("Integrator1.y");

    assert.ok(uInIdx >= 0);
    assert.ok(sumIdx >= 0);
    assert.ok(gainIdx >= 0);
    assert.ok(intIdx >= 0);
  });

  it("should lower TransferFcn into controllable canonical form state-space equations", () => {
    // 2nd-order transfer function: G(s) = (2s + 3) / (s^2 + 5s + 6)
    const tfMdl = `Model {
  Name "TransferFcnModel"
  System {
    Name "TransferFcnModel"
    Block {
      BlockType Constant
      Name "StepInput"
      Value 1.0
    }
    Block {
      BlockType TransferFcn
      Name "TF2"
      Numerator "[2 3]"
      Denominator "[1 5 6]"
    }
    Line {
      SrcBlock "StepInput"
      SrcPort 1
      DstBlock "TF2"
      DstPort 1
    }
  }
}`;
    const model = parseMdl(tfMdl);
    const dae = lowerSimulinkToDae(model);

    // 2nd-order transfer function introduces 2 state variables: TF2.x1 and TF2.x2
    const x1Idx = dae.lookupVariable("TF2.x1");
    const x2Idx = dae.lookupVariable("TF2.x2");
    const yIdx = dae.lookupVariable("TF2.y");

    assert.ok(x1Idx >= 0, "Must create canonical state x1");
    assert.ok(x2Idx >= 0, "Must create canonical state x2");
    assert.ok(yIdx >= 0, "Must create output y");

    // Total equations: StepInput (1) + der(x1)=x2 (1) + der(x2)=... (1) + y=... (1) = 4
    assert.ok(dae.eqCount >= 4);
  });

  it("should lower UnitDelay into discrete state and clock equations", () => {
    const delayMdl = `Model {
  Name "DiscreteDelay"
  System {
    Name "DiscreteDelay"
    Block {
      BlockType Constant
      Name "C1"
      Value 42.0
    }
    Block {
      BlockType UnitDelay
      Name "UD1"
      InitialCondition 0.0
      SampleTime 0.05
    }
    Line {
      SrcBlock "C1"
      SrcPort 1
      DstBlock "UD1"
      DstPort 1
    }
  }
}`;
    const model = parseMdl(delayMdl);
    const dae = lowerSimulinkToDae(model);

    const udOut = dae.lookupVariable("UD1.y");
    const udPrev = dae.lookupVariable("UD1.x_prev");

    assert.ok(udOut >= 0, "Must create output variable UD1.y");
    assert.ok(udPrev >= 0, "Must create discrete state variable UD1.x_prev");
  });
});
