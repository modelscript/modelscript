// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Formal DSL Grammar Specification.
 *
 * Declarative wwPDB macromolecular structure grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, repeat, semanticToken, seq } from "@modelscript/dsl";

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

    HeaderRecord: ($) => seq(semanticToken("keyword", "HEADER"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

    TitleRecord: ($) => seq(semanticToken("keyword", "TITLE"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

    HelixRecord: ($) => seq(semanticToken("keyword", "HELIX"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

    SheetRecord: ($) => seq(semanticToken("keyword", "SHEET"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

    SsbondRecord: ($) => seq(semanticToken("keyword", "SSBOND"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

    AtomRecord: ($) => seq(semanticToken("keyword", "ATOM"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

    HetatmRecord: ($) => seq(semanticToken("keyword", "HETATM"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

    TerRecord: ($) => seq(semanticToken("keyword", "TER"), repeat(choice($.Identifier, $.NumberLiteral, "-"))),

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
        repeat(choice($.Identifier, $.NumberLiteral, "-")),
      ),

    CommentLine: () => /#[^\n]*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
  },
});
