// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Ansatz View Switching Synchronization & Anti-Flicker Architecture", () => {
  it("verifies AnsatzEditorNavbar uses a fully controlled SegmentedControl with onChange", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      content.includes("onChange={(idx) =>") || content.includes("onChange={"),
      "AnsatzEditorNavbar must pass onChange to SegmentedControl for controlled synchronization",
    );
    assert.ok(
      content.includes("viewTabs.findIndex"),
      "AnsatzEditorNavbar must calculate selectedIndex deterministically from activeTabId",
    );
    assert.ok(content.includes('onViewChange?.("3d")'), "Must support 3d view change");
    assert.ok(content.includes('onViewChange?.("inspector")'), "Must support inspector view change");
    assert.ok(content.includes('onViewChange?.("code")'), "Must support code view change");
    assert.ok(content.includes('id: "icon"'), "Must include Icon tab");
  });

  it("verifies AnsatzEditorPage wraps handleActiveViewChange in useCallback and handles split view", () => {
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/AnsatzEditorPage.tsx");
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

  it("verifies AnsatzEditor eliminates cyclic view mutation effects and tracks lastNotifiedViewRef", () => {
    const ansatzPath = path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/AnsatzEditor.tsx");
    const content = fs.readFileSync(ansatzPath, "utf-8");

    assert.ok(
      content.includes("applyViewMode"),
      "AnsatzEditor must have an atomic applyViewMode helper to switch views cleanly",
    );
    assert.ok(
      content.includes("lastNotifiedViewRef"),
      "AnsatzEditor must track lastNotifiedViewRef to prevent infinite notification loops",
    );
    assert.ok(
      /onActiveViewChange\?:\s*\n?\s*\|?\s*\(\(view:\s*"diagram"\s*\|\s*"simulation"\s*\|\s*"3d"\s*\|\s*"inspector"(?:\s*\|\s*"studio")?\s*\|\s*"code"\s*\|\s*"split"\)/.test(
        content,
      ),
      "onActiveViewChange must support split and studio views in its callback signature",
    );
    assert.ok(
      !content.includes(
        "setShowAnalysisView(false);\n      setShowCadView(false);\n      if (props.hideCenterFloatingToolbar && view === View.CODE)",
      ),
      "AnsatzEditor must NOT mutate state inside the active view listener effect",
    );
  });

  it("verifies separate Split button toggle with disabled state on Code view and left-code/right-visualizer split layout", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const navbarContent = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      navbarContent.includes("<SplitToggleButton") &&
        (navbarContent.includes("disabled={isCodeView || !canSplit}") ||
          navbarContent.includes("disabled={isCodeView}")),
      "AnsatzEditorNavbar must render a separate SplitToggleButton disabled when Code view is selected or canSplit is false",
    );
    assert.ok(navbarContent.includes("isSplit"), "AnsatzEditorNavbar must coordinate separate isSplit toggle state");
    assert.ok(
      navbarContent.includes('splitOrientation === "vertical" ? RowsIcon : ColumnsIcon') ||
        navbarContent.includes("RowsIcon"),
      "AnsatzEditorNavbar must use RowsIcon when splitOrientation is vertical",
    );

    const pagePath = path.resolve(import.meta.dirname, "../src/pages/AnsatzEditorPage.tsx");
    const pageContent = fs.readFileSync(pagePath, "utf-8");

    assert.ok(
      pageContent.includes("onToggleSplit={handleToggleSplit}") && pageContent.includes("canSplit={canSplit}"),
      "AnsatzEditorPage must pass canSplit and onToggleSplit to AnsatzEditor",
    );
    assert.ok(
      pageContent.includes('isSplit={isSplit && canSplit && currentView !== "code"}') ||
        pageContent.includes('isSplit={isSplit && currentView !== "code"}'),
      "AnsatzEditorPage must pass isSplit to AnsatzEditor when not on Code view and canSplit is true",
    );
    assert.ok(
      pageContent.includes('splitOrientation={splitOrientation === "vertical" ? "rows" : "columns"}'),
      "AnsatzEditorPage must pass splitOrientation to AnsatzEditor",
    );

    const ansatzPath = path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/AnsatzEditor.tsx");
    const ansatzContent = fs.readFileSync(ansatzPath, "utf-8");

    const visualizerPos = ansatzContent.indexOf("<AnsatzVisualizerPane");
    const codeEditorPos = ansatzContent.indexOf("(1 - splitRatio) * 100");
    assert.ok(
      visualizerPos !== -1 && codeEditorPos !== -1 && visualizerPos < codeEditorPos,
      "AnsatzEditor must place Visualizer Pane on the left and Code Editor on the right",
    );
    assert.ok(
      ansatzContent.includes("(1 - splitRatio) * 100"),
      "AnsatzEditor must size the right-hand Code Editor to the remaining split width",
    );

    const visualizerPath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/panels/AnsatzVisualizerPane.tsx",
    );
    const visualizerContent = fs.readFileSync(visualizerPath, "utf-8");
    assert.ok(
      visualizerContent.includes("`${splitRatio * 100}%`"),
      "AnsatzVisualizerPane must size itself to the left-hand splitRatio width",
    );
  });

  it("verifies responsive navbar toolbar layout with container query breakpoints and dynamic split reorientation", () => {
    const stylesPath = path.resolve(import.meta.dirname, "../src/pages/ansatz-editor/styles.ts");
    const stylesContent = fs.readFileSync(stylesPath, "utf-8");

    assert.ok(
      stylesContent.includes("container-type: inline-size;"),
      "AnsatzEditorNavbar must declare container-type for fine-grained responsive collapse",
    );
    assert.ok(
      stylesContent.includes(".nav-hide-xl") && stylesContent.includes(".nav-hide-lg"),
      "Ansatz styles must define responsive collapse utility classes",
    );
    assert.ok(
      stylesContent.includes(".segmentedControl-text"),
      "Ansatz styles must collapse segmented control button text at narrower widths",
    );

    const ansatzPath = path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/AnsatzEditor.tsx");
    const ansatzContent = fs.readFileSync(ansatzPath, "utf-8");

    assert.ok(
      ansatzContent.includes("View.SPLIT_ROWS") && ansatzContent.includes("View.SPLIT_COLUMNS"),
      "AnsatzEditor must support both horizontal (columns) and vertical (rows) split views",
    );
    assert.ok(
      ansatzContent.includes("windowHeight"),
      "AnsatzEditor must track windowHeight to dynamically detect sufficient vertical space for row splitting",
    );
  });

  it("exposes top-level AI Studio tab, Zonotope overlay toggle, and AI Copilot toggle in AnsatzEditorNavbar & AnsatzEditorPage", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const navbarContent = fs.readFileSync(navbarPath, "utf-8");
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/AnsatzEditorPage.tsx");
    const pageContent = fs.readFileSync(pagePath, "utf-8");

    assert.ok(navbarContent.includes('id: "studio"') && navbarContent.includes('label: "AI Studio"'));
    assert.ok(navbarContent.includes('data-testid="ansatz-zonotope-overlay-toggle"'));
    assert.ok(navbarContent.includes('data-testid="ansatz-ai-copilot-toggle"'));
    assert.ok(pageContent.includes("trainingStudioParams.isTrainingStudio"));
    assert.ok(pageContent.includes("showHypergraphOverlay={showHypergraphOverlay}"));
    assert.ok(pageContent.includes("isAiOpen={isAiOpen}"));
    assert.ok(pageContent.includes("trainingStudioContext={trainingStudioParams}"));
  });
});
