// SPDX-License-Identifier: AGPL-3.0-or-later

import { cardDeckRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerPlsCaddToDae } from "./dae/plscadd-to-dae.js";
import { canIndexPlsCadd, indexPlsCaddDocument } from "./indexing.js";
import { lintPlsCadd } from "./lints/index.js";
import { parsePlsCadd } from "./parser/plscadd-parser.js";
import { plscaddPolyglotConfig } from "./tgg/index.js";

export const plscaddLanguage = language({
  polyglot: plscaddPolyglotConfig,
  name: "plscadd",
  fileExtensions: [".pol", ".loa", ".plscadd"],
  maturity: "experimental",
  indexing: {
    indexFile: indexPlsCaddDocument,
    canIndex: canIndexPlsCadd,
  },
  lsp: {
    fileExtensions: [".pol", ".loa", ".plscadd"],
  },
  actions: [
    {
      id: "lint_plscadd",
      title: "Lint PLS-CADD Line Model",
      description: "Checks structure references, rated tension limits, and minimum ground clearances.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintPlsCadd(parsePlsCadd(text));
      },
    },
    {
      id: "lower_plscadd_dae",
      title: "Lower PLS-CADD Line to DAE",
      description: "Compiles sag-tension and conductor R/X impedance equations into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const dae = lowerPlsCaddToDae(parsePlsCadd(text));
        return { variableCount: dae.varCount, equationCount: dae.eqCount };
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default plscaddLanguage;
