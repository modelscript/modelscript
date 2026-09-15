// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { compileDiagramConfigToPolyglot, type DiagramConfig } from "../src/dsl/language.js";

describe("DSL Diagram Compiler (Phase 4 Extensions)", () => {
  it("compiles generic multi-compartments into GraphicsConfig", () => {
    const config: DiagramConfig = {
      nodes: {
        ClassDef: {
          shape: "rect",
          compartments: [
            { header: "attributes", query: "AttributeDef" },
            { header: "operations", query: "OperationDef" },
          ],
        },
      },
    };

    const { graphicsConfig } = compileDiagramConfigToPolyglot(config);
    const classGfx = graphicsConfig["ClassDef"];
    assert.ok(classGfx, "Must generate graphicsConfig for ClassDef");
    assert.ok(classGfx.compartments, "Must include compartments in graphicsConfig");
    assert.strictEqual(classGfx.compartments?.length, 2);
    assert.strictEqual(classGfx.compartments?.[0].header, "attributes");
    assert.strictEqual(classGfx.compartments?.[0].query, "AttributeDef");
    assert.strictEqual(classGfx.compartments?.[1].header, "operations");
  });

  it("compiles sourceArrow and targetArrow markers into X6 markers", () => {
    const config: DiagramConfig = {
      edges: {
        Inheritance: {
          style: {
            stroke: "#38bdf8",
            targetArrow: "hollow-triangle",
          },
        },
        Composition: {
          style: {
            stroke: "#f43f5e",
            sourceArrow: "diamond",
            targetArrow: "classic",
          },
        },
      },
    };

    const { graphicsConfig } = compileDiagramConfigToPolyglot(config);
    const inheritEdge = graphicsConfig["Inheritance"]?.edge;
    assert.ok(inheritEdge?.attrs?.line?.targetMarker, "Must compile targetMarker");
    assert.strictEqual((inheritEdge?.attrs?.line?.targetMarker as any)?.fill, "#ffffff");

    const compEdge = graphicsConfig["Composition"]?.edge;
    assert.ok(compEdge?.attrs?.line?.sourceMarker, "Must compile sourceMarker");
    assert.ok(compEdge?.attrs?.line?.targetMarker, "Must compile classic targetMarker");
  });

  it("passes placement persistence options into compiler output", () => {
    const config: DiagramConfig = {
      placement: {
        persistence: "inline",
        formatPlacement: (x, y) => `@layout(${x}, ${y})`,
      },
    };

    const { options } = compileDiagramConfigToPolyglot(config);
    assert.strictEqual(options.placement?.persistence, "inline");
    assert.ok(typeof options.placement?.formatPlacement === "function");
  });
});
