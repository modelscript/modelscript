// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInAspenLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerAspenToDae } from "./dae/aspen-to-dae.js";
import { canIndexAspen, indexAspenDocument } from "./indexing.js";
import { lintAspen } from "./lints/index.js";
import { parseAspen } from "./parser/aspen-parser.js";
import { aspenToModelica } from "./projections/aspen-to-modelica.js";
import { solveFlashRachfordRice } from "./solvers/flash-solver.js";
import { aspenPolyglotConfig } from "./tgg/index.js";

const aspenGrammar = language({
  name: "aspen",
  extras: ($) => [/[ \t\r\n]+/, $.DeckComment],
  rules: {
    Document: ($) => repeat($.DeckToken),
    DeckToken: ($) =>
      choice(
        $.ParenGroup,
        $.DeckString,
        $.DeckNumber,
        $.DeckIdentifier,
        $.EqualsToken,
        $.SlashToken,
        $.ColonToken,
        $.StarToken,
      ),
    ParenGroup: ($) => seq("(", repeat($.DeckToken), ")"),
    DeckString: () => /'[^'\r\n]*'|"[^"\r\n]*"/,
    DeckNumber: () => /[-+]?[0-9]+(\.[0-9]*)?([eE][-+]?[0-9]+)?|[-+]?\.[0-9]+([eE][-+]?[0-9]+)?/,
    DeckIdentifier: () => /[A-Za-z_][A-Za-z0-9_.:-]*/,
    EqualsToken: () => "=",
    SlashToken: () => "/",
    ColonToken: () => ":",
    StarToken: () => "*",
    DeckComment: () => /[;#][^\r\n]*/,
  },
});

/**
 * ModelScript Aspen Plus Input Deck (.in, .inp, .bkp) Language Definition.
 */
export const aspenLanguage = language({
  polyglot: aspenPolyglotConfig,
  name: "aspen",
  fileExtensions: [".in", ".inp", ".bkp", ".aspen.inp"],
  maturity: "experimental",
  extras: aspenGrammar.extras,
  rules: aspenGrammar.rules,
  indexing: {
    indexFile: indexAspenDocument,
    canIndex: canIndexAspen,
  },
  lsp: {
    fileExtensions: [".in", ".inp", ".bkp", ".aspen.inp"],
    icons: {
      light: "./assets/aspen/icon-light.png",
      dark: "./assets/aspen/icon-dark.png",
    },
  },

  writeback: {
    operators: ["="],
  },

  ui: {
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Flowsheet",
        shortLabel: "Layout",
        tooltip: "Re-run automatic flowsheet layout",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "aspenSolveFlash",
        label: "Solve Aspen Flash",
        shortLabel: "Solve Flash",
        tooltip: "Solve thermodynamic flash calculation",
        icon: "beaker",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "aspen_solve_flash",
      },
      {
        id: "aspenToModelica",
        label: "Export to Modelica",
        shortLabel: "Modelica",
        tooltip: "Project Aspen flowsheet to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "aspen_to_modelica",
      },
      {
        id: "aspenToDae",
        label: "Lower to DAE",
        shortLabel: "DAE",
        tooltip: "Lower Aspen flowsheet to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "aspen_to_dae",
      },
      {
        id: "lintAspenFlowsheet",
        label: "Lint Aspen Flowsheet",
        shortLabel: "Lint",
        tooltip: "Lint Aspen flowsheet",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "lint_aspen_flowsheet",
      },
    ],
  },

  actions: [
    {
      id: "lint_aspen_flowsheet",
      title: "Lint Aspen Flowsheet",
      description: "Performs pre-flight chemical process topology, mass balance, and parameter bounds checks.",
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
          name: "aspen_lint",
          displayName: "Lint Aspen Deck",
          modelDescription: "Lints Aspen input file for unconnected streams, tear cycles, and fraction errors.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseAspen(text);
        return lintAspen(parsed);
      },
    },
    {
      id: "aspen_to_dae",
      title: "Lower Aspen to DAE",
      description: "Compiles Aspen process flowsheet directly into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseAspen(text);
        const dae = lowerAspenToDae(parsed);
        return {
          modelName: "AspenFlowsheet",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "aspen_to_modelica",
      title: "Project Aspen to Modelica",
      description: "Synthesizes standard Modelica 3.x fluid process model from Aspen deck.",
      category: "export",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseAspen(text);
        return aspenToModelica(parsed);
      },
    },
    {
      id: "aspen_solve_flash",
      title: "Solve Flash VLE",
      description: "Solves Rachford-Rice vapor-liquid equilibrium flash for feed stream.",
      category: "simulate",
      execute: async (ctx, params: { documentText?: string | undefined; streamId?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseAspen(text);
        const streamId = params?.streamId ?? deck.streams.keys().next().value ?? "FEED";
        const s = deck.streams.get(streamId);
        const comps = Array.from(s?.moleFractions.keys() ?? deck.components.keys());
        const fracs = comps.map((c) => s?.moleFractions.get(c) ?? 1.0 / comps.length);
        return solveFlashRachfordRice({
          temperature: s?.temperature ?? 75.0,
          pressure: s?.pressure ?? 1.2,
          components: comps,
          moleFractions: fracs,
          totalFlow: s?.moleFlow ?? 100.0,
        });
      },
    },
  ],
});

export default aspenLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInAspenLibrarySync();
