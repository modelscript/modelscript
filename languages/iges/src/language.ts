// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInIgesLibrarySync } from "./catalog/library-package-adapter.js";
import { IgesErrorCode } from "./errors.js";
import { igesIndexing } from "./indexing.js";

/**
 * Declarative @modelscript/dsl grammar for IGES 5.3 (Initial Graphics Exchange Specification).
 *
 * Covers the five canonical 80-column IGES sections:
 *   - Start (S)
 *   - Global (G) with Hollerith strings `nH...`
 *   - Directory Entry (D) 2-line records with entity types 100..186
 *   - Parameter Data (P) comma-delimited parameter lists terminated by `;`
 *   - Terminate (T) section count summary `S<n>G<n>D<n>P<n>`
 */
export const igesLanguage = language({
  name: "iges",
  fileExtensions: [".igs", ".iges"],
  maturity: "beta",
  indexing: igesIndexing,
  lsp: {
    fileExtensions: [".igs", ".iges"],
  },
  errorCodes: IgesErrorCode,

  rules: {
    IgesFile: ($) =>
      repeat(
        choice(
          $["TerminateRecord"]!,
          $["ParameterRecord"]!,
          $["DirectoryRecord"]!,
          $["GlobalRecord"]!,
          $["StartRecord"]!,
        ),
      ),

    StartRecord: ($) => seq(field("marker", $["StartMarker"]!), field("seq", $["SequenceNumber"]!)),

    GlobalRecord: ($) =>
      seq(
        repeat(seq($["GlobalField"]!, optional(","))),
        optional(";"),
        field("marker", $["GlobalMarker"]!),
        field("seq", $["SequenceNumber"]!),
      ),

    GlobalField: ($) => choice($["HollerithString"]!, $["NumberLiteral"]!, $["Identifier"]!),

    DirectoryRecord: ($) =>
      seq(
        field("entityType", $["EntityTypeCode"]!),
        repeat(choice($["NumberLiteral"]!, $["Identifier"]!)),
        field("marker", $["DirectoryMarker"]!),
        field("seq", $["SequenceNumber"]!),
      ),

    ParameterRecord: ($) =>
      seq(
        field("entityType", $["EntityTypeCode"]!),
        repeat(seq(",", optional($["ParamValue"]!))),
        optional(";"),
        optional(field("dePointer", $["NumberLiteral"]!)),
        field("marker", $["ParameterMarker"]!),
        field("seq", $["SequenceNumber"]!),
      ),

    ParamValue: ($) => choice($["HollerithString"]!, $["NumberLiteral"]!, $["Identifier"]!),

    TerminateRecord: ($) =>
      seq(
        field("summary", $["TerminateSummary"]!),
        field("marker", $["TerminateMarker"]!),
        field("seq", $["SequenceNumber"]!),
      ),

    EntityTypeCode: () =>
      choice(
        "100",
        "102",
        "104",
        "106",
        "108",
        "110",
        "116",
        "120",
        "122",
        "124",
        "126",
        "128",
        "142",
        "144",
        "186",
        "502",
        "504",
        "508",
        "510",
        "514",
      ),

    TerminateSummary: () => /S\d{1,7}G\d{1,7}D\d{1,7}P\d{1,7}/,
    HollerithString: () => /\d+H[^,;\r\n]*/,
    StartMarker: () => "S",
    GlobalMarker: () => "G",
    DirectoryMarker: () => "D",
    ParameterMarker: () => "P",
    TerminateMarker: () => "T",
    SequenceNumber: () => /\d+/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInIgesLibrarySync();
