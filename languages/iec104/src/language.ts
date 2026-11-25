// SPDX-License-Identifier: AGPL-3.0-or-later

import { cardDeckRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerIec104ToDae } from "./dae/iec104-to-dae.js";
import { canIndexIec104, indexIec104Document } from "./indexing.js";
import { lintIec104Profile } from "./lints/index.js";
import { parseIec104 } from "./parser/iec104-parser.js";
import { iec104PolyglotConfig } from "./tgg/index.js";

export const iec104Language = language({
  polyglot: iec104PolyglotConfig,
  name: "iec104",
  fileExtensions: [".iec104", ".104"],
  maturity: "experimental",
  indexing: {
    indexFile: indexIec104Document,
    canIndex: canIndexIec104,
  },
  lsp: {
    fileExtensions: [".iec104", ".104"],
  },
  ui: {
    toolbarButtons: [
      {
        id: "lowerIec104Dae",
        label: "Lower IEC 60870-5-104 Profile to DAE",
        shortLabel: "Lower IEC",
        tooltip: "Lower IEC 60870-5-104 Profile to DAE",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 10,
        actionId: "lower_iec104_dae",
      },
      {
        id: "lintIec104",
        label: "Lint IEC 60870-5-104 Profile",
        shortLabel: "Lint IEC",
        tooltip: "Lint IEC 60870-5-104 Profile",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 20,
        actionId: "lint_iec104",
      },
    ],
  },
  actions: [
    {
      id: "lint_iec104",
      title: "Lint IEC 60870-5-104 Profile",
      description: "Validates ASDU common address, APCI k/w windows, and unique IOAs.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintIec104Profile(parseIec104(text));
      },
    },
    {
      id: "lower_iec104_dae",
      title: "Lower IEC 60870-5-104 Profile to DAE",
      description: "Compiles IEC 104 IOA monitoring and command points into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const dae = lowerIec104ToDae(parseIec104(text));
        return { variableCount: dae.varCount, equationCount: dae.eqCount };
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default iec104Language;
