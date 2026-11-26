// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildCleanCreaseEdgeGeometry } from "@modelscript/editor/workbench/cad-viewer/HeroCadMaterials.js";
import {
  applyScadOperationOverrides,
  countCadFeatureNodes,
  formatCadPartDisplayName,
} from "@modelscript/editor/workbench/cad-viewer/scad-feature-tree.js";
import { computeCadSafeInsets } from "@modelscript/editor/workbench/cad-viewer/viewport-safe-area.js";
import {
  createInitialRotundaState,
  EngineeringRotunda,
  resolveStageCameraPose,
  rotundaReducer,
  type RotundaActiveView,
} from "@modelscript/editor/workbench/vr-rotunda/index.js";
import { buildScadFeatureTreeFromCst, getScadParser } from "@modelscript/scad";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";

describe("3D CAD Safe-Zone Layout & Unified 1:1 VR Mode", () => {
  test("computeCadSafeInsets returns undefined for non-floating layout", () => {
    const res = computeCadSafeInsets({
      isFloatingLayout: false,
      containerWidth: 1440,
      containerHeight: 900,
      treeVisible: true,
      treeWidth: 260,
      isFullScreenSplitCanvas: false,
      splitDirection: "none",
      splitRatio: 0.6,
      diagnosticsBottomOffset: 160,
    });
    assert.equal(res, undefined);
  });

  test("computeCadSafeInsets reserves exact clearances for sidebar, floating split code editor, and expanded diagnostics", () => {
    const splitCol = computeCadSafeInsets({
      isFloatingLayout: true,
      containerWidth: 1440,
      containerHeight: 900,
      treeVisible: true,
      treeWidth: 260,
      isFullScreenSplitCanvas: true,
      splitDirection: "columns",
      splitRatio: 0.65,
      diagnosticsBottomOffset: 148,
    });
    assert.ok(splitCol);
    assert.equal(splitCol.top, 72);
    assert.equal(splitCol.left, 292); // 260 + 24 + 8
    // (1 - 0.65) * 1440 = 504; + 12 (split margin) + 12 (safe gutter) = 528
    assert.equal(splitCol.right, 528);
    // Expanded diagnostics (148) + 8 = 156
    assert.equal(splitCol.bottom, 156);

    const collapsedSidebar = computeCadSafeInsets({
      isFloatingLayout: true,
      containerWidth: 1440,
      containerHeight: 900,
      treeVisible: false,
      treeWidth: 260,
      isFullScreenSplitCanvas: false,
      splitDirection: "none",
      splitRatio: 0.65,
      diagnosticsBottomOffset: 48,
    });
    assert.ok(collapsedSidebar);
    assert.equal(collapsedSidebar.left, 20);
    assert.equal(collapsedSidebar.right, 12);
    assert.equal(collapsedSidebar.bottom, 56);
  });

  test("computeCadSafeInsets clamps narrow split viewports to keep minimum interactive safe area", () => {
    const narrow = computeCadSafeInsets({
      isFloatingLayout: true,
      containerWidth: 600,
      containerHeight: 500,
      treeVisible: true,
      treeWidth: 260,
      isFullScreenSplitCanvas: true,
      splitDirection: "columns",
      splitRatio: 0.3,
      diagnosticsBottomOffset: 240,
    });
    assert.ok(narrow);
    assert.ok(600 - narrow.left - narrow.right >= 180);
    assert.ok(500 - narrow.top - narrow.bottom >= 160);
  });

  test("rotundaReducer enforces strict 1:1 mutual exclusivity across all 5 views with orthogonal splitCodeOpen", () => {
    let s = createInitialRotundaState({ activeView: "3d" });
    assert.equal(s.activeView, "3d");
    assert.equal(s.diagramEditorEnabled, false);
    assert.equal(s.inspectorOverlayOpen, false);
    assert.equal(s.simulationPanelOpen, false);
    assert.equal(s.splitCodeOpen, false);

    // Enable Split Code orthogonally
    s = rotundaReducer(s, { type: "toggleSplitCode" });
    assert.equal(s.splitCodeOpen, true);
    assert.equal(s.codeOverlayOpen, true);

    const views: RotundaActiveView[] = ["diagram", "simulation", "inspector", "code", "3d"];
    for (const v of views) {
      s = rotundaReducer(s, { type: "setActiveView", view: v });
      assert.equal(s.activeView, v);
      assert.equal(s.diagramEditorEnabled, v === "diagram");
      assert.equal(s.simulationPanelOpen, v === "simulation");
      assert.equal(s.inspectorOverlayOpen, v === "inspector");
      // Split Code preference persists across view transitions
      assert.equal(s.splitCodeOpen, true);
      assert.equal(s.codeOverlayOpen, true);
    }

    // Disabling Split Code leaves Code view's own code panel intact, but closes companion wing on 3D view
    s = rotundaReducer(s, { type: "setSplitCodeOpen", open: false });
    assert.equal(s.splitCodeOpen, false);
    assert.equal(s.codeOverlayOpen, false);
    s = rotundaReducer(s, { type: "setActiveView", view: "code" });
    assert.equal(s.codeOverlayOpen, true);
    s = rotundaReducer(s, { type: "setActiveView", view: "diagram" });
    assert.equal(s.codeOverlayOpen, false);
  });

  test("resolveStageCameraPose provides dedicated targets per stage and widens framing for Split Code", () => {
    const diagramSolo = resolveStageCameraPose("diagram", "hero", false);
    const diagramSplit = resolveStageCameraPose("diagram", "hero", true);
    const simSolo = resolveStageCameraPose("simulation", "hero", false);
    const codeWithSplitFlag = resolveStageCameraPose("code", "hero", true);

    assert.notDeepEqual(diagramSolo.target, simSolo.target);
    assert.ok(diagramSplit.position[2] > diagramSolo.position[2], "Split mode should pull camera back slightly");
    assert.ok(diagramSplit.target[0] > diagramSolo.target[0], "Split mode should shift target slightly right");
    assert.equal(codeWithSplitFlag.target[0], 0, "Code stage stays centered even if splitCodeOpen is true");
  });

  test("EngineeringRotunda hostedInWorkbench mode suppresses duplicate chrome and syncs controlled activeView 1:1", () => {
    const html3d = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        hostedInWorkbench: true,
        activeView: "3d",
        splitCodeOpen: false,
        onExitTo2D: () => undefined,
      }),
    );
    assert.ok(html3d.includes('data-active-view="3d"'));
    assert.ok(html3d.includes('data-testid="rotunda-control-dock"'));
    assert.ok(
      html3d.includes('data-testid="rotunda-env-trigger"'),
      "Hosted mode uses compact Environment popover trigger",
    );
    assert.ok(!html3d.includes("Return to 2D Canvas"), "Hosted mode must not render duplicate Return to 2D button");
    assert.ok(
      !html3d.includes('data-testid="rotunda-toggle-diagram-3d"'),
      "Hosted mode defers view switching to top navbar",
    );

    const htmlDiagram = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        hostedInWorkbench: true,
        activeView: "diagram",
        splitCodeOpen: true,
      }),
    );
    assert.ok(htmlDiagram.includes('data-active-view="diagram"'));
    assert.ok(htmlDiagram.includes('data-diagram-editor="open"'));
    assert.ok(htmlDiagram.includes('data-testid="rotunda-diagram-studio-bar"'));
  });

  test("buildCleanCreaseEdgeGeometry extracts crisp cylinder rims and suppresses CSG float-drift cracks", () => {
    // 1. 48-segment cylinder: only 2 circular rims (48 * 2 = 96 segments), zero vertical wall facets
    const cyl = new THREE.CylinderGeometry(10, 10, 20, 48);
    const cylEdges = buildCleanCreaseEdgeGeometry(cyl, 32);
    const cylSegCount = (cylEdges.getAttribute("position")?.count ?? 0) / 2;
    assert.equal(cylSegCount, 96, `Expected exactly 96 rim segments on 48-seg cylinder, got ${cylSegCount}`);
    cyl.dispose();
    cylEdges.dispose();

    // 2. Non-indexed box with sub-tolerance vertex drift (simulating CSG boolean output)
    const box = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    const pos = box.getAttribute("position") as THREE.BufferAttribute;
    // Perturb one shared vertex slightly below weld tolerance (diag ≈ 34.6, weldScale ≈ 0.017)
    pos.setXYZ(0, pos.getX(0) + 0.002, pos.getY(0) - 0.002, pos.getZ(0));
    pos.needsUpdate = true;
    const boxEdges = buildCleanCreaseEdgeGeometry(box, 32);
    const boxSegCount = (boxEdges.getAttribute("position")?.count ?? 0) / 2;
    assert.equal(boxSegCount, 12, `Expected exactly 12 clean cube edges despite CSG drift, got ${boxSegCount}`);
    box.dispose();
    boxEdges.dispose();
  });

  test("buildScadFeatureTreeFromCst builds hierarchical CSG operation tree from native WASM GLR CST and applies overrides cleanly", async () => {
    const scad = [
      "// Parametric Aerospace Flanged Drive Hub",
      "flange_radius = 42;",
      "difference() {",
      "  union() {",
      "    cylinder(h = 8, r = flange_radius);",
      "    cylinder(h = 32, r = 22);",
      "  }",
      "  translate([0, 0, -1])",
      "    cylinder(h = 34, r = 10);",
      "  for (i = [0 : 5]) {",
      "    rotate([0, 0, i * 60])",
      "      translate([31, 0, -1])",
      "        cylinder(h = 10, r = 4);",
      "  }",
      "}",
    ].join("\n");

    const parser = await getScadParser();
    const parsed = parser.parse(scad);
    const tree = buildScadFeatureTreeFromCst(
      parsed.rootNode as Parameters<typeof buildScadFeatureTreeFromCst>[0],
      scad,
    );
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.op, "difference");
    assert.equal(tree[0]!.line, 3);
    assert.equal(tree[0]!.children.length, 3);
    assert.equal(tree[0]!.children[0]!.op, "union");
    assert.equal(tree[0]!.children[0]!.children.length, 2);
    assert.equal(tree[0]!.children[1]!.op, "translate");
    assert.equal(tree[0]!.children[1]!.children[0]!.op, "cylinder");
    assert.equal(tree[0]!.children[2]!.op, "for");
    assert.equal(countCadFeatureNodes(tree), 10);

    const forNode = tree[0]!.children[2]!;
    const suppressed = applyScadOperationOverrides(scad, tree, {
      suppressedIds: new Set([forNode.id]),
      isolatedId: null,
      ghostIds: new Set(),
    });
    assert.ok(suppressed.includes("*for (i = [0 : 5])"), "Expected * modifier injected before for loop");

    const unionNode = tree[0]!.children[0]!;
    const isolated = applyScadOperationOverrides(scad, tree, {
      suppressedIds: new Set(),
      isolatedId: unionNode.id,
      ghostIds: new Set(),
    });
    assert.ok(isolated.includes("!union()"), "Expected ! modifier injected before isolated union");

    assert.equal(formatCadPartDisplayName("Subtract_Subtract_Subtract_Union_Cyl_Cyl_Hole"), "CSG Solid (Difference)");
    assert.equal(formatCadPartDisplayName("flanged_hub_1"), "flanged_hub_1");
  });
});
