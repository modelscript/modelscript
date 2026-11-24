// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCanonicalPolyglotDemoBoard,
  serializeCanvasDocument,
  SpatialSurfaceBridge,
  type CanvasDocument,
  type SurfacePresentationMode,
} from "@modelscript/canvas";
import { CURATED_OPEN_MODELS } from "@modelscript/editor/workbench/openModelCatalog.js";
import {
  boardBoundsToPlaneBounds,
  buildPodiumSpatialPlane,
  buildRotundaCanvasDocument,
  computeCarouselSlotTransform,
  createInitialRotundaState,
  EngineeringRotunda,
  extractModelsFromCanvasDocument,
  getEnvironmentSceneBackdrop,
  getRotundaScenarioById,
  planeUvToBoard,
  PODIUM_CENTER,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  ROTUNDA_ENVIRONMENTS,
  ROTUNDA_SHOWCASE_MODELS,
  ROTUNDA_SHOWCASE_SCENARIOS,
  rotundaReducer,
  type RotundaCaeOverlay,
  type RotundaClipAxis,
  type RotundaEnvironmentId,
  type RotundaModelKind,
  type RotundaRenderStyle,
} from "@modelscript/editor/workbench/vr-rotunda/index.js";
import { evaluatePinchState } from "@modelscript/editor/workbench/vr-rotunda/xr-gestures.js";
import { SHARED_XR_STORE_CONFIG } from "@modelscript/editor/workbench/vr-rotunda/xr-session.js";
import { parseUrdf } from "@modelscript/urdf";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import * as THREE from "three";
import { MultibodyViewport3D } from "../src/components/artifacts/MultibodyViewport3D.js";
import {
  buildArtifactRotundaDocument,
  parseRotundaEnvironmentId,
  parseSurfacePresentationMode,
} from "../src/components/artifacts/rotunda-board-adapter.js";
import {
  buildLiveArtifactRotundaRenderer,
  clearArtifactRotundaGeometryRegistry,
  computeSnapshotFitTransform,
  getArtifactRotundaGeometry,
  registerArtifactRotundaGeometry,
  useArtifactRotundaGeometry,
  type ArtifactRotundaGeometrySnapshot,
} from "../src/components/artifacts/RotundaGeometryBridge.js";
import { SpatialCanvasArtifactViewer } from "../src/components/artifacts/SpatialCanvasArtifactViewer.js";
import { XrViewportOverlay } from "../src/components/artifacts/XrViewportOverlay.js";
import { HERO_EXAMPLES } from "../src/pages/playground/constants.js";
import SpatialCanvasPage from "../src/pages/SpatialCanvasPage.js";

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm3(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function assertClose(actual: number, expected: number, eps = 1e-6, message?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${message ? `${message}: ` : ""}expected ${actual} to be within ${eps} of ${expected}`,
  );
}

describe("Engineering Rotunda — Environments, Reducer, Geometry, Carousel, SSR & JSDOM", () => {
  test("All 5 environment presets and getEnvironmentSceneBackdrop return expected metadata and backdrops", () => {
    const expectedIds: RotundaEnvironmentId[] = ["warehouse", "office", "outdoors", "dark-lab", "passthrough"];
    assert.deepEqual(
      ROTUNDA_ENVIRONMENTS.map((e) => e.id),
      expectedIds,
    );

    for (const meta of ROTUNDA_ENVIRONMENTS) {
      assert.ok(meta.label.length > 0, `Environment ${meta.id} must have a label`);
      assert.ok(meta.shortLabel.length > 0, `Environment ${meta.id} must have a shortLabel`);
      assert.ok(meta.description.length > 0, `Environment ${meta.id} must have a description`);
      assert.ok(meta.accentColor.startsWith("#"), `Environment ${meta.id} accentColor must be hex`);
      assert.ok(meta.orbColor.startsWith("#"), `Environment ${meta.id} orbColor must be hex`);
      assert.ok(meta.skyColor.length > 0, `Environment ${meta.id} skyColor must be non-empty`);
    }

    assert.deepEqual(getEnvironmentSceneBackdrop("warehouse"), { background: "#141923", isLight: false });
    assert.deepEqual(getEnvironmentSceneBackdrop("office"), { background: "#d6e4f0", isLight: true });
    assert.deepEqual(getEnvironmentSceneBackdrop("outdoors"), { background: "#8ec5f8", isLight: true });
    assert.deepEqual(getEnvironmentSceneBackdrop("dark-lab"), { background: "#050914", isLight: false });
    assert.deepEqual(getEnvironmentSceneBackdrop("passthrough"), { background: null, isLight: false });
  });

  test("rotundaReducer handles orbital paging wrap-around and shortest-path selectModelIndex", () => {
    let state = createInitialRotundaState();
    assert.equal(state.activeModelIndex, 0);
    assert.equal(state.carouselStep, 0);

    // Zero-model guard
    assert.equal(rotundaReducer(state, { type: "pageModel", delta: 1, modelCount: 0 }), state);
    assert.equal(rotundaReducer(state, { type: "selectModelIndex", index: 1, modelCount: 0 }), state);

    // Wrap backward from 0 -> 2 on a 3-model carousel while carouselStep decrements smoothly
    state = rotundaReducer(state, { type: "pageModel", delta: -1, modelCount: 3 });
    assert.equal(state.activeModelIndex, 2);
    assert.equal(state.carouselStep, -1);

    // Wrap forward from 2 -> 0 while carouselStep returns to 0
    state = rotundaReducer(state, { type: "pageModel", delta: 1, modelCount: 3 });
    assert.equal(state.activeModelIndex, 0);
    assert.equal(state.carouselStep, 0);

    // Shortest-path orbital selection on a 5-model track
    // From 0 -> 4 should step -1 (shortest path backward) rather than +4
    state = rotundaReducer(state, { type: "selectModelIndex", index: 4, modelCount: 5 });
    assert.equal(state.activeModelIndex, 4);
    assert.equal(state.carouselStep, -1);

    // From 4 -> 0 should step +1 (shortest path forward) rather than -4
    state = rotundaReducer(state, { type: "selectModelIndex", index: 0, modelCount: 5 });
    assert.equal(state.activeModelIndex, 0);
    assert.equal(state.carouselStep, 0);

    // From 0 -> 2 should step +2
    state = rotundaReducer(state, { type: "selectModelIndex", index: 2, modelCount: 5 });
    assert.equal(state.activeModelIndex, 2);
    assert.equal(state.carouselStep, 2);

    // Selecting current index is a no-op
    assert.equal(rotundaReducer(state, { type: "selectModelIndex", index: 2, modelCount: 5 }), state);
  });

  test("rotundaReducer enforces clamping, overlays, section cut, scale, podium tilt, playback & resetPlinthView", () => {
    let state = createInitialRotundaState();

    // Environment switching
    for (const env of ROTUNDA_ENVIRONMENTS) {
      state = rotundaReducer(state, { type: "setEnvironment", environment: env.id });
      assert.equal(state.environment, env.id);
    }

    // Plinth yaw & zoom clamping ([0.35, 3.0])
    state = rotundaReducer(state, { type: "rotatePlinth", deltaYaw: Math.PI / 2 });
    assertClose(state.plinthYaw, Math.PI / 2);
    state = rotundaReducer(state, { type: "setPlinthYaw", yaw: -1.25 });
    assertClose(state.plinthYaw, -1.25);

    state = rotundaReducer(state, { type: "adjustZoom", delta: 10 });
    assert.equal(state.plinthZoom, 3.0);
    state = rotundaReducer(state, { type: "adjustZoom", delta: -10 });
    assert.equal(state.plinthZoom, 0.35);
    state = rotundaReducer(state, { type: "setZoom", zoom: Number.NaN });
    assert.equal(state.plinthZoom, 0.35);
    state = rotundaReducer(state, { type: "setZoom", zoom: 1.75 });
    assert.equal(state.plinthZoom, 1.75);

    // Explode clamping ([0, 1])
    state = rotundaReducer(state, { type: "setExplode", factor: 2.5 });
    assert.equal(state.explodeFactor, 1);
    state = rotundaReducer(state, { type: "setExplode", factor: -0.4 });
    assert.equal(state.explodeFactor, 0);
    state = rotundaReducer(state, { type: "setExplode", factor: 0.62 });
    assertClose(state.explodeFactor, 0.62);

    // CAE overlays
    const overlays: RotundaCaeOverlay[] = ["fea-stress", "cfd-flow", "thermal", "none"];
    for (const overlay of overlays) {
      state = rotundaReducer(state, { type: "setCaeOverlay", overlay });
      assert.equal(state.caeOverlay, overlay);
    }

    // Render styles
    const styles: RotundaRenderStyle[] = ["wireframe", "xray", "shaded"];
    for (const style of styles) {
      state = rotundaReducer(state, { type: "setRenderStyle", style });
      assert.equal(state.renderStyle, style);
    }

    // Section cut toggle, axes, and offset clamping ([-1, 1])
    assert.equal(state.sectionCutEnabled, false);
    state = rotundaReducer(state, { type: "toggleSectionCut" });
    assert.equal(state.sectionCutEnabled, true);
    for (const axis of ["x", "y", "z"] as RotundaClipAxis[]) {
      state = rotundaReducer(state, { type: "setSectionCutAxis", axis });
      assert.equal(state.sectionCutAxis, axis);
    }
    state = rotundaReducer(state, { type: "setSectionCutOffset", offset: 4 });
    assert.equal(state.sectionCutOffset, 1);
    state = rotundaReducer(state, { type: "setSectionCutOffset", offset: -4 });
    assert.equal(state.sectionCutOffset, -1);
    state = rotundaReducer(state, { type: "setSectionCutOffset", offset: 0.35 });
    assertClose(state.sectionCutOffset, 0.35);

    // Tabletop <-> 1:1 scale toggle
    assert.equal(state.scaleMode, "tabletop");
    state = rotundaReducer(state, { type: "toggleScaleMode" });
    assert.equal(state.scaleMode, "real-scale");
    state = rotundaReducer(state, { type: "toggleScaleMode" });
    assert.equal(state.scaleMode, "tabletop");
    state = rotundaReducer(state, { type: "setScaleMode", mode: "real-scale" });
    assert.equal(state.scaleMode, "real-scale");

    // 45° <-> flat (12°) podium tilt and visibility toggles
    assert.equal(state.podiumTiltDeg, 45);
    state = rotundaReducer(state, { type: "togglePodiumTilt" });
    assert.equal(state.podiumTiltDeg, 12);
    state = rotundaReducer(state, { type: "togglePodiumTilt" });
    assert.equal(state.podiumTiltDeg, 45);

    state = rotundaReducer(state, { type: "togglePodiumVisible" });
    assert.equal(state.podiumVisible, false);
    state = rotundaReducer(state, { type: "toggleWingsVisible" });
    assert.equal(state.wingsVisible, false);

    // Simulation playback advance, modulo wrap, and paused no-op
    state = rotundaReducer(state, { type: "setSimulationTime", time: 9.5 });
    assertClose(state.simulationTime, 9.5);
    state = rotundaReducer(state, { type: "advanceSimulationTime", delta: 1.25 });
    assertClose(state.simulationTime, 0.75);
    state = rotundaReducer(state, { type: "advanceSimulationTime", delta: -1.0 });
    assertClose(state.simulationTime, 9.75);
    state = rotundaReducer(state, { type: "togglePlaying" });
    assert.equal(state.isPlaying, false);
    const pausedState = rotundaReducer(state, { type: "advanceSimulationTime", delta: 2.0 });
    assert.equal(pausedState, state);
    state = rotundaReducer(state, { type: "setPlaying", playing: true });
    assert.equal(state.isPlaying, true);
    state = rotundaReducer(state, { type: "setSimulationTime", time: 999 });
    assert.equal(state.simulationTime, state.simulationDuration);

    // Tile selection
    state = rotundaReducer(state, { type: "selectTile", tileId: "tile_step" });
    assert.equal(state.selectedTileId, "tile_step");

    // resetPlinthView resets view transforms while preserving environment & tile selection
    state = rotundaReducer(state, { type: "setEnvironment", environment: "warehouse" });
    state = rotundaReducer(state, { type: "resetPlinthView" });
    assert.equal(state.plinthYaw, 0);
    assert.equal(state.plinthZoom, 1);
    assert.equal(state.explodeFactor, 0);
    assert.equal(state.sectionCutEnabled, false);
    assert.equal(state.sectionCutOffset, 0);
    assert.equal(state.environment, "warehouse");
    assert.equal(state.selectedTileId, "tile_step");
  });

  test("buildPodiumSpatialPlane(45) satisfies orthonormal basis, 45° tilt, center UV, and ray intersection invariants", () => {
    const plane = buildPodiumSpatialPlane(45);
    assert.equal(plane.id, "podium");

    // Unit-length vectors
    assertClose(norm3(plane.right), 1, 1e-12, "right unit length");
    assertClose(norm3(plane.down), 1, 1e-12, "down unit length");
    assertClose(norm3(plane.normal), 1, 1e-12, "normal unit length");

    // Mutual orthogonality
    assertClose(dot3(plane.right, plane.down), 0, 1e-12, "right ⟂ down");
    assertClose(dot3(plane.right, plane.normal), 0, 1e-12, "right ⟂ normal");
    assertClose(dot3(plane.down, plane.normal), 0, 1e-12, "down ⟂ normal");

    // Right-handed frame: right × (-down) === normal
    const negDown: [number, number, number] = [-plane.down[0], -plane.down[1], -plane.down[2]];
    const computedNormal = cross3(plane.right, negDown);
    assertClose(computedNormal[0], plane.normal[0], 1e-12, "normal.x");
    assertClose(computedNormal[1], plane.normal[1], 1e-12, "normal.y");
    assertClose(computedNormal[2], plane.normal[2], 1e-12, "normal.z");

    // Exact 45° dot product of normal with +Y and +Z
    assertClose(dot3(plane.normal, [0, 1, 0]), Math.SQRT1_2, 1e-12, "normal · +Y = cos(45°)");
    assertClose(dot3(plane.normal, [0, 0, 1]), Math.SQRT1_2, 1e-12, "normal · +Z = cos(45°)");

    // Center UV maps back exactly to PODIUM_CENTER
    const bridge = new SpatialSurfaceBridge(plane);
    const centerU = ROTUNDA_BOARD_CANVAS_WIDTH / 2;
    const centerV = ROTUNDA_BOARD_CANVAS_HEIGHT / 2;
    const centerWorld = bridge.planeUVToWorld3D("podium", centerU, centerV);
    assert.ok(centerWorld, "Expected valid 3D world point for podium center UV");
    assertClose(centerWorld[0], PODIUM_CENTER[0], 1e-9, "center X");
    assertClose(centerWorld[1], PODIUM_CENTER[1], 1e-9, "center Y");
    assertClose(centerWorld[2], PODIUM_CENTER[2], 1e-9, "center Z");

    // Ray cast along -normal from 1.5m above PODIUM_CENTER hits exact center UV at distance 1.5m
    const rayDistance = 1.5;
    const rayOrigin: [number, number, number] = [
      PODIUM_CENTER[0] + plane.normal[0] * rayDistance,
      PODIUM_CENTER[1] + plane.normal[1] * rayDistance,
      PODIUM_CENTER[2] + plane.normal[2] * rayDistance,
    ];
    const rayDir: [number, number, number] = [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
    const hit = bridge.castRay(rayOrigin, rayDir);
    assert.ok(hit && hit.hit, "Expected ray to intersect 45° podium center");
    assert.equal(hit.planeId, "podium");
    assertClose(hit.distance, rayDistance, 1e-9, "ray distance");
    assertClose(hit.u, centerU, 1e-6, "hit U");
    assertClose(hit.v, centerV, 1e-6, "hit V");

    // Board <-> plane UV coordinate transform round-trip
    const planeBounds = boardBoundsToPlaneBounds({ x: 120, y: 240, width: 400, height: 300 });
    const recovered = planeUvToBoard(planeBounds.x, planeBounds.y);
    assertClose(recovered.x, 120, 1e-9);
    assertClose(recovered.y, 240, 1e-9);
  });

  test("computeCarouselSlotTransform centers slot 0, mirrors -1/+1 symmetrically, and fades out ±2", () => {
    const center = computeCarouselSlotTransform(0);
    assert.deepEqual(center.position, [0, 0, 0]);
    assert.equal(center.scale, 1);
    assert.equal(center.opacity, 1);
    assert.equal(center.yaw, 0);

    const left = computeCarouselSlotTransform(-1);
    const right = computeCarouselSlotTransform(1);
    assertClose(left.position[0], -right.position[0], 1e-12, "symmetric X");
    assert.ok(left.position[0] < 0 && right.position[0] > 0, "-1 at 10 o'clock (X<0), +1 at 2 o'clock (X>0)");
    assertClose(left.position[1], right.position[1], 1e-12, "symmetric Y");
    assertClose(left.position[2], right.position[2], 1e-12, "symmetric Z");
    assert.ok(left.position[2] < 0, "side slots curve backward behind center plinth");
    assertClose(left.scale, right.scale, 1e-12, "symmetric scale");
    assert.ok(left.scale > 0.3 && left.scale < 0.7, "side slots scaled down relative to hero");
    assertClose(left.opacity, right.opacity, 1e-12, "symmetric opacity");
    assert.ok(left.opacity > 0.2 && left.opacity < 0.8, "side slots translucent preview");
    assertClose(left.yaw, -right.yaw, 1e-12, "symmetric yaw");

    const farLeft = computeCarouselSlotTransform(-2);
    const farRight = computeCarouselSlotTransform(2);
    assert.equal(farLeft.opacity, 0);
    assert.equal(farRight.opacity, 0);
  });

  test("buildRotundaCanvasDocument & extractModelsFromCanvasDocument synthesize boards and carousel fallbacks", () => {
    const synthesized = buildRotundaCanvasDocument({
      title: "Rocket Gimbal Actuator",
      languageId: "modelica",
      artifactUri: "/models/gimbal.mo",
      diagramData: { nodes: [{ id: "n1", label: "PID" }], edges: [] },
      parameters: [
        { name: "kp", value: 12.5, unit: "N*m/rad" },
        { name: "J_rotor", value: 0.042, unit: "kg*m2" },
      ],
    });

    assert.equal(Object.keys(synthesized.tiles).length, 4);
    assert.equal(Object.keys(synthesized.wires).length, 3);
    assert.ok(synthesized.tiles["tile_primary_schematic"]);
    assert.ok(synthesized.tiles["tile_primary_cad"]);
    assert.ok(synthesized.tiles["tile_primary_plot"]);
    assert.ok(synthesized.tiles["tile_primary_params"]);
    assert.equal(synthesized.tiles["tile_primary_params"]?.pinnedAnchors?.[0]?.path, "kp");
    assert.equal(synthesized.tiles["tile_primary_params"]?.pinnedAnchors?.[0]?.currentValue, "12.5 N*m/rad");

    // Single cad3d tile expands with FEA & CFD companion twins so orbital paging always has >= 3 models
    const models = extractModelsFromCanvasDocument(synthesized);
    assert.equal(models.length, 3);
    assert.equal(models[0]?.sourceTileId, "tile_primary_cad");
    assert.equal(models[1]?.kind, "fea");
    assert.equal(models[2]?.kind, "cfd");

    // Empty board falls back cleanly to 3 default showcase models
    const emptyBoard: CanvasDocument = {
      ...createCanonicalPolyglotDemoBoard(),
      tiles: {},
      wires: {},
    };
    const fallbackModels = extractModelsFromCanvasDocument(emptyBoard);
    assert.equal(fallbackModels.length, 3);
    assert.deepEqual(
      fallbackModels.map((m) => m.kind),
      ["cad", "fea", "cfd"],
    );

    // Adapter helper extracts Modelica parameters and honors valid inline `.mscanvas` docs
    const fromCode = buildArtifactRotundaDocument({
      title: "Thermal Plant",
      viewType: "modelica",
      viewConfig: {
        code: "model ThermalPlant\n  parameter Real R = 12.5;\n  parameter Real C = 0.05;\nend ThermalPlant;",
      },
    });
    const anchorPaths = (fromCode.tiles["tile_primary_params"]?.pinnedAnchors ?? []).map((a) => a.path);
    assert.ok(anchorPaths.includes("R"));
    assert.ok(anchorPaths.includes("C"));

    assert.equal(parseRotundaEnvironmentId("OFFICE"), "office");
    assert.equal(parseRotundaEnvironmentId("unknown-env", "warehouse"), "warehouse");
    assert.equal(parseSurfacePresentationMode("webxr-vr"), "webxr-vr");
    assert.equal(parseSurfacePresentationMode("invalid", "desktop-2d"), "desktop-2d");
  });

  test("SSR renderToStaticMarkup renders EngineeringRotunda across all modes and all 5 environments cleanly", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const modes: SurfacePresentationMode[] = ["spatial-3d", "webxr-vr"];
    const envs: RotundaEnvironmentId[] = ["warehouse", "office", "outdoors", "dark-lab", "passthrough"];

    for (const mode of modes) {
      for (const env of envs) {
        const html = renderToStaticMarkup(
          React.createElement(EngineeringRotunda, {
            document: board,
            mode,
            initialEnvironment: env,
            simulationTime: 1.5,
            onExitTo2D: () => undefined,
          }),
        );
        assert.ok(html.includes('data-testid="spatial-vr-surface"'), `Missing surface root for ${mode}/${env}`);
        assert.ok(html.includes(`data-surface-mode="${mode}"`), `Missing mode attr for ${mode}/${env}`);
        assert.ok(html.includes(`data-rotunda-env="${env}"`), `Missing env attr for ${mode}/${env}`);
        assert.ok(html.includes('data-testid="rotunda-carousel-bar"'), `Missing carousel bar for ${mode}/${env}`);
        assert.ok(html.includes('data-testid="rotunda-control-dock"'), `Missing control dock for ${mode}/${env}`);
        assert.ok(html.includes("Return to 2D Canvas"), `Missing exit button for ${mode}/${env}`);
      }
    }
  });

  test("SSR renderToStaticMarkup renders SpatialCanvasArtifactViewer and XrViewportOverlay with zero errors", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const serialized = serializeCanvasDocument(board);

    // 1. SpatialCanvasArtifactViewer default 2D mode from serialized `.mscanvas` code
    const html2d = renderToStaticMarkup(
      React.createElement(SpatialCanvasArtifactViewer, {
        artifactId: 42,
        viewConfig: { code: serialized, title: "Demo Actuator Canvas" },
        isFullScreen: false,
      }),
    );
    assert.ok(html2d.includes('data-testid="spatial-canvas-artifact-viewer"'));
    assert.ok(html2d.includes('data-surface-mode="desktop-2d"'));
    assert.ok(html2d.includes('data-testid="shared-scissor-3d-host"'));
    assert.ok(html2d.includes('data-testid="spatial-canvas-mode-switcher"'));

    // 2. SpatialCanvasArtifactViewer in spatial-3d & webxr-vr modes
    const html3d = renderToStaticMarkup(
      React.createElement(SpatialCanvasArtifactViewer, {
        viewConfig: { document: board, surfaceMode: "spatial-3d", environment: "office" },
        isFullScreen: true,
      }),
    );
    assert.ok(html3d.includes('data-surface-mode="spatial-3d"'));
    assert.ok(html3d.includes('data-rotunda="engineering-rotunda"'));
    assert.ok(html3d.includes('data-rotunda-env="office"'));

    const htmlVr = renderToStaticMarkup(
      React.createElement(SpatialCanvasArtifactViewer, {
        viewConfig: { canvas: board },
        initialMode: "webxr-vr",
      }),
    );
    assert.ok(htmlVr.includes('data-surface-mode="webxr-vr"'));
    assert.ok(htmlVr.includes('data-rotunda="engineering-rotunda"'));

    // 3. XrViewportOverlay default (no WebXR in SSR & no Rotunda callback -> renders empty/null)
    const emptyOverlay = renderToStaticMarkup(React.createElement(XrViewportOverlay, {}));
    assert.equal(emptyOverlay, "");

    // 4. XrViewportOverlay with VR + MR capabilities and VR Rotunda callback
    const activeOverlay = renderToStaticMarkup(
      React.createElement(XrViewportOverlay, {
        position: "top-right",
        onOpenVrRotunda: () => undefined,
        capabilitiesOverride: { vrSupported: true, arSupported: true, checked: true },
      }),
    );
    assert.ok(activeOverlay.includes('data-testid="xr-viewport-overlay"'));
    assert.ok(activeOverlay.includes('data-xr-position="top-right"'));
    assert.ok(activeOverlay.includes("Enter VR"));
    assert.ok(activeOverlay.includes(">MR<"));
    assert.ok(activeOverlay.includes("VR Rotunda"));
  });

  test("JSDOM renders EngineeringRotunda cleanly using fallback Canvas2D board painter with zero React hook errors", async () => {
    const board = createCanonicalPolyglotDemoBoard();
    const { JSDOM } = await import("jsdom");
    const { createRoot } = await import("react-dom/client");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");

    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevPath2D = (globalThis as { Path2D?: unknown }).Path2D;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    const prevConsoleError = console.error;
    const consoleErrors: string[] = [];
    const drawnTexts: string[] = [];

    class MockPath2D {
      public readonly path: string;
      constructor(d?: string) {
        this.path = d ?? "";
      }
    }

    const mockCtx = {
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      globalAlpha: 1,
      font: "12px sans-serif",
      textAlign: "left",
      textBaseline: "middle",
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      clip: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      rect: () => undefined,
      roundRect: () => undefined,
      arc: () => undefined,
      ellipse: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      fillText: (text: string) => {
        drawnTexts.push(text);
      },
      setLineDash: () => undefined,
    };

    try {
      console.error = (...args: unknown[]) => {
        consoleErrors.push(args.map((a) => String(a)).join(" "));
      };
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
        value: (contextId: string) => (contextId === "2d" ? mockCtx : null),
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = MockPath2D;

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          React.createElement(EngineeringRotunda, {
            document: board,
            mode: "webxr-vr",
            initialEnvironment: "dark-lab",
            simulationTime: 2.25,
            onExitTo2D: () => undefined,
          }),
        );
      });

      const surfaceEl = container.querySelector('[data-testid="spatial-vr-surface"]');
      const fallbackCanvas = container.querySelector(
        '[data-testid="spatial-vr-fallback-canvas"]',
      ) as HTMLCanvasElement | null;
      assert.ok(surfaceEl && fallbackCanvas, "Expected fallback Canvas2D surface inside JSDOM");
      assert.equal(fallbackCanvas.width, ROTUNDA_BOARD_CANVAS_WIDTH);
      assert.equal(fallbackCanvas.height, ROTUNDA_BOARD_CANVAS_HEIGHT);
      assert.equal(surfaceEl.getAttribute("data-rotunda-env"), "dark-lab");
      assert.ok(drawnTexts.length > 0, "Expected paintBoardToTextureCanvas to paint board labels");
      assert.ok(drawnTexts.includes("ActuatorPlant"), "Expected UnifiedGraph schematic label painted on board canvas");

      // Interactive environment switch via dock pill button
      const outdoorsBtn = container.querySelector('[data-testid="rotunda-env-outdoors"]') as HTMLButtonElement | null;
      assert.ok(outdoorsBtn, "Expected Outdoors environment pill button");
      await React.act(async () => {
        outdoorsBtn.click();
      });
      assert.equal(surfaceEl.getAttribute("data-rotunda-env"), "outdoors");

      // Interactive carousel next button
      const initialActiveModel = surfaceEl.getAttribute("data-active-model");
      const nextBtn = container.querySelector('button[aria-label="Next 3D model"]') as HTMLButtonElement | null;
      assert.ok(nextBtn, "Expected Next 3D model button");
      await React.act(async () => {
        nextBtn.click();
      });
      assert.notEqual(surfaceEl.getAttribute("data-active-model"), initialActiveModel);

      assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${consoleErrors.join("; ")}`);

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      console.error = prevConsoleError;
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = prevPath2D;
      dom.window.close();
    }
  });

  test("rotunda-geometry-bridge enforces LRU cap of 12, safe unregister, 0.78m sphere fit, and custom R3F renderers for all 4 kinds", () => {
    clearArtifactRotundaGeometryRegistry();

    const makeGcodeSnap = (x: number): ArtifactRotundaGeometrySnapshot => ({
      kind: "gcode-path",
      cutSegments: [
        [0, 0, 0],
        [x, x, x],
      ],
      rapidSegments: [],
    });

    // 1. Register 14 entries -> oldest 2 ("k0", "k1") must be evicted (LRU cap = 12)
    for (let i = 0; i < 14; i++) {
      registerArtifactRotundaGeometry(`k${i}`, makeGcodeSnap(i + 1));
    }
    assert.equal(getArtifactRotundaGeometry("k0"), null);
    assert.equal(getArtifactRotundaGeometry("k1"), null);
    assert.ok(getArtifactRotundaGeometry("k2"));
    assert.ok(getArtifactRotundaGeometry("k13"));

    // 2. Refresh "k2" recency, then insert "k14" -> "k3" should be evicted while "k2" survives
    const refreshedK2 = makeGcodeSnap(200);
    const unregK2 = registerArtifactRotundaGeometry("k2", refreshedK2);
    registerArtifactRotundaGeometry("k14", makeGcodeSnap(15));
    assert.equal(getArtifactRotundaGeometry("k3"), null);
    assert.equal(getArtifactRotundaGeometry("k2"), refreshedK2);

    // 3. Stale unregister after overwrite does NOT remove the newer entry; current unregister DOES
    const newerK2 = makeGcodeSnap(201);
    const unregNewerK2 = registerArtifactRotundaGeometry("k2", newerK2);
    unregK2();
    assert.equal(getArtifactRotundaGeometry("k2"), newerK2);
    unregNewerK2();
    assert.equal(getArtifactRotundaGeometry("k2"), null);

    // 4. Verify 0.78m sphere fit math & buildLiveArtifactRotundaRenderer across all 4 snapshot kinds
    const boxGeo = new THREE.BoxGeometry(100, 100, 100);
    const stepSnap: ArtifactRotundaGeometrySnapshot = {
      kind: "step-meshes",
      parts: [
        { name: "Housing", geometry: boxGeo, offset: [50, 20, -10], colorRgba: [0.22, 0.74, 0.97, 1] },
        { name: "Rotor", geometry: boxGeo, offset: [150, 20, -10], colorRgba: [0.96, 0.62, 0.04, 1] },
      ],
    };
    const stepFit = computeSnapshotFitTransform(stepSnap);
    const scaledDiag = Math.hypot(
      stepFit.size[0] * stepFit.scale,
      stepFit.size[1] * stepFit.scale,
      stepFit.size[2] * stepFit.scale,
    );
    assertClose(scaledDiag, 0.78, 1e-6, "STEP bounding box fits inside 0.78m sphere");
    assert.ok(stepFit.targetCenterY - (stepFit.size[1] * stepFit.scale) / 2 >= 0.019, "Sits above plinth top");

    const feaGeo = new THREE.BoxGeometry(40, 10, 10);
    feaGeo.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(new Float32Array(feaGeo.getAttribute("position").count * 3).fill(0.8), 3),
    );
    const feaSnap: ArtifactRotundaGeometrySnapshot = {
      kind: "fea-mesh",
      geometry: feaGeo,
      wireframePositions: new Float32Array([0, 0, 0, 40, 0, 0]),
    };
    const feaFit = computeSnapshotFitTransform(feaSnap);
    assertClose(
      Math.hypot(feaFit.size[0] * feaFit.scale, feaFit.size[1] * feaFit.scale, feaFit.size[2] * feaFit.scale),
      0.78,
      1e-6,
      "FEA mesh fits inside 0.78m sphere",
    );

    const gcodeSnap: ArtifactRotundaGeometrySnapshot = {
      kind: "gcode-path",
      cutSegments: [
        [0, 0, 0],
        [80, 0, 0],
        [80, 0, 0],
        [80, 40, 20],
      ],
      rapidSegments: [
        [80, 40, 20],
        [0, 40, 20],
      ],
    };

    const multibodySnap: ArtifactRotundaGeometrySnapshot = {
      kind: "multibody",
      nodes: [
        { id: "base", label: "Base", position: [0, 0, 0], color: "#38bdf8", radius: 0.1 },
        { id: "arm", label: "Arm", position: [2, 1, 0], color: "#f59e0b", radius: 0.08 },
      ],
      links: [{ from: [0, 0, 0], to: [2, 1, 0], color: "#94a3b8" }],
    };

    const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.1);
    for (const snap of [stepSnap, feaSnap, gcodeSnap, multibodySnap]) {
      const renderFn = buildLiveArtifactRotundaRenderer(snap);
      const element = renderFn({ explodeFactor: 0.45, simulationTime: 1.75, clippingPlanes: [clipPlane] });
      assert.ok(React.isValidElement(element), `Expected valid React element for snapshot kind=${snap.kind}`);
    }

    boxGeo.dispose();
    feaGeo.dispose();
    clearArtifactRotundaGeometryRegistry();
  });

  test("useArtifactRotundaGeometry reacts to live registrations and MultibodyViewport3D retains geometry across unmount", async () => {
    clearArtifactRotundaGeometryRegistry();
    const { JSDOM } = await import("jsdom");
    const { createRoot } = await import("react-dom/client");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");

    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

    try {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });

      const Observer = ({ bridgeKey }: { bridgeKey: string | number }): React.ReactElement => {
        const snap = useArtifactRotundaGeometry(bridgeKey);
        return React.createElement("div", {
          "data-testid": "bridge-observer",
          "data-kind": snap?.kind ?? "none",
          "data-node-count": snap?.kind === "multibody" ? String(snap.nodes.length) : "0",
        });
      };

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(Observer, { bridgeKey: "artifact-mb-77" }),
            React.createElement(MultibodyViewport3D, {
              geometryBridgeKey: "artifact-mb-77",
              nodes: [
                { id: "n1", name: "Carbody", type: "body", position: [0, 1.2, 0] },
                { id: "n2", name: "BogieFront", type: "wheelset", position: [4.5, 0.4, 0] },
              ],
              links: [
                {
                  id: "l1",
                  name: "SecondarySpring",
                  type: "spring_damper",
                  from: [0, 1.2, 0],
                  to: [4.5, 0.4, 0],
                },
              ],
            }),
          ),
        );
      });

      const obsBeforeUnmount = container.querySelector('[data-testid="bridge-observer"]');
      assert.ok(obsBeforeUnmount);
      assert.equal(obsBeforeUnmount.getAttribute("data-kind"), "multibody");
      assert.equal(obsBeforeUnmount.getAttribute("data-node-count"), "2");

      // Unmount MultibodyViewport3D (simulating switching viewer slot -> EngineeringRotunda) and verify geometry stays alive
      await React.act(async () => {
        root.render(React.createElement(Observer, { bridgeKey: "artifact-mb-77" }));
      });

      const obsAfterUnmount = container.querySelector('[data-testid="bridge-observer"]');
      assert.ok(obsAfterUnmount);
      assert.equal(obsAfterUnmount.getAttribute("data-kind"), "multibody");
      assert.equal(obsAfterUnmount.getAttribute("data-node-count"), "2");

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      clearArtifactRotundaGeometryRegistry();
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      dom.window.close();
    }
  });

  test("ROTUNDA_SHOWCASE_MODELS contains all 9 unique multi-domain models with valid kinds and titles", () => {
    assert.equal(ROTUNDA_SHOWCASE_MODELS.length, 9, "Expected exactly 9 curated VR showcase models");

    const validKinds = new Set<RotundaModelKind>([
      "cad",
      "fea",
      "cfd",
      "multibody",
      "gcode",
      "step",
      "urdf",
      "vtk",
      "drone",
      "wind-turbine",
      "satellite",
      "ev-battery",
      "generic",
    ]);

    const seenIds = new Set<string>();
    const seenKinds = new Set<RotundaModelKind>();

    for (const model of ROTUNDA_SHOWCASE_MODELS) {
      assert.ok(model.id.trim().length > 0, "Showcase model must have non-empty id");
      assert.ok(!seenIds.has(model.id), `Duplicate showcase model id: ${model.id}`);
      seenIds.add(model.id);

      assert.ok(model.title.trim().length > 0, `Model ${model.id} must have non-empty title`);
      assert.ok(validKinds.has(model.kind), `Model ${model.id} has invalid RotundaModelKind '${model.kind}'`);
      seenKinds.add(model.kind);
    }

    for (const requiredKind of ["drone", "wind-turbine", "satellite", "ev-battery"] as const) {
      assert.ok(seenKinds.has(requiredKind), `Expected ROTUNDA_SHOWCASE_MODELS to include kind '${requiredKind}'`);
    }
  });

  test("ROTUNDA_SHOWCASE_SCENARIOS exposes all 5 scenarios with 4+ tile boards, live wires, valid environments, and >= 4 models", () => {
    const expectedScenarioIds = [
      "all-showcase",
      "aerospace-proving-ground",
      "robotics-warehouse",
      "ev-thermal-studio",
      "orbital-spacecraft",
    ];
    assert.deepEqual(
      ROTUNDA_SHOWCASE_SCENARIOS.map((s) => s.id),
      expectedScenarioIds,
    );

    const validEnvs = new Set<RotundaEnvironmentId>(ROTUNDA_ENVIRONMENTS.map((e) => e.id));

    for (const scenario of ROTUNDA_SHOWCASE_SCENARIOS) {
      assert.ok(scenario.label.trim().length > 0, `Scenario ${scenario.id} must have a label`);
      assert.ok(scenario.shortLabel.trim().length > 0, `Scenario ${scenario.id} must have a shortLabel`);
      assert.ok(
        validEnvs.has(scenario.recommendedEnvironment),
        `Scenario ${scenario.id} has invalid recommendedEnvironment '${scenario.recommendedEnvironment}'`,
      );
      assert.ok(
        scenario.models.length >= 4,
        `Scenario ${scenario.id} must have >= 4 models, got ${scenario.models.length}`,
      );
      assert.equal(getRotundaScenarioById(scenario.id)?.id, scenario.id);
      assert.equal(getRotundaScenarioById(` ${scenario.id.toUpperCase()} `)?.id, scenario.id);

      const board = scenario.createDocument();
      const tileCount = Object.keys(board.tiles).length;
      const wireCount = Object.keys(board.wires).length;
      assert.ok(tileCount >= 4, `Scenario ${scenario.id} board must have >= 4 tiles, got ${tileCount}`);
      assert.ok(wireCount >= 3, `Scenario ${scenario.id} board must have live wires, got ${wireCount}`);
    }

    assert.equal(getRotundaScenarioById("non-existent-scenario"), undefined);
    assert.equal(getRotundaScenarioById(null), undefined);
  });

  test("EngineeringRotunda renders scenario selector in SSR and SpatialCanvasPage honors ?scenario= without breaking #vrBoard= handoffs", () => {
    const aeroScenario = getRotundaScenarioById("aerospace-proving-ground");
    assert.ok(aeroScenario);

    // 1. EngineeringRotunda renders data-testid="rotunda-scenario-select" when scenarios are passed
    const rotundaHtml = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        document: aeroScenario.createDocument(),
        models: aeroScenario.models,
        scenarios: ROTUNDA_SHOWCASE_SCENARIOS,
        activeScenarioId: aeroScenario.id,
        mode: "spatial-3d",
        initialEnvironment: aeroScenario.recommendedEnvironment,
        onExitTo2D: () => undefined,
      }),
    );
    assert.ok(rotundaHtml.includes('data-testid="rotunda-scenario-select"'));
    assert.ok(rotundaHtml.includes('data-active-scenario="aerospace-proving-ground"'));
    assert.ok(rotundaHtml.includes('data-rotunda-env="outdoors"'));
    assert.ok(rotundaHtml.includes("Drone &amp; Wind Proving Ground"));

    // 2. Default /canvas?mode=spatial-3d loads all 9 showcase models + header scenario switcher
    const defaultCanvasHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/canvas?mode=spatial-3d"] },
        React.createElement(SpatialCanvasPage),
      ),
    );
    assert.ok(defaultCanvasHtml.includes('data-testid="canvas-scenario-select"'));
    assert.ok(defaultCanvasHtml.includes('data-testid="rotunda-scenario-select"'));
    assert.ok(defaultCanvasHtml.includes('data-active-scenario="all-showcase"'));
    assert.ok(defaultCanvasHtml.includes("Model 1/9"));

    // 3. /canvas?mode=spatial-3d&scenario=aerospace-proving-ground honors scenario board, models & outdoors env
    const aeroCanvasHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/canvas?mode=spatial-3d&scenario=aerospace-proving-ground"] },
        React.createElement(SpatialCanvasPage),
      ),
    );
    assert.ok(aeroCanvasHtml.includes('data-active-scenario="aerospace-proving-ground"'));
    assert.ok(aeroCanvasHtml.includes('data-rotunda-env="outdoors"'));
    assert.ok(aeroCanvasHtml.includes('data-active-model="showcase-drone"'));
    assert.ok(aeroCanvasHtml.includes("Flight Attitude &amp; Wind Energy Proving Ground"));

    // 4. #vrBoard= handoff preserves custom board & models without showcase override
    const handoffBoard = createCanonicalPolyglotDemoBoard();
    handoffBoard.id = "custom-handoff-rotunda-99";
    handoffBoard.name = "Custom Cryo Pump Handoff";
    handoffBoard.tiles = {
      tile_custom_cad: {
        id: "tile_custom_cad",
        title: "Cryo Pump Impeller CAD",
        archetype: "cad3d",
        languageId: "step",
        artifactUri: "cryo/impeller.step",
        bounds: { x: 40, y: 40, width: 520, height: 360 },
        zIndex: 1,
        viewState: {},
      },
    };
    handoffBoard.wires = {};
    const bytes = new TextEncoder().encode(serializeCanvasDocument(handoffBoard));
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]!);
    }
    const encoded = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

    const handoffHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [`/canvas?mode=webxr-vr&env=warehouse&scenario=aerospace-proving-ground#vrBoard=${encoded}`],
        },
        React.createElement(SpatialCanvasPage),
      ),
    );
    assert.ok(handoffHtml.includes("Custom Cryo Pump Handoff"));
    assert.ok(handoffHtml.includes("VR Handoff · Local Mode"));
    assert.ok(handoffHtml.includes('data-rotunda-env="warehouse"'));
    assert.ok(handoffHtml.includes('data-active-model="tile-model-tile_custom_cad"'));
    assert.ok(!handoffHtml.includes('data-active-model="showcase-drone"'));
  });

  test("Ansatz Playground HERO_EXAMPLES includes all 4 VR-ready multi-physics templates", () => {
    const requiredTemplates = [
      { id: "urdf-hexacopter-drone", lang: "urdf", snippet: "<robot name=" },
      { id: "modelica-wind-turbine", lang: "modelica", snippet: "model OffshoreWindTurbine5MW" },
      { id: "modelica-ev-battery-cooling", lang: "modelica", snippet: "model EVBatteryPackCooling800V" },
      { id: "modelica-orbital-satellite", lang: "modelica", snippet: "model OrbitalSatelliteADCS" },
    ] as const;

    for (const req of requiredTemplates) {
      const found = HERO_EXAMPLES.find((ex) => ex.id === req.id);
      assert.ok(found, `Missing playground template '${req.id}' in HERO_EXAMPLES`);
      assert.equal(found.lang, req.lang, `Expected template '${req.id}' to have lang '${req.lang}'`);
      assert.ok(found.code.includes(req.snippet), `Expected template '${req.id}' code to include '${req.snippet}'`);
    }

    const drone = HERO_EXAMPLES.find((ex) => ex.id === "urdf-hexacopter-drone");
    assert.ok(drone);
    const parsedRobot = parseUrdf(drone.code);
    assert.equal(parsedRobot.name, "autonomous_hexacopter_uav");
    assert.equal(parsedRobot.links.size, 16);
    assert.equal(parsedRobot.joints.size, 15);
    const continuousRotors = Array.from(parsedRobot.joints.values()).filter((j) => j.type === "continuous");
    assert.equal(continuousRotors.length, 6, "Expected 6 continuous hexacopter rotor joints");
  });

  test("SHARED_XR_STORE_CONFIG explicitly requests immersive-vr, enables Quest hand tracking, foveation, and all hand pointers", () => {
    assert.equal(
      SHARED_XR_STORE_CONFIG.offerSession,
      "immersive-vr",
      "SHARED_XR_STORE_CONFIG.offerSession must explicitly request 'immersive-vr' and never default to passthrough AR",
    );
    assert.equal(SHARED_XR_STORE_CONFIG.handTracking, true, "Quest bare-hand tracking must be enabled");
    assert.ok(
      typeof SHARED_XR_STORE_CONFIG.foveation === "number" && SHARED_XR_STORE_CONFIG.foveation > 0,
      "Foveated rendering must be enabled (foveation > 0)",
    );

    const handConfig = SHARED_XR_STORE_CONFIG.hand;
    assert.ok(
      typeof handConfig === "object" && handConfig !== null,
      "Expected hand configuration object on SHARED_XR_STORE_CONFIG",
    );
    assert.equal(handConfig.rayPointer, true, "hand.rayPointer must be enabled");
    assert.equal(handConfig.touchPointer, true, "hand.touchPointer must be enabled");
    assert.equal(handConfig.teleportPointer, true, "hand.teleportPointer must be enabled");
  });

  test("evaluatePinchState honors Schmitt hysteresis (engages <= 0.024m, holds at 0.030m, releases >= 0.036m)", () => {
    // Disengaged -> engages below 0.024m (and at 0.024m boundary), stays false in deadband and above
    assert.equal(evaluatePinchState(0.05, false), false);
    assert.equal(evaluatePinchState(0.03, false), false);
    assert.equal(evaluatePinchState(0.023, false), true);
    assert.equal(evaluatePinchState(0.024, false), true);

    // Engaged -> holds pinch inside the hysteresis band (0.030m), releases above 0.036m (and at 0.036m boundary)
    assert.equal(evaluatePinchState(0.02, true), true);
    assert.equal(evaluatePinchState(0.03, true), true);
    assert.equal(evaluatePinchState(0.035, true), true);
    assert.equal(evaluatePinchState(0.036, true), false);
    assert.equal(evaluatePinchState(0.04, true), false);

    // Non-finite or negative distances never falsely report a pinch
    assert.equal(evaluatePinchState(Number.NaN, true), false);
    assert.equal(evaluatePinchState(-0.01, false), false);
  });

  test("CURATED_OPEN_MODELS preserves chua-circuit first and bundles all 5 VR 3D showcase models with fallback code and SVGs", () => {
    assert.equal(CURATED_OPEN_MODELS[0]?.id, "chua-circuit", "chua-circuit must remain index 0");

    const requiredVrModels = [
      {
        id: "vr-hexacopter-drone",
        dialect: "urdf",
        dialectLabel: "URDF",
        suggestedFilename: "HexacopterDrone.urdf",
        snippet: '<robot name="autonomous_hexacopter_uav">',
      },
      {
        id: "vr-wind-turbine",
        dialect: "modelica",
        dialectLabel: "Modelica",
        suggestedFilename: "WindTurbine5MW.mo",
        snippet: "model OffshoreWindTurbine5MW",
      },
      {
        id: "vr-ev-battery-cooling",
        dialect: "modelica",
        dialectLabel: "Modelica",
        suggestedFilename: "EvBatteryCooling.mo",
        snippet: "model EVBatteryPackCooling800V",
      },
      {
        id: "vr-orbital-satellite",
        dialect: "modelica",
        dialectLabel: "Modelica",
        suggestedFilename: "OrbitalSatelliteBus.mo",
        snippet: "model OrbitalSatelliteADCS",
      },
      {
        id: "vr-step-aerospace-bracket",
        dialect: "step",
        dialectLabel: "STEP",
        suggestedFilename: "AerospaceBracket.step",
        snippet: "MANIFOLD_SOLID_BREP('AerospaceBracket'",
      },
    ] as const;

    for (const req of requiredVrModels) {
      const entry = CURATED_OPEN_MODELS.find((m) => m.id === req.id);
      assert.ok(entry, `Missing VR showcase model '${req.id}' in CURATED_OPEN_MODELS`);
      assert.equal(entry.dialect, req.dialect, `Unexpected dialect for '${req.id}'`);
      assert.equal(entry.dialectLabel, req.dialectLabel, `Unexpected dialectLabel for '${req.id}'`);
      assert.equal(entry.suggestedFilename, req.suggestedFilename, `Unexpected filename for '${req.id}'`);
      assert.equal(entry.bundledByDefault, true, `Expected '${req.id}' to have bundledByDefault: true`);
      assert.ok(entry.fallbackCode.trim().length > 0, `Expected non-empty fallbackCode for '${req.id}'`);
      assert.ok(
        entry.fallbackCode.includes(req.snippet),
        `Expected '${req.id}' fallbackCode to contain '${req.snippet}'`,
      );
      assert.ok(
        entry.diagramSvg.trim().length > 0 && entry.diagramSvg.includes("<svg") && entry.diagramSvg.includes("</svg>"),
        `Expected valid inline SVG diagramSvg for '${req.id}'`,
      );
      for (const kw of ["vr", "rotunda", "3d"] as const) {
        assert.ok(entry.keywords.includes(kw), `Expected keyword '${kw}' on '${req.id}'`);
      }
    }

    const vrDrone = CURATED_OPEN_MODELS.find((m) => m.id === "vr-hexacopter-drone");
    assert.ok(vrDrone);
    const parsedVrDrone = parseUrdf(vrDrone.fallbackCode);
    assert.equal(parsedVrDrone.links.size, 16);
    assert.equal(parsedVrDrone.joints.size, 15);
  });
});
