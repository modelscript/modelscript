// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerSmilesToDae, type SmilesDaeOptions } from "./dae/smiles-to-dae.js";
import { smilesGrammar } from "./grammar/index.js";
import { indexSmilesFile } from "./indexing.js";
import { lintSmiles } from "./lints/index.js";
import { parseSmilesDocument } from "./parser/smiles-parser.js";
import { smilesToAspenDeck, smilesToModelica } from "./projections/smiles-to-modelica.js";
import { solveMolecularProperties } from "./solvers/property-estimator.js";
import { smilesPolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript Cheminformatics SMILES/SMARTS & MDL Molfile/SDF (.smi, .smarts, .mol, .sdf) Language Definition.
 */
export const smilesLanguage = language({
  polyglot: smilesPolyglotConfig,
  name: "smiles",
  fileExtensions: [".smi", ".smarts", ".mol", ".sdf"],
  maturity: "beta",
  word: smilesGrammar.word,
  extras: smilesGrammar.extras,
  conflicts: smilesGrammar.conflicts,
  rules: smilesGrammar.rules,
  indexing: {
    indexFile: indexSmilesFile,
  },
  lsp: {
    fileExtensions: [".smi", ".smarts", ".mol", ".sdf"],
    icons: {
      light: "./assets/smiles/icon-light.png",
      dark: "./assets/smiles/icon-dark.png",
    },
  },

  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      return { startOffset: entry.startOffset, endOffset: entry.endOffset, newText: newValue.trim() };
    }
    return null;
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
        id: "smilesEstimateProperties",
        label: "Estimate Thermophysical & Molecular Properties",
        shortLabel: "Estimate",
        tooltip: "Estimate Thermophysical & Molecular Properties",
        icon: "beaker",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "smiles_estimate_properties",
      },
      {
        id: "smilesToDae",
        label: "Lower SMILES Species to DAE",
        shortLabel: "Lower SMILES",
        tooltip: "Lower SMILES Species to DAE",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "smiles_to_dae",
      },
      {
        id: "smilesToModelica",
        label: "Project SMILES to Modelica",
        shortLabel: "Project SMILES",
        tooltip: "Project SMILES to Modelica",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "smiles_to_modelica",
      },
      {
        id: "smilesToAspen",
        label: "Project SMILES to Aspen Plus Deck",
        shortLabel: "Project SMILES",
        tooltip: "Project SMILES to Aspen Plus Deck",
        icon: "export",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "smiles_to_aspen",
      },
      {
        id: "lintSmiles",
        label: "Lint SMILES / Molfile Graph",
        shortLabel: "Lint SMILES",
        tooltip: "Lint SMILES / Molfile Graph",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "lint_smiles",
      },
    ],
  },
  actions: [
    {
      id: "lint_smiles",
      title: "Lint SMILES / Molfile Graph",
      description: "Validates ring closures, branch parentheses, valence bounds, aromaticity, and chirality.",
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
          name: "smiles_lint",
          displayName: "Lint SMILES / Molfile Graph",
          modelDescription:
            "Lints SMILES/SMARTS and Molfile/SDF graphs for unclosed rings, valence errors, and Hückel aromaticity.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseSmilesDocument(text);
        return lintSmiles(parsed);
      },
    },
    {
      id: "smiles_estimate_properties",
      title: "Estimate Thermophysical & Molecular Properties",
      description:
        "Computes exact Hill formula, molar mass, TPSA, logP, and Joback-Reid critical properties (Tb, Tc, Pc, Vc, Cp).",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseSmilesDocument(text);
        return solveMolecularProperties(doc);
      },
    },
    {
      id: "smiles_to_dae",
      title: "Lower SMILES Species to DAE",
      description:
        "Compiles Joback-Reid critical properties, ideal-gas Cp(T), and Antoine vapor pressure equations into DAEBuilder.",
      category: "transform",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: SmilesDaeOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseSmilesDocument(text);
        const dae = lowerSmilesToDae(parsed, params?.options);
        return {
          modelName: parsed.molecules[0]?.name || "SmilesThermophysicalSystem",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "smiles_to_modelica",
      title: "Project SMILES to Modelica",
      description: "Synthesizes Modelica 3.x thermodynamic species property records and vapor pressure equations.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseSmilesDocument(text);
        return smilesToModelica(parsed, params?.modelName);
      },
    },
    {
      id: "smiles_to_aspen",
      title: "Project SMILES to Aspen Plus Deck",
      description: "Generates Aspen Plus COMPONENTS and PROP-DATA cards from Joback group-contribution estimates.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; title?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseSmilesDocument(text);
        return smilesToAspenDeck(parsed, params?.title);
      },
    },
  ],
});
