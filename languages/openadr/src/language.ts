// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerOpenAdrToDae } from "./dae/openadr-to-dae.js";
import { indexOpenAdrFile } from "./indexing.js";
import { lintOpenAdr } from "./lints/rules.js";
import { parseOpenAdr } from "./parser/openadr-parser.js";
import { evaluateCurtailment } from "./solver/curtailment-evaluator.js";

export const openadrLanguage = language({
  name: "openadr",
  fileExtensions: [".oadr", ".oadr.xml", ".oadr.json", ".xml", ".json"],
  maturity: "experimental",
  indexing: {
    indexFile: indexOpenAdrFile,
    canIndex: (uri, text) => {
      const lower = uri.toLowerCase();
      if (lower.endsWith(".oadr") || lower.endsWith(".oadr.xml") || lower.endsWith(".oadr.json")) return true;
      return Boolean(
        text &&
        (text.includes("oadrPayload") ||
          text.includes("oadrDistributeEvent") ||
          text.includes("targetVenId") ||
          text.includes("signalType")),
      );
    },
  },
  lsp: {
    fileExtensions: [".oadr", ".oadr.xml", ".oadr.json"],
  },
  rules: {
    Root: () => "openadr",
  },

  actions: [
    {
      id: "openadr_lint",
      title: "Lint OpenADR Deck",
      description: "Checks demand response interval durations, non-negative payloads, and event status integrity.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const deck = parseOpenAdr(text);
        return lintOpenAdr(deck);
      },
    },
    {
      id: "openadr_evaluate",
      title: "Evaluate Demand Response Schedule",
      description: "Generates time-stamped active power curtailment limits and dynamic price trajectories.",
      category: "simulate",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const deck = parseOpenAdr(text);
        return evaluateCurtailment(deck);
      },
    },
    {
      id: "openadr_to_dae",
      title: "Lower OpenADR to DAE Arena",
      description:
        "Compiles demand response curtailment ceilings and dynamic price multipliers into ModelScript linear memory.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const deck = parseOpenAdr(text);
        const arena = lowerOpenAdrToDae(deck);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
  ],
});
