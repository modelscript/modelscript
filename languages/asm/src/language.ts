// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript IWA Activated Sludge Models (ASM) Language Definition.
 */

import { language } from "@modelscript/dsl";
import { evaluateTakacsClarifierDerivatives } from "./clarifier/takacs.js";
import { lowerAsmToDae } from "./dae/asm-to-dae.js";
import { indexAsmDocument } from "./indexing.js";
import { lintAsmPlant } from "./lints/index.js";
import { computeAsm1ConversionRates, evaluateAsm1ProcessRates } from "./models/asm1.js";
import { parseAsmPlant } from "./parser/asm-parser.js";

export const asmLanguage = language({
  name: "asm",
  fileExtensions: [".asm", ".bsm", ".wrrf"],
  maturity: "beta",
  indexing: {
    indexFile: indexAsmDocument,
  },
  lsp: {
    fileExtensions: [".asm", ".bsm", ".wrrf"],
  },

  actions: [
    {
      id: "evaluate_asm_kinetics",
      title: "Evaluate IWA ASM Biokinetics Reaction Rates",
      description: "Computes Monod process rates and net stoichiometric component conversion rates.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(beaker)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "asm_evaluate_kinetics",
          displayName: "Evaluate ASM Biokinetics Rates",
          modelDescription:
            "Evaluates IWA ASM1 biological reaction rates and net component conversion rates in a wastewater plant.",
        },
      },
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const plant = parseAsmPlant(text);
        const processRates = evaluateAsm1ProcessRates(plant.influentConcentrations);
        const conversionRates = computeAsm1ConversionRates(plant.influentConcentrations);
        return {
          processRates,
          conversionRates,
        };
      },
    },
    {
      id: "lower_asm_dae",
      title: "Lower Wastewater Treatment Plant to DAE Arena",
      description:
        "Compiles biological reactors, CSTR hydraulics, and clarifier mass conservation directly into DAE arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const plant = parseAsmPlant(text);
        const dae = lowerAsmToDae(plant);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "simulate_takacs_clarifier",
      title: "Simulate Takács 10-Layer Clarifier Flux",
      description: "Computes double-exponential settling velocity and layer-by-layer dynamic mass fluxes.",
      category: "simulate",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const plant = parseAsmPlant(text);
        const clarifier = plant.clarifiers[0];
        if (!clarifier) return null;
        const initialLayerTss = [15.0, 20.0, 30.0, 50.0, 3000.0, 4500.0, 5500.0, 6500.0, 7500.0, 8000.0];
        const underflowQ = plant.influentFlowM3Day * plant.sludgeRecycleRatio + plant.wasteFlowM3Day;
        return evaluateTakacsClarifierDerivatives(
          initialLayerTss,
          plant.influentFlowM3Day,
          3000.0,
          underflowQ,
          clarifier,
        );
      },
    },
    {
      id: "lint_asm_plant",
      title: "Lint ASM Plant Model",
      description: "Checks wastewater plant for biokinetics, hydraulic volumes, and aeration sanity.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const plant = parseAsmPlant(text);
        return lintAsmPlant(plant);
      },
    },
  ],
});
