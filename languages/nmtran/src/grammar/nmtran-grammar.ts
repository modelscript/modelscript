// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Formal DSL Grammar Specification.
 *
 * Declarative NONMEM / NMTRAN control stream grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const nmtranGrammar = language({
  name: "Nmtran",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: ["RecordBlock"],
    outline: [
      "ProblemRecord",
      "DataRecord",
      "InputRecord",
      "SubroutineRecord",
      "PkRecord",
      "DesRecord",
      "ErrorRecord",
      "ThetaRecord",
      "OmegaRecord",
      "SigmaRecord",
    ],
  },
  rules: {
    ControlStream: ($) => repeat(choice($.RecordBlock, $.CommentLine)),

    RecordBlock: ($) =>
      choice(
        $.ProblemRecord,
        $.DataRecord,
        $.InputRecord,
        $.SubroutineRecord,
        $.ModelRecord,
        $.PkRecord,
        $.DesRecord,
        $.ErrorRecord,
        $.ThetaRecord,
        $.OmegaRecord,
        $.SigmaRecord,
        $.EstimationRecord,
        $.TableRecord,
        $.GenericRecord,
      ),

    ProblemRecord: ($) => seq(semanticToken("keyword", choice("$PROBLEM", "$PROB")), field("title", $.RestOfLine)),

    DataRecord: ($) =>
      seq(
        semanticToken("keyword", "$DATA"),
        field("file", choice($.StringLiteral, $.Identifier)),
        repeat(field("option", $.RecordOption)),
      ),

    InputRecord: ($) =>
      seq(semanticToken("keyword", "$INPUT"), repeat(field("item", choice($.Identifier, $.RecordOption)))),

    SubroutineRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$SUBROUTINES", "$SUBROUTINE", "$SUBR")),
        repeat(field("item", choice($.Identifier, $.RecordOption))),
      ),

    ModelRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$MODEL", "$MOD")),
        repeat(field("item", choice($.Identifier, $.RecordOption))),
      ),

    PkRecord: ($) => seq(semanticToken("keyword", "$PK"), repeat($.Equation)),

    DesRecord: ($) => seq(semanticToken("keyword", "$DES"), repeat($.Equation)),

    ErrorRecord: ($) => seq(semanticToken("keyword", choice("$ERROR", "$ERR")), repeat($.Equation)),

    ThetaRecord: ($) =>
      seq(semanticToken("keyword", choice("$THETA", "$THET")), repeat(choice($.ThetaBound, $.NumberLiteral))),

    ThetaBound: ($) =>
      seq(
        "(",
        field("lower", optional(seq(choice($.NumberLiteral, "-INF"), ","))),
        field("init", $.NumberLiteral),
        field("upper", optional(seq(",", choice($.NumberLiteral, "INF")))),
        ")",
        optional(semanticToken("keyword", "FIXED")),
      ),

    OmegaRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$OMEGA", "$OMEG")),
        repeat(choice($.NumberLiteral, semanticToken("keyword", choice("FIXED", "BLOCK", "SAME")))),
      ),

    SigmaRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$SIGMA", "$SIGM")),
        repeat(choice($.NumberLiteral, semanticToken("keyword", choice("FIXED", "BLOCK", "SAME")))),
      ),

    EstimationRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$ESTIMATION", "$EST")),
        repeat(choice($.Identifier, $.RecordOption, $.NumberLiteral)),
      ),

    TableRecord: ($) =>
      seq(semanticToken("keyword", choice("$TABLE", "$TAB")), repeat(choice($.Identifier, $.RecordOption))),

    GenericRecord: ($) =>
      seq(field("recordName", /\$[A-Z0-9_]+/), repeat(choice($.Identifier, $.RecordOption, $.NumberLiteral))),

    RecordOption: ($) =>
      seq(field("key", $.Identifier), "=", field("value", choice($.NumberLiteral, $.StringLiteral, $.Identifier))),

    Equation: ($) => choice($.DerivativeEquation, $.AssignmentEquation, $.IfEquation),

    DerivativeEquation: ($) =>
      seq(field("lhs", seq("DADT", "(", $.NumberLiteral, ")")), "=", field("rhs", $.Expression)),

    AssignmentEquation: ($) =>
      seq(
        field("lhs", choice(seq($.Identifier, optional(seq("(", choice($.NumberLiteral, $.Identifier), ")"))))),
        "=",
        field("rhs", $.Expression),
      ),

    IfEquation: ($) =>
      seq(
        semanticToken("keyword", choice("IF", "if")),
        "(",
        field("cond", $.Expression),
        ")",
        semanticToken("keyword", choice("THEN", "then")),
        repeat($.Equation),
        optional(seq(semanticToken("keyword", choice("ELSE", "else")), repeat($.Equation))),
        semanticToken("keyword", choice("ENDIF", "endif")),
      ),

    Expression: ($) => choice($.BinaryExpr, $.UnaryExpr, $.CallExpr, $.PrimaryExpr),

    BinaryExpr: ($) => seq($.PrimaryExpr, choice("+", "-", "*", "/", "**"), choice($.BinaryExpr, $.PrimaryExpr)),

    UnaryExpr: ($) => seq(choice("-", "+"), $.PrimaryExpr),

    CallExpr: ($) =>
      seq(field("func", $.Identifier), "(", optional(seq($.Expression, repeat(seq(",", $.Expression)))), ")"),

    PrimaryExpr: ($) => choice($.NumberLiteral, $.Identifier, seq("(", $.Expression, ")")),

    CommentLine: () => /;[^\n]*/,
    RestOfLine: () => /[^\n\r]+/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
  },
});
