// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { createDiagramDispatch } from "../src/diagramApi.js";

test("Simulink & SPICE Diagram Dispatch and Data Generation", async (t) => {
  const dummyMdlUri = "file:///workspace/demo_simulink.mdl";
  const dummySpiceUri = "file:///workspace/demo_circuit.cir";

  const sampleMdl = `Model {
  Name "DemoController"
  Version "10.0"
  System {
    Name "DemoController"
    Block {
      BlockType Inport
      Name "Ref"
      Position [50, 100, 80, 120]
    }
    Block {
      BlockType Sum
      Name "SumError"
      Inputs "|+-"
      Position [140, 95, 170, 125]
    }
    Block {
      BlockType Gain
      Name "Kp"
      Gain "12.5"
      Position [220, 95, 260, 125]
    }
    Block {
      BlockType SubSystem
      Name "FilterSubsystem"
      Position [300, 85, 380, 135]
      System {
        Name "FilterSubsystem"
        Block {
          BlockType Inport
          Name "In1"
        }
        Block {
          BlockType TransferFcn
          Name "LowPass"
          Numerator "[1]"
          Denominator "[0.01 1]"
        }
        Block {
          BlockType Outport
          Name "Out1"
        }
        Line {
          SrcBlock "In1"
          SrcPort 1
          DstBlock "LowPass"
          DstPort 1
        }
        Line {
          SrcBlock "LowPass"
          SrcPort 1
          DstBlock "Out1"
          DstPort 1
        }
      }
    }
    Block {
      BlockType Outport
      Name "ControlSignal"
      Position [440, 100, 470, 120]
    }
    Line {
      SrcBlock "Ref"
      SrcPort 1
      DstBlock "SumError"
      DstPort 1
    }
    Line {
      SrcBlock "SumError"
      SrcPort 1
      DstBlock "Kp"
      DstPort 1
    }
    Line {
      SrcBlock "Kp"
      SrcPort 1
      DstBlock "FilterSubsystem"
      DstPort 1
    }
    Line {
      SrcBlock "FilterSubsystem"
      SrcPort 1
      DstBlock "ControlSignal"
      DstPort 1
    }
  }
}`;

  const sampleSpice = `* RLC Bandpass Filter Benchmark
VIN 1 0 AC 1.0 SIN(0 1 1k)
R1 1 2 50
L1 2 3 100u
C1 3 0 10n
RLOAD 3 0 1k
.TRAN 10n 10u
.AC DEC 10 100 1MEG
.END
`;

  const genericBackend: any = {
    deps: {
      getDocumentText: (uri: string) => {
        if (uri === dummyMdlUri) return sampleMdl;
        if (uri === dummySpiceUri) return sampleSpice;
        return undefined;
      },
    },
    getData: async () => null,
    getComponentProperties: () => null,
    applyEdits: async () => ({ seq: 1, edits: [], renderHint: "none" }),
  };

  const dispatch = createDiagramDispatch({
    generic: genericBackend,
  });

  await t.test("should route .mdl and .slx to Simulink diagram backend", async () => {
    const data = await dispatch.getData({ uri: dummyMdlUri });
    assert.ok(data, "Simulink diagram data should be returned");
    assert.strictEqual(data.metadata?.title, "DemoController");
    assert.strictEqual(data.nodes.length, 5); // Ref, SumError, Kp, FilterSubsystem, ControlSignal
    assert.strictEqual(data.edges.length, 4);

    const kpNode = data.nodes.find((n: any) => n.id === "block_Kp");
    assert.ok(kpNode, "Kp node should exist");
  });

  await t.test("should inspect Simulink block properties", async () => {
    const props = await dispatch.getComponentProperties({
      uri: dummyMdlUri,
      componentName: "Kp",
    });
    assert.ok(props, "Block properties should be returned");
    assert.strictEqual(props.className, "Gain");
    assert.strictEqual(props.name, "Kp");
    const gainParam = props.parameters.find((p) => p.name === "Gain");
    assert.ok(gainParam);
    assert.strictEqual(gainParam.value, "12.5");
  });

  await t.test("should drill down into Simulink subsystem", async () => {
    const backend = dispatch.getBackend(dummyMdlUri);
    assert.ok(backend.drillDown, "drillDown should be supported");
    const drill = await backend.drillDown({
      uri: dummyMdlUri,
      className: "FilterSubsystem",
    });
    assert.ok(drill, "Subsystem drill-down should return sub-diagram");
    assert.strictEqual(drill.targetClassName, "FilterSubsystem");
    assert.strictEqual(drill.data.nodes.length, 3); // In1, LowPass, Out1
    assert.strictEqual(drill.data.edges.length, 2);
    assert.ok(drill.breadcrumbs.some((b) => b.label === "FilterSubsystem"));
  });

  await t.test("should provide Simulink palette categories", async () => {
    const backend = dispatch.getBackend(dummyMdlUri);
    assert.ok(backend.getPalette);
    const palette = await backend.getPalette({ uri: dummyMdlUri });
    assert.ok(palette);
    assert.ok(palette.categories.some((c) => c.name === "Math Operations"));
    assert.ok(palette.categories.some((c) => c.name === "Continuous"));
  });

  await t.test("should route .cir and .spice to SPICE diagram backend", async () => {
    const data = await dispatch.getData({ uri: dummySpiceUri });
    assert.ok(data, "SPICE diagram data should be returned");
    assert.strictEqual(data.metadata?.componentCount, 5); // VIN, R1, L1, C1, RLOAD
    assert.ok(data.nodes.length >= 5);
  });

  await t.test("should inspect SPICE component properties", async () => {
    const props = await dispatch.getComponentProperties({
      uri: dummySpiceUri,
      componentName: "cmp_R1",
    });
    assert.ok(props, "SPICE component properties should be returned");
    assert.strictEqual(props.className, "R");
    assert.strictEqual(props.name, "R1");
    const valParam = props.parameters.find((p) => p.name === "Value");
    assert.ok(valParam);
    assert.strictEqual(valParam.value, "50.0Ω");
  });

  await t.test("should provide SPICE palette categories", async () => {
    const backend = dispatch.getBackend(dummySpiceUri);
    assert.ok(backend.getPalette);
    const palette = await backend.getPalette({ uri: dummySpiceUri });
    assert.ok(palette);
    assert.ok(palette.categories.some((c) => c.name === "Passive Components"));
    assert.ok(palette.categories.some((c) => c.name === "Semiconductors"));
  });
});
