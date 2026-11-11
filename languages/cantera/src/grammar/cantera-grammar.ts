// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Formal DSL Grammar Specification.
 *
 * Declarative Cantera chemical kinetics & thermochemistry grammar supporting both
 * modern YAML (.yaml) and legacy CTI (.cti) specifications defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, repeat1, seq } from "@modelscript/dsl";

export const canteraGrammar = language({
  name: "Cantera",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: ["CtiDirective", "YamlSection", "YamlSequenceItem"],
    outline: ["CtiDirective", "YamlSection"],
  },
  rules: {
    MechanismFile: ($) => repeat(choice($.CtiDirective, $.YamlSection, $.Statement)),

    // Legacy CTI directive: ideal_gas(...), species(...), reaction(...)
    CtiDirective: ($) =>
      seq(
        field(
          "directiveName",
          choice(
            "ideal_gas",
            "gas",
            "species",
            "reaction",
            "three_body_reaction",
            "falloff_reaction",
            "plog_reaction",
            "element",
            "units",
            $.Identifier,
          ),
        ),
        "(",
        optional($.ArgumentList),
        ")",
      ),

    ArgumentList: ($) =>
      seq(
        choice($.NamedArgument, $.Expression),
        repeat(seq(",", choice($.NamedArgument, $.Expression))),
        optional(","),
      ),

    NamedArgument: ($) => seq(field("paramName", $.Identifier), "=", field("value", $.Expression)),

    // Modern Cantera YAML sections
    YamlSection: ($) =>
      seq(
        field(
          "sectionKey",
          choice("phases", "species", "reactions", "elements", "units", "description", "generator", $.Identifier),
        ),
        ":",
        choice($.YamlBlock, $.Expression),
      ),

    YamlBlock: ($) => choice($.YamlSequence, $.YamlMapping),

    YamlSequence: ($) => repeat1($.YamlSequenceItem),

    YamlSequenceItem: ($) => seq("-", choice($.YamlMapping, $.Expression)),

    YamlMapping: ($) => repeat1($.YamlEntry),

    YamlEntry: ($) =>
      seq(
        field(
          "key",
          choice(
            "equation",
            "rate-constant",
            "type",
            "reversible",
            "orders",
            "duplicate",
            "troe",
            "low-P-rate-constant",
            "name",
            "composition",
            "thermo",
            "transport",
            "note",
            $.StringLiteral,
            $.Identifier,
          ),
        ),
        ":",
        field("value", choice($.YamlMapping, $.Expression)),
      ),

    Statement: ($) => seq(field("lhs", $.Identifier), choice("=", ":"), field("rhs", $.Expression)),

    Expression: ($) =>
      choice($.ListLiteral, $.TupleLiteral, $.FunctionCall, $.StringLiteral, $.NumberLiteral, $.Identifier),

    ListLiteral: ($) => seq("[", optional(seq($.Expression, repeat(seq(",", $.Expression)), optional(","))), "]"),

    TupleLiteral: ($) => seq("(", optional(seq($.Expression, repeat(seq(",", $.Expression)), optional(","))), ")"),

    FunctionCall: ($) => seq(field("callee", $.Identifier), "(", optional($.ArgumentList), ")"),

    // Terminals
    CommentLine: () => /#.*|\/\/.*|--.*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_\-.]*/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
  },
});
