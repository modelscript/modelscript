// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Formal DSL Grammar Specification.
 *
 * Declarative Monolix MLXTRAN pharmacometrics grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const mlxtranGrammar = language({
  name: "Mlxtran",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: ["Section", "InputDeclaration", "MacroCall"],
    outline: ["Section", "InputDeclaration", "DerivativeEquation", "AssignmentEquation", "MacroCall"],
  },
  rules: {
    Model: ($) => repeat(choice($.Section, $.Statement, $.CommentLine)),

    Section: ($) =>
      seq(
        "[",
        field("sectionName", choice("LONGITUDINAL", "INDIVIDUAL", "POPULATION", "COVARIATE", "FIT", $.Identifier)),
        "]",
      ),

    Statement: ($) =>
      choice(
        $.InputDeclaration,
        $.EquationHeader,
        $.PkHeader,
        $.OutputHeader,
        $.DerivativeEquation,
        $.AssignmentEquation,
        $.MacroCall,
      ),

    InputDeclaration: ($) =>
      seq(
        semanticToken("keyword", "input"),
        "=",
        "{",
        optional(seq(field("param", $.InputItem), repeat(seq(",", field("param", $.InputItem))))),
        "}",
      ),

    InputItem: ($) =>
      seq(
        field("name", $.Identifier),
        optional(
          seq(
            "=",
            choice(
              $.NumberLiteral,
              seq("{", optional(seq(field("prop", $.InputProp), repeat(seq(",", field("prop", $.InputProp))))), "}"),
            ),
          ),
        ),
      ),

    InputProp: ($) => seq(field("key", $.Identifier), "=", field("value", choice($.NumberLiteral, $.Identifier))),

    EquationHeader: () => semanticToken("keyword", choice("EQUATION:", "equation:")),

    PkHeader: () => semanticToken("keyword", choice("PK:", "pk:")),

    OutputHeader: ($) =>
      seq(
        semanticToken("keyword", choice("output", "OUTPUT:", "output:")),
        optional("="),
        "{",
        optional(seq($.Identifier, repeat(seq(",", $.Identifier)))),
        "}",
      ),

    DerivativeEquation: ($) => seq(field("lhs", seq("ddt_", $.Identifier)), "=", field("rhs", $.Expression)),

    AssignmentEquation: ($) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expression)),

    MacroCall: ($) =>
      seq(
        field("macroName", choice("compartment", "iv", "oral", "transfer", "elimination", $.Identifier)),
        "(",
        optional(seq(field("arg", $.MacroArg), repeat(seq(",", field("arg", $.MacroArg))))),
        ")",
      ),

    MacroArg: ($) => seq(field("argName", $.Identifier), "=", field("argValue", choice($.NumberLiteral, $.Identifier))),

    Expression: ($) => choice($.BinaryExpr, $.UnaryExpr, $.CallExpr, $.PrimaryExpr),

    BinaryExpr: ($) => seq($.PrimaryExpr, choice("+", "-", "*", "/", "^"), choice($.BinaryExpr, $.PrimaryExpr)),

    UnaryExpr: ($) => seq(choice("-", "+"), $.PrimaryExpr),

    CallExpr: ($) =>
      seq(field("func", $.Identifier), "(", optional(seq($.Expression, repeat(seq(",", $.Expression)))), ")"),

    PrimaryExpr: ($) => choice($.NumberLiteral, $.Identifier, seq("(", $.Expression, ")")),

    CommentLine: () => /;[^\n]*|#[^\n]*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
  },
});
