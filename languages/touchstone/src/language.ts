// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, repeat1, seq } from "@modelscript/dsl";
import { lowerTouchstoneToDae } from "./dae/touchstone-to-dae.js";
import { indexTouchstoneFile } from "./indexing.js";
import { lintTouchstone } from "./lints/index.js";
import { parseTouchstone } from "./parser/touchstone-parser.js";
import { touchstoneToModelica } from "./projections/touchstone-to-modelica.js";
import { fitStateSpaceModel, verifyPassivity } from "./solvers/vector-fitting.js";
import { touchstonePolyglotConfig } from "./tgg/index.js";

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

const touchstoneGrammar = language({
  name: "touchstone",
  extras: () => [/[ \t\r\n]+/],
  rules: {
    Document: ($) => repeat($.Item),
    Item: ($) =>
      choice($.KeywordHeader, $.OptionMarker, $.TouchstoneComment, $.DeckNumber, $.DeckIdentifier, $.DeckColon),
    KeywordHeader: ($) => seq("[", repeat1(choice($.DeckIdentifier, $.DeckNumber)), "]"),
    OptionMarker: () => "#",
    TouchstoneComment: () => /![^\r\n]*/,
    DeckNumber: () => /[-+]?[0-9]*\.?[0-9]+([eEdD][-+]?[0-9]+)?/,
    DeckIdentifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
    DeckColon: () => ":",
  },
});

/**
 * ModelScript Touchstone N-Port (.sNp, .ts2) Language Definition.
 */
export const touchstoneLanguage = language({
  polyglot: touchstonePolyglotConfig,
  name: "touchstone",
  maturity: "beta",
  fileExtensions: touchstoneExtensions,
  extras: touchstoneGrammar.extras,
  rules: touchstoneGrammar.rules,
  indexing: {
    indexFile: indexTouchstoneFile,
  },
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

  ui: {
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "touchstonePassivity",
        label: "Check Passivity",
        shortLabel: "Passivity",
        tooltip: "Check S-parameter passivity across frequencies",
        icon: "shield-check",
        views: ["diagram", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "touchstone_passivity",
      },
      {
        id: "touchstoneFitMacromodel",
        label: "Fit Macromodel",
        shortLabel: "Fit Model",
        tooltip: "Fit rational macromodel to Touchstone S-parameters",
        icon: "graph",
        views: ["diagram", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "touchstone_fit_macromodel",
      },
      {
        id: "touchstoneToModelica",
        label: "Export to Modelica",
        shortLabel: "Modelica",
        tooltip: "Project Touchstone network to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "touchstone_to_modelica",
      },
      {
        id: "touchstoneToDae",
        label: "Lower to DAE",
        shortLabel: "DAE",
        tooltip: "Lower Touchstone network to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "touchstone_to_dae",
      },
      {
        id: "lintTouchstone",
        label: "Lint Touchstone Deck",
        shortLabel: "Lint",
        tooltip: "Lint Touchstone deck",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "lint_touchstone",
      },
    ],
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

export default touchstoneLanguage;
