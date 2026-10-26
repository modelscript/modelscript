// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildSbmlDiagram, renderSbmlSvg, type SbmlModelLike } from "../src/sbml-diagram-builder.js";

const sampleSbml: SbmlModelLike = {
  id: "glycolysis",
  name: "Glycolysis Pathway",
  compartments: [{ id: "cytosol", name: "Cytoplasm", size: 1.0 }],
  species: [
    { id: "Glc", name: "Glucose", compartment: "cytosol", initialConcentration: 5.0, boundaryCondition: true },
    { id: "G6P", name: "Glucose-6-P", compartment: "cytosol", initialConcentration: 0.2 },
    { id: "Pyr", name: "Pyruvate", compartment: "cytosol", initialConcentration: 0.1 },
  ],
  reactions: [
    {
      id: "HEXOKINASE",
      reversible: false,
      reactants: [{ species: "Glc", stoichiometry: 1 }],
      products: [{ species: "G6P", stoichiometry: 1 }],
    },
    {
      id: "GLYCOLYSIS_NET",
      reversible: false,
      reactants: [{ species: "G6P", stoichiometry: 1 }],
      products: [{ species: "Pyr", stoichiometry: 2 }],
    },
  ],
};

test("SBML Diagram: Builds X6 graph cells for compartments, species macromolecules, and reaction hubs", () => {
  const diag = buildSbmlDiagram(sampleSbml);
  assert.equal(diag.title, "Glycolysis Pathway");
  assert.ok(diag.cells.length >= 8);

  const comp = diag.cells.find((c) => c.id === "comp_cytosol");
  assert.ok(comp);
  assert.equal(comp.shape, "rect");

  const glc = diag.cells.find((c) => c.id === "species_Glc");
  assert.ok(glc);
  assert.equal(glc.shape, "rect");

  const rxn = diag.cells.find((c) => c.id === "rxn_HEXOKINASE");
  assert.ok(rxn);
  assert.equal((rxn.data as any)?.reversible, false);
});

test("SBML SVG: Renders standalone SBGN process description with compartments and stoichiometry arcs", () => {
  const svg = renderSbmlSvg(sampleSbml);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Glycolysis Pathway"));
  assert.ok(svg.includes("Cytoplasm"));
  assert.ok(svg.includes("Glucose"));
  assert.ok(svg.includes("Glucose-6-P"));
  assert.ok(svg.includes("Pyruvate"));
  assert.ok(svg.includes("HEXOKINASE"));
  assert.ok(svg.includes("GLYCOLYSIS_NET"));
  assert.ok(svg.endsWith("</svg>\n"));
});

test("SBML Compartments: Dynamically sizes bounding boxes and positions inter-compartment transport", () => {
  const multiCompModel: SbmlModelLike = {
    id: "glucose_import",
    name: "Glucose Cellular Uptake",
    compartments: [
      { id: "extracellular", name: "Extracellular Space", size: 10.0 },
      { id: "cytosol", name: "Cytosol", size: 1.0 },
    ],
    species: [
      { id: "Glc_ext", name: "Extracellular Glucose", compartment: "extracellular", initialConcentration: 10.0 },
      { id: "Glc_cyt", name: "Cytosolic Glucose", compartment: "cytosol", initialConcentration: 1.0 },
      { id: "G6P_cyt", name: "Cytosolic G6P", compartment: "cytosol", initialConcentration: 0.1 },
    ],
    reactions: [
      {
        id: "GLUT_TRANSPORT",
        reversible: true,
        reactants: [{ species: "Glc_ext", stoichiometry: 1 }],
        products: [{ species: "Glc_cyt", stoichiometry: 1 }],
      },
      {
        id: "HEXOKINASE",
        reversible: false,
        reactants: [{ species: "Glc_cyt", stoichiometry: 1 }],
        products: [{ species: "G6P_cyt", stoichiometry: 1 }],
      },
    ],
  };

  const diag = buildSbmlDiagram(multiCompModel);
  const extraComp = diag.cells.find((c) => c.id === "comp_extracellular");
  const cytComp = diag.cells.find((c) => c.id === "comp_cytosol");

  assert.ok(extraComp && extraComp.x !== undefined && extraComp.width !== undefined);
  assert.ok(cytComp && cytComp.x !== undefined && cytComp.width !== undefined);

  // Compartments must be side-by-side with non-overlapping x ranges
  assert.ok(cytComp.x >= extraComp.x + extraComp.width);

  // Species must be positioned inside their respective compartment bounding box
  const glcExt = diag.cells.find((c) => c.id === "species_Glc_ext");
  const glcCyt = diag.cells.find((c) => c.id === "species_Glc_cyt");
  assert.ok(glcExt && glcCyt);

  assert.ok(glcExt.x! >= extraComp.x);
  assert.ok(glcExt.x! + glcExt.width! <= extraComp.x + extraComp.width);

  assert.ok(glcCyt.x! >= cytComp.x);
  assert.ok(glcCyt.x! + glcCyt.width! <= cytComp.x + cytComp.width);

  // Transport reaction should be positioned between the two compartments
  const transport = diag.cells.find((c) => c.id === "rxn_GLUT_TRANSPORT");
  assert.ok(transport && transport.x !== undefined);
  assert.ok(transport.x > extraComp.x);
});
