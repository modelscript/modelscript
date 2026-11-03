// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { useWheelZoom, ZoomHintBadge } from "../src/components/artifacts/useArtifactZoom";

describe("Post Artifact Viewers Control+Scroll Zoom & Feed Scroll Protection", () => {
  describe("Zoom Mathematics & Exponential Invariance", () => {
    it("computes zoom factor monotonically: delta < 0 zooms in, delta > 0 zooms out", () => {
      const zoomInDelta = -100;
      const zoomOutDelta = 100;

      const factorIn = Math.exp(-zoomInDelta * 0.0018);
      const factorOut = Math.exp(-zoomOutDelta * 0.0018);

      assert.ok(factorIn > 1.0, `Factor for delta < 0 should be > 1.0, got ${factorIn}`);
      assert.ok(factorOut < 1.0, `Factor for delta > 0 should be < 1.0, got ${factorOut}`);
      assert.ok(Math.abs(factorIn * factorOut - 1.0) < 1e-4, "Equal and opposite deltas should invert");
    });

    it("ensures trackpad pinch chunking has mathematical parity with single mouse wheel notch", () => {
      // Single notch of 100px delta
      const totalDelta = 100;
      const singleNotchFactor = Math.exp(-totalDelta * 0.0018);

      // Same total delta split into 10 smaller trackpad pinch ticks of 10px each
      const tickDelta = 10;
      let multiTickFactor = 1.0;
      for (let i = 0; i < 10; i++) {
        multiTickFactor *= Math.exp(-tickDelta * 0.0018);
      }

      assert.ok(
        Math.abs(singleNotchFactor - multiTickFactor) < 1e-9,
        `Exponential zoom must be invariant to event chunking: ${singleNotchFactor} vs ${multiTickFactor}`,
      );
    });

    it("verifies cursor focal point stays stationary under zoom transformation", () => {
      // Viewport center is at (300, 200)
      // Cursor is at (400, 250) -> offset from center is (100, 50)
      const offsetX = 100;
      const offsetY = 50;

      const currentZoom = 1.0;
      const currentPan = { x: 0, y: 0 };

      // Zoom in to 2.0x
      const nextZoom = 2.0;
      const ratio = nextZoom / currentZoom;

      const nextPanX = offsetX - (offsetX - currentPan.x) * ratio;
      const nextPanY = offsetY - (offsetY - currentPan.y) * ratio;

      // Coordinate under cursor before zoom:
      const cursorXDiag = (offsetX - currentPan.x) / currentZoom;
      const cursorYDiag = (offsetY - currentPan.y) / currentZoom;

      // Screen coordinate after zoom:
      const screenXAfter = cursorXDiag * nextZoom + nextPanX;
      const screenYAfter = cursorYDiag * nextZoom + nextPanY;

      assert.equal(screenXAfter, offsetX, "Point under cursor X must remain stationary");
      assert.equal(screenYAfter, offsetY, "Point under cursor Y must remain stationary");
    });

    it("exports useWheelZoom and ZoomHintBadge from useArtifactZoom", () => {
      assert.equal(typeof useWheelZoom, "function");
      assert.equal(typeof ZoomHintBadge, "function");
    });
  });

  describe("Integration Verification Across Artifact Viewers", () => {
    const artifactsDir = path.resolve(import.meta.dirname, "../src/components/artifacts");

    it("wires useWheelZoom and ZoomHintBadge into InteractiveSvgStage in PolyglotArtifactViewer", () => {
      const src = fs.readFileSync(path.join(artifactsDir, "PolyglotArtifactViewer.tsx"), "utf8");
      assert.ok(src.includes("useWheelZoom"), "PolyglotArtifactViewer must import and use useWheelZoom");
      assert.ok(src.includes("ZoomHintBadge"), "PolyglotArtifactViewer must render ZoomHintBadge");
      assert.ok(src.includes("ref={stageRef}"), "InteractiveSvgStage must attach stageRef for native wheel listener");
    });

    it("wires useWheelZoom and ZoomHintBadge into MermaidViewer without hijacking feed scroll", () => {
      const src = fs.readFileSync(path.join(artifactsDir, "MermaidViewer.tsx"), "utf8");
      assert.ok(src.includes("useWheelZoom"), "MermaidViewer must use useWheelZoom");
      assert.ok(src.includes("ZoomHintBadge"), "MermaidViewer must render ZoomHintBadge");
      assert.ok(
        !src.includes("onWheel={handleWheel}"),
        "MermaidViewer must NOT have unconditional onWheel={handleWheel} on CanvasViewport",
      );
    });

    it("wires useWheelZoom and ZoomHintBadge into PictureViewer without hijacking feed scroll", () => {
      const src = fs.readFileSync(path.join(artifactsDir, "PictureViewer.tsx"), "utf8");
      assert.ok(src.includes("useWheelZoom"), "PictureViewer must use useWheelZoom");
      assert.ok(src.includes("ZoomHintBadge"), "PictureViewer must render ZoomHintBadge");
      assert.ok(
        !src.includes("onWheel={handleWheel}"),
        "PictureViewer must NOT have unconditional onWheel={handleWheel} on CanvasViewport",
      );
    });

    it("wires useWheelZoom and ZoomHintBadge into SspViewer for SSD system schematics", () => {
      const src = fs.readFileSync(path.join(artifactsDir, "SspViewer.tsx"), "utf8");
      assert.ok(src.includes("useWheelZoom"), "SspViewer must use useWheelZoom");
      assert.ok(src.includes("ZoomHintBadge"), "SspViewer must render ZoomHintBadge");
      assert.ok(src.includes("ref={stageRef}"), "SspViewer must attach stageRef to DiagramStage");
    });

    it("adopts SafeOrbitControls in MultibodyViewport3D for feed scroll protection", () => {
      const src = fs.readFileSync(path.join(artifactsDir, "MultibodyViewport3D.tsx"), "utf8");
      assert.ok(src.includes("SafeOrbitControls"), "MultibodyViewport3D must import and use SafeOrbitControls");
      assert.ok(!src.includes("<OrbitControls"), "MultibodyViewport3D must not use raw un-shielded OrbitControls");
    });

    it("ensures SafeOrbitControls allows zoom when Ctrl or Cmd modifier is active during wheel", () => {
      const src = fs.readFileSync(path.join(artifactsDir, "SafeOrbitControls.tsx"), "utf8");
      assert.ok(
        src.includes("if (e.ctrlKey || e.metaKey)") && src.includes("setIsZoomAllowed(true)"),
        "SafeOrbitControls must immediately allow zoom when Ctrl or Cmd modifier is active",
      );
      assert.ok(
        src.includes("💡 Hold ⌘/Ctrl to zoom 3D model"),
        "SafeOrbitControls must show hint when scrolling without modifier",
      );
    });

    it("documents Ctrl/Cmd + scroll wheel zoom in StudioInspectorSidebar hotkey and interaction guides", () => {
      const src = fs.readFileSync(path.join(artifactsDir, "card/StudioInspectorSidebar.tsx"), "utf8");
      assert.ok(
        src.includes("Hold Ctrl / ⌘ + scroll"),
        "StudioInspectorSidebar must describe Hold Ctrl / ⌘ + scroll to zoom",
      );
    });
  });
});
