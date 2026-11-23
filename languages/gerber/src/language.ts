// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInGerberLibrarySync } from "./catalog/library-package-adapter.js";
import { GerberErrorCode } from "./errors.js";
import { gerberIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for Gerber RS-274-D & RS-274X
 * PCB photoplotter files (.gbr, .gtl, .gbl, .gts, .gbs, .gto, .gbo, .gko, .pho, .art).
 */
export const gerberLanguage = language({
  name: "gerber",
  fileExtensions: [".gbr", ".ger", ".gtl", ".gbl", ".gts", ".gbs", ".gto", ".gbo", ".gko", ".pho", ".art"],
  maturity: "beta",
  indexing: gerberIndexing,
  lsp: {
    fileExtensions: [".gbr", ".ger", ".gtl", ".gbl", ".gts", ".gbs", ".gto", ".gbo", ".gko", ".pho", ".art"],
  },
  errorCodes: GerberErrorCode,

  rules: {
    GerberFile: ($) =>
      repeat(
        choice(
          $["ExtendedParam"]!,
          $["CommentCommand"]!,
          $["RegionCommand"]!,
          $["UnitLegacyCommand"]!,
          $["QuadrantCommand"]!,
          $["CoordModeCommand"]!,
          $["EofCommand"]!,
          $["ApertureSelectCommand"]!,
          $["OperationCommand"]!,
        ),
      ),

    ExtendedParam: ($) =>
      choice(
        $["FormatSpecParam"]!,
        $["UnitModeParam"]!,
        $["ApertureDefParam"]!,
        $["ApertureMacroParam"]!,
        $["PolarityParam"]!,
        $["StepRepeatParam"]!,
        $["AttributeParam"]!,
      ),

    FormatSpecParam: ($) => field("spec", $["FormatSpecToken"]!),
    UnitModeParam: ($) => field("unit", $["UnitModeToken"]!),
    ApertureDefParam: ($) => field("aperture", $["ApertureDefToken"]!),
    ApertureMacroParam: ($) => field("macro", $["ApertureMacroToken"]!),
    PolarityParam: ($) => field("polarity", $["PolarityToken"]!),
    StepRepeatParam: ($) => field("stepRepeat", $["StepRepeatToken"]!),
    AttributeParam: ($) => field("attribute", $["AttributeToken"]!),

    CommentCommand: ($) => field("comment", $["G04CommentToken"]!),
    RegionCommand: () => seq(field("code", choice("G36", "G37")), "*"),
    UnitLegacyCommand: () => seq(field("code", choice("G70", "G71")), "*"),
    QuadrantCommand: () => seq(field("code", choice("G74", "G75")), "*"),
    CoordModeCommand: () => seq(field("code", choice("G90", "G91")), "*"),
    EofCommand: () => seq(field("code", choice("M02", "M00", "M01")), "*"),

    ApertureSelectCommand: ($) => seq(optional("G54"), field("aperture", $["ApertureSelectToken"]!), "*"),

    OperationCommand: ($) =>
      seq(
        optional(field("mode", choice("G01", "G02", "G03"))),
        optional(field("x", $["XCoordToken"]!)),
        optional(field("y", $["YCoordToken"]!)),
        optional(field("i", $["ICoordToken"]!)),
        optional(field("j", $["JCoordToken"]!)),
        optional(field("op", choice("D01", "D02", "D03"))),
        "*",
      ),

    FormatSpecToken: () => /%FS[LT][AI]X\d\dY\d\d\*%/,
    UnitModeToken: () => /%MO(?:IN|MM)\*%/,
    ApertureDefToken: () => /%ADD\d+[A-Za-z_][A-Za-z0-9_.$]*(?:,[^*%]*)?\*%/,
    ApertureMacroToken: () => /%AM[^%]*\*%/,
    PolarityToken: () => /%LP[DC]\*%/,
    StepRepeatToken: () => /%SR[^%]*\*%/,
    AttributeToken: () => /%T[FAD][^*%]*\*%/,
    G04CommentToken: () => /G04[^*]*\*/,
    ApertureSelectToken: () => /D(?:[1-9]\d+)/,
    XCoordToken: () => /X[+-]?\d+/,
    YCoordToken: () => /Y[+-]?\d+/,
    ICoordToken: () => /I[+-]?\d+/,
    JCoordToken: () => /J[+-]?\d+/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInGerberLibrarySync();
