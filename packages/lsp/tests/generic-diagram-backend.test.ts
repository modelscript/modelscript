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
});
