// SPDX-License-Identifier: AGPL-3.0-or-later

import { cardDeckRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerRtdsToDae } from "./dae/rtds-to-dae.js";
import { canIndexRtds, indexRtdsDocument } from "./indexing.js";
import { lintRtdsDraft } from "./lints/index.js";
import { parseRtdsDraft } from "./parser/rtds-parser.js";
import { projectRtdsToAtp } from "./projections/rtds-to-atp.js";
import { rtdsPolyglotConfig } from "./tgg/index.js";

export const rtdsLanguage = language({
  polyglot: rtdsPolyglotConfig,
  name: "rtds",
  fileExtensions: [".dft", ".rtds"],
  maturity: "experimental",
  indexing: {
    indexFile: indexRtdsDocument,
    canIndex: canIndexRtds,
  },
  lsp: {
    fileExtensions: [".dft", ".rtds"],
  },
  actions: [
    {
      id: "lint_rtds",
      title: "Lint RTDS Draft",
      description: "Checks real-time EMT time step, component uniqueness, node connectivity, and RLC parameters.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintRtdsDraft(parseRtdsDraft(text));
      },
    },
    {
      id: "lower_rtds_dae",
      title: "Lower RTDS Draft to DAE",
      description: "Compiles RTDS EMT components into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const dae = lowerRtdsToDae(parseRtdsDraft(text));
        return { variableCount: dae.varCount, equationCount: dae.eqCount };
      },
    },
    {
      id: "rtds_to_atp",
      title: "Export RTDS Draft to ATP-EMTP",
      description: "Projects RTDS RSCAD draft netlist to ATP-EMTP card deck.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return projectRtdsToAtp(parseRtdsDraft(text));
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default rtdsLanguage;
