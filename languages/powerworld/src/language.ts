// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PowerWorld Auxiliary (.aux) Language Definition.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerPowerWorldToDae } from "./dae/powerworld-to-dae.js";
import { powerworldGrammar } from "./grammar/powerworld-grammar.js";
import { canIndexPowerWorldAux, indexPowerWorldAuxDocument } from "./indexing.js";
import { lintPowerWorldAux } from "./lints/index.js";
import { parsePowerWorldAux } from "./parser/powerworld-parser.js";
import { projectPowerWorldToPsseRaw } from "./projections/aux-to-psse.js";
import { powerworldPolyglotConfig } from "./tgg/index.js";

export const powerworldLanguage = language({
  polyglot: powerworldPolyglotConfig,
  name: "powerworld",
  fileExtensions: [".aux", ".cdf"],
  maturity: "experimental",
  indexing: {
    indexFile: indexPowerWorldAuxDocument,
    canIndex: canIndexPowerWorldAux,
  },
  lsp: {
    fileExtensions: [".aux", ".cdf"],
    folding: powerworldGrammar.lsp?.folding,
    outline: powerworldGrammar.lsp?.outline,
  },
  word: powerworldGrammar.word,
  extras: powerworldGrammar.extras,
  conflicts: powerworldGrammar.conflicts,
  rules: powerworldGrammar.rules,

  actions: [
    {
      id: "lint_powerworld",
      title: "Lint PowerWorld AUX Case",
      description:
        "Checks bus numbering, unresolved references, generator MW limits, branch ratings, and slack bus setup.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintPowerWorldAux(parsePowerWorldAux(text));
      },
    },
    {
      id: "powerworld_to_dae",
      title: "Lower PowerWorld AUX to DAE",
      description:
        "Compiles transmission buses, branches, generators, loads, and shunts into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const dae = lowerPowerWorldToDae(parsePowerWorldAux(text));
        return {
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "powerworld_to_psse",
      title: "Export PowerWorld AUX to PSS/E .raw",
      description: "Projects PowerWorld .aux power flow case to PSS/E v33 .raw format.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return projectPowerWorldToPsseRaw(parsePowerWorldAux(text));
      },
    },
  ],
});

export default powerworldLanguage;
