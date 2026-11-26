// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInCsmpLibrarySync } from "./catalog/library-package-adapter.js";
import { CsmpErrorCode } from "./errors.js";
import { csmpIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` WASM GLR language specification for
 * IBM System/360 CSMP (Continuous System Modeling Program, 1967) and SCi CSSL-67.
 */
export const csmpLanguage = language({
  name: "csmp",
  fileExtensions: [".csmp", ".cssl", ".csm"],
  maturity: "beta",
  indexing: csmpIndexing,
  lsp: {
    fileExtensions: [".csmp", ".cssl", ".csm"],
  },
  errorCodes: CsmpErrorCode,

  rules: {
    Program: ($) =>
      repeat(
        choice(
          $["TitleStmt"]!,
          $["SectionHeader"]!,
          $["SortDirective"]!,
          $["ParamDecl"]!,
          $["ConstDecl"]!,
          $["InconDecl"]!,
          $["FixedDecl"]!,
          $["FunctionDecl"]!,
          $["MacroBlock"]!,
          $["ProcedureBlock"]!,
          $["TimerStmt"]!,
          $["MethodStmt"]!,
          $["PrintStmt"]!,
          $["PrtpltStmt"]!,
          $["ControlKeyword"]!,
          $["AssignmentStmt"]!,
          $["Comment"]!,
        ),
      ),

    TitleStmt: () => seq("TITLE", /[^\r\n]*/),

    SectionHeader: () => choice("INITIAL", "DYNAMIC", "TERMINAL"),

    SortDirective: () => choice("SORT", "NOSORT"),

    ParamDecl: ($) => seq(choice("PARAM", "PARAMETER"), $["DataItem"]!, repeat(seq(",", $["DataItem"]!))),

    ConstDecl: ($) => seq(choice("CONST", "CONSTANT"), $["DataItem"]!, repeat(seq(",", $["DataItem"]!))),

    InconDecl: ($) => seq("INCON", $["DataItem"]!, repeat(seq(",", $["DataItem"]!))),

    DataItem: ($) =>
      seq(field("name", $["Identifier"]!), "=", field("value", choice($["NumberLiteral"]!, $["ValueList"]!))),

    ValueList: ($) => seq("(", $["NumberLiteral"]!, repeat(seq(",", $["NumberLiteral"]!)), ")"),

    FixedDecl: ($) => seq("FIXED", $["Identifier"]!, repeat(seq(",", $["Identifier"]!))),

    FunctionDecl: ($) =>
      seq("FUNCTION", field("name", $["Identifier"]!), "=", $["PointPair"]!, repeat(seq(",", $["PointPair"]!))),

    PointPair: ($) =>
      choice(
        seq("(", $["NumberLiteral"]!, ",", $["NumberLiteral"]!, ")"),
        seq($["NumberLiteral"]!, ",", $["NumberLiteral"]!),
      ),

    MacroBlock: ($) =>
      seq(
        "MACRO",
        $["IdentifierList"]!,
        "=",
        field("name", $["Identifier"]!),
        "(",
        optional($["IdentifierList"]!),
        ")",
        repeat(choice($["AssignmentStmt"]!, $["Comment"]!)),
        choice("ENDMAC", "ENDMACRO"),
      ),

    ProcedureBlock: ($) =>
      seq(
        "PROCEDURE",
        $["IdentifierList"]!,
        "=",
        field("name", $["Identifier"]!),
        "(",
        optional($["IdentifierList"]!),
        ")",
        repeat(choice($["AssignmentStmt"]!, $["Comment"]!)),
        choice("ENDPRO", "ENDPROCEDURE"),
      ),

    IdentifierList: ($) => seq($["Identifier"]!, repeat(seq(",", $["Identifier"]!))),

    TimerStmt: ($) => seq("TIMER", $["DataItem"]!, repeat(seq(",", $["DataItem"]!))),

    MethodStmt: ($) => seq("METHOD", field("method", $["Identifier"]!)),

    PrintStmt: ($) => seq("PRINT", $["Identifier"]!, repeat(seq(",", $["Identifier"]!))),

    PrtpltStmt: ($) =>
      seq(
        "PRTPLT",
        $["Identifier"]!,
        optional(seq("(", $["IdentifierList"]!, ")")),
        repeat(seq(",", $["Identifier"]!)),
      ),

    ControlKeyword: () => choice("END", "STOP", "ENDJOB", "CONTINUE", "RESET"),

    AssignmentStmt: ($) => seq(field("target", $["Identifier"]!), "=", field("expr", $["Expr"]!)),

    Expr: ($) => seq($["Term"]!, repeat(seq(choice("+", "-"), $["Term"]!))),

    Term: ($) => seq($["Factor"]!, repeat(seq(choice("*", "/"), $["Factor"]!))),

    Factor: ($) =>
      choice(seq(choice("+", "-"), $["Factor"]!), seq($["Primary"]!, optional(seq(choice("**", "^"), $["Factor"]!)))),

    Primary: ($) => choice($["CallExpr"]!, $["NumberLiteral"]!, $["Identifier"]!, seq("(", $["Expr"]!, ")")),

    CallExpr: ($) =>
      seq(field("callee", $["Identifier"]!), "(", optional(seq($["Expr"]!, repeat(seq(",", $["Expr"]!)))), ")"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Comment: () => /(?:\*[^\r\n]*|\/\/[^\r\n]*|![^\r\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInCsmpLibrarySync();
