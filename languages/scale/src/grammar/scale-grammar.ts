// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Formal DSL Grammar Specification.
 *
 * Declarative ORNL SCALE / KENO V.a-VI / ORIGEN deck grammar defined via `@modelscript/dsl`,
 * compiled into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const scaleDeckGrammar = language({
  name: "ScaleDeck",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: [
      "CompBlock",
      "CellDataBlock",
      "ParamBlock",
      "GeomBlock",
      "BoundsBlock",
      "ArrayBlock",
      "KenoUnitBlock",
      "OrigenCaseBlock",
    ],
    outline: [
      "SequenceCard",
      "CompBlock",
      "CellDataBlock",
      "ParamBlock",
      "GeomBlock",
      "BoundsBlock",
      "ArrayBlock",
      "KenoUnitBlock",
      "OrigenCaseBlock",
    ],
  },
  rules: {
    Deck: ($) => repeat($.DeckItem),

    DeckItem: ($) =>
      choice(
        $.SequenceCard,
        $.CompBlock,
        $.CellDataBlock,
        $.ParamBlock,
        $.GeomBlock,
        $.BoundsBlock,
        $.ArrayBlock,
        $.OrigenCaseBlock,
        $.EndStatement,
        $.GenericLineToken,
      ),

    SequenceCard: ($) => seq("=", semanticToken("keyword", field("sequence", $.Identifier))),

    CompBlock: ($) =>
      seq(
        semanticToken("keyword", $.ReadKw),
        semanticToken("keyword", $.CompKw),
        repeat(choice($.BlockAtom, $.EndKw)),
        semanticToken("keyword", $.EndKw),
        semanticToken("keyword", $.CompKw),
      ),

    CellDataBlock: ($) =>
      seq(
        semanticToken("keyword", $.ReadKw),
        semanticToken("keyword", $.CellDataKw),
        repeat(choice($.BlockAtom, $.EndKw)),
        semanticToken("keyword", $.EndKw),
        semanticToken("keyword", $.CellDataKw),
      ),

    ParamBlock: ($) =>
      seq(
        semanticToken("keyword", $.ReadKw),
        semanticToken("keyword", $.ParamKw),
        repeat($.BlockAtom),
        semanticToken("keyword", $.EndKw),
        semanticToken("keyword", $.ParamKw),
      ),

    BoundsBlock: ($) =>
      seq(
        semanticToken("keyword", $.ReadKw),
        semanticToken("keyword", $.BoundsKw),
        repeat($.BlockAtom),
        semanticToken("keyword", $.EndKw),
        semanticToken("keyword", $.BoundsKw),
      ),

    ArrayBlock: ($) =>
      seq(
        semanticToken("keyword", $.ReadKw),
        semanticToken("keyword", $.ArrayKw),
        repeat(choice($.BlockAtom, $.EndKw)),
        semanticToken("keyword", $.EndKw),
        semanticToken("keyword", $.ArrayKw),
      ),

    GeomBlock: ($) =>
      seq(
        semanticToken("keyword", $.ReadKw),
        semanticToken("keyword", $.GeomKw),
        repeat($.GeomItem),
        semanticToken("keyword", $.EndKw),
        semanticToken("keyword", $.GeomKw),
      ),

    GeomItem: ($) => choice($.KenoUnitBlock, $.KenoStatement),

    KenoUnitBlock: ($) =>
      seq(
        optional(semanticToken("keyword", $.GlobalKw)),
        semanticToken("keyword", $.UnitKw),
        field("unitId", $.NumberLiteral),
        repeat($.KenoStatement),
      ),

    KenoStatement: ($) =>
      choice(
        semanticToken("type", $.CylinderKw),
        semanticToken("type", $.SphereKw),
        semanticToken("type", $.CuboidKw),
        semanticToken("type", $.HexprismKw),
        semanticToken("keyword", $.MediaKw),
        semanticToken("keyword", $.HoleKw),
        semanticToken("keyword", $.ArrayKw),
        semanticToken("keyword", $.BoundaryKw),
        $.KeyValuePair,
        $.ValueAtom,
      ),

    OrigenCaseBlock: ($) =>
      seq(
        semanticToken("keyword", $.CaseKw),
        optional(seq("(", field("caseId", choice($.Identifier, $.NumberLiteral)), ")")),
        "{",
        repeat($.OrigenStatement),
        "}",
      ),

    OrigenStatement: ($) =>
      choice(
        seq(semanticToken("keyword", $.LibKw), $.BraceBlock),
        seq(semanticToken("keyword", $.MatKw), $.BraceBlock),
        seq(semanticToken("keyword", $.TimeKw), $.BraceBlock),
        seq(semanticToken("keyword", $.PowerKw), "=", $.BracketList),
        seq(semanticToken("keyword", $.FluxKw), "=", $.BracketList),
        seq(semanticToken("keyword", $.SaveKw), optional($.BraceBlock)),
        $.KeyValuePair,
        $.BraceBlock,
        $.BracketList,
        $.ValueAtom,
      ),

    BraceBlock: ($) => seq("{", repeat(choice($.KeyValuePair, $.BraceBlock, $.BracketList, $.ValueAtom)), "}"),

    BracketList: ($) => seq("[", repeat(choice($.KeyValuePair, $.ValueAtom, ",")), "]"),

    EndStatement: ($) => semanticToken("keyword", $.EndKw),

    BlockAtom: ($) => choice($.KeyValuePair, $.BraceBlock, $.BracketList, $.ValueAtom),

    KeyValuePair: ($) =>
      seq(
        field("key", choice($.Identifier, $.PowerKw, $.FluxKw, $.TimeKw, $.LibKw, $.MatKw, $.SaveKw)),
        "=",
        field("value", choice($.BracketList, $.BraceBlock, $.ValueAtom)),
      ),

    GenericLineToken: ($) => choice($.KeyValuePair, $.ValueAtom),

    ValueAtom: ($) => choice($.NumberLiteral, $.StringLiteral, $.Identifier, ",", ":", ";", "*", "/"),

    ReadKw: () => choice("read", "READ"),
    EndKw: () => choice("end", "END"),
    CompKw: () => choice("comp", "COMP", "composition", "COMPOSITION"),
    CellDataKw: () => choice("celldata", "CELLDATA"),
    ParamKw: () => choice("param", "PARAM", "parameter", "PARAMETER", "parameters", "PARAMETERS"),
    GeomKw: () => choice("geom", "GEOM", "geometry", "GEOMETRY"),
    BoundsKw: () => choice("bounds", "BOUNDS"),
    GlobalKw: () => choice("global", "GLOBAL"),
    UnitKw: () => choice("unit", "UNIT"),
    CylinderKw: () => choice("cylinder", "CYLINDER", "zcylinder", "ZCYLINDER"),
    SphereKw: () => choice("sphere", "SPHERE"),
    CuboidKw: () => choice("cuboid", "CUBOID"),
    HexprismKw: () => choice("hexprism", "HEXPRISM"),
    MediaKw: () => choice("media", "MEDIA"),
    HoleKw: () => choice("hole", "HOLE"),
    ArrayKw: () => choice("array", "ARRAY"),
    BoundaryKw: () => choice("boundary", "BOUNDARY"),
    CaseKw: () => choice("case", "CASE"),
    LibKw: () => choice("lib", "LIB"),
    MatKw: () => choice("mat", "MAT"),
    TimeKw: () => choice("time", "TIME"),
    PowerKw: () => choice("power", "POWER"),
    FluxKw: () => choice("flux", "FLUX"),
    SaveKw: () => choice("save", "SAVE"),

    CommentLine: () => /'[^\r\n]*/,
    NumberLiteral: () => /[-+]?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\\r\n]|\\.)*"/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.-]*/,
  },
});
