// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInArinc429LibrarySync } from "./catalog/library-package-adapter.js";
import { Arinc429ErrorCode } from "./errors.js";
import { arinc429Indexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for ARINC 429
 * commercial avionics bus schema and trace files (`.a429`, `.arinc429`, `.429`).
 */
export const arinc429Language = language({
  name: "arinc429",
  fileExtensions: [".a429", ".arinc429", ".429"],
  maturity: "beta",
  indexing: arinc429Indexing,
  lsp: {
    fileExtensions: [".a429", ".arinc429", ".429"],
  },
  ui: {
    panels: [
      {
        id: "arinc429Editor",
        viewType: "modelscript.arinc429Editor",
        title: "ARINC 429 Avionics Bus & PFD Inspector",
        shortTitle: "ARINC 429",
        selector: ["*.a429", "*.arinc429", "*.429"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/Arinc429Panel.tsx",
        artifactViewTypes: ["arinc429", "a429"],
      },
    ],
  },

  errorCodes: Arinc429ErrorCode,

  conflicts: ($) => [[$["LabelDecl"]!, $["LabelAttr"]!]],

  rules: {
    Document: ($) =>
      repeat(choice($["BusDecl"]!, $["RateDecl"]!, $["LabelDecl"]!, $["FrameDecl"]!, $["WordDecl"]!, $["Comment"]!)),

    BusDecl: ($) => seq("BUS", field("name", $["Identifier"]!)),

    RateDecl: () => seq("RATE", field("rate", choice("HIGH", "LOW"))),

    LabelDecl: ($) =>
      seq(
        "LABEL",
        field("octal", $["OctalLabel"]!),
        optional(field("name", $["Identifier"]!)),
        repeat($["LabelAttr"]!),
      ),

    LabelAttr: ($) =>
      choice(
        seq("ENCODING", field("encoding", choice("BNR", "BCD", "DISCRETE"))),
        seq("SDI", field("sdi", $["NumberLiteral"]!)),
        seq("RANGE", field("range", $["NumberLiteral"]!)),
        seq("RESOLUTION", field("resolution", $["NumberLiteral"]!)),
        seq("UNITS", field("units", choice($["Identifier"]!, $["StringLiteral"]!))),
        seq("RATE", field("rateHz", $["NumberLiteral"]!)),
        seq("EQUIPMENT", field("equipment", $["Identifier"]!)),
      ),

    FrameDecl: ($) =>
      seq("FRAME", optional(field("timestamp", $["NumberLiteral"]!)), optional("WORD"), field("word", $["HexWord"]!)),

    WordDecl: ($) => seq("WORD", field("word", $["HexWord"]!)),

    HexWord: () => /0[xX][0-9a-fA-F]{1,8}/,
    OctalLabel: () => /[0-7]{3}/,
    NumberLiteral: () => /-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/,
    StringLiteral: () => /"[^"]*"/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_/-]*/,
    Comment: () => /#[^\r\n]*/,
  },

  extras: () => [/[ \t\r\n]+/, /#[^\r\n]*/],
});

registerBuiltInArinc429LibrarySync();
