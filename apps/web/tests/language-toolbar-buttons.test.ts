// SPDX-License-Identifier: AGPL-3.0-or-later

import { discoverSingleLanguage, discoverWorkspaceLanguages } from "@modelscript/dsl";
import {
  getActiveToolbarContext,
  getEditorLanguageUi,
  matchesToolbarShortcut,
  registerEditorLanguageUi,
  resolveLanguageToolbarButtons,
  setActiveToolbarContext,
  type EditorLanguageToolbarButton,
} from "@modelscript/editor";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("Declarative Per-Language / Per-View Toolbar Buttons", () => {
  const sampleButtons: EditorLanguageToolbarButton[] = [
    {
      id: "btn-b",
      label: "Second Diagram Action",
      icon: "sync",
      views: ["diagram"],
      placement: "primary",
      order: 20,
    },
    {
      id: "btn-a",
      label: "First Diagram Action",
      icon: "flowchart",
      views: ["diagram"],
      placement: "primary",
      order: 10,
    },
    {
      id: "btn-c",
      label: "Third Diagram Action (overflows primary cap)",
      icon: "tools",
      views: ["diagram"],
      placement: "primary",
      order: 30,
    },
    {
      id: "btn-overflow",
      label: "Explicit Overflow Action",
      icon: "shield-check",
      views: ["*"],
      placement: "overflow",
      order: 5,
    },
    {
      id: "btn-code-only",
      label: "Flatten to DAE",
      icon: "stack",
      views: ["code"],
      placement: "primary",
      order: 10,
    },
    {
      id: "btn-vscode-only",
      label: "VS Code Only Action",
      icon: "terminal",
      views: ["*"],
      targets: ["vscode"],
      placement: "primary",
      order: 1,
    },
    {
      id: "btn-flagged",
      label: "Experimental 3D Action",
      icon: "beaker",
      views: ["3d"],
      placement: "primary",
      order: 10,
      featureFlag: "experimental_3d_tools",
    },
  ];

  it("filters by activeView, sorts by order, caps inline primary buttons, and folds excess into overflow", () => {
    const resolved = resolveLanguageToolbarButtons(sampleButtons, "diagram", {
      target: "ansatz",
      maxPrimary: 2,
    });

    assert.deepEqual(
      resolved.primary.map((b) => b.id),
      ["btn-a", "btn-b"],
      "Should render at most 2 primary buttons sorted by order",
    );
    assert.deepEqual(
      resolved.overflow.map((b) => b.id),
      ["btn-c", "btn-overflow"],
      "Excess primary buttons and explicit overflow buttons should fold into overflow",
    );
  });

  it("shows code-specific and wildcard buttons when activeView is 'code'", () => {
    const resolved = resolveLanguageToolbarButtons(sampleButtons, "code", {
      target: "ansatz",
    });

    assert.deepEqual(
      resolved.primary.map((b) => b.id),
      ["btn-code-only"],
    );
    assert.deepEqual(
      resolved.overflow.map((b) => b.id),
      ["btn-overflow"],
    );
  });

  it("gates buttons by featureFlag when isFeatureEnabled is provided", () => {
    const disabled = resolveLanguageToolbarButtons(sampleButtons, "3d", {
      target: "ansatz",
      isFeatureEnabled: () => false,
    });
    assert.deepEqual(
      disabled.primary.map((b) => b.id),
      [],
    );

    const enabled = resolveLanguageToolbarButtons(sampleButtons, "3d", {
      target: "ansatz",
      isFeatureEnabled: (flag) => flag === "experimental_3d_tools",
    });
    assert.deepEqual(
      enabled.primary.map((b) => b.id),
      ["btn-flagged"],
    );
  });

  it("registers toolbarButtons in EditorLanguageUiRegistry", () => {
    registerEditorLanguageUi({
      toolbarButtons: { testlang: sampleButtons },
    });
    assert.equal(getEditorLanguageUi().toolbarButtons.testlang?.length, sampleButtons.length);
  });

  it("matches declarative keyboard shortcuts accurately", () => {
    assert.equal(matchesToolbarShortcut("Shift+L", { key: "l", shiftKey: true }), true);
    assert.equal(matchesToolbarShortcut("Shift+L", { key: "l", shiftKey: false }), false);
    assert.equal(matchesToolbarShortcut("Mod+Shift+P", { key: "P", metaKey: true, shiftKey: true }), true);
    assert.equal(matchesToolbarShortcut("Mod+Shift+P", { key: "p", ctrlKey: true, shiftKey: true }), true);
    assert.equal(matchesToolbarShortcut("Mod+Shift+P", { key: "p", altKey: true, shiftKey: true }), false);
    assert.equal(matchesToolbarShortcut("Alt+F", { key: "f", altKey: true }), true);
    assert.equal(matchesToolbarShortcut(undefined, { key: "f" }), false);
  });

  it("tracks active toolbar context for CommandPalette integration", () => {
    setActiveToolbarContext({ languageId: "psse", view: "diagram" });
    assert.deepEqual(getActiveToolbarContext(), { languageId: "psse", view: "diagram" });
    setActiveToolbarContext(null);
    assert.equal(getActiveToolbarContext(), null);
  });

  it("discovers declarative ui.toolbarButtons across all 8 wired languages", async () => {
    const languagesDir = path.resolve(import.meta.dirname, "../../../languages");
    const expectations: Array<{ lang: string; buttonId: string; view: string }> = [
      { lang: "modelica", buttonId: "autoLayout", view: "diagram" },
      { lang: "psse", buttonId: "solvePowerFlow", view: "diagram" },
      { lang: "owl2", buttonId: "validateConsistency", view: "inspector" },
      { lang: "sysml2", buttonId: "verifyRequirements", view: "diagram" },
      { lang: "scad", buttonId: "exportStep", view: "3d" },
      { lang: "epanet", buttonId: "solveHydraulics", view: "diagram" },
      { lang: "spice", buttonId: "spiceRunAc", view: "diagram" },
      { lang: "ampl", buttonId: "amplSolve", view: "code" },
    ];

    for (const exp of expectations) {
      const discovered = await discoverSingleLanguage(path.join(languagesDir, exp.lang));
      assert.ok(discovered, `${exp.lang} should be discovered`);
      assert.ok(
        discovered.ui.toolbarButtons.some((b) => b.id === exp.buttonId && b.views.includes(exp.view as any)),
        `${exp.lang} should declare toolbar button '${exp.buttonId}' for view '${exp.view}'`,
      );
    }
  });

  it("verifies AnsatzEditorNavbar, AnsatzViewSubHeader, CommandPalette, Ansatz, ansatz-app, extension-generator, and vite.config.ts are wired", () => {
    const navbarSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx"),
      "utf-8",
    );
    const subHeaderSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/panels/AnsatzViewSubHeader.tsx"),
      "utf-8",
    );
    const paletteSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/CommandPalette.tsx"),
      "utf-8",
    );
    const ansatzSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/AnsatzEditor.tsx"),
      "utf-8",
    );
    const bridgeSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/WebEditorHostBridge.tsx"),
      "utf-8",
    );
    const viteSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../vite.config.ts"), "utf-8");
    const devAnsatzSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../scripts/ansatz/ansatz-app.tsx"),
      "utf-8",
    );
    const extGenSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/dsl/src/codegen/ide/extension-generator.ts"),
      "utf-8",
    );

    assert.ok(navbarSrc.includes("<LanguageToolbarButtons"), "AnsatzEditorNavbar must render LanguageToolbarButtons");
    assert.ok(
      subHeaderSrc.includes("<LanguageToolbarButtons"),
      "AnsatzViewSubHeader must render LanguageToolbarButtons",
    );
    assert.ok(paletteSrc.includes("getActiveToolbarContext"), "CommandPalette must surface active toolbar buttons");
    assert.ok(ansatzSrc.includes("executeLspAction"), "Ansatz must execute generic actionId via executeLspAction");
    assert.ok(
      bridgeSrc.includes("LANGUAGE_TOOLBAR_BUTTONS"),
      "WebEditorHostBridge must bridge LANGUAGE_TOOLBAR_BUTTONS",
    );
    assert.ok(viteSrc.includes("LANGUAGE_TOOLBAR_BUTTONS"), "vite.config.ts must export LANGUAGE_TOOLBAR_BUTTONS");
    assert.ok(devAnsatzSrc.includes("toolbarButtons:"), "Single-language ansatz-app must register toolbarButtons");
    assert.ok(
      extGenSrc.includes("lang.options.ui?.toolbarButtons"),
      "VS Code extension-generator must read ui.toolbarButtons",
    );
  });

  it("discovers valid ui.toolbarButtons across all 102 workspace languages", async () => {
    const languagesDir = path.resolve(import.meta.dirname, "../../../languages");
    const discovered = await discoverWorkspaceLanguages(languagesDir);
    const byLang = discovered.ui.toolbarButtonsByLanguage;
    const missing = discovered.manifest.map((m) => m.id).filter((id) => !(id in byLang));
    assert.deepEqual(
      missing,
      [],
      `Every discovered language must declare toolbarButtons (missing: ${missing.join(", ")})`,
    );

    for (const [langId, buttons] of Object.entries(byLang)) {
      assert.ok(buttons.length > 0, `${langId} must have at least one toolbar button`);
      for (const btn of buttons) {
        assert.ok(btn.id && btn.label, `${langId} button must have id and label`);
        assert.ok(Boolean(btn.actionId || btn.command), `${langId}.${btn.id} must specify either actionId or command`);
      }
    }
  });
});
