// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerSbolToDae } from "./dae/sbol-to-dae.js";
import { sbolIndexing } from "./indexing.js";
import { lintSbol } from "./lints/index.js";
import { parseSbol } from "./parser/sbol-parser.js";
import { sbolToModelica, sbolToSbmlXml } from "./projections/sbol-projections.js";
import { solveGeneticCircuit, type GeneticCircuitSolverOptions } from "./solvers/genetic-circuit-solver.js";

/**
 * ModelScript Synthetic Biology Open Language (.sbol, .ttl) Language Definition.
 */
export const sbolLanguage = language({
  name: "sbol",
  fileExtensions: [".sbol", ".ttl"],
  maturity: "experimental",
  indexing: sbolIndexing,
  lsp: {
    fileExtensions: [".sbol", ".ttl"],
    icons: {
      light: "./assets/sbol/icon-light.png",
      dark: "./assets/sbol/icon-dark.png",
    },
  },

  writeback: {
    operators: ["="],
  },

  actions: [
    {
      id: "lint_sbol",
      title: "Lint SBOL3 Genetic Circuit",
      description:
        "Validates IUPAC nucleotide sequences, CDS lengths, transcriptional unit ordering, RBS placement, and SBO interaction roles.",
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
          name: "sbol_lint",
          displayName: "Lint SBOL3 Genetic Circuit",
          modelDescription:
            "Lints SBOL3 genetic circuit file for sequence, feature, transcriptional unit, and interaction errors (M9501-M9510).",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseSbol(text);
        return lintSbol(parsed);
      },
    },
    {
      id: "sbol_simulate",
      title: "Simulate Genetic Circuit (Hill ODEs)",
      description:
        "Synthesizes and integrates Hill-function transcriptional activation/repression ODEs using 4th-order Runge-Kutta.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: GeneticCircuitSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseSbol(text);
        return solveGeneticCircuit(doc, params?.options);
      },
    },
    {
      id: "sbol_to_dae",
      title: "Lower SBOL3 to DAE",
      description:
        "Compiles protein concentrations, Hill regulatory factors, and synthesis/degradation rates into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseSbol(text);
        const dae = lowerSbolToDae(parsed);
        return {
          modelName: parsed.components[0]?.displayId ?? "SbolGeneticCircuit",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "sbol_to_modelica",
      title: "Project SBOL3 to Modelica",
      description: "Synthesizes standalone Modelica 3.x genetic regulatory ODE models.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseSbol(text);
        return sbolToModelica(parsed, params?.modelName);
      },
    },
    {
      id: "sbol_to_sbml",
      title: "Project SBOL3 to SBML Level 3",
      description: "Exports synthetic genetic circuit regulatory network to SBML Level 3 Version 2 XML.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseSbol(text);
        return sbolToSbmlXml(parsed, params?.modelName);
      },
    },
  ],
});
