// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Morsel 3D Canvas Fullscreen & Visible-Area Centering", () => {
  const visualizerPanePath = path.resolve(
    import.meta.dirname,
    "../src/components/morsel/panels/MorselVisualizerPane.tsx",
  );
  const cadViewerPath = path.resolve(import.meta.dirname, "../src/components/morsel/cad-viewer/CadViewer.tsx");
  const timelinePath = path.resolve(import.meta.dirname, "../src/components/morsel/cad-viewer/AnimationTimeline.tsx");

  it("renders the 3D CAD Viewer pane fullscreen without outer floating-layout padding and passes fitInsets", () => {
    const src = fs.readFileSync(visualizerPanePath, "utf-8");
    const cadSectionStart = src.indexOf("{/* 3D CAD Viewer pane */}");
    const cadSectionEnd = src.indexOf("{/* Simulation Results and Cosimulation Pane */}");
    assert.ok(cadSectionStart !== -1 && cadSectionEnd > cadSectionStart, "Must locate 3D CAD Viewer pane section");

    const cadSection = src.slice(cadSectionStart, cadSectionEnd);
    assert.ok(cadSection.includes("inset: 0"), "3D CAD Viewer pane must use inset: 0 for fullscreen");
    assert.ok(!cadSection.includes("paddingTop:"), "3D CAD Viewer pane must not apply paddingTop");
    assert.ok(!cadSection.includes("paddingLeft:"), "3D CAD Viewer pane must not apply paddingLeft");
    assert.ok(!cadSection.includes("paddingRight:"), "3D CAD Viewer pane must not apply paddingRight");
    assert.ok(!cadSection.includes("paddingBottom:"), "3D CAD Viewer pane must not apply paddingBottom");
    assert.ok(cadSection.includes("fitInsets={"), "3D CAD Viewer pane must pass fitInsets to CadViewerPanel");
    assert.ok(
      cadSection.includes("isFullScreenSplitCanvas && view === MorselView.SPLIT_COLUMNS"),
      "3D CAD Viewer fitInsets must account for split columns panel",
    );
  });

  it("offsets the 3D camera frustum and fits distance to the visible viewport area via fitInsets", () => {
    const src = fs.readFileSync(cadViewerPath, "utf-8");

    assert.ok(
      src.includes("fitInsets?: { top: number; right: number; bottom: number; left: number }"),
      "CadViewerProps must define fitInsets",
    );
    assert.ok(
      src.includes("camera.setViewOffset("),
      "SceneContents must call camera.setViewOffset to center in visible area",
    );
    assert.ok(src.includes("camera.clearViewOffset()"), "SceneContents must clearViewOffset when insets are zero");
    assert.ok(
      src.includes("const offsetX = (right - left) / 2;"),
      "SceneContents must compute horizontal view offset from right/left insets",
    );
    assert.ok(
      src.includes("const offsetY = (bottom - top) / 2;"),
      "SceneContents must compute vertical view offset from bottom/top insets",
    );
    assert.ok(src.includes("fitDist"), "SceneContents must compute fitDist accounting for visible viewport dimensions");
  });

  it("positions 3D HUDs, GizmoHelper, EmptyState, and AnimationTimeline within the visible area", () => {
    const cadSrc = fs.readFileSync(cadViewerPath, "utf-8");
    const timelineSrc = fs.readFileSync(timelinePath, "utf-8");

    assert.ok(cadSrc.includes("top: fitInsets ? fitInsets.top : 14"), "3D HUDs must clear top fitInset");
    assert.ok(
      cadSrc.includes("right: fitInsets ? fitInsets.right : 14"),
      "Section plane HUD must clear right fitInset",
    );
    assert.ok(
      cadSrc.includes("left: fitInsets ? fitInsets.left : 14"),
      "Selected component HUD must clear left fitInset",
    );
    assert.ok(cadSrc.includes("fitInsets?.right ?? 0"), "GizmoHelper margin must clear right fitInset");
    assert.ok(cadSrc.includes("<EmptyState dark={dark} fitInsets={fitInsets} />"), "EmptyState must receive fitInsets");
    assert.ok(
      cadSrc.includes(
        "<AnimationTimeline controller={animationController} breachMarkers={breachMarkers} fitInsets={fitInsets} />",
      ),
      "AnimationTimeline must receive fitInsets",
    );
    assert.ok(
      timelineSrc.includes('fitInsets ? `calc(50% + ${(fitInsets.left - fitInsets.right) / 2}px)` : "50%"'),
      "AnimationTimeline must center horizontally within visible area",
    );
  });
});
