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
});
