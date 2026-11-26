// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoLayoutDiagram } from "../src/auto-layout.js";
import { runLayeredLayoutInWorker } from "../src/layout-worker.js";
import {
  createBulkPropertyEditActions,
  mergeMultiSelectPropertyData,
  MIXED_PROPERTY_VALUE,
} from "../src/properties/state.js";
import { collapseParallelBusEdges, computeVirtualNetLabels } from "../src/solder-dots.js";
import { applyLiveValueBadges } from "../src/telemetry.js";
import { performViewportCulling, resolveDiagramLodTier, SpatialGridIndex } from "../src/viewport-culling.js";

describe("Phase 3 SOTA Diagram Upgrades", () => {
  it("SpatialGridIndex returns only items intersecting the query frustum", () => {
    const grid = new SpatialGridIndex<string>(256);
    grid.insert("n1", { minX: 10, minY: 10, maxX: 90, maxY: 60 });
    grid.insert("n2", { minX: 1200, minY: 900, maxX: 1300, maxY: 960 });
    grid.insert("n3", { minX: 200, minY: 200, maxX: 300, maxY: 280 });

    const hits = grid.query({ minX: 0, minY: 0, maxX: 350, maxY: 350 });
    assert.equal(hits.has("n1"), true);
    assert.equal(hits.has("n3"), true);
    assert.equal(hits.has("n2"), false);
  });

  it("resolveDiagramLodTier maps zoom levels to full/medium/low tiers", () => {
    assert.equal(resolveDiagramLodTier(1.0), "full");
    assert.equal(resolveDiagramLodTier(0.65), "full");
    assert.equal(resolveDiagramLodTier(0.5), "medium");
    assert.equal(resolveDiagramLodTier(0.25), "medium");
    assert.equal(resolveDiagramLodTier(0.15), "low");
  });

  it("performViewportCulling sets data-diagram-lod and culls off-screen nodes + edges", () => {
    const prevDocument = (globalThis as Record<string, unknown>)["document"];
    (globalThis as Record<string, unknown>)["document"] = { querySelector: () => null };
    try {
      const attrs = new Map<string, string>();
      const container = {
        clientWidth: 400,
        clientHeight: 300,
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => {
          attrs.set(k, v);
        },
      };

      const nodes = Array.from({ length: 260 }, (_, i) => ({
        id: `n_${i}`,
        style: { visibility: "" },
        getPosition: () => ({ x: i < 5 ? i * 50 : 5000 + i * 20, y: i < 5 ? 50 : 5000 }),
        getSize: () => ({ width: 40, height: 30 }),
      }));
      const edges = [
        {
          id: "e_vis",
          style: { visibility: "" },
          getSourcePoint: () => ({ x: 20, y: 50 }),
          getTargetPoint: () => ({ x: 120, y: 50 }),
          getVertices: () => [],
        },
        {
          id: "e_off",
          style: { visibility: "" },
          getSourcePoint: () => ({ x: 6000, y: 6000 }),
          getTargetPoint: () => ({ x: 6200, y: 6000 }),
          getVertices: () => [],
        },
      ];

      performViewportCulling({
        container: container as unknown as HTMLElement,
        getNodes: () => nodes,
        getEdges: () => edges,
        scale: () => ({ sx: 0.15, sy: 0.15 }),
        translate: () => ({ tx: 0, ty: 0 }),
        findViewByCell: (cell) => ({ container: cell }),
      });

      assert.equal(attrs.get("data-diagram-lod"), "low");
      assert.equal(nodes[0]!.style.visibility, "");
      assert.equal(nodes[250]!.style.visibility, "hidden");
      assert.equal(edges[0]!.style.visibility, "");
      assert.equal(edges[1]!.style.visibility, "hidden");
    } finally {
      (globalThis as Record<string, unknown>)["document"] = prevDocument;
    }
  });

  it("runLayeredLayoutInWorker falls back cleanly in Node without Worker global", async () => {
    const res = await runLayeredLayoutInWorker(
      {
        nodes: [
          { id: "a", width: 80, height: 40 },
          { id: "b", width: 80, height: 40 },
        ],
        edges: [{ source: "a", target: "b" }],
      },
      { rankdir: "LR" },
      () => ({
        nodes: [
          { id: "a", x: 40, y: 20 },
          { id: "b", x: 200, y: 20 },
        ],
      }),
    );
    assert.equal(res.usedWorker, false);
    assert.equal(res.nodes.length, 2);
    assert.equal(res.nodes[1]!.x, 200);
  });

  it("mergeMultiSelectPropertyData detects shared vs mixed values and generates bulk actions", () => {
    const merged = mergeMultiSelectPropertyData([
      {
        className: "Modelica.Electrical.Analog.Basic.Resistor",
        name: "R1",
        description: "",
        parameters: [
          { name: "R", value: "100", unit: "Ohm" },
          { name: "T_ref", value: "300.15", unit: "K" },
        ],
        values: { R: 100, alpha: 0 },
      },
      {
        className: "Modelica.Electrical.Analog.Basic.Resistor",
        name: "R2",
        description: "",
        parameters: [
          { name: "R", value: "220", unit: "Ohm" },
          { name: "T_ref", value: "300.15", unit: "K" },
        ],
        values: { R: 220, alpha: 0 },
      },
    ]);

    assert.ok(merged);
    assert.deepEqual(merged.componentNames, ["R1", "R2"]);
    const rParam = merged.sharedParameters.find((p) => p.name === "R");
    const tParam = merged.sharedParameters.find((p) => p.name === "T_ref");
    assert.equal(rParam?.isMixed, true);
    assert.equal(rParam?.value, MIXED_PROPERTY_VALUE);
    assert.equal(tParam?.isMixed, false);
    assert.equal(tParam?.value, "300.15");
    assert.equal(merged.sharedValues["R"], MIXED_PROPERTY_VALUE);
    assert.equal(merged.sharedValues["alpha"], 0);

    const actions = createBulkPropertyEditActions(merged.componentNames, "R", "470", "parameter");
    assert.equal(actions.length, 2);
    assert.deepEqual(actions[0], { type: "updateParameter", name: "R1", parameter: "R", value: "470" });
    assert.deepEqual(actions[1], { type: "updateParameter", name: "R2", parameter: "R", value: "470" });
    assert.deepEqual(createBulkPropertyEditActions(merged.componentNames, "R", MIXED_PROPERTY_VALUE), []);
  });

  it("autoLayoutDiagram preserves exact coordinates of pinned/locked nodes", () => {
    const positions = new Map<string, { x: number; y: number }>([
      ["pinnedNode", { x: 420, y: 310 }],
      ["freeNode", { x: 0, y: 0 }],
    ]);
    const nodes = [
      {
        id: "pinnedNode",
        getPosition: () => positions.get("pinnedNode")!,
        getSize: () => ({ width: 80, height: 40 }),
        getData: () => ({ pinned: true }),
        setPosition: (x: number, y: number) => positions.set("pinnedNode", { x, y }),
      },
      {
        id: "freeNode",
        getPosition: () => positions.get("freeNode")!,
        getSize: () => ({ width: 80, height: 40 }),
        getData: () => ({}),
        setPosition: (x: number, y: number) => positions.set("freeNode", { x, y }),
      },
    ];
    const moved: string[] = [];
    autoLayoutDiagram(
      {
        getNodes: () => nodes,
        getEdges: () => [
          {
            getSourceCellId: () => "pinnedNode",
            getTargetCellId: () => "freeNode",
          },
        ],
        getCellById: (id) => nodes.find((n) => n.id === id) ?? null,
        batchUpdate: (_name, fn) => fn(),
      },
      {
        algorithm: "layered",
        optimizePorts: false,
        onAction: (act) => {
          for (const item of act.items) moved.push(item.name);
        },
      },
    );

    assert.deepEqual(positions.get("pinnedNode"), { x: 420, y: 310 });
    assert.equal(moved.includes("pinnedNode"), false);
    assert.equal(moved.includes("freeNode"), true);
  });

  it("applyLiveValueBadges updates node badges, edge labels, and heatmap stroke colors", () => {
    const nodeAttrs = new Map<string, unknown>();
    const edgeLabels: unknown[] = [];
    const edgeAttrs = new Map<string, unknown>();
    const count = applyLiveValueBadges(
      {
        nodes: [{ id: "R1", attr: (p, v) => nodeAttrs.set(p, v) }],
        edges: [
          {
            id: "w1",
            attr: (p, v) => edgeAttrs.set(p, v),
            setLabels: (l) => edgeLabels.push(...l),
          },
        ],
      },
      { R1: 12.345, w1: 0.75 },
      { precision: 1, units: { R1: "V", w1: "A" }, heatmapRange: [0, 20] },
    );
    assert.equal(count, 2);
    assert.equal(nodeAttrs.get("badge/text"), "12.3 V");
    assert.ok(String(nodeAttrs.get("body/stroke")).startsWith("rgb("));
    assert.equal(edgeLabels.length, 1);
    assert.ok(String(edgeAttrs.get("line/stroke")).startsWith("rgb("));
  });

  it("collapseParallelBusEdges bundles >=3 parallel links and computeVirtualNetLabels flags long spans", () => {
    const { bundles, unbundledEdgeIds } = collapseParallelBusEdges(
      [
        { id: "e1", sourceCell: "A", targetCell: "B" },
        { id: "e2", sourceCell: "A", targetCell: "B" },
        { id: "e3", sourceCell: "B", targetCell: "A" },
        { id: "e4", sourceCell: "A", targetCell: "C" },
      ],
      3,
    );
    assert.equal(bundles.length, 1);
    assert.equal(bundles[0]!.width, 3);
    assert.deepEqual(unbundledEdgeIds, ["e4"]);

    const netLabels = computeVirtualNetLabels(
      [
        {
          id: "short",
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
        {
          id: "long_wire",
          points: [
            { x: 0, y: 0 },
            { x: 1200, y: 400 },
          ],
        },
      ],
      900,
    );
    assert.equal(netLabels.length, 1);
    assert.equal(netLabels[0]!.edgeId, "long_wire");
    assert.equal(netLabels[0]!.netName, "NET_1");
  });
});
