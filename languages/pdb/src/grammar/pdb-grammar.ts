// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Formal DSL Grammar Specification.
 *
 * Declarative wwPDB macromolecular structure grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const pdbGrammar = language({
  name: "Pdb",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: ["HelixRecord", "SheetRecord"],
    outline: ["HeaderRecord", "TitleRecord", "HelixRecord", "SheetRecord", "AtomRecord", "HetatmRecord"],
  },
  rules: {
    Structure: ($) => repeat(choice($.Record, $.CommentLine)),

    Record: ($) =>
      choice(
        $.HeaderRecord,
        $.TitleRecord,
        $.HelixRecord,
        $.SheetRecord,
        $.SsbondRecord,
        $.AtomRecord,
        $.HetatmRecord,
        $.TerRecord,
        $.ConectRecord,
        $.EndRecord,
        $.GenericRecord,
      ),

    HeaderRecord: ($) => seq(semanticToken("keyword", "HEADER"), field("classification", $.RestOfLine)),

    TitleRecord: ($) => seq(semanticToken("keyword", "TITLE"), field("title", $.RestOfLine)),

    HelixRecord: ($) => seq(semanticToken("keyword", "HELIX"), field("details", $.RestOfLine)),

    SheetRecord: ($) => seq(semanticToken("keyword", "SHEET"), field("details", $.RestOfLine)),

    SsbondRecord: ($) => seq(semanticToken("keyword", "SSBOND"), field("details", $.RestOfLine)),

    AtomRecord: ($) => seq(semanticToken("keyword", "ATOM"), field("atomLine", $.RestOfLine)),

    HetatmRecord: ($) => seq(semanticToken("keyword", "HETATM"), field("atomLine", $.RestOfLine)),

    TerRecord: ($) => seq(semanticToken("keyword", "TER"), optional($.RestOfLine)),

    ConectRecord: ($) => seq(semanticToken("keyword", "CONECT"), repeat(choice($.NumberLiteral, $.Identifier))),

    EndRecord: () => semanticToken("keyword", choice("END", "ENDMDL")),

    GenericRecord: ($) =>
      seq(
        field(
          "recordType",
          choice(
            "REMARK",
            "COMPND",
            "SOURCE",
            "KEYWDS",
            "EXPDTA",
            "AUTHOR",
            "REVDAT",
            "JRNL",
            "CRYST1",
            "ORIGX1",
            "ORIGX2",
            "ORIGX3",
            "SCALE1",
            "SCALE2",
            "SCALE3",
            "MODEL",
            "MASTER",
            $.Identifier,
          ),
        ),
        optional($.RestOfLine),
      ),

    CommentLine: () => /#[^\n]*/,
    RestOfLine: () => /[^\n\r]+/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
  },
});
