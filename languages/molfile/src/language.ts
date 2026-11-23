// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInMolfileLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerMolfileToDae, type MolfileDaeOptions } from "./dae/molfile-to-dae.js";
import { molfileGrammar } from "./grammar/index.js";
import { indexMolfileFile } from "./indexing.js";
import { lintMolfile } from "./lints/index.js";
import { parseMolfileDocument } from "./parser/molfile-parser.js";
import { molfileToPdb, type MolfileToPdbOptions } from "./projections/molfile-to-pdb.js";
import { molfileToSmiles } from "./projections/molfile-to-smiles.js";
import { analyzeMolfileDocument } from "./solver/analyzer.js";

/**
 * ModelScript MDL Molfile (V2000/V3000) & SDF Chemical Structure Format (`.mol`, `.sdf`) Language Definition.
 */
export const molfileLanguage = language({
  name: "molfile",
  fileExtensions: [".mol", ".sdf"],
  maturity: "beta",
  word: molfileGrammar.word,
  extras: molfileGrammar.extras,
  conflicts: molfileGrammar.conflicts,
  rules: molfileGrammar.rules,
  indexing: {
    indexFile: indexMolfileFile,
  },
  lsp: {
    fileExtensions: [".mol", ".sdf"],
    folding: ["V3000Directive", "SdfDataHeader"],
    outline: ["SdfDataHeader", "PropertyEndLine", "SdfDelimiter"],
  },
  actions: [
    {
      id: "lint_molfile",
      title: "Lint Molfile / SDF Structure",
      description:
        "Validates MDL V2000/V3000 counts, bond connectivity, element symbols, stereo flags, and valence bounds.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintMolfile(parseMolfileDocument(text));
      },
    },
    {
      id: "molfile_analyze",
      title: "Analyze Molecular Graph & 3D Geometry",
      description:
        "Computes Hill formula, molecular weight, exact mass, SSSR rings, bond lengths/angles/dihedrals, and UFF stretch energy.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return analyzeMolfileDocument(parseMolfileDocument(text));
      },
    },
    {
      id: "molfile_to_dae",
      title: "Lower Molfile Harmonic Mechanics to DAE",
      description: "Compiles 3D atomic coordinates and harmonic bond-stretch equations into DAEBuilder.",
      category: "transform",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: MolfileDaeOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseMolfileDocument(text);
        const dae = lowerMolfileToDae(doc, params?.options);
        return {
          modelName: doc.records[0]?.name || "MolfileMechanicsSystem",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "molfile_to_smiles",
      title: "Project Molfile to SMILES",
      description: "Projects MDL Molfile/SDF connection tables into SMILES notation.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return molfileToSmiles(parseMolfileDocument(text));
      },
    },
    {
      id: "molfile_to_pdb",
      title: "Project Molfile to PDB",
      description: "Projects MDL Molfile/SDF 3D coordinates and connectivity into Protein Data Bank (PDB) format.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; pdbOptions?: MolfileToPdbOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return molfileToPdb(parseMolfileDocument(text), params?.pdbOptions);
      },
    },
  ],
});

registerBuiltInMolfileLibrarySync();
