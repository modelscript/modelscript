// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { indexAdamsDocument } from "./indexing.js";
import { adamsPolyglotConfig } from "./tgg/index.js";

/**
 * DSL language specification for MSC Adams multibody models (.adm, .cmd, .acf).
 */
export const adamsLanguage = language({
  polyglot: adamsPolyglotConfig,
  name: "adams",
  fileExtensions: [".adm", ".cmd", ".acf"],
  maturity: "experimental",
  word: ($) => $["Identifier"]!,
  extras: ($) => [/[ \t\r\n]+/, "&", $["Comment"]!],
  indexing: {
    indexFile: indexAdamsDocument,
  },
  lsp: {
    fileExtensions: [".adm", ".cmd", ".acf"],
  },

  rules: {
    Deck: ($) => repeat($["CardStatement"]!),

    CardStatement: ($) =>
      choice(
        $["PartCard"]!,
        $["MarkerCard"]!,
        $["JointCard"]!,
        $["ForceCard"]!,
        $["MotionCard"]!,
        $["SimulateCard"]!,
        $["GenericCard"]!,
        $["EndCard"]!,
      ),

    PartCard: ($) =>
      seq($["PartHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    MarkerCard: ($) =>
      seq($["MarkerHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    JointCard: ($) =>
      seq($["JointHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    ForceCard: ($) =>
      seq($["ForceHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    MotionCard: ($) =>
      seq($["MotionHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    SimulateCard: ($) => seq($["SimulateHeader"]!, field("type", $["Identifier"]!), repeat($["CardArg"]!)),

    GenericCard: ($) => seq($["GenericHeader"]!, repeat($["CardArg"]!)),

    EndCard: () => choice("END", "end"),

    CardArg: ($) =>
      choice(
        ",",
        "=",
        "+",
        "-",
        "*",
        "/",
        "^",
        $["ParenExpr"]!,
        "END",
        "end",
        $["Identifier"]!,
        $["NumberLiteral"]!,
        $["StringLiteral"]!,
      ),

    ParenExpr: ($) => seq("(", repeat($["CardArg"]!), ")"),

    PartHeader: () => /(?:PART|part)\//,
    MarkerHeader: () => /(?:MARKER|marker)\//,
    JointHeader: () => /(?:JOINT|joint)\//,
    ForceHeader: () => /(?:SPRINGDAMPER|springdamper|SFORCE|sforce|VFORCE|vforce|GFORCE|gforce|BUSHING|bushing)\//,
    MotionHeader: () => /(?:MOTION|motion)\//,
    SimulateHeader: () => /(?:SIMULATE|simulate)\//,
    GenericHeader: () => /[A-Za-z_][A-Za-z0-9_.:]*\//,

    Identifier: () => /[A-Za-z_][A-Za-z0-9_.:]*/,
    NumberLiteral: () => /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[dD]?/,
    StringLiteral: () => /"[^"\\\r\n]*(?:\\.[^"\\\r\n]*)*"|'[^'\\\r\n]*(?:\\.[^'\\\r\n]*)*'/,
    Comment: () => /(?:!|\$|\/\/)[^\r\n]*/,
  },
});

export default adamsLanguage;
