// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Morsel Editor UX & Stability Regressions", () => {
  const webRoot = path.resolve(import.meta.dirname, "../src");
  const repoRoot = path.resolve(import.meta.dirname, "../../..");

  it("PlaygroundPage handleKeyDown guards e.target before accessing classList", () => {
    const src = fs.readFileSync(path.join(webRoot, "pages/PlaygroundPage.tsx"), "utf-8");
    assert.ok(
      src.includes("const target = e.target instanceof HTMLElement ? e.target : null;"),
      "PlaygroundPage handleKeyDown must guard e.target instanceof HTMLElement before classList access",
    );
  });

  it("Tree.tsx calls clearPlacement on onDragEnd instead of dispatching window Escape", () => {
    const treeSrc = fs.readFileSync(path.join(webRoot, "components/morsel/Tree.tsx"), "utf-8");
    const diagramSrc = fs.readFileSync(path.join(webRoot, "components/morsel/Diagram.tsx"), "utf-8");

    assert.ok(treeSrc.includes("clearPlacement()"), "Tree.tsx onDragEnd must call clearPlacement()");
    assert.ok(
      !treeSrc.includes('new KeyboardEvent("keydown", { key: "Escape" })'),
      "Tree.tsx must not dispatch synthetic window Escape KeyboardEvent on drag end",
    );
    assert.ok(
      diagramSrc.includes("clearPlacement();"),
      "Diagram.tsx onDrop must call clearPlacement() before creating drop placeholder",
    );
  });

  it("Libraries panel, ComponentList, Properties, and AddLibraryModal handle Primer night colorMode & explicit colorMode", () => {
    const treeSrc = fs.readFileSync(path.join(webRoot, "components/morsel/Tree.tsx"), "utf-8");
    const compListSrc = fs.readFileSync(path.join(webRoot, "components/morsel/ComponentList.tsx"), "utf-8");
    const propsSrc = fs.readFileSync(path.join(webRoot, "components/morsel/Properties.tsx"), "utf-8");
    const addLibSrc = fs.readFileSync(path.join(webRoot, "components/morsel/AddLibraryModal.tsx"), "utf-8");

    for (const [name, src] of [
      ["Tree.tsx", treeSrc],
      ["ComponentList.tsx", compListSrc],
      ["Properties.tsx", propsSrc],
      ["AddLibraryModal.tsx", addLibSrc],
    ] as const) {
      assert.ok(
        src.includes('=== "night"'),
        `${name} must recognize Primer colorMode/resolvedColorMode === "night" for dark mode icons`,
      );
    }
    assert.ok(
      treeSrc.includes("setDragPreview(e, iconSvg, cleanCompositeName, isDark)"),
      "Tree.tsx must pass isDark to setDragPreview",
    );
  });

  it("MorselLeftSidebar vertically stacks Libraries above Components on desktop and passes colorMode", () => {
    const sidebarSrc = fs.readFileSync(path.join(webRoot, "components/morsel/panels/MorselLeftSidebar.tsx"), "utf-8");

    assert.ok(
      !sidebarSrc.includes("desktopTab"),
      "MorselLeftSidebar must not gate desktop Libraries/Components behind tabs",
    );
    assert.ok(
      sidebarSrc.includes('const showLibrariesSection = isNarrow ? mobileSection === "libraries" : !showResultsView;'),
      "Libraries section must always be shown on desktop when not showing simulation results",
    );
    assert.ok(
      sidebarSrc.includes(
        'const showComponentsSection = isNarrow ? mobileSection === "components" : !showResultsView;',
      ),
      "Components section must always be shown on desktop when not showing simulation results",
    );
    assert.ok(
      sidebarSrc.includes("<TreeWidget") && sidebarSrc.includes("colorMode={_colorMode}"),
      "MorselLeftSidebar must pass colorMode={_colorMode} to TreeWidget",
    );
    assert.ok(
      sidebarSrc.includes("<ComponentList") && sidebarSrc.includes("colorMode={_colorMode}"),
      "MorselLeftSidebar must pass colorMode={_colorMode} to ComponentList",
    );
  });

  it("Diagram backend avoids eager full-workspace indexing on diagram edits", () => {
    const diagramServiceSrc = fs.readFileSync(
      path.join(repoRoot, "packages/lsp/src/services/diagram-service.ts"),
      "utf-8",
    );
    const diagramApiSrc = fs.readFileSync(path.join(repoRoot, "packages/lsp/src/diagramApi.ts"), "utf-8");

    assert.ok(
      !diagramServiceSrc.includes("getIndex?.({ eager: true })"),
      "diagram-service.ts must not pass { eager: true } in diagram backend getUnifiedIndex",
    );
    assert.ok(
      diagramApiSrc.includes('params.actions.some((a) => a.type === "addComponent")'),
      "diagramApi.ts must only fetch getUnifiedIndex when addComponent actions are present",
    );
  });
});
