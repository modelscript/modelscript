// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerPhreeqcToDae } from "./dae/phreeqc-to-dae.js";
import { indexPhreeqcFile } from "./indexing.js";
import { lintPhreeqc } from "./lints/index.js";
import { parsePhreeqc } from "./parser/phreeqc-parser.js";
import { phreeqcToModelica } from "./projections/phreeqc-to-modelica.js";
import { solvePhreeqcSpeciation, type SpeciationSolverOptions } from "./solvers/speciation-solver.js";
import { phreeqcPolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript USGS PHREEQC Aqueous Geochemistry & Reactive Transport (.pqi, .dat) Language Definition.
 */
export const phreeqcLanguage = language({
  polyglot: phreeqcPolyglotConfig,
  name: "phreeqc",
  fileExtensions: [".pqi", ".dat"],
  maturity: "experimental",
  indexing: {
    indexFile: indexPhreeqcFile,
    canIndex: (uri, text) =>
      uri.toLowerCase().endsWith(".pqi") ||
      Boolean(
        text &&
        (text.includes("SOLUTION") ||
          text.includes("EQUILIBRIUM_PHASES") ||
          text.includes("KINETICS") ||
          text.includes("SOLUTION_SPECIES")),
      ),
  },
  lsp: {
    fileExtensions: [".pqi", ".dat"],
    icons: {
      light: "./assets/phreeqc/icon-light.png",
      dark: "./assets/phreeqc/icon-dark.png",
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
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        command: "morsel:autoLayout",
      },
      {
        id: "phreeqcSpeciate",
        label: "Solve Aqueous Speciation & Saturation Indices",
        shortLabel: "Solve Aqueous",
        tooltip: "Solve Aqueous Speciation & Saturation Indices",
        icon: "beaker",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "phreeqc_speciate",
      },
      {
        id: "phreeqcToDae",
        label: "Lower PHREEQC to DAE",
        shortLabel: "Lower PHREEQC",
        tooltip: "Lower PHREEQC to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "phreeqc_to_dae",
      },
      {
        id: "phreeqcToModelica",
        label: "Project PHREEQC to Modelica",
        shortLabel: "Project PHREEQC",
        tooltip: "Project PHREEQC to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "phreeqc_to_modelica",
      },
      {
        id: "lintPhreeqc",
        label: "Lint PHREEQC Deck",
        shortLabel: "Lint PHREEQC",
        tooltip: "Lint PHREEQC Deck",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "lint_phreeqc",
      },
    ],
  },
  actions: [
    {
      id: "lint_phreeqc",
      title: "Lint PHREEQC Deck",
      description:
        "Validates pH/pe/temperature bounds, solute concentrations, electrical charge balance, and mineral phases.",
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
          name: "phreeqc_lint",
          displayName: "Lint PHREEQC Geochemical Deck",
          modelDescription:
            "Lints PHREEQC (.pqi/.dat) deck for pH/pe bounds, charge imbalance, unknown species, and mineral phases.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parsePhreeqc(text);
        return lintPhreeqc(parsed);
      },
    },
    {
      id: "phreeqc_speciate",
      title: "Solve Aqueous Speciation & Saturation Indices",
      description:
        "Computes ionic strength, Davies activity coefficients, carbonate speciation, and mineral saturation indices.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: SpeciationSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parsePhreeqc(text);
        return solvePhreeqcSpeciation(doc, params?.options);
      },
    },
    {
      id: "phreeqc_to_dae",
      title: "Lower PHREEQC to DAE",
      description:
        "Compiles aqueous species, Davies activity coefficients, carbonate equilibria, and kinetic mineral rates into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parsePhreeqc(text);
        const dae = lowerPhreeqcToDae(parsed);
        return {
          modelName: parsed.title ?? "PhreeqcAqueousSystem",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "phreeqc_to_modelica",
      title: "Project PHREEQC to Modelica",
      description: "Synthesizes standalone Modelica 3.x aqueous chemistry, speciation, and mineral kinetics equations.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parsePhreeqc(text);
        return phreeqcToModelica(parsed, params?.modelName);
      },
    },
  ],
  word: ($) => $["Identifier"]!,
  extras: ($) => [/[ \t\r\n]+/, ";", $["Comment"]!],
  rules: {
    PhreeqcDeck: ($) => repeat($["PhreeqcBlock"]!),

    PhreeqcBlock: ($) => seq($["BlockKeyword"]!, repeat($["ExprAtom"]!)),

    ExprAtom: ($) =>
      choice(
        $["Identifier"]!,
        $["NumberLiteral"]!,
        $["OptionFlag"]!,
        $["StringLiteral"]!,
        $["ParenGroup"]!,
        $["BracketGroup"]!,
        $["ChemPunct"]!,
        "-",
      ),

    ParenGroup: ($) => seq("(", repeat($["ExprAtom"]!), ")"),
    BracketGroup: ($) => seq("[", repeat($["ExprAtom"]!), "]"),

    BlockKeyword: () =>
      choice(
        "TITLE",
        "REMARKS",
        "SOLUTION",
        "EQUILIBRIUM_PHASES",
        "PURE_PHASES",
        "REACTION",
        "KINETICS",
        "MIX",
        "SOLUTION_MASTER_SPECIES",
        "SOLUTION_SPECIES",
        "PHASES",
        "EXCHANGE",
        "SURFACE",
        "GAS_PHASE",
        "SOLID_SOLUTIONS",
        "RATES",
        "SELECTED_OUTPUT",
        "USER_PUNCH",
        "INCREMENTAL_REACTIONS",
        "TRANSPORT",
        "ADVECTION",
        "USE",
        "SAVE",
        "COPY",
        "PRINT",
        "KNOBS",
        "END",
      ),

    OptionFlag: () => /-[A-Za-z_][A-Za-z0-9_]*/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.:+-]*/,
    NumberLiteral: () => /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\\r\n]*(?:\\.[^"\\\r\n]*)*"|'[^'\\\r\n]*(?:\\.[^'\\\r\n]*)*'/,
    ChemPunct: () => /[=+/*:&,<>^~]/,
    Comment: () => /#[^\r\n]*/,
  },
});

export default phreeqcLanguage;
