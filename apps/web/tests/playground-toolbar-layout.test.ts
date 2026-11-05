// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Playground Toolbar & Canvas Sub-Header Architecture", () => {
  it("verifies PlaygroundNavbar unifies view switcher including 3D and Inspector, and provides sidebar toggle", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      content.includes('aria-label="Workbench View"'),
      "PlaygroundNavbar must render Workbench View SegmentedControl",
    );
    assert.ok(content.includes('onViewChange("3d")'), "PlaygroundNavbar must support 3D view");
    assert.ok(content.includes('onViewChange("inspector")'), "PlaygroundNavbar must support Inspector view");
    assert.ok(content.includes("onToggleSidebar"), "PlaygroundNavbar must accept onToggleSidebar prop");
    assert.ok(
      content.includes("SidebarCollapseIcon") && content.includes("SidebarExpandIcon"),
      "PlaygroundNavbar must render sidebar collapse/expand icons",
    );
  });

  it("verifies PlaygroundPage passes hideCenterFloatingToolbar={true} to MorselEditor and coordinates sidebar", () => {
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const content = fs.readFileSync(pagePath, "utf-8");

    assert.ok(
      content.includes("hideCenterFloatingToolbar={true}"),
      "PlaygroundPage must pass hideCenterFloatingToolbar={true} to eliminate duplicate floating buttons",
    );
    assert.ok(
      content.includes("isSidebarOpen={isSidebarOpen}") && content.includes("onToggleSidebar={handleToggleSidebar}"),
      "PlaygroundPage must coordinate isSidebarOpen with PlaygroundNavbar",
    );
    assert.ok(
      content.includes('"3d"') && content.includes('"inspector"'),
      "PlaygroundPage currentView must support 3d and inspector modes",
    );
  });

  it("verifies MorselVisualizerPane docks canvas sub-header within the canvas column to avoid right sidebar collisions", () => {
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");
    const content = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      content.includes("!hideCenterFloatingToolbar &&") && content.includes("!isPlaygroundRoute &&"),
      "MorselVisualizerPane must not render the floating view switcher on playground routes",
    );
    assert.ok(
      content.includes("(hideCenterFloatingToolbar || isPlaygroundRoute) &&") &&
        content.includes("activeLangInfo.diagramTypes"),
      "MorselVisualizerPane must dock the canvas sub-header within the canvas column",
    );
    assert.ok(content.includes("setShowPalette"), "Docked canvas sub-header must provide Add Element palette toggle");
    assert.ok(content.includes("onAutoLayout"), "Docked canvas sub-header must provide Auto-layout button");
  });

  it("verifies MorselLeftSidebar provides a collapse button in the Libraries header", () => {
    const sidebarPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselLeftSidebar.tsx");
    const content = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      content.includes("SidebarCollapseIcon") && content.includes("setTreeVisible(false)"),
      "MorselLeftSidebar must provide collapse button calling setTreeVisible(false)",
    );
  });
});
