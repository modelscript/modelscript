// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { CplexLpErrorCode } from "./errors.js";
import { cplexLpIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for CPLEX LP & LINDO
 * algebraic optimization formats (`.lp`, `.ltx`, `.lindo`).
 */
export const cplexLpLanguage = language({
  name: "cplex-lp",
  fileExtensions: [".lp", ".ltx", ".lindo"],
  maturity: "beta",
  indexing: cplexLpIndexing,
  lsp: {
    fileExtensions: [".lp", ".ltx", ".lindo"],
  },
  errorCodes: CplexLpErrorCode,

  rules: {
    Model: ($) =>
      seq(
        repeat(
          choice(
            $["TitleDirective"]!,
            $["ObjectiveSection"]!,
            $["ConstraintsSection"]!,
            $["BoundsSection"]!,
            $["GeneralsSection"]!,
            $["BinariesSection"]!,
            $["SemiContinuousSection"]!,
            $["SosSection"]!,
            $["LindoDirective"]!,
            $["EndSection"]!,
            $["Comment"]!,
          ),
        ),
      ),

    TitleDirective: ($) => seq($["TitleKeyword"]!, field("title", $["Identifier"]!)),

    ObjectiveSection: ($) =>
      seq(
        field("sense", choice($["MinimizeKeyword"]!, $["MaximizeKeyword"]!)),
        optional(seq(field("name", $["Identifier"]!), ":")),
        repeat(choice($["LinearTerm"]!, $["QuadraticBlock"]!, $["Comment"]!)),
      ),

    ConstraintsSection: ($) => seq($["SubjectToKeyword"]!, repeat(choice($["Constraint"]!, $["Comment"]!))),

    Constraint: ($) =>
      seq(
        optional(seq(field("name", $["Identifier"]!), ":")),
        repeat(choice($["LinearTerm"]!, $["QuadraticBlock"]!)),
        field("operator", choice("<=", "<", ">=", ">", "=")),
        field("rhs", $["SignedNumber"]!),
      ),

    LinearTerm: ($) =>
      seq(optional($["Sign"]!), optional(seq($["NumberLiteral"]!, optional("*"))), field("variable", $["Identifier"]!)),

    QuadraticBlock: ($) =>
      seq(
        optional($["Sign"]!),
        "[",
        repeat($["QuadraticTerm"]!),
        "]",
        optional(seq("/", field("divisor", $["NumberLiteral"]!))),
      ),

    QuadraticTerm: ($) =>
      seq(
        optional($["Sign"]!),
        optional(seq($["NumberLiteral"]!, optional("*"))),
        field("var1", $["Identifier"]!),
        choice(seq("^", $["NumberLiteral"]!), seq("*", field("var2", $["Identifier"]!))),
      ),

    BoundsSection: ($) => seq($["BoundsKeyword"]!, repeat(choice($["BoundStatement"]!, $["Comment"]!))),

    BoundStatement: ($) =>
      choice(
        seq(field("variable", $["Identifier"]!), $["FreeKeyword"]!),
        seq(
          field("lower", $["BoundValue"]!),
          choice("<=", "<"),
          field("variable", $["Identifier"]!),
          optional(seq(choice("<=", "<"), field("upper", $["BoundValue"]!))),
        ),
        seq(field("variable", $["Identifier"]!), choice("<=", "<", ">=", ">", "="), field("bound", $["BoundValue"]!)),
      ),

    BoundValue: ($) => choice($["InfinityLiteral"]!, $["SignedNumber"]!),

    GeneralsSection: ($) => seq($["GeneralsKeyword"]!, repeat(choice($["Identifier"]!, $["Comment"]!))),

    BinariesSection: ($) => seq($["BinariesKeyword"]!, repeat(choice($["Identifier"]!, $["Comment"]!))),

    SemiContinuousSection: ($) => seq($["SemiContinuousKeyword"]!, repeat(choice($["Identifier"]!, $["Comment"]!))),

    SosSection: ($) => seq($["SosKeyword"]!, repeat(choice($["SosConstraint"]!, $["Comment"]!))),

    SosConstraint: ($) =>
      seq(
        optional(seq(field("name", $["Identifier"]!), ":")),
        field("sosType", $["SosType"]!),
        "::",
        repeat($["SosEntry"]!),
      ),

    SosEntry: ($) => seq(field("variable", $["Identifier"]!), ":", field("weight", $["SignedNumber"]!)),

    LindoDirective: ($) =>
      choice(
        seq($["FreeKeyword"]!, field("variable", $["Identifier"]!)),
        seq($["SlbKeyword"]!, field("variable", $["Identifier"]!), field("value", $["BoundValue"]!)),
        seq($["SubKeyword"]!, field("variable", $["Identifier"]!), field("value", $["BoundValue"]!)),
        seq($["GinKeyword"]!, choice($["Identifier"]!, $["NumberLiteral"]!)),
        seq($["IntKeyword"]!, choice($["Identifier"]!, $["NumberLiteral"]!)),
      ),

    EndSection: ($) => $["EndKeyword"]!,

    SignedNumber: ($) => seq(optional($["Sign"]!), $["NumberLiteral"]!),
    Sign: () => /[+-]/,
    NumberLiteral: () => /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/,
    InfinityLiteral: () => /[+-]?(?:[Ii][Nn][Ff][Ii][Nn][Ii][Tt][Yy]|[Ii][Nn][Ff])/,
    MinimizeKeyword: () => /(?:[Mm][Ii][Nn][Ii][Mm][Ii][ZzSs][Ee]|[Mm][Ii][Nn][Ii][Mm][Uu][Mm]|[Mm][Ii][Nn])/,
    MaximizeKeyword: () => /(?:[Mm][Aa][Xx][Ii][Mm][Ii][ZzSs][Ee]|[Mm][Aa][Xx][Ii][Mm][Uu][Mm]|[Mm][Aa][Xx])/,
    SubjectToKeyword: () =>
      /(?:[Ss][Uu][Bb][Jj][Ee][Cc][Tt]\s+[Tt][Oo]|[Ss][Uu][Cc][Hh]\s+[Tt][Hh][Aa][Tt]|[Ss]\.[Tt]\.|[Ss][Tt])/,
    BoundsKeyword: () => /[Bb][Oo][Uu][Nn][Dd][Ss]?/,
    GeneralsKeyword: () => /(?:[Gg][Ee][Nn][Ee][Rr][Aa][Ll][Ss]?|[Gg][Ee][Nn])/,
    BinariesKeyword: () => /(?:[Bb][Ii][Nn][Aa][Rr][Ii][Ee][Ss]|[Bb][Ii][Nn][Aa][Rr][Yy]|[Bb][Ii][Nn])/,
    SemiContinuousKeyword: () => /(?:[Ss][Ee][Mm][Ii]-[Cc][Oo][Nn][Tt][Ii][Nn][Uu][Oo][Uu][Ss]|[Ss][Ee][Mm][Ii][Ss]?)/,
    SosKeyword: () => /[Ss][Oo][Ss]/,
    SosType: () => /[Ss][12]/,
    FreeKeyword: () => /[Ff][Rr][Ee][Ee]/,
    TitleKeyword: () => /[Tt][Ii][Tt][Ll][Ee]/,
    SlbKeyword: () => /[Ss][Ll][Bb]/,
    SubKeyword: () => /[Ss][Uu][Bb]/,
    GinKeyword: () => /[Gg][Ii][Nn]/,
    IntKeyword: () => /[Ii][Nn][Tt]/,
    EndKeyword: () => /[Ee][Nn][Dd]/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.#$@%&~]*/,
    Comment: () => /(?:\\[^\r\n]*|![^\r\n]*)/,
  },
});
