// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerBnglToDae } from "./dae/bngl-to-dae.js";
import { indexBnglDocument } from "./indexing.js";
import { lintBngl } from "./lints/index.js";
import { parseBngl } from "./parser/bngl-parser.js";
import { bnglToModelica, bnglToSbmlXml } from "./projections/bngl-projections.js";
import { generateBnglNetwork, solveBngl, type BnglSolverOptions } from "./solvers/bngl-solver.js";

/**
 * ModelScript BioNetGen Rule-Based Modeling Language (.bngl) Definition.
 */
export const bnglLanguage = language({
  name: "bngl",
  fileExtensions: [".bngl"],
  maturity: "experimental",
  indexing: {
    indexFile: indexBnglDocument,
  },
  lsp: {
    fileExtensions: [".bngl"],
    icons: {
      light: "./assets/bngl/icon-light.png",
      dark: "./assets/bngl/icon-dark.png",
    },
  },

  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      return {
        startOffset: entry.startOffset,
        endOffset: entry.endOffset,
        newText: newValue.trim(),
      };
    }
    return null;
  },

  actions: [
    {
      id: "lint_bngl",
      title: "Lint BioNetGen Model",
      description:
        "Validates molecule types, component sites, internal states, bond topology, rate parameters, and polymerization safety.",
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
          name: "bngl_lint",
          displayName: "Lint BioNetGen Model",
          modelDescription:
            "Lints BioNetGen (.bngl) files for undeclared molecules/sites, invalid internal states, dangling bonds, and unbounded polymerization.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseBngl(text);
        return lintBngl(parsed);
      },
    },
    {
      id: "bngl_generate_network",
      title: "Generate BioNetGen Reaction Network",
      description:
        "Expands seed species across pattern-based reaction rules into concrete chemical species and reactions.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseBngl(text);
        return generateBnglNetwork(doc);
      },
    },
    {
      id: "bngl_simulate",
      title: "Simulate BioNetGen Network",
      description:
        "Expands the rule-based network and integrates concrete species and observable trajectories using RK4.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: BnglSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseBngl(text);
        return solveBngl(doc, params?.options);
      },
    },
    {
      id: "bngl_to_dae",
      title: "Lower BioNetGen to DAE",
      description: "Compiles expanded concrete species, observables, and mass-action fluxes into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseBngl(text);
        const dae = lowerBnglToDae(parsed);
        return {
          modelName: parsed.model.id || "BioNetGenModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "bngl_to_modelica",
      title: "Project BioNetGen to Modelica",
      description:
        "Synthesizes standalone Modelica 3.x biochemical reaction equations and observables from expanded BNGL rules.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseBngl(text);
        return bnglToModelica(parsed, params?.modelName);
      },
    },
    {
      id: "bngl_to_sbml",
      title: "Project BioNetGen to SBML XML",
      description: "Exports expanded BioNetGen species, observables, and reactions to SBML Level 3 Version 2 XML.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseBngl(text);
        return bnglToSbmlXml(parsed);
      },
    },
  ],
});
