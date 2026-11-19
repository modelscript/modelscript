// SPDX-License-Identifier: AGPL-3.0-or-later

import { MemoryFsBridge } from "@modelscript/diagram/fs-bridge";
import { SidecarLayoutStorage } from "@modelscript/diagram/layout-storage";
import assert from "node:assert";
import test from "node:test";
import { GenericDSLDiagramBackend, createDiagramDispatch, type DiagramBackend } from "../src/diagramApi.js";

test("GenericDSLDiagramBackend & Diagram Dispatch", async (t) => {
  const dummyDocUri = "file:///workspace/demo.flow";
  const dummyModelicaUri = "file:///workspace/Motor.mo";
  const dummySysmlUri = "file:///workspace/System.sysml";

  // Mock layout storage with in-memory map
  const layoutStorage = new SidecarLayoutStorage();
  await layoutStorage.saveLayout(dummyDocUri, {
    version: 1,
    elements: {
      "node-1": { x: 150, y: 250, width: 120, height: 60 },
    },
    connections: {},
  });

  const genericBackend = new GenericDSLDiagramBackend({
    getDocumentText: (uri) => (uri === dummyDocUri ? "step A -> step B" : undefined),
    getDiagramConfig: (uri) =>
      uri === dummyDocUri
        ? {
            nodes: {
              Step: {
                label: "Step",
                shape: "rect",
              },
            },
          }
        : undefined,
    getSyntaxNames: () => ({ 1: "Step" }),
    getRawAstData: () => ({
      nodes: [
        { id: "node-1", typeId: 1, type: "Step", name: "StepA" },
        { id: "node-2", typeId: 1, type: "Step", name: "StepB" },
      ],
      edges: [{ source: "node-1", target: "node-2", label: "next" }],
    }),
    layoutStorage,
  });

  const mockModelicaBackend: DiagramBackend = {
    getData: async () => ({ nodes: [], edges: [] }) as any,
    getComponentProperties: () => null,
    applyEdits: async () => ({ seq: 1, edits: [], renderHint: "immediate" }),
  };

  const mockSysmlBackend: DiagramBackend = {
    getData: async () => ({ nodes: [], edges: [] }) as any,
    getComponentProperties: () => null,
    applyEdits: async () => ({ seq: 1, edits: [], renderHint: "immediate" }),
  };

  const dispatch = createDiagramDispatch({
    modelica: mockModelicaBackend,
    sysml2: mockSysmlBackend,
    generic: genericBackend,
  });

  await t.test("should route file extensions appropriately in createDiagramDispatch", () => {
    assert.strictEqual(dispatch.getBackend(dummyModelicaUri), mockModelicaBackend);
    assert.strictEqual(dispatch.getBackend(dummySysmlUri), mockSysmlBackend);
    assert.strictEqual(dispatch.getBackend(dummyDocUri), genericBackend);
    assert.strictEqual(dispatch.getBackend("file:///workspace/other.dsl"), genericBackend);
  });

  await t.test("should generate diagram data and merge persisted layout coordinates", async () => {
    const data = await genericBackend.getData({
      uri: dummyDocUri,
      diagramType: "default",
    });

    assert.ok(data, "Diagram data should be returned");
    assert.strictEqual(data.nodes.length, 2);
    assert.strictEqual(data.edges.length, 1);

    const node1 = data.nodes.find((n: any) => n.id === "node-1");
    assert.ok(node1);
    assert.strictEqual(node1.x, 150);
    assert.strictEqual(node1.y, 250);
    assert.strictEqual(node1.width, 120);
    assert.strictEqual(node1.height, 60);
    assert.strictEqual(node1.autoLayout, false);

    const node2 = data.nodes.find((n: any) => n.id === "node-2");
    assert.ok(node2);
    // node-2 has no persisted position
    assert.strictEqual(node2.autoLayout, true);
  });

  await t.test("should apply visual move edits and persist to layoutStorage", async () => {
    const res = await genericBackend.applyEdits({
      uri: dummyDocUri,
      seq: 42,
      actions: [
        {
          type: "move",
          items: [
            {
              componentName: "node-2",
              origin: { x: 300, y: 400 },
              extent: { p1: { x: 0, y: 0 }, p2: { x: 80, y: 40 } },
            },
          ],
        },
      ],
    });

    assert.strictEqual(res.seq, 42);
    assert.strictEqual(res.renderHint, "none");

    // Verify stored position in layoutStorage
    const updatedLayout = await layoutStorage.loadLayout(dummyDocUri);
    assert.ok(updatedLayout);
    assert.ok(updatedLayout.elements["node-2"]);
    assert.strictEqual(updatedLayout.elements["node-2"].x, 300);
    assert.strictEqual(updatedLayout.elements["node-2"].y, 400);
  });

  await t.test("should return component properties for inspected node", () => {
    const props = genericBackend.getComponentProperties({
      uri: dummyDocUri,
      componentName: "node-1",
    });

    assert.ok(props);
    assert.strictEqual(props.name, "node-1");
    assert.strictEqual(props.className, "Component");
  });

  await t.test("should generate text edits for connect and addComponent mutations", async () => {
    const res = await genericBackend.applyEdits({
      uri: dummyDocUri,
      seq: 43,
      actions: [
        {
          type: "addComponent",
          className: "Step",
          x: 400,
          y: 200,
        },
        {
          type: "connect",
          source: "step1",
          target: "step2",
        },
      ],
    });

    assert.strictEqual(res.seq, 43);
    assert.strictEqual(res.renderHint, "immediate");
    assert.strictEqual(res.edits.length, 2);
    assert.ok(res.edits.some((e) => e.newText.includes("Step step1;")));
    assert.ok(res.edits.some((e) => e.newText.includes("connect(step1, step2);")));
  });

  await t.test("should generate text edits for deleteComponents and disconnect mutations", async () => {
    const testDoc = "step A;\nstep B;\nconnect(A, B);\n";
    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => testDoc,
      layoutStorage,
    });

    const res = await backend.applyEdits({
      uri: dummyDocUri,
      seq: 44,
      actions: [
        {
          type: "disconnect",
          source: "A",
          target: "B",
        },
        {
          type: "deleteComponents",
          names: ["A"],
        },
      ],
    });

    assert.strictEqual(res.seq, 44);
    assert.strictEqual(res.renderHint, "immediate");
    assert.strictEqual(res.edits.length, 2);
    assert.strictEqual(res.edits[0].newText, "");
    assert.strictEqual(res.edits[1].newText, "");
  });

  await t.test(
    "should safely disconnect and reconnect specific ports without prefix or multi-port collisions",
    async () => {
      const testDoc =
        [
          "connect(R1.n, C1.p) annotation(Line(points={{10, 20}, {30, 40}}));",
          "connect(R1.p, C1.n);",
          "connect(R10.n, C10.p);",
        ].join("\n") + "\n";

      const backend = new GenericDSLDiagramBackend({
        getDocumentText: () => testDoc,
        layoutStorage,
      });

      // 1. Disconnecting R1.n -> C1.p must delete line 0 and NOT line 1 or line 2
      const discRes = await backend.applyEdits({
        uri: dummyDocUri,
        seq: 45,
        actions: [
          {
            type: "disconnect",
            source: "R1",
            target: "C1",
            sourcePort: "n",
            targetPort: "p",
          },
        ],
      });
      assert.strictEqual(discRes.edits.length, 1);
      assert.strictEqual(discRes.edits[0].range.start.line, 0);

      // 2. Reconnecting R1.p -> C1.n to R1.p -> L1.p with points must replace line 1 and update annotation
      const reconRes = await backend.applyEdits({
        uri: dummyDocUri,
        seq: 46,
        actions: [
          {
            type: "reconnect",
            oldSource: "R1",
            oldTarget: "C1",
            oldSourcePort: "p",
            oldTargetPort: "n",
            newSource: "R1",
            newTarget: "L1",
            newSourcePort: "p",
            newTargetPort: "p",
            points: [{ x: 50, y: 60 }],
          },
        ],
      });
      assert.strictEqual(reconRes.edits.length, 1);
      assert.strictEqual(reconRes.edits[0].range.start.line, 1);
      assert.ok(reconRes.edits[0].newText.includes("connect(R1.p, L1.p)"));
      assert.ok(reconRes.edits[0].newText.includes("points={{50, 60}}"));
    },
  );

  await t.test("should support multi-edge templates and section-aware insertion for existing sections", async () => {
    const testDoc = [
      "package Demo {",
      "  elements {",
      "    Step s1;",
      "    Step s2;",
      "  }",
      "  equations {",
      "  }",
      "}",
    ].join("\n");

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => testDoc,
      getDiagramConfig: () => ({
        mutations: {
          edgeTemplates: {
            flow: (src: string, tgt: string) => `flow ${src} -> ${tgt};\n`,
            portFlow: (src: string, tgt: string, sp?: string, tp?: string) => `connect ${src}.${sp} ~ ${tgt}.${tp};\n`,
          },
          sections: {
            edge: "equations",
            node: "elements",
          },
        },
      }),
      layoutStorage,
    });

    const res = await backend.applyEdits({
      uri: dummyDocUri,
      seq: 45,
      actions: [
        {
          type: "connect",
          edgeType: "flow",
          source: "s1",
          target: "s2",
        },
        {
          type: "connect",
          edgeType: "portFlow",
          source: "s1",
          sourcePort: "out",
          target: "s2",
          targetPort: "in",
        },
        {
          type: "addComponent",
          className: "Step",
          name: "s3",
          x: 100,
          y: 100,
        },
      ],
    });

    assert.strictEqual(res.seq, 45);
    assert.strictEqual(res.renderHint, "immediate");
    assert.strictEqual(res.edits.length, 3);

    // Edits for edges should target equations block (line 6)
    assert.ok(res.edits[0].newText.includes("flow s1 -> s2;"));
    assert.strictEqual(res.edits[0].range.start.line, 6);

    assert.ok(res.edits[1].newText.includes("connect s1.out ~ s2.in;"));
    assert.strictEqual(res.edits[1].range.start.line, 6);

    // Edit for node should target elements block (line 4)
    assert.ok(res.edits[2].newText.includes("Step s3;"));
    assert.strictEqual(res.edits[2].range.start.line, 4);
  });

  await t.test("should synthesize missing section block when section does not exist in document", async () => {
    const testDoc = ["package Demo {", "  Step s1;", "}"].join("\n");

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => testDoc,
      getDiagramConfig: () => ({
        mutations: {
          sections: {
            edge: "equations",
          },
        },
      }),
      layoutStorage,
    });

    const res = await backend.applyEdits({
      uri: dummyDocUri,
      seq: 46,
      actions: [
        {
          type: "connect",
          source: "s1",
          target: "s2",
        },
      ],
    });

    assert.strictEqual(res.seq, 46);
    assert.strictEqual(res.edits.length, 1);
    assert.ok(res.edits[0].newText.includes("equations {"));
    assert.ok(res.edits[0].newText.includes("connect(s1, s2);"));
    assert.strictEqual(res.edits[0].range.start.line, 2);
  });

  await t.test("should handle updateName and updateParameter AST mutations", async () => {
    const testDoc = ["model Circuit {", "  Resistor R1(R = 100);", "  connect(R1.p, ground.p);", "}"].join("\n");

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => testDoc,
      layoutStorage,
    });

    const res = await backend.applyEdits({
      uri: dummyDocUri,
      seq: 47,
      actions: [
        {
          type: "updateName",
          oldName: "R1",
          newName: "ResistorA",
        },
        {
          type: "updateParameter",
          name: "R1",
          parameter: "R",
          value: "220",
        },
      ],
    });

    assert.strictEqual(res.seq, 47);
    // Should have 2 edits for R1 renaming (decl + connect) and 1 for parameter update
    assert.strictEqual(res.edits.length, 3);
    const renameEdits = res.edits.filter((e) => e.newText === "ResistorA");
    assert.strictEqual(renameEdits.length, 2);
    const paramEdit = res.edits.find((e) => e.newText === "220");
    assert.ok(paramEdit);
    assert.strictEqual(paramEdit.range.start.line, 1);
  });

  await t.test("should return palette items from config.palette", () => {
    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => "",
      getDiagramConfig: () => ({
        palette: {
          categories: [
            {
              name: "Components",
              items: [{ label: "Resistor", className: "Resistor" }],
            },
          ],
        },
      }),
      layoutStorage,
    });

    const palette = backend.getPalette({ uri: dummyDocUri });
    assert.ok(palette);
    assert.strictEqual(palette.categories.length, 1);
    assert.strictEqual(palette.categories[0].name, "Components");
    assert.strictEqual(palette.categories[0].items[0].label, "Resistor");
  });

  await t.test("should support drillDown into child diagram and return breadcrumbs", async () => {
    const childUri = "file:///workspace/Subsystem.dsl";
    const mockSymbolIndex = {
      symbols: new Map([["sym_1", { name: "Subsystem", resourceId: childUri, ruleName: "Block" }]]),
    };

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: (uri) => (uri === childUri ? "block Subsystem {}" : "block Main {}"),
      getDiagramConfig: () => ({
        nodes: { Block: { shape: "rect" } },
      }),
      getSymbolIndex: () => mockSymbolIndex,
      layoutStorage,
    });

    const res = await backend.drillDown({
      uri: dummyDocUri,
      nodeId: "node_sub",
      className: "Subsystem",
    });

    assert.ok(res);
    assert.strictEqual(res.targetClassName, "Subsystem");
    assert.strictEqual(res.targetUri, childUri);
    assert.strictEqual(res.breadcrumbs.length, 2);
    assert.strictEqual(res.breadcrumbs[0].id, "root");
    assert.strictEqual(res.breadcrumbs[1].id, "node_sub");
  });

  await t.test("should extract schema and values using inModelDiscovery when configured", () => {
    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => "component Valve v1 { setpoint = 50; }",
      getDiagramConfig: () => ({
        properties: {
          inModelDiscovery: {
            extractSchema: (target: string, ast: any) => ({
              tabs: [
                {
                  id: "general",
                  label: "General",
                  groups: [
                    {
                      id: "ctrl",
                      label: "Control",
                      fields: [{ key: "setpoint", label: "Setpoint", kind: "number", min: 0, max: 100 }],
                    },
                  ],
                },
              ],
            }),
            extractValues: (target: string, ast: any) => ({
              setpoint: "50",
            }),
          },
        },
      }),
      layoutStorage,
    });

    const props = backend.getComponentProperties({
      uri: dummyDocUri,
      componentName: "v1",
      className: "Valve",
    });

    assert.ok(props);
    assert.strictEqual(props.name, "v1");
    assert.strictEqual(props.className, "Valve");
    assert.ok(props.schema);
    assert.strictEqual(props.schema.tabs.length, 1);
    assert.strictEqual(props.schema.tabs[0].groups[0].fields[0].key, "setpoint");
    assert.strictEqual(props.values?.["setpoint"], "50");
  });

  await t.test("should support custom mutator.updateProperty and modifier fallback", async () => {
    // 1. With custom mutator
    let customMutatorInvoked = false;
    const backendWithCustomMutator = new GenericDSLDiagramBackend({
      getDocumentText: () => "component Valve v1 { setpoint = 50; }",
      getDiagramConfig: () => ({
        properties: {
          mutator: {
            updateProperty: (db: any, target: string, prop: string, val: string) => {
              customMutatorInvoked = true;
              return [{ range: { start: { line: 0, character: 33 }, end: { line: 0, character: 35 } }, newText: val }];
            },
          },
        },
      }),
      layoutStorage,
    });

    const res1 = await backendWithCustomMutator.applyEdits({
      uri: dummyDocUri,
      seq: 48,
      actions: [
        {
          type: "updateProperty",
          name: "v1",
          propertyName: "setpoint",
          value: "75",
        },
      ],
    });

    assert.strictEqual(customMutatorInvoked, true);
    assert.strictEqual(res1.edits.length, 1);
    assert.strictEqual(res1.edits[0].newText, "75");

    // 2. With default modifier fallback
    const backendWithFallback = new GenericDSLDiagramBackend({
      getDocumentText: () => "model M {\n  Resistor R1(R = 100);\n}",
      layoutStorage,
    });

    const res2 = await backendWithFallback.applyEdits({
      uri: dummyDocUri,
      seq: 49,
      actions: [
        {
          type: "updateProperty",
          name: "R1",
          propertyName: "R",
          value: "220",
        },
      ],
    });

    assert.strictEqual(res2.edits.length, 1);
    assert.strictEqual(res2.edits[0].newText, "220");
    assert.strictEqual(res2.edits[0].range.start.line, 1);
  });

  await t.test("should honor custom SidecarConfig and synchronize element rename via updateName", async () => {
    const memoryFs = new MemoryFsBridge();
    const docUri = "file:///workspace/models/Vehicle.sysml";

    const customBackend = new GenericDSLDiagramBackend({
      getDocumentText: () => "part def Vehicle { part ch: Chassis; }",
      getDiagramConfig: () => ({
        placement: {
          persistence: "sidecar",
          sidecar: {
            extension: ".sysml.layout",
            location: "subfolder",
          },
        },
      }),
      fsBridge: memoryFs,
    });

    // 1. Move element
    await customBackend.applyEdits({
      uri: docUri,
      seq: 100,
      actions: [
        {
          type: "move",
          items: [{ name: "Vehicle", x: 250, y: 350, width: 100, height: 80 }],
        },
      ],
    });

    // Expected sidecar path: file:///workspace/models/.layouts/Vehicle.sysml.layout
    const expectedSidecarUri = "file:///workspace/models/.layouts/Vehicle.sysml.layout";
    const exists = await memoryFs.exists(expectedSidecarUri);
    assert.strictEqual(exists, true, "Sidecar file should exist in subfolder with custom extension");

    const content = await memoryFs.readFile(expectedSidecarUri);
    assert.ok(content);
    const layout = JSON.parse(content);
    assert.strictEqual(layout.elements.Vehicle.x, 250);
    assert.strictEqual(layout.elements.Vehicle.y, 350);

    // 2. Rename element via updateName action
    await customBackend.applyEdits({
      uri: docUri,
      seq: 101,
      actions: [
        {
          type: "updateName",
          oldName: "Vehicle",
          newName: "Automobile",
        },
      ],
    });

    const updatedContent = await memoryFs.readFile(expectedSidecarUri);
    assert.ok(updatedContent);
    const updatedLayout = JSON.parse(updatedContent);
    assert.strictEqual(updatedLayout.elements.Vehicle, undefined, "Old element name should be removed");
    assert.ok(updatedLayout.elements.Automobile, "New element name should exist");
    assert.strictEqual(updatedLayout.elements.Automobile.x, 250);
    assert.strictEqual(updatedLayout.elements.Automobile.y, 350);
  });

  await t.test(
    "should throw an error saying diagrams are not supported when language lacks diagram capability",
    async () => {
      const unsupportedBackend = new GenericDSLDiagramBackend({
        getDocumentText: () => "plain text without diagram config or AST",
      });

      await assert.rejects(
        async () => {
          await unsupportedBackend.getData({
            uri: "file:///workspace/readme.txt",
          });
        },
        {
          message: /Diagram view is not supported for/,
        },
      );
    },
  );

  await t.test(
    "should return empty diagram without synthesizing fake RootModel when supported language has zero components",
    async () => {
      const emptySupportedBackend = new GenericDSLDiagramBackend({
        getDocumentText: () => "// just comments, no components",
        getDiagramConfig: () => ({ nodes: {} }),
      });

      const data = await emptySupportedBackend.getData({
        uri: "file:///workspace/empty.dsl",
      });

      assert.ok(data);
      assert.strictEqual(data.nodes.length, 0, "Must not synthesize fake RootModel node");
      assert.strictEqual(data.edges.length, 0);
    },
  );

  await t.test("should report accurate diagram support in dispatch.supports()", () => {
    assert.strictEqual(dispatch.supports("file:///workspace/model.mo"), true);
    assert.strictEqual(dispatch.supports("file:///workspace/system.sysml"), true);
    assert.strictEqual(dispatch.supports("file:///workspace/model.scad"), true);
    assert.strictEqual(dispatch.supports("file:///workspace/kernel.f90"), true);
    assert.strictEqual(dispatch.supports("file:///workspace/policy.oscal.json"), true);
    assert.strictEqual(dispatch.supports("file:///workspace/unknown.xyz"), false);
  });

  await t.test(
    "extracts OpenSCAD (.scad) CSG tree via WASM CST including 3-arg tag_port and pattern calls",
    async () => {
      const scadUri = "file:///workspace/frame.scad";
      const scadCode = `
arm_len = 120;
// ignored_var = 999;
module arm(angle, len = 50) {
  difference() {
    translate([0, 0, 5]) rotate([0, 0, angle]) cube([len, 10, 5], center=true);
    cylinder(h=12, r=3);
  }
}
tag_port("fixed_hub", "fixed_support", [0, 0, 1]) {
  cylinder(r=20, h=10);
}
arm(45);
arm(135);
`;
      const scadBackend = new GenericDSLDiagramBackend({
        getDocumentText: (uri) => (uri === scadUri ? scadCode : undefined),
      });

      const data = await scadBackend.getData({ uri: scadUri });
      assert.ok(data, "Expected SCAD diagram data");

      const paramsNode = data.nodes.find((n: any) => n.id === "scad_parameters");
      assert.ok(paramsNode, "Expected scad_parameters node");
      assert.ok(!JSON.stringify(paramsNode).includes("ignored_var"), "Comments must be ignored by CST");

      const modNode = data.nodes.find((n: any) => n.name === "arm" && n.kind === "Module");
      assert.ok(modNode, "Expected Module node for arm");

      const portNode = data.nodes.find((n: any) => n.kind === "Port" && n.name === "fixed_hub");
      assert.ok(portNode, "Expected Port node from 3-arg tag_port");
      assert.strictEqual(portNode.properties?.description, 'tag_port("fixed_hub", "fixed_support")');

      const diffNode = data.nodes.find((n: any) => n.kind === "BooleanOp" && n.name === "difference()");
      assert.ok(diffNode, "Expected difference() BooleanOp node");

      const translateNode = data.nodes.find((n: any) => n.kind === "Transform" && n.name === "translate");
      const rotateNode = data.nodes.find((n: any) => n.kind === "Transform" && n.name === "rotate");
      const cubeNode = data.nodes.find((n: any) => n.kind === "Primitive" && n.name === "cube");
      assert.ok(translateNode && rotateNode && cubeNode, "Expected chained translate -> rotate -> cube CST nodes");
      assert.ok(
        !String(cubeNode.properties?.description ?? "").includes("center"),
        "center=true should be stripped from cube subtitle",
      );
      assert.ok(data.edges.some((e: any) => e.source === diffNode.id && e.target === translateNode.id));
      assert.ok(data.edges.some((e: any) => e.source === translateNode.id && e.target === rotateNode.id));
      assert.ok(data.edges.some((e: any) => e.source === rotateNode.id && e.target === cubeNode.id));

      const instNode = data.nodes.find((n: any) => n.id === "inst_arm" && n.kind === "AssemblyInstance");
      assert.ok(instNode, "Expected grouped AssemblyInstance node for top-level arm() calls");
      assert.ok(String(instNode.properties?.description ?? "").includes("2× instances (45, 135)"));
      assert.ok(data.edges.some((e: any) => e.source === instNode.id && e.target === modNode.id));
    },
  );

  await t.test("extracts Fortran 90 module & EMTDC $Port dataflow via WASM CST", async () => {
    const f90Uri = "file:///workspace/ctrl.f90";
    const f90Code = `
module ctrl_mod
  implicit none
contains
  subroutine step_ctrl(u_in, y_out)
    real(8), intent(in) :: u_in
    real(8), intent(out) :: y_out
    real(8) :: tmp
    parameter (GAIN = 2.0)
    if (u_in > 0.0) then
      tmp = u_in * GAIN
    else
      tmp = 0.0
    end if
    call helper_fn(tmp, y_out)
  end subroutine step_ctrl

  subroutine helper_fn(a, b)
    real(8), intent(in) :: a
    real(8), intent(out) :: b
    b = a * 2.0
  end subroutine helper_fn
end module ctrl_mod
`;
    const fortranBackend = new GenericDSLDiagramBackend({
      getDocumentText: (uri) => (uri === f90Uri ? f90Code : undefined),
    });

    const f90Data = await fortranBackend.getData({ uri: f90Uri });
    assert.ok(f90Data, "Expected F90 diagram data");
    assert.ok(f90Data.nodes.some((n: any) => n.id === "in_u_in" && n.kind === "InputPort"));
    assert.ok(f90Data.nodes.some((n: any) => n.id === "out_y_out" && n.kind === "OutputPort"));
    assert.ok(f90Data.nodes.some((n: any) => n.id === "const_gain" && n.kind === "Constant"));
    const callNode = f90Data.nodes.find((n: any) => n.kind === "SubroutineCall" && n.name === "CALL helper_fn");
    assert.ok(callNode, "Expected CALL helper_fn SubroutineCall node");
    assert.ok(
      f90Data.edges.some((e: any) => e.source === callNode.id && e.target === "out_y_out"),
      "Helper subroutine intent(out) should wire to out_y_out",
    );

    const emtdcUri = "file:///workspace/filter.f";
    const emtdcCode = `C EMTDC Filter Block
#IF 1
      REAL Y
      PARAMETER (K = 2.0)
      STORF(1) = $In * K
      IF (FIRSTSTEP) THEN
        STORF(1) = 0.0
      END IF
      CALL REALPOLE(1.0, 0.1, STORF(1), Y)
      $Out = Y
#ENDIF
`;
    const emtdcBackend = new GenericDSLDiagramBackend({
      getDocumentText: (uri) => (uri === emtdcUri ? emtdcCode : undefined),
    });
    const emtdcData = await emtdcBackend.getData({ uri: emtdcUri });
    assert.ok(emtdcData, "Expected EMTDC diagram data");
    assert.ok(emtdcData.nodes.some((n: any) => n.id === "in_in" && n.kind === "InputPort"));
    assert.ok(emtdcData.nodes.some((n: any) => n.id === "out_out" && n.kind === "OutputPort"));
    assert.ok(emtdcData.nodes.some((n: any) => n.kind === "StateEquation"));
    const realpoleNode = emtdcData.nodes.find((n: any) => n.kind === "SubroutineCall" && n.name === "CALL REALPOLE");
    const outEqNode = emtdcData.nodes.find((n: any) => n.kind === "Equation" && n.name === "$Out");
    assert.ok(realpoleNode && outEqNode, "Expected CALL REALPOLE and $Out equation nodes");
    assert.ok(
      emtdcData.edges.some((e: any) => e.source === realpoleNode.id && e.target === outEqNode.id),
      "REALPOLE output Y should wire into $Out = Y",
    );
    assert.ok(
      emtdcData.edges.some((e: any) => e.source === outEqNode.id && e.target === "out_out"),
      "$Out = Y should wire into out_out OutputPort",
    );
  });

  await t.test("applyEdits inline placement ignores @layout/annotation/tokens inside string literals", async () => {
    const uri = "file:///workspace/inline.dsl";
    const docText = [
      'Resistor r0 "see r1 @layout(x=0, y=0)";',
      'Resistor r1 "desc annotation(Placement(x=1))" @layout(x=10, y=20);',
    ].join("\n");
    const backend = new GenericDSLDiagramBackend({
      getDocumentText: (u) => (u === uri ? docText : undefined),
      getDiagramConfig: () => ({
        placement: {
          persistence: "inline",
        },
      }),
    });

    const moveRes = await backend.applyEdits({
      uri,
      seq: 1,
      actions: [{ type: "move", items: [{ name: "r1", x: 111, y: 222 }] }],
    });
    assert.strictEqual(moveRes.edits.length, 1);
    assert.strictEqual(moveRes.edits[0]!.range.start.line, 1, "Must skip string literal r1 on line 0");
    assert.strictEqual(
      moveRes.edits[0]!.range.start.character,
      docText.split("\n")[1]!.indexOf("@layout("),
      "Must target real @layout(...) rather than annotation(Placement(...)) inside string",
    );
    assert.strictEqual(moveRes.edits[0]!.newText, "@layout(x=111, y=222)");

    const resizeRes = await backend.applyEdits({
      uri,
      seq: 2,
      actions: [{ type: "resize", item: { name: "r1", x: 50, y: 60, width: 80, height: 40 } }],
    });
    assert.strictEqual(resizeRes.edits.length, 1);
    assert.strictEqual(resizeRes.edits[0]!.range.start.line, 1);
    assert.strictEqual(resizeRes.edits[0]!.newText, "@layout(x=50, y=60)");
  });

  await t.test("should synthesize OpenSCAD structural edits using scadLanguage diagram mutations", async () => {
    const { scadLanguage } = await import("@modelscript/scad");
    const scadUri = "file:///test/bracket.scad";
    const scadText = "cube([10, 10, 10], center = true);\n";

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: (u) => (u === scadUri ? scadText : undefined),
      getDiagramConfig: () => scadLanguage.diagram,
      layoutStorage,
    });

    const addRes = await backend.applyEdits({
      uri: scadUri,
      seq: 10,
      actions: [{ type: "addComponent", className: "Cylinder", name: "bore", x: 120, y: 80 }],
    });
    assert.ok(addRes.edits.length >= 1, "Expected synthesized SCAD edit");
    assert.ok(
      addRes.edits[0]!.newText.includes("translate([120, 80, 0]) cylinder("),
      `Unexpected SCAD node text: ${addRes.edits[0]!.newText}`,
    );
    assert.ok(addRes.sidecarContent !== undefined, "Expected sidecar layout update");
  });

  await t.test("should insert URDF <link> and <joint> inside </robot> via urdfLanguage.diagram mutations", async () => {
    const { urdfLanguage } = await import("@modelscript/urdf");
    const urdfUri = "file:///test/arm.urdf";
    const urdfText = `<robot name="arm">\n  <link name="base"/>\n</robot>\n`;

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: (u) => (u === urdfUri ? urdfText : undefined),
      getDiagramConfig: () => urdfLanguage.diagram,
      layoutStorage,
    });

    const addRes = await backend.applyEdits({
      uri: urdfUri,
      seq: 11,
      actions: [
        { type: "addComponent", className: "Link", name: "wrist", x: 100, y: 120 },
        { type: "connect", source: "base", target: "wrist" },
      ],
    });
    assert.strictEqual(addRes.edits.length, 2, "Expected both link and joint XML edits");
    assert.ok(addRes.edits[0]!.newText.includes('<link name="wrist">'));
    assert.strictEqual(addRes.edits[0]!.range.start.line, 2, "Should insert right before </robot>");
    assert.ok(addRes.edits[1]!.newText.includes('<joint name="base_to_wrist"'));
  });

  await t.test("should insert ReqIF <SPEC-OBJECT> and <SPEC-RELATION> inside XML container tags", async () => {
    const { reqifLanguage } = await import("@modelscript/reqif");
    const reqUri = "file:///test/reqs.reqif";
    const reqText = [
      "<REQ-IF>",
      "  <CORE-CONTENT><REQ-IF-CONTENT>",
      "    <SPEC-OBJECTS>",
      '      <SPEC-OBJECT IDENTIFIER="R1" LONG-NAME="Req 1"/>',
      "    </SPEC-OBJECTS>",
      "    <SPEC-RELATIONS>",
      "    </SPEC-RELATIONS>",
      "  </REQ-IF-CONTENT></CORE-CONTENT>",
      "</REQ-IF>",
    ].join("\n");

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: (u) => (u === reqUri ? reqText : undefined),
      getDiagramConfig: () => reqifLanguage.diagram,
      layoutStorage,
    });

    const editRes = await backend.applyEdits({
      uri: reqUri,
      seq: 12,
      actions: [
        { type: "addComponent", className: "Requirement", name: "R2", x: 200, y: 50 },
        { type: "connect", source: "R1", target: "R2" },
      ],
    });
    assert.strictEqual(editRes.edits.length, 2);
    assert.ok(editRes.edits[0]!.newText.includes('<SPEC-OBJECT IDENTIFIER="R2"'));
    assert.strictEqual(editRes.edits[0]!.range.start.line, 4, "Should insert inside </SPEC-OBJECTS>");
    assert.ok(editRes.edits[1]!.newText.includes('<SPEC-RELATION IDENTIFIER="R1_to_R2"'));
    assert.strictEqual(editRes.edits[1]!.range.start.line, 6, "Should insert inside </SPEC-RELATIONS>");
  });

  await t.test(
    "should synthesize structural edits for autosar, opendrive, adams, and simpack via diagram.mutations",
    async () => {
      const { autosarLanguage } = await import("@modelscript/autosar");
      const { opendriveLanguage } = await import("@modelscript/opendrive");
      const { adamsLanguage } = await import("@modelscript/adams");
      const { simpackLanguage } = await import("@modelscript/simpack");

      // 1. AUTOSAR (.arxml)
      const arUri = "file:///test/ecu.arxml";
      const arText = [
        "<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>App</SHORT-NAME>",
        "  <ELEMENTS>",
        "  </ELEMENTS>",
        "  <CONNECTORS>",
        "  </CONNECTORS>",
        "</AR-PACKAGE></AR-PACKAGES></AUTOSAR>",
      ].join("\n");
      const arBackend = new GenericDSLDiagramBackend({
        getDocumentText: (u) => (u === arUri ? arText : undefined),
        getDiagramConfig: () => autosarLanguage.diagram,
        layoutStorage,
      });
      const arRes = await arBackend.applyEdits({
        uri: arUri,
        seq: 13,
        actions: [
          { type: "addComponent", className: "SWC", name: "Ctrl", x: 50, y: 50 },
          { type: "connect", source: "Sensor", target: "Ctrl" },
        ],
      });
      assert.strictEqual(arRes.edits.length, 2);
      assert.ok(arRes.edits[0]!.newText.includes("<APPLICATION-SW-COMPONENT-TYPE><SHORT-NAME>Ctrl</SHORT-NAME>"));
      assert.ok(arRes.edits[1]!.newText.includes("<ASSEMBLY-SW-CONNECTOR><SHORT-NAME>Sensor_to_Ctrl</SHORT-NAME>"));

      // 2. OpenDRIVE (.xodr)
      const xodrUri = "file:///test/road.xodr";
      const xodrText = `<OpenDRIVE>\n  <header revMajor="1" revMinor="7"/>\n</OpenDRIVE>\n`;
      const xodrBackend = new GenericDSLDiagramBackend({
        getDocumentText: (u) => (u === xodrUri ? xodrText : undefined),
        getDiagramConfig: () => opendriveLanguage.diagram,
        layoutStorage,
      });
      const xodrRes = await xodrBackend.applyEdits({
        uri: xodrUri,
        seq: 14,
        actions: [
          { type: "addComponent", className: "Road", name: "R_2", x: 180, y: 40 },
          { type: "connect", source: "R_1", target: "R_2" },
        ],
      });
      assert.strictEqual(xodrRes.edits.length, 2);
      assert.ok(xodrRes.edits[0]!.newText.includes('<road name="R_2"'));
      assert.ok(xodrRes.edits[1]!.newText.includes('<junction id="R_1_to_R_2"'));

      // 3. MSC Adams (.adm) — inserts before trailing END card
      const admUri = "file:///test/pendulum.adm";
      const admText = `PART/1, GROUND\nEND\n`;
      const admBackend = new GenericDSLDiagramBackend({
        getDocumentText: (u) => (u === admUri ? admText : undefined),
        getDiagramConfig: () => adamsLanguage.diagram,
        layoutStorage,
      });
      const admRes = await admBackend.applyEdits({
        uri: admUri,
        seq: 15,
        actions: [
          { type: "addComponent", className: "Part", name: "Body2", x: 100, y: 100 },
          { type: "connect", source: "1", target: "Body2" },
        ],
      });
      assert.strictEqual(admRes.edits.length, 2);
      assert.ok(admRes.edits[0]!.newText.includes("PART/Body2, MASS = 1.0"));
      assert.strictEqual(admRes.edits[0]!.range.start.line, 1, "Should insert Adams card before END");
      assert.ok(admRes.edits[1]!.newText.includes("JOINT/1_to_Body2, REVOLUTE, I = 1, J = Body2"));

      // 4. SIMPACK (.spck/.sim)
      const simUri = "file:///test/bogie.sim";
      const simText = `$# Bogie\nbody frame frame 100.0 1.0 1.0 1.0\n`;
      const simBackend = new GenericDSLDiagramBackend({
        getDocumentText: (u) => (u === simUri ? simText : undefined),
        getDiagramConfig: () => simpackLanguage.diagram,
        layoutStorage,
      });
      const simRes = await simBackend.applyEdits({
        uri: simUri,
        seq: 16,
        actions: [
          { type: "addComponent", className: "Body", name: "wheelset", x: 220, y: 60 },
          { type: "connect", source: "frame", target: "wheelset" },
        ],
      });
      assert.strictEqual(simRes.edits.length, 2);
      assert.ok(simRes.edits[0]!.newText.includes("body wheelset wheelset 1.0"));
      assert.ok(simRes.edits[1]!.newText.includes("joint frame_to_wheelset revolute frame wheelset"));
    },
  );
});
