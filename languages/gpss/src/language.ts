// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInGpssLibrarySync } from "./catalog/library-package-adapter.js";
import { GpssErrorCode } from "./errors.js";
import { gpssIndexing } from "./indexing.js";

/**
 * DSL language specification for GPSS — General Purpose Simulation System (1961)
 * supporting `.gps`, `.gpss`, and `.sim` discrete-event simulation decks.
 */
export const gpssLanguage = language({
  name: "gpss",
  fileExtensions: [".gps", ".gpss", ".sim"],
  maturity: "beta",
  indexing: gpssIndexing,
  lsp: {
    fileExtensions: [".gps", ".gpss", ".sim"],
  },
  errorCodes: GpssErrorCode,

  rules: {
    Program: ($) => repeat(choice($["Statement"]!, $["FunctionDataLine"]!, $["Comment"]!)),

    Statement: ($) =>
      seq(
        optional(field("label", $["Identifier"]!)),
        field("opcode", $["Opcode"]!),
        optional(field("aux", $["AuxOperator"]!)),
        optional(field("operands", $["OperandList"]!)),
      ),

    Opcode: () =>
      choice(
        "GENERATE",
        "SEIZE",
        "RELEASE",
        "ADVANCE",
        "QUEUE",
        "DEPART",
        "ENTER",
        "LEAVE",
        "TRANSFER",
        "SPLIT",
        "ASSEMBLE",
        "ASSIGN",
        "TEST",
        "GATE",
        "TABULATE",
        "TERMINATE",
        "STORAGE",
        "TABLE",
        "FUNCTION",
        "EQU",
        "START",
        "RESET",
        "CLEAR",
        "END",
        "SIMULATE",
        "RMULT",
      ),

    AuxOperator: () => choice("E", "NE", "G", "GE", "L", "LE", "NU", "U", "SNF", "SF", "SE", "SNE"),

    OperandList: ($) =>
      seq(choice($["Operand"]!, seq(",", $["Operand"]!)), repeat(seq(choice(",", "/"), optional($["Operand"]!)))),

    Operand: ($) => choice($["SnaRef"]!, $["NumberLiteral"]!, $["Identifier"]!),

    FunctionDataLine: ($) =>
      seq(
        $["NumberLiteral"]!,
        ",",
        $["NumberLiteral"]!,
        repeat(seq("/", $["NumberLiteral"]!, ",", $["NumberLiteral"]!)),
      ),

    SnaRef: () => /(?:FR|SR|FN|Q|F|S|R|P)\$[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    Comment: () => /(?:;[^\r\n]*|\*[^\r\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInGpssLibrarySync();
