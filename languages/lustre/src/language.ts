// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInLustreLibrarySync } from "./catalog/library-package-adapter.js";
import { LustreErrorCode } from "./errors.js";
import { lustreIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for Lustre (.lus, .ec)
 * compiled to WebAssembly GLR parser (`dist/parser.wasm`).
 */
export const lustreLanguage = language({
  name: "lustre",
  fileExtensions: [".lus", ".ec"],
  maturity: "beta",
  indexing: lustreIndexing,
  lsp: {
    fileExtensions: [".lus", ".ec"],
  },
  errorCodes: LustreErrorCode,

  rules: {
    Program: ($) => repeat(choice($["ConstSection"]!, $["TypeSection"]!, $["NodeDecl"]!, $["Comment"]!)),

    ConstSection: ($) => seq("const", repeat($["ConstDecl"]!)),

    ConstDecl: ($) =>
      seq(
        field("name", $["Identifier"]!),
        optional(seq(":", field("type", $["TypeExpr"]!))),
        optional(seq("=", field("value", $["Expr"]!))),
        ";",
      ),

    TypeSection: ($) => seq("type", repeat($["TypeDecl"]!)),

    TypeDecl: ($) => seq(field("name", $["Identifier"]!), optional(seq("=", field("alias", $["TypeExpr"]!))), ";"),

    NodeDecl: ($) =>
      seq(
        field("kind", choice("node", "function")),
        field("name", $["Identifier"]!),
        "(",
        optional($["VarDeclList"]!),
        ")",
        "returns",
        "(",
        optional($["VarDeclList"]!),
        ")",
        optional(";"),
        optional($["VarSection"]!),
        "let",
        repeat(choice($["Equation"]!, $["AssertStmt"]!, $["Comment"]!)),
        "tel",
        optional(choice(";", ".")),
      ),

    VarSection: ($) => seq("var", repeat(seq($["VarDecl"]!, ";"))),

    VarDeclList: ($) => seq($["VarDecl"]!, repeat(seq(";", $["VarDecl"]!)), optional(";")),

    VarDecl: ($) =>
      seq(
        field("name", $["Identifier"]!),
        repeat(seq(",", $["Identifier"]!)),
        ":",
        field("type", $["TypeExpr"]!),
        optional($["ClockExpr"]!),
      ),

    ClockExpr: ($) => seq("when", optional("not"), field("clock", $["Identifier"]!)),

    TypeExpr: ($) => seq(choice("bool", "int", "real", $["Identifier"]!), optional(seq("^", $["IntLiteral"]!))),

    AssertStmt: ($) => seq("assert", field("condition", $["Expr"]!), ";"),

    Equation: ($) => seq(field("lhs", $["Lhs"]!), "=", field("rhs", $["Expr"]!), ";"),

    Lhs: ($) =>
      choice(
        seq($["Identifier"]!, repeat(seq(",", $["Identifier"]!))),
        seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")"),
      ),

    Expr: ($) => choice($["IfExpr"]!, $["MergeExpr"]!, seq($["SimpleExpr"]!, optional(seq("->", $["Expr"]!)))),

    IfExpr: ($) =>
      seq(
        "if",
        field("cond", $["Expr"]!),
        "then",
        field("thenBranch", $["Expr"]!),
        "else",
        field("elseBranch", $["Expr"]!),
      ),

    MergeExpr: ($) => seq("merge", field("clock", $["Identifier"]!), "(", $["Expr"]!, ")", "(", $["Expr"]!, ")"),

    SimpleExpr: ($) => seq($["UnaryExpr"]!, repeat(seq($["BinaryOp"]!, $["UnaryExpr"]!))),

    UnaryExpr: ($) => choice(seq(choice("pre", "current", "not", "-"), $["UnaryExpr"]!), $["PrimaryExpr"]!),

    PrimaryExpr: ($) =>
      choice(
        "true",
        "false",
        $["RealLiteral"]!,
        $["IntLiteral"]!,
        $["CallExpr"]!,
        $["Identifier"]!,
        seq("(", $["Expr"]!, repeat(seq(",", $["Expr"]!)), ")"),
      ),

    CallExpr: ($) =>
      seq(
        field("callee", choice($["Identifier"]!, "int", "real")),
        "(",
        optional(seq($["Expr"]!, repeat(seq(",", $["Expr"]!)))),
        ")",
      ),

    BinaryOp: () =>
      choice("=>", "or", "xor", "and", "=", "<>", "<=", ">=", "<", ">", "when", "+", "-", "*", "/", "div", "mod"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    RealLiteral: () => /\d+\.\d+(?:[eE][+-]?\d+)?/,
    IntLiteral: () => /\d+/,
    Comment: () => /(?:--[^\n]*|\/\*([^*]|\*+[^*/])*\*+\/|\(\*([^*]|\*+[^*)])*\*+\))/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInLustreLibrarySync();
