// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, prec, repeat, seq } from "@modelscript/dsl";
import { TwentySimErrorCode } from "./errors.js";
import { twentySimIndexing } from "./indexing.js";

/**
 * DSL language specification for 20-sim SIDOPS / SIDOPS+ and `.emx` models.
 */
export const twentySimLanguage = language({
  name: "twentysim",
  fileExtensions: [".emx", ".emxz", ".sid"],
  maturity: "beta",
  indexing: twentySimIndexing,
  lsp: {
    fileExtensions: [".emx", ".emxz", ".sid"],
  },
  errorCodes: TwentySimErrorCode,

  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],

  rules: {
    Model: ($) =>
      seq(
        optional(seq(choice("model", "submodel"), field("name", $["Identifier"]!), optional(";"))),
        repeat($["Section"]!),
        optional(seq("end", optional($["Identifier"]!), optional(";"))),
      ),

    Section: ($) =>
      choice(
        $["ParametersSection"]!,
        $["ConstantsSection"]!,
        $["VariablesSection"]!,
        $["PortsSection"]!,
        $["SubmodelsSection"]!,
        $["ConnectionsSection"]!,
        $["InitialEquationsSection"]!,
        $["EquationsSection"]!,
        $["CodeSection"]!,
      ),

    ParametersSection: ($) => seq("parameters", repeat($["ParamDecl"]!)),
    ConstantsSection: ($) => seq("constants", repeat($["ParamDecl"]!)),
    VariablesSection: ($) => seq("variables", repeat($["VarDecl"]!)),
    PortsSection: ($) => seq(choice("ports", "interface"), repeat($["PortDecl"]!)),
    SubmodelsSection: ($) => seq("submodels", repeat($["SubmodelDecl"]!)),
    ConnectionsSection: ($) => seq("connections", repeat($["ConnectionStmt"]!)),
    InitialEquationsSection: ($) => seq("initialequations", repeat($["EquationStmt"]!)),
    EquationsSection: ($) => seq("equations", repeat($["EquationStmt"]!)),
    CodeSection: ($) => seq("code", repeat($["EquationStmt"]!)),

    TypeSpec: () => choice("real", "integer", "boolean", "string"),
    VarQualifier: () => choice("global", "hidden", "interesting"),

    ParamDecl: ($) =>
      seq(
        optional($["TypeSpec"]!),
        field("name", $["Identifier"]!),
        optional(seq(choice("=", ":="), $["Expr"]!)),
        optional($["UnitAnnotation"]!),
        ";",
      ),

    VarDecl: ($) =>
      seq(
        optional($["TypeSpec"]!),
        optional($["VarQualifier"]!),
        field("name", $["Identifier"]!),
        optional(seq(choice("=", ":="), $["Expr"]!)),
        optional($["UnitAnnotation"]!),
        ";",
      ),

    PortDecl: ($) =>
      seq(
        choice("power", "bond", "port", "signal", seq("real", choice("in", "out"))),
        field("name", $["Identifier"]!),
        optional($["UnitAnnotation"]!),
        ";",
      ),

    SubmodelDecl: ($) =>
      seq(
        field("type", $["Identifier"]!),
        field("name", $["Identifier"]!),
        optional(seq("(", optional($["ArgList"]!), ")")),
        ";",
      ),

    ConnectionStmt: ($) => seq($["QualifiedRef"]!, choice("=>", "->"), $["QualifiedRef"]!, ";"),

    QualifiedRef: ($) => seq($["Identifier"]!, optional(seq(".", $["Identifier"]!))),

    EquationStmt: ($) => seq($["Expr"]!, choice("=", ":="), $["Expr"]!, ";"),

    UnitAnnotation: ($) => seq("{", repeat(choice($["Identifier"]!, $["Number"]!, "/", "*", "-", "^")), "}"),

    ArgList: ($) => seq($["Arg"]!, repeat(seq(",", $["Arg"]!))),
    Arg: ($) => choice(seq($["Identifier"]!, "=", $["Expr"]!), $["Expr"]!),

    Expr: ($) =>
      choice(
        $["IfExpr"]!,
        $["BinaryExpr"]!,
        $["UnaryExpr"]!,
        $["CallExpr"]!,
        $["MemberExpr"]!,
        $["ParenExpr"]!,
        $["Number"]!,
        $["StringLiteral"]!,
        $["Identifier"]!,
      ),

    IfExpr: ($) => prec.right(1, seq("if", $["Expr"]!, "then", $["Expr"]!, "else", $["Expr"]!)),

    BinaryExpr: ($) =>
      choice(
        prec.left(2, seq($["Expr"]!, "or", $["Expr"]!)),
        prec.left(3, seq($["Expr"]!, "and", $["Expr"]!)),
        prec.left(4, seq($["Expr"]!, choice("==", "<>", "<", "<=", ">", ">="), $["Expr"]!)),
        prec.left(5, seq($["Expr"]!, choice("+", "-"), $["Expr"]!)),
        prec.left(6, seq($["Expr"]!, choice("*", "/"), $["Expr"]!)),
        prec.right(7, seq($["Expr"]!, "^", $["Expr"]!)),
      ),

    UnaryExpr: ($) => prec(8, seq(choice("+", "-", "not"), $["Expr"]!)),

    CallExpr: ($) => prec(9, seq($["Identifier"]!, "(", optional($["ArgList"]!), ")")),
    MemberExpr: ($) => prec(9, seq($["Identifier"]!, ".", $["Identifier"]!)),
    ParenExpr: ($) => seq("(", $["Expr"]!, ")"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    Number: () => /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,
    StringLiteral: () => /'[^']*'|"[^"]*"/,
    Comment: () => /\/\/[^\n]*|\/\*([^*]|\*+[^*/])*\*+\//,
  },
});
