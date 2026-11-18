// SPDX-License-Identifier: AGPL-3.0-or-later

import { cardDeckRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerPypsaToDae } from "./dae/pypsa-to-dae.js";
import { canIndexPypsa, indexPypsaDocument } from "./indexing.js";
import { lintPypsaNetwork } from "./lints/index.js";
import { parsePypsa } from "./parser/pypsa-parser.js";
import { projectPypsaToAmpl } from "./projections/pypsa-to-ampl.js";
import { pypsaPolyglotConfig } from "./tgg/index.js";

export const pypsaLanguage = language({
  polyglot: pypsaPolyglotConfig,
  name: "pypsa",
  fileExtensions: [".pypsa", ".pypsa.json"],
  maturity: "experimental",
  indexing: {
    indexFile: indexPypsaDocument,
    canIndex: canIndexPypsa,
  },
  lsp: {
    fileExtensions: [".pypsa", ".pypsa.json"],
  },
  actions: [
    {
      id: "lint_pypsa",
      title: "Lint PyPSA Network",
      description: "Checks bus references, nominal voltages, impedances, and storage efficiencies.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintPypsaNetwork(parsePypsa(text));
      },
    },
    {
      id: "lower_pypsa_dae",
      title: "Lower PyPSA Network to DAE",
      description: "Compiles PyPSA buses, lines, links, and storage ODEs into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const dae = lowerPypsaToDae(parsePypsa(text));
        return { variableCount: dae.varCount, equationCount: dae.eqCount };
      },
    },
    {
      id: "pypsa_to_ampl",
      title: "Export PyPSA Network to AMPL",
      description: "Generates an AMPL capacity expansion and DC-OPF optimization model from PyPSA.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return projectPypsaToAmpl(parsePypsa(text));
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default pypsaLanguage;
