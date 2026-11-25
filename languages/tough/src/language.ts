// SPDX-License-Identifier: AGPL-3.0-or-later

import { iniSectionRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInToughLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerToughToDae } from "./dae/index.js";
import { canIndexToughFile, indexToughFile } from "./indexing.js";
import { lintTough } from "./lints/index.js";
import { parseTough } from "./parser/index.js";
import { solveGeothermalWells } from "./solver/index.js";
import { toughPolyglotConfig } from "./tgg/index.js";

export const toughLanguage = language({
  polyglot: toughPolyglotConfig,
  name: "tough",
  fileExtensions: [".tough", ".dat", ".tgh"],
  maturity: "beta",
  indexing: {
    indexFile: indexToughFile,
    canIndex: canIndexToughFile,
  },
  lsp: {
    fileExtensions: [".tough", ".dat", ".tgh"],
  },
  ui: {
    toolbarButtons: [
      {
        id: "toughSolveWells",
        label: "Solve Geothermal Production",
        shortLabel: "Solve Geothermal",
        tooltip: "Solve Geothermal Production",
        icon: "play",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        actionId: "tough_solve_wells",
      },
      {
        id: "toughToDae",
        label: "Lower TOUGH to DAEBuilder",
        shortLabel: "Lower TOUGH",
        tooltip: "Lower TOUGH to DAEBuilder",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 20,
        actionId: "tough_to_dae",
      },
      {
        id: "toughLint",
        label: "Lint TOUGH Deck",
        shortLabel: "Lint TOUGH",
        tooltip: "Lint TOUGH Deck",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "tough_lint",
      },
    ],
  },
  actions: [
    {
      id: "tough_lint",
      title: "Lint TOUGH Deck",
      description: "Validates rock properties, grid topology, and connection geometry.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintTough(parseTough(text));
      },
    },
    {
      id: "tough_solve_wells",
      title: "Solve Geothermal Production",
      description: "Computes well production rates and steam fraction.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return solveGeothermalWells(parseTough(text));
      },
    },
    {
      id: "tough_to_dae",
      title: "Lower TOUGH to DAEBuilder",
      description: "Lowers reservoir grid blocks and flux equations to DAE arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseTough(text);
        const dae = lowerToughToDae(deck);
        return {
          title: deck.title,
          variables: dae.variables().length,
          equations: dae.equations().length,
        };
      },
    },
  ],
  extras: ($) => [/[ \t\r\n]+/, $["IniComment"]!],
  rules: iniSectionRules,
});

export default toughLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInToughLibrarySync();
