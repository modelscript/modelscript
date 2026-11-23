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

  rules: {
    MpsDeck: ($) =>
      seq(
        repeat($["Comment"]!),
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
            $["Comment"]!,
          ),
        ),
        optional($["EndataCard"]!),
      ),

    NameCard: ($) => seq("NAME", optional(field("name", $["Identifier"]!))),

    ObjSenseSection: () => seq("OBJSENSE", field("sense", choice("MIN", "MAX", "MINIMIZE", "MAXIMIZE"))),

    RowsSection: ($) => seq("ROWS", repeat(choice($["RowCard"]!, $["Comment"]!))),

    RowCard: ($) => seq(field("rowType", choice("N", "L", "G", "E")), field("name", $["Identifier"]!)),

    ColumnsSection: ($) => seq("COLUMNS", repeat(choice($["MarkerCard"]!, $["ColumnCard"]!, $["Comment"]!))),

    MarkerCard: ($) =>
      seq(field("markerName", $["Identifier"]!), "'MARKER'", field("markerType", choice("'INTORG'", "'INTEND'"))),

    ColumnCard: ($) =>
      seq(
        field("column", $["Identifier"]!),
        field("row1", $["Identifier"]!),
        field("value1", $["NumberLiteral"]!),
        optional(seq(field("row2", $["Identifier"]!), field("value2", $["NumberLiteral"]!))),
      ),

    RhsSection: ($) => seq("RHS", repeat(choice($["RhsCard"]!, $["Comment"]!))),

    RhsCard: ($) =>
      seq(
        field("rhsName", $["Identifier"]!),
        field("row1", $["Identifier"]!),
        field("value1", $["NumberLiteral"]!),
        optional(seq(field("row2", $["Identifier"]!), field("value2", $["NumberLiteral"]!))),
      ),

    RangesSection: ($) => seq("RANGES", repeat(choice($["RangeCard"]!, $["Comment"]!))),

    RangeCard: ($) =>
      seq(
        field("rangeName", $["Identifier"]!),
        field("row1", $["Identifier"]!),
        field("value1", $["NumberLiteral"]!),
        optional(seq(field("row2", $["Identifier"]!), field("value2", $["NumberLiteral"]!))),
      ),

    BoundsSection: ($) => seq("BOUNDS", repeat(choice($["BoundCard"]!, $["Comment"]!))),

    BoundCard: ($) =>
      seq(
        field("boundType", choice("LO", "UP", "FX", "FR", "MI", "PL", "BV", "LI", "UI")),
        field("boundName", $["Identifier"]!),
        field("column", $["Identifier"]!),
        optional(field("value", $["NumberLiteral"]!)),
      ),

    QuadObjSection: ($) => seq(choice("QUADOBJ", "QMATRIX"), repeat(choice($["QuadCard"]!, $["Comment"]!))),

    QuadCard: ($) =>
      seq(field("col1", $["Identifier"]!), field("col2", $["Identifier"]!), field("value", $["NumberLiteral"]!)),

    EndataCard: () => "ENDATA",

    Identifier: () => /[A-Za-z_$.@#][A-Za-z0-9_$.@#()[\]:/-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Comment: () => /\*[^\r\n]*/,
  },
});
