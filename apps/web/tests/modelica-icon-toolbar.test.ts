// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerEditorLanguageUi, resolveLanguageToolbarButtons } from "@modelscript/editor";
import { MODELICA_ICON_SHAPE_TOOLS } from "@modelscript/editor/workbench/constants";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { discoverWorkspaceLanguages } from "../../../packages/ide-packager/src/language-discovery.js";

describe("Modelica Icon Editor Top Toolbar Integration", () => {
  it("discovers all 5 shape buttons from Modelica DSL ui.toolbarButtons scoped to icon view", async () => {
    const discovered = await discoverWorkspaceLanguages(path.resolve(import.meta.dirname, "../../../languages"));
    const modelicaButtons = discovered.ui.toolbarButtonsByLanguage.modelica ?? [];

    registerEditorLanguageUi({
      toolbarButtons: { modelica: modelicaButtons },
    });

    const resolved = resolveLanguageToolbarButtons(modelicaButtons, "icon", {
      target: "ansatz",
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
        btn.command?.startsWith("ansatz:addIconPrimitive:"),
        `button '${btn.id}' should dispatch ansatz:addIconPrimitive:<shapeId>`,
      );
      const shapeId = btn.command.slice("ansatz:addIconPrimitive:".length);
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

  it("wires maxPrimary for icon view in AnsatzEditorNavbar and AnsatzViewSubHeader, and handles addIconPrimitive in Ansatz", () => {
    const navbarSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx"),
      "utf-8",
    );
    const subHeaderSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/panels/AnsatzViewSubHeader.tsx"),
      "utf-8",
    );
    const ansatzSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/AnsatzEditor.tsx"),
      "utf-8",
    );

    assert.ok(
      navbarSrc.includes('maxPrimary={activeTabId === "icon" ? 6 : 0}') ||
        navbarSrc.includes('maxPrimary={activeTabId === "icon" ? 6 : 2}'),
      "AnsatzEditorNavbar should expand maxPrimary when activeTabId === 'icon'",
    );
    assert.ok(
      subHeaderSrc.includes('maxPrimary={activeTabId === "icon" ? 6 : 2}'),
      "AnsatzViewSubHeader should expand maxPrimary when activeTabId === 'icon'",
    );
    assert.ok(
      ansatzSrc.includes('btn.command?.startsWith("ansatz:addIconPrimitive:")'),
      "Ansatz.tsx must handle ansatz:addIconPrimitive:* toolbar commands",
    );
  });
});
