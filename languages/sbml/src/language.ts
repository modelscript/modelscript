// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { language } from "@modelscript/dsl";
import { lowerSbmlToDae } from "./dae/sbml-to-dae.js";
import { lintSbml } from "./lints/index.js";
import { parseSbml } from "./parser/sbml-parser.js";
import { sbmlToModelica } from "./projections/sbml-to-modelica.js";
import { solveReactions } from "./solvers/reaction-solver.js";

/**
 * ModelScript Systems Biology Markup Language (.sbml, .xml) Language Definition.
 */
export const sbmlLanguage = language({
  name: "sbml",
  fileExtensions: [".sbml", ".xml"],
  lsp: {
    fileExtensions: [".sbml", ".xml"],
    icons: {
      light: "./assets/sbml/icon-light.png",
      dark: "./assets/sbml/icon-dark.png",
    },
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
      id: "lint_sbml",
      title: "Lint SBML Model",
      description: "Validates species, compartments, stoichiometry, and kinetic law consistency.",
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
          name: "sbml_lint",
          displayName: "Lint SBML Model",
          modelDescription: "Lints SBML file for missing compartments, undefined species, and empty reactions.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseSbml(text);
        return lintSbml(parsed);
      },
    },
    {
      id: "sbml_simulate",
      title: "Simulate Biochemical Network",
      description: "Solves chemical reaction kinetics ODEs using 4th-order Runge-Kutta numerical integration.",
      category: "simulate",
      execute: async (ctx: any, params: { documentText?: string | undefined; options?: any }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseSbml(text);
        return solveReactions(doc, params?.options);
      },
    },
    {
      id: "sbml_to_dae",
      title: "Lower SBML to DAE",
      description: "Compiles species concentrations, stoichiometry, and reaction fluxes into DAEBuilder.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseSbml(text);
        const dae = lowerSbmlToDae(parsed);
        return {
          modelName: parsed.model.id || "SbmlModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "sbml_to_modelica",
      title: "Project SBML to Modelica",
      description: "Synthesizes standard Modelica 3.x biochemical reaction equations and flux variables.",
      category: "export",
      execute: async (ctx: any, params: { documentText?: string | undefined; modelName?: string }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseSbml(text);
        return sbmlToModelica(parsed, params?.modelName);
      },
    },
  ],
});
