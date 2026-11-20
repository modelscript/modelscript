// SPDX-License-Identifier: AGPL-3.0-or-later

import { cardDeckRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerC37118ToDae } from "./dae/c37118-to-dae.js";
import { canIndexC37118, indexC37118Document } from "./indexing.js";
import { lintC37118Config } from "./lints/index.js";
import { parseC37118 } from "./parser/c37118-parser.js";
import { c37118PolyglotConfig } from "./tgg/index.js";

export const c37118Language = language({
  polyglot: c37118PolyglotConfig,
  name: "c37118",
  fileExtensions: [".c37118", ".pmu"],
  maturity: "experimental",
  indexing: {
    indexFile: indexC37118Document,
    canIndex: canIndexC37118,
  },
  lsp: {
    fileExtensions: [".c37118", ".pmu"],
  },
  ui: {
    toolbarButtons: [
      {
        id: "lowerC37118Dae",
        label: "Lower IEEE C37.118 PMU to DAE",
        shortLabel: "Lower IEEE",
        tooltip: "Lower IEEE C37.118 PMU to DAE",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 10,
        actionId: "lower_c37118_dae",
      },
      {
        id: "lintC37118",
        label: "Lint IEEE C37.118 PMU Profile",
        shortLabel: "Lint IEEE",
        tooltip: "Lint IEEE C37.118 PMU Profile",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "lint_c37118",
      },
    ],
  },
  actions: [
    {
      id: "lint_c37118",
      title: "Lint IEEE C37.118 PMU Profile",
      description: "Validates PMU IDCODE, reporting rate, phasor channels, and frequency/ROCOF bounds.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintC37118Config(parseC37118(text));
      },
    },
    {
      id: "lower_c37118_dae",
      title: "Lower IEEE C37.118 PMU to DAE",
      description: "Compiles PMU frequency, ROCOF, and synchrophasor channels into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const dae = lowerC37118ToDae(parseC37118(text));
        return { variableCount: dae.varCount, equationCount: dae.eqCount };
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default c37118Language;
