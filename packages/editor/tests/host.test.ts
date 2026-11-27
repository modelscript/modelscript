// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getActiveToolbarContext,
  getEditorLanguageUi,
  getLanguageFlagKey,
  isLanguageEnabledInFlags,
  matchesToolbarShortcut,
  registerEditorLanguageUi,
  resolveLanguageToolbarButtons,
  setActiveToolbarContext,
  type EditorLanguageToolbarButton,
} from "../src/host.js";

describe("@modelscript/editor host context & toolbar utilities", () => {
  it("tracks and clears active toolbar context", () => {
    const prev = getActiveToolbarContext();
    try {
      setActiveToolbarContext({ languageId: "modelica", view: "diagram" });
      assert.deepEqual(getActiveToolbarContext(), { languageId: "modelica", view: "diagram" });

      setActiveToolbarContext({ languageId: "pscad", view: "code" });
      assert.deepEqual(getActiveToolbarContext(), { languageId: "pscad", view: "code" });

      setActiveToolbarContext(null);
      assert.equal(getActiveToolbarContext(), null);
    } finally {
      setActiveToolbarContext(prev);
    }
  });

  it("merges language UI registrations into the global registry", () => {
    const prev = { ...getEditorLanguageUi() };
    const sampleBtn: EditorLanguageToolbarButton = {
      id: "run-check",
      label: "Run Check",
      views: ["code"],
    };
    try {
      registerEditorLanguageUi({
        toolbarButtons: {
          ...prev.toolbarButtons,
          modelica: [sampleBtn],
        },
      });
      const registry = getEditorLanguageUi();
      assert.deepEqual(registry.toolbarButtons.modelica, [sampleBtn]);
    } finally {
      registerEditorLanguageUi(prev);
    }
  });

  it("resolves toolbar buttons by target, view, feature flag, order, and primary cap", () => {
    const buttons: EditorLanguageToolbarButton[] = [
      { id: "b-late", label: "Late Primary", order: 30 },
      { id: "b-first", label: "First Primary", order: 10 },
      { id: "b-mid", label: "Mid Primary", order: 20 },
      { id: "b-overflow", label: "Explicit Overflow", placement: "overflow", order: 5 },
      { id: "b-vscode-only", label: "VS Code Only", targets: ["vscode"], order: 1 },
      { id: "b-code-only", label: "Code Only", views: ["code"], order: 2 },
      { id: "b-flagged-off", label: "Disabled Flag", featureFlag: "beta_feature", order: 3 },
      { id: "b-flagged-on", label: "Enabled Flag", featureFlag: "enabled_feature", order: 15 },
    ];

    const resolved = resolveLanguageToolbarButtons(buttons, "diagram", {
      target: "ansatz",
      maxPrimary: 2,
      isFeatureEnabled: (flag) => flag === "enabled_feature",
    });

    assert.deepEqual(
      resolved.primary.map((b) => b.id),
      ["b-first", "b-flagged-on"],
    );
    assert.deepEqual(
      resolved.overflow.map((b) => b.id),
      ["b-mid", "b-late", "b-overflow"],
    );
    assert.deepEqual(
      resolved.all.map((b) => b.id),
      ["b-overflow", "b-first", "b-flagged-on", "b-mid", "b-late"],
    );

    assert.deepEqual(resolveLanguageToolbarButtons(undefined, "diagram"), {
      primary: [],
      overflow: [],
      all: [],
    });
    assert.deepEqual(resolveLanguageToolbarButtons([], "diagram"), {
      primary: [],
      overflow: [],
      all: [],
    });
  });

  it("matches declarative toolbar keyboard shortcuts", () => {
    assert.equal(matchesToolbarShortcut(undefined, { key: "l" }), false);
    assert.equal(matchesToolbarShortcut("Shift+L", { key: "l", shiftKey: true }), true);
    assert.equal(matchesToolbarShortcut("Shift+L", { key: "L", shiftKey: true }), true);
    assert.equal(matchesToolbarShortcut("Shift+L", { key: "l", shiftKey: false }), false);
    assert.equal(matchesToolbarShortcut("Shift+L", { key: "l", shiftKey: true, ctrlKey: true }), false);

    assert.equal(matchesToolbarShortcut("Mod+Shift+P", { key: "p", ctrlKey: true, shiftKey: true }), true);
    assert.equal(matchesToolbarShortcut("Mod+Shift+P", { key: "p", metaKey: true, shiftKey: true }), true);
    assert.equal(matchesToolbarShortcut("Mod+Shift+P", { key: "p", shiftKey: true }), false);

    assert.equal(matchesToolbarShortcut("Alt+F", { key: "f", altKey: true }), true);
    assert.equal(matchesToolbarShortcut("Alt+F", { key: "f", altKey: false }), false);
  });

  it("normalizes language feature flag keys and evaluates enabled state", () => {
    assert.equal(getLanguageFlagKey("Modelica"), "lang_modelica");
    assert.equal(getLanguageFlagKey("verilog-a"), "lang_verilog_a");
    assert.equal(getLanguageFlagKey("  HEC-RAS "), "lang_hec_ras");

    // Default predicate enables languages when no custom feature-flag callback is provided
    assert.equal(isLanguageEnabledInFlags("modelica"), true);
    assert.equal(isLanguageEnabledInFlags("modelscript"), true);

    // modelscript accepts either lang_modelscript or lang_modelscript_msx
    assert.equal(
      isLanguageEnabledInFlags("modelscript", (k) => k === "lang_modelscript_msx"),
      true,
    );
    assert.equal(
      isLanguageEnabledInFlags("modelscript", (k) => k === "lang_modelscript"),
      true,
    );
    assert.equal(
      isLanguageEnabledInFlags("modelscript", () => false),
      false,
    );
    assert.equal(
      isLanguageEnabledInFlags("pscad", (k) => k === "lang_pscad"),
      true,
    );
    assert.equal(
      isLanguageEnabledInFlags("pscad", () => false),
      false,
    );
  });
});
