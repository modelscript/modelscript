// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileDiagramConfigToPolyglot, type DiagramConfig } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { buildPolyglotDiagram } from "../src/polyglot-diagram-builder.js";

test("Generic Child Port Extraction with custom portRules", () => {
  const config: DiagramConfig = {
    nodes: {
      Module: {
        shape: "rect",
        role: "node",
      },
      Pin: {
        shape: "circle",
        role: "port",
        style: {
          fill: "#3b82f6",
          stroke: "#1d4ed8",
        },
      },
    },
    portRules: ["Pin"],
  };

  const { graphicsConfig, options } = compileDiagramConfigToPolyglot(config);
  assert.deepStrictEqual(options.portKinds, ["Pin"]);

  const symbols = new Map<SymbolId, SymbolEntry>();
  symbols.set(
    1 as SymbolId,
    {
      id: 1 as SymbolId,
      name: "Controller",
      ruleName: "Module",
      parentId: null,
    } as SymbolEntry,
  );

  symbols.set(
    2 as SymbolId,
    {
      id: 2 as SymbolId,
      name: "clk_in",
      ruleName: "Pin",
      parentId: 1 as SymbolId,
    } as SymbolEntry,
  );

  const index: SymbolIndex = {
    symbols,
    byName: new Map([
      ["Controller", [1 as SymbolId]],
      ["clk_in", [2 as SymbolId]],
    ]),
    childrenOf: new Map([[1 as SymbolId, [2 as SymbolId]]]),
  };

  const diagram = buildPolyglotDiagram(index, graphicsConfig, undefined, undefined, "All", options);

  // Module should be rendered as a node
  assert.strictEqual(diagram.nodes.length, 1);
  const modNode = diagram.nodes[0];
  assert.strictEqual(modNode.properties?.description, "Controller");

  // Child Pin should be extracted as an X6 port on the Module node, not as a standalone node or compartment text
  assert.ok(modNode.ports !== undefined);
  assert.ok(modNode.ports.items !== undefined);
  assert.strictEqual(modNode.ports.items.length, 1);
  const port = modNode.ports.items[0];
  assert.strictEqual(port.id, "clk_in");
  assert.ok(port.attrs !== undefined);
  // Should inherit custom styling from the Pin graphics config
  assert.strictEqual(port.attrs.circle?.fill, "#3b82f6");
});

test("Procedural 3D Gradients and Bitmap Raster Icons", () => {
  const config: DiagramConfig = {
    nodes: {
      Tank: {
        shape: "rect",
        style: {
          fillPattern: "cylinder-vertical",
          icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      },
      Valve: {
        shape: "rect",
        style: {
          fillPattern: "sphere",
        },
      },
    },
  };

  const { graphicsConfig, options } = compileDiagramConfigToPolyglot(config);

  const symbols = new Map<SymbolId, SymbolEntry>();
  symbols.set(
    1 as SymbolId,
    {
      id: 1 as SymbolId,
      name: "storageTank",
      ruleName: "Tank",
      parentId: null,
    } as SymbolEntry,
  );

  symbols.set(
    2 as SymbolId,
    {
      id: 2 as SymbolId,
      name: "inletValve",
      ruleName: "Valve",
      parentId: null,
    } as SymbolEntry,
  );

  const index: SymbolIndex = {
    symbols,
    byName: new Map([
      ["storageTank", [1 as SymbolId]],
      ["inletValve", [2 as SymbolId]],
    ]),
    childrenOf: new Map(),
  };

  const diagram = buildPolyglotDiagram(index, graphicsConfig, undefined, undefined, "All", options);

  const tankNode = diagram.nodes.find((n) => n.properties?.description === "storageTank");
  assert.ok(tankNode);
  assert.strictEqual(tankNode.attrs?.body?.fill, "url(#grad-cylinder-vertical)");
  // Icon markup and attrs
  assert.ok(Array.isArray(tankNode.markup));
  assert.ok(tankNode.markup.some((m: any) => m.selector === "icon" || m.tagName === "image"));
  assert.ok(tankNode.attrs?.icon?.href?.startsWith("data:image/png;base64"));
  assert.ok(tankNode.properties?.icon?.startsWith("data:image/png;base64"));

  const valveNode = diagram.nodes.find((n) => n.properties?.description === "inletValve");
  assert.ok(valveNode);
  assert.strictEqual(valveNode.attrs?.body?.fill, "url(#grad-sphere)");
});

test("DynamicSelect simulation animation channels extraction", () => {
  const config: DiagramConfig = {
    nodes: {
      Actuator: {
        shape: "rect",
      },
    },
  };

  const { graphicsConfig, options } = compileDiagramConfigToPolyglot(config);

  const symbols = new Map<SymbolId, SymbolEntry>();
  symbols.set(
    1 as SymbolId,
    {
      id: 1 as SymbolId,
      name: "motor1",
      ruleName: "Actuator",
      parentId: null,
      metadata: {
        fillColor: "DynamicSelect({255, 255, 255}, if speed > 100 then {255, 0, 0} else {0, 255, 0})",
      },
    } as unknown as SymbolEntry,
  );

  const index: SymbolIndex = {
    symbols,
    byName: new Map([["motor1", [1 as SymbolId]]]),
    childrenOf: new Map(),
  };

  const diagram = buildPolyglotDiagram(index, graphicsConfig, undefined, undefined, "All", options);

  const motorNode = diagram.nodes[0];
  assert.ok(motorNode.animations !== undefined);
  assert.strictEqual(motorNode.animations.length, 1);
  assert.strictEqual(motorNode.animations[0].property, "fillColor");
  assert.ok(motorNode.animations[0].variableName.includes("speed"));
});

test("Ignores empty icon objects and strips orphaned image markup", () => {
  const graphicsConfig = {
    Block: {
      role: "node" as const,
      node: {
        shape: "rect",
        markup: [
          { tagName: "rect", selector: "body" },
          { tagName: "image", selector: "icon" },
        ],
        attrs: {
          body: { fill: "#ffffff" },
          icon: {}, // Empty icon attribute object
        },
      },
    },
  };

  const symbols = new Map<SymbolId, SymbolEntry>();
  symbols.set(
    1 as SymbolId,
    {
      id: 1 as SymbolId,
      name: "engine",
      ruleName: "Block",
      parentId: null,
    } as SymbolEntry,
  );

  const index: SymbolIndex = {
    symbols,
    byName: new Map([["engine", [1 as SymbolId]]]),
    childrenOf: new Map(),
  };

  const diagram = buildPolyglotDiagram(index, graphicsConfig as any);
  assert.strictEqual(diagram.nodes.length, 1);
  const node = diagram.nodes[0];
  // Must NOT contain image/icon markup
  assert.ok(Array.isArray(node.markup));
  assert.ok(!node.markup.some((m: any) => m.selector === "icon" || m.tagName === "image"));
  // Must NOT have icon in attrs, properties, or data
  assert.strictEqual(node.attrs?.icon, undefined);
  assert.strictEqual(node.properties?.icon, undefined);
  assert.strictEqual(node.data?.icon, undefined);
});

test("Port label positioning and causality direction", () => {
  const graphicsConfig = {
    PartDefinition: {
      role: "node" as const,
      node: {
        shape: "rect",
        attrs: {
          body: { fill: "#ffffff", stroke: "#333333" },
        },
        size: { width: 180, height: 60 },
        ports: {
          groups: {
            in: { position: "left", attrs: { circle: { r: 5 } } },
            out: { position: "right", attrs: { circle: { r: 5 } } },
          },
        },
      },
    },
    PortUsage: {
      role: "port" as const,
      node: {
        shape: "circle",
        attrs: { circle: { r: 6 } },
      },
    },
  };

  const symbols = new Map<SymbolId, SymbolEntry>();
  symbols.set(
    1 as SymbolId,
    { id: 1 as SymbolId, name: "Engine", ruleName: "PartDefinition", parentId: null } as SymbolEntry,
  );
  symbols.set(
    2 as SymbolId,
    { id: 2 as SymbolId, name: "fuelIn", ruleName: "PortUsage", parentId: 1 as SymbolId } as SymbolEntry,
  );
  symbols.set(
    3 as SymbolId,
    { id: 3 as SymbolId, name: "torqueOut", ruleName: "PortUsage", parentId: 1 as SymbolId } as SymbolEntry,
  );

  const index: SymbolIndex = {
    symbols,
    byName: new Map([
      ["Engine", [1 as SymbolId]],
      ["fuelIn", [2 as SymbolId]],
      ["torqueOut", [3 as SymbolId]],
    ]),
    childrenOf: new Map([[1 as SymbolId, [2 as SymbolId, 3 as SymbolId]]]),
  };

  const diagram = buildPolyglotDiagram(index, graphicsConfig as any, undefined, undefined, "All", {
    portKinds: ["PortUsage"],
  });

  assert.strictEqual(diagram.nodes.length, 1);
  const node = diagram.nodes[0];
  assert.ok(node.ports?.items);
  assert.strictEqual(node.ports.items.length, 2);

  // fuelIn should be assigned to "in" (left) with label position "left"
  const inPort = node.ports.items.find((p) => p.id === "fuelIn");
  assert.ok(inPort);
  assert.strictEqual(inPort.group, "in");
  assert.strictEqual((inPort as any).label?.position?.name, "left");

  // torqueOut should be assigned to "out" (right) with label position "right"
  const outPort = node.ports.items.find((p) => p.id === "torqueOut");
  assert.ok(outPort);
  assert.strictEqual(outPort.group, "out");
  assert.strictEqual((outPort as any).label?.position?.name, "right");

  // Ensure port groups also have label positioning configured
  assert.strictEqual(node.ports.groups?.in?.label?.position?.name, "left");
  assert.strictEqual(node.ports.groups?.out?.label?.position?.name, "right");
});

test("Node width dynamically expands to prevent label and field overflow", () => {
  const graphicsConfig = {
    PartUsage: {
      role: "node" as const,
      node: {
        shape: "rect",
        attrs: {
          body: { fill: "#ffffff" },
          label: { text: "{{name}}" },
        },
        size: { width: 140, height: 40 },
      },
    },
    PartDefinition: {
      role: "node" as const,
      node: {
        shape: "rect",
        attrs: {
          body: { fill: "#ffffff" },
        },
        size: { width: 180, height: 60 },
      },
    },
    AttributeUsage: {
      role: "node" as const,
      node: { shape: "rect" },
    },
    OwnedFeatureTyping: {
      role: "edge" as const,
      edge: { shape: "edge" },
    },
  };

  const symbols = new Map<SymbolId, SymbolEntry>();
  // Usage with long typed label: "transmission : Transmission"
  symbols.set(
    1 as SymbolId,
    { id: 1 as SymbolId, name: "transmission", ruleName: "PartUsage", parentId: null } as SymbolEntry,
  );
  symbols.set(
    2 as SymbolId,
    { id: 2 as SymbolId, name: "Transmission", ruleName: "OwnedFeatureTyping", parentId: 1 as SymbolId } as SymbolEntry,
  );

  // Definition with long compartment entries
  symbols.set(
    3 as SymbolId,
    { id: 3 as SymbolId, name: "Transmission", ruleName: "PartDefinition", parentId: null } as SymbolEntry,
  );
  symbols.set(
    4 as SymbolId,
    {
      id: 4 as SymbolId,
      name: "numberOfGears : Integer",
      ruleName: "AttributeUsage",
      parentId: 3 as SymbolId,
    } as SymbolEntry,
  );

  const index: SymbolIndex = {
    symbols,
    byName: new Map([
      ["transmission", [1 as SymbolId]],
      ["Transmission", [2 as SymbolId, 3 as SymbolId]],
      ["numberOfGears : Integer", [4 as SymbolId]],
    ]),
    childrenOf: new Map([
      [1 as SymbolId, [2 as SymbolId]],
      [3 as SymbolId, [4 as SymbolId]],
    ]),
  };

  const diagram = buildPolyglotDiagram(index, graphicsConfig as any, undefined, undefined, "All", {
    structuralKinds: ["PartDefinition", "PartUsage"],
    usageKinds: ["PartUsage"],
    definitionKinds: ["PartDefinition"],
    typingRules: ["OwnedFeatureTyping"],
  });

  const usageNode = diagram.nodes.find((n) => n.id === "n_1");
  assert.ok(usageNode);
  // Label should include typed name: "transmission : Transmission"
  assert.strictEqual((usageNode.attrs?.label as any)?.text, "transmission : Transmission");
  // Width should expand well beyond initial 140 to accommodate 27 chars + padding (e.g. >= 280)
  assert.ok(usageNode.width >= 280, `Expected width >= 280, got ${usageNode.width}`);

  const defNode = diagram.nodes.find((n) => n.id === "n_3");
  assert.ok(defNode);
  // Width should expand to accommodate "numberOfGears : Integer" (23 chars) with generous padding
  assert.ok(defNode.width >= 220, `Expected width >= 220, got ${defNode.width}`);
});

test("SysML v2 Two-tone card architecture, stereotype normalization, and high-contrast typography", () => {
  const graphicsConfig = {
    PartUsage: {
      role: "node" as const,
      node: {
        shape: "rect",
        attrs: {
          body: { fill: "#ecfdf5", stroke: "#059669" },
        },
        size: { width: 140, height: 40 },
      },
    },
    PartDefinition: {
      role: "node" as const,
      node: {
        shape: "rect",
        attrs: {
          body: { fill: "#ecfdf5", stroke: "#059669" },
        },
        size: { width: 180, height: 60 },
      },
    },
    AttributeUsage: {
      role: "node" as const,
      node: { shape: "rect" },
    },
  };

  const symbols = new Map<SymbolId, SymbolEntry>();
  symbols.set(
    1 as SymbolId,
    { id: 1 as SymbolId, name: "engine", ruleName: "PartUsage", parentId: null } as SymbolEntry,
  );
  symbols.set(
    2 as SymbolId,
    { id: 2 as SymbolId, name: "Engine", ruleName: "PartDefinition", parentId: null } as SymbolEntry,
  );
  symbols.set(
    3 as SymbolId,
    {
      id: 3 as SymbolId,
      name: "horsePower : Real",
      ruleName: "AttributeUsage",
      parentId: 2 as SymbolId,
    } as SymbolEntry,
  );
  symbols.set(
    4 as SymbolId,
    {
      id: 4 as SymbolId,
      name: "cylinders : Integer",
      ruleName: "AttributeUsage",
      parentId: 1 as SymbolId,
    } as SymbolEntry,
  );

  const index: SymbolIndex = {
    symbols,
    byName: new Map([
      ["engine", [1 as SymbolId]],
      ["Engine", [2 as SymbolId]],
      ["horsePower : Real", [3 as SymbolId]],
      ["cylinders : Integer", [4 as SymbolId]],
    ]),
    childrenOf: new Map([
      [1 as SymbolId, [4 as SymbolId]],
      [2 as SymbolId, [3 as SymbolId]],
    ]),
  };

  const diagram = buildPolyglotDiagram(index, graphicsConfig as any, undefined, undefined, "All", {
    structuralKinds: ["PartDefinition", "PartUsage"],
    usageKinds: ["PartUsage"],
    definitionKinds: ["PartDefinition"],
  });

  const usageNode = diagram.nodes.find((n) => n.id === "n_1");
  assert.ok(usageNode);
  // Stereotype should be normalized to canonical lowercase «part»
  assert.strictEqual((usageNode.attrs?.stereotype as any)?.text, "«part»");

  const defNode = diagram.nodes.find((n) => n.id === "n_2");
  assert.ok(defNode);
  // Definition stereotype normalized to «part def»
  assert.strictEqual((defNode.attrs?.stereotype as any)?.text, "«part def»");

  // Two-tone card architecture: headerBody exists in markup and attrs
  assert.ok(defNode.markup.some((m: any) => m.selector === "headerBody"));
  assert.strictEqual((defNode.attrs?.headerBody as any)?.fill, "#ecfdf5");
  assert.strictEqual((defNode.attrs?.body as any)?.fill, "#ffffff");

  // High-contrast typography checks
  assert.strictEqual((defNode.attrs?.label as any)?.fill, "#0f172a");
  assert.strictEqual((defNode.attrs?.secHead_0 as any)?.fill, "#475569");
  assert.strictEqual((defNode.attrs?.entry_0_0 as any)?.fill, "#1e293b");
});
