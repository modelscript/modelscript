// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Language Definition.
 *
 * Registers EnergyPlus (.idf, .epJSON) building energy file extensions,
 * pre-flight linter diagnostics, DAE lowering, and Modelica thermal export.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerEnergyPlusToDae } from "./dae/energyplus-to-dae.js";
import { energyPlusGrammar } from "./grammar/energyplus-grammar.js";
import { canIndexEnergyPlus, indexEnergyPlusDocument } from "./indexing.js";
import { lintEnergyPlus } from "./lints/rules.js";
import { parseEnergyPlus } from "./parser/index.js";
import { energyPlusToModelica } from "./projections/energyplus-to-modelica.js";
import { energyplusPolyglotConfig } from "./tgg/index.js";

export const energyplusLanguage = language({
  polyglot: energyplusPolyglotConfig,
  name: "energyplus",
  fileExtensions: [".idf", ".epjson"],
  maturity: "experimental",
  indexing: {
    indexFile: indexEnergyPlusDocument,
    canIndex: canIndexEnergyPlus,
  },
  lsp: {
    fileExtensions: [".idf", ".epjson"],
    folding: energyPlusGrammar.lsp?.folding,
    outline: energyPlusGrammar.lsp?.outline,
  },
  word: energyPlusGrammar.word,
  extras: energyPlusGrammar.extras,
  rules: energyPlusGrammar.rules,

  ui: {
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "energyplusToDae",
        label: "Lower EnergyPlus to DAE Arena",
        shortLabel: "Lower EnergyPlus",
        tooltip: "Lower EnergyPlus to DAE Arena",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 20,
        actionId: "energyplus_to_dae",
      },
      {
        id: "energyplusToModelica",
        label: "Export to Modelica Thermal Model",
        shortLabel: "Export to",
        tooltip: "Export to Modelica Thermal Model",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 30,
        actionId: "energyplus_to_modelica",
      },
      {
        id: "energyplusLint",
        label: "Lint EnergyPlus Building Model",
        shortLabel: "Lint EnergyPlus",
        tooltip: "Lint EnergyPlus Building Model",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "energyplus_lint",
      },
    ],
  },
  actions: [
    {
      id: "energyplus_lint",
      title: "Lint EnergyPlus Building Model",
      description: "Runs pre-flight interzone matching, material property, and zone convexity checks.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseEnergyPlus(text);
        return lintEnergyPlus(doc);
      },
    },
    {
      id: "energyplus_to_dae",
      title: "Lower EnergyPlus to DAE Arena",
      description: "Generates multi-zone lumped capacitance thermal DAEs in ModelScript linear memory.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseEnergyPlus(text);
        const arena = lowerEnergyPlusToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "energyplus_to_modelica",
      title: "Export to Modelica Thermal Model",
      description: "Translates EnergyPlus thermal zones and envelope constructions into Modelica.Thermal components.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseEnergyPlus(text);
        return energyPlusToModelica(doc);
      },
    },
  ],
});

export default energyplusLanguage;
