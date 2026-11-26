// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInTrasysLibrarySync } from "./catalog/library-package-adapter.js";
import { TrasysErrorCode } from "./errors.js";
import { trasysIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for NASA TRASYS (.tra, .trs, .trasys, .inp).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm`) via `build-language-parser.js`.
 */
export const trasysLanguage = language({
  name: "trasys",
  fileExtensions: [".tra", ".trs", ".trasys", ".inp"],
  maturity: "beta",
  indexing: trasysIndexing,
  lsp: {
    fileExtensions: [".tra", ".trs", ".trasys", ".inp"],
  },
  errorCodes: TrasysErrorCode,

  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],

  conflicts: ($) => [
    [$["SurfaceSection"]!, $["SurfaceDeclaration"]!, $["SurfaceAttribute"]!, $["VertexTuple"]!, $["Identifier"]!],
  ],

  rules: {
    Deck: ($) =>
      seq(
        repeat(choice($["OptionsSection"]!, $["SurfaceSection"]!, $["OrbitSection"]!, $["OperationsSection"]!)),
        optional($["EndOfData"]!),
      ),

    OptionsSection: ($) => seq("HEADER", "OPTIONS", "DATA", repeat($["OptionAssignment"]!)),

    OptionAssignment: ($) =>
      seq(
        field("key", $["Identifier"]!),
        optional("="),
        field("value", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!)),
      ),

    SurfaceSection: ($) =>
      seq("HEADER", "SURFACE", "DATA", repeat(choice($["SurfaceDeclaration"]!, $["SurfaceAttribute"]!))),

    SurfaceDeclaration: ($) =>
      seq(
        optional("S"),
        field("id", $["Identifier"]!),
        field("kind", $["SurfaceKind"]!),
        repeat($["SurfaceAttribute"]!),
      ),

    SurfaceKind: () => choice("RECTANGLE", "DISK", "CYLINDER", "CONE", "SPHERE", "PARABOLOID", "POLYGON"),

    SurfaceAttribute: ($) =>
      choice(
        seq("NODE", "=", field("nodeId", $["NumberLiteral"]!)),
        seq(
          "PROP",
          "=",
          choice(
            seq(field("alpha", $["NumberLiteral"]!), ",", field("epsilon", $["NumberLiteral"]!)),
            field("coating", $["Identifier"]!),
          ),
        ),
        seq("ACTIVE", "=", field("side", choice("TOP", "BOTTOM", "BOTH", "NONE"))),
        seq("SHADE", "=", field("shade", choice("YES", "NO", "TRUE", "FALSE", "ON", "OFF"))),
        seq(
          field("transformKey", choice("TX", "TY", "TZ", "ROTX", "ROTY", "ROTZ")),
          "=",
          field("transformVal", $["NumberLiteral"]!),
        ),
        $["VertexTuple"]!,
        seq(
          field("attrKey", $["Identifier"]!),
          "=",
          field("attrVal", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!)),
        ),
      ),

    VertexTuple: ($) =>
      seq(
        "(",
        field("x", $["NumberLiteral"]!),
        ",",
        field("y", $["NumberLiteral"]!),
        ",",
        field("z", $["NumberLiteral"]!),
        ")",
      ),

    OrbitSection: ($) => seq("HEADER", "ORBIT", "DATA", repeat($["OrbitParameter"]!)),

    OrbitParameter: ($) =>
      choice(
        seq("PLANET", "=", field("planet", $["Identifier"]!)),
        seq(
          field("orbitKey", choice("ALTITUDE", "BETA", "SOLAR", "ALBEDO", "PLANETIR")),
          "=",
          field("orbitVal", $["NumberLiteral"]!),
        ),
      ),

    OperationsSection: ($) => seq("HEADER", "OPERATIONS", "DATA", repeat($["OperationCall"]!)),

    OperationCall: ($) =>
      seq(
        optional("CALL"),
        field("op", choice("FFCAL", "RKCAL", "QCAL")),
        optional(
          seq(
            "(",
            repeat(seq($["Identifier"]!, "=", choice($["NumberLiteral"]!, $["Identifier"]!), optional(","))),
            ")",
          ),
        ),
      ),

    EndOfData: () => seq("END", "OF", "DATA"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:\$[^\n]*|^[Cc](?:[\s*!/-][^\n]*)?)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInTrasysLibrarySync();
