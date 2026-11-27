// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Ansatz Toolbar & Canvas Sub-Header Architecture", () => {
  it("verifies AnsatzEditorNavbar renders responsive icon+text view tabs, icon-only Split, language-gated Run, and autoFit DSL tools", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      content.includes('aria-label="Workbench View"'),
      "AnsatzEditorNavbar must render Workbench View SegmentedControl",
    );
    assert.ok(
      content.includes("SegmentedControl.Button") && content.includes("leadingIcon={tab.icon}"),
      "AnsatzEditorNavbar must render responsive SegmentedControl.Button tabs with leadingIcon",
    );
    assert.ok(
      content.includes('id: "icon"') && content.includes('onSelectDiagramType?.("icon")'),
      "AnsatzEditorNavbar must include Icon tab",
    );
    assert.ok(content.includes('onViewChange?.("3d")'), "AnsatzEditorNavbar must support 3D view");
    assert.ok(content.includes('onViewChange?.("inspector")'), "AnsatzEditorNavbar must support Inspector view");
    assert.ok(content.includes('onViewChange?.("code")'), "AnsatzEditorNavbar must support Code view");
    assert.ok(content.includes("SplitToggleButton"), "AnsatzEditorNavbar must render Split toggle button");
    assert.ok(
      content.includes("supportsSimulation && onSimulate"),
      "AnsatzEditorNavbar must gate Run button on supportsSimulation",
    );
    assert.ok(
      content.includes("autoFit") && content.includes("<LanguageToolbarButtons"),
      "AnsatzEditorNavbar must enable autoFit on LanguageToolbarButtons",
    );
    assert.ok(
      !content.includes('aria-label="Unsaved changes"'),
      "AnsatzEditorNavbar must not render the dirty dot in the topbar (moved to Files sidebar)",
    );
  });

  it("verifies AnsatzEditorNavbar provides sidebar toggle and theme toggle", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(content.includes("onToggleSidebar"), "AnsatzEditorNavbar must accept onToggleSidebar prop");
    assert.ok(
      content.includes("SidebarCollapseIcon") && content.includes("SidebarExpandIcon"),
      "AnsatzEditorNavbar must render sidebar collapse/expand icons",
    );
    assert.ok(
      content.includes("SunIcon") && content.includes("MoonIcon") && content.includes("toggleTheme"),
      "AnsatzEditorNavbar must render a dark/light mode toggle button wired to toggleTheme",
    );
  });

  it("verifies AnsatzEditorPage passes hideCenterFloatingToolbar={true} to AnsatzEditor and coordinates sidebar", () => {
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/AnsatzEditorPage.tsx");
    const content = fs.readFileSync(pagePath, "utf-8");

    assert.ok(
      content.includes("hideCenterFloatingToolbar={true}"),
      "AnsatzEditorPage must pass hideCenterFloatingToolbar={true} to eliminate duplicate floating buttons",
    );
    assert.ok(
      content.includes("isSidebarOpen={isSidebarOpen}") && content.includes("onToggleSidebar={handleToggleSidebar}"),
      "AnsatzEditorPage must coordinate isSidebarOpen with AnsatzEditorNavbar",
    );
    assert.ok(
      content.includes('"3d"') && content.includes('"inspector"'),
      "AnsatzEditorPage currentView must support 3d and inspector modes",
    );
  });

  it("verifies AnsatzVisualizerPane omits secondary AnsatzViewSubHeader and provides canvas tools", () => {
    const panePath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/panels/AnsatzVisualizerPane.tsx",
    );
    const content = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      content.includes("!hideCenterFloatingToolbar &&") && content.includes("!isAnsatzEditorRoute &&"),
      "AnsatzVisualizerPane must not render the floating view switcher on ansatz routes",
    );
    assert.ok(
      !content.includes("<AnsatzViewSubHeader"),
      "AnsatzVisualizerPane must not render the unnecessary secondary AnsatzViewSubHeader",
    );
    assert.ok(content.includes("setShowPalette"), "Docked canvas must provide Add Element palette toggle");
    assert.ok(content.includes("onAutoLayout"), "Docked canvas must provide Auto-layout button");
  });

  it("verifies AnsatzLeftSidebar provides a collapse button in the Libraries header", () => {
    const sidebarPath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/panels/AnsatzLeftSidebar.tsx",
    );
    const content = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(content.includes("setTreeVisible"), "AnsatzLeftSidebar must accept setTreeVisible prop");
  });
});
