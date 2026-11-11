// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMolecularDiagramFromSmiles, renderMolecularStructureSvg } from "../src/molecular-diagram-builder.js";
import {
  buildReactionCoordinateFromCantera,
  buildReactionCoordinateFromSteps,
  reconcileReactionBarrierChange,
  renderReactionCoordinateSvg,
} from "../src/reaction-coordinate-diagram-builder.js";

describe("Chemical & Molecular Diagram Builders (Path B)", () => {
  it("builds and renders reaction coordinate potential energy surface (PES) profile", () => {
    const diagram = buildReactionCoordinateFromSteps({
      title: "Methane Combustion Elementary Step",
      energyUnit: "kJ/mol",
      steps: [
        {
          id: "step1",
          equation: "CH4 + OH <=> CH3 + H2O",
          reactantEnergy: 0.0,
          barrierEnergy: 25.0,
          productEnergy: -60.0,
          reactants: ["CH4", "OH"],
          products: ["CH3", "H2O"],
          isReversible: true,
        },
      ],
    });

    assert.strictEqual(diagram.states.length, 3); // Reactant, TS, Product
    assert.strictEqual(diagram.states[0]?.name, "CH4 + OH");
    assert.strictEqual(diagram.states[1]?.isTransitionState, true);
    assert.strictEqual(diagram.states[2]?.energy, -60.0);

    const svg = renderReactionCoordinateSvg(diagram, { theme: "dark" });
    assert.ok(svg.includes("<svg"), "Should render SVG element");
    assert.ok(svg.includes('class="rxn-curve"'), "Should contain smooth PES curve");
    assert.ok(svg.includes("Ea = 25.0 kJ/mol"), "Should label activation energy barrier");
    assert.ok(svg.includes("CH4 + OH"), "Should label reactant state");
  });

  it("builds reaction coordinate profile from Cantera reaction and reconciles barrier updates", () => {
    const canteraRxn = {
      id: "R1",
      equation: "H + O2 <=> O + OH",
      rateConstant: { A: 3.52e16, b: -0.7, Ea: 71400 }, // Ea = 71.4 kJ/mol
      reversible: true,
      reactants: [
        { species: "H", stoichiometry: 1 },
        { species: "O2", stoichiometry: 1 },
      ],
      products: [
        { species: "O", stoichiometry: 1 },
        { species: "OH", stoichiometry: 1 },
      ],
    };

    const diagram = buildReactionCoordinateFromCantera(canteraRxn, {
      reactantEnergy: 0.0,
      reactionDeltaH: 70.0, // endothermic
      energyUnit: "kJ/mol",
    });

    assert.strictEqual(diagram.steps[0]?.id, "R1");
    assert.strictEqual(diagram.steps[0]?.activationEnergy, 71.4);

    const svg = renderReactionCoordinateSvg(diagram);
    assert.ok(svg.includes("Ea = 71.4 kJ/mol"));

    // Bi-directional source reconciliation
    const yamlSource = `
reactions:
- equation: H + O2 <=> O + OH
  rate-constant: {A: 3.52e+16, b: -0.7, Ea: 71400}
`;
    const updatedYaml = reconcileReactionBarrierChange(yamlSource, "H + O2 <=> O + OH", 68500);
    assert.ok(updatedYaml.includes("Ea: 68500"), "Should update activation energy in YAML source");
  });

  it("builds and renders 2D molecular structure diagram from SMILES with CPK coloring", () => {
    const smiles = "CC(=O)O"; // Acetic acid
    const molDiagram = buildMolecularDiagramFromSmiles(smiles, { title: "Acetic Acid" });

    assert.ok(molDiagram.atoms.length >= 4, "Should extract atoms for acetic acid");
    assert.ok(molDiagram.bonds.length >= 3, "Should extract bonds");

    const svg = renderMolecularStructureSvg(molDiagram, { theme: "light" });
    assert.ok(svg.includes("<svg"), "Should render SVG");
    assert.ok(svg.includes("Acetic Acid"), "Should include title");
    assert.ok(svg.includes('fill="#ef4444"'), "Should use red CPK color for Oxygen");
    assert.ok(svg.includes('class="bonds"'), "Should render chemical bonds");
  });
});
