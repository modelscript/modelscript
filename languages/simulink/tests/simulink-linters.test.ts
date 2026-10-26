// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSimulinkModel } from "../src/lints/index.js";
import { parseMdl } from "../src/parser/index.js";

describe("Simulink Pre-Flight Control Linters (M7201–M7210)", () => {
  it("M7201: should report unconnected input ports", () => {
    const mdl = `Model {
  Name "UnconnectedInput"
  System {
    Name "UnconnectedInput"
    Block {
      BlockType Gain
      Name "Gain1"
      Gain 5.0
    }
  }
}`;
    const model = parseMdl(mdl);
    const diags = lintSimulinkModel(model);
    const m7201 = diags.find((d) => d.code === "M7201");
    assert.ok(m7201, "Must emit M7201 for unconnected input port on Gain1");
    assert.equal(m7201.severity, "error");
    assert.ok(m7201.message.includes("Gain1"));
    assert.ok(m7201.quickFix, "Must provide Ground quick-fix");
  });

  it("M7202: should detect direct-feedthrough algebraic loops", () => {
    const algebraicLoopMdl = `Model {
  Name "AlgebraicLoopModel"
  System {
    Name "AlgebraicLoopModel"
    Block {
      BlockType Gain
      Name "G1"
      Gain 2.0
    }
    Block {
      BlockType Gain
      Name "G2"
      Gain 0.5
    }
    Line {
      SrcBlock "G1"
      SrcPort 1
      DstBlock "G2"
      DstPort 1
    }
    Line {
      SrcBlock "G2"
      SrcPort 1
      DstBlock "G1"
      DstPort 1
    }
  }
}`;
    const model = parseMdl(algebraicLoopMdl);
    const diags = lintSimulinkModel(model);
    const m7202 = diags.find((d) => d.code === "M7202");
    assert.ok(m7202, "Must emit M7202 for algebraic loop between G1 and G2");
    assert.equal(m7202.severity, "error");
    assert.ok(m7202.message.includes("G1 -> G2 -> G1") || m7202.message.includes("G2 -> G1 -> G2"));
  });

  it("M7202: is cleared when an Integrator or UnitDelay breaks the algebraic loop", () => {
    const dynamicLoopMdl = `Model {
  Name "DynamicLoopModel"
  System {
    Name "DynamicLoopModel"
    Block {
      BlockType Gain
      Name "G1"
      Gain 2.0
    }
    Block {
      BlockType Integrator
      Name "Int1"
      InitialCondition 0.0
    }
    Line {
      SrcBlock "G1"
      SrcPort 1
      DstBlock "Int1"
      DstPort 1
    }
    Line {
      SrcBlock "Int1"
      SrcPort 1
      DstBlock "G1"
      DstPort 1
    }
  }
}`;
    const model = parseMdl(dynamicLoopMdl);
    const diags = lintSimulinkModel(model);
    const m7202 = diags.find((d) => d.code === "M7202");
    assert.equal(m7202, undefined, "Integrator has state delay, so no algebraic loop diagnostic should be emitted");
  });

  it("M7208: should detect duplicate block names in the same system", () => {
    const duplicateMdl = `Model {
  Name "DuplicateBlocks"
  System {
    Name "DuplicateBlocks"
    Block {
      BlockType Constant
      Name "SensorA"
      Value 1.0
    }
    Block {
      BlockType Constant
      Name "SensorA"
      Value 2.0
    }
  }
}`;
    const model = parseMdl(duplicateMdl);
    const diags = lintSimulinkModel(model);
    const m7208 = diags.find((d) => d.code === "M7208");
    assert.ok(m7208, "Must emit M7208 for duplicate block name 'SensorA'");
    assert.equal(m7208.severity, "error");
  });

  it("M7209: should warn about division-by-zero risk in Product/Divide block", () => {
    const divideMdl = `Model {
  Name "DivideRisk"
  System {
    Name "DivideRisk"
    Block {
      BlockType Constant
      Name "Num"
      Value 10.0
    }
    Block {
      BlockType Constant
      Name "Den"
      Value 0.0
    }
    Block {
      BlockType Product
      Name "DivBlock"
      Inputs "*/"
    }
    Line {
      SrcBlock "Num"
      SrcPort 1
      DstBlock "DivBlock"
      DstPort 1
    }
    Line {
      SrcBlock "Den"
      SrcPort 1
      DstBlock "DivBlock"
      DstPort 2
    }
  }
}`;
    const model = parseMdl(divideMdl);
    const diags = lintSimulinkModel(model);
    const m7209 = diags.find((d) => d.code === "M7209");
    assert.ok(m7209, "Must emit M7209 warning for Product divide operation");
    assert.equal(m7209.severity, "warning");
  });

  it("M7210: should emit info diagnostic when Integrator omits InitialCondition", () => {
    const integratorMdl = `Model {
  Name "IntegratorDefaultIC"
  System {
    Name "IntegratorDefaultIC"
    Block {
      BlockType Constant
      Name "C1"
      Value 1.0
    }
    Block {
      BlockType Integrator
      Name "IntBlock"
    }
    Line {
      SrcBlock "C1"
      SrcPort 1
      DstBlock "IntBlock"
      DstPort 1
    }
  }
}`;
    const model = parseMdl(integratorMdl);
    const diags = lintSimulinkModel(model);
    const m7210 = diags.find((d) => d.code === "M7210");
    assert.ok(m7210, "Must emit M7210 info for missing InitialCondition");
    assert.equal(m7210.severity, "info");
  });
});
