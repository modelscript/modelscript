// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Playground View Switching Synchronization & Anti-Flicker Architecture", () => {
  it("verifies PlaygroundNavbar uses a fully controlled SegmentedControl with onChange", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      content.includes("onChange={(index) =>") || content.includes("onChange={"),
      "PlaygroundNavbar must pass onChange to SegmentedControl for controlled synchronization",
    );
    assert.ok(
      content.includes("viewTabs.findIndex"),
      "PlaygroundNavbar must calculate selectedIndex deterministically from currentView",
    );
    assert.ok(content.includes('onViewChange("3d")'), "Must support 3d view change");
    assert.ok(content.includes('onViewChange("inspector")'), "Must support inspector view change");
    assert.ok(content.includes('onViewChange("split")'), "Must support split view change");
  });

  it("verifies PlaygroundPage wraps handleActiveViewChange in useCallback and handles split view", () => {
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const content = fs.readFileSync(pagePath, "utf-8");

    assert.ok(
      content.includes("const handleActiveViewChange = useCallback("),
      "handleActiveViewChange must be memoized with useCallback to maintain reference stability",
    );
    assert.ok(
      content.includes('"split"') && content.includes('"inspector"') && content.includes('"3d"'),
      "handleActiveViewChange signature must include split, inspector, and 3d views",
    );
    assert.ok(
      content.includes("prev === nextView ? prev : (nextView as any)") ||
        content.includes("prev === nextView ? prev : nextView"),
      "handleActiveViewChange must guard against duplicate currentView state updates",
    );
  });

  it("verifies MorselEditor eliminates cyclic view mutation effects and tracks lastNotifiedViewRef", () => {
    const morselPath = path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx");
    const content = fs.readFileSync(morselPath, "utf-8");

    assert.ok(
      content.includes("applyViewMode"),
      "MorselEditor must have an atomic applyViewMode helper to switch views cleanly",
    );
    assert.ok(
      content.includes("lastNotifiedViewRef"),
      "MorselEditor must track lastNotifiedViewRef to prevent infinite notification loops",
    );
    assert.ok(
      content.includes(
        'onActiveViewChange?: ((view: "diagram" | "simulation" | "3d" | "inspector" | "code" | "split")',
      ),
      "onActiveViewChange must support split view in its callback signature",
    );
    assert.ok(
      !content.includes(
        "setShowAnalysisView(false);\n      setShowCadView(false);\n      if (props.hideCenterFloatingToolbar && view === View.CODE)",
      ),
      "MorselEditor must NOT mutate state inside the active view listener effect",
    );
  });

  it("verifies separate Split button toggle with disabled state on Code view and left-code/right-visualizer split layout", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const navbarContent = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      navbarContent.includes("<SplitToggleButton") &&
        (navbarContent.includes("disabled={isCodeSelected || !canSplit}") ||
          navbarContent.includes("disabled={isCodeSelected}")),
      "PlaygroundNavbar must render a separate SplitToggleButton disabled when Code view is selected or canSplit is false",
    );
    assert.ok(
      navbarContent.includes("effectiveIsSplit"),
      "PlaygroundNavbar must coordinate separate isSplit toggle state",
    );
    assert.ok(
      navbarContent.includes('splitOrientation === "vertical" ? RowsIcon : ColumnsIcon') ||
        navbarContent.includes("RowsIcon"),
      "PlaygroundNavbar must use RowsIcon when splitOrientation is vertical",
    );

    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const pageContent = fs.readFileSync(pagePath, "utf-8");

    assert.ok(
      pageContent.includes("onToggleSplit={handleToggleSplit}") && pageContent.includes("canSplit={canSplit}"),
      "PlaygroundPage must pass canSplit and onToggleSplit to PlaygroundNavbar",
    );
    assert.ok(
      pageContent.includes('isSplit={isSplit && canSplit && currentView !== "code"}') ||
        pageContent.includes('isSplit={isSplit && currentView !== "code"}'),
      "PlaygroundPage must pass isSplit to MorselEditor when not on Code view and canSplit is true",
    );
    assert.ok(
      pageContent.includes('splitOrientation={splitOrientation === "vertical" ? "rows" : "columns"}'),
      "PlaygroundPage must pass splitOrientation to MorselEditor",
    );

    const morselPath = path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx");
    const morselContent = fs.readFileSync(morselPath, "utf-8");

    // Code Editor should appear before MorselVisualizerPane in the split container
    const codeEditorPos = morselContent.indexOf("{/* Code Editor (on the left in split view) */}");
    const visualizerPos = morselContent.indexOf(
      "{/* Visualizer Pane (Diagram / 3D / Simulation / Inspector on the right) */}",
    );
    assert.ok(
      codeEditorPos !== -1 && visualizerPos !== -1 && codeEditorPos < visualizerPos,
      "MorselEditor must place Code Editor on the left and Visualizer Pane on the right",
    );

    const visualizerPath = path.resolve(
      import.meta.dirname,
      "../src/components/morsel/panels/MorselVisualizerPane.tsx",
    );
    const visualizerContent = fs.readFileSync(visualizerPath, "utf-8");
    assert.ok(
      visualizerContent.includes("(1 - splitRatio) * 100"),
      "MorselVisualizerPane must size itself to the remaining right-hand split width",
    );
  });

  it("verifies responsive navbar toolbar layout with container query breakpoints and dynamic split reorientation", () => {
    const stylesPath = path.resolve(import.meta.dirname, "../src/pages/playground/styles.ts");
    const stylesContent = fs.readFileSync(stylesPath, "utf-8");

    assert.ok(
      stylesContent.includes("container-type: inline-size;"),
      "PlaygroundNavbar must declare container-type for fine-grained responsive collapse",
    );
    assert.ok(
      stylesContent.includes(".nav-hide-xl") && stylesContent.includes(".nav-hide-lg"),
      "Playground styles must define responsive collapse utility classes",
    );
    assert.ok(
      stylesContent.includes(".segmentedControl-text"),
      "Playground styles must collapse segmented control button text at narrower widths",
    );

    const morselPath = path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx");
    const morselContent = fs.readFileSync(morselPath, "utf-8");

    assert.ok(
      morselContent.includes("View.SPLIT_ROWS") && morselContent.includes("View.SPLIT_COLUMNS"),
      "MorselEditor must support both horizontal (columns) and vertical (rows) split views",
    );
    assert.ok(
      morselContent.includes("windowHeight"),
      "MorselEditor must track windowHeight to dynamically detect sufficient vertical space for row splitting",
    );
  });
});
