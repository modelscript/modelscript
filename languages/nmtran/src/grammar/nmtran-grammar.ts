// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Formal DSL Grammar Specification.
 *
 * Declarative NONMEM / NMTRAN control stream grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "@modelscript/dsl";

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
    ControlStream: ($) => repeat($.RecordBlock),

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

    ProblemRecord: () => semanticToken("keyword", choice(/\$(?:PROBLEM|PROB)[ \t][^\r\n;]*/, "$PROBLEM", "$PROB")),

    DataRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$DATA", "$DAT", "$INFILE")),
        field("file", $.DataFile),
        repeat(field("option", choice($.RecordOption, $.Identifier, $.ParenOptionList))),
      ),

    DataFile: ($) =>
      choice(
        $.StringLiteral,
        seq(
          choice($.Identifier, $.DottedIdent, "..", "."),
          repeat(seq(choice("/", "-"), choice($.Identifier, $.DottedIdent, $.NumberLiteral, ".."))),
        ),
      ),

    InputRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$INPUT", "$INPT")),
        repeat(field("item", choice($.RecordOption, $.Identifier))),
      ),

    SubroutineRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$SUBROUTINES", "$SUBROUTINE", "$SUBR", "$SUB")),
        repeat(field("item", choice($.RecordOption, $.Identifier, $.SignedNumber))),
      ),

    ModelRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$MODEL", "$MOD")),
        repeat(field("item", choice($.RecordOption, $.Identifier, $.SignedNumber, $.ParenOptionList))),
      ),

    PkRecord: ($) => seq(semanticToken("keyword", choice("$PK", "$PRED")), repeat($.Equation)),

    DesRecord: ($) => seq(semanticToken("keyword", "$DES"), repeat($.Equation)),

    ErrorRecord: ($) => seq(semanticToken("keyword", choice("$ERROR", "$ERR")), repeat($.Equation)),

    ThetaRecord: ($) => seq(semanticToken("keyword", choice("$THETA", "$THET")), repeat($.ThetaItem)),

    ThetaItem: ($) =>
      choice($.ThetaBound, seq($.SignedNumber, optional(semanticToken("keyword", choice("FIXED", "FIX"))))),

    ThetaBound: ($) =>
      seq(
        "(",
        $.ThetaBoundElem,
        repeat($.ThetaBoundElem),
        ")",
        optional(semanticToken("keyword", choice("FIXED", "FIX"))),
      ),

    ThetaBoundElem: ($) =>
      choice(
        seq(optional(choice("-", "+")), choice($.NumberLiteral, "INF", "INFINITY")),
        semanticToken("keyword", choice("FIXED", "FIX")),
        ",",
      ),

    OmegaRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$OMEGA", "$OMEG")),
        repeat(
          choice(
            $.SignedNumber,
            semanticToken("keyword", choice("FIXED", "FIX", "BLOCK", "SAME", "DIAGONAL", "DIAG")),
            $.ParenOptionList,
          ),
        ),
      ),

    SigmaRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$SIGMA", "$SIGM")),
        repeat(
          choice(
            $.SignedNumber,
            semanticToken("keyword", choice("FIXED", "FIX", "BLOCK", "SAME", "DIAGONAL", "DIAG")),
            $.ParenOptionList,
          ),
        ),
      ),

    EstimationRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$ESTIMATION", "$ESTM", "$EST")),
        repeat(choice($.RecordOption, $.Identifier, $.SignedNumber, $.ParenOptionList)),
      ),

    TableRecord: ($) =>
      seq(
        semanticToken("keyword", choice("$TABLE", "$TAB")),
        repeat(choice($.RecordOption, $.Identifier, $.DottedIdent, $.SignedNumber, $.ParenOptionList)),
      ),

    GenericRecord: ($) =>
      seq(
        field("recordName", /\$[A-Za-z][A-Za-z0-9_]*/),
        repeat(choice($.RecordOption, $.Identifier, $.DottedIdent, $.SignedNumber, $.StringLiteral, $.ParenOptionList)),
      ),

    RecordOption: ($) =>
      seq(
        field("key", $.Identifier),
        "=",
        field(
          "value",
          choice($.SignedNumber, $.StringLiteral, $.Identifier, $.DottedIdent, "@", "#", ".", $.ParenOptionList),
        ),
      ),

    ParenOptionList: ($) =>
      seq(
        "(",
        repeat(
          choice(
            $.RecordOption,
            $.Identifier,
            $.DottedIdent,
            $.SignedNumber,
            $.StringLiteral,
            semanticToken("keyword", choice("FIXED", "FIX", "SAME")),
            "@",
            "#",
            ",",
            ".",
          ),
        ),
        ")",
      ),

    SignedNumber: ($) => seq(optional(choice("-", "+")), $.NumberLiteral),

    Equation: ($) => choice($.DerivativeEquation, $.AssignmentEquation, $.IfEquation),

    DerivativeEquation: ($) =>
      seq(field("lhs", seq("DADT", "(", $.NumberLiteral, ")")), "=", field("rhs", $.Expression)),

    AssignmentEquation: ($) =>
      seq(
        field("lhs", seq($.Identifier, optional(seq("(", choice($.NumberLiteral, $.Identifier), ")")))),
        "=",
        field("rhs", $.Expression),
      ),

    IfEquation: ($) =>
      prec.right(
        seq(
          semanticToken("keyword", choice("IF", "if")),
          "(",
          field("cond", $.Expression),
          ")",
          choice(
            seq(
              semanticToken("keyword", choice("THEN", "then")),
              repeat($.Equation),
              optional(seq(semanticToken("keyword", choice("ELSE", "else")), repeat($.Equation))),
              semanticToken("keyword", choice("ENDIF", "endif")),
            ),
            $.Equation,
          ),
        ),
      ),

    Expression: ($) => choice($.BinaryExpr, $.UnaryExpr, $.PrimaryExpr),

    BinaryExpr: ($) =>
      choice(
        prec.left(
          1,
          seq(
            $.Expression,
            choice("==", "/=", "!=", "<=", ">=", "<", ">", /\.(?:EQ|NE|LT|LE|GT|GE|AND|OR)\./i),
            $.Expression,
          ),
        ),
        prec.left(2, seq($.Expression, choice("+", "-"), $.Expression)),
        prec.left(3, seq($.Expression, choice("*", "/"), $.Expression)),
        prec.right(4, seq($.Expression, "**", $.Expression)),
      ),

    UnaryExpr: ($) => prec.right(5, seq(choice("-", "+"), $.Expression)),

    CallExpr: ($) =>
      seq(
        field("func", choice($.Identifier, "DADT")),
        "(",
        optional(seq($.Expression, repeat(seq(",", $.Expression)))),
        ")",
      ),

    PrimaryExpr: ($) => choice($.NumberLiteral, $.CallExpr, $.Identifier, seq("(", $.Expression, ")")),

    CommentLine: () => /;[^\r\n]*/,
    DottedIdent: () => /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?|\.[0-9]+(?:[eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
  },
});
