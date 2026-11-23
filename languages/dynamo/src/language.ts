// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInDynamoLibrarySync } from "./catalog/library-package-adapter.js";
import { DynamoErrorCode } from "./errors.js";
import { dynamoIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for MIT DYNAMO (.dyn, .dynamo).
 *
 * Supports all classic DYNAMO equation types (L, R, A, N, C, T, S),
 * time subscripts (.K, .J, .JK, .KL), slash-separated table value lists,
 * NOTE comments, SPEC parameters, and PRINT/PLOT/RUN simulation directives.
 */
export const dynamoLanguage = language({
  name: "dynamo",
  fileExtensions: [".dyn", ".dynamo"],
  maturity: "beta",
  indexing: dynamoIndexing,
  lsp: {
    fileExtensions: [".dyn", ".dynamo"],
  },
  errorCodes: DynamoErrorCode,

  rules: {
    Model: ($) =>
      repeat(
        choice(
          $["LevelEquation"]!,
          $["RateEquation"]!,
          $["AuxiliaryEquation"]!,
          $["InitialEquation"]!,
          $["ConstantEquation"]!,
          $["TableEquation"]!,
          $["SupplementaryEquation"]!,
          $["SpecStatement"]!,
          $["PrintStatement"]!,
          $["PlotStatement"]!,
          $["RunStatement"]!,
          $["NoteStatement"]!,
        ),
      ),

    LevelEquation: ($) => seq("L", field("lhs", $["SubscriptedIdentifier"]!), "=", field("rhs", $["Expression"]!)),

    RateEquation: ($) => seq("R", field("lhs", $["SubscriptedIdentifier"]!), "=", field("rhs", $["Expression"]!)),

    AuxiliaryEquation: ($) => seq("A", field("lhs", $["SubscriptedIdentifier"]!), "=", field("rhs", $["Expression"]!)),

    InitialEquation: ($) => seq("N", field("lhs", $["Identifier"]!), "=", field("rhs", $["Expression"]!)),

    ConstantEquation: ($) => seq("C", $["ConstantAssignment"]!, repeat(seq(",", $["ConstantAssignment"]!))),

    ConstantAssignment: ($) => seq(field("name", $["Identifier"]!), "=", field("value", $["Expression"]!)),

    TableEquation: ($) => seq("T", field("name", $["Identifier"]!), "=", field("values", $["TableValueList"]!)),

    TableValueList: ($) => seq($["SignedNumber"]!, repeat(seq("/", $["SignedNumber"]!))),

    SupplementaryEquation: ($) =>
      seq("S", field("lhs", $["SubscriptedIdentifier"]!), "=", field("rhs", $["Expression"]!)),

    SpecStatement: ($) => seq("SPEC", $["SpecAssignment"]!, repeat(seq(choice("/", ","), $["SpecAssignment"]!))),

    SpecAssignment: ($) =>
      seq(
        field("key", choice("DT", "LENGTH", "PRTPER", "PLTPER", $["Identifier"]!)),
        "=",
        field("value", $["SignedNumber"]!),
      ),

    PrintStatement: ($) => seq("PRINT", $["Identifier"]!, repeat(seq(choice(",", "/"), $["Identifier"]!))),

    PlotStatement: ($) => seq("PLOT", $["PlotItem"]!, repeat(seq(choice("/", ","), $["PlotItem"]!))),

    PlotItem: ($) =>
      seq(
        field("variable", $["Identifier"]!),
        optional(seq("=", field("symbol", $["Identifier"]!))),
        optional(seq("(", $["SignedNumber"]!, ",", $["SignedNumber"]!, ")")),
      ),

    RunStatement: ($) => seq("RUN", optional(field("label", $["Identifier"]!))),

    NoteStatement: () => /(?:NOTE[^\r\n]*|\*[^\r\n]*)/,

    Expression: ($) => seq($["Term"]!, repeat(seq(choice("+", "-"), $["Term"]!))),

    Term: ($) => seq($["Factor"]!, repeat(seq(choice("*", "/"), $["Factor"]!))),

    Factor: ($) =>
      choice(
        seq(choice("+", "-"), $["Factor"]!),
        seq("(", $["Expression"]!, ")"),
        $["FunctionCall"]!,
        $["SubscriptedIdentifier"]!,
        $["NumberLiteral"]!,
      ),

    FunctionCall: ($) =>
      seq(
        field("callee", $["Identifier"]!),
        "(",
        optional(seq($["Expression"]!, repeat(seq(",", $["Expression"]!)))),
        ")",
      ),

    SubscriptedIdentifier: ($) =>
      seq(field("name", $["Identifier"]!), optional(field("subscript", $["TimeSubscript"]!))),

    TimeSubscript: () => /\.(?:JK|KL|K|J)\b/,

    SignedNumber: ($) => seq(optional(choice("+", "-")), $["NumberLiteral"]!),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,

    NumberLiteral: () => /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInDynamoLibrarySync();
