// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCanonicalPolyglotDemoBoard } from "@modelscript/canvas";
import { GALLERY_COMPONENTS } from "@modelscript/editor/workbench/componentGalleryCatalog.js";
import {
  applyAutoDomainLayerLayout,
  applyGrabOffset,
  applySpatialSnapConstraint,
  buildExtrudedIconBundle,
  buildLibraryPanelLayout,
  canAcquireInteractionLock,
  commitConnectSpatialPorts,
  commitDeleteSpatialNode,
  commitDisconnectSpatialEdge,
  commitMoveSpatialNode,
  commitSpawnCatalogComponent,
  computeGrabOffset,
  computeInfiniteWireControlPoints,
  computeSmoothingAlpha,
  createDynamicWireTubeBuffer,
  createInitialRotundaState,
  createSpatialDiagramStateFromTile,
  diagram2DToStage3D,
  DOMAIN_LAYER_Z_PLANES,
  EngineeringRotunda,
  evaluateMagneticPortSnap,
  evaluateMaterializeTransition,
  evaluatePortCompatibility,
  evaluateWristPalmVisibility,
  ExtrudedIconCache,
  filterLibraryCatalog,
  generateUniqueComponentName,
  hitTestLibraryPanel,
  inferCatalogItemPorts,
  isInsideDeleteRing,
  makePortKey,
  makeUndirectedConnectionKey,
  parseSvgColor,
  parseSvgTransform,
  redoSpatialDiagram,
  rotundaReducer,
  sampleWireSplineAt,
  stage3DToDiagram2D,
  undoSpatialDiagram,
  type SpatialDiagramPort3D,
  type WorldPortCandidate,
} from "@modelscript/editor/workbench/vr-rotunda/index.js";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { SpatialVrSurface } from "../src/components/canvas/SpatialVrSurface.js";

function assertFiniteGeometry(geom: THREE.BufferGeometry | null, label: string): number {
  assert.ok(geom !== null, `${label}: expected non-null BufferGeometry`);
  const pos = geom.getAttribute("position");
  const norm = geom.getAttribute("normal");
  assert.ok(pos && pos.count > 0, `${label}: expected > 0 vertices`);
  assert.ok(norm && norm.count === pos.count, `${label}: expected matching normals`);
  for (let i = 0; i < pos.count; i++) {
    assert.ok(
      Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)),
      `${label}: non-finite position at vertex ${i}`,
    );
    assert.ok(
      Number.isFinite(norm.getX(i)) && Number.isFinite(norm.getY(i)) && Number.isFinite(norm.getZ(i)),
      `${label}: non-finite normal at vertex ${i}`,
    );
  }
  return pos.count;
}

describe("3D WebXR Spatial Diagram Editor — Pure Engines & Integration", () => {
  test("svg-extruder parses CSS colors, rgba opacity, currentColor, and SVG 2D transforms accurately", () => {
    const rgba = parseSvgColor("rgba(59, 130, 246, 0.25)");
    assert.equal(rgba.isNone, false);
    assert.ok(Math.abs(rgba.r - 59 / 255) < 1e-3);
    assert.ok(Math.abs(rgba.a - 0.25) < 1e-3);

    const cur = parseSvgColor("currentColor", "#ff0088");
    assert.equal(cur.isNone, false);
    assert.ok(Math.abs(cur.r - 1) < 1e-3);
    assert.ok(Math.abs(cur.g - 0) < 1e-3);

    const none = parseSvgColor("none");
    assert.equal(none.isNone, true);

    const mat = parseSvgTransform("translate(10, 20) scale(2, 3)");
    assert.equal(mat.e, 10);
    assert.equal(mat.f, 20);
    assert.equal(mat.a, 2);
    assert.equal(mat.d, 3);
  });

  test("svg-extruder auto-extrudes EVERY component in GALLERY_COMPONENTS with finite vertices, raised strokes, and translucent fills", () => {
    assert.ok(GALLERY_COMPONENTS.length >= 15, "Expected rich built-in gallery catalog");
    let sawTranslucent = false;
    let sawOpenStrokeRibbon = false;

    for (const item of GALLERY_COMPONENTS) {
      const bundle = buildExtrudedIconBundle(
        { kind: "svg", svg: item.schematicSvg, width: 80, height: 56 },
        { waferStyle: "tactile-tile", dark: false },
      );

      assertFiniteGeometry(bundle.opaqueGeometry, `${item.id}.opaque`);
      assertFiniteGeometry(bundle.waferGeometry, `${item.id}.wafer`);
      assertFiniteGeometry(bundle.rimGeometry, `${item.id}.rim`);

      if (bundle.translucentGeometry) {
        assertFiniteGeometry(bundle.translucentGeometry, `${item.id}.translucent`);
        sawTranslucent = true;
      }
      if (bundle.strokeRibbonCount > 0) {
        sawOpenStrokeRibbon = true;
      }
      assert.ok(bundle.widthMeters > 0.04 && bundle.widthMeters < 0.3, `${item.id} physical width in meters`);
      assert.ok(bundle.heightMeters > 0.04 && bundle.heightMeters < 0.3, `${item.id} physical height in meters`);
      bundle.dispose();
    }

    assert.equal(sawTranslucent, true, "Expected translucent rgba fills to be bucketed separately");
    assert.equal(
      sawOpenStrokeRibbon,
      true,
      "Expected open SVG strokes (Resistor/Capacitor/Inductor/Ground) to extrude into 3D ribs",
    );

    // Verify pure-relief mode omits wafer & rim cleanly while preserving extruded SVG geometry
    const inductor = GALLERY_COMPONENTS.find((c) => c.id === "msl-inductor") ?? GALLERY_COMPONENTS[0]!;
    const pureRelief = buildExtrudedIconBundle(
      { kind: "svg", svg: inductor.schematicSvg },
      { waferStyle: "pure-relief", dark: true },
    );
    assert.equal(pureRelief.waferGeometry, null);
    assert.equal(pureRelief.rimGeometry, null);
    assert.ok(
      pureRelief.strokeRibbonCount >= 3,
      "Inductor coil elliptical arcs & leads should generate stroke ribbons",
    );
    assertFiniteGeometry(pureRelief.opaqueGeometry, "inductor.pureRelief");
    pureRelief.dispose();
  });

  test("svg-extruder compiles DiagramMarkupNode trees (including embedded SVG data URIs) and honors LRU cache eviction", () => {
    const embeddedSvg = encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" stroke="#22d3ee" stroke-width="2" fill="none"/></svg>',
    );
    const bundle = buildExtrudedIconBundle({
      kind: "markup",
      width: 96,
      height: 60,
      markup: [
        {
          tagName: "rect",
          selector: "body",
          attrs: { x: 0, y: 0, width: 96, height: 60, rx: 6, fill: "#1e293b", stroke: "#38bdf8", "stroke-width": 2 },
        },
        { tagName: "image", attrs: { x: 28, y: 10, width: 40, height: 40, href: `data:image/svg+xml,${embeddedSvg}` } },
        { tagName: "text", selector: "label", attrs: { x: 48, y: 54 }, textContent: "Motor1" },
      ],
    });
    assertFiniteGeometry(bundle.opaqueGeometry, "markup.opaque");
    assert.ok(bundle.extractedTexts.some((t) => t.text === "Motor1"));
    bundle.dispose();

    // LRU cache ref-counting & eviction
    const cache = new ExtrudedIconCache(2);
    const mk = (key: string) =>
      cache.acquire(key, () =>
        buildExtrudedIconBundle({
          kind: "svg",
          svg: '<svg viewBox="0 0 20 20"><line x1="2" y1="10" x2="18" y2="10" stroke="#fff"/></svg>',
        }),
      );
    const a1 = mk("kA");
    const a2 = mk("kA");
    assert.strictEqual(a1, a2, "Cache hit must share identical ExtrudedIconBundle instance");
    cache.release("kA");
    cache.release("kA");
    mk("kB");
    mk("kC"); // Should evict unreferenced kA
    assert.equal(cache.size, 2);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  test("spatial-diagram-state performs lossless 2D↔3D round-trips, catalog spawning with snap-weld, undo/redo, and domain layering", () => {
    const state0 = createSpatialDiagramStateFromTile(null);
    assert.ok(state0.nodes.length >= 5, "Default starter schematic should contain RLC + PID components");
    assert.ok(state0.edges.length >= 4, "Default starter schematic should contain initial wires");

    // 2D <-> 3D coordinate round-trip
    const p3 = diagram2DToStage3D(240, 130, state0.coordFrame, 0.12);
    const back2 = stage3DToDiagram2D(p3, state0.coordFrame);
    assert.ok(Math.abs(back2.x - 240) < 0.25);
    assert.ok(Math.abs(back2.y - 130) < 0.25);

    // Move node emits canonical DiagramEditAction
    const moved = commitMoveSpatialNode(state0, "R1", {
      position: [0.18, 0.12, -0.08],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    });
    assert.equal(moved.actions.length, 1);
    assert.equal(moved.actions[0]?.type, "move");
    assert.equal(moved.state.poses["R1"]?.position[2], -0.08);
    assert.equal(moved.state.undoStack.length, 1);

    // Spawn new Resistor from gallery with automatic collision-free naming (R1 exists -> R2) & snap-weld
    const resistor = GALLERY_COMPONENTS.find((c) => c.id === "msl-resistor")!;
    assert.equal(generateUniqueComponentName(resistor, new Set(["R1"])), "R2");
    assert.ok(inferCatalogItemPorts(resistor).length >= 2);

    const spawned = commitSpawnCatalogComponent(
      moved.state,
      resistor,
      { position: [0.32, 0.05, 0.04], quaternion: [0, 0, 0, 1], scale: 1 },
      { spawnedPortId: "p", targetNodeId: "L1", targetPortId: "n" },
    );
    assert.equal(spawned.spawnedNodeId, "R2");
    assert.equal(spawned.actions.length, 2);
    assert.equal(spawned.actions[0]?.type, "addComponent");
    assert.equal(spawned.actions[1]?.type, "connect");
    assert.ok(spawned.state.nodes.some((n) => n.id === "R2"));

    // Connect prevents duplicates, disconnect removes cleanly
    const dup = commitConnectSpatialPorts(spawned.state, "L1", "n", "R2", "p");
    assert.equal(dup.actions.length, 0, "Duplicate undirected wire must be ignored");

    const addedEdgeId = spawned.state.edges[spawned.state.edges.length - 1]!.id!;
    const disconn = commitDisconnectSpatialEdge(spawned.state, addedEdgeId);
    assert.equal(disconn.actions[0]?.type, "disconnect");
    assert.equal(disconn.state.edges.length, spawned.state.edges.length - 1);

    // Delete node removes node and its incident edges
    const del = commitDeleteSpatialNode(disconn.state, "R2");
    assert.equal(del.actions[0]?.type, "deleteComponents");
    assert.equal(
      del.state.nodes.some((n) => n.id === "R2"),
      false,
    );

    // Undo restores R2, Redo deletes it again
    const undone = undoSpatialDiagram(del.state);
    assert.equal(
      undone.nodes.some((n) => n.id === "R2"),
      true,
    );
    const redone = redoSpatialDiagram(undone);
    assert.equal(
      redone.nodes.some((n) => n.id === "R2"),
      false,
    );

    // Auto-layer vs Flatten to 2D
    const layered = applyAutoDomainLayerLayout(state0, false);
    assert.equal(layered.poses["PID1"]?.position[2], DOMAIN_LAYER_Z_PLANES[0]!.zMeters);
    assert.equal(layered.poses["R1"]?.position[2], DOMAIN_LAYER_Z_PLANES[1]!.zMeters);

    const flat = applyAutoDomainLayerLayout(layered, true);
    for (const p of Object.values(flat.poses)) {
      assert.equal(p.position[2], 0);
    }
  });

  test("magnetic-port-solver enforces domain compatibility, Schmitt hysteresis capture, and infinite 3D Bézier tube geometry", () => {
    const srcElec: SpatialDiagramPort3D = {
      nodeId: "R1",
      portId: "n",
      label: "n",
      localPosition: [0.08, 0, 0],
      localNormal: [1, 0, 0],
      domain: "electrical",
      polarity: "negative",
      color: "#2563eb",
    };
    const tgtElec: SpatialDiagramPort3D = {
      nodeId: "C1",
      portId: "p",
      label: "p",
      localPosition: [-0.08, 0, 0],
      localNormal: [-1, 0, 0],
      domain: "electrical",
      polarity: "positive",
      color: "#2563eb",
    };
    const tgtThermal: SpatialDiagramPort3D = {
      nodeId: "Heat1",
      portId: "port",
      label: "port",
      localPosition: [-0.08, 0, 0],
      localNormal: [-1, 0, 0],
      domain: "thermal",
      polarity: "inout",
      color: "#ef4444",
    };

    assert.equal(evaluatePortCompatibility(srcElec, tgtElec).compatible, true);
    assert.equal(evaluatePortCompatibility(srcElec, tgtThermal).compatible, false);
    assert.equal(
      evaluatePortCompatibility(
        { nodeId: "A", portId: "y", domain: "signal", polarity: "output" },
        { nodeId: "B", portId: "y", domain: "signal", polarity: "output" },
      ).compatible,
      false,
    );

    const candidates: WorldPortCandidate[] = [
      { port: tgtElec, worldPosition: [0.3, 1.3, -0.6], worldNormal: [-1, 0, 0] },
      { port: tgtThermal, worldPosition: [0.6, 1.3, -0.6], worldNormal: [-1, 0, 0] },
    ];

    // Approach zone (14 cm away -> glowing halo, not snapped yet)
    const approach = evaluateMagneticPortSnap(srcElec, [0.16, 1.3, -0.6], candidates);
    assert.equal(approach.snappedTarget, null);
    assert.equal(approach.approachCandidates.length, 1);
    assert.ok(approach.approachCandidates[0]!.proximity01 > 0.2);

    // Engage magnetic snap well (5 cm away -> snapped + justSnapped!)
    const engaged = evaluateMagneticPortSnap(srcElec, [0.25, 1.3, -0.6], candidates);
    assert.equal(engaged.snappedTarget?.port.nodeId, "C1");
    assert.equal(engaged.justSnapped, true);

    // Hysteresis hold at 9.2 cm (beyond engage 7.8cm, inside release 10.8cm -> stays locked!)
    const held = evaluateMagneticPortSnap(srcElec, [0.208, 1.3, -0.6], candidates, {
      currentlySnappedKey: makePortKey("C1", "p"),
    });
    assert.equal(held.snappedTarget?.port.nodeId, "C1");
    assert.equal(held.justSnapped, false);

    // Duplicate connection excluded from magnetic capture
    const dupExcluded = evaluateMagneticPortSnap(srcElec, [0.29, 1.3, -0.6], candidates, {
      existingConnectionKeys: new Set([makeUndirectedConnectionKey("R1", "n", "C1", "p")]),
    });
    assert.equal(dupExcluded.snappedTarget, null);

    // Incompatible port inside snap well triggers rejection feedback
    const rejected = evaluateMagneticPortSnap(srcElec, [0.58, 1.3, -0.6], candidates);
    assert.equal(rejected.snappedTarget, null);
    assert.equal(rejected.rejectedTarget?.candidate.port.nodeId, "Heat1");
    assert.equal(rejected.justRejected, true);

    // Infinite-length wire spline + zero-alloc dynamic tube (test both 4 cm and 12 meters!)
    const tube = createDynamicWireTubeBuffer(24, 8);
    for (const endX of [0.04, 12.0]) {
      const ctrl = computeInfiniteWireControlPoints([0, 0, 0], [1, 0, 0], [endX, 0.5, -2.0], [-1, 0, 0]);
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      sampleWireSplineAt(ctrl, 0, p0);
      sampleWireSplineAt(ctrl, 1, p1);
      assert.ok(p0.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-5);
      assert.ok(p1.distanceTo(new THREE.Vector3(endX, 0.5, -2.0)) < 1e-5);
      tube.update(ctrl, 0.004);
      assertFiniteGeometry(tube.geometry, `wireTube(${endX}m)`);
    }
    tube.dispose();
  });

  test("spatial-interaction preserves 6DOF grab offset, respects lock priority, and enforces snap constraints", () => {
    const handPos = new THREE.Vector3(0.2, 1.3, -0.5);
    const handQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.5, -0.1));
    const nodePos = new THREE.Vector3(0.28, 1.34, -0.56);
    const nodeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3, 0.1));

    const offset = computeGrabOffset(handPos, handQuat, nodePos, nodeQuat);
    const outPos = new THREE.Vector3();
    const outQuat = new THREE.Quaternion();
    applyGrabOffset(handPos, handQuat, offset, outPos, outQuat);
    assert.ok(outPos.distanceTo(nodePos) < 1e-5);
    assert.ok(Math.abs(outQuat.dot(nodeQuat)) > 0.9999);

    assert.ok(computeSmoothingAlpha(0.016, 0.02) > 0.3 && computeSmoothingAlpha(0.016, 0.02) < 0.6);
    assert.equal(canAcquireInteractionLock("node-grab", "wire-drag"), true);
    assert.equal(canAcquireInteractionLock("wire-drag", "node-grab"), false);
    assert.equal(isInsideDeleteRing([0.62, -0.34, 0.14], [0.64, -0.34, 0.14]), true);
    assert.equal(isInsideDeleteRing([0.0, 0.0, 0.0], [0.64, -0.34, 0.14]), false);

    const gridPose = applySpatialSnapConstraint([0.123, -0.074, 0.031], [0, 0, 0, 1], "grid-5cm");
    assert.ok(Math.abs(gridPose.position[0] - 0.1) < 1e-6);
    assert.ok(Math.abs(gridPose.position[1] - -0.05) < 1e-6);
    assert.ok(Math.abs(gridPose.position[2] - 0.05) < 1e-6);

    const flatPose = applySpatialSnapConstraint([0.12, 0.04, 0.27], [0, 0, 0, 1], "flat-2d");
    assert.equal(flatPose.position[2], 0);
  });

  test("wrist-palette-logic gates palm visibility, filters/hit-tests the 2D icon library, and drives pull-to-materialize FSM", () => {
    // Palm facing user -> visible; palm turned away -> hidden
    const facing = evaluateWristPalmVisibility([0, 0, 1], [0, 0.2, 0.98], false);
    assert.equal(facing.visible, true);
    assert.ok(facing.opacity > 0.8);
    const away = evaluateWristPalmVisibility([0, 0, -1], [0, 0, 1], true);
    assert.equal(away.visible, false);
    assert.equal(away.opacity, 0);

    // Library filtering & hit-testing
    const elecItems = filterLibraryCatalog(GALLERY_COMPONENTS, "electrical", "rlc");
    assert.ok(elecItems.some((c) => c.id === "msl-resistor"));

    const layout = buildLibraryPanelLayout(GALLERY_COMPONENTS, "all", "all", 0);
    assert.ok(layout.cards.length > 0 && layout.cards.length <= 12);
    const firstCard = layout.cards[0]!;
    const hitCard = hitTestLibraryPanel(layout, firstCard.x + 20, firstCard.y + 20);
    assert.equal(hitCard?.kind, "card");
    const hitClose = hitTestLibraryPanel(layout, layout.closeBtnRect.x + 10, layout.closeBtnRect.y + 10);
    assert.equal(hitClose?.kind, "close");

    // Pull-to-materialize 2D -> 3D state transitions
    const sPeel = evaluateMaterializeTransition(0.004, false);
    assert.equal(sPeel.phase, "peeling");
    assert.equal(sPeel.shouldCancelOnRelease, true);

    const sMorph = evaluateMaterializeTransition(0.026, false);
    assert.equal(sMorph.phase, "morphing");
    assert.ok(sMorph.morphProgress > 0.1 && sMorph.morphProgress < 0.9);

    const sPop = evaluateMaterializeTransition(0.052, false);
    assert.equal(sPop.phase, "materialized");
    assert.equal(sPop.justMaterialized, true);
    assert.equal(sPop.shouldCancelOnRelease, false);

    const sCancel = evaluateMaterializeTransition(0.015, true);
    assert.equal(sCancel.phase, "cancel-return");
    assert.equal(sCancel.shouldCancelOnRelease, true);
  });

  test("rotundaReducer and SSR/JSDOM EngineeringRotunda + SpatialVrSurface support 3D Diagram Studio cleanly", async () => {
    let s = createInitialRotundaState();
    assert.equal(s.diagramEditorEnabled, false);
    s = rotundaReducer(s, { type: "toggleDiagramEditor" });
    assert.equal(s.diagramEditorEnabled, true);
    s = rotundaReducer(s, { type: "cycleDiagramSnapMode" });
    assert.equal(s.diagramSnapMode, "domain-layers");
    s = rotundaReducer(s, { type: "toggleDiagramWaferStyle" });
    assert.equal(s.diagramWaferStyle, "pure-relief");
    s = rotundaReducer(s, { type: "toggleWristPalette" });
    assert.equal(s.wristPaletteOpen, true);

    const doc = createCanonicalPolyglotDemoBoard();
    const ssrHtml = renderToStaticMarkup(
      React.createElement(SpatialVrSurface, {
        document: doc,
        mode: "spatial-3d",
        initialDiagramEditorEnabled: true,
        onDiagramEdit: () => undefined,
      }),
    );
    assert.ok(ssrHtml.includes('data-diagram-editor="open"'));
    assert.ok(ssrHtml.includes('data-testid="rotunda-toggle-diagram-3d"'));
    assert.ok(ssrHtml.includes('data-testid="rotunda-diagram-studio-bar"'));
    assert.ok(ssrHtml.includes('data-testid="rotunda-toggle-wrist-library"'));

    // JSDOM interactive click verification (zero React 19 hook errors)
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
      url: "https://ansatz.local/spatial",
    });
    const prevWin = globalThis.window;
    const prevDoc = globalThis.document;
    const prevNav = globalThis.navigator;
    Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
    Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

    const rootEl = dom.window.document.getElementById("root")!;
    const root = createRoot(rootEl);
    try {
      await act(async () => {
        root.render(
          React.createElement(EngineeringRotunda, {
            document: doc,
            mode: "spatial-3d",
          }),
        );
      });

      const surface = rootEl.querySelector('[data-testid="spatial-vr-surface"]');
      assert.equal(surface?.getAttribute("data-diagram-editor"), "closed");

      const toggleBtn = rootEl.querySelector('[data-testid="rotunda-toggle-diagram-3d"]') as HTMLButtonElement | null;
      assert.ok(toggleBtn, "Expected 3D Diagram toggle button in Rotunda HUD");
      await act(async () => {
        toggleBtn.click();
      });
      assert.equal(surface?.getAttribute("data-diagram-editor"), "open");

      const libBtn = rootEl.querySelector('[data-testid="rotunda-toggle-wrist-library"]') as HTMLButtonElement | null;
      assert.ok(libBtn, "Expected Library toggle button inside 3D Diagram Studio bar");
      await act(async () => {
        libBtn.click();
      });
      assert.equal(surface?.getAttribute("data-wrist-palette"), "open");
    } finally {
      await act(async () => {
        root.unmount();
      });
      Object.defineProperty(globalThis, "window", { value: prevWin, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDoc, configurable: true });
      Object.defineProperty(globalThis, "navigator", { value: prevNav, configurable: true });
    }
  });
});
