// SPDX-License-Identifier: AGPL-3.0-or-later

import { cardDeckRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerCymeToDae } from "./dae/cyme-to-dae.js";
import { canIndexCyme, indexCymeDocument } from "./indexing.js";
import { lintCymeNetwork } from "./lints/index.js";
import { parseCyme } from "./parser/cyme-parser.js";
import { projectCymeToOpenDss } from "./projections/cyme-to-opendss.js";
import { cymePolyglotConfig } from "./tgg/index.js";

export const cymeLanguage = language({
  polyglot: cymePolyglotConfig,
  name: "cyme",
  fileExtensions: [".sxst", ".cyme"],
  maturity: "experimental",
  indexing: {
    indexFile: indexCymeDocument,
    canIndex: canIndexCyme,
  },
  lsp: {
    fileExtensions: [".sxst", ".cyme"],
  },
  ui: {
    toolbarButtons: [
      {
        id: "lowerCymeDae",
        label: "Lower CYME Network to DAE",
        shortLabel: "Lower CYME",
        tooltip: "Lower CYME Network to DAE",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 10,
        actionId: "lower_cyme_dae",
      },
      {
        id: "cymeToOpendss",
        label: "Export CYME Network to OpenDSS",
        shortLabel: "Export CYME",
        tooltip: "Export CYME Network to OpenDSS",
        icon: "export",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "cyme_to_opendss",
      },
      {
        id: "lintCyme",
        label: "Lint CYME Network",
        shortLabel: "Lint CYME",
        tooltip: "Lint CYME Network",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "lint_cyme",
      },
    ],
  },
  actions: [
    {
      id: "lint_cyme",
      title: "Lint CYME Network",
      description: "Checks node uniqueness, source presence, section endpoints, and voltage ratings.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintCymeNetwork(parseCyme(text));
      },
    },
    {
      id: "lower_cyme_dae",
      title: "Lower CYME Network to DAE",
      description: "Compiles CYME distribution nodes, sections, and spot loads into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const dae = lowerCymeToDae(parseCyme(text));
        return { variableCount: dae.varCount, equationCount: dae.eqCount };
      },
    },
    {
      id: "cyme_to_opendss",
      title: "Export CYME Network to OpenDSS",
      description: "Projects CYME distribution network to EPRI OpenDSS (.dss) script.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return projectCymeToOpenDss(parseCyme(text));
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default cymeLanguage;
