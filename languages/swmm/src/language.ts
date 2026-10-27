// SPDX-License-Identifier: AGPL-3.0-or-later

import { language } from "@modelscript/dsl";
import { lowerSwmmToDae } from "./dae/swmm-to-dae.js";
import { lintSwmm } from "./lints/index.js";
import { parseSwmm } from "./parser/swmm-parser.js";
import { swmmToModelica } from "./projections/swmm-to-modelica.js";
import { routeNetworkFlow } from "./solver/hydraulic-solver.js";

/**
 * ModelScript US EPA SWMM 5.x (.inp) Language Definition.
 */
export const swmmLanguage = language({
  name: "swmm",
  fileExtensions: [".inp"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".inp"],
    icons: {
      light: "./assets/swmm/icon-light.png",
      dark: "./assets/swmm/icon-dark.png",
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
      id: "lint_swmm_network",
      title: "Lint SWMM Network",
      description: "Performs pre-flight hydraulic network connectivity, adverse slope, and roughness checks.",
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
          name: "swmm_lint",
          displayName: "Lint SWMM Deck",
          modelDescription: "Lints SWMM network file for dangling nodes, negative slopes, and missing cross sections.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseSwmm(text);
        return lintSwmm(parsed);
      },
    },
    {
      id: "swmm_to_dae",
      title: "Lower SWMM to DAE",
      description: "Compiles SWMM hydraulic network directly into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseSwmm(text);
        const dae = lowerSwmmToDae(parsed);
        return {
          modelName: "StormwaterNetwork",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "swmm_to_modelica",
      title: "Project SWMM to Modelica",
      description: "Synthesizes standard Modelica 3.x fluid network model from SWMM deck.",
      category: "export",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseSwmm(text);
        return swmmToModelica(parsed);
      },
    },
    {
      id: "swmm_route_flow",
      title: "Route Network Flow",
      description: "Solves 1D open-channel hydraulic routing and head balance using Manning equation.",
      category: "simulate",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseSwmm(text);
        return routeNetworkFlow(deck);
      },
    },
  ],
});
