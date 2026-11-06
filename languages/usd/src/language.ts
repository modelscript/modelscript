// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq } from "@modelscript/dsl";

/**
 * DSL language specification for OpenUSD (.usd, .usda, .usdz) scene description.
 */
export const usdLanguage = language({
  name: "usd",
  fileExtensions: [".usd", ".usda", ".usdz"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".usd", ".usda", ".usdz"],
  },

  rules: {
    Stage: ($) => seq(choice($.Header, ""), repeat(choice($.PrimDef, $.Comment, $.MetadataAssignment))),

    Header: () => /#usda\s+[0-9]+\.[0-9]+/,

    MetadataAssignment: ($) => seq($.Identifier, "=", choice($.StringLiteral, $.NumberLiteral, $.Identifier)),

    PrimDef: ($) =>
      seq(
        choice("def", "over", "class"),
        $.Identifier,
        $.StringLiteral,
        choice(seq("(", repeat(choice($.MetadataItem, $.Comment)), ")"), ""),
        "{",
        repeat(choice($.PrimDef, $.AttributeDef, $.RelationshipDef, $.Comment)),
        "}",
      ),

    AttributeDef: ($) =>
      seq(
        choice("uniform", ""),
        $.TypeIdentifier,
        $.Identifier,
        choice(seq("=", $.Value), seq(".timeSamples", "=", "{", repeat($.TimeSample), "}")),
      ),

    RelationshipDef: ($) =>
      seq("rel", $.Identifier, "=", choice($.PathReference, seq("[", repeat($.PathReference), "]"))),

    MetadataItem: ($) => seq(choice("prepend", "append", ""), $.Identifier, "=", $.Value),

    TimeSample: ($) => seq($.NumberLiteral, ":", $.Value, choice(",", "")),

    Value: ($) =>
      choice(
        $.StringLiteral,
        $.NumberLiteral,
        $.BooleanLiteral,
        $.PathReference,
        $.TupleValue,
        $.ArrayValue,
        $.Identifier,
      ),

    TupleValue: ($) => seq("(", repeat(choice($.NumberLiteral, $.StringLiteral, $.Identifier, ",")), ")"),
    ArrayValue: ($) => seq("[", repeat(choice($.Value, ",")), "]"),

    PathReference: () => /<[^>]+>/,
    TypeIdentifier: () => /[A-Za-z_][A-Za-z0-9_:[\]]*/,
    Identifier: () => /[A-Za-z_:][A-Za-z0-9_:-]*/,
    StringLiteral: () => /"[^"]*"|'[^']*'/,
    NumberLiteral: () => /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/,
    BooleanLiteral: () => choice("true", "false"),
    Comment: () => /#[^\n]*/,
  },
});

export default usdLanguage;
