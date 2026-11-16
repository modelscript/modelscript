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
  extras: ($) => [/[ \t]+/, $.CommentLine],
  lsp: {
    folding: ["HelixRecord", "SheetRecord"],
    outline: ["HeaderRecord", "TitleRecord", "HelixRecord", "SheetRecord", "AtomRecord", "HetatmRecord"],
  },
  rules: {
    Structure: ($) => seq(optional($.Newline), optional(seq($.Record, repeat(seq($.Newline, optional($.Record)))))),

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

    HeaderRecord: ($) => seq(semanticToken("keyword", "HEADER"), repeat($.FieldToken)),

    TitleRecord: ($) => seq(semanticToken("keyword", "TITLE"), repeat($.FieldToken)),

    HelixRecord: ($) => seq(semanticToken("keyword", "HELIX"), repeat($.FieldToken)),

    SheetRecord: ($) => seq(semanticToken("keyword", "SHEET"), repeat($.FieldToken)),

    SsbondRecord: ($) => seq(semanticToken("keyword", "SSBOND"), repeat($.FieldToken)),

    AtomRecord: ($) => seq(semanticToken("keyword", "ATOM"), repeat($.FieldToken)),

    HetatmRecord: ($) => seq(semanticToken("keyword", "HETATM"), repeat($.FieldToken)),

    TerRecord: ($) => seq(semanticToken("keyword", "TER"), repeat($.FieldToken)),

    ConectRecord: ($) => seq(semanticToken("keyword", "CONECT"), repeat($.FieldToken)),

    EndRecord: ($) => seq(semanticToken("keyword", choice("END", "ENDMDL")), repeat($.FieldToken)),

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
            $.NumberLiteral,
            $.QuotedString,
            $.RecordPunct,
          ),
        ),
        repeat($.FieldToken),
      ),

    FieldToken: ($) => choice($.Identifier, $.NumberLiteral, $.QuotedString, $.RecordPunct),

    QuotedString: () => /'[^'\r\n]*'|"[^"\r\n]*"/,
    RecordPunct: () => /[.,:;()[\]+*/=?%&-]/,
    Newline: () => /[\r\n]+/,
    CommentLine: () => /#[^\r\n]*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.]*'?/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
  },
});
