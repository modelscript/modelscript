// SPDX-License-Identifier: AGPL-3.0-or-later

import { composeTransformMatrixDirect, sampleTelemetryFrame } from "@modelscript/cad";
import {
  createCanonicalPolyglotDemoBoard,
  serializeCanvasDocument,
  SpatialSurfaceBridge,
  type CanvasDocument,
  type SurfacePresentationMode,
} from "@modelscript/canvas";
import {
  createDefaultAssemblyVisibility,
  inferSubsystemsFromPartNames,
  resolvePartPresentation,
} from "@modelscript/editor/workbench/cad-viewer/assembly-visibility.js";
import { extractCadComponents } from "@modelscript/editor/workbench/cad-viewer/parse-cad-annotations.js";
import { getLanguageInfo } from "@modelscript/editor/workbench/constants.js";
import { CURATED_OPEN_MODELS } from "@modelscript/editor/workbench/openModelCatalog.js";
import {
  boardBoundsToPlaneBounds,
  buildPodiumSpatialPlane,
  buildRightSubsystemChipLayouts,
  buildRotundaCanvasDocument,
  computeCarouselSlotTransform,
  computeGeometryCaeVertexColors,
  createBrushedAluminumPbr,
  createCaeFieldGradientTexture,
  createHonedTravertinePbr,
  createInitialRotundaState,
  createKnurledMetalNormalMap,
  createMeadowGrassPbr,
  createPolishedConcretePbr,
  createRadialContactShadowTexture,
  createRotundaEnvironmentHdri,
  EngineeringRotunda,
  evaluateOctopusArm3DetachFactor,
  extractModelsFromCanvasDocument,
  getEnvironmentSceneBackdrop,
  getRotundaScenarioById,
  getTileMaximizeButtonRect,
  isLoadableGltfUri,
  LEFT_VIEW_PILLS,
  OCTOPUS_ARM_DORSAL_WHEEL_COUNTS,
  OCTOPUS_ARM_SEGMENT_COUNTS,
  OCTOPUS_HUD_SPEC,
  OCTOPUS_PISTON_COUNT,
  OCTOPUS_SUBSYSTEMS,
  OCTOPUS_TOTAL_SEGMENTS,
  OCTOPUS_TOTAL_WHEELS,
  paintBoardToTextureCanvas,
  planeUvToBoard,
  PODIUM_BACK_BTN_RECT,
  PODIUM_CENTER,
  PODIUM_HEADER_HEIGHT,
  PODIUM_NEXT_TILE_BTN_RECT,
  PODIUM_PREV_TILE_BTN_RECT,
  pointInPodiumRect,
  resolveRotundaRenderPolicy,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  ROTUNDA_ENVIRONMENTS,
  ROTUNDA_SHOWCASE_MODELS,
  ROTUNDA_SHOWCASE_SCENARIOS,
  rotundaReducer,
  sampleCaeFieldRgb,
  sampleOctopusTelemetryChannel,
  type RotundaCaeOverlay,
  type RotundaClipAxis,
  type RotundaEnvironmentId,
  type RotundaModelKind,
  type RotundaRenderStyle,
} from "@modelscript/editor/workbench/vr-rotunda/index.js";
import { evaluatePinchState } from "@modelscript/editor/workbench/vr-rotunda/xr-gestures.js";
import {
  enterXrSession,
  exitXrSession,
  formatXrSessionError,
  pulseXrHaptics,
  SHARED_XR_STORE_CONFIG,
} from "@modelscript/editor/workbench/vr-rotunda/xr-session.js";
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
  resolveDefaultArtifactEnvironment,
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

    assert.deepEqual(getEnvironmentSceneBackdrop("warehouse"), { background: "#cfd9e6", isLight: true });
    assert.deepEqual(getEnvironmentSceneBackdrop("office"), { background: "#e8eef5", isLight: true });
    assert.deepEqual(getEnvironmentSceneBackdrop("outdoors"), { background: "#8ec5f8", isLight: true });
    assert.deepEqual(getEnvironmentSceneBackdrop("dark-lab"), { background: "#050914", isLight: false });
    assert.deepEqual(getEnvironmentSceneBackdrop("passthrough"), { background: null, isLight: false });
  });

  test("rotundaReducer handles orbital paging wrap-around and shortest-path selectModelIndex", () => {
    let state = createInitialRotundaState();
    assert.equal(state.environment, "outdoors");
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
    assert.equal(parseRotundaEnvironmentId("unknown-env"), "outdoors");
    assert.equal(parseRotundaEnvironmentId("unknown-env", "warehouse"), "warehouse");
    assert.equal(resolveDefaultArtifactEnvironment("step"), "warehouse");
    assert.equal(resolveDefaultArtifactEnvironment("cad3d"), "warehouse");
    assert.equal(resolveDefaultArtifactEnvironment("fea"), "warehouse");
    assert.equal(resolveDefaultArtifactEnvironment("cfd"), "warehouse");
    assert.equal(resolveDefaultArtifactEnvironment("gcode"), "warehouse");
    assert.equal(resolveDefaultArtifactEnvironment("modelica", { filename: "bracket.step" }), "warehouse");
    assert.equal(resolveDefaultArtifactEnvironment("modelica"), "outdoors");
    assert.equal(resolveDefaultArtifactEnvironment("spatial-canvas"), "outdoors");
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
    assert.ok(htmlVr.includes('data-rotunda-env="outdoors"'));

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

  test("ROTUNDA_SHOWCASE_MODELS contains all 10 unique multi-domain models with valid kinds and titles", () => {
    assert.equal(ROTUNDA_SHOWCASE_MODELS.length, 10, "Expected exactly 10 curated VR showcase models");

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
      "octopus-rov",
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

    for (const requiredKind of ["drone", "wind-turbine", "satellite", "ev-battery", "octopus-rov"] as const) {
      assert.ok(seenKinds.has(requiredKind), `Expected ROTUNDA_SHOWCASE_MODELS to include kind '${requiredKind}'`);
    }
  });

  test("ROTUNDA_SHOWCASE_SCENARIOS exposes all 6 scenarios with 4+ tile boards, live wires, valid environments, and >= 4 models", () => {
    const expectedScenarioIds = [
      "all-showcase",
      "subsea-octopus",
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

    // 2. Default /canvas?mode=spatial-3d loads all 10 showcase models + header scenario switcher
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
    assert.ok(defaultCanvasHtml.includes("Model 1/10"));

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

  test("OpenSCAD enables Diagram + 3D modes, VR Rotunda accepts data:model/gltf URIs, and HERO_EXAMPLES includes all VR 3D showcase starters", () => {
    const scadInfo = getLanguageInfo("scad");
    assert.equal(scadInfo.supportsDiagram, true, "OpenSCAD must support Diagram mode in browser view");
    assert.equal(scadInfo.supports3d, true, "OpenSCAD must support 3D mode");
    assert.equal(scadInfo.defaultView, "3d", "OpenSCAD should default to 3D view");

    assert.equal(
      isLoadableGltfUri("data:model/gltf-binary;base64,Z2xURg=="),
      true,
      "VR Rotunda must accept tessellated data:model/gltf-binary URIs for STEP and SCAD models",
    );
    assert.equal(isLoadableGltfUri("data:model/gltf+json;base64,e30="), true);
    assert.equal(isLoadableGltfUri("procedural://msl/box"), false);

    const vrTagged = HERO_EXAMPLES.filter((ex) => ex.tags?.some((t) => t.toLowerCase() === "vr"));
    assert.ok(vrTagged.length >= 9, `Expected >= 9 VR-tagged HERO_EXAMPLES, got ${vrTagged.length}`);
    for (const requiredId of [
      "scad-flanged-hub",
      "scad-harmonic-servo",
      "scad-hexacopter-frame",
      "scad-turbofan-shroud",
      "step-aerospace-bracket",
      "urdf-hexacopter-drone",
      "modelica-wind-turbine",
      "modelica-ev-battery-cooling",
      "modelica-orbital-satellite",
    ] as const) {
      assert.ok(
        vrTagged.some((ex) => ex.id === requiredId),
        `Expected VR-tagged HERO_EXAMPLES to contain '${requiredId}'`,
      );
    }
  });

  test("resolveRotundaRenderPolicy enforces stereo-safety in WebXR while enabling full studio fidelity on desktop", () => {
    const desktop = resolveRotundaRenderPolicy(false);
    assert.equal(desktop.enablePmremIbl, true);
    assert.equal(desktop.enableSsao, true);
    assert.equal(desktop.enableDynamicShadows, true);
    assert.equal(desktop.calloutLabelMode, "dom");
    assert.equal(desktop.jetParticleBudget, 3600);

    const vr = resolveRotundaRenderPolicy(true);
    assert.equal(vr.enablePmremIbl, true);
    assert.equal(vr.enableSsao, false);
    assert.equal(vr.enableDynamicShadows, false);
    assert.equal(vr.calloutLabelMode, "sprite");
    assert.equal(vr.jetParticleBudget, 1000);
  });

  test("rotundaReducer handles subsystem isolation, ghost-shell, 3D labels, auto-turntable, and telemetry wing", () => {
    let state = createInitialRotundaState();
    assert.equal(state.isolatedSubsystemId, null);
    assert.equal(state.ghostShellEnabled, false);
    assert.equal(state.showLabels, false);
    assert.equal(state.autoTurntable, false);
    assert.equal(state.telemetryWingEnabled, false);

    state = rotundaReducer(state, { type: "setIsolatedSubsystem", subsystemId: "pump-core" });
    assert.equal(state.isolatedSubsystemId, "pump-core");
    // Tapping the same subsystem toggles back to Hero (null)
    state = rotundaReducer(state, { type: "setIsolatedSubsystem", subsystemId: "pump-core" });
    assert.equal(state.isolatedSubsystemId, null);

    state = rotundaReducer(state, { type: "setIsolatedSubsystem", subsystemId: "arm-chains" });
    state = rotundaReducer(state, { type: "toggleGhostShell" });
    state = rotundaReducer(state, { type: "toggleShowLabels" });
    state = rotundaReducer(state, { type: "toggleAutoTurntable" });
    state = rotundaReducer(state, { type: "toggleTelemetryWing" });
    assert.equal(state.ghostShellEnabled, true);
    assert.equal(state.showLabels, true);
    assert.equal(state.autoTurntable, true);
    assert.equal(state.telemetryWingEnabled, true);

    state = rotundaReducer(state, { type: "setTelemetryWing", enabled: false });
    assert.equal(state.telemetryWingEnabled, false);
    assert.equal(state.studioSsaoEnabled, false);
    state = rotundaReducer(state, { type: "toggleStudioSsao" });
    assert.equal(state.studioSsaoEnabled, true);
    state = rotundaReducer(state, { type: "setStudioSsao", enabled: false });
    assert.equal(state.studioSsaoEnabled, false);

    // Paging models clears subsystem isolation
    state = rotundaReducer(state, { type: "pageModel", delta: 1, modelCount: 10 });
    assert.equal(state.isolatedSubsystemId, null);

    // resetPlinthView clears isolation and ghost shell
    state = rotundaReducer(state, { type: "setIsolatedSubsystem", subsystemId: "siphon" });
    state = rotundaReducer(state, { type: "resetPlinthView" });
    assert.equal(state.isolatedSubsystemId, null);
    assert.equal(state.ghostShellEnabled, false);
  });

  test("FloatingToolWings exposes VR-native Ghost Shell, Labels, Turntable, Field HUD, and HERO/Subsystem isolation tap controls", () => {
    assert.deepEqual(
      LEFT_VIEW_PILLS.map((p) => p.zoneId),
      ["view:ghost", "view:labels", "view:turntable", "view:telemetry"],
    );
    for (let i = 1; i < LEFT_VIEW_PILLS.length; i++) {
      const prev = LEFT_VIEW_PILLS[i - 1]!;
      const cur = LEFT_VIEW_PILLS[i]!;
      assert.ok(cur.x >= prev.x + prev.w, `VR left view pills must not overlap: ${prev.id} vs ${cur.id}`);
    }

    const chips = buildRightSubsystemChipLayouts(OCTOPUS_SUBSYSTEMS);
    assert.equal(chips.length, 7, "Expected HERO + 6 Pelagos OC-8 subsystem chips");
    assert.equal(chips[0]?.zoneId, "isolate:hero");
    assert.equal(chips[0]?.subsystemId, null);
    assert.deepEqual(
      chips.slice(1).map((c) => c.subsystemId),
      OCTOPUS_SUBSYSTEMS.map((s) => s.id),
    );
    for (let i = 1; i < chips.length; i++) {
      const prev = chips[i - 1]!;
      const cur = chips[i]!;
      assert.ok(cur.x >= prev.x + prev.w, `VR subsystem chips must not overlap: ${prev.zoneId} vs ${cur.zoneId}`);
    }
  });

  test("RotundaGeometryBridge supports GPU instanced-assembly snapshots without flattening clusters", () => {
    clearArtifactRotundaGeometryRegistry();
    const boxGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const matrices = new Float32Array(3 * 16);
    composeTransformMatrixDirect(matrices, 0, [-1, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    composeTransformMatrixDirect(matrices, 16, [0, 0.5, 0], [0, 0, 0, 1], [1, 1, 1]);
    composeTransformMatrixDirect(matrices, 32, [1, 0, 0], [0, 0, 0, 1], [1, 1, 1]);

    const snapshot: ArtifactRotundaGeometrySnapshot = {
      kind: "instanced-assembly",
      clusters: [{ clusterId: "segments", geometry: boxGeo, matrices, count: 3, baseColor: "#eef2f6" }],
    };

    const unregister = registerArtifactRotundaGeometry("octopus-instanced", snapshot);
    try {
      const recovered = getArtifactRotundaGeometry("octopus-instanced");
      assert.equal(recovered?.kind, "instanced-assembly");
      const fit = computeSnapshotFitTransform(snapshot);
      assert.ok(fit.scale > 0 && fit.scale < 1, `Expected fit scale within 0.78m sphere, got ${fit.scale}`);
      assert.ok(fit.size[0] >= 2.0, `Expected instanced span >= 2.0 along X, got ${fit.size[0]}`);
      const renderer = buildLiveArtifactRotundaRenderer(snapshot);
      const element = renderer({ explodeFactor: 0, simulationTime: 1, clippingPlanes: [] });
      assert.ok(React.isValidElement(element));
    } finally {
      unregister();
      boxGeo.dispose();
    }
  });

  test("Pelagos OC-8 Robotic Octopus showcase meets 202-segment, 489-wheel, 7-piston, 2.68 m/s jet, detach/reconnect, Operation Log & Modelica catalog specs", () => {
    // Exact mechanical inventory
    const segSum = OCTOPUS_ARM_SEGMENT_COUNTS.reduce((acc, n) => acc + n, 0);
    const wheelSum = segSum * 2 + OCTOPUS_ARM_DORSAL_WHEEL_COUNTS.reduce((acc, n) => acc + n, 0);
    assert.equal(OCTOPUS_ARM_SEGMENT_COUNTS.length, 8);
    assert.equal(segSum, OCTOPUS_TOTAL_SEGMENTS);
    assert.equal(segSum, 202);
    assert.equal(wheelSum, OCTOPUS_TOTAL_WHEELS);
    assert.equal(wheelSum, 489);
    assert.equal(OCTOPUS_PISTON_COUNT, 7);
    assert.equal(OCTOPUS_SUBSYSTEMS.length, 6);

    // Autonomous Arm 3 detach at t = 8.5s and reconnect by t = 15s
    assert.equal(evaluateOctopusArm3DetachFactor(2.0), 0);
    assert.equal(evaluateOctopusArm3DetachFactor(8.5), 1);
    assert.equal(sampleOctopusTelemetryChannel("arm.2.attached", 8.5), 0);
    assert.equal(sampleOctopusTelemetryChannel("arm.0.attached", 8.5), 1);
    assert.equal(evaluateOctopusArm3DetachFactor(15.0), 0);
    assert.equal(sampleOctopusTelemetryChannel("arm.2.attached", 15.0), 1);

    // Burst siphon jet phase at t = 16s (~2.68 m/s, ~6 N thrust, JETTING badge)
    const burstFrame = sampleTelemetryFrame(OCTOPUS_HUD_SPEC, 16.0, null, sampleOctopusTelemetryChannel);
    const jetVel = sampleOctopusTelemetryChannel("jet.velocity", 16.0) ?? 0;
    const thrust = sampleOctopusTelemetryChannel("jet.thrust", 16.0) ?? 0;
    assert.equal(burstFrame.statusLabel, "JETTING");
    assert.ok(jetVel > 2.4 && jetVel <= 2.75, `Expected burst jet velocity ~2.68 m/s, got ${jetVel}`);
    assert.ok(thrust > 5.0 && thrust <= 6.5, `Expected burst thrust ~6 N, got ${thrust}`);

    // Subsystem isolation & ghost-shell resolver
    const ghostVis = createDefaultAssemblyVisibility({ ghostShellEnabled: true });
    const mantlePres = resolvePartPresentation("mantle", ghostVis, { isDefaultGhostable: true });
    assert.equal(mantlePres.visible, true);
    assert.equal(mantlePres.ghosted, true);
    const pumpPres = resolvePartPresentation("pump-core", ghostVis, { isDefaultGhostable: false });
    assert.equal(pumpPres.ghosted, false);

    const inferred = inferSubsystemsFromPartNames([
      { name: "optic_camera_left" },
      { name: "mantle_shell" },
      { name: "pump_piston_1" },
      { name: "arm_link_01" },
      { name: "siphon_nozzle" },
    ]);
    assert.equal(inferred.length, 5);

    // Companion multi-body + fluid siphon Modelica starter template in CURATED_OPEN_MODELS and HERO_EXAMPLES
    const catalogOcto = CURATED_OPEN_MODELS.find((m) => m.id === "vr-pelagos-octopus");
    assert.ok(catalogOcto, "Expected vr-pelagos-octopus in CURATED_OPEN_MODELS");
    assert.equal(catalogOcto.suggestedFilename, "PelagosOC8Octopus.mo");
    assert.ok(catalogOcto.fallbackCode.includes("model PelagosOC8SubseaOctopus"));
    assert.ok(catalogOcto.fallbackCode.includes("connector FluidPort"));
    assert.ok(catalogOcto.fallbackCode.includes("connector SurgeFlange"));
    assert.ok(catalogOcto.fallbackCode.includes("connector ArmMountFlange"));
    assert.ok(catalogOcto.fallbackCode.includes("connect(intake.port_out, pump.port_in)"));
    assert.ok(catalogOcto.fallbackCode.includes("connect(pump.port_out, siphon.port_in)"));
    assert.ok(catalogOcto.fallbackCode.includes("connect(siphon.flange_hull, hull.flange_surge)"));
    assert.ok(catalogOcto.fallbackCode.includes("connect(arms.flange_mantle, hull.flange_arms)"));
    assert.ok(catalogOcto.diagramSvg.includes("<svg"));

    const heroOcto = HERO_EXAMPLES.find((ex) => ex.id === "modelica-pelagos-octopus");
    assert.ok(heroOcto, "Expected modelica-pelagos-octopus in HERO_EXAMPLES");
    assert.equal(heroOcto.lang, "modelica");
    assert.equal(heroOcto.code.trim(), catalogOcto.fallbackCode.trim());
    assert.ok(heroOcto.tags?.includes("vr"));

    // Source CAD extraction synthesizes real procedural 3D meshes + dynamic simulation bindings
    const pelagosCad = extractCadComponents(catalogOcto.fallbackCode);
    assert.equal(pelagosCad.length, 5, "Expected 5 procedural Pelagos OC-8 CAD components from .mo annotations");
    for (const comp of pelagosCad) {
      assert.ok(
        comp.proceduralMesh && comp.proceduralMesh.vertices.length > 0,
        `Expected tessellated proceduralMesh for ${comp.name}`,
      );
    }
    assert.ok(
      pelagosCad.some((c) => c.dynamicBindings?.some((b) => b.variable === "pump.theta")),
      "Expected pump-core 3D component bound to pump.theta",
    );
    assert.ok(
      pelagosCad.some((c) => c.dynamicBindings?.some((b) => b.variable === "arm3DetachOffset")),
      "Expected arm3-collar 3D component bound to arm3DetachOffset",
    );

    // SSR rendering of subsea-octopus scenario auto-enables Field HUD + Operation Log scrubber + AO toggle
    const octoScenario = getRotundaScenarioById("subsea-octopus");
    assert.ok(octoScenario);
    const octoHtml = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        document: octoScenario.createDocument(),
        models: octoScenario.models,
        scenarios: ROTUNDA_SHOWCASE_SCENARIOS,
        activeScenarioId: octoScenario.id,
        mode: "spatial-3d",
        initialEnvironment: octoScenario.recommendedEnvironment,
        onExitTo2D: () => undefined,
      }),
    );
    assert.ok(octoHtml.includes("Pelagos OC-8 Robotic Octopus"));
    assert.ok(octoHtml.includes('data-testid="rotunda-toggle-ghost"'));
    assert.ok(octoHtml.includes('data-testid="rotunda-toggle-labels"'));
    assert.ok(octoHtml.includes('data-testid="rotunda-toggle-turntable"'));
    assert.ok(octoHtml.includes('data-testid="rotunda-toggle-telemetry"'));
    assert.ok(octoHtml.includes('data-testid="rotunda-toggle-ao"'));
    assert.ok(octoHtml.includes('data-testid="simulator-telemetry-hud"'));
    assert.ok(octoHtml.includes('data-testid="hud-operation-log-bar"'));
    assert.ok(octoHtml.includes("8 OPERATOR ACTIONS"));
  });

  test("Procedural PBR material triplets, equirectangular HDRI generator, and full-bleed topOverlayInset work offline/SSR cleanly", () => {
    const pbrSets = [
      createPolishedConcretePbr(4, 4, 64),
      createHonedTravertinePbr(4, 4, 64),
      createMeadowGrassPbr(8, 8, 64),
      createBrushedAluminumPbr(2, 2, "#b4c0ce", 64),
    ];
    for (const set of pbrSets) {
      assert.equal(set.map.colorSpace, THREE.SRGBColorSpace, "Albedo map must be SRGB");
      assert.equal(set.normalMap.colorSpace, THREE.NoColorSpace, "Normal map must be linear");
      assert.equal(set.roughnessMap.colorSpace, THREE.NoColorSpace, "Roughness map must be linear");
      assert.equal(set.map.image.width, 64);
      assert.equal(set.normalMap.image.width, 64);
      assert.equal(set.roughnessMap.image.width, 64);
      set.dispose();
    }

    const knurl = createKnurledMetalNormalMap(16, 2, 32);
    assert.equal(knurl.colorSpace, THREE.NoColorSpace);
    assert.equal(knurl.image.width, 32);
    knurl.dispose();

    const shadow = createRadialContactShadowTexture(0.46, 0.22, 64);
    assert.equal(shadow.image.width, 64);
    shadow.dispose();

    for (const env of ROTUNDA_ENVIRONMENTS) {
      const hdri = createRotundaEnvironmentHdri(null, env.id);
      assert.equal(hdri.skyTexture.mapping, THREE.EquirectangularReflectionMapping);
      assert.equal(hdri.skyTexture.image.width, 512);
      assert.equal(hdri.skyTexture.image.height, 256);
      hdri.dispose();
    }

    // Full-bleed floating navbar mode passes topOverlayInset={72} so HUD pills clear the floating Morsel topbar
    const insetHtml = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        mode: "spatial-3d",
        initialEnvironment: "outdoors",
        topOverlayInset: 72,
        onExitTo2D: () => undefined,
      }),
    );
    assert.ok(insetHtml.includes("top:72px"), "Expected topOverlayInset=72 to offset top HUD pills cleanly");
    assert.ok(insetHtml.includes("top:124px"), "Expected HUD status hint to sit cleanly at topOverlayInset + 52px");
  });

  test("XR session enter/exit error handling, handedness haptics, dirtyRect cap, custom exit label & boardOmitted warning", async () => {
    assert.ok(formatXrSessionError({ name: "NotAllowedError" }, "vr").includes("permission"));
    assert.ok(formatXrSessionError({ name: "NotSupportedError" }, "ar").includes("not supported"));
    assert.ok(formatXrSessionError({ name: "InvalidStateError" }, "vr").includes("already active"));

    let ended = false;
    const pulsedHands: string[] = [];
    const fakeStore = {
      enterVR: async () => {
        throw Object.assign(new Error("no headset"), { name: "NotSupportedError" });
      },
      enterAR: async () => ({ end: async () => undefined }),
      getState: () => ({
        session: {
          end: async () => {
            ended = true;
          },
          inputSources: [
            {
              handedness: "left",
              gamepad: {
                hapticActuators: [
                  {
                    pulse: async () => {
                      pulsedHands.push("left");
                      return true;
                    },
                  },
                ],
              },
            },
            {
              handedness: "right",
              gamepad: {
                hapticActuators: [
                  {
                    pulse: async () => {
                      pulsedHands.push("right");
                      return true;
                    },
                  },
                ],
              },
            },
          ],
        },
      }),
    } as unknown as Parameters<typeof enterXrSession>[0];

    const vrFail = await enterXrSession(fakeStore, "vr");
    assert.equal(vrFail.ok, false);
    assert.ok(vrFail.error?.includes("not supported"));

    const arOk = await enterXrSession(fakeStore, "ar");
    assert.equal(arOk.ok, true);

    pulseXrHaptics(fakeStore, 0.2, 20, "right");
    assert.deepEqual(pulsedHands, ["right"]);

    const didExit = await exitXrSession(fakeStore);
    assert.equal(didExit, true);
    assert.equal(ended, true);

    // SpatialSurfaceBridge caps and coalesces dirty rects so unbounded memory growth cannot occur
    const bridge = new SpatialSurfaceBridge();
    for (let i = 0; i < 100; i++) {
      bridge.markDirty("primary", { x: i * 10, y: i * 5, width: 20, height: 10 });
    }
    const coalesced = bridge.consumeDirtyRects("primary");
    assert.ok(coalesced.length <= 64, `Expected dirty rects to be capped <= 64, got ${coalesced.length}`);
    assert.equal(coalesced[0]?.x, 0);

    // Custom exitTo2DLabel & updated external VR browser handoff label
    const customExitHtml = renderToStaticMarkup(
      React.createElement(EngineeringRotunda, {
        mode: "spatial-3d",
        onExitTo2D: () => undefined,
        exitTo2DLabel: "Return to Artifact",
        onOpenExternalVr: () => undefined,
      }),
    );
    assert.ok(customExitHtml.includes("Return to Artifact"));
    assert.ok(customExitHtml.includes("Open in Browser for VR"));

    // SpatialCanvasPage surfaces ?boardOmitted=1 warning instead of silently dropping data
    const omittedHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/canvas?mode=spatial-3d&boardOmitted=1"] },
        React.createElement(SpatialCanvasPage),
      ),
    );
    assert.ok(omittedHtml.includes('data-testid="vr-handoff-warning"'));
    assert.ok(omittedHtml.includes("128 KiB"));
  });

  test("CAE per-vertex stress/flow/thermal field generators produce non-uniform scientific contours", () => {
    const geom = new THREE.CylinderGeometry(0.18, 0.24, 0.5, 24, 8);
    try {
      for (const mode of ["fea-stress", "cfd-flow", "thermal"] as const) {
        const colors = computeGeometryCaeVertexColors(geom, mode);
        const posCount = geom.getAttribute("position").count;
        assert.equal(colors.length, posCount * 3);

        let minR = Infinity;
        let maxR = -Infinity;
        let minB = Infinity;
        let maxB = -Infinity;
        for (let i = 0; i < colors.length; i += 3) {
          const r = colors[i]!;
          const g = colors[i + 1]!;
          const b = colors[i + 2]!;
          assert.ok(Number.isFinite(r) && r >= 0 && r <= 1, `${mode} R out of bounds: ${r}`);
          assert.ok(Number.isFinite(g) && g >= 0 && g <= 1, `${mode} G out of bounds: ${g}`);
          assert.ok(Number.isFinite(b) && b >= 0 && b <= 1, `${mode} B out of bounds: ${b}`);
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (b < minB) minB = b;
          if (b > maxB) maxB = b;
        }
        // Must produce real spatial gradient across the mesh rather than a flat uniform single color
        assert.ok(
          maxR - minR > 0.15 || maxB - minB > 0.15,
          `Expected non-uniform spatial contour gradient for ${mode}, got dR=${(maxR - minR).toFixed(3)}, dB=${(maxB - minB).toFixed(3)}`,
        );

        // Also verify DataTexture gradient generator
        const tex = createCaeFieldGradientTexture(mode, 64);
        assert.equal(tex.colorSpace, THREE.SRGBColorSpace);
        const data = tex.image.data as Uint8Array;
        assert.equal(data.length, 64 * 64 * 4);
        tex.dispose();
      }

      // Verify colormap endpoints are distinct between low and high stress
      const low = sampleCaeFieldRgb("fea-stress", 0.05);
      const high = sampleCaeFieldRgb("fea-stress", 0.95);
      assert.ok(high[0] > low[0] + 0.4, "High Von Mises stress should be warm red/orange");
      assert.ok(low[2] > high[2] + 0.25, "Low Von Mises stress should be cool blue");
    } finally {
      geom.dispose();
    }
  });

  test("rotundaReducer manages focusedTileId zoom state and clears it on resetPlinthView", () => {
    let state = createInitialRotundaState();
    assert.equal(state.focusedTileId, null);

    state = rotundaReducer(state, { type: "setFocusedTile", tileId: "tile_primary_schematic" });
    assert.equal(state.focusedTileId, "tile_primary_schematic");

    state = rotundaReducer(state, { type: "toggleFocusedTile", tileId: "tile_primary_schematic" });
    assert.equal(state.focusedTileId, null);

    state = rotundaReducer(state, { type: "toggleFocusedTile", tileId: "tile_sim_plot" });
    assert.equal(state.focusedTileId, "tile_sim_plot");

    // Resetting view clears full-screen block focus as well as plinth transform
    state = rotundaReducer(state, { type: "resetPlinthView" });
    assert.equal(state.focusedTileId, null);
  });

  test("Pan-aware board projection round-trips cleanly and maximize/header hit rects are valid", () => {
    const panX = 140;
    const panY = -85;
    const sampleTile = { x: 420, y: 260, width: 480, height: 320 };
    const planeBounds = boardBoundsToPlaneBounds(sampleTile, panX, panY);
    const centerU = planeBounds.x + planeBounds.width / 2;
    const centerV = planeBounds.y + planeBounds.height / 2;
    const roundTripped = planeUvToBoard(centerU, centerV, panX, panY);
    assertClose(roundTripped.x, sampleTile.x + sampleTile.width / 2, 1e-3);
    assertClose(roundTripped.y, sampleTile.y + sampleTile.height / 2, 1e-3);

    // Tile maximize button rect sits inside the top-right header area of the tile
    const maxRect = getTileMaximizeButtonRect(sampleTile, false);
    assert.ok(maxRect.x > sampleTile.x + sampleTile.width - 60);
    assert.ok(maxRect.x + maxRect.width <= sampleTile.x + sampleTile.width);
    assert.ok(maxRect.y >= sampleTile.y && maxRect.y + maxRect.height <= sampleTile.y + 44);
    assert.equal(pointInPodiumRect(maxRect.x + maxRect.width / 2, maxRect.y + maxRect.height / 2, maxRect), true);
    assert.equal(pointInPodiumRect(sampleTile.x + 10, sampleTile.y + 10, maxRect), false);

    // Full-screen zoom header buttons fit strictly inside the top podium header bar
    for (const btn of [PODIUM_BACK_BTN_RECT, PODIUM_PREV_TILE_BTN_RECT, PODIUM_NEXT_TILE_BTN_RECT]) {
      assert.ok(btn.y >= 0 && btn.y + btn.height <= PODIUM_HEADER_HEIGHT);
      assert.ok(btn.x >= 0 && btn.x + btn.width <= ROTUNDA_BOARD_CANVAS_WIDTH);
    }
  });

  test("paintBoardToTextureCanvas renders overview (with pan + maximize hover) and full-screen focused block modes cleanly", () => {
    const drawnTexts: string[] = [];
    let strokeCallCount = 0;
    const mockCtx = new Proxy(
      {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        font: "",
        textAlign: "left",
        textBaseline: "alphabetic",
        globalAlpha: 1,
        shadowColor: "",
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        lineCap: "butt",
        lineJoin: "miter",
        fillText: (text: string) => {
          drawnTexts.push(String(text));
        },
        stroke: () => {
          strokeCallCount++;
        },
        getTransform: () => ({ a: 1, d: 1 }),
        measureText: (text: string) => ({ width: String(text).length * 7 }),
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
      } as Record<string, unknown>,
      {
        get(target, prop) {
          if (prop in target) return target[prop as string];
          return () => undefined;
        },
      },
    ) as unknown as CanvasRenderingContext2D;

    const mockCanvas = {
      width: ROTUNDA_BOARD_CANVAS_WIDTH,
      height: ROTUNDA_BOARD_CANVAS_HEIGHT,
      getContext: (kind: string) => (kind === "2d" ? mockCtx : null),
    } as unknown as HTMLCanvasElement;

    const doc = buildRotundaCanvasDocument({
      title: "Flanged Hub Validation",
      languageId: "scad",
      artifactUri: "FlangedHub.scad",
      sourceCode: "module flanged_hub() {\n  cylinder(h=40, r=25);\n}\nflanged_hub();\n",
    });
    const tileIds = Object.keys(doc.tiles);
    assert.ok(tileIds.length >= 2);

    // 1. Overview mode with non-zero boardPan and hovered maximize button
    paintBoardToTextureCanvas(mockCanvas, doc, 1.25, null, null, tileIds[0] ?? null, undefined, {
      focusedTileId: null,
      boardPan: { x: 45, y: -30 },
      hoveredMaximizeTileId: tileIds[0] ?? null,
      hoveredHeaderBtn: "reset-pan",
    });
    assert.ok(
      drawnTexts.some((t) => t.includes("Center Board")),
      "Expected Center Board pill when board is panned",
    );
    assert.ok(strokeCallCount > 10, "Expected vector icons and borders painted on tiles");

    // 2. Full-screen zoom mode on each tile archetype in the document
    for (const tid of tileIds) {
      drawnTexts.length = 0;
      paintBoardToTextureCanvas(mockCanvas, doc, 1.25, null, null, tileIds[0] ?? null, undefined, {
        focusedTileId: tid,
        hoveredHeaderBtn: "back",
      });
      assert.ok(
        drawnTexts.some((t) => t.includes("All Blocks")),
        `Expected 'All Blocks' back button in full-screen zoom mode for tile ${tid}`,
      );
      assert.ok(
        drawnTexts.some((t) => t.includes(doc.tiles[tid]!.title)),
        `Expected focused tile title '${doc.tiles[tid]!.title}' in full-screen header`,
      );
    }
  });
});
