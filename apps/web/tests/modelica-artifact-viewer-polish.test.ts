// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { inferModelicaPreviewMode } from "../src/components/artifacts/modelica-preview-mode.js";

describe("Modelica Artifact Viewer Polish & Ergonomics Suite", () => {
  const ehaCode = `model ElectroHydrostaticActuator "Primary flight control Electro-Hydrostatic Actuator (EHA)"
  parameter Real Kp_pos = 1.80e4;
  Real x_cmd;
  Real x_pos(start = 0.0, fixed = true);
equation
  x_cmd = if time < 0.05 then 0.0 else 0.035 * (1.0 - exp(-18.0 * (time - 0.05)));
  der(x_pos) = 1.0;
end ElectroHydrostaticActuator;`;

  const circuitWithDiagramCode = `model RLC
  Modelica.Electrical.Analog.Basic.Resistor R(R = 10) annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));
equation
end RLC;`;

  it("prioritizes server-rendered SVG preview mode over stale explicitMode=diagram", () => {
    const simSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" data-preview-mode="simulation"><text>Plot</text></svg>`;
    const inferred = inferModelicaPreviewMode(ehaCode, "diagram", simSvg);
    assert.strictEqual(inferred, "simulation", "Must infer simulation when server SVG is a simulation plot");
  });

  it("infers simulation for equation-only models with no diagram annotations even when explicitMode=diagram", () => {
    const inferred = inferModelicaPreviewMode(ehaCode, "diagram");
    assert.strictEqual(
      inferred,
      "simulation",
      "Must infer simulation for models with equations and no diagram annotations",
    );
  });

  it("preserves diagram preview mode when model has placement annotations", () => {
    const inferred = inferModelicaPreviewMode(circuitWithDiagramCode, "diagram");
    assert.strictEqual(inferred, "diagram", "Must retain diagram mode when Placement annotations exist");
  });

  it("ensures ModelicaDiagramViewer suppresses top-right FloatingTools while interactive", () => {
    const viewerSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaDiagramViewer.tsx"),
      "utf8",
    );
    assert.ok(
      viewerSrc.includes('(!interactive || viewMode === "code") &&'),
      "ModelicaDiagramViewer must guard top-right FloatingTools when interactive to avoid colliding with canvas toolbar",
    );
  });

  it("ensures MorselVisualizerPane suppresses empty state modal when code is present or in embedded mode", () => {
    const paneSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx"),
      "utf8",
    );
    assert.ok(
      paneSrc.includes("!hideCenterFloatingToolbar &&") &&
        paneSrc.includes("!hasUserCode &&") &&
        paneSrc.includes("hasUserCode = useMemo"),
      "MorselVisualizerPane must suppress starter modal when user code is present or in embedded viewer mode",
    );
    assert.ok(
      paneSrc.includes("Equation-based model · No schematic components declared"),
      "MorselVisualizerPane must show a non-intrusive watermark for equation-only models instead of a modal dialog",
    );
  });

  it("ensures duplicate floating corner Diagram/Icon switcher is removed from MorselVisualizerPane", () => {
    const paneSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx"),
      "utf8",
    );
    assert.ok(
      !paneSrc.includes("Compact corner Diagram/Icon switcher"),
      "MorselVisualizerPane must not have duplicate corner Diagram/Icon switcher overlapping control bar",
    );
  });

  it("ensures Minimap HUD defaults to hidden in diagram index unless explicitly requested", () => {
    const indexSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts"),
      "utf8",
    );
    assert.ok(
      indexSrc.includes('container?.getAttribute("data-show-minimap") === "true"'),
      "packages/diagram must initialize Minimap HUD hidden by default to avoid canvas clutter",
    );
  });
});
