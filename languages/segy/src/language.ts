// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, repeat1, seq } from "@modelscript/dsl";
import { registerBuiltInSegyLibrarySync } from "./catalog/library-package-adapter.js";
import { SegyErrorCode } from "./errors.js";
import { segyIndexing } from "./indexing.js";

/**
 * DSL language specification for SEG-Y Rev 0 / Rev 1 40-card 80-byte textual reel headers
 * (.sgy, .segy, .sgyhdr).
 */
export const segyLanguage = language({
  name: "segy",
  fileExtensions: [".sgy", ".segy", ".sgyhdr"],
  maturity: "beta",
  indexing: segyIndexing,
  lsp: {
    fileExtensions: [".sgy", ".segy", ".sgyhdr"],
  },
  errorCodes: SegyErrorCode,

  rules: {
    TextualHeader: ($) => repeat($["Card"]!),

    Card: ($) =>
      seq(
        field("prefix", $["CardPrefix"]!),
        optional(
          choice(
            $["EndTextualHeaderCard"]!,
            $["ClientCard"]!,
            $["LineCard"]!,
            $["AreaCard"]!,
            $["SampleIntervalCard"]!,
            $["TraceLengthCard"]!,
            $["FormatCard"]!,
            $["RevisionCard"]!,
            $["FreeText"]!,
          ),
        ),
      ),

    EndTextualHeaderCard: () => seq("END", "TEXTUAL", "HEADER"),

    ClientCard: ($) => seq("CLIENT", optional(choice(":", "=")), field("value", $["CardValue"]!)),

    LineCard: ($) => seq("LINE", optional(choice(":", "=")), field("value", $["CardValue"]!)),

    AreaCard: ($) => seq("AREA", optional(choice(":", "=")), field("value", $["CardValue"]!)),

    SampleIntervalCard: ($) =>
      seq(
        "SAMPLE",
        "INTERVAL",
        optional(choice(":", "=")),
        field("interval", $["NumberLiteral"]!),
        optional(choice("US", "USEC", "MS", "MSEC")),
      ),

    TraceLengthCard: ($) =>
      seq(
        "TRACE",
        "LENGTH",
        optional(choice(":", "=")),
        field("length", $["NumberLiteral"]!),
        optional(choice("MS", "MSEC", "S", "SEC")),
      ),

    FormatCard: ($) => seq("FORMAT", optional(choice(":", "=")), field("value", $["CardValue"]!)),

    RevisionCard: ($) =>
      seq(
        optional(seq("SEG", "Y")),
        choice("REV", "REVISION"),
        optional(choice(":", "=")),
        field("revision", $["NumberLiteral"]!),
      ),

    CardValue: ($) => repeat1(choice($["Identifier"]!, $["NumberLiteral"]!, $["Punct"]!)),
    FreeText: ($) => repeat1(choice($["Identifier"]!, $["NumberLiteral"]!, $["Punct"]!)),

    CardPrefix: () => /C[ ]?[0-4]?[0-9]/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_/-]*/,
    Punct: () => /[:=,().]/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInSegyLibrarySync();
