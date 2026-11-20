// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerPdbToDae, type PdbDaeOptions } from "./dae/pdb-to-dae.js";
import { pdbGrammar } from "./grammar/pdb-grammar.js";
import { indexPdbFile } from "./indexing.js";
import { lintPdb } from "./lints/index.js";
import { parsePdb } from "./parser/pdb-parser.js";
import { pdbToModelica } from "./projections/pdb-to-modelica.js";
import { solveProteinBiophysics, type ProteinBiophysicsOptions } from "./solvers/protein-biophysics-solver.js";
import { pdbPolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript Protein Data Bank (.pdb, .ent) & Macromolecular CIF (.cif, .mmcif) Language Definition.
 */
export const pdbLanguage = language({
  polyglot: pdbPolyglotConfig,
  name: "pdb",
  fileExtensions: [".pdb", ".ent", ".cif", ".mmcif"],
  maturity: "beta",
  word: pdbGrammar.word,
  extras: pdbGrammar.extras,
  conflicts: pdbGrammar.conflicts,
  rules: pdbGrammar.rules,
  indexing: {
    indexFile: indexPdbFile,
  },
  lsp: {
    fileExtensions: [".pdb", ".ent", ".cif", ".mmcif"],
    folding: pdbGrammar.lsp?.folding,
    outline: pdbGrammar.lsp?.outline,
    icons: {
      light: "./assets/pdb/icon-light.png",
      dark: "./assets/pdb/icon-dark.png",
    },
  },
  ui: {
    panels: [
      {
        id: "pdbEditor",
        viewType: "modelscript.pdbEditor",
        title: "3D Molecular & Protein Structure Studio",
        shortTitle: "PDB 3D",
        selector: ["*.pdb", "*.ent", "*.cif", "*.mmcif"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/PdbPanel.tsx",
        artifactViewTypes: ["pdb", "mmcif"],
      },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        command: "morsel:autoLayout",
      },
      {
        id: "pdbSolveBiophysics",
        label: "Solve Protein Biophysics & GNM Fluctuations",
        shortLabel: "Solve Protein",
        tooltip: "Solve Protein Biophysics & GNM Fluctuations",
        icon: "beaker",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "pdb_solve_biophysics",
      },
      {
        id: "pdbToDae",
        label: "Lower PDB Elastic Network to DAE",
        shortLabel: "Lower PDB",
        tooltip: "Lower PDB Elastic Network to DAE",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "pdb_to_dae",
      },
      {
        id: "pdbToModelica",
        label: "Project PDB Structure to Modelica",
        shortLabel: "Project PDB",
        tooltip: "Project PDB Structure to Modelica",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "pdb_to_modelica",
      },
      {
        id: "lintPdb",
        label: "Lint PDB / mmCIF Structure",
        shortLabel: "Lint PDB",
        tooltip: "Lint PDB / mmCIF Structure",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "lint_pdb",
      },
    ],
  },

  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      return { startOffset: entry.startOffset, endOffset: entry.endOffset, newText: newValue.trim() };
    }
    return null;
  },

  actions: [
    {
      id: "lint_pdb",
      title: "Lint PDB / mmCIF Structure",
      description:
        "Validates steric clashes, peptide backbone continuity, Ramachandran dihedrals, occupancy, B-factors, and SSBOND/CONECT records.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "pdb_lint",
          displayName: "Lint PDB / mmCIF Structure",
          modelDescription:
            "Lints macromolecular PDB and mmCIF structures for steric clashes, Ramachandran outliers, missing backbone atoms, and broken peptide bonds.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parsePdb(text);
        return lintPdb(parsed);
      },
    },
    {
      id: "pdb_solve_biophysics",
      title: "Solve Protein Biophysics & GNM Fluctuations",
      description:
        "Computes Radius of Gyration (Rg), Ramachandran (phi, psi) torsions, C_alpha Kirchhoff contact matrix, and Gaussian Network Model (GNM) B-factors.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: ProteinBiophysicsOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parsePdb(text);
        return solveProteinBiophysics(doc, params?.options);
      },
    },
    {
      id: "pdb_to_dae",
      title: "Lower PDB Elastic Network to DAE",
      description:
        "Compiles coarse-grained C_alpha harmonic spring network ODEs directly into DAEBuilder linear memory.",
      category: "transform",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: PdbDaeOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parsePdb(text);
        const dae = lowerPdbToDae(parsed, params?.options);
        return {
          modelName: parsed.id ? `PDB_${parsed.id}` : "ProteinElasticNetwork",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "pdb_to_modelica",
      title: "Project PDB Structure to Modelica",
      description:
        "Synthesizes a Modelica 3.x coarse-grained C_alpha elastic network oscillator model from PDB/mmCIF coordinates.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parsePdb(text);
        return pdbToModelica(parsed, params?.modelName);
      },
    },
  ],
});
