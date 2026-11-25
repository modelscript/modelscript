// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInRinexLibrarySync } from "./catalog/library-package-adapter.js";
import { RinexErrorCode } from "./errors.js";
import { rinexIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` WASM GLR language specification for RINEX v2
 * (Receiver Independent Exchange Format for GNSS/GPS OBS & NAV files, 1989).
 */
export const rinexLanguage = language({
  name: "rinex",
  fileExtensions: [".obs", ".nav", ".rnx", ".24o", ".24n", ".25o", ".25n", ".o", ".n"],
  maturity: "beta",
  indexing: rinexIndexing,
  lsp: {
    fileExtensions: [".obs", ".nav", ".rnx", ".24o", ".24n", ".25o", ".25n", ".o", ".n"],
  },
  ui: {
    panels: [
      {
        id: "rinexEditor",
        viewType: "modelscript.rinexEditor",
        title: "RINEX v2 GNSS Skyplot & Position Fix Viewer",
        shortTitle: "RINEX",
        selector: ["*.obs", "*.nav", "*.rnx", "*.24o", "*.24n"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/RinexPanel.tsx",
        artifactViewTypes: ["rinex", "obs", "nav"],
      },
    ],
  },

  errorCodes: RinexErrorCode,

  rules: {
    RinexFile: ($) => seq(field("header", $["HeaderSection"]!), optional(field("body", $["BodySection"]!))),

    HeaderSection: ($) => seq(repeat($["HeaderRecord"]!), $["EndOfHeaderRecord"]!),

    HeaderRecord: ($) =>
      choice(
        $["VersionTypeHeader"]!,
        $["PgmRunByDateHeader"]!,
        $["MarkerNameHeader"]!,
        $["ApproxPositionHeader"]!,
        $["AntennaDeltaHeader"]!,
        $["ObsTypesHeader"]!,
        $["TimeOfFirstObsHeader"]!,
        $["IonAlphaHeader"]!,
        $["IonBetaHeader"]!,
        $["GenericHeader"]!,
      ),

    VersionTypeHeader: ($) =>
      seq(field("version", $["NumberLiteral"]!), repeat($["HeaderToken"]!), "RINEX VERSION / TYPE"),

    PgmRunByDateHeader: ($) => seq(repeat($["HeaderToken"]!), "PGM / RUN BY / DATE"),

    MarkerNameHeader: ($) => seq(field("marker", $["HeaderToken"]!), repeat($["HeaderToken"]!), "MARKER NAME"),

    ApproxPositionHeader: ($) =>
      seq(
        field("x", $["NumberLiteral"]!),
        field("y", $["NumberLiteral"]!),
        field("z", $["NumberLiteral"]!),
        "APPROX POSITION XYZ",
      ),

    AntennaDeltaHeader: ($) =>
      seq(
        field("h", $["NumberLiteral"]!),
        field("e", $["NumberLiteral"]!),
        field("n", $["NumberLiteral"]!),
        "ANTENNA: DELTA H/E/N",
      ),

    ObsTypesHeader: ($) =>
      seq(field("count", $["NumberLiteral"]!), repeat(field("obsType", $["ObsTypeCode"]!)), "# / TYPES OF OBSERV"),

    TimeOfFirstObsHeader: ($) =>
      seq(
        field("year", $["NumberLiteral"]!),
        field("month", $["NumberLiteral"]!),
        field("day", $["NumberLiteral"]!),
        field("hour", $["NumberLiteral"]!),
        field("minute", $["NumberLiteral"]!),
        field("second", $["NumberLiteral"]!),
        optional($["Identifier"]!),
        "TIME OF FIRST OBS",
      ),

    IonAlphaHeader: ($) =>
      seq($["NumberLiteral"]!, $["NumberLiteral"]!, $["NumberLiteral"]!, $["NumberLiteral"]!, "ION ALPHA"),

    IonBetaHeader: ($) =>
      seq($["NumberLiteral"]!, $["NumberLiteral"]!, $["NumberLiteral"]!, $["NumberLiteral"]!, "ION BETA"),

    GenericHeader: ($) =>
      seq(
        repeat($["HeaderToken"]!),
        choice(
          "MARKER NUMBER",
          "OBSERVER / AGENCY",
          "REC # / TYPE / VERS",
          "ANT # / TYPE",
          "WAVELENGTH FACT L1/2",
          "INTERVAL",
          "TIME OF LAST OBS",
          "LEAP SECONDS",
          "DELTA-UTC: A0,A1,T,W",
          "COMMENT",
        ),
      ),

    EndOfHeaderRecord: () => "END OF HEADER",

    BodySection: ($) => repeat(choice($["ObsEpochRecord"]!, $["NavEphemerisRecord"]!)),

    ObsEpochRecord: ($) =>
      seq(
        field("year", $["NumberLiteral"]!),
        field("month", $["NumberLiteral"]!),
        field("day", $["NumberLiteral"]!),
        field("hour", $["NumberLiteral"]!),
        field("minute", $["NumberLiteral"]!),
        field("second", $["NumberLiteral"]!),
        field("flag", $["NumberLiteral"]!),
        field("numSats", $["NumberLiteral"]!),
        repeat($["SatPrn"]!),
        repeat($["NumberLiteral"]!),
      ),

    NavEphemerisRecord: ($) =>
      seq(
        field("prn", $["NumberLiteral"]!),
        field("year", $["NumberLiteral"]!),
        field("month", $["NumberLiteral"]!),
        field("day", $["NumberLiteral"]!),
        field("hour", $["NumberLiteral"]!),
        field("minute", $["NumberLiteral"]!),
        field("second", $["NumberLiteral"]!),
        repeat($["NumberLiteral"]!),
      ),

    HeaderToken: ($) =>
      choice($["SatPrn"]!, $["ObsTypeCode"]!, $["NumberLiteral"]!, $["Identifier"]!, $["PunctToken"]!),
    SatPrn: () => /[GRESCJ][0-9]{2}/,
    ObsTypeCode: () => /(?:C1|P1|P2|L1|L2|D1|D2|S1|S2|C2|C5|L5)/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.\-/]*/,
    PunctToken: () => /[:#/,+()-]/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInRinexLibrarySync();
