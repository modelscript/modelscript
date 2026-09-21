// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  Owl2DiagramBackend,
  createDiagramDispatch,
  type DiagramBackend,
  type Owl2BackendDeps,
} from "../src/diagramApi.js";

test("OWL 2 Diagram Backend & Dispatch Integration", async (t) => {
  const dummyOwlUri = "file:///workspace/vehicle.owl";
  const dummyOfnUri = "file:///workspace/vehicle.ofn";
  const dummySysmlUri = "file:///workspace/system.sysml";
  const dummyModelicaUri = "file:///workspace/engine.mo";

  const initialDocText = `Ontology(<http://example.org/vehicle>
  Declaration(Class(:Vehicle))
  Declaration(Class(:Engine))
  Declaration(Class(:ElectricEngine))
  Declaration(ObjectProperty(:hasEngine))
  Declaration(NamedIndividual(:myCar))
  SubClassOf(:ElectricEngine :Engine)
  SubClassOf(:Engine :Vehicle)
  EquivalentClasses(:Vehicle :Car)
  DisjointClasses(:ElectricEngine :CombustionEngine)
  ObjectPropertyAssertion(:hasEngine :myCar :electricMotor)
)`;

  let currentDocText = initialDocText;
  let storedLayout: any = {
    elements: {
      ":Vehicle": { x: 100, y: 100, width: 160, height: 50 },
      ":Engine": { x: 100, y: 250, width: 160, height: 50 },
    },
    connections: {},
  };

  const sampleAxioms = [
    { type: "ClassDeclaration", iri: ":Vehicle" },
    { type: "ClassDeclaration", iri: ":Engine" },
    { type: "ClassDeclaration", iri: ":ElectricEngine" },
    { type: "ObjectPropertyDeclaration", iri: ":hasEngine" },
    { type: "IndividualDeclaration", iri: ":myCar" },
    { type: "SubClassOf", subClassIri: ":ElectricEngine", superClassIri: ":Engine" },
    { type: "SubClassOf", subClassIri: ":Engine", superClassIri: ":Vehicle" },
    { type: "EquivalentClasses", classIris: [":Vehicle", ":Car"] },
    { type: "DisjointClasses", classIris: [":ElectricEngine", ":CombustionEngine"] },
    { type: "ObjectPropertyAssertion", propertyIri: ":hasEngine", subjectIri: ":myCar", objectIri: ":electricMotor" },
  ];

  const deps: Owl2BackendDeps = {
    getDocumentText: (uri) => (uri === dummyOwlUri || uri === dummyOfnUri ? currentDocText : undefined),
    getAxioms: (_uri) => sampleAxioms,
    getLayout: (_uri) => storedLayout,
    setLayout: (_uri, layout) => {
      storedLayout = layout;
    },
    createEmptyLayout: () => ({ elements: {}, connections: {} }),
    updateElementPositions: (layout, items) => {
      const elements = { ...(layout?.elements ?? {}) };
      for (const item of items) {
        elements[item.name] = { x: item.x, y: item.y, width: item.width, height: item.height };
      }
      return { ...layout, elements };
    },
    updateConnectionVertices: (layout, updates) => {
      const connections = { ...(layout?.connections ?? {}) };
      for (const u of updates) {
        connections[u.id] = u.vertices;
      }
      return { ...layout, connections };
    },
    removeElements: (layout, names) => {
      const nameSet = new Set(names);
      const elements = Object.fromEntries(Object.entries(layout?.elements ?? {}).filter(([key]) => !nameSet.has(key)));
      return { ...layout, elements };
    },
  };

  const owl2Backend = new Owl2DiagramBackend(deps);

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
    owl2: owl2Backend,
  });

  await t.test("should route .owl and .ofn files to Owl2DiagramBackend in createDiagramDispatch", () => {
    assert.strictEqual(dispatch.getBackend(dummyOwlUri), owl2Backend);
    assert.strictEqual(dispatch.getBackend(dummyOfnUri), owl2Backend);
    assert.strictEqual(dispatch.getBackend("file:///test.owx"), owl2Backend);
    assert.strictEqual(dispatch.getBackend("file:///test.ttl"), owl2Backend);
    assert.strictEqual(dispatch.getBackend(dummySysmlUri), mockSysmlBackend);
    assert.strictEqual(dispatch.getBackend(dummyModelicaUri), mockModelicaBackend);
  });

  await t.test("should build diagram nodes and edges from OWL 2 axioms and layout", async () => {
    const data = await dispatch.getData({ uri: dummyOwlUri });
    assert.ok(data, "DiagramData must be returned");
    assert.ok(data.nodes.length >= 4, "Must contain classes, properties, and individuals");

    const vehicleNode = data.nodes.find((n) => n.id === ":Vehicle");
    assert.ok(vehicleNode, "Vehicle node must exist");
    assert.strictEqual(vehicleNode.x, 100);
    assert.strictEqual(vehicleNode.y, 100);
    assert.strictEqual(vehicleNode.autoLayout, false);

    const subClassEdge = data.edges.find(
      (e) => (e.source as any)?.cell === ":ElectricEngine" && (e.target as any)?.cell === ":Engine",
    );
    assert.ok(subClassEdge, "SubClassOf edge must exist");
    assert.strictEqual(subClassEdge.style?.type, "subClassOf");
  });

  await t.test("should provide ontology stencils palette", async () => {
    const palette = await dispatch.getPalette({ uri: dummyOwlUri });
    assert.ok(palette, "Palette must be returned");
    assert.ok(palette.categories.length >= 2, "Must contain categories");
    const classItem = palette.categories[0].items.find((i) => i.className === "Class");
    assert.ok(classItem, "Class stencil item must be present");
  });

  await t.test("should return component properties with ontology tabs and axioms", async () => {
    const props = await dispatch.getComponentProperties({
      uri: dummyOwlUri,
      componentName: ":Vehicle",
    });
    assert.ok(props, "Properties data must be returned");
    assert.strictEqual(props.name, ":Vehicle");
    assert.ok(props.schema?.tabs.some((t) => t.id === "general"));
    assert.ok(props.schema?.tabs.some((t) => t.id === "axioms"));
  });

  await t.test("should apply visual move edit and update sidecar layout", async () => {
    const result = await dispatch.applyEdits({
      uri: dummyOwlUri,
      seq: 1,
      actions: [
        {
          type: "move",
          items: [{ name: ":Vehicle", x: 300, y: 400, width: 160, height: 50 }],
        },
      ],
    });

    assert.strictEqual(result.renderHint, "none");
    assert.strictEqual(storedLayout.elements[":Vehicle"].x, 300);
    assert.strictEqual(storedLayout.elements[":Vehicle"].y, 400);
  });

  await t.test("should apply connect edit generating SubClassOf axiom", async () => {
    const result = await dispatch.applyEdits({
      uri: dummyOwlUri,
      seq: 2,
      actions: [
        {
          type: "connect",
          source: ":Car",
          target: ":Vehicle",
        },
      ],
    });

    assert.strictEqual(result.renderHint, "immediate");
    assert.ok(result.edits.length > 0, "Must produce text edits");
    const insertEdit = result.edits[0];
    assert.ok(insertEdit.newText.includes("SubClassOf(:Car :Vehicle)"));
  });

  await t.test("should apply addComponent edit generating Declaration", async () => {
    const result = await dispatch.applyEdits({
      uri: dummyOwlUri,
      seq: 3,
      actions: [
        {
          type: "addComponent",
          className: "Class",
          name: "Drone",
          x: 500,
          y: 200,
        },
      ],
    });

    assert.strictEqual(result.renderHint, "immediate");
    assert.ok(result.edits.length > 0);
    assert.ok(result.edits[0].newText.includes("Declaration(Class(:Drone))"));
    assert.ok(storedLayout.elements["Drone"], "New element should have coordinates in layout");
  });

  await t.test("should apply disconnect edit removing relationship", async () => {
    const result = await dispatch.applyEdits({
      uri: dummyOwlUri,
      seq: 4,
      actions: [
        {
          type: "disconnect",
          source: ":ElectricEngine",
          target: ":Engine",
        },
      ],
    });

    assert.strictEqual(result.renderHint, "immediate");
    assert.ok(result.edits.length > 0);
  });
});
