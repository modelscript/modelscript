// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  field,
  language,
  optional,
  repeat,
  semanticToken,
  seq,
  type ActionExecutionContext,
} from "@modelscript/dsl";
import { lowerOpenAdrToDae } from "./dae/openadr-to-dae.js";
import { indexOpenAdrFile } from "./indexing.js";
import { lintOpenAdr } from "./lints/rules.js";
import { parseOpenAdr } from "./parser/openadr-parser.js";
import { evaluateCurtailment } from "./solver/curtailment-evaluator.js";
import { openadrPolyglotConfig } from "./tgg/index.js";

export const openadrLanguage = language({
  polyglot: openadrPolyglotConfig,
  name: "openadr",
  word: ($) => $["Identifier"]!,
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
    folding: ["ProgramDecl", "EventDecl", "IntervalDecl"],
    outline: ["ProgramDecl", "EventDecl", "IntervalDecl"],
  },
  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],
  rules: {
    Document: ($) => repeat(choice($["ProgramDecl"]!, $["EventDecl"]!, $["PropertyDecl"]!)),

    ProgramDecl: ($) =>
      seq(
        semanticToken("keyword", "program"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        "{",
        repeat(choice($["EventDecl"]!, $["PropertyDecl"]!)),
        "}",
      ),

    EventDecl: ($) =>
      seq(
        semanticToken("keyword", "event"),
        field("name", choice($["StringLiteral"]!, $["Identifier"]!)),
        "{",
        repeat(choice($["IntervalDecl"]!, $["PropertyDecl"]!)),
        "}",
      ),

    IntervalDecl: ($) =>
      seq(
        semanticToken("keyword", "interval"),
        optional(field("name", choice($["StringLiteral"]!, $["Identifier"]!))),
        "{",
        repeat($["PropertyDecl"]!),
        "}",
      ),

    PropertyDecl: ($) =>
      seq(
        field("key", $["Identifier"]!),
        choice(":", "="),
        field("value", choice($["StringLiteral"]!, $["IsoTimestamp"]!, $["NumberLiteral"]!, $["Identifier"]!)),
        optional(choice(";", ",")),
      ),

    StringLiteral: () => semanticToken("string", /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/),
    IsoTimestamp: () => semanticToken("string", /\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?/),
    NumberLiteral: () => semanticToken("number", /[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/),
    Identifier: () => semanticToken("variable", /[A-Za-z_][A-Za-z0-9_-]*/),
    Comment: () => semanticToken("comment", /(?:\/\/|#)[^\r\n]*/),
  },

  ui: {
    toolbarButtons: [
      {
        id: "openadrEvaluate",
        label: "Evaluate Demand Response Schedule",
        shortLabel: "Evaluate Demand",
        tooltip: "Evaluate Demand Response Schedule",
        icon: "zap",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        actionId: "openadr_evaluate",
      },
      {
        id: "openadrToDae",
        label: "Lower OpenADR to DAE Arena",
        shortLabel: "Lower OpenADR",
        tooltip: "Lower OpenADR to DAE Arena",
        icon: "zap",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 20,
        actionId: "openadr_to_dae",
      },
      {
        id: "openadrLint",
        label: "Lint OpenADR Deck",
        shortLabel: "Lint OpenADR",
        tooltip: "Lint OpenADR Deck",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "openadr_lint",
      },
    ],
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
