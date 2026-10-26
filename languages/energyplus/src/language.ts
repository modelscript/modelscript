// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/energyplus — Language Definition.
 *
 * Registers EnergyPlus (.idf, .epJSON) building energy file extensions,
 * pre-flight linter diagnostics, DAE lowering, and Modelica thermal export.
 */

import { language } from "@modelscript/dsl";
import { lowerEnergyPlusToDae } from "./dae/energyplus-to-dae.js";
import { lintEnergyPlus } from "./lints/rules.js";
import { parseEnergyPlus } from "./parser/index.js";
import { energyPlusToModelica } from "./projections/energyplus-to-modelica.js";

export const energyplusLanguage = language({
  name: "energyplus",
  fileExtensions: [".idf", ".epjson"],
  lsp: {
    fileExtensions: [".idf", ".epjson"],
  },
  rules: {
    Root: () => "energyplus",
  },

  actions: [
    {
      id: "energyplus_lint",
      title: "Lint EnergyPlus Building Model",
      description: "Runs pre-flight interzone matching, material property, and zone convexity checks.",
      category: "verify",
      execute: async (context: any) => {
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
      execute: async (context: any) => {
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
      execute: async (context: any) => {
        const text = context.documentText || "";
        const doc = parseEnergyPlus(text);
        return energyPlusToModelica(doc);
      },
    },
  ],
});
