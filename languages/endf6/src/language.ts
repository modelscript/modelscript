// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInEndf6LibrarySync } from "./catalog/library-package-adapter.js";
import { Endf6ErrorCode } from "./errors.js";
import { endf6Indexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for ENDF-6
 * (Evaluated Nuclear Data File Format, BNL/NNDC 1968–1980s+).
 */
export const endf6Language = language({
  name: "endf6",
  fileExtensions: [".endf", ".endf6", ".enf", ".pendf", ".gendf", ".tape"],
  maturity: "beta",
  indexing: endf6Indexing,
  lsp: {
    fileExtensions: [".endf", ".endf6", ".enf", ".pendf", ".gendf", ".tape"],
  },
  ui: {
    panels: [
      {
        id: "endf6Viewer",
        viewType: "modelscript.endf6Viewer",
        title: "ENDF-6 Cross-Section Viewer & Editor",
        shortTitle: "ENDF-6",
        selector: ["*.endf", "*.endf6", "*.enf", "*.pendf", "*.gendf"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/Endf6Panel.tsx",
        artifactViewTypes: ["endf6", "endf"],
      },
    ],
  },

  errorCodes: Endf6ErrorCode,

  rules: {
    Tape: ($) => repeat($["CardItem"]!),

    CardItem: ($) =>
      choice($["EndfFloat"]!, $["DecimalLiteral"]!, $["IntegerLiteral"]!, $["TextToken"]!, $["PunctToken"]!),

    DataRecord: ($) =>
      seq(
        field("c1", choice($["EndfFloat"]!, $["IntegerLiteral"]!)),
        field("c2", choice($["EndfFloat"]!, $["IntegerLiteral"]!)),
        optional(field("l1", $["IntegerLiteral"]!)),
        optional(field("l2", $["IntegerLiteral"]!)),
        optional(field("n1", $["IntegerLiteral"]!)),
        optional(field("n2", $["IntegerLiteral"]!)),
      ),

    EndfFloat: () => /[+-]?(?:\d+\.\d*|\.\d+)(?:[eEdD]?[+-]\d+)/,
    DecimalLiteral: () => /[+-]?(?:\d+\.\d*|\.\d+)/,
    IntegerLiteral: () => /[+-]?\d+/,
    TextToken: () => /[A-Za-z_][A-Za-z0-9_./:=+-]*/,
    PunctToken: () => /[()[\]*+=/:;,.-]/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInEndf6LibrarySync();
