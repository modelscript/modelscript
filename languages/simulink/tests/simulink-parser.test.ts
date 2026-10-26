// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMdl, parseSimulink, serializeMdl } from "../src/parser/index.js";

describe("MATLAB Simulink Parser & Serializer (@modelscript/simulink)", () => {
  const sampleMdl = `Model {
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
      Name "ControllerGain"
      SID "3"
      Gain 2.5
    }
    Block {
      BlockType Integrator
      Name "Plant"
      SID "4"
      InitialCondition 0.0
    }
    Block {
      BlockType Scope
      Name "Scope1"
      SID "5"
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
      DstBlock "ControllerGain"
      DstPort 1
    }
    Line {
      SrcBlock "ControllerGain"
      SrcPort 1
      DstBlock "Plant"
      DstPort 1
    }
    Line {
      SrcBlock "Plant"
      SrcPort 1
      DstBlock "Scope1"
      DstPort 1
      Branch {
        DstBlock "Sum1"
        DstPort 2
      }
    }
  }
}`;

  it("should parse an ASCII .mdl model correctly", () => {
    const model = parseMdl(sampleMdl);
    assert.equal(model.name, "FeedbackLoop");
    assert.equal(model.rootSystem.blocks.size, 5);
    assert.equal(model.rootSystem.lines.length, 4);

    const ref = model.rootSystem.blocks.get("Ref")!;
    assert.equal(ref.type, "Constant");
    assert.equal(ref.parameters.get("Value"), 10.0);

    const gain = model.rootSystem.blocks.get("ControllerGain")!;
    assert.equal(gain.type, "Gain");
    assert.equal(gain.parameters.get("Gain"), 2.5);

    const plant = model.rootSystem.blocks.get("Plant")!;
    assert.equal(plant.type, "Integrator");
    assert.equal(plant.parameters.get("InitialCondition"), 0.0);

    // Verify branching line from Plant output to Scope1 and Sum1 port 2
    const plantLine = model.rootSystem.lines.find((l) => l.srcBlock === "Plant")!;
    assert.ok(plantLine);
    assert.equal(plantLine.dstBlock, "Scope1");
    assert.equal(plantLine.branches.length, 1);
    assert.equal(plantLine.branches[0]!.dstBlock, "Sum1");
    assert.equal(plantLine.branches[0]!.dstPort, 2);
  });

  it("should round-trip serialize an .mdl model losslessly", () => {
    const model = parseMdl(sampleMdl);
    const serialized = serializeMdl(model);
    assert.ok(serialized.includes('Name "FeedbackLoop"'));
    assert.ok(serialized.includes("BlockType Constant"));
    assert.ok(serialized.includes("BlockType Integrator"));
    assert.ok(serialized.includes("Branch {"));

    // Re-parse serialized output
    const reparsed = parseMdl(serialized);
    assert.equal(reparsed.name, model.name);
    assert.equal(reparsed.rootSystem.blocks.size, model.rootSystem.blocks.size);
    assert.equal(reparsed.rootSystem.lines.length, model.rootSystem.lines.length);
  });

  it("should auto-detect and parse through parseSimulink entrypoint", () => {
    const model = parseSimulink(sampleMdl, "FeedbackLoop.mdl");
    assert.equal(model.name, "FeedbackLoop");
    assert.equal(model.rootSystem.blocks.size, 5);
  });
});
