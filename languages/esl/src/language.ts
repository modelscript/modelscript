// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInEslLibrarySync } from "./catalog/library-package-adapter.js";
import { EslErrorCode } from "./errors.js";
import { eslIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` specification for ESA ESL (European Space Agency
 * Simulation Language, 1980s) — `.esl`.
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm`) and JS/TS bindings
 * (`src-gen/bindings.{js,d.ts}`) via `scripts/build/build-language-parser.js`.
 */
export const eslLanguage = language({
  name: "esl",
  fileExtensions: [".esl"],
  maturity: "beta",
  indexing: eslIndexing,
  lsp: {
    fileExtensions: [".esl"],
  },
  errorCodes: EslErrorCode,

  conflicts: ($) => [[$["StudyBlock"]!, $["Identifier"]!], [$["BlockEnd"]!], [$["BlockEnd"]!, $["Identifier"]!]],

  rules: {
    Program: ($) => repeat(choice($["TopBlock"]!, $["Comment"]!)),

    TopBlock: ($) =>
      choice($["StudyBlock"]!, $["ModelBlock"]!, $["SubmodelBlock"]!, $["SegmentBlock"]!, $["PackageBlock"]!),

    StudyBlock: ($) =>
      seq(
        "STUDY",
        optional(field("name", $["Identifier"]!)),
        optional(";"),
        repeat(choice($["TopBlock"]!, $["Declaration"]!, $["Section"]!, $["Statement"]!, $["Comment"]!)),
        $["BlockEnd"]!,
      ),

    ModelBlock: ($) =>
      seq(
        "MODEL",
        field("name", $["Identifier"]!),
        optional($["ParamList"]!),
        optional(";"),
        repeat(choice($["SubmodelBlock"]!, $["Declaration"]!, $["Section"]!, $["Statement"]!, $["Comment"]!)),
        $["BlockEnd"]!,
      ),

    SubmodelBlock: ($) =>
      seq(
        "SUBMODEL",
        field("name", $["Identifier"]!),
        optional($["ParamList"]!),
        optional(";"),
        repeat(choice($["Declaration"]!, $["Section"]!, $["Statement"]!, $["Comment"]!)),
        $["BlockEnd"]!,
      ),

    SegmentBlock: ($) =>
      seq(
        "SEGMENT",
        field("name", $["Identifier"]!),
        optional($["ParamList"]!),
        optional(";"),
        repeat(choice($["Declaration"]!, $["Section"]!, $["Statement"]!, $["Comment"]!)),
        $["BlockEnd"]!,
      ),

    PackageBlock: ($) =>
      seq(
        "PACKAGE",
        field("name", $["Identifier"]!),
        optional(";"),
        repeat(choice($["SubmodelBlock"]!, $["Declaration"]!, $["Comment"]!)),
        $["BlockEnd"]!,
      ),

    BlockEnd: ($) =>
      seq(
        choice(
          seq("END", optional(choice("STUDY", "MODEL", "SUBMODEL", "SEGMENT", "PACKAGE"))),
          "END_STUDY",
          "END_MODEL",
          "END_SUBMODEL",
          "END_SEGMENT",
          "END_PACKAGE",
        ),
        optional(field("endName", $["Identifier"]!)),
        optional(";"),
      ),

    ParamList: ($) => seq("(", optional(seq($["ParamDecl"]!, repeat(seq(choice(",", ";"), $["ParamDecl"]!)))), ")"),

    ParamDecl: ($) =>
      seq(
        optional(choice("IN", "OUT", "INOUT")),
        optional($["TypeKeyword"]!),
        optional(":"),
        field("name", $["Identifier"]!),
      ),

    TypeKeyword: () => choice("REAL", "INTEGER", "LOGICAL", "CONSTANT"),

    Declaration: ($) =>
      seq(
        $["TypeKeyword"]!,
        optional($["TypeKeyword"]!),
        optional(":"),
        $["DeclItem"]!,
        repeat(seq(",", $["DeclItem"]!)),
        optional(";"),
      ),

    DeclItem: ($) => seq(field("name", $["Identifier"]!), optional(seq(choice("=", ":="), field("init", $["Expr"]!)))),

    Section: () => seq(field("kind", choice("INITIAL", "DYNAMIC", "STEP", "TERMINAL")), optional(":")),

    Statement: ($) =>
      choice(
        $["DerivativeEquation"]!,
        $["AssignmentStmt"]!,
        $["WhenStmt"]!,
        $["IfStmt"]!,
        $["SubmodelCallStmt"]!,
        $["TerminateStmt"]!,
      ),

    DerivativeEquation: ($) =>
      seq(field("target", $["Identifier"]!), $["Prime"]!, choice("=", ":="), field("rhs", $["Expr"]!), optional(";")),

    AssignmentStmt: ($) =>
      seq(field("target", $["Identifier"]!), choice("=", ":="), field("rhs", $["Expr"]!), optional(";")),

    WhenStmt: ($) =>
      seq(
        "WHEN",
        field("condition", $["Expr"]!),
        "THEN",
        repeat(choice($["Statement"]!, $["Comment"]!)),
        optional(seq("ELSE", repeat(choice($["Statement"]!, $["Comment"]!)))),
        choice("END_WHEN", seq("END", "WHEN")),
        optional(";"),
      ),

    IfStmt: ($) =>
      seq(
        "IF",
        field("condition", $["Expr"]!),
        "THEN",
        repeat(choice($["Statement"]!, $["Comment"]!)),
        optional(seq("ELSE", repeat(choice($["Statement"]!, $["Comment"]!)))),
        choice("END_IF", seq("END", "IF")),
        optional(";"),
      ),

    SubmodelCallStmt: ($) =>
      seq(
        field("callee", $["Identifier"]!),
        "(",
        optional(seq($["Expr"]!, repeat(seq(",", $["Expr"]!)))),
        ")",
        optional(";"),
      ),

    TerminateStmt: ($) => seq("TERMINATE", field("condition", $["Expr"]!), optional(";")),

    Expr: ($) =>
      seq(
        $["UnaryExpr"]!,
        repeat(
          seq(
            choice("+", "-", "*", "/", "**", "^", "=", "==", "/=", "<>", "!=", "<", "<=", ">", ">=", "AND", "OR"),
            $["UnaryExpr"]!,
          ),
        ),
      ),

    UnaryExpr: ($) => choice(seq(choice("-", "+", "NOT"), $["PrimaryExpr"]!), $["PrimaryExpr"]!),

    PrimaryExpr: ($) =>
      choice(
        $["NumberLiteral"]!,
        $["StringLiteral"]!,
        "TRUE",
        "FALSE",
        seq("(", $["Expr"]!, ")"),
        seq(field("callee", $["Identifier"]!), "(", optional(seq($["Expr"]!, repeat(seq(",", $["Expr"]!)))), ")"),
        seq(field("target", $["Identifier"]!), $["Prime"]!),
        $["Identifier"]!,
      ),

    Prime: () => /'+/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
    Comment: () => /--[^\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInEslLibrarySync();
