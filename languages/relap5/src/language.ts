// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { language } from "@modelscript/dsl";
import { lowerRelap5ToDae } from "./dae/relap5-to-dae.js";
import { lintRelap5 } from "./lints/index.js";
import { parseRelap5 } from "./parser/relap5-parser.js";
import { relap5ToModelica } from "./projections/relap5-to-modelica.js";
import { solvePointKinetics } from "./solvers/point-kinetics-solver.js";

/**
 * ModelScript US NRC RELAP5-3D (.i, .inp, .r5) Language Definition.
 */
export const relap5Language = language({
  name: "relap5",
  fileExtensions: [".i", ".inp", ".r5"],
  lsp: {
    fileExtensions: [".i", ".inp", ".r5"],
    icons: {
      light: "./assets/relap5/icon-light.png",
      dark: "./assets/relap5/icon-dark.png",
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
      id: "lint_relap5",
      title: "Lint RELAP5 Deck",
      description: "Validates volume connectivity, form loss coefficients, heat structures, and kinetics.",
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
          name: "relap5_lint",
          displayName: "Lint RELAP5 Deck",
          modelDescription:
            "Lints RELAP5 file for dangling volume junctions, negative pressures, and bad loss coefficients.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseRelap5(text);
        return lintRelap5(parsed);
      },
    },
    {
      id: "relap5_kinetics_solve",
      title: "Solve Reactor Point Kinetics",
      description: "Solves 6-group delayed neutron precursor ODEs with Doppler and moderator thermal feedback.",
      category: "simulate",
      execute: async (ctx: any, params: { documentText?: string | undefined; options?: any }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseRelap5(text);
        return solvePointKinetics(deck, params?.options);
      },
    },
    {
      id: "relap5_to_dae",
      title: "Lower RELAP5 to DAE",
      description: "Compiles two-phase volumes, junctions, and kinetics into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRelap5(text);
        const dae = lowerRelap5ToDae(parsed);
        return {
          modelName: parsed.title || "Relap5NuclearPlant",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "relap5_to_modelica",
      title: "Project RELAP5 to Modelica",
      description: "Synthesizes standard Modelica 3.x nuclear reactor thermal-hydraulic simulation model.",
      category: "export",
      execute: async (ctx: any, params: { documentText?: string | undefined; modelName?: string }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseRelap5(text);
        return relap5ToModelica(parsed, params?.modelName);
      },
    },
  ],
});
