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
