// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { MpsErrorCode } from "./errors.js";
import { mpsIndexing } from "./indexing.js";

/**
 * Declarative @modelscript/dsl grammar for IBM MPS (Mathematical Programming System) format.
 *
 * Covers both fixed-column (80-col) and free-format MPS:
 * NAME, OBJSENSE (MIN/MAX), ROWS (N/L/G/E), COLUMNS (+ 'MARKER' 'INTORG'/'INTEND'),
 * RHS, RANGES, BOUNDS (LO/UP/FX/FR/MI/PL/BV/LI/UI), QUADOBJ/QMATRIX, ENDATA, and * comments.
 */
export const mpsLanguage = language({
  name: "mps",
  fileExtensions: [".mps", ".qps"],
  maturity: "beta",
  indexing: mpsIndexing,
  lsp: {
    fileExtensions: [".mps", ".qps"],
  },
  errorCodes: MpsErrorCode,

  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],

  conflicts: ($) => [[$["_OptSecondPair"]!, $["Identifier"]!]],

  rules: {
    MpsDeck: ($) =>
      seq(
        optional($["NameCard"]!),
        repeat(
          choice(
            $["ObjSenseSection"]!,
            $["RowsSection"]!,
            $["ColumnsSection"]!,
            $["RhsSection"]!,
            $["RangesSection"]!,
            $["BoundsSection"]!,
            $["QuadObjSection"]!,
          ),
        ),
        optional($["EndataCard"]!),
      ),

    NameCard: ($) => seq("NAME", optional(field("name", $["Identifier"]!))),

    ObjSenseSection: () => seq("OBJSENSE", field("sense", choice("MIN", "MAX", "MINIMIZE", "MAXIMIZE"))),

    RowsSection: ($) => seq("ROWS", repeat($["RowCard"]!)),

    RowCard: ($) => seq(field("rowType", choice("N", "L", "G", "E")), field("name", $["Identifier"]!)),

    ColumnsSection: ($) => seq("COLUMNS", repeat(choice($["MarkerCard"]!, $["ColumnCard"]!))),

    MarkerCard: ($) =>
      seq(field("markerName", $["Identifier"]!), "'MARKER'", field("markerType", choice("'INTORG'", "'INTEND'"))),

    _OptSecondPair: ($) => optional(seq(field("row2", $["Identifier"]!), field("value2", $["NumberLiteral"]!))),

    ColumnCard: ($) =>
      seq(
        field("column", $["Identifier"]!),
        field("row1", $["Identifier"]!),
        field("value1", $["NumberLiteral"]!),
        $["_OptSecondPair"]!,
      ),

    RhsSection: ($) => seq("RHS", repeat($["RhsCard"]!)),

    RhsCard: ($) =>
      seq(
        field("rhsName", $["Identifier"]!),
        field("row1", $["Identifier"]!),
        field("value1", $["NumberLiteral"]!),
        $["_OptSecondPair"]!,
      ),

    RangesSection: ($) => seq("RANGES", repeat($["RangeCard"]!)),

    RangeCard: ($) =>
      seq(
        field("rangeName", $["Identifier"]!),
        field("row1", $["Identifier"]!),
        field("value1", $["NumberLiteral"]!),
        $["_OptSecondPair"]!,
      ),

    BoundsSection: ($) => seq("BOUNDS", repeat($["BoundCard"]!)),

    BoundCard: ($) =>
      seq(
        field("boundType", choice("LO", "UP", "FX", "FR", "MI", "PL", "BV", "LI", "UI")),
        field("boundName", $["Identifier"]!),
        field("column", $["Identifier"]!),
        optional(field("value", $["NumberLiteral"]!)),
      ),

    QuadObjSection: ($) => seq(choice("QUADOBJ", "QMATRIX"), repeat($["QuadCard"]!)),

    QuadCard: ($) =>
      seq(field("col1", $["Identifier"]!), field("col2", $["Identifier"]!), field("value", $["NumberLiteral"]!)),

    EndataCard: () => "ENDATA",

    Identifier: () => /[A-Za-z_$.@#][A-Za-z0-9_$.@#()[\]:/-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Comment: () => /\*[^\r\n]*/,
  },
});
