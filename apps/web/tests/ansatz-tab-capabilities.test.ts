// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getLanguageInfo } from "../../../packages/editor/src/workbench/constants.js";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { AnsatzMobileTabBar } = await import("../../../packages/editor/src/workbench/panels/AnsatzMobileTabBar.js");

describe("Ansatz Language Capability Tab Hiding", () => {
  const noop = () => {};

  it("hides unsupported tabs in AnsatzMobileTabBar for each language", () => {
    const renderMobileBar = (dialect: string) =>
      renderToStaticMarkup(
        React.createElement(AnsatzMobileTabBar, {
          isNarrow: true,
          mobileTab: "code",
          setMobileTab: noop,
          setTreeVisible: noop,
          setView: noop,
          setShowResultsView: noop,
          setShowCadView: noop,
          onSimulate: noop,
          simulationStatus: null,
          dialect,
        }),
      );

    // Modelica supports diagram, simulation, and 3D
    const modelicaHtml = renderMobileBar("modelica");
    assert.ok(modelicaHtml.includes(">Results<"), "Modelica should show Results tab");
    assert.ok(modelicaHtml.includes(">Diagram<"), "Modelica should show Diagram tab");
    assert.ok(modelicaHtml.includes(">3D<"), "Modelica should show 3D tab");

    // SysML v2 supports diagram & simulation, NOT 3D
    const sysmlHtml = renderMobileBar("sysml2");
    assert.ok(sysmlHtml.includes(">Results<"), "SysML v2 should show Results tab");
    assert.ok(sysmlHtml.includes(">Diagram<"), "SysML v2 should show Diagram tab");
    assert.ok(!sysmlHtml.includes(">3D<"), "SysML v2 should hide 3D tab");

    // OpenSCAD supports 3D, NOT diagram or simulation
    const scadHtml = renderMobileBar("scad");
    assert.ok(!scadHtml.includes(">Results<"), "OpenSCAD should hide Results tab");
    assert.ok(!scadHtml.includes(">Diagram<"), "OpenSCAD should hide Diagram tab");
    assert.ok(scadHtml.includes(">3D<"), "OpenSCAD should show 3D tab");

    // CSV supports none of diagram, simulation, 3D
    const csvHtml = renderMobileBar("csv");
    assert.ok(!csvHtml.includes(">Results<"), "CSV should hide Results tab");
    assert.ok(!csvHtml.includes(">Diagram<"), "CSV should hide Diagram tab");
    assert.ok(!csvHtml.includes(">3D<"), "CSV should hide 3D tab");
    assert.ok(csvHtml.includes(">Code<"), "CSV should still show Code tab");
    assert.ok(csvHtml.includes(">Inspect<"), "CSV should still show Inspect tab");

    // C supports diagram, NOT simulation or 3D
    const cHtml = renderMobileBar("c");
    assert.ok(!cHtml.includes(">Results<"), "C should hide Results tab");
    assert.ok(cHtml.includes(">Diagram<"), "C should show Diagram tab");
    assert.ok(!cHtml.includes(">3D<"), "C should hide 3D tab");
  });

  it("verifies AnsatzEditorNavbar gates Diagram, Icon, 3D, and Simulation tabs strictly by language capabilities", () => {
    const navbarPath = path.resolve(
      import.meta.dirname,
      "../src/pages/ansatz-editor/components/AnsatzEditorNavbar.tsx",
    );
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      content.includes("const supports3dView = Boolean(activeLangInfo.supports3d);"),
      "AnsatzEditorNavbar must not force 3D tab visible when activeLangInfo.supports3d is false",
    );
    assert.ok(content.includes("if (supportsDiagram)"), "AnsatzEditorNavbar must gate Diagram tab");
    assert.ok(content.includes("if (hasIconMode)"), "AnsatzEditorNavbar must gate Icon tab");
    assert.ok(content.includes("if (supports3dView)"), "AnsatzEditorNavbar must gate 3D tab");
    assert.ok(content.includes("if (supportsSimulation)"), "AnsatzEditorNavbar must gate Simulation tab");
  });

  it("verifies AnsatzVisualizerPane redirects away from unsupported diagram view", () => {
    const panePath = path.resolve(
      import.meta.dirname,
      "../../../packages/editor/src/workbench/panels/AnsatzVisualizerPane.tsx",
    );
    const content = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      content.includes("!activeLangInfo.supportsDiagram && !nextResults && !nextCad && !showAnalysisView"),
      "AnsatzVisualizerPane must redirect away from diagram view when supportsDiagram is false",
    );
    assert.ok(
      content.includes("activeLangInfo.supportsDiagram &&\n                activeLangInfo.diagramTypes"),
      "AnsatzVisualizerPane must guard diagramTypes switcher with activeLangInfo.supportsDiagram",
    );
  });

  it("verifies language info metadata for representative languages", () => {
    assert.equal(getLanguageInfo("modelica").supportsDiagram, true);
    assert.equal(getLanguageInfo("modelica").supportsSimulation, true);
    assert.equal(getLanguageInfo("modelica").supports3d, true);
    assert.equal(
      getLanguageInfo("modelica").diagramTypes?.some((d) => d.id === "icon"),
      true,
    );
    assert.equal(getLanguageInfo("csv").supportsDiagram, false);
    assert.equal(getLanguageInfo("csv").supportsSimulation, false);
    assert.equal(getLanguageInfo("csv").supports3d, false);
  });

  it("resolves per-language defaultView and defaultSplit via getDefaultLanguageView", async () => {
    const { getDefaultLanguageView } = await import("../../../packages/editor/src/workbench/constants.js");

    // Modelica has 2D diagram support -> defaults to diagram + code split
    assert.deepEqual(getDefaultLanguageView(getLanguageInfo("modelica")), {
      view: "diagram",
      isSplit: true,
    });

    // OpenSCAD, USD, CFD, FEA lack 2D diagram editing -> default to 3D canvas + code split
    for (const lang of ["scad", "usd", "cfd", "fea"]) {
      assert.deepEqual(getDefaultLanguageView(getLanguageInfo(lang)), {
        view: "3d",
        isSplit: true,
      });
    }

    // Simulation-only language without 2D/3D -> defaults to simulation + code split
    assert.deepEqual(getDefaultLanguageView(getLanguageInfo("comtrade")), {
      view: "simulation",
      isSplit: true,
    });

    // Inspector-only language -> defaults to inspector + code split
    assert.deepEqual(getDefaultLanguageView(getLanguageInfo("csv")), {
      view: "inspector",
      isSplit: true,
    });

    // Explicit defaultView / defaultSplit overrides
    assert.deepEqual(
      getDefaultLanguageView({
        ...getLanguageInfo("modelica"),
        defaultView: "code",
      }),
      { view: "code", isSplit: false },
    );
    assert.deepEqual(
      getDefaultLanguageView({
        ...getLanguageInfo("modelica"),
        defaultView: "3d",
        defaultSplit: false,
      }),
      { view: "3d", isSplit: false },
    );
  });

  it("uses narrower default code editor split ratio and per-language defaults in Ansatz and AnsatzEditorPage", () => {
    const ansatzPath = path.resolve(import.meta.dirname, "../../../packages/editor/src/workbench/AnsatzEditor.tsx");
    const ansatzSrc = fs.readFileSync(ansatzPath, "utf-8");
    assert.ok(ansatzSrc.includes("DEFAULT_SPLIT_RATIO = 0.62"), "Ansatz.tsx should default splitRatio to 0.62");
    assert.ok(
      ansatzSrc.includes("getDefaultLanguageView(initialLangInfo)"),
      "Ansatz.tsx should resolve initial view/split from getDefaultLanguageView",
    );

    const ansatzEditorPath = path.resolve(import.meta.dirname, "../src/pages/AnsatzEditorPage.tsx");
    const ansatzEditorSrc = fs.readFileSync(ansatzEditorPath, "utf-8");
    assert.ok(
      ansatzEditorSrc.includes("getDefaultLanguageView(getLanguageInfo(defaultInitialLang))"),
      "AnsatzEditorPage.tsx should initialize view/split from getDefaultLanguageView",
    );
  });
});
