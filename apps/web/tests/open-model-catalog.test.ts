// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEquationFallbackPreviewSvg,
  CURATED_OPEN_MODELS,
  inferModelDomain,
} from "../src/components/morsel/openModelCatalog.js";

describe("Morsel Open Model Catalog & Schematic Fallbacks", () => {
  it("provides curated multi-domain connected models with valid schematic SVGs and runnable fallback code", () => {
    assert.ok(CURATED_OPEN_MODELS.length >= 13, "Expected at least 13 curated models across engineering domains");

    const seenIds = new Set<string>();
    const domainsCovered = new Set<string>();

    for (const item of CURATED_OPEN_MODELS) {
      assert.ok(!seenIds.has(item.id), `Duplicate curated model id: ${item.id}`);
      seenIds.add(item.id);
      domainsCovered.add(item.category);

      assert.ok(item.diagramSvg.includes("<svg"), `Expected connected SVG schematic on ${item.id}`);
      assert.ok(item.diagramSvg.includes("</svg>"), `Expected closed SVG element on ${item.id}`);
      assert.ok(item.nodeCount > 0, `Expected positive nodeCount on ${item.id}`);
      assert.ok(item.fallbackCode.trim().length > 25, `Expected runnable fallbackCode on ${item.id}`);
      assert.ok(item.suggestedFilename.includes("."), `Expected file extension in suggestedFilename on ${item.id}`);
    }

    for (const expectedDomain of [
      "electrical",
      "mechanics",
      "fluids-thermal",
      "control",
      "power-grids",
      "robotics-cad",
      "systems",
    ]) {
      assert.ok(domainsCovered.has(expectedDomain), `Expected curated model coverage for '${expectedDomain}'`);
    }
  });

  it("infers engineering domains from fully qualified names and polyglot dialects", () => {
    assert.equal(inferModelDomain("Modelica.Electrical.Analog.Examples.ChuaCircuit", "modelica"), "electrical");
    assert.equal(inferModelDomain("Buildings.Fluid.Boilers.BoilerPolynomial", "modelica"), "fluids-thermal");
    assert.equal(inferModelDomain("Modelica.Mechanics.Rotational.Examples.First", "modelica"), "mechanics");
    assert.equal(inferModelDomain("PlanarMechanics.Examples.DoublePendulum", "modelica"), "robotics-cad");
    assert.equal(inferModelDomain("Modelica.Blocks.Examples.PID_Controller", "modelica"), "control");
    assert.equal(inferModelDomain("IEEE13NodeFeeder", "opendss"), "power-grids");
    assert.equal(inferModelDomain("ur5_arm", "urdf"), "robotics-cad");
    assert.equal(inferModelDomain("EVPowertrain", "sysml2"), "systems");
  });

  it("builds escaped, responsive blueprint SVGs for equation-only models", () => {
    const darkSvg = buildEquationFallbackPreviewSvg("Lotka<Volterra>", "Ecology & Dynamics", true);
    assert.ok(darkSvg.includes("<svg"));
    assert.ok(darkSvg.includes('width="100%"'));
    assert.ok(darkSvg.includes("Lotka&lt;Volterra&gt;"));
    assert.ok(darkSvg.includes("Ecology &amp; Dynamics"));
    assert.ok(!darkSvg.includes("Lotka<Volterra>"));

    const lightSvg = buildEquationFallbackPreviewSvg("LorenzSystem", "Chaotic ODE", false);
    assert.ok(lightSvg.includes("#f8fafc"));
  });
});
