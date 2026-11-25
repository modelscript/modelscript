// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, repeat1, seq } from "@modelscript/dsl";
import { lowerIbisToDae } from "./dae/ibis-to-dae.js";
import { lintIbis } from "./lints/index.js";
import { parseIbis } from "./parser/ibis-parser.js";
import { ibisToModelica } from "./projections/ibis-to-modelica.js";
import { calculateOutputResistance, evaluateBufferCurrent } from "./solvers/buffer-solver.js";
import { ibisPolyglotConfig } from "./tgg/index.js";

const ibisGrammar = language({
  name: "ibis",
  extras: () => [/[ \t\r\n]+/],
  rules: {
    Document: ($) => repeat($.Item),
    Item: ($) => choice($.SectionHeader, $.IbisComment, $.DeckString, $.DeckNumber, $.DeckIdentifier, $.DeckPunct),
    SectionHeader: ($) => seq("[", repeat1(choice($.DeckIdentifier, $.DeckNumber)), "]"),
    IbisComment: () => /\|[^\r\n]*/,
    DeckString: () => /"[^"\r\n]*"/,
    DeckNumber: () => /[-+]?[0-9]*\.?[0-9]+([eEdD][-+]?[0-9]+)?/,
    DeckIdentifier: () => /[A-Za-z_][A-Za-z0-9_./+-]*/,
    DeckPunct: () => /[,:=+/*()-]+/,
  },
});

/**
 * ModelScript ANSI/EIA-656-B IBIS (.ibs) Language Definition.
 */
export const ibisLanguage = language({
  polyglot: ibisPolyglotConfig,
  name: "ibis",
  fileExtensions: [".ibs"],
  maturity: "experimental",
  extras: ibisGrammar.extras,
  rules: ibisGrammar.rules,
  lsp: {
    fileExtensions: [".ibs"],
    icons: {
      light: "./assets/ibis/icon-light.png",
      dark: "./assets/ibis/icon-dark.png",
    },
  },
  indexing: {
    indexFile(ctx) {
      try {
        const deck = parseIbis(ctx.text, ctx.uri);
        ctx.setParsedModel(deck);

        const rootName = deck.fileName || "IbisDocument";
        const rootId = ctx.addSymbol(
          rootName,
          "package",
          null,
          0,
          ctx.text.length,
          { ibisVer: deck.ibisVer },
          { ruleName: "ibis_symbol" },
        );

        for (const [compName, comp] of deck.components) {
          const compId = ctx.addSymbol(
            compName,
            "class",
            rootId,
            0,
            50,
            { manufacturer: comp.manufacturer },
            { ruleName: "ibis_symbol" },
          );

          for (const [pinName, pin] of comp.pins) {
            ctx.addSymbol(
              pinName,
              "field",
              compId,
              0,
              50,
              { signal: pin.signalName, model: pin.modelName },
              { ruleName: "ibis_symbol" },
            );
          }
        }

        for (const [modName, mod] of deck.models) {
          ctx.addSymbol(
            modName,
            "interface",
            rootId,
            0,
            50,
            { modelType: mod.modelType, vcc: mod.voltageRange.typ },
            { ruleName: "ibis_symbol" },
          );
        }
      } catch {
        // If parsing fails, preserve empty symbol table
      }
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
        tooltip: "Re-run automatic schematic layout",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "ibisEvalBuffer",
        label: "Evaluate IBIS Buffer",
        shortLabel: "Eval Buffer",
        tooltip: "Evaluate IBIS I/V and V/T buffer characteristics",
        icon: "pulse",
        views: ["diagram", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "ibis_eval_buffer",
      },
      {
        id: "ibisToModelica",
        label: "Export to Modelica",
        shortLabel: "Modelica",
        tooltip: "Project IBIS model to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "ibis_to_modelica",
      },
      {
        id: "ibisToDae",
        label: "Lower to DAE",
        shortLabel: "DAE",
        tooltip: "Lower IBIS model to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "ibis_to_dae",
      },
      {
        id: "lintIbis",
        label: "Lint IBIS Model",
        shortLabel: "Lint",
        tooltip: "Lint IBIS model",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "lint_ibis",
      },
    ],
  },

  actions: [
    {
      id: "lint_ibis",
      title: "Lint IBIS Model",
      description: "Validates pin model bindings, voltage ranges, and I/V table monotonicity.",
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
          name: "ibis_lint",
          displayName: "Lint IBIS Deck",
          modelDescription: "Lints IBIS file for pin mismatches, non-monotonic curves, and invalid parasitics.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseIbis(text);
        return lintIbis(parsed);
      },
    },
    {
      id: "ibis_to_dae",
      title: "Lower IBIS to DAE",
      description: "Compiles IBIS buffer and package model directly into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseIbis(text);
        const dae = lowerIbisToDae(parsed);
        return {
          modelName: "IbisBufferModule",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "ibis_to_modelica",
      title: "Project IBIS to Modelica",
      description: "Synthesizes standard Modelica 3.x analog buffer driver model.",
      category: "export",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseIbis(text);
        return ibisToModelica(parsed);
      },
    },
    {
      id: "ibis_eval_buffer",
      title: "Evaluate Buffer Characteristics",
      description: "Computes output dynamic on-resistance and driver currents from I/V curves.",
      category: "simulate",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseIbis(text);
        const firstMod = deck.models.values().next().value;
        if (!firstMod) return null;
        return {
          modelName: firstMod.name,
          resistance: calculateOutputResistance(firstMod),
          currentSample: evaluateBufferCurrent(firstMod, 1.5, 1),
        };
      },
    },
  ],
});

export default ibisLanguage;
