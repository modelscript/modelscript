// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, xmlRules, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerSbolToDae } from "./dae/sbol-to-dae.js";
import { sbolIndexing } from "./indexing.js";
import { lintSbol } from "./lints/index.js";
import { parseSbol } from "./parser/sbol-parser.js";
import { sbolToModelica, sbolToSbmlXml } from "./projections/sbol-projections.js";
import { solveGeneticCircuit, type GeneticCircuitSolverOptions } from "./solvers/genetic-circuit-solver.js";
import { sbolPolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript Synthetic Biology Open Language (.sbol, .ttl) Language Definition.
 */
export const sbolLanguage = language({
  polyglot: sbolPolyglotConfig,
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
        id: "sbolSimulate",
        label: "Simulate Genetic Circuit (Hill ODEs)",
        shortLabel: "Simulate Genetic",
        tooltip: "Simulate Genetic Circuit (Hill ODEs)",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "sbol_simulate",
      },
      {
        id: "sbolToDae",
        label: "Lower SBOL3 to DAE",
        shortLabel: "Lower SBOL3",
        tooltip: "Lower SBOL3 to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "sbol_to_dae",
      },
      {
        id: "sbolToModelica",
        label: "Project SBOL3 to Modelica",
        shortLabel: "Project SBOL3",
        tooltip: "Project SBOL3 to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "sbol_to_modelica",
      },
      {
        id: "sbolToSbml",
        label: "Project SBOL3 to SBML Level 3",
        shortLabel: "Project SBOL3",
        tooltip: "Project SBOL3 to SBML Level 3",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "sbol_to_sbml",
      },
      {
        id: "lintSbol",
        label: "Lint SBOL3 Genetic Circuit",
        shortLabel: "Lint SBOL3",
        tooltip: "Lint SBOL3 Genetic Circuit",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "lint_sbol",
      },
    ],
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
  extras: () => [/[ \t\r\n]+/],
  rules: xmlRules,
});

export default sbolLanguage;
