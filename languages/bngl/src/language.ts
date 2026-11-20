// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, optional, repeat, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerBnglToDae } from "./dae/bngl-to-dae.js";
import { indexBnglDocument } from "./indexing.js";
import { lintBngl } from "./lints/index.js";
import { parseBngl } from "./parser/bngl-parser.js";
import { bnglToModelica, bnglToSbmlXml } from "./projections/bngl-projections.js";
import { generateBnglNetwork, solveBngl, type BnglSolverOptions } from "./solvers/bngl-solver.js";
import { bnglPolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript BioNetGen Rule-Based Modeling Language (.bngl) Definition.
 */
export const bnglLanguage = language({
  polyglot: bnglPolyglotConfig,
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
        id: "bnglGenerateNetwork",
        label: "Generate BioNetGen Reaction Network",
        shortLabel: "Generate",
        tooltip: "Generate BioNetGen Reaction Network",
        icon: "stack",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "bngl_generate_network",
      },
      {
        id: "bnglSimulate",
        label: "Simulate BioNetGen Network",
        shortLabel: "Simulate",
        tooltip: "Simulate BioNetGen Network",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "bngl_simulate",
      },
      {
        id: "bnglToDae",
        label: "Lower BioNetGen to DAE",
        shortLabel: "Lower BioNetGen",
        tooltip: "Lower BioNetGen to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "bngl_to_dae",
      },
      {
        id: "bnglToModelica",
        label: "Project BioNetGen to Modelica",
        shortLabel: "Project",
        tooltip: "Project BioNetGen to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "bngl_to_modelica",
      },
      {
        id: "bnglToSbml",
        label: "Project BioNetGen to SBML XML",
        shortLabel: "Project",
        tooltip: "Project BioNetGen to SBML XML",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 60,
        actionId: "bngl_to_sbml",
      },
      {
        id: "lintBngl",
        label: "Lint BioNetGen Model",
        shortLabel: "Lint BioNetGen",
        tooltip: "Lint BioNetGen Model",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 70,
        actionId: "lint_bngl",
      },
    ],
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
  word: ($) => $["Identifier"]!,
  extras: ($) => [/[ \t\r\n]+/, "\\", ";", $["Comment"]!],
  rules: {
    BnglDocument: ($) => repeat($["TopItem"]!),

    TopItem: ($) => choice($["ModelBlock"]!, $["SectionBlock"]!, $["ActionCall"]!),

    ModelBlock: ($) =>
      seq(
        $["BeginKw"]!,
        $["ModelKw"]!,
        optional($["Identifier"]!),
        repeat($["SectionBlock"]!),
        $["EndKw"]!,
        $["ModelKw"]!,
      ),

    SectionBlock: ($) =>
      seq($["BeginKw"]!, $["SectionHeader"]!, repeat($["ExprToken"]!), $["EndKw"]!, optional($["SectionHeader"]!)),

    ActionCall: ($) => seq($["Identifier"]!, $["ParenGroup"]!),

    ExprToken: ($) =>
      choice(
        $["Identifier"]!,
        $["ModelKw"]!,
        $["NumberLiteral"]!,
        $["StringLiteral"]!,
        $["Arrow"]!,
        $["ParenGroup"]!,
        $["BraceGroup"]!,
        $["BracketGroup"]!,
        $["OperatorPunct"]!,
        "@",
        "%",
      ),

    ParenGroup: ($) => seq("(", repeat($["ExprToken"]!), ")"),
    BraceGroup: ($) => seq("{", repeat($["ExprToken"]!), "}"),
    BracketGroup: ($) => seq("[", repeat($["ExprToken"]!), "]"),

    BeginKw: () => choice("begin", "BEGIN"),
    EndKw: () => choice("end", "END"),
    ModelKw: () => choice("model", "MODEL"),
    SectionHeader: () =>
      choice(
        "parameters",
        "compartments",
        seq("molecule", "types"),
        "molecule_types",
        seq("seed", "species"),
        "seed_species",
        "species",
        "observables",
        "functions",
        seq("reaction", "rules"),
        "reaction_rules",
        "actions",
      ),
    Arrow: () => /<->|->|=>/,
    OperatorPunct: () => /[~!.?:,=+\-*/^<>]/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\\r\n]*(?:\\.[^"\\\r\n]*)*"|'[^'\\\r\n]*(?:\\.[^'\\\r\n]*)*'/,
    Comment: () => /#[^\r\n]*/,
  },
});

export default bnglLanguage;
