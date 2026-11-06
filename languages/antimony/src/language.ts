// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerAntimonyToDae } from "./dae/antimony-to-dae.js";
import { lintAntimony } from "./lints/index.js";
import { parseAntimony } from "./parser/antimony-parser.js";
import { antimonyToModelica, antimonyToSbmlXml } from "./projections/antimony-projections.js";
import { solveAntimony, type AntimonySolverOptions } from "./solvers/antimony-solver.js";

/**
 * ModelScript Antimony Modular Reaction Network Language (.ant) Definition.
 */
export const antimonyLanguage = language({
  name: "antimony",
  fileExtensions: [".ant"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".ant"],
    icons: {
      light: "./assets/antimony/icon-light.png",
      dark: "./assets/antimony/icon-dark.png",
    },
  },

  writeback: {
    operators: ["="],
  },

  actions: [
    {
      id: "lint_antimony",
      title: "Lint Antimony Model",
      description: "Validates modules, compartments, stoichiometry, rate laws, submodel cycles, and event triggers.",
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
          name: "antimony_lint",
          displayName: "Lint Antimony Model",
          modelDescription:
            "Lints Antimony (.ant) files for empty modules, undefined compartments, missing rate laws, and submodel cycles.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseAntimony(text);
        return lintAntimony(parsed);
      },
    },
    {
      id: "antimony_simulate",
      title: "Simulate Antimony Network",
      description:
        "Integrates coupled stoichiometric reactions, rate rules, assignment rules, and discrete events using RK4.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: AntimonySolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseAntimony(text);
        return solveAntimony(doc, params?.options);
      },
    },
    {
      id: "antimony_to_dae",
      title: "Lower Antimony to DAE",
      description: "Compiles compartments, species molar balances, reaction fluxes, and rate rules into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseAntimony(text);
        const dae = lowerAntimonyToDae(parsed);
        return {
          modelName: parsed.mainModule.id || "AntimonyModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "antimony_to_modelica",
      title: "Project Antimony to Modelica",
      description: "Synthesizes standalone Modelica 3.x biochemical reaction equations, fluxes, and event blocks.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseAntimony(text);
        return antimonyToModelica(parsed, params?.modelName);
      },
    },
    {
      id: "antimony_to_sbml",
      title: "Project Antimony to SBML XML",
      description: "Exports Antimony modules and reactions to SBML Level 3 Version 2 XML.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseAntimony(text);
        return antimonyToSbmlXml(parsed);
      },
    },
  ],
});
