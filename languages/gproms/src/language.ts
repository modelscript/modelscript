// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInGpromsLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerGpromsToDae } from "./dae/gproms-to-dae.js";
import { indexGpromsDocument } from "./indexing.js";
import { lintGproms } from "./lints/index.js";
import { parseGproms } from "./parser/gproms-parser.js";
import { gpromsToModelica } from "./projections/gproms-to-modelica.js";
import { solveGpromsProcess, type GpromsSolverOptions } from "./solvers/gproms-solver.js";
import { gpromsPolyglotConfig } from "./tgg/index.js";

const gpromsGrammar = language({
  name: "gproms",
  extras: ($) => [/[ \t\r\n]+/, $.LineComment, $.BraceComment, $.BlockComment],
  rules: {
    Document: ($) => repeat($.Item),
    Item: ($) =>
      choice(
        $.ParenGroup,
        $.BracketGroup,
        $.AssignOp,
        $.PowerOp,
        $.CompareOp,
        $.DomainInteriorOp,
        $.StringLiteral,
        $.NumberLiteral,
        $.Identifier,
        $.SymbolToken,
      ),
    ParenGroup: ($) => seq("(", repeat($.Item), ")"),
    BracketGroup: ($) => seq("[", repeat($.Item), "]"),
    AssignOp: () => ":=",
    PowerOp: () => "**",
    CompareOp: () => choice("<=", ">=", "<>", "=="),
    DomainInteriorOp: () => /\|\+|\|-/,
    StringLiteral: () => /"[^"\r\n]*"|'[^'\r\n]*'/,
    NumberLiteral: () => /[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?|\.[0-9]+([eE][-+]?[0-9]+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    SymbolToken: () => /[$=:;,.+\-*/^<>]/,
    LineComment: () => /(#|\/\/)[^\r\n]*/,
    BraceComment: () => /\{[^}]*\}/,
    BlockComment: () => /\/\*[^*]*\*+([^/*][^*]*\*+)*\//,
  },
});

/**
 * ModelScript gPROMS Process Modeling Language (.gproms, .pml) Language Definition.
 */
export const gpromsLanguage = language({
  polyglot: gpromsPolyglotConfig,
  name: "gproms",
  fileExtensions: [".gproms", ".pml"],
  maturity: "experimental",
  extras: gpromsGrammar.extras,
  rules: gpromsGrammar.rules,
  lsp: {
    fileExtensions: [".gproms", ".pml"],
    icons: {
      light: "./assets/gproms/icon-light.png",
      dark: "./assets/gproms/icon-dark.png",
    },
  },

  indexing: {
    indexFile: indexGpromsDocument,
  },

  writeback: {
    operators: [":=", "="],
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
        id: "gpromsSimulate",
        label: "Simulate gPROMS Model",
        shortLabel: "Simulate",
        tooltip: "Simulate gPROMS dynamic model",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "gproms_simulate",
      },
      {
        id: "gpromsToModelica",
        label: "Export to Modelica",
        shortLabel: "Modelica",
        tooltip: "Project gPROMS model to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "gproms_to_modelica",
      },
      {
        id: "gpromsToDae",
        label: "Lower to DAE",
        shortLabel: "DAE",
        tooltip: "Lower gPROMS model to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "gproms_to_dae",
      },
      {
        id: "lintGproms",
        label: "Lint gPROMS Model",
        shortLabel: "Lint",
        tooltip: "Lint gPROMS model",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "lint_gproms",
      },
    ],
  },

  actions: [
    {
      id: "lint_gproms",
      title: "Lint gPROMS Model",
      description:
        "Validates DECLARE TYPE bounds, distribution domains, structural degrees of freedom, and differential initial conditions.",
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
          name: "gproms_lint",
          displayName: "Lint gPROMS Model",
          modelDescription:
            "Lints gPROMS (.gproms, .pml) file for undeclared types, invalid bounds, DOF mismatches, and uninitialized differential states.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseGproms(text);
        return lintGproms(parsed);
      },
    },
    {
      id: "gproms_simulate",
      title: "Simulate gPROMS Process",
      description:
        "Solves lumped DAE and Method-of-Lines (MOL) spatially discretized 1D tubular PDE-DAE models via RK4.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: GpromsSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseGproms(text);
        return solveGpromsProcess(doc, params?.options);
      },
    },
    {
      id: "gproms_to_dae",
      title: "Lower gPROMS to DAE",
      description:
        "Discretizes DISTRIBUTION_DOMAIN PARTIAL derivatives via finite differences and lowers models into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseGproms(text);
        const dae = lowerGpromsToDae(parsed);
        const firstModel = parsed.models.values().next().value;
        return {
          modelName: firstModel?.name ?? "GpromsModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "gproms_to_modelica",
      title: "Project gPROMS to Modelica",
      description: "Synthesizes standalone Modelica 3.x process models from gPROMS MODEL and PROCESS blocks.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseGproms(text);
        return gpromsToModelica(parsed, params?.modelName);
      },
    },
  ],
});

export default gpromsLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInGpromsLibrarySync();
