// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, repeat1, seq } from "@modelscript/dsl";
import { registerBuiltInIucrCifLibrarySync } from "./catalog/library-package-adapter.js";
import { IucrCifErrorCode } from "./errors.js";
import { iucrCifIndexing } from "./indexing.js";

/**
 * DSL language specification for IUCr Crystallographic Information File / STAR 1.1 (`.cif`, `.mcif`, `.star`).
 */
export const iucrCifLanguage = language({
  name: "iucr-cif",
  fileExtensions: [".cif", ".mcif", ".star"],
  maturity: "beta",
  indexing: iucrCifIndexing,
  lsp: {
    fileExtensions: [".cif", ".mcif", ".star"],
  },
  ui: {
    panels: [
      {
        id: "iucrCifViewer",
        viewType: "modelscript.iucrCifViewer",
        title: "IUCr CIF Crystal Lattice & Powder XRD Viewer",
        shortTitle: "CIF / XRD",
        selector: ["*.cif", "*.mcif", "*.star"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/IucrCifPanel.tsx",
        artifactViewTypes: ["iucr-cif", "cif", "star"],
      },
    ],
  },

  errorCodes: IucrCifErrorCode,

  rules: {
    Document: ($) => repeat($["DataBlock"]!),

    DataBlock: ($) => seq(field("header", $["DataBlockHeader"]!), repeat(choice($["LoopBlock"]!, $["DataItem"]!))),

    DataItem: ($) => seq(field("tag", $["Tag"]!), field("value", $["Value"]!)),

    LoopBlock: ($) => seq($["LoopKeyword"]!, repeat1(field("tag", $["Tag"]!)), repeat1(field("value", $["Value"]!))),

    Value: ($) =>
      choice(
        $["NumericWithSu"]!,
        $["SingleQuotedString"]!,
        $["DoubleQuotedString"]!,
        $["SemicolonTextBlock"]!,
        $["UnknownValue"]!,
        $["InapplicableValue"]!,
        $["UnquotedValue"]!,
      ),

    // Lexical tokens
    DataBlockHeader: () => /[dD][aA][tT][aA]_[A-Za-z0-9_.\-+]+/,
    LoopKeyword: () => /[lL][oO][oO][pP]_/,
    Tag: () => /_[A-Za-z0-9_.\-[\]/]+/,
    NumericWithSu: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:\(\d+\))?/,
    SingleQuotedString: () => /'[^'\r\n]*'/,
    DoubleQuotedString: () => /"[^"\r\n]*"/,
    SemicolonTextBlock: () => /;([^\n]|\n[^;])*\n;/,
    UnknownValue: () => /\?/,
    InapplicableValue: () => /\./,
    UnquotedValue: () => /[^\s'"#_;?.][^\s]*/,
    Comment: () => /#[^\r\n]*/,
  },

  extras: ($) => [/\s+/, $["Comment"]!],
});

// Zero-I/O registration of built-in `@modelscript/iucr-cif-std-lib` on module load
registerBuiltInIucrCifLibrarySync();
