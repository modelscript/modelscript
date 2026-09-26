// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { renderVisualDiffToHtml } from "../src/html-diff-bundle.js";
import type { DiagramData } from "../src/protocol.js";
import { buildVisualDiffGraph } from "../src/visual-diff-graph.js";
import { renderVisualDiffToSvg } from "../src/visual-diff-renderer.js";

describe("Visual PR Diffing Engine (SysML v2, Modelica, Polyglot)", () => {
  const baseDiagram: DiagramData = {
    coordinateSystem: { x: 0, y: 0, width: 800, height: 600 },
    diagramBackground: null,
    nodes: [
      {
        id: "motor_1",
        x: 100,
        y: 150,
        width: 140,
        height: 70,
        angle: 0,
        opacity: 1,
        zIndex: 1,
        markup: { tagName: "rect" },
        properties: {
          values: { name: "ElectricMotor", typeName: "Motor", maxTorque: 250, direction: "cw" },
        },
        ports: {
          items: [{ id: "p_power", group: "in", args: { x: 0, y: 35, angle: 0 }, markup: { tagName: "circle" } }],
          groups: {},
        },
      },
      {
        id: "hydraulic_backup",
        x: 400,
        y: 150,
        width: 160,
        height: 80,
        angle: 0,
        opacity: 1,
        zIndex: 1,
        markup: { tagName: "rect" },
        properties: {
          values: { name: "HydraulicBackup", typeName: "HydraulicActuator" },
        },
        ports: {
          items: [],
          groups: {},
        },
      },
      {
        id: "power_bus",
        x: 100,
        y: 350,
        width: 200,
        height: 50,
        angle: 0,
        opacity: 1,
        zIndex: 1,
        markup: { tagName: "rect" },
        properties: {
          values: { name: "PowerBus", typeName: "ElectricalBus" },
        },
        ports: {
          items: [{ id: "p_out", group: "out", args: { x: 100, y: 0, angle: 0 }, markup: { tagName: "circle" } }],
          groups: {},
        },
      },
    ],
    edges: [
      {
        id: "e_power",
        source: { cell: "power_bus", port: "p_out", anchor: "center", connectionPoint: { name: "center" } },
        target: { cell: "motor_1", port: "p_power", anchor: "center", connectionPoint: { name: "center" } },
        zIndex: 1,
        attrs: {
          line: { stroke: "#38bdf8", strokeWidth: 2, "vector-effect": "non-scaling-stroke", "pointer-events": "all" },
        },
      },
      {
        id: "e_backup",
        source: { cell: "power_bus", port: "p_out", anchor: "center", connectionPoint: { name: "center" } },
        target: { cell: "hydraulic_backup", port: "", anchor: "center", connectionPoint: { name: "center" } },
        zIndex: 1,
        attrs: {
          line: { stroke: "#38bdf8", strokeWidth: 2, "vector-effect": "non-scaling-stroke", "pointer-events": "all" },
        },
      },
    ],
  };

  const headDiagram: DiagramData = {
    coordinateSystem: { x: 0, y: 0, width: 800, height: 600 },
    diagramBackground: null,
    nodes: [
      // motor_1 is MODIFIED (maxTorque changed safe, direction inverted BREAKING)
      {
        id: "motor_1",
        x: 100,
        y: 150,
        width: 140,
        height: 70,
        angle: 0,
        opacity: 1,
        zIndex: 1,
        markup: { tagName: "rect" },
        properties: {
          values: { name: "ElectricMotor", typeName: "Motor", maxTorque: 320, direction: "ccw" },
        },
        ports: {
          items: [{ id: "p_power", group: "in", args: { x: 0, y: 35, angle: 0 }, markup: { tagName: "circle" } }],
          groups: {},
        },
      },
      // hydraulic_backup was DELETED (absent here)
      // power_bus is UNCHANGED
      {
        id: "power_bus",
        x: 100,
        y: 350,
        width: 200,
        height: 50,
        angle: 0,
        opacity: 1,
        zIndex: 1,
        markup: { tagName: "rect" },
        properties: {
          values: { name: "PowerBus", typeName: "ElectricalBus" },
        },
        ports: {
          items: [{ id: "p_out", group: "out", args: { x: 100, y: 0, angle: 0 }, markup: { tagName: "circle" } }],
          groups: {},
        },
      },
      // battery_pack is ADDED
      {
        id: "battery_pack",
        x: 450,
        y: 350,
        width: 150,
        height: 60,
        angle: 0,
        opacity: 1,
        zIndex: 1,
        markup: { tagName: "rect" },
        properties: {
          values: { name: "BatteryPack", typeName: "Battery", capacityKWh: 75 },
        },
        ports: {
          items: [{ id: "p_bat", group: "out", args: { x: 0, y: 30, angle: 0 }, markup: { tagName: "circle" } }],
          groups: {},
        },
      },
    ],
    edges: [
      // e_power is UNCHANGED
      {
        id: "e_power",
        source: { cell: "power_bus", port: "p_out", anchor: "center", connectionPoint: { name: "center" } },
        target: { cell: "motor_1", port: "p_power", anchor: "center", connectionPoint: { name: "center" } },
        zIndex: 1,
        attrs: {
          line: { stroke: "#38bdf8", strokeWidth: 2, "vector-effect": "non-scaling-stroke", "pointer-events": "all" },
        },
      },
      // e_bat is ADDED
      {
        id: "e_bat",
        source: { cell: "battery_pack", port: "p_bat", anchor: "center", connectionPoint: { name: "center" } },
        target: { cell: "power_bus", port: "p_out", anchor: "center", connectionPoint: { name: "center" } },
        zIndex: 1,
        attrs: {
          line: { stroke: "#22c55e", strokeWidth: 2, "vector-effect": "non-scaling-stroke", "pointer-events": "all" },
        },
      },
    ],
  };

  it("1. builds accurate VisualDiffGraph model with added, deleted, and modified states", () => {
    const diff = buildVisualDiffGraph(baseDiagram, headDiagram);

    assert.strictEqual(diff.stats.addedNodes, 1, "Should have 1 added node (BatteryPack)");
    assert.strictEqual(diff.stats.deletedNodes, 1, "Should have 1 deleted node (HydraulicBackup)");
    assert.strictEqual(diff.stats.modifiedNodes, 1, "Should have 1 modified node (ElectricMotor)");
    assert.strictEqual(diff.stats.unchangedNodes, 1, "Should have 1 unchanged node (PowerBus)");

    assert.strictEqual(diff.stats.addedEdges, 1, "Should have 1 added edge (e_bat)");
    assert.strictEqual(diff.stats.deletedEdges, 1, "Should have 1 deleted edge (e_backup)");
    assert.strictEqual(diff.stats.unchangedEdges, 1, "Should have 1 unchanged edge (e_power)");

    // Breaking changes: Direction inversion + node deletion + edge deletion
    assert.ok(diff.stats.breakingChanges >= 2, "Should identify breaking changes");

    // Check specific node statuses
    const motor = diff.nodes.find((n) => n.id === "motor_1");
    assert.strictEqual(motor?.diffStatus, "modified");
    assert.strictEqual(motor?.isBreaking, true);
    assert.ok(motor?.propertyChanges?.some((c) => c.key === "direction" && c.isBreaking));

    const backup = diff.nodes.find((n) => n.id === "hydraulic_backup");
    assert.strictEqual(backup?.diffStatus, "deleted");
    assert.strictEqual(backup?.isBreaking, true);

    const bat = diff.nodes.find((n) => n.id === "battery_pack");
    assert.strictEqual(bat?.diffStatus, "added");
  });

  it("2. stabilizes layout coordinates so unchanged and deleted nodes retain base anchors", () => {
    const diff = buildVisualDiffGraph(baseDiagram, headDiagram);

    const motor = diff.nodes.find((n) => n.id === "motor_1")!;
    assert.strictEqual(motor.x, 100);
    assert.strictEqual(motor.y, 150);

    const backup = diff.nodes.find((n) => n.id === "hydraulic_backup")!;
    assert.strictEqual(backup.x, 400);
    assert.strictEqual(backup.y, 150);

    const bus = diff.nodes.find((n) => n.id === "power_bus")!;
    assert.strictEqual(bus.x, 100);
    assert.strictEqual(bus.y, 350);
  });

  it("3. renders headless SVG with color-coded diff markers and stats banner", () => {
    const diff = buildVisualDiffGraph(baseDiagram, headDiagram);
    const svg = renderVisualDiffToSvg(diff, { title: "Aircraft Actuator System PR Diff" });

    assert.ok(svg.startsWith("<?xml"), "Should start with XML declaration");
    assert.ok(svg.includes("<svg"), "Should contain svg root tag");
    assert.ok(svg.includes("diff-stats-banner"), "Should contain stats banner");
    assert.ok(svg.includes("+1 Added"), "Should display +1 Added in banner");
    assert.ok(svg.includes("−1 Deleted"), "Should display −1 Deleted in banner");
    assert.ok(svg.includes("~1 Modified"), "Should display ~1 Modified in banner");
    assert.ok(svg.includes("marker-added"), "Should contain added edge marker");
    assert.ok(svg.includes("marker-deleted"), "Should contain deleted edge marker");
    assert.ok(svg.includes("BREAKING"), "Should contain BREAKING pill tag");
  });

  it("4. serializes zero-dependency standalone HTML bundle with interactive controls", () => {
    const diff = buildVisualDiffGraph(baseDiagram, headDiagram);
    const html = renderVisualDiffToHtml(diff, {
      title: "PR #42: Actuator Subsystem Refactor",
      baseRef: "origin/main",
      headRef: "feature/battery-actuator",
    });

    assert.ok(html.includes("<!DOCTYPE html>"), "Should contain HTML5 doctype");
    assert.ok(html.includes("Unified Overlay"), "Should contain Unified view switch button");
    assert.ok(html.includes("Side-by-Side"), "Should contain Side-by-Side view switch button");
    assert.ok(html.includes("property-drawer"), "Should contain property inspector drawer");
    assert.ok(html.includes("maxTorque"), "Should embed property diff data for drawer");
    assert.ok(html.includes("copyMarkdownSummary"), "Should contain markdown summary copy handler");
  });
});
