// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerEditorLanguageUi, resolveLanguageToolbarButtons } from "@modelscript/editor";
import { MODELICA_ICON_SHAPE_TOOLS } from "@modelscript/editor/workbench/constants";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { discoverWorkspaceLanguages } from "../../../packages/dsl/src/codegen/ide/language-discovery.js";

describe("Modelica Icon Editor Top Toolbar Integration", () => {
  it("discovers all 5 shape buttons from Modelica DSL ui.toolbarButtons scoped to icon view", async () => {
    const discovered = await discoverWorkspaceLanguages(path.resolve(import.meta.dirname, "../../../languages"));
    const modelicaButtons = discovered.ui.toolbarButtonsByLanguage.modelica ?? [];

    registerEditorLanguageUi({
      toolbarButtons: { modelica: modelicaButtons },
    });

    const resolved = resolveLanguageToolbarButtons(modelicaButtons, "icon", {
      target: "morsel",
      maxPrimary: 6,
    });

    const shapeIds = ["addIconRect", "addIconEllipse", "addIconLine", "addIconPolygon", "addIconText"];
    assert.deepEqual(
      resolved.primary.map((b) => b.id),
      shapeIds,
      "all 5 icon shape buttons should be primary in icon view",
    );
    for (const btn of resolved.primary) {
      assert.ok(btn.iconSvg && btn.iconSvg.includes("<"), `button '${btn.id}' should carry custom iconSvg`);
      assert.ok(
        btn.command?.startsWith("morsel:addIconPrimitive:"),
        `button '${btn.id}' should dispatch morsel:addIconPrimitive:<shapeId>`,
      );
      const shapeId = btn.command.slice("morsel:addIconPrimitive:".length);
      assert.ok(
        MODELICA_ICON_SHAPE_TOOLS.some((t) => t.id === shapeId),
        `shape '${shapeId}' must exist in MODELICA_ICON_SHAPE_TOOLS`,
      );
    }

    const toolbarButtonsSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/panels/LanguageToolbarButtons.tsx"),
      "utf-8",
    );
    assert.ok(
      toolbarButtonsSrc.includes("btn.iconSvg") && toolbarButtonsSrc.includes("dangerouslySetInnerHTML"),
      "LanguageToolbarButtons must render custom btn.iconSvg markup",
    );
  });

  it("wires maxPrimary for icon view in PlaygroundNavbar and MorselViewSubHeader, and handles addIconPrimitive in Morsel", () => {
    const navbarSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx"),
      "utf-8",
    );
    const subHeaderSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/panels/MorselViewSubHeader.tsx"),
      "utf-8",
    );
    const morselSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/Morsel.tsx"),
      "utf-8",
    );

    assert.ok(
      navbarSrc.includes('maxPrimary={activeTabId === "icon" ? 6 : 2}'),
      "PlaygroundNavbar should expand maxPrimary when activeTabId === 'icon'",
    );
    assert.ok(
      subHeaderSrc.includes('maxPrimary={activeTabId === "icon" ? 6 : 2}'),
      "MorselViewSubHeader should expand maxPrimary when activeTabId === 'icon'",
    );
    assert.ok(
      morselSrc.includes('btn.command?.startsWith("morsel:addIconPrimitive:")'),
      "Morsel.tsx must handle morsel:addIconPrimitive:* toolbar commands",
    );
  });
});
