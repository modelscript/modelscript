// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";

/**
 * DSL language specification for GENSYS railway vehicle models and track geometry.
 */
export const gensysLanguage = language({
  name: "gensys",
  fileExtensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel"],
  lsp: {
    fileExtensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel"],
  },

  rules: {
    Deck: ($) => repeat(choice($.CardStatement, $.Comment)),

    CardStatement: ($) => choice($.BodyCard, $.WheelsetCard, $.SpringCard, $.SubCard, $.GenericCard),

    BodyCard: ($) =>
      seq(
        choice("body", "BODY"),
        field("name", $.Identifier),
        field("mass", $.NumberLiteral),
        field("jx", $.NumberLiteral),
        field("jy", $.NumberLiteral),
        field("jz", $.NumberLiteral),
        repeat($.NumberLiteral),
      ),

    WheelsetCard: ($) =>
      seq(
        choice("wheelset", "WHEELSET"),
        field("name", $.Identifier),
        field("mass", $.NumberLiteral),
        field("gauge", $.NumberLiteral),
        field("wheelRadius", $.NumberLiteral),
        field("conicity", $.NumberLiteral),
      ),

    SpringCard: ($) =>
      seq(
        choice("spring", "SPRING"),
        field("name", $.Identifier),
        field("body1", $.Identifier),
        field("body2", $.Identifier),
        repeat($.NumberLiteral),
      ),

    SubCard: ($) => seq(choice("sub", "SUB"), field("name", $.Identifier)),

    GenericCard: ($) => seq($.Identifier, repeat(choice($.NumberLiteral, $.Identifier, $.StringLiteral))),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_:-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:#.*|%.*|\/\/.*)/,
  },
});

export default gensysLanguage;
