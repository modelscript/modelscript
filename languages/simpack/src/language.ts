// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";

/**
 * DSL language specification for SIMPACK multibody models (.spck, .sim, .mbs).
 */
export const simpackLanguage = language({
  name: "simpack",
  fileExtensions: [".spck", ".sim", ".mbs"],
  lsp: {
    fileExtensions: [".spck", ".sim", ".mbs"],
  },

  rules: {
    Deck: ($) => repeat(choice($.CardStatement, $.Comment)),

    CardStatement: ($) => choice($.BodyCard, $.MarkerCard, $.JointCard, $.GenericCard),

    BodyCard: ($) =>
      seq(
        choice("body", "$body", "BODY", "$BODY"),
        field("id", $.Identifier),
        field("name", $.Identifier),
        field("mass", $.NumberLiteral),
        repeat($.NumberLiteral),
      ),

    MarkerCard: ($) =>
      seq(
        choice("marker", "$marker", "MARKER", "$MARKER"),
        field("id", $.Identifier),
        field("body", $.Identifier),
        repeat($.NumberLiteral),
      ),

    JointCard: ($) =>
      seq(
        choice("joint", "$joint", "JOINT", "$JOINT"),
        field("id", $.Identifier),
        field("type", $.Identifier),
        field("from", $.Identifier),
        field("to", $.Identifier),
      ),

    GenericCard: ($) => seq($.Identifier, repeat(choice($.NumberLiteral, $.Identifier, $.StringLiteral))),

    Identifier: () => /[A-Za-z_$][A-Za-z0-9_:-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:\$#.*|#.*|!.*|\/\/.*)/,
  },
});

export default simpackLanguage;
