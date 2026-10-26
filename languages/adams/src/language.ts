// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";

/**
 * DSL language specification for MSC Adams multibody models (.adm, .cmd, .acf).
 */
export const adamsLanguage = language({
  name: "adams",
  fileExtensions: [".adm", ".cmd", ".acf"],
  lsp: {
    fileExtensions: [".adm", ".cmd", ".acf"],
  },

  rules: {
    Deck: ($) => repeat(choice($.CardStatement, $.Comment)),

    CardStatement: ($) =>
      choice($.PartCard, $.MarkerCard, $.JointCard, $.ForceCard, $.MotionCard, $.SimulateCard, $.GenericCard),

    PartCard: ($) =>
      seq(
        choice("PART", "part"),
        "/",
        field("id", $.Identifier),
        repeat(choice(",", "=", $.Identifier, $.NumberLiteral)),
      ),

    MarkerCard: ($) =>
      seq(
        choice("MARKER", "marker"),
        "/",
        field("id", $.Identifier),
        repeat(choice(",", "=", $.Identifier, $.NumberLiteral)),
      ),

    JointCard: ($) =>
      seq(
        choice("JOINT", "joint"),
        "/",
        field("id", $.Identifier),
        repeat(choice(",", "=", $.Identifier, $.NumberLiteral)),
      ),

    ForceCard: ($) =>
      seq(
        choice("SPRINGDAMPER", "SFORCE", "VFORCE", "GFORCE", "BUSHING"),
        "/",
        field("id", $.Identifier),
        repeat(choice(",", "=", $.Identifier, $.NumberLiteral, $.StringLiteral)),
      ),

    MotionCard: ($) =>
      seq(
        choice("MOTION", "motion"),
        "/",
        field("id", $.Identifier),
        repeat(choice(",", "=", $.Identifier, $.NumberLiteral, $.StringLiteral)),
      ),

    SimulateCard: ($) =>
      seq(
        choice("SIMULATE", "simulate"),
        "/",
        field("type", $.Identifier),
        repeat(choice(",", "=", $.Identifier, $.NumberLiteral)),
      ),

    GenericCard: ($) =>
      seq($.Identifier, repeat(choice("/", ",", "=", $.Identifier, $.NumberLiteral, $.StringLiteral))),

    Identifier: () => /[A-Za-z_$][A-Za-z0-9_:-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:D|d)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:!.*|\$.*|\/\/.*)/,
  },
});

export default adamsLanguage;
