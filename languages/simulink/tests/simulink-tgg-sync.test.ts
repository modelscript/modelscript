// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";
import { parseMdl } from "../src/parser/mdl-parser.js";
import { parseModelicaBlocks } from "../src/tgg/modelica-parser.js";
import { simulinkPolyglotConfig, simulinkTggRules } from "../src/tgg/simulink-rules.js";
import { synchronizeModelicaToSimulink } from "../src/tgg/simulink-sync.js";

const SAMPLE_MDL = `Model {
  Name "FeedbackLoop"
  System {
    Name "FeedbackLoop"
    Block {
      BlockType Constant
      Name "Ref"
      SID "1"
      Value 10.0
    }
    Block {
      BlockType Sum
      Name "Sum1"
      SID "2"
      Inputs "+-"
    }
    Block {
      BlockType Gain
      Name "Gain1"
      SID "3"
      Gain 2.5
    }
    Block {
      BlockType Integrator
      Name "Integrator1"
      SID "4"
      InitialCondition 0.0
    }
    Line {
      SrcBlock "Ref"
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

describe("Simulink Bidirectional TGG Round-Trip Synchronization (@modelscript/simulink)", () => {
  it("should compile all declarative Simulink TGG rules via compileTGGRules()", () => {
    assert.strictEqual(simulinkTggRules.length, 11, "Should declare 11 TGG transformation rules");
    const compiled = compileTGGRules(simulinkPolyglotConfig);
    assert.strictEqual(compiled.ruleCount, 11);
    assert.ok(compiled.sourceCode.includes("tgg_forward_SimulinkGainToModelicaGain"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_SimulinkGainToModelicaGain"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_SimulinkIntegratorToModelicaIntegrator"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_dispatch"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_dispatch"));
  });

  it("should parse modified Modelica source blocks and modifications correctly", () => {
    const moText = `model FeedbackLoop
  Modelica.Blocks.Sources.Constant Ref(k=15.0);
  Modelica.Blocks.Math.Feedback Sum1;
  Modelica.Blocks.Math.Gain Gain1(k=5.0);
  Modelica.Blocks.Continuous.Integrator Integrator1(y_start=2.5);

equation
  connect(Ref.y, Sum1.u1);
  connect(Sum1.y, Gain1.u);
  connect(Gain1.y, Integrator1.u);
  connect(Integrator1.y, Sum1.u2);
end FeedbackLoop;`;

    const parsed = parseModelicaBlocks(moText);
    assert.strictEqual(parsed.name, "FeedbackLoop");
    assert.strictEqual(parsed.components.size, 4);
    assert.strictEqual(parsed.components.get("Gain1")?.modifications["k"], 5.0);
    assert.strictEqual(parsed.components.get("Integrator1")?.modifications["y_start"], 2.5);
    assert.strictEqual(parsed.components.get("Ref")?.modifications["k"], 15.0);
    assert.strictEqual(parsed.connections.length, 4);
  });

  it("should synchronize parameter tuning (Gain & Integrator) back into Simulink .mdl", () => {
    const modifiedMo = `model FeedbackLoop
  Modelica.Blocks.Sources.Constant Ref(k=10.0);
  Modelica.Blocks.Math.Feedback Sum1;
  Modelica.Blocks.Math.Gain Gain1(k=8.0);
  Modelica.Blocks.Continuous.Integrator Integrator1(y_start=1.2);

equation
  connect(Ref.y, Sum1.u1);
  connect(Sum1.y, Gain1.u);
  connect(Gain1.y, Integrator1.u);
  connect(Integrator1.y, Sum1.u2);
end FeedbackLoop;`;

    const result = synchronizeModelicaToSimulink(SAMPLE_MDL, modifiedMo, { strategy: "target-wins" });
    assert.ok(result.updatedText.includes("Gain 8"), "Updated MDL must contain Gain 8");
    assert.ok(result.updatedText.includes("InitialCondition 1.2"), "Updated MDL must contain InitialCondition 1.2");

    const reloaded = parseMdl(result.updatedText);
    const gainBlock = reloaded.rootSystem.blocks.get("Gain1");
    const intBlock = reloaded.rootSystem.blocks.get("Integrator1");
    assert.strictEqual(gainBlock?.parameters.get("Gain"), 8.0);
    assert.strictEqual(intBlock?.parameters.get("InitialCondition"), 1.2);

    assert.strictEqual(result.changes.length, 2);
    assert.strictEqual(result.changes[0]?.property, "Gain");
    assert.strictEqual(result.changes[0]?.sourceOldVal, 2.5);
    assert.strictEqual(result.changes[0]?.targetNewVal, 8.0);
  });

  it("should respect source-wins conflict reconciliation policy", () => {
    const modifiedMo = `model FeedbackLoop
  Modelica.Blocks.Math.Gain Gain1(k=100.0);
end FeedbackLoop;`;

    const result = synchronizeModelicaToSimulink(SAMPLE_MDL, modifiedMo, { strategy: "source-wins" });
    const reloaded = parseMdl(result.updatedText);
    const gainBlock = reloaded.rootSystem.blocks.get("Gain1");
    assert.strictEqual(gainBlock?.parameters.get("Gain"), 2.5, "Source-wins must preserve original Gain 2.5");
  });

  it("should respect physics-simplex conflict reconciliation policy with bounds", () => {
    const modifiedMo = `model FeedbackLoop
  Modelica.Blocks.Math.Gain Gain1(k=20.0);
end FeedbackLoop;`;

    const result = synchronizeModelicaToSimulink(SAMPLE_MDL, modifiedMo, {
      strategy: "physics-simplex",
      physicsBounds: {
        Gain1: { min: 1.0, max: 10.0 },
      },
    });
    const reloaded = parseMdl(result.updatedText);
    const gainBlock = reloaded.rootSystem.blocks.get("Gain1");
    // (2.5 + 20) / 2 = 11.25 -> clamped to max 10.0
    assert.strictEqual(gainBlock?.parameters.get("Gain"), 10.0, "Should clamp to max physical bound 10.0");
  });

  it("should synchronize newly added components and connections from Modelica into Simulink", () => {
    const expandedMo = `model FeedbackLoop
  Modelica.Blocks.Sources.Constant Ref(k=10.0);
  Modelica.Blocks.Math.Feedback Sum1;
  Modelica.Blocks.Math.Gain Gain1(k=2.5);
  Modelica.Blocks.Continuous.Integrator Integrator1(y_start=0.0);
  Modelica.Blocks.Math.Gain PostGain(k=4.0);

equation
  connect(Ref.y, Sum1.u1);
  connect(Sum1.y, Gain1.u);
  connect(Gain1.y, Integrator1.u);
  connect(Integrator1.y, Sum1.u2);
  connect(Integrator1.y, PostGain.u);
end FeedbackLoop;`;

    const result = synchronizeModelicaToSimulink(SAMPLE_MDL, expandedMo);
    const reloaded = parseMdl(result.updatedText);
    assert.ok(reloaded.rootSystem.blocks.has("PostGain"), "PostGain should be added to Simulink blocks");
    const postGain = reloaded.rootSystem.blocks.get("PostGain");
    assert.strictEqual(postGain?.type, "Gain");
    assert.strictEqual(postGain?.parameters.get("Gain"), 4.0);

    const hasNewLine = reloaded.rootSystem.lines.some((l) => l.srcBlock === "Integrator1" && l.dstBlock === "PostGain");
    assert.ok(hasNewLine, "New connection Integrator1 -> PostGain should be added to Simulink lines");
  });
});
