// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPolyglotDiagram, formatMathExpression } from "../src/polyglot-diagram-builder.js";
import { renderPolyglotDiagramToSvg } from "../src/svg-renderer.js";

describe("SysML v2 Advanced Vector Glyphs & Diagram Enhancements", () => {
  it("formats mathematical expressions with typographic symbols", () => {
    assert.strictEqual(formatMathExpression("der(v) == -g - (k/m)*v"), "d/dt(v) = -g - (k/m) · v");
    assert.strictEqual(formatMathExpression("x^2 + y^2 <= radius^2"), "x² + y² ≤ radius²");
    assert.strictEqual(formatMathExpression("omega >= 0 and tau != 0"), "ω ≥ 0 and τ ≠ 0");
  });

  it("builds OMG-standard vector glyphs for decision, merge, fork, join, accept, send, and use cases", () => {
    const gfxConfig: any = {
      DecisionNode: {
        role: "node",
        node: {
          shape: "polygon",
          markup: [
            { tagName: "polygon", selector: "body" },
            { tagName: "text", selector: "label" },
          ],
          attrs: {
            body: { points: "20,0 40,20 20,40 0,20", fill: "#f0f9ff", stroke: "#0284c7" },
            label: { text: "{{name}}" },
          },
          size: { width: 40, height: 40 },
        },
      },
      ForkNode: {
        role: "node",
        node: {
          shape: "rect",
          markup: [{ tagName: "rect", selector: "body" }],
          attrs: {
            body: { fill: "#1e293b", stroke: "#0f172a" },
          },
          size: { width: 60, height: 6 },
        },
      },
      AcceptActionNode: {
        role: "node",
        node: {
          shape: "polygon",
          markup: [
            { tagName: "polygon", selector: "body" },
            { tagName: "text", selector: "label" },
          ],
          attrs: {
            body: { points: "0,0 120,0 120,40 0,40 16,20" },
            label: { text: "{{name}}" },
          },
          size: { width: 120, height: 40 },
        },
      },
      UseCaseUsage: {
        role: "node",
        node: {
          shape: "ellipse",
          markup: [
            { tagName: "ellipse", selector: "body" },
            { tagName: "text", selector: "label" },
          ],
          attrs: {
            body: { cx: 70, cy: 25, rx: 70, ry: 25 },
            label: { text: "{{name}}" },
          },
          size: { width: 140, height: 50 },
        },
      },
      ActorUsage: {
        role: "node",
        node: {
          shape: "rect",
          markup: [
            { tagName: "circle", selector: "actorHead" },
            { tagName: "line", selector: "actorSpine" },
          ],
          attrs: {},
          size: { width: 50, height: 85 },
        },
      },
    };

    const symbols = new Map<SymbolId, SymbolEntry>();
    symbols.set(
      1 as SymbolId,
      { id: 1 as SymbolId, name: "decide1", ruleName: "DecisionNode", parentId: null } as SymbolEntry,
    );
    symbols.set(
      2 as SymbolId,
      { id: 2 as SymbolId, name: "fork1", ruleName: "ForkNode", parentId: null } as SymbolEntry,
    );
    symbols.set(
      3 as SymbolId,
      { id: 3 as SymbolId, name: "receiveCmd", ruleName: "AcceptActionNode", parentId: null } as SymbolEntry,
    );
    symbols.set(
      4 as SymbolId,
      { id: 4 as SymbolId, name: "driveVehicle", ruleName: "UseCaseUsage", parentId: null } as SymbolEntry,
    );
    symbols.set(
      5 as SymbolId,
      { id: 5 as SymbolId, name: "Driver", ruleName: "ActorUsage", parentId: null } as SymbolEntry,
    );

    const index: SymbolIndex = {
      symbols,
      byName: new Map([
        ["decide1", [1 as SymbolId]],
        ["fork1", [2 as SymbolId]],
        ["receiveCmd", [3 as SymbolId]],
        ["driveVehicle", [4 as SymbolId]],
        ["Driver", [5 as SymbolId]],
      ]),
      childrenOf: new Map(),
    };

    const diagram = buildPolyglotDiagram(index, gfxConfig, undefined, undefined, "All");
    assert.strictEqual(diagram.nodes.length, 5);

    const decideNode = diagram.nodes.find((n) => n.id === "n_1");
    assert.ok(decideNode);
    assert.strictEqual(decideNode.shape, "polygon");
    assert.strictEqual((decideNode.attrs?.body as any)?.points, "20,0 40,20 20,40 0,20");

    const forkNode = diagram.nodes.find((n) => n.id === "n_2");
    assert.ok(forkNode);
    assert.ok(forkNode.width >= 60);
    assert.strictEqual(forkNode.height, 6);

    const acceptNode = diagram.nodes.find((n) => n.id === "n_3");
    assert.ok(acceptNode);
    assert.ok((acceptNode.attrs?.body as any)?.points?.includes("16,20"));

    const useCaseNode = diagram.nodes.find((n) => n.id === "n_4");
    assert.ok(useCaseNode);
    assert.strictEqual(useCaseNode.shape, "ellipse");

    const actorNode = diagram.nodes.find((n) => n.id === "n_5");
    assert.ok(actorNode);
    assert.ok(actorNode.markup.some((m: any) => m.selector === "stickFigure" || m.selector === "actorHead"));
  });

  it("renders Requirement ID badge and parallel state divider lines", () => {
    const gfxConfig: any = {
      RequirementDefinition: {
        role: "node",
        node: {
          shape: "rect",
          attrs: { body: { fill: "#f5f3ff", stroke: "#7c3aed" } },
          size: { width: 180, height: 60 },
        },
      },
      StateDefinition: {
        role: "node",
        node: {
          shape: "rect",
          attrs: { body: { fill: "#fffbeb", stroke: "#d97706" } },
          size: { width: 180, height: 60 },
        },
      },
      AttributeUsage: {
        role: "node",
        node: { shape: "rect" },
      },
    };

    const symbols = new Map<SymbolId, SymbolEntry>();
    // Requirement with shortName (ID)
    symbols.set(
      1 as SymbolId,
      {
        id: 1 as SymbolId,
        name: "MassLimit",
        ruleName: "RequirementDefinition",
        parentId: null,
        attributes: { shortName: "REQ-01" },
      } as any,
    );
    symbols.set(
      2 as SymbolId,
      {
        id: 2 as SymbolId,
        name: "maxMass : Real = 1500.0",
        ruleName: "AttributeUsage",
        parentId: 1 as SymbolId,
      } as SymbolEntry,
    );

    // Parallel State with isParallel
    symbols.set(
      3 as SymbolId,
      {
        id: 3 as SymbolId,
        name: "Operational",
        ruleName: "StateDefinition",
        parentId: null,
        attributes: { isParallel: true },
      } as any,
    );
    symbols.set(
      4 as SymbolId,
      {
        id: 4 as SymbolId,
        name: "entry checkSensors",
        ruleName: "AttributeUsage",
        parentId: 3 as SymbolId,
      } as SymbolEntry,
    );

    const index: SymbolIndex = {
      symbols,
      byName: new Map([
        ["MassLimit", [1 as SymbolId]],
        ["maxMass : Real = 1500.0", [2 as SymbolId]],
        ["Operational", [3 as SymbolId]],
        ["entry checkSensors", [4 as SymbolId]],
      ]),
      childrenOf: new Map([
        [1 as SymbolId, [2 as SymbolId]],
        [3 as SymbolId, [4 as SymbolId]],
      ]),
    };

    const diagram = buildPolyglotDiagram(index, gfxConfig, undefined, undefined, "All", {
      structuralKinds: ["RequirementDefinition", "StateDefinition"],
      definitionKinds: ["RequirementDefinition", "StateDefinition"],
    });

    const reqNode = diagram.nodes.find((n) => n.id === "n_1");
    assert.ok(reqNode);
    // ID badge exists in markup and text
    assert.ok(reqNode.markup.some((m: any) => m.selector === "idBadgeRect"));
    assert.strictEqual((reqNode.attrs?.idBadgeText as any)?.text, "REQ-01");

    const stateNode = diagram.nodes.find((n) => n.id === "n_3");
    assert.ok(stateNode);
    // Parallel region dashed divider exists
    assert.ok(stateNode.markup.some((m: any) => m.selector === "parallelRegionDivider"));
    assert.strictEqual((stateNode.attrs?.parallelRegionDivider as any)?.strokeDasharray, "4 3");
    // State action entry formatted with '/'
    assert.strictEqual((stateNode.attrs?.entry_0_0 as any)?.text, "entry / checkSensors");
  });

  it("renders Blueprint theme and directional port arrows in SVG export", () => {
    const testDiagram: any = {
      nodes: [
        {
          id: "sys",
          x: 10,
          y: 10,
          width: 200,
          height: 100,
          attrs: { body: { fill: "#ffffff", stroke: "#0284c7" } },
          ports: {
            items: [
              { id: "inPort", group: "in", direction: "in", args: { x: 0, y: 50 } },
              { id: "outPort", group: "out", direction: "out", isConjugated: true, args: { x: 200, y: 50 } },
            ],
          },
        },
      ],
      edges: [],
    };

    const svgBlueprint = renderPolyglotDiagramToSvg(testDiagram, { theme: "blueprint" });
    assert.ok(svgBlueprint.includes('style="background-color: #1e3a8a;"'), "Must render blueprint background");
    assert.ok(svgBlueprint.includes("<path d="), "Must render port directional arrows");
  });
});
