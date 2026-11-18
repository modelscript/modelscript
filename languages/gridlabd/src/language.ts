// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript GridLAB-D (.glm) Language Definition.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerGridlabdToDae } from "./dae/gridlabd-to-dae.js";
import { gridlabdGrammar } from "./grammar/gridlabd-grammar.js";
import { canIndexGridlabd, indexGridlabdDocument } from "./indexing.js";
import { lintGridlabd } from "./lints/index.js";
import { parseGridlabd } from "./parser/gridlabd-parser.js";
import { gridlabdPolyglotConfig } from "./tgg/index.js";

export const gridlabdLanguage = language({
  polyglot: gridlabdPolyglotConfig,
  name: "gridlabd",
  fileExtensions: [".glm"],
  maturity: "experimental",
  indexing: {
    indexFile: indexGridlabdDocument,
    canIndex: canIndexGridlabd,
  },
  lsp: {
    fileExtensions: [".glm"],
    folding: gridlabdGrammar.lsp?.folding,
    outline: gridlabdGrammar.lsp?.outline,
  },
  word: gridlabdGrammar.word,
  extras: gridlabdGrammar.extras,
  conflicts: gridlabdGrammar.conflicts,
  rules: gridlabdGrammar.rules,

  actions: [
    {
      id: "lint_gridlabd",
      title: "Lint GridLAB-D Model",
      description: "Validates clock, module declarations, bus references, phase compatibility, and swing bus setup.",
      category: "verify",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "gridlabd_lint",
          displayName: "Lint GridLAB-D Model",
          modelDescription: "Lints GridLAB-D (.glm) model for unresolved buses, phase mismatches, and missing modules.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const model = parseGridlabd(text);
        return lintGridlabd(model);
      },
    },
    {
      id: "gridlabd_to_dae",
      title: "Lower GridLAB-D Model to DAE",
      description:
        "Compiles GridLAB-D distribution nodes, lines, transformers, loads, and DERs into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const model = parseGridlabd(text);
        const dae = lowerGridlabdToDae(model);
        return {
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
  ],
});

export default gridlabdLanguage;
