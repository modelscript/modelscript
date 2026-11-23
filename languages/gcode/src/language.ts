// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInGCodeLibrarySync } from "./catalog/library-package-adapter.js";
import { GCodeErrorCode } from "./errors.js";
import { gcodeIndexing } from "./indexing.js";

/**
 * DSL language specification for RS-274 / ISO 6983 G-code (.nc, .gcode, .gco, .ngc, .tap, .cnc, .mpf).
 */
export const gcodeLanguage = language({
  name: "gcode",
  fileExtensions: [".nc", ".gcode", ".gco", ".ngc", ".tap", ".cnc", ".mpf"],
  maturity: "beta",
  indexing: gcodeIndexing,
  lsp: {
    fileExtensions: [".nc", ".gcode", ".gco", ".ngc", ".tap", ".cnc", ".mpf"],
  },
  errorCodes: GCodeErrorCode,

  extras: () => [/[ \t\r\n]+/],

  rules: {
    Program: ($) =>
      repeat(
        choice(
          $["TapeMarker"]!,
          $["ProgramNumber"]!,
          $["LineNumber"]!,
          $["BlockDelete"]!,
          $["ParamAssignment"]!,
          $["GCodeWord"]!,
          $["MCodeWord"]!,
          $["AxisWord"]!,
          $["FeedSpeedWord"]!,
          $["ParenComment"]!,
          $["SemicolonComment"]!,
        ),
      ),

    TapeMarker: () => "%",
    BlockDelete: () => /\/[0-9]?/,
    ProgramNumber: () => /[Oo]\d+/,
    LineNumber: () => /[Nn]\d+/,

    GCodeWord: () => /[Gg](?:\d+(?:\.\d+)?)/,
    MCodeWord: () => /[Mm]\d+/,

    AxisWord: ($) => seq(field("address", $["AxisLetter"]!), field("value", $["WordValue"]!)),

    FeedSpeedWord: ($) => seq(field("address", $["ParamLetter"]!), field("value", $["WordValue"]!)),

    ParamAssignment: ($) => seq(field("target", $["ParamRef"]!), "=", field("value", $["WordValue"]!)),

    WordValue: ($) => choice($["NumberLiteral"]!, $["ParamRef"]!, $["BracketExpr"]!),

    BracketExpr: ($) => seq("[", $["Expr"]!, "]"),

    Expr: ($) => seq($["ExprTerm"]!, repeat(seq($["BinaryOp"]!, $["ExprTerm"]!))),

    ExprTerm: ($) =>
      choice($["NumberLiteral"]!, $["ParamRef"]!, $["BracketExpr"]!, seq($["MathFunc"]!, $["BracketExpr"]!)),

    AxisLetter: () => /[XxYyZzAaBbCcIiJjKkRr]/,
    ParamLetter: () => /[FfSsTtPpQqLlHhDd]/,
    ParamRef: () => /#\d+/,
    MathFunc: () => /(?:SIN|COS|TAN|SQRT|ABS|ROUND|FIX|FUP)/,
    BinaryOp: () => choice("+", "-", "*", "/", "MOD"),
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)/,
    ParenComment: () => /\([^)\r\n]*\)/,
    SemicolonComment: () => /;[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInGCodeLibrarySync();
