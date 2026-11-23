// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInHec1LibrarySync } from "./catalog/library-package-adapter.js";
import { Hec1ErrorCode } from "./errors.js";
import { hec1Indexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for USACE HEC-1
 * (Flood Hydrograph Package Card Deck, 1968).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm`) supporting
 * all standard 2-character HEC-1 card codes (`ID`, `IT`, `IN`, `IO`, `KK`, `KM`,
 * `KO`, `BA`, `PB`, `PI`, `PC`, `LU`, `LS`, `LE`, `UC`, `UD`, `US`, `BF`, `RM`,
 * `RS`, `RD`, `HC`, `ZW`, `ZZ`) and `*` comment cards.
 */
export const hec1Language = language({
  name: "hec1",
  fileExtensions: [".hec1", ".h1", ".ihc"],
  maturity: "beta",
  indexing: hec1Indexing,
  lsp: {
    fileExtensions: [".hec1", ".h1", ".ihc"],
  },
  errorCodes: Hec1ErrorCode,

  rules: {
    Deck: ($) =>
      repeat(
        choice(
          $["IdCard"]!,
          $["ItCard"]!,
          $["InCard"]!,
          $["IoCard"]!,
          $["KkCard"]!,
          $["KmCard"]!,
          $["KoCard"]!,
          $["BaCard"]!,
          $["PbCard"]!,
          $["PiCard"]!,
          $["PcCard"]!,
          $["LuCard"]!,
          $["LsCard"]!,
          $["LeCard"]!,
          $["UcCard"]!,
          $["UdCard"]!,
          $["UsCard"]!,
          $["BfCard"]!,
          $["RmCard"]!,
          $["RsCard"]!,
          $["RdCard"]!,
          $["HcCard"]!,
          $["ZwCard"]!,
          $["ZzCard"]!,
          $["CommentCard"]!,
        ),
      ),

    FieldValue: ($) => choice($["NumberLiteral"]!, $["Identifier"]!, $["PathToken"]!),
    FieldEntry: ($) => seq(optional(","), $["FieldValue"]!),
    FieldList: ($) => repeat($["FieldEntry"]!),

    // Job control cards
    IdCard: ($) => seq("ID", $["FieldList"]!),
    ItCard: ($) => seq("IT", $["FieldList"]!),
    InCard: ($) => seq("IN", $["FieldList"]!),
    IoCard: ($) => seq("IO", $["FieldList"]!),

    // Station header & comment cards
    KkCard: ($) => seq("KK", field("stationId", $["FieldValue"]!), $["FieldList"]!),
    KmCard: ($) => seq("KM", $["FieldList"]!),
    KoCard: ($) => seq("KO", $["FieldList"]!),

    // Subbasin area & precipitation cards
    BaCard: ($) => seq("BA", field("area", $["NumberLiteral"]!), $["FieldList"]!),
    PbCard: ($) => seq("PB", field("totalPrecip", $["NumberLiteral"]!), $["FieldList"]!),
    PiCard: ($) => seq("PI", $["FieldList"]!),
    PcCard: ($) => seq("PC", $["FieldList"]!),

    // Loss rate cards (Uniform, SCS Curve Number, Exponential)
    LuCard: ($) => seq("LU", $["FieldList"]!),
    LsCard: ($) => seq("LS", $["FieldList"]!),
    LeCard: ($) => seq("LE", $["FieldList"]!),

    // Unit hydrograph & baseflow cards (Clark, SCS, Snyder, Baseflow)
    UcCard: ($) => seq("UC", $["FieldList"]!),
    UdCard: ($) => seq("UD", $["FieldList"]!),
    UsCard: ($) => seq("US", $["FieldList"]!),
    BfCard: ($) => seq("BF", $["FieldList"]!),

    // Routing & combine cards (Muskingum, Storage, Routing Data, Combine)
    RmCard: ($) => seq("RM", $["FieldList"]!),
    RsCard: ($) => seq("RS", $["FieldList"]!),
    RdCard: ($) => seq("RD", $["FieldList"]!),
    HcCard: ($) => seq("HC", field("combineCount", $["NumberLiteral"]!), $["FieldList"]!),

    // DSS write & job terminator
    ZwCard: ($) => seq("ZW", $["FieldList"]!),
    ZzCard: () => "ZZ",

    // Lexical tokens
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
    PathToken: () => /\/[^\s,]*/,
    CommentCard: () => /\*[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInHec1LibrarySync();
