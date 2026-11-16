// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getLanguageInfo } from "../src/components/morsel/constants.js";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { MorselMobileTabBar } = await import("../src/components/morsel/panels/MorselMobileTabBar.js");

describe("Morsel Language Capability Tab Hiding", () => {
  const noop = () => {};

  it("hides unsupported tabs in MorselMobileTabBar for each language", () => {
    const renderMobileBar = (dialect: string) =>
      renderToStaticMarkup(
        React.createElement(MorselMobileTabBar, {
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

  it("verifies PlaygroundNavbar gates Diagram, Icon, 3D, and Simulation tabs strictly by language capabilities", () => {
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");
    const content = fs.readFileSync(navbarPath, "utf-8");

    assert.ok(
      content.includes("const supports3dView = Boolean(activeLangInfo.supports3d);"),
      "PlaygroundNavbar must not force 3D tab visible when activeLangInfo.supports3d is false",
    );
    assert.ok(content.includes("if (supportsDiagram)"), "PlaygroundNavbar must gate Diagram tab");
    assert.ok(content.includes("if (hasIconMode)"), "PlaygroundNavbar must gate Icon tab");
    assert.ok(content.includes("if (supports3dView)"), "PlaygroundNavbar must gate 3D tab");
    assert.ok(content.includes("if (supportsSimulation)"), "PlaygroundNavbar must gate Simulation tab");
  });

  it("verifies MorselVisualizerPane redirects away from unsupported diagram view", () => {
    const panePath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx");
    const content = fs.readFileSync(panePath, "utf-8");

    assert.ok(
      content.includes("!activeLangInfo.supportsDiagram && !nextResults && !nextCad && !showAnalysisView"),
      "MorselVisualizerPane must redirect away from diagram view when supportsDiagram is false",
    );
    assert.ok(
      content.includes("activeLangInfo.supportsDiagram &&\n                activeLangInfo.diagramTypes"),
      "MorselVisualizerPane must guard diagramTypes switcher with activeLangInfo.supportsDiagram",
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
});
