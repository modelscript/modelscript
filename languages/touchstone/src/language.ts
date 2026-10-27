// SPDX-License-Identifier: AGPL-3.0-or-later

import { language } from "@modelscript/dsl";
import { lowerTouchstoneToDae } from "./dae/touchstone-to-dae.js";
import { lintTouchstone } from "./lints/index.js";
import { parseTouchstone } from "./parser/touchstone-parser.js";
import { touchstoneToModelica } from "./projections/touchstone-to-modelica.js";
import { fitStateSpaceModel, verifyPassivity } from "./solvers/vector-fitting.js";

const touchstoneExtensions = [
  ".s1p",
  ".s2p",
  ".s3p",
  ".s4p",
  ".s5p",
  ".s6p",
  ".s7p",
  ".s8p",
  ".s9p",
  ".s10p",
  ".s12p",
  ".s16p",
  ".s24p",
  ".s32p",
  ".ts2",
];

/**
 * ModelScript Touchstone N-Port (.sNp, .ts2) Language Definition.
 */
export const touchstoneLanguage = language({
  name: "touchstone",
  maturity: "experimental",
  fileExtensions: touchstoneExtensions,
  lsp: {
    fileExtensions: touchstoneExtensions,
    icons: {
      light: "./assets/touchstone/icon-light.png",
      dark: "./assets/touchstone/icon-dark.png",
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
      id: "lint_touchstone",
      title: "Lint Touchstone Deck",
      description: "Checks frequency monotonicity, reference resistance, and S-matrix symmetry.",
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
          name: "touchstone_lint",
          displayName: "Lint Touchstone File",
          modelDescription: "Lints Touchstone S-parameter file for format, passivity, and reciprocity violations.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseTouchstone(text);
        return lintTouchstone(parsed);
      },
    },
    {
      id: "touchstone_passivity",
      title: "Verify Passivity",
      description: "Computes matrix spectral norm ||S(f)||_2 across frequency points to verify passivity.",
      category: "verify",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseTouchstone(text);
        return verifyPassivity(deck);
      },
    },
    {
      id: "touchstone_to_dae",
      title: "Lower Touchstone to DAE",
      description: "Compiles Touchstone N-port model into companion state-space DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseTouchstone(text);
        const dae = lowerTouchstoneToDae(parsed);
        return {
          modelName: "NPortMacromodel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "touchstone_to_modelica",
      title: "Project Touchstone to Modelica",
      description: "Synthesizes standard Modelica 3.x Analog N-port state-space model.",
      category: "export",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseTouchstone(text);
        return touchstoneToModelica(parsed);
      },
    },
    {
      id: "touchstone_fit_macromodel",
      title: "Fit Vector Macromodel",
      description: "Fits rational pole-residue state space representation using vector fitting algorithm.",
      category: "simulate",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseTouchstone(text);
        return fitStateSpaceModel(deck);
      },
    },
  ],
});
