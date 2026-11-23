// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, prec, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInAcslLibrarySync } from "./catalog/library-package-adapter.js";
import { AcslErrorCode } from "./errors.js";
import { acslIndexing } from "./indexing.js";

/**
 * DSL language specification for ACSL (Advanced Continuous Simulation Language, 1975)
 * targeting `.csl` and `.acsl` files.
 */
export const acslLanguage = language({
  name: "acsl",
  fileExtensions: [".csl", ".acsl"],
  maturity: "beta",
  indexing: acslIndexing,
  lsp: {
    fileExtensions: [".csl", ".acsl"],
  },
  errorCodes: AcslErrorCode,

  rules: {
    Program: ($) =>
      seq(
        optional(seq("PROGRAM", optional(field("name", $["Identifier"]!)))),
        repeat($["TopLevelItem"]!),
        optional("END"),
      ),

    TopLevelItem: ($) =>
      choice(
        $["InitialSection"]!,
        $["DynamicSection"]!,
        $["DerivativeSection"]!,
        $["DiscreteSection"]!,
        $["TerminalSection"]!,
        $["MacroSection"]!,
        $["Statement"]!,
        $["Comment"]!,
      ),

    InitialSection: ($) => seq("INITIAL", repeat(choice($["Statement"]!, $["Comment"]!)), "END"),

    DynamicSection: ($) =>
      seq(
        "DYNAMIC",
        repeat(choice($["DerivativeSection"]!, $["DiscreteSection"]!, $["Statement"]!, $["Comment"]!)),
        "END",
      ),

    DerivativeSection: ($) =>
      seq(
        "DERIVATIVE",
        optional(field("name", $["Identifier"]!)),
        repeat(choice($["ProceduralBlock"]!, $["Statement"]!, $["Comment"]!)),
        "END",
      ),

    DiscreteSection: ($) =>
      seq("DISCRETE", optional(field("name", $["Identifier"]!)), repeat(choice($["Statement"]!, $["Comment"]!)), "END"),

    TerminalSection: ($) => seq("TERMINAL", repeat(choice($["Statement"]!, $["Comment"]!)), "END"),

    MacroSection: ($) =>
      seq(
        "MACRO",
        field("name", $["Identifier"]!),
        optional(seq("(", optional($["IdentList"]!), ")")),
        repeat(choice($["Statement"]!, $["Comment"]!)),
        "MACRO",
        "END",
      ),

    ProceduralBlock: ($) =>
      seq(
        "PROCEDURAL",
        optional(seq("(", optional($["IdentList"]!), optional(seq("=", optional($["IdentList"]!))), ")")),
        repeat(choice($["Statement"]!, $["Comment"]!)),
        "END",
      ),

    Statement: ($) =>
      choice(
        $["ConstantDecl"]!,
        $["IntegerDecl"]!,
        $["LogicalDecl"]!,
        $["ArrayDecl"]!,
        $["TableDecl"]!,
        $["CintervalStmt"]!,
        $["MaxtervalStmt"]!,
        $["AlgorithmStmt"]!,
        $["DerivtStmt"]!,
        $["IntervalStmt"]!,
        $["TermtStmt"]!,
        $["ScheduleStmt"]!,
        $["AssignmentStmt"]!,
      ),

    ConstantDecl: ($) => seq("CONSTANT", $["DeclItem"]!, repeat(seq(",", $["DeclItem"]!))),
    IntegerDecl: ($) => seq("INTEGER", $["DeclItem"]!, repeat(seq(",", $["DeclItem"]!))),
    LogicalDecl: ($) => seq("LOGICAL", $["DeclItem"]!, repeat(seq(",", $["DeclItem"]!))),

    ArrayDecl: ($) =>
      seq(
        "ARRAY",
        field("name", $["Identifier"]!),
        "(",
        $["NumberLiteral"]!,
        repeat(seq(",", $["NumberLiteral"]!)),
        ")",
        optional(seq("=", $["NumberLiteral"]!, repeat(seq(",", $["NumberLiteral"]!)))),
      ),

    TableDecl: ($) =>
      seq(
        "TABLE",
        field("name", $["Identifier"]!),
        ",",
        $["NumberLiteral"]!,
        ",",
        $["NumberLiteral"]!,
        "/",
        $["NumberLiteral"]!,
        repeat(seq(",", $["NumberLiteral"]!)),
        "/",
      ),

    DeclItem: ($) => seq(field("name", $["Identifier"]!), optional(seq("=", field("value", $["Expression"]!)))),

    CintervalStmt: ($) => seq("CINTERVAL", field("name", $["Identifier"]!), "=", field("value", $["Expression"]!)),
    MaxtervalStmt: ($) => seq("MAXTERVAL", field("name", $["Identifier"]!), "=", field("value", $["Expression"]!)),
    AlgorithmStmt: ($) =>
      seq("ALGORITHM", optional(seq(field("name", $["Identifier"]!), "=")), field("code", $["NumberLiteral"]!)),
    DerivtStmt: ($) => seq("DERIVT", optional("="), field("name", $["Identifier"]!)),
    IntervalStmt: ($) => seq("INTERVAL", field("name", $["Identifier"]!), "=", field("value", $["Expression"]!)),

    TermtStmt: ($) =>
      seq(
        "TERMT",
        "(",
        field("condition", $["Expression"]!),
        optional(seq(",", field("message", $["StringLiteral"]!))),
        ")",
      ),

    ScheduleStmt: ($) =>
      seq(
        "SCHEDULE",
        field("target", $["Identifier"]!),
        field("trigger", choice(".AT.", ".XZ.", ".XP.", ".XN.")),
        field("expr", $["Expression"]!),
      ),

    AssignmentStmt: ($) => seq(field("target", $["Identifier"]!), "=", field("value", $["Expression"]!)),

    IdentList: ($) => seq($["Identifier"]!, repeat(seq(",", $["Identifier"]!))),

    Expression: ($) =>
      choice(
        $["BinaryExpr"]!,
        $["UnaryExpr"]!,
        $["CallExpr"]!,
        $["ParenExpr"]!,
        $["NumberLiteral"]!,
        $["BooleanLiteral"]!,
        $["StringLiteral"]!,
        $["Identifier"]!,
      ),

    BinaryExpr: ($) =>
      choice(
        prec.left(1, seq($["Expression"]!, ".OR.", $["Expression"]!)),
        prec.left(2, seq($["Expression"]!, ".AND.", $["Expression"]!)),
        prec.left(
          3,
          seq(
            $["Expression"]!,
            choice(".EQ.", ".NE.", ".LT.", ".LE.", ".GT.", ".GE.", "==", "/=", "<", "<=", ">", ">="),
            $["Expression"]!,
          ),
        ),
        prec.left(4, seq($["Expression"]!, choice("+", "-"), $["Expression"]!)),
        prec.left(5, seq($["Expression"]!, choice("*", "/"), $["Expression"]!)),
        prec.right(6, seq($["Expression"]!, "**", $["Expression"]!)),
      ),

    UnaryExpr: ($) => prec.right(7, seq(choice("-", "+", ".NOT."), $["Expression"]!)),

    CallExpr: ($) =>
      seq(
        field("callee", choice("INTEG", $["Identifier"]!)),
        "(",
        optional(seq($["Expression"]!, repeat(seq(",", $["Expression"]!)))),
        ")",
      ),

    ParenExpr: ($) => seq("(", $["Expression"]!, ")"),

    BooleanLiteral: () => choice(".TRUE.", ".FALSE."),
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    StringLiteral: () => /'[^']*'|"[^"]*"/,
    Comment: () => /![^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInAcslLibrarySync();
