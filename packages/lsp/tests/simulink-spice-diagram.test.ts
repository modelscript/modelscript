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

  await t.test("should connect, disconnect, reconnect SPICE nets with minimal diff hunks", async () => {
    const { TextDocument } = await import("vscode-languageserver-textdocument");
    const backend = dispatch.getBackend(dummySpiceUri);
    const apply = (src: string, edits: any[]) =>
      TextDocument.applyEdits(TextDocument.create(dummySpiceUri, "spice", 1, src), edits);

    // Connect disconnected R1 pin_1 (net 2) -> RLOAD pin_1 (net 0) reuses net 2 with minimal edit
    const connRes = await backend.applyEdits({
      uri: dummySpiceUri,
      seq: 1,
      actions: [{ type: "connect", source: "comp_R1", sourcePort: "pin_1", target: "comp_RLOAD", targetPort: "pin_1" }],
    });
    assert.strictEqual(connRes.edits.length, 1);
    assert.strictEqual(connRes.edits[0]!.range.start.line, 5, "Minimal hunk must start on RLOAD line");
    const connected = apply(sampleSpice, connRes.edits);
    assert.ok(connected.includes("RLOAD 3 2 1k"));

    // Disconnect R1 pin_1 <-> L1 pin_0 (both on net 2)
    const discRes = await backend.applyEdits({
      uri: dummySpiceUri,
      seq: 2,
      actions: [{ type: "disconnect", source: "comp_R1", sourcePort: "pin_1", target: "comp_L1", targetPort: "pin_0" }],
    });
    assert.strictEqual(discRes.edits.length, 1);
    assert.strictEqual(discRes.edits[0]!.range.start.line, 3, "Minimal hunk must target L1 line");
    const disconnected = apply(sampleSpice, discRes.edits);
    assert.ok(disconnected.includes("L1 nc_L1_1 3 100u"));
  });

  await t.test("OpenDRIVE applyEdits emits minimal hunks rather than 0..EOF full replacements", async () => {
    const { TextDocument } = await import("vscode-languageserver-textdocument");
    const dummyXodrUri = "file:///workspace/demo_road.xodr";
    const sampleXodr = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<OpenDRIVE>`,
      `  <header revMajor="1" revMinor="6" name="Test"/>`,
      `  <road id="1" name="Main" length="100.0">`,
      `    <link/>`,
      `  </road>`,
      `  <road id="2" name="Exit" length="50.0">`,
      `    <link/>`,
      `  </road>`,
      `</OpenDRIVE>`,
    ].join("\n");

    const xodrGeneric: any = {
      deps: { getDocumentText: (u: string) => (u === dummyXodrUri ? sampleXodr : undefined) },
      getData: async () => null,
      getComponentProperties: () => null,
      applyEdits: async () => ({ seq: 1, edits: [], renderHint: "none" }),
    };
    const xodrDispatch = createDiagramDispatch({ generic: xodrGeneric });
    const backend = xodrDispatch.getBackend(dummyXodrUri);

    const res = await backend.applyEdits({
      uri: dummyXodrUri,
      seq: 1,
      actions: [{ type: "connect", source: "road_1", target: "road_2" }],
    });

    assert.strictEqual(res.edits.length, 1);
    assert.ok(
      res.edits[0]!.range.start.line >= 3,
      `Expected minimal hunk start >= line 3, got ${res.edits[0]!.range.start.line}`,
    );
    const patched = TextDocument.applyEdits(TextDocument.create(dummyXodrUri, "opendrive", 1, sampleXodr), res.edits);
    assert.ok(patched.includes(`elementType="road" elementId="2"`));
  });

  await t.test(
    "DOMAIN_BUILDERS persists spatial moves via .layout sidecar while blocking structural edits",
    async () => {
      const forwardedActions: any[] = [];
      const oscalUri = "file:///workspace/ssp.oscal.json";
      const mockGeneric: any = {
        deps: { getDocumentText: () => `{ "system-security-plan": { "metadata": { "title": "SSP" } } }` },
        getLayoutStorage: () => null,
        getData: async () => null,
        getComponentProperties: () => null,
        applyEdits: async (p: any) => {
          forwardedActions.push(...p.actions);
          return { seq: p.seq, edits: [], sidecarContent: JSON.stringify({ moved: true }), renderHint: "none" };
        },
      };
      const domainDispatch = createDiagramDispatch({ generic: mockGeneric });
      const backend = domainDispatch.getBackend(oscalUri);

      const res = await backend.applyEdits({
        uri: oscalUri,
        seq: 7,
        actions: [
          { type: "move", elementName: "comp_1", x: 120, y: 80 },
          { type: "addComponent", className: "component", name: "comp_2", x: 0, y: 0 },
        ],
      });

      assert.strictEqual(res.edits.length, 0);
      assert.deepStrictEqual(forwardedActions, [{ type: "move", elementName: "comp_1", x: 120, y: 80 }]);
      assert.ok(res.sidecarContent?.includes('"moved":true'));
    },
  );
});
