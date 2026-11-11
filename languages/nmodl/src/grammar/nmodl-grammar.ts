// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Formal DSL Grammar Specification.
 *
 * Declarative NEURON NMODL electrophysiology grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const nmodlGrammar = language({
  name: "Nmodl",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: [
      "NeuronBlock",
      "UnitsBlock",
      "ParameterBlock",
      "StateBlock",
      "AssignedBlock",
      "BreakpointBlock",
      "DerivativeBlock",
      "ProcedureBlock",
      "FunctionBlock",
    ],
    outline: [
      "TitleBlock",
      "NeuronBlock",
      "ParameterBlock",
      "StateBlock",
      "BreakpointBlock",
      "DerivativeBlock",
      "ProcedureBlock",
      "FunctionBlock",
    ],
  },
  rules: {
    Document: ($) => repeat(choice($.Block, $.CommentLine)),

    Block: ($) =>
      choice(
        $.TitleBlock,
        $.NeuronBlock,
        $.UnitsBlock,
        $.ParameterBlock,
        $.StateBlock,
        $.AssignedBlock,
        $.BreakpointBlock,
        $.DerivativeBlock,
        $.InitialBlock,
        $.ProcedureBlock,
        $.FunctionBlock,
      ),

    TitleBlock: ($) => seq(semanticToken("keyword", choice("TITLE", "title")), field("title", $.RestOfLine)),

    NeuronBlock: ($) => seq(semanticToken("keyword", choice("NEURON", "neuron")), "{", repeat($.NeuronStatement), "}"),

    NeuronStatement: ($) =>
      choice(
        seq(semanticToken("keyword", choice("SUFFIX", "suffix")), field("suffix", $.Identifier)),
        seq(
          semanticToken("keyword", choice("NONSPECIFIC_CURRENT", "nonspecific_current")),
          repeat(choice($.Identifier, ",")),
        ),
        seq(
          semanticToken("keyword", choice("USEION", "useion")),
          field("ion", $.Identifier),
          repeat(
            choice(
              seq(semanticToken("keyword", choice("READ", "read")), repeat(choice($.Identifier, ","))),
              seq(semanticToken("keyword", choice("WRITE", "write")), repeat(choice($.Identifier, ","))),
              seq(semanticToken("keyword", choice("VALENCE", "valence")), choice($.NumberLiteral, $.Identifier)),
            ),
          ),
        ),
        seq(semanticToken("keyword", choice("RANGE", "range")), repeat(choice($.Identifier, ","))),
        seq(semanticToken("keyword", choice("GLOBAL", "global")), repeat(choice($.Identifier, ","))),
      ),

    UnitsBlock: ($) =>
      seq(semanticToken("keyword", choice("UNITS", "units")), "{", repeat(choice($.UnitsDef, $.CommentLine)), "}"),

    UnitsDef: ($) =>
      seq("(", field("unit", $.Identifier), ")", "=", "(", field("target", choice($.NumberLiteral, $.Identifier)), ")"),

    ParameterBlock: ($) =>
      seq(
        semanticToken("keyword", choice("PARAMETER", "parameter")),
        "{",
        repeat(choice($.ParameterDecl, $.CommentLine)),
        "}",
      ),

    ParameterDecl: ($) =>
      seq(
        field("name", $.Identifier),
        optional(seq("=", field("value", choice($.NumberLiteral, $.Identifier)))),
        optional(seq("(", field("unit", $.Identifier), ")")),
        optional(seq("<", choice($.NumberLiteral, $.Identifier), ",", choice($.NumberLiteral, $.Identifier), ">")),
      ),

    StateBlock: ($) =>
      seq(semanticToken("keyword", choice("STATE", "state")), "{", repeat(choice($.StateDecl, $.CommentLine)), "}"),

    StateDecl: ($) => seq(field("name", $.Identifier), optional(seq("(", field("unit", $.Identifier), ")"))),

    AssignedBlock: ($) =>
      seq(
        semanticToken("keyword", choice("ASSIGNED", "assigned")),
        "{",
        repeat(choice($.StateDecl, $.CommentLine)),
        "}",
      ),

    BreakpointBlock: ($) =>
      seq(
        semanticToken("keyword", choice("BREAKPOINT", "breakpoint")),
        "{",
        repeat(choice($.Statement, $.CommentLine)),
        "}",
      ),

    DerivativeBlock: ($) =>
      seq(
        semanticToken("keyword", choice("DERIVATIVE", "derivative")),
        field("blockName", $.Identifier),
        "{",
        repeat(choice($.Statement, $.CommentLine)),
        "}",
      ),

    InitialBlock: ($) =>
      seq(semanticToken("keyword", choice("INITIAL", "initial")), "{", repeat(choice($.Statement, $.CommentLine)), "}"),

    ProcedureBlock: ($) =>
      seq(
        semanticToken("keyword", choice("PROCEDURE", "procedure")),
        field("name", $.Identifier),
        "(",
        optional(seq($.ProcedureArg, repeat(seq(",", $.ProcedureArg)))),
        ")",
        "{",
        repeat(choice($.Statement, $.CommentLine)),
        "}",
      ),

    ProcedureArg: ($) => seq(field("name", $.Identifier), optional(seq("(", field("unit", $.Identifier), ")"))),

    FunctionBlock: ($) =>
      seq(
        semanticToken("keyword", choice("FUNCTION", "function")),
        field("name", $.Identifier),
        "(",
        optional(seq($.ProcedureArg, repeat(seq(",", $.ProcedureArg)))),
        ")",
        optional(seq("(", field("unit", $.Identifier), ")")),
        "{",
        repeat(choice($.Statement, $.CommentLine)),
        "}",
      ),

    Statement: ($) =>
      choice($.SolveStatement, $.DerivativeEquation, $.AssignmentEquation, $.CallStatement, $.IfStatement),

    SolveStatement: ($) =>
      seq(
        semanticToken("keyword", choice("SOLVE", "solve")),
        field("target", $.Identifier),
        optional(seq(semanticToken("keyword", choice("METHOD", "method")), field("method", $.Identifier))),
      ),

    DerivativeEquation: ($) => seq(field("lhs", seq($.Identifier, "'")), "=", field("rhs", $.Expression)),

    AssignmentEquation: ($) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expression)),

    CallStatement: ($) =>
      seq(field("func", $.Identifier), "(", optional(seq($.Expression, repeat(seq(",", $.Expression)))), ")"),

    IfStatement: ($) =>
      seq(
        semanticToken("keyword", choice("IF", "if")),
        "(",
        field("cond", $.Expression),
        ")",
        "{",
        repeat($.Statement),
        "}",
        optional(seq(semanticToken("keyword", choice("ELSE", "else")), "{", repeat($.Statement), "}")),
      ),

    Expression: ($) => choice($.BinaryExpr, $.UnaryExpr, $.CallExpr, $.PrimaryExpr),

    BinaryExpr: ($) =>
      seq(
        $.PrimaryExpr,
        choice("+", "-", "*", "/", "^", "<", ">", "<=", ">=", "=="),
        choice($.BinaryExpr, $.PrimaryExpr),
      ),

    UnaryExpr: ($) => seq(choice("-", "+"), $.PrimaryExpr),

    CallExpr: ($) =>
      seq(field("func", $.Identifier), "(", optional(seq($.Expression, repeat(seq(",", $.Expression)))), ")"),

    PrimaryExpr: ($) => choice($.NumberLiteral, $.Identifier, seq("(", $.Expression, ")")),

    CommentLine: () => /:[^\n]*|\?[^\n]*/,
    RestOfLine: () => /[^\n\r]+/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
  },
});
