// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInGamsLibrarySync } from "./catalog/library-package-adapter.js";
import { GamsErrorCode } from "./errors.js";
import { gamsIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for GAMS
 * (General Algebraic Modeling System, `.gms`, `.gams`, `.inc`).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm`) via
 * `node ../../scripts/build/build-language-parser.js`.
 */
export const gamsLanguage = language({
  name: "gams",
  fileExtensions: [".gms", ".gams", ".inc"],
  maturity: "beta",
  indexing: gamsIndexing,
  lsp: {
    fileExtensions: [".gms", ".gams", ".inc"],
  },
  errorCodes: GamsErrorCode,

  rules: {
    Program: ($) =>
      repeat(
        choice(
          $["SetSection"]!,
          $["AliasStatement"]!,
          $["ParameterSection"]!,
          $["ScalarSection"]!,
          $["TableSection"]!,
          $["VariableSection"]!,
          $["EquationSection"]!,
          $["ModelStatement"]!,
          $["SolveStatement"]!,
          $["DisplayStatement"]!,
          $["EquationDefinition"]!,
          $["AssignmentStatement"]!,
          $["BlockComment"]!,
          $["LineComment"]!,
        ),
      ),

    SetSection: ($) =>
      seq(
        choice("Sets", "Set", "SETS", "SET", "sets", "set"),
        repeat(seq($["SetDeclaration"]!, optional(","))),
        optional(";"),
      ),

    SetDeclaration: ($) => seq(field("name", $["Identifier"]!), optional($["DomainSpec"]!), optional($["SlashData"]!)),

    AliasStatement: ($) =>
      seq(
        choice("Alias", "ALIAS", "alias"),
        "(",
        field("first", $["Identifier"]!),
        repeat(seq(",", field("alias", $["Identifier"]!))),
        ")",
        optional(";"),
      ),

    ParameterSection: ($) =>
      seq(
        choice("Parameters", "Parameter", "PARAMETERS", "PARAMETER", "parameters", "parameter"),
        repeat(seq($["ParameterDeclaration"]!, optional(","))),
        optional(";"),
      ),

    ScalarSection: ($) =>
      seq(
        choice("Scalars", "Scalar", "SCALARS", "SCALAR", "scalars", "scalar"),
        repeat(seq($["ParameterDeclaration"]!, optional(","))),
        optional(";"),
      ),

    ParameterDeclaration: ($) =>
      seq(field("name", $["Identifier"]!), optional($["DomainSpec"]!), optional($["SlashData"]!)),

    TableSection: ($) =>
      seq(
        choice("Tables", "Table", "TABLES", "TABLE", "tables", "table"),
        field("name", $["Identifier"]!),
        optional($["DomainSpec"]!),
        repeat(choice($["Identifier"]!, $["NumberLiteral"]!, $["StringLiteral"]!)),
        ";",
      ),

    VariableSection: ($) =>
      seq(
        optional(
          choice(
            "Positive",
            "POSITIVE",
            "positive",
            "Negative",
            "NEGATIVE",
            "negative",
            "Free",
            "FREE",
            "free",
            "Binary",
            "BINARY",
            "binary",
            "Integer",
            "INTEGER",
            "integer",
          ),
        ),
        choice("Variables", "Variable", "VARIABLES", "VARIABLE", "variables", "variable"),
        repeat(seq($["VariableDeclaration"]!, optional(","))),
        optional(";"),
      ),

    VariableDeclaration: ($) => seq(field("name", $["Identifier"]!), optional($["DomainSpec"]!)),

    EquationSection: ($) =>
      seq(
        choice("Equations", "Equation", "EQUATIONS", "EQUATION", "equations", "equation"),
        repeat(seq($["EquationDeclaration"]!, optional(","))),
        optional(";"),
      ),

    EquationDeclaration: ($) => seq(field("name", $["Identifier"]!), optional($["DomainSpec"]!)),

    EquationDefinition: ($) =>
      seq(
        field("name", $["Identifier"]!),
        optional($["DomainSpec"]!),
        optional(seq("$", $["DollarCondition"]!)),
        "..",
        field("lhs", $["Expr"]!),
        field("relation", $["RelOp"]!),
        field("rhs", $["Expr"]!),
        ";",
      ),

    AssignmentStatement: ($) =>
      seq(
        field("target", $["Identifier"]!),
        optional(seq(".", field("suffix", $["Identifier"]!))),
        optional($["IndexList"]!),
        optional(seq("$", $["DollarCondition"]!)),
        "=",
        field("value", $["Expr"]!),
        ";",
      ),

    ModelStatement: ($) =>
      seq(
        choice("Model", "Models", "MODEL", "MODELS", "model", "models"),
        field("name", $["Identifier"]!),
        optional($["SlashData"]!),
        optional(";"),
      ),

    SolveStatement: ($) =>
      seq(
        choice("Solve", "SOLVE", "solve"),
        field("model", $["Identifier"]!),
        choice("using", "USING", "Using"),
        field("solver", choice("lp", "mip", "nlp", "rmip", "qcp", "minlp", "LP", "MIP", "NLP", "RMIP", "QCP", "MINLP")),
        field("sense", choice("minimizing", "maximizing", "MINIMIZING", "MAXIMIZING", "min", "max")),
        field("objective", $["Identifier"]!),
        optional(";"),
      ),

    DisplayStatement: ($) =>
      seq(
        choice("Display", "DISPLAY", "display"),
        repeat(seq($["Identifier"]!, optional(seq(".", $["Identifier"]!)), optional(","))),
        optional(";"),
      ),

    DomainSpec: ($) => seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")"),

    IndexList: ($) => seq("(", $["Expr"]!, repeat(seq(",", $["Expr"]!)), ")"),

    SlashData: ($) =>
      seq("/", repeat(choice($["Identifier"]!, $["NumberLiteral"]!, $["StringLiteral"]!, ",", ".")), "/"),

    DollarCondition: ($) => choice(seq("(", $["Expr"]!, ")"), $["Identifier"]!),

    Expr: ($) => seq($["Term"]!, repeat(seq(choice("+", "-", "$"), $["Term"]!))),

    Term: ($) => seq($["Factor"]!, repeat(seq(choice("*", "/", "**", "^"), $["Factor"]!))),

    Factor: ($) =>
      choice(
        $["IndexedOpExpr"]!,
        seq("-", $["Factor"]!),
        seq("+", $["Factor"]!),
        seq("(", $["Expr"]!, ")"),
        seq($["Identifier"]!, optional(seq(".", $["Identifier"]!)), optional($["IndexList"]!)),
        $["NumberLiteral"]!,
        $["StringLiteral"]!,
      ),

    IndexedOpExpr: ($) =>
      seq(
        choice("sum", "SUM", "prod", "PROD", "smin", "SMIN", "smax", "SMAX"),
        "(",
        choice($["DomainSpec"]!, $["Identifier"]!),
        optional(seq("$", $["DollarCondition"]!)),
        ",",
        $["Expr"]!,
        ")",
      ),

    RelOp: () => /=[eElLgGnN]=/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    BlockComment: () => /\$[oO][nN][tT][eE][xX][tT][^$]*\$[oO][fF][fF][tT][eE][xX][tT]/,
    LineComment: () => /\*[^\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInGamsLibrarySync();
