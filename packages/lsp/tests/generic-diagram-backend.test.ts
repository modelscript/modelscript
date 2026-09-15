// SPDX-License-Identifier: AGPL-3.0-or-later

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
    getDiagramConfig: () => ({
      nodes: {
        Step: {
          label: "Step",
          shape: "rect",
        },
      },
    }),
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
});
