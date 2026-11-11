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

test("SBML Fed-Batch CHO Bioreactor: Non-overlapping species layout, membrane transport channel, and clean cascade", () => {
  const choModel: SbmlModelLike = {
    id: "CHO_FedBatch_mAb_Glycosylation_Network",
    name: "CHO Bioreactor IgG1 mAb Metabolism & Golgi Glycosylation",
    compartments: [
      { id: "Bioreactor_Media", name: "Extracellular Bioreactor Broth (2000L)", size: 2000.0 },
      { id: "CHO_Cytosol", name: "Intracellular Cytosol", size: 45.0 },
      { id: "Golgi_Lumen", name: "Golgi Apparatus Cis-to-Trans Cisternae", size: 4.2 },
    ],
    species: [
      { id: "GLC_ext", name: "Extracellular D-Glucose", compartment: "Bioreactor_Media", initialConcentration: 32.5 },
      { id: "GLN_ext", name: "Extracellular L-Glutamine", compartment: "Bioreactor_Media", initialConcentration: 6.8 },
      { id: "LAC_ext", name: "Extracellular L-Lactate", compartment: "Bioreactor_Media", initialConcentration: 1.2 },
      { id: "PYR_cyt", name: "Cytosolic Pyruvate", compartment: "CHO_Cytosol", initialConcentration: 2.4 },
      {
        id: "UDP_Gal",
        name: "UDP-Galactose Nucleotide Sugar Donor",
        compartment: "Golgi_Lumen",
        initialConcentration: 0.85,
      },
      {
        id: "mAb_G0F",
        name: "Agalactosylated IgG1 Glycoform (G0F)",
        compartment: "Golgi_Lumen",
        initialConcentration: 4.1,
      },
      {
        id: "mAb_G1F",
        name: "Monogalactosylated IgG1 Glycoform (G1F)",
        compartment: "Golgi_Lumen",
        initialConcentration: 1.65,
      },
      {
        id: "mAb_G2F",
        name: "Digalactosylated IgG1 Glycoform (G2F)",
        compartment: "Golgi_Lumen",
        initialConcentration: 0.42,
      },
    ],
    reactions: [
      {
        id: "R1_GLUT1_Glucose_Uptake",
        reversible: false,
        reactants: [{ species: "GLC_ext", stoichiometry: 1.0 }],
        products: [{ species: "PYR_cyt", stoichiometry: 2.0 }],
      },
      {
        id: "R2_LDH_Lactate_Overflow",
        reversible: true,
        reactants: [{ species: "PYR_cyt", stoichiometry: 1.0 }],
        products: [{ species: "LAC_ext", stoichiometry: 1.0 }],
      },
      {
        id: "R3_Beta4GalT_G0F_to_G1F",
        reversible: false,
        reactants: [
          { species: "mAb_G0F", stoichiometry: 1.0 },
          { species: "UDP_Gal", stoichiometry: 1.0 },
        ],
        products: [{ species: "mAb_G1F", stoichiometry: 1.0 }],
      },
      {
        id: "R4_Beta4GalT_G1F_to_G2F",
        reversible: false,
        reactants: [
          { species: "mAb_G1F", stoichiometry: 1.0 },
          { species: "UDP_Gal", stoichiometry: 1.0 },
        ],
        products: [{ species: "mAb_G2F", stoichiometry: 1.0 }],
      },
    ],
  };

  const diag = buildSbmlDiagram(choModel);

  // 1. Verify compartment boundaries
  const mediaComp = diag.cells.find((c) => c.id === "comp_Bioreactor_Media")!;
  const cytComp = diag.cells.find((c) => c.id === "comp_CHO_Cytosol")!;
  const golgiComp = diag.cells.find((c) => c.id === "comp_Golgi_Lumen")!;
  assert.ok(mediaComp && cytComp && golgiComp);
  assert.equal(mediaComp.data?.isContainer, true);

  // Compartments are arranged left-to-right
  assert.ok(cytComp.x! >= mediaComp.x! + mediaComp.width!);
  assert.ok(golgiComp.x! >= cytComp.x! + cytComp.width!);

  // 2. Transport reactions R1 & R2 must be in the channel between media and cytosol, NOT overlapping LAC_ext
  const r1 = diag.cells.find((c) => c.id === "rxn_R1_GLUT1_Glucose_Uptake")!;
  const r2 = diag.cells.find((c) => c.id === "rxn_R2_LDH_Lactate_Overflow")!;
  const lacExt = diag.cells.find((c) => c.id === "species_LAC_ext")!;
  assert.ok(r1 && r2 && lacExt);

  // Both transport reactions are outside the media compartment
  assert.ok(r1.x! >= mediaComp.x! + mediaComp.width!);
  assert.ok(r2.x! >= mediaComp.x! + mediaComp.width!);
  // And to the left of the cytosol compartment
  assert.ok(r1.x! + r1.width! <= cytComp.x!);
  assert.ok(r2.x! + r2.width! <= cytComp.x!);

  // Transport reactions must not collide with each other vertically
  assert.ok(Math.abs(r1.y! - r2.y!) >= 30, "R1 and R2 must have vertical separation in the channel");

  // LAC_ext must be inside the media compartment, not colliding with R1
  assert.ok(lacExt.x! >= mediaComp.x!);
  assert.ok(lacExt.x! + lacExt.width! <= mediaComp.x! + mediaComp.width!);
  assert.ok(Math.abs(lacExt.x! - r1.x!) > 40, "R1 must not overlap LAC_ext");

  // 3. Golgi pathway: mAb_G0F -> R3 -> mAb_G1F -> R4 -> mAb_G2F horizontal sequence
  const g0f = diag.cells.find((c) => c.id === "species_mAb_G0F")!;
  const r3 = diag.cells.find((c) => c.id === "rxn_R3_Beta4GalT_G0F_to_G1F")!;
  const g1f = diag.cells.find((c) => c.id === "species_mAb_G1F")!;
  const r4 = diag.cells.find((c) => c.id === "rxn_R4_Beta4GalT_G1F_to_G2F")!;
  const g2f = diag.cells.find((c) => c.id === "species_mAb_G2F")!;
  const udpGal = diag.cells.find((c) => c.id === "species_UDP_Gal")!;

  assert.ok(g0f && r3 && g1f && r4 && g2f && udpGal);

  // Strict left-to-right ordering with clearance
  assert.ok(r3.x! >= g0f.x! + g0f.width!);
  assert.ok(g1f.x! >= r3.x! + r3.width!);
  assert.ok(r4.x! >= g1f.x! + g1f.width!);
  assert.ok(g2f.x! >= r4.x! + r4.width!);

  // UDP_Gal donor is placed above the pathway line
  assert.ok(udpGal.y! + udpGal.height! <= g0f.y!);

  // 4. Edges must specify router: "normal" to prevent obstacle detour loops
  const edges = diag.cells.filter((c) => c.shape === "edge");
  assert.ok(edges.length >= 6);
  for (const edge of edges) {
    assert.deepEqual(edge.router, { name: "normal" });
    assert.ok(edge.connector);
  }

  // 5. SVG export renders cleanly
  const svg = renderSbmlSvg(choModel);
  assert.ok(svg.includes("CHO Bioreactor IgG1 mAb Metabolism"));
  assert.ok(svg.includes("Extracellular Bioreactor Broth (2000L)"));
  assert.ok(svg.includes("Golgi Apparatus Cis-to-Trans Cisternae"));
  assert.ok(svg.includes("R1_GLUT1_Glucose_Uptake"));
  assert.ok(svg.includes("R3_Beta4GalT_G0F_to_G1F"));
});
