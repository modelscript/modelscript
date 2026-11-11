// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCantera } from "@modelscript/cantera";
import {
  buildReactionCoordinateFromCantera,
  reconcileReactionBarrierChange,
  renderReactionCoordinateSvg,
} from "@modelscript/diagram/reaction-coordinate";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReactionCoordinateEditorProvider, ReactionCoordinatePanel } from "../src/reaction-coordinate-panel.js";

const SAMPLE_CANTERA_YAML = `description: Gri-Mech mini
phases:
  - name: gas
    elements: [O, H]
    species: [H2, O2, H, OH, H2O]
    thermo: ideal-gas
reactions:
  - equation: 2 H2 + O2 <=> 2 H2O
    rate-constant: {A: 1.2e+17, b: -1.0, Ea: 45000.0}
  - equation: O + H2 <=> H + OH
    rate-constant: {A: 3.87e+04, b: 2.7, Ea: 26191.8}
`;

describe("Reaction Coordinate & Potential Energy Surface (PES) Visualizer", () => {
  it("exposes ReactionCoordinatePanel and ReactionCoordinateEditorProvider viewType identifiers", () => {
    assert.equal(ReactionCoordinatePanel.viewType, "modelscript.reactionCoordinateViewer");
    assert.equal(ReactionCoordinateEditorProvider.viewType, "modelscript.reactionCoordinateEditor");
  });

  it("constructs potential energy surface profile and renders SVG with activation barrier", () => {
    const doc = parseCantera(SAMPLE_CANTERA_YAML);
    const rxn = doc.mechanism.reactions[0]!;

    const diagram = buildReactionCoordinateFromCantera(rxn, {
      reactionDeltaH: -45.0,
      energyUnit: "kJ/mol",
    });

    assert.ok(diagram, "Diagram should be generated");
    assert.equal(diagram.steps.length, 1);
    assert.equal(diagram.steps[0]?.activationEnergy, 45.0);
    assert.equal(diagram.states.length, 3); // Reactants, TS‡, Products

    const svg = renderReactionCoordinateSvg(diagram, { theme: "dark" });
    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("TS‡"), "Should render transition state label");
    assert.ok(svg.includes("Ea = 45.0 kJ/mol"), "Should annotate activation barrier");
  });

  it("reconciles interactive activation barrier slider adjustments back to Cantera YAML", () => {
    const doc = parseCantera(SAMPLE_CANTERA_YAML);
    const rxn = doc.mechanism.reactions[0]!;

    const newEaJoules = 52500.0;
    const updatedYaml = reconcileReactionBarrierChange(SAMPLE_CANTERA_YAML, rxn.equation, newEaJoules);

    assert.ok(updatedYaml.includes("52500"), "Updated YAML should contain new Ea value");
    assert.notEqual(updatedYaml, SAMPLE_CANTERA_YAML, "YAML should be modified");

    // Re-parse to verify syntactic validity of updated YAML
    const updatedDoc = parseCantera(updatedYaml);
    assert.equal(updatedDoc.mechanism.reactions[0]?.rateConstant.Ea, 52500.0);
  });
});
