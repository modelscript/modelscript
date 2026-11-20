// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Playground Toolbar & Canvas Sub-Header Architecture", () => {
  it("verifies PlaygroundNavbar unifies icon-only view switcher including Icon, 3D, Simulation, Inspector, Code, and Split with text", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      content.includes('aria-label="Workbench View"'),
      "PlaygroundNavbar must render Workbench View SegmentedControl",
    );
    assert.ok(
      content.includes("SegmentedControl.IconButton"),
      "PlaygroundNavbar must render icon-only SegmentedControl.IconButton tabs",
    );
    assert.ok(
      content.includes('id: "icon"') && content.includes('onSelectDiagramType?.("icon")'),
      "PlaygroundNavbar must include Icon tab",
    );
    assert.ok(content.includes('onViewChange?.("3d")'), "PlaygroundNavbar must support 3D view");
    assert.ok(content.includes('onViewChange?.("inspector")'), "PlaygroundNavbar must support Inspector view");
    assert.ok(content.includes('onViewChange?.("code")'), "PlaygroundNavbar must support Code view");
    assert.ok(
      content.includes("SplitToggleButton") && content.includes("<span>Split</span>"),
      "PlaygroundNavbar must render Split toggle button with Split text",
    );
  });

  it("verifies PlaygroundNavbar provides sidebar toggle and theme toggle", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(content.includes("onToggleSidebar"), "PlaygroundNavbar must accept onToggleSidebar prop");
    assert.ok(
      content.includes("SidebarCollapseIcon") && content.includes("SidebarExpandIcon"),
      "PlaygroundNavbar must render sidebar collapse/expand icons",
    );
    assert.ok(
      content.includes("SunIcon") && content.includes("MoonIcon") && content.includes("toggleTheme"),
      "PlaygroundNavbar must render a dark/light mode toggle button wired to toggleTheme",
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

  it("verifies MorselVisualizerPane omits secondary MorselViewSubHeader and provides canvas tools", () => {
    const panePath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/panels/MorselVisualizerPane.tsx",
    );
    const content = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      content.includes("!hideCenterFloatingToolbar &&") && content.includes("!isPlaygroundRoute &&"),
      "MorselVisualizerPane must not render the floating view switcher on playground routes",
    );
    assert.ok(
      !content.includes("<MorselViewSubHeader"),
      "MorselVisualizerPane must not render the unnecessary secondary MorselViewSubHeader",
    );
    assert.ok(content.includes("setShowPalette"), "Docked canvas must provide Add Element palette toggle");
    assert.ok(content.includes("onAutoLayout"), "Docked canvas must provide Auto-layout button");
  });

  it("verifies MorselLeftSidebar provides a collapse button in the Libraries header", () => {
    const sidebarPath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/panels/MorselLeftSidebar.tsx",
    );
    const content = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(
      content.includes("SidebarCollapseIcon") && content.includes("setTreeVisible(false)"),
      "MorselLeftSidebar must provide collapse button calling setTreeVisible(false)",
    );
  });
});
