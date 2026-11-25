// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Language Definition.
 *
 * Registers FEBio 3.x/4.x (.feb) and SOFA Framework (.scn) file extensions,
 * biomechanics & mesh quality linting (M9401–M9410), hyperelastic/biphasic solving,
 * linear-memory DAEBuilder lowering, and CalculiX (.inp) / Modelica (.mo) projections.
 */

import { language } from "@modelscript/dsl";
import { canIndexFebio, indexFebioDocument } from "./indexing.js";
import { lintFebioDocument } from "./lints/rules.js";
import { parseFebio } from "./parser/index.js";
import { febioToCalculixInp, febioToModelica } from "./projections/index.js";
import { lowerFebioToDae, solveHyperelasticMechanics } from "./solver/index.js";
import { febioPolyglotConfig } from "./tgg/index.js";

export const febioLanguage = language({
  polyglot: febioPolyglotConfig,
  name: "febio",
  fileExtensions: [".feb", ".scn"],
  maturity: "experimental",
  indexing: {
    indexFile: indexFebioDocument,
    canIndex: canIndexFebio,
  },
  lsp: {
    fileExtensions: [".feb", ".scn"],
  },
  rules: {
    Root: () => "febio",
  },

  ui: {
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "febioSolve",
        label: "Solve Hyperelastic & Biphasic Mechanics",
        shortLabel: "Solve",
        tooltip: "Solve Hyperelastic & Biphasic Mechanics",
        icon: "play",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "febio_solve",
      },
      {
        id: "febioToDae",
        label: "Lower FEBio Constitutive Model to DAE Arena",
        shortLabel: "Lower FEBio",
        tooltip: "Lower FEBio Constitutive Model to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "febio_to_dae",
      },
      {
        id: "febioToCalculix",
        label: "Export FEBio Model to CalculiX (.inp)",
        shortLabel: "Export FEBio",
        tooltip: "Export FEBio Model to CalculiX (.inp)",
        icon: "export",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "febio_to_calculix",
      },
      {
        id: "febioToModelica",
        label: "Export FEBio Model to Modelica 3.x",
        shortLabel: "Export FEBio",
        tooltip: "Export FEBio Model to Modelica 3.x",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "febio_to_modelica",
      },
      {
        id: "febioLint",
        label: "Lint FEBio / SOFA Biomechanics Model",
        shortLabel: "Lint FEBio",
        tooltip: "Lint FEBio / SOFA Biomechanics Model",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "febio_lint",
      },
    ],
  },
  actions: [
    {
      id: "febio_lint",
      title: "Lint FEBio / SOFA Biomechanics Model",
      description: "Runs FEBio continuum mechanics, Jacobian quality, and SOFA scene checks (M9401–M9410).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseFebio(context.documentText ?? "");
        return lintFebioDocument(doc);
      },
    },
    {
      id: "febio_solve",
      title: "Solve Hyperelastic & Biphasic Mechanics",
      description: "Evaluates neo-Hookean / Mooney-Rivlin strain energy W, Cauchy stress σ, and nodal displacements.",
      category: "simulate",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseFebio(context.documentText ?? "");
        return solveHyperelasticMechanics(doc);
      },
    },
    {
      id: "febio_to_dae",
      title: "Lower FEBio Constitutive Model to DAE Arena",
      description: "Lowers hyperelastic invariants, strain energy density, and stresses into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseFebio(context.documentText ?? "");
        const arena = lowerFebioToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "febio_to_calculix",
      title: "Export FEBio Model to CalculiX (.inp)",
      description: "Projects FEBio mesh, hyperelastic materials, and boundary conditions to CalculiX .inp format.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseFebio(context.documentText ?? "");
        return febioToCalculixInp(doc);
      },
    },
    {
      id: "febio_to_modelica",
      title: "Export FEBio Model to Modelica 3.x",
      description: "Projects FEBio hyperelastic constitutive equations to a Modelica 3.x package.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseFebio(context.documentText ?? "");
        return febioToModelica(doc);
      },
    },
  ],
});
