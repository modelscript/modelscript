// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  diffEpanetNetworks,
  diffSwmmNetworks,
  renderEpanetDiffSvg,
  type EpanetModelLike,
  type SwmmModelLike,
} from "../src/water-network-diff.js";

describe("Semantic Hydraulic Network Diff Engine", () => {
  describe("1. EPANET Network Diffing", () => {
    const baseModel: EpanetModelLike = {
      title: "Base Municipal Water System",
      junctions: [
        { id: "J1", elevation: 10.0, demand: 50.0, pressure: 45.0, head: 55.0, x: 100, y: 200 },
        { id: "J2", elevation: 12.0, demand: 40.0, pressure: 42.0, head: 54.0, x: 300, y: 200 },
        { id: "J_OBSOLETE", elevation: 15.0, demand: 10.0, x: 200, y: 350 },
      ],
      reservoirs: [{ id: "R1", totalHead: 70.0, x: 50, y: 200 }],
      tanks: [],
      pipes: [
        { id: "P1", node1: "R1", node2: "J1", length: 1000, diameter: 300, roughness: 100, velocity: 1.2 },
        { id: "P2", node1: "J1", node2: "J2", length: 500, diameter: 200, roughness: 100, velocity: 1.5 },
        { id: "P_OLD", node1: "J1", node2: "J_OBSOLETE", length: 300, diameter: 100, roughness: 80 },
      ],
      pumps: [],
      valves: [],
    };

    const targetModel: EpanetModelLike = {
      title: "Capital Improvement Plan 2026",
      junctions: [
        { id: "J1", elevation: 10.0, demand: 50.0, pressure: 48.0, head: 58.0, x: 100, y: 200 },
        { id: "J2", elevation: 12.0, demand: 40.0, pressure: 46.0, head: 58.0, x: 300, y: 200 }, // pressure improved
        { id: "J3_NEW", elevation: 14.0, demand: 30.0, pressure: 40.0, head: 54.0, x: 500, y: 200 }, // added
      ],
      reservoirs: [{ id: "R1", totalHead: 70.0, x: 50, y: 200 }],
      tanks: [],
      pipes: [
        { id: "P1", node1: "R1", node2: "J1", length: 1000, diameter: 400, roughness: 120, velocity: 0.9 }, // upsized 300->400mm
        { id: "P2", node1: "J1", node2: "J2", length: 500, diameter: 250, roughness: 120, velocity: 1.1 }, // upsized 200->250mm
        { id: "P3_NEW", node1: "J2", node2: "J3_NEW", length: 600, diameter: 200, roughness: 120, velocity: 1.0 }, // added
      ],
      pumps: [],
      valves: [],
    };

    it("identifies added, deleted, and modified nodes and pipes accurately", () => {
      const diff = diffEpanetNetworks(baseModel, targetModel);

      // Node stats
      assert.strictEqual(diff.stats.addedNodes, 1, "J3_NEW must be added");
      assert.strictEqual(diff.stats.deletedNodes, 1, "J_OBSOLETE must be deleted");
      assert.strictEqual(diff.nodes.get("J3_NEW")?.status, "added");
      assert.strictEqual(diff.nodes.get("J_OBSOLETE")?.status, "deleted");

      // Pipe stats
      assert.strictEqual(diff.stats.addedLinks, 1, "P3_NEW must be added");
      assert.strictEqual(diff.stats.deletedLinks, 1, "P_OLD must be deleted");
      assert.strictEqual(diff.stats.modifiedLinks, 2, "P1 and P2 must be modified");

      const p1Diff = diff.links.get("P1");
      assert.strictEqual(p1Diff?.status, "modified");
      const diamDelta = p1Diff?.propertyDeltas.find((d) => d.property === "diameter");
      assert.strictEqual(diamDelta?.delta, 100, "Diameter increased by +100mm");

      // Hydraulic impact
      assert.ok(diff.stats.maxPressureDeltaM > 0, "Upsizing mains should produce positive head delta");
    });

    it("renders publication-ready visual diff SVG with Git status colors", () => {
      const diff = diffEpanetNetworks(baseModel, targetModel);
      const svg = renderEpanetDiffSvg(diff, { theme: "dark" });

      assert.ok(svg.includes("<svg"), "Must output valid SVG");
      assert.ok(svg.includes("Visual PR Diff: Water Network"));
      assert.ok(svg.includes("+1 added"), "HUD stats must reflect additions");
      assert.ok(svg.includes("-1 deleted"), "HUD stats must reflect deletions");
      assert.ok(svg.includes("+100mm"), "Modified pipe diameter delta badge must be rendered");
    });
  });

  describe("2. SWMM Drainage Network Diffing", () => {
    const baseSwmm: SwmmModelLike = {
      title: "Existing Stormwater Baseline",
      junctions: [
        { id: "J1", elevation: 100.0, maxDepth: 4.0 },
        { id: "J2", elevation: 95.0, maxDepth: 4.0 },
      ],
      outfalls: [{ id: "OF1", elevation: 90.0 }],
      conduits: [
        { id: "C1", fromNode: "J1", toNode: "J2", length: 300, diameter: 1.0 },
        { id: "C2", fromNode: "J2", toNode: "OF1", length: 200, diameter: 1.0 },
      ],
      storageUnits: [],
    };

    const targetSwmm: SwmmModelLike = {
      title: "Proposed Detention & Relief Conduit",
      junctions: [
        { id: "J1", elevation: 100.0, maxDepth: 4.0 },
        { id: "J2", elevation: 95.0, maxDepth: 4.0 },
        { id: "J_RELIEF", elevation: 94.0, maxDepth: 5.0 }, // Added
      ],
      outfalls: [{ id: "OF1", elevation: 90.0 }],
      conduits: [
        { id: "C1", fromNode: "J1", toNode: "J2", length: 300, diameter: 1.5 }, // Upsized 1.0 -> 1.5m
        { id: "C2", fromNode: "J2", toNode: "OF1", length: 200, diameter: 1.0 },
        { id: "C_RELIEF", fromNode: "J2", toNode: "J_RELIEF", length: 150, diameter: 1.2 }, // Added
      ],
      storageUnits: [],
    };

    it("identifies added relief conduit and upsized storm main", () => {
      const diff = diffSwmmNetworks(baseSwmm, targetSwmm);
      assert.strictEqual(diff.stats.addedNodes, 1);
      assert.strictEqual(diff.stats.addedLinks, 1);
      assert.strictEqual(diff.stats.modifiedLinks, 1);
      assert.strictEqual(diff.links.get("C1")?.status, "modified");
      assert.strictEqual(diff.links.get("C_RELIEF")?.status, "added");
    });
  });
});
