// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileDiagramConfigToPolyglot, type DiagramConfig } from "../src/dsl/language.js";

describe("compileDiagramConfigToPolyglot Compiler", () => {
  it("should compile node, edge, and port configurations into Polyglot GraphicsConfig", () => {
    const config: DiagramConfig = {
      nodes: {
        Block: {
          shape: "rect",
          label: "Block",
          style: {
            fill: "#1e293b",
            stroke: "#38bdf8",
            strokeWidth: 2,
          },
          ports: {
            items: [
              { id: "p_in", side: "left", offset: 0.5, label: "in" },
              { id: "p_out", side: "right", offset: 0.5, label: "out" },
              { id: "p_internal", x: 20, y: 30 },
            ],
          },
        },
      },
      edges: {
        Connection: {
          style: {
            stroke: "#38bdf8",
            strokeWidth: 2,
          },
        },
      },
      projections: {
        InternalView: {
          label: "Internal Structure",
          includeRules: ["Block", "Connection"],
        },
      },
      palette: {
        categories: [
          {
            name: "Blocks",
            items: [{ label: "Block", className: "Block" }],
          },
        ],
      },
    };

    const { graphicsConfig, options } = compileDiagramConfigToPolyglot(config);

    assert.ok(graphicsConfig);
    assert.ok(graphicsConfig["Block"]);
    assert.strictEqual(graphicsConfig["Block"].role, "node");
    assert.strictEqual(graphicsConfig["Block"].node?.shape, "rect");

    // Check ports compilation
    const ports = graphicsConfig["Block"].ports;
    assert.ok(ports);
    assert.ok(ports.items);
    assert.strictEqual(ports.items.length, 3);
    assert.strictEqual(ports.items[0].id, "p_in");
    assert.strictEqual(ports.items[0].group, "left");
    assert.strictEqual(ports.items[1].id, "p_out");
    assert.strictEqual(ports.items[1].group, "right");
    assert.strictEqual(ports.items[2].id, "p_internal");

    // Check edge compilation
    assert.ok(graphicsConfig["Connection"]);
    assert.strictEqual(graphicsConfig["Connection"].role, "edge");

    // Check projections in options
    assert.ok(options.customProjections);
    assert.ok(options.customProjections["InternalView"]);
    assert.strictEqual(options.customProjections["InternalView"].label, "Internal Structure");
  });

  it("should forward declarative property inspector configuration to options", () => {
    const config: DiagramConfig = {
      properties: {
        entities: {
          Block: {
            title: "{{name}} : Block",
            tabs: [
              {
                id: "general",
                label: "General",
                groups: [
                  {
                    id: "params",
                    label: "Parameters",
                    fields: [
                      { key: "gain", label: "Gain", kind: "number", defaultValue: 1.0 },
                      { key: "enabled", label: "Enabled", kind: "boolean", defaultValue: true },
                      {
                        key: "filterType",
                        label: "Filter Type",
                        kind: "choice",
                        choices: ["LowPass", "HighPass", "BandPass"],
                        defaultValue: "LowPass",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const { options } = compileDiagramConfigToPolyglot(config);
    assert.ok(options.properties);
    assert.ok(options.properties.entities);
    assert.ok(options.properties.entities["Block"]);
    assert.strictEqual(options.properties.entities["Block"].title, "{{name}} : Block");

    const tabs = options.properties.entities["Block"].tabs;
    assert.strictEqual(tabs.length, 1);
    assert.strictEqual(tabs[0].id, "general");
    assert.strictEqual(tabs[0].groups[0].fields.length, 3);
    assert.strictEqual(tabs[0].groups[0].fields[0].key, "gain");
    assert.strictEqual(tabs[0].groups[0].fields[0].kind, "number");
    assert.strictEqual(tabs[0].groups[0].fields[1].kind, "boolean");
    assert.strictEqual(tabs[0].groups[0].fields[2].kind, "choice");
  });

  it("should handle empty or undefined diagram configuration gracefully", () => {
    const res1 = compileDiagramConfigToPolyglot(undefined);
    assert.ok(res1);
    assert.deepStrictEqual(res1.graphicsConfig, {});
    assert.deepStrictEqual(res1.options, {});

    const res2 = compileDiagramConfigToPolyglot({});
    assert.ok(res2);
    assert.deepStrictEqual(res2.graphicsConfig, {});
    assert.deepStrictEqual(res2.options, {});
  });
});
