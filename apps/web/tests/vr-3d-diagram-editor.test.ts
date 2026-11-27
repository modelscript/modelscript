// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCanonicalPolyglotDemoBoard } from "@modelscript/canvas";
import { evaluateModelScriptPortCompatibility } from "@modelscript/diagram/protocol";
import { GALLERY_COMPONENTS } from "@modelscript/editor/workbench/componentGalleryCatalog.js";
import {
  applyAutoDomainLayerLayout,
  applyGrabOffset,
  applySpatialSnapConstraint,
  buildExtrudedIconBundle,
  buildFallbackLibraryTree,
  buildGlassPanelLayout,
  buildLibraryPanelLayout,
  buildVrKeyboardLayout,
  canAcquireInteractionLock,
  clampBezelRepositionOffset,
  commitAddEdgeWaypoint,
  commitAddIconPrimitive,
  commitAlignSpatialNodes,
  commitConnectSpatialPorts,
  commitDeleteIconPrimitive,
  commitDeleteSpatialNode,
  commitDeleteSpatialNodes,
  commitDisconnectSpatialEdge,
  commitDuplicateSpatialNodes,
  commitFlipSpatialNode,
  commitMoveEdgeWaypoints,
  commitMoveSpatialNode,
  commitMoveSpatialNodes,
  commitNudgeSpatialNodes,
  commitReconnectSpatialEdge,
  commitRemoveEdgeWaypoint,
  commitReorderIconPrimitive,
  commitResizeSpatialNode,
  commitRotateSpatialNode,
  commitSpawnCatalogComponent,
  commitUpdateIconPrimitive,
  computeActivePanelTransitionOffset,
  computeGlassStackPoses,
  computeGrabOffset,
  computeHeadParallaxGlintOffset,
  computeHeadRelativeAnchor,
  computeInfiniteWireControlPoints,
  computeMatrixEntranceState,
  computeMaxScrollRow,
  computePinnedPanelOffset,
  computePortJunctionCounts,
  computeRotundaAtlasUvRect,
  computeSeriesYBounds,
  computeSiblingRotundaSlots,
  computeSmoothingAlpha,
  computeSpatialSmartGuides,
  computeStockroomSlotPose,
  computeTileLocalCenter3D,
  createDynamicWireTubeBuffer,
  createInitialGlassLibraryState,
  createInitialRotundaState,
  createSpatialDiagramStateFromTile,
  diagram2DToStage3D,
  diagramPaletteToGalleryCatalog,
  DOMAIN_LAYER_Z_PLANES,
  drillIntoGlassNode,
  EngineeringRotunda,
  evaluateBareHandSwipe,
  evaluateMagneticPortSnap,
  evaluateMaterializeTransition,
  evaluatePortCompatibility,
  evaluateTetherPullStep,
  evaluateWristPalmVisibility,
  extractAvailableLanguages,
  extractNodePorts3D,
  extractVrSimulationDataset,
  ExtrudedIconCache,
  filterLibraryCatalog,
  filterRootLibrariesByLanguage,
  findAncestorPathInLocalTree,
  formatEngineeringValue,
  formatNodeSpecPeek,
  generateUniqueComponentName,
  hitTestGlassPanel,
  hitTestLibraryPanel,
  hitTestVrKeyboard,
  hitTestVrSimulationPanel,
  inferCatalogItemPorts,
  INITIAL_GLASS_TILE_MAGNET_STATE,
  INITIAL_STOCKROOM_MAGNET_STATE,
  isInsideDeleteRing,
  isNodeCompatibleWithOpenPorts,
  jumpToGlassDepth,
  makePortKey,
  makeUndirectedConnectionKey,
  parseSvgColor,
  parseSvgTransform,
  REALISTIC_COMPONENT_KINDS,
  recordRecentComponent,
  redoSpatialDiagram,
  releaseEventForBinding,
  resolveDiagramLanguageTheme,
  resolveRealisticComponentKind,
  resolveStockroomSlotItem,
  rotundaReducer,
  sampleSeriesAtTime,
  sampleWireSplineAt,
  searchLocalLibraryTree,
  sortNodesWithStarredFirst,
  splitFqnAncestorPrefixes,
  stage3DToDiagram2D,
  stepDownGlassHierarchy,
  stepGlassGridScroll,
  stepGlassTileMagnetLock,
  stepSiblingRotundaPan,
  stepStockroomMagnetLock,
  stepStockroomScroll,
  stepUpGlassHierarchy,
  STOCKROOM_VISIBLE_COLS,
  STOCKROOM_VISIBLE_ROWS,
  switchToSiblingContainer,
  toggleStarredNodeId,
  treeNodeToGlassLibraryNode,
  undoSpatialDiagram,
  wrapPositiveMod,
  type SpatialDiagramPort3D,
  type WorldPortCandidate,
} from "@modelscript/rotunda/index.js";
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

  test("matrix-stockroom-logic drives infinite 4-way shelf wrapping, Matrix whiz-in entrance, flanking poses, and exclusive stage mode transitions", () => {
    assert.equal(wrapPositiveMod(-1, 5), 4);
    assert.equal(wrapPositiveMod(-7, 5), 3);
    assert.equal(wrapPositiveMod(12, 5), 2);

    // Flanking left and right walls map cleanly across negative and large positive scroll coordinates
    const leftFirst = resolveStockroomSlotItem(GALLERY_COMPONENTS, "left", 0, 0);
    const rightFirst = resolveStockroomSlotItem(GALLERY_COMPONENTS, "right", 0, 0);
    assert.ok(leftFirst && rightFirst, "Both left and right stockroom bays must resolve items");
    assert.notEqual(leftFirst.id, rightFirst.id, "Left and right shelves should show distinct items side-by-side");
    assert.ok(resolveStockroomSlotItem(GALLERY_COMPONENTS, "left", -42, -19), "Negative infinite wrap must resolve");
    assert.ok(
      resolveStockroomSlotItem(GALLERY_COMPONENTS, "right", 999, 123),
      "Large positive infinite wrap must resolve",
    );

    // Matrix Construct whiz-in entrance blasts from deep -Z to settled 0 with staggered columns
    const start0 = computeMatrixEntranceState(0, 0);
    const mid0 = computeMatrixEntranceState(0.22, 0);
    const mid3 = computeMatrixEntranceState(0.22, 3);
    const done0 = computeMatrixEntranceState(1.2, 0);
    assert.ok(start0.zOffsetMeters < -10, "Entrance must begin deep down the corridor");
    assert.ok(mid0.zOffsetMeters > start0.zOffsetMeters && mid0.zOffsetMeters < 0);
    assert.ok(mid3.zOffsetMeters < mid0.zOffsetMeters, "Further columns should stagger behind closer columns");
    assert.equal(done0.zOffsetMeters, 0);
    assert.equal(done0.settled, true);
    assert.equal(done0.streakIntensity, 0);

    // Fast 4-way scrolling with thumbstick deflection crosses bay boundaries & coasts smoothly on release
    let scroll = { scrollCol: 0, scrollRow: 0, velCol: 0, velRow: 0 };
    let crossed = false;
    for (let i = 0; i < 20; i++) {
      const step = stepStockroomScroll(scroll, { stickX: 1.0, stickY: -0.8 }, 0.03);
      scroll = step.next;
      if (step.crossedBay) crossed = true;
    }
    assert.equal(crossed, true, "Fast thumbstick pan must cross bay boundaries for detent feedback");
    assert.ok(scroll.scrollCol > 1.5, "Horizontal scroll should advance quickly");
    assert.ok(scroll.scrollRow < -1.0, "Vertical scroll should advance quickly");

    // Inertial coast damps cleanly toward zero when sticks return to neutral
    const coastStartVel = Math.abs(scroll.velCol);
    for (let i = 0; i < 30; i++) {
      scroll = stepStockroomScroll(scroll, { stickX: 0, stickY: 0 }, 0.03).next;
    }
    assert.ok(Math.abs(scroll.velCol) < coastStartVel * 0.15, "Inertia must damp cleanly");

    // Flanking left (-X) and right (+X) shelf poses face inward symmetrically toward the engineer
    const poseL = computeStockroomSlotPose(
      "left",
      Math.floor(STOCKROOM_VISIBLE_COLS / 2),
      Math.floor(STOCKROOM_VISIBLE_ROWS / 2),
      0,
      0,
      0,
    );
    const poseR = computeStockroomSlotPose(
      "right",
      Math.floor(STOCKROOM_VISIBLE_COLS / 2),
      Math.floor(STOCKROOM_VISIBLE_ROWS / 2),
      0,
      0,
      0,
    );
    assert.ok(poseL.position[0] < -0.9, "Left shelf must flank left (-X) side of engineer");
    assert.ok(poseR.position[0] > 0.9, "Right shelf must flank right (+X) side of engineer");
    assert.ok(Math.abs(poseL.position[0] + poseR.position[0]) < 1e-5, "Corridor walls must be symmetric");
    assert.ok(poseL.yawRad > 0 && poseR.yawRad < 0, "Corridor walls must face inward toward engineer");
    assert.equal(poseL.edgeScale, 1);

    // Exclusive mode transitions: opening Stockroom enters 3D Diagram mode; returning to 3D Model mode closes Stockroom
    let rotunda = createInitialRotundaState();
    assert.equal(rotunda.diagramEditorEnabled, false);
    rotunda = rotundaReducer(rotunda, { type: "toggleWristPalette" });
    assert.equal(rotunda.diagramEditorEnabled, true);
    assert.equal(rotunda.wristPaletteOpen, true);
    rotunda = rotundaReducer(rotunda, { type: "toggleDiagramEditor" });
    assert.equal(rotunda.diagramEditorEnabled, false);
    assert.equal(rotunda.wristPaletteOpen, false);
  });

  test("resolveRealisticComponentKind maps curated real-world 3D hardware models while keeping other components as extruded cards", () => {
    assert.equal(REALISTIC_COMPONENT_KINDS.length, 9);
    assert.equal(resolveRealisticComponentKind("msl-constant-voltage ConstantVoltage"), "battery");
    assert.equal(resolveRealisticComponentKind("Battery Pack V_src"), "battery");
    assert.equal(resolveRealisticComponentKind("Modelica.Electrical.Analog.Basic.Resistor R1"), "resistor");
    assert.equal(resolveRealisticComponentKind("Modelica.Electrical.Analog.Basic.Capacitor C1"), "capacitor");
    assert.equal(resolveRealisticComponentKind("Modelica.Electrical.Analog.Basic.Inductor L1"), "inductor");
    assert.equal(resolveRealisticComponentKind("spice-diode Diode 1N4148"), "diode");
    assert.equal(resolveRealisticComponentKind("msl-opamp IdealOpAmp"), "ic-chip");
    assert.equal(resolveRealisticComponentKind("msl-pid PID Controller"), "ic-chip");
    assert.equal(resolveRealisticComponentKind("msl-ideal-gear IdealGear"), "gear");
    assert.equal(resolveRealisticComponentKind("msl-spring-damper SpringDamper"), "spring-damper");
    assert.equal(resolveRealisticComponentKind("buildings-valve Two-Way Valve"), "valve");

    // Non-hardware / abstract / thermal-capacity blocks remain crisp auto-extruded schematic wafer cards
    assert.equal(resolveRealisticComponentKind("msl-heat-capacitor HeatCapacitor"), null);
    assert.equal(resolveRealisticComponentKind("msl-ground Ground"), null);
    assert.equal(resolveRealisticComponentKind("msl-step Step"), null);
    assert.equal(resolveRealisticComponentKind(""), null);

    // Gallery catalog has a balanced mix of realistic 3D hardware models and extruded cards
    const realisticCount = GALLERY_COMPONENTS.filter(
      (item) => resolveRealisticComponentKind(`${item.id} ${item.fqn} ${item.shortName}`) !== null,
    ).length;
    assert.ok(
      realisticCount >= 9 && realisticCount < GALLERY_COMPONENTS.length,
      `Expected a mix of realistic 3D models and extruded cards, got ${realisticCount}/${GALLERY_COMPONENTS.length}`,
    );
  });

  test("evaluateModelScriptPortCompatibility enforces real Modelica/SysML2 connector rules identically in 2D and VR", () => {
    // Modelica complementary physical connectors match
    const pinPair = evaluateModelScriptPortCompatibility(
      { nodeId: "R1", portId: "p", connectorType: "Modelica.Electrical.Analog.Interfaces.PositivePin" },
      { nodeId: "C1", portId: "n", connectorType: "Modelica.Electrical.Analog.Interfaces.NegativePin" },
    );
    assert.equal(pinPair.compatible, true);
    assert.equal(pinPair.rule, "connector-type-match");

    // Cross-domain connector types (Electrical Pin vs Thermal HeatPort) are rejected
    const crossPhysics = evaluateModelScriptPortCompatibility(
      { nodeId: "R1", portId: "p", connectorType: "Modelica.Electrical.Analog.Interfaces.PositivePin" },
      { nodeId: "H1", portId: "port", connectorType: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a" },
    );
    assert.equal(crossPhysics.compatible, false);
    assert.equal(crossPhysics.rule, "connector-type-mismatch");

    // Causal RealOutput -> RealOutput conflict rejected
    const outOut = evaluateModelScriptPortCompatibility(
      { nodeId: "S1", portId: "y", connectorType: "Modelica.Blocks.Interfaces.RealOutput" },
      { nodeId: "S2", portId: "y", connectorType: "Modelica.Blocks.Interfaces.RealOutput" },
    );
    assert.equal(outOut.compatible, false);
    assert.equal(outOut.rule, "causality-conflict");

    // SysML v2 conjugation requires complementary (~) port pairing
    const sysmlMismatch = evaluateModelScriptPortCompatibility(
      { nodeId: "A", portId: "pwr", connectorType: "PowerPort", isConjugated: false },
      { nodeId: "B", portId: "pwr", connectorType: "PowerPort", isConjugated: false },
      { languageId: "sysml2" },
    );
    assert.equal(sysmlMismatch.compatible, false);
    assert.equal(sysmlMismatch.rule, "sysml2-conjugation-mismatch");

    const sysmlMatch = evaluateModelScriptPortCompatibility(
      { nodeId: "A", portId: "pwr", connectorType: "PowerPort", isConjugated: false },
      { nodeId: "B", portId: "pwr", connectorType: "PowerPort", isConjugated: true },
      { languageId: "sysml2" },
    );
    assert.equal(sysmlMatch.compatible, true);

    // VR magnetic-port-solver delegates directly to the exact same canonical rules
    const vrReject = evaluatePortCompatibility(
      {
        nodeId: "R1",
        portId: "p",
        domain: "electrical",
        polarity: "positive",
        connectorType: "Modelica.Electrical.Analog.Interfaces.PositivePin",
      },
      {
        nodeId: "H1",
        portId: "port",
        domain: "thermal",
        polarity: "neutral",
        connectorType: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
      },
    );
    assert.equal(vrReject.compatible, false);
  });

  test("stepStockroomMagnetLock stabilizes shelf grabs with sticky hold, dwell switch, and scroll brake", () => {
    // 1. Immediate latch onto bay 7 with scroll brake engaged
    const s1 = stepStockroomMagnetLock(INITIAL_STOCKROOM_MAGNET_STATE, 7, 0.016, 0.1);
    assert.equal(s1.next.lockedSlotIndex, 7);
    assert.equal(s1.justLocked, true);
    assert.ok(s1.scrollBrake < 0.5, "Magnetic lock should damp micro-scroll tremors while aiming");

    // 2. Ray slips into gap (null) for 100ms during trigger pull -> stays locked on bay 7!
    const s2 = stepStockroomMagnetLock(s1.next, null, 0.1, 0);
    assert.equal(s2.next.lockedSlotIndex, 7);

    // 3. Brief 30ms brush over neighbor bay 8 does not prematurely steal lock
    const s3 = stepStockroomMagnetLock(s2.next, 8, 0.03, 0);
    assert.equal(s3.next.lockedSlotIndex, 7);

    // 4. Sustained dwell (>= 75ms) cleanly switches magnetic lock to bay 8
    const s4 = stepStockroomMagnetLock(s3.next, 8, 0.06, 0);
    assert.equal(s4.next.lockedSlotIndex, 8);
    assert.equal(s4.justLocked, true);

    // 5. Intentional fast thumbstick flick (> 0.52) releases lock & restores full scroll speed
    const s5 = stepStockroomMagnetLock(s4.next, 8, 0.016, 0.85);
    assert.equal(s5.next.lockedSlotIndex, null);
    assert.equal(s5.scrollBrake, 1);
  });

  test("Diagram language theme, VR entry views (3d/diagram/inspector/code), code overlay, and file carousel work cleanly in SSR", () => {
    const moTheme = resolveDiagramLanguageTheme("modelica");
    const sysmlTheme = resolveDiagramLanguageTheme("sysml2", "ibd");
    const spiceTheme = resolveDiagramLanguageTheme("spice");
    assert.equal(moTheme.badgeLabel, "MODELICA");
    assert.equal(sysmlTheme.badgeLabel, "SysML v2");
    assert.ok(sysmlTheme.diagramKindLabel.includes("IBD"));
    assert.notEqual(moTheme.accentColor, sysmlTheme.accentColor);
    assert.equal(spiceTheme.badgeLabel, "SPICE");

    // Reducer view/overlay/file-carousel transitions
    let s = createInitialRotundaState({ activeView: "code" });
    assert.equal(s.activeView, "code");
    assert.equal(s.codeOverlayOpen, true);
    s = rotundaReducer(s, { type: "setActiveView", view: "inspector" });
    assert.equal(s.activeView, "inspector");
    assert.equal(s.inspectorOverlayOpen, true);
    s = rotundaReducer(s, { type: "toggleFileCarousel" });
    assert.equal(s.fileCarouselOpen, true);
    s = rotundaReducer(s, { type: "setActiveView", view: "diagram" });
    assert.equal(s.diagramEditorEnabled, true);

    const doc = createCanonicalPolyglotDemoBoard();
    const html = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        document: doc,
        mode: "spatial-3d",
        languageId: "sysml2",
        diagramType: "bdd",
        initialActiveView: "diagram",
        initialCodeOverlayOpen: true,
        sourceCode: "package Vehicle {\n  part def Battery;\n}\n",
        activeFilePath: "Vehicle.sysml",
        workspaceFiles: [
          { path: "Vehicle.sysml", name: "Vehicle.sysml", languageId: "sysml2" },
          { path: "Powertrain.mo", name: "Powertrain.mo", languageId: "modelica" },
        ],
      }),
    );
    assert.ok(html.includes('data-active-view="diagram"'));
    assert.ok(html.includes('data-language-id="sysml2"'));
    assert.ok(html.includes('data-testid="rotunda-language-badge"'));
    assert.ok(html.includes("SysML v2"));
    assert.ok(html.includes('data-testid="rotunda-toggle-code-overlay"'));
    assert.ok(html.includes('data-testid="rotunda-toggle-inspector-overlay"'));
    assert.ok(html.includes('data-testid="rotunda-toggle-file-carousel"'));
    assert.ok(html.includes("Files (2)"));
  });

  test("VR Simulation & Multi-Channel Oscilloscope Theater extracts series, interpolates playhead, hit-tests channels, and renders in SSR", () => {
    const rows = [
      { time: 0, v_bus1: 1.0, i_line: 0.0, freq_hz: 60.0 },
      { time: 0.5, v_bus1: 0.92, i_line: 120.5, freq_hz: 59.85 },
      { time: 1.0, v_bus1: 0.98, i_line: 85.0, freq_hz: 59.95 },
    ];

    const ds = extractVrSimulationDataset(rows, ["v_bus1", "i_line", "freq_hz"], ["v_bus1", "i_line"]);
    assert.equal(ds.times.length, 3);
    assert.equal(ds.tMin, 0);
    assert.equal(ds.tMax, 1.0);
    assert.deepEqual(ds.allVariables, ["v_bus1", "i_line", "freq_hz"]);
    assert.equal(ds.series.length, 2);

    // Midpoint linear interpolation at t = 0.25s
    const midV = sampleSeriesAtTime(ds.times, ds.series[0]!.values, 0.25);
    assert.ok(Math.abs(midV - 0.96) < 1e-6, `Expected 0.96, got ${midV}`);

    const bounds = computeSeriesYBounds(ds.series);
    assert.ok(bounds.yMin < 0 && bounds.yMax > 120.5);
    assert.equal(formatEngineeringValue(0), "0");
    assert.equal(formatEngineeringValue(12500), "12.5k");

    // Interactive 3D oscilloscope panel hit-testing
    assert.deepEqual(hitTestVrSimulationPanel(850, 50, ds.allVariables, 0), { kind: "run" });
    assert.deepEqual(hitTestVrSimulationPanel(1150, 50, ds.allVariables, 0), { kind: "toggle-layout" });
    assert.deepEqual(hitTestVrSimulationPanel(1340, 50, ds.allVariables, 0), { kind: "close" });
    assert.deepEqual(hitTestVrSimulationPanel(1080, 195, ds.allVariables, 0), {
      kind: "toggle-var",
      variable: "v_bus1",
    });
    assert.deepEqual(hitTestVrSimulationPanel(1080, 250, ds.allVariables, 0), {
      kind: "toggle-var",
      variable: "i_line",
    });
    const scrub = hitTestVrSimulationPanel(524, 400, ds.allVariables, 0);
    assert.equal(scrub?.kind, "scrub-plot");
    assert.ok(scrub && scrub.kind === "scrub-plot" && Math.abs(scrub.normT - 0.5) < 0.01);

    // SSR rendering when entering VR directly from Simulation Results view
    const doc = createCanonicalPolyglotDemoBoard();
    const simHtml = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        document: doc,
        mode: "spatial-3d",
        languageId: "pscad",
        initialActiveView: "simulation",
        simulationData: {
          variables: ["v_bus1", "i_line", "freq_hz"],
          selectedVariables: ["v_bus1", "i_line"],
          rows,
          status: { status: "completed" },
        },
      }),
    );
    assert.ok(simHtml.includes('data-active-view="simulation"'));
    assert.ok(simHtml.includes('data-language-id="pscad"'));
    assert.ok(simHtml.includes('data-testid="rotunda-toggle-simulation-panel"'));
  });

  test("2D↔VR Parity: port metadata preservation, atomic reconnect, transforms, multi-select batch ops, palette adapter & inspector wing", () => {
    // 1. extractNodePorts3D preserves connectorType, portSignature, isConjugated & direction
    const sigPorts = extractNodePorts3D(
      {
        id: "R_meta",
        x: 0,
        y: 0,
        width: 80,
        height: 56,
        ports: {
          items: [
            {
              id: "p",
              group: "electrical",
              args: { x: 6, y: 28 },
              connectorType: "Modelica.Electrical.Analog.Interfaces.PositivePin",
              direction: "inout",
              isConjugated: false,
              portSignature: {
                variables: [
                  { name: "v", type: "Real", kind: "potential" },
                  { name: "i", type: "Real", kind: "flow" },
                ],
              },
            } as never,
          ],
        },
      },
      0.148,
      0.104,
    );
    assert.equal(sigPorts.length, 1);
    assert.equal(sigPorts[0]!.connectorType, "Modelica.Electrical.Analog.Interfaces.PositivePin");
    assert.equal(sigPorts[0]!.isConjugated, false);
    assert.equal(sigPorts[0]!.portSignature?.variables.length, 2);

    // 2. Atomic reconnect emits a single `reconnect` DiagramEditAction
    const baseState = createSpatialDiagramStateFromTile(null);
    const firstEdge = baseState.edges[0]!;
    const reconnected = commitReconnectSpatialEdge(baseState, firstEdge.id!, "V1", "n", "C1", "p", "#38bdf8");
    assert.equal(reconnected.actions.length, 1);
    assert.equal(reconnected.actions[0]!.type, "reconnect");
    const recAct = reconnected.actions[0]! as Extract<(typeof reconnected.actions)[number], { type: "reconnect" }>;
    assert.equal(recAct.edgeId, firstEdge.id);
    assert.equal(recAct.newTarget, "C1");
    assert.equal(recAct.newTargetPort, "p");

    // 3. Rotate, Flip, Resize, Duplicate, and Multi-Select Batch Move/Delete
    const rotated = commitRotateSpatialNode(baseState, "R1", 90);
    assert.equal(rotated.actions[0]!.type, "rotate");
    assert.equal((rotated.actions[0]! as { item: { rotation?: number } }).item.rotation, 90);

    const flipped = commitFlipSpatialNode(rotated.state, "R1", "x");
    assert.equal(flipped.actions[0]!.type, "rotate");
    assert.equal((flipped.actions[0]! as { item: { flipX?: boolean } }).item.flipX, true);

    const resized = commitResizeSpatialNode(flipped.state, "R1", 120, 84);
    assert.equal(resized.actions[0]!.type, "resize");
    assert.equal((resized.actions[0]! as { item: { width: number } }).item.width, 120);

    const dupSingle = commitDuplicateSpatialNodes(baseState, ["R1"]);
    assert.equal(dupSingle.duplicatedNodeIds.length, 1);
    assert.equal(dupSingle.actions[0]!.type, "addComponent");

    const dupMulti = commitDuplicateSpatialNodes(baseState, ["V1", "R1"]);
    assert.equal(dupMulti.duplicatedNodeIds.length, 2);
    assert.equal(dupMulti.actions[0]!.type, "pasteSubgraph");

    const batchMove = commitMoveSpatialNodes(baseState, {
      R1: { position: [0.1, 0.2, 0], quaternion: [0, 0, 0, 1], scale: 1 },
      L1: { position: [0.3, 0.2, 0], quaternion: [0, 0, 0, 1], scale: 1 },
    });
    assert.equal(batchMove.actions.length, 1);
    assert.equal(batchMove.actions[0]!.type, "move");
    assert.equal((batchMove.actions[0]! as { items: unknown[] }).items.length, 2);

    const batchDel = commitDeleteSpatialNodes(baseState, ["R1", "L1"]);
    assert.equal(batchDel.actions.length, 1);
    assert.equal(batchDel.actions[0]!.type, "deleteComponents");
    assert.deepEqual((batchDel.actions[0]! as { names: string[] }).names, ["R1", "L1"]);

    // 4. diagramPaletteToGalleryCatalog adapts LSP DiagramPalette into Stockroom catalog items
    const adapted = diagramPaletteToGalleryCatalog(
      {
        categories: [
          {
            name: "Custom Blocks",
            items: [{ label: "MyGain", className: "MyLib.MyGain", description: "Custom gain block" }],
          },
        ],
      },
      "modelica",
      GALLERY_COMPONENTS.slice(0, 2),
    );
    assert.equal(adapted[0]!.fqn, "MyLib.MyGain");
    assert.equal(adapted[0]!.shortName, "MyGain");
    assert.equal(adapted.length, 3);

    // 5. Rotunda reducer supports left-docked Diagram Inspector wing without leaving Diagram view
    const initState = createInitialRotundaState({ activeView: "diagram" });
    const withWing = rotundaReducer(initState, { type: "toggleDiagramInspectorWing" });
    assert.equal(withWing.activeView, "diagram");
    assert.equal(withWing.diagramInspectorWingOpen, true);
  });

  test("Icon Layer Editor, Manual Edge Waypoint Routing (`moveEdge`), and 2D Drafting Aids (Align/Distribute/Nudge/SmartGuides/SolderDots)", () => {
    const baseState = createSpatialDiagramStateFromTile(null);

    // 1. Manual Edge Waypoint Routing (`moveEdge`)
    const edgeId = baseState.edges[0]!.id!;
    const addedWp = commitAddEdgeWaypoint(baseState, edgeId, [0.05, 0.12, 0]);
    assert.equal(addedWp.actions.length, 1);
    assert.equal(addedWp.actions[0]!.type, "moveEdge");
    const moveAct1 = addedWp.actions[0]! as Extract<(typeof addedWp.actions)[number], { type: "moveEdge" }>;
    assert.equal(moveAct1.edges[0]!.points.length, 1);

    const movedWp = commitMoveEdgeWaypoints(addedWp.state, edgeId, [
      [0.08, 0.15, 0],
      [0.14, 0.15, 0],
    ]);
    assert.equal(movedWp.actions[0]!.type, "moveEdge");
    const moveAct2 = movedWp.actions[0]! as Extract<(typeof movedWp.actions)[number], { type: "moveEdge" }>;
    assert.equal(moveAct2.edges[0]!.points.length, 2);

    const removedWp = commitRemoveEdgeWaypoint(movedWp.state, edgeId, 0);
    const moveAct3 = removedWp.actions[0]! as Extract<(typeof removedWp.actions)[number], { type: "moveEdge" }>;
    assert.equal(moveAct3.edges[0]!.points.length, 1);

    // 2. 2D Drafting Aids: Align, Distribute, Nudge, Smart Guides & Solder Dots
    const aligned = commitAlignSpatialNodes(baseState, ["V1", "R1", "L1"], "align-top");
    assert.equal(aligned.actions.length, 1);
    assert.equal(aligned.actions[0]!.type, "move");
    assert.equal(aligned.state.poses["V1"]!.position[1], aligned.state.poses["R1"]!.position[1]);
    assert.equal(aligned.state.poses["R1"]!.position[1], aligned.state.poses["L1"]!.position[1]);

    const distributed = commitAlignSpatialNodes(aligned.state, ["V1", "R1", "L1"], "distribute-horizontal");
    const xs = [
      distributed.state.poses["V1"]!.position[0],
      distributed.state.poses["R1"]!.position[0],
      distributed.state.poses["L1"]!.position[0],
    ].sort((a, b) => a - b);
    assert.ok(Math.abs(xs[1]! - xs[0]! - (xs[2]! - xs[1]!)) < 1e-6);

    const nudged = commitNudgeSpatialNodes(baseState, ["R1"], 0.05, -0.02);
    assert.equal(nudged.actions[0]!.type, "move");
    assert.ok(Math.abs(nudged.state.poses["R1"]!.position[0] - (baseState.poses["R1"]!.position[0] + 0.05)) < 1e-6);

    const targetX = baseState.poses["L1"]!.position[0];
    const sg = computeSpatialSmartGuides("R1", [targetX + 0.005, 0.25, 0], baseState.poses, 0.016);
    assert.equal(sg.snappedPos[0], targetX);
    assert.ok(sg.guides.some((g) => g.axis === "x" && g.coord === targetX));

    // Port junction counts for 3D solder dots (add a 3rd wire to Gnd.p)
    const withThirdWire = commitConnectSpatialPorts(baseState, "R1", "p", "Gnd", "p");
    const jCounts = computePortJunctionCounts(withThirdWire.state.edges);
    assert.ok((jCounts.get("Gnd::p") ?? 0) >= 3);

    // 3. Icon Layer Editor (`addIconPrimitive`, `updateIconPrimitive`, `reorderIconPrimitive`, `deleteIconPrimitive`)
    const addRect = commitAddIconPrimitive(baseState, "Rectangle");
    assert.equal(addRect.primitiveIndex, 0);
    assert.equal(addRect.actions[0]!.type, "addIconPrimitive");

    const addEllipse = commitAddIconPrimitive(addRect.state, "Ellipse");
    assert.equal(addEllipse.primitiveIndex, 1);

    const updatedIcon = commitUpdateIconPrimitive(addEllipse.state, 0, { lineThickness: 1.5 });
    assert.equal(updatedIcon.actions[0]!.type, "updateIconPrimitive");

    const reorderedIcon = commitReorderIconPrimitive(updatedIcon.state, 0, 1);
    assert.equal(reorderedIcon.actions[0]!.type, "reorderIconPrimitive");

    const deletedIcon = commitDeleteIconPrimitive(reorderedIcon.state, 1);
    assert.equal(deletedIcon.actions[0]!.type, "deleteIconPrimitive");
  });

  test("GlassLibraryNavigator3D state machine: depth stack, skeleton poses, remembered child path, sibling rotunda, and dual trigger/grab release", () => {
    // 1. Hierarchical fallback tree groups catalog by library -> package -> leaf components
    const libs = buildFallbackLibraryTree(GALLERY_COMPONENTS, "modelica");
    assert.ok(libs.length >= 1, "Expected at least one top-level library");
    let nav = createInitialGlassLibraryState(libs, "modelica");
    assert.equal(nav.activeDepth, 0);
    assert.equal(nav.levels.length, 1);

    // 2. Drill down Library -> Package -> remembers parent pushed back (-Z) & higher (+Y) with skeleton
    const firstLib = libs[0]!;
    const libChildren = firstLib.children ?? [];
    assert.ok(libChildren.length > 0);
    nav = drillIntoGlassNode(nav, firstLib, libChildren);
    assert.equal(nav.activeDepth, 1);
    assert.equal(nav.levels.length, 2);

    const posesAfterDrill = computeGlassStackPoses(nav.levels.length, nav.activeDepth);
    const parentPose = posesAfterDrill.find((p) => p.role === "ancestor");
    const activePose = posesAfterDrill.find((p) => p.role === "active");
    assert.ok(parentPose && activePose);
    assert.equal(parentPose.useSkeleton, true, "Pushed-out parent panel must use lightweight skeleton");
    assert.equal(activePose.useSkeleton, false);
    assert.ok(parentPose.position[1] > activePose.position[1], "Parent panel should be pushed higher (+Y)");
    assert.ok(parentPose.position[2] < activePose.position[2], "Parent panel should be pushed further back (-Z)");

    // Drill into a sub-package if present to test 3-level remembered grandchild path
    const subPkg = libChildren.find((c) => c.hasChildren && (c.children?.length ?? 0) > 0);
    if (subPkg) {
      nav = drillIntoGlassNode(nav, subPkg, subPkg.children ?? []);
      assert.equal(nav.activeDepth, 2);
      assert.equal(nav.levels.length, 3);
    }

    // 3. Step UP (Joystick Up) -> remembers child/grandchild path below (-Y, -Z) as skeleton panels!
    const depthBeforeUp = nav.activeDepth;
    nav = stepUpGlassHierarchy(nav);
    assert.equal(nav.activeDepth, depthBeforeUp - 1);
    assert.equal(nav.levels.length, depthBeforeUp + 1, "Remembered child path must be preserved on stepUp");

    const posesAfterUp = computeGlassStackPoses(nav.levels.length, nav.activeDepth);
    const childPose = posesAfterUp.find((p) => p.role === "descendant");
    const curPose = posesAfterUp.find((p) => p.role === "active");
    assert.ok(childPose && curPose);
    assert.equal(childPose.useSkeleton, true, "Remembered child panel must render as lightweight skeleton");
    assert.ok(childPose.position[1] < curPose.position[1], "Remembered child panel should be pushed lower (-Y)");
    assert.ok(childPose.position[2] < curPose.position[2], "Remembered child panel should be pushed further back (-Z)");

    // 4. Step DOWN (Joystick Down) -> immediately returns to remembered child without re-navigating!
    nav = stepDownGlassHierarchy(nav);
    assert.equal(nav.activeDepth, depthBeforeUp);

    // Jump directly to root and back down
    nav = jumpToGlassDepth(nav, 0);
    assert.equal(nav.activeDepth, 0);
    nav = stepDownGlassHierarchy(nav);
    assert.equal(nav.activeDepth, 1);

    // 5. Flanking Sibling Rotunda: packages vs leaf components flank left/right without occluding foreground
    const mixedParentItems = [
      treeNodeToGlassLibraryNode(
        { id: "pkgA", name: "Analog", classKind: "package", hasChildren: true },
        1,
        "modelica",
      ),
      treeNodeToGlassLibraryNode(
        { id: "pkgB", name: "Digital", classKind: "package", hasChildren: true },
        1,
        "modelica",
      ),
      treeNodeToGlassLibraryNode(
        {
          id: "compR",
          name: "Resistor",
          compositeName: "Modelica.Electrical.Analog.Basic.Resistor",
          classKind: "model",
          hasChildren: false,
        },
        1,
        "modelica",
      ),
      treeNodeToGlassLibraryNode(
        { id: "pkgC", name: "Machines", classKind: "package", hasChildren: true },
        1,
        "modelica",
      ),
    ];
    const rotSlots = computeSiblingRotundaSlots(mixedParentItems, "pkgB", 1);
    assert.equal(rotSlots.length, 3, "Active sibling should be omitted; 3 siblings should flank in rotunda");
    const leftSlot = rotSlots.find((s) => s.node.id === "pkgA");
    const rightComp = rotSlots.find((s) => s.node.id === "compR");
    assert.ok(leftSlot && leftSlot.side === "left" && leftSlot.position[0] < -0.5 && leftSlot.isContainer === true);
    assert.ok(
      rightComp && rightComp.side === "right" && rightComp.position[0] > 0.5 && rightComp.isContainer === false,
    );

    // Smooth rotunda panning & sibling switching
    const panStep = stepSiblingRotundaPan(1, 0, 1, 0, mixedParentItems.length, 0.1);
    assert.ok(panStep.panIndex > 1, "Positive stickX should pan rotunda right");

    const switched = switchToSiblingContainer(
      drillIntoGlassNode(createInitialGlassLibraryState(mixedParentItems), mixedParentItems[0]!, []),
      mixedParentItems[1]!,
      [],
    );
    assert.equal(switched.levels[switched.activeDepth]?.parentId, "pkgB");

    // 6. 2D grid scrolling & hit testing
    const manyItems = Array.from({ length: 20 }, (_, i) =>
      treeNodeToGlassLibraryNode({ id: `c${i}`, name: `Comp${i}`, classKind: "model", hasChildren: false }, 1),
    );
    const maxScroll = computeMaxScrollRow(manyItems.length);
    assert.equal(maxScroll, 2); // 5 rows total - 3 visible rows
    const sc = stepGlassGridScroll(0, 0, 1, 0, maxScroll, 0.1);
    assert.ok(sc.scrollRow > 0 && sc.scrollRow <= maxScroll);
    const layout = buildGlassPanelLayout(manyItems, 0, true, true, 2);
    const firstTile = layout.zones.find((z) => z.kind === "tile");
    assert.ok(firstTile);
    const hit = hitTestGlassPanel(layout, firstTile.x + 10, firstTile.y + 10);
    assert.equal(hit?.kind, "tile");
    assert.equal(hit?.node?.id, "c0");

    // 7. Dual Select (trigger) AND Grab (squeeze) release binding support
    assert.equal(
      releaseEventForBinding({
        kind: "ray",
        pointerId: 1,
        handedness: "right",
        inputSource: null,
        isHand: false,
        hitDistance: 1,
        releaseEvent: "squeezeend",
      }),
      "squeezeend",
      "Far-field grab squeeze must release on squeezeend",
    );
    assert.equal(
      releaseEventForBinding({
        kind: "ray",
        pointerId: 1,
        handedness: "right",
        inputSource: null,
        isHand: false,
        hitDistance: 1,
      }),
      "selectend",
      "Far-field trigger select must release on selectend",
    );

    // 8. Option A Smooth Behind-Panel Bridge: crossing delta=0 glides continuously without X-jump & recesses Z
    const bridgeNeg = computeSiblingRotundaSlots(mixedParentItems, "pkgB", 0.02).find((s) => s.node.id === "pkgA")!;
    const bridgeZero = computeSiblingRotundaSlots(mixedParentItems, "pkgB", 0.0).find((s) => s.node.id === "pkgA")!;
    const bridgePos = computeSiblingRotundaSlots(mixedParentItems, "pkgB", -0.02).find((s) => s.node.id === "pkgA")!;
    assert.ok(
      Math.abs(bridgeNeg.position[0] - bridgePos.position[0]) < 0.15,
      "Option A bridge must cross center smoothly without teleporting",
    );
    assert.ok(bridgeZero.position[2] < leftSlot.position[2], "Bridge crossing must recess behind the foreground panel");
    assert.ok(bridgeZero.opacity < 0.35, "Bridge crossing should dip opacity behind the glass panel");

    // 9. Magnetic tile lock prevents Quest controller tremor from slipping into tile gaps
    const m1 = stepGlassTileMagnetLock(INITIAL_GLASS_TILE_MAGNET_STATE, 3, 0.016);
    assert.equal(m1.next.lockedTileIndex, 3);
    const m2 = stepGlassTileMagnetLock(m1.next, null, 0.1);
    assert.equal(m2.next.lockedTileIndex, 3, "Must hold tile lock during brief 100ms slip into gap");
    const m3 = stepGlassTileMagnetLock(m2.next, 4, 0.08);
    assert.equal(m3.next.lockedTileIndex, 4, "Sustained dwell >= 60ms switches lock cleanly");

    // 10. Root language filter strip, recents tray, head-relative anchor, glide transition & 3D tile hologram coords
    const polyRoot = [
      treeNodeToGlassLibraryNode(
        { id: "l1", name: "SysML", classKind: "package", hasChildren: true, language: "sysml2" },
        0,
      ),
      treeNodeToGlassLibraryNode(
        { id: "l2", name: "Modelica", classKind: "package", hasChildren: true, language: "modelica" },
        0,
      ),
      treeNodeToGlassLibraryNode(
        { id: "l3", name: "SPICE", classKind: "package", hasChildren: true, language: "spice" },
        0,
      ),
    ];
    const langs = extractAvailableLanguages(polyRoot, "modelica");
    assert.equal(langs[0], "modelica", "Active diagram language must be pinned first");
    assert.equal(filterRootLibrariesByLanguage(polyRoot, "sysml2").length, 1);

    let recents = recordRecentComponent([], GALLERY_COMPONENTS[0]!);
    recents = recordRecentComponent(recents, GALLERY_COMPONENTS[1]!);
    recents = recordRecentComponent(recents, GALLERY_COMPONENTS[0]!);
    assert.equal(recents.length, 2, "Recents must deduplicate and move latest to front");
    assert.equal(recents[0]!.id, GALLERY_COMPONENTS[0]!.id);

    const anchor = computeHeadRelativeAnchor([1.2, 1.65, -0.4], [1, 0, 0]);
    assert.ok(Math.abs(anchor.yawRad + Math.PI / 2) < 1e-4, "Head looking +X should yaw panel to face user");

    const drillStart = computeActivePanelTransitionOffset("drill", 0);
    const drillDone = computeActivePanelTransitionOffset("drill", 0.3);
    assert.ok(drillStart.scale < 1 && drillStart.dz < 0 && drillDone.settled);

    const tile3D = computeTileLocalCenter3D(layout, 0, 0);
    assert.ok(
      tile3D !== null && tile3D[0] < 0 && tile3D[1] > 0,
      "Tile 0 hologram must project to top-left of curved panel",
    );

    // 11. All 11 upgrades: O(1) rotunda atlas UVs, pinned shoulder dock, local search & VR keyboard,
    //     open-port compatibility, starred persistence & sorting, spec peek, bezel clamp, bare-hand swipe/tether, parallax glint
    const uv0 = computeRotundaAtlasUvRect(0);
    const uv9 = computeRotundaAtlasUvRect(9);
    assert.ok(uv0.u0 >= 0 && uv0.u1 <= 0.21 && uv9.u1 <= 1 && uv9.vBot >= 0);

    const pinParked = computePinnedPanelOffset(true, true);
    const pinCenter = computePinnedPanelOffset(true, false);
    assert.ok(pinParked.dx < -0.4 && pinParked.yawRad > 0.2 && pinCenter.dx === 0);

    const found = searchLocalLibraryTree(libs, "resistor", 10);
    assert.ok(found.length >= 1, "Local tree search should find Resistor");
    const kb = buildVrKeyboardLayout();
    assert.ok(kb.length === 30);
    assert.equal(hitTestVrKeyboard(kb, kb[0]!.x + 5, kb[0]!.y + 5)?.key, "Q");

    const resistorLeaf = found.find((n) => !n.hasChildren);
    assert.ok(resistorLeaf && isNodeCompatibleWithOpenPorts(resistorLeaf, ["electrical"]));
    assert.equal(isNodeCompatibleWithOpenPorts(resistorLeaf!, ["thermal"]), false);

    const starred = toggleStarredNodeId(new Set(), "l3");
    const sorted = sortNodesWithStarredFirst(polyRoot, starred);
    assert.equal(sorted[0]!.id, "l3", "Starred library must sort first");

    const spec = formatNodeSpecPeek(resistorLeaf!);
    assert.ok(spec.portsLabel.includes("Ports:") && spec.paramsLabel.length > 0);

    const clamped = clampBezelRepositionOffset(5, -5, 5);
    assert.ok(clamped.dx <= 1.2 && clamped.dy >= -0.55 && clamped.dz <= 0.45);

    const swipe = evaluateBareHandSwipe(0.12, 0.01, 0.05);
    assert.ok(swipe.rotundaPanImpulse < 0, "Rightward bare-hand air-swipe should pan rotunda");
    assert.equal(evaluateTetherPullStep(0.1), -1);
    assert.equal(evaluateTetherPullStep(-0.1), 1);

    const glint = computeHeadParallaxGlintOffset(0.5, 1.6, 0, 1.36);
    assert.ok(glint.glintX > 0 && glint.glintY > 0);

    // 12. Refinements: live LSP parameter spec peek & Reveal-in-Hierarchy ancestor resolution
    const liveSpec = formatNodeSpecPeek(resistorLeaf!, [
      { name: "R", value: "100", unit: "Ohm" },
      { name: "T_ref", value: "300.15", unit: "K" },
    ]);
    assert.ok(liveSpec.paramsLabel.includes("R=100 Ohm") && liveSpec.paramsLabel.includes("T_ref=300.15 K"));

    const ancPath = findAncestorPathInLocalTree(libs, resistorLeaf!.fqn);
    assert.ok(ancPath && ancPath.length >= 1, "Must resolve ancestor path in local tree for Reveal-in-Hierarchy");
    assert.deepEqual(splitFqnAncestorPrefixes("Modelica.Electrical.Analog.Basic.Resistor"), [
      "Modelica",
      "Modelica.Electrical",
      "Modelica.Electrical.Analog",
      "Modelica.Electrical.Analog.Basic",
    ]);
  });
});
