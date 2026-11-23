// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, prec, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInNec2LibrarySync } from "./catalog/library-package-adapter.js";
import { Nec2ErrorCode } from "./errors.js";
import { nec2Indexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for LLNL NEC-2
 * Wire Antenna Decks (`.nec`, `.nec2`, `.ant`).
 */
export const nec2Language = language({
  name: "nec2",
  fileExtensions: [".nec", ".nec2", ".ant"],
  maturity: "beta",
  indexing: nec2Indexing,
  lsp: {
    fileExtensions: [".nec", ".nec2", ".ant"],
  },
  errorCodes: Nec2ErrorCode,

  rules: {
    Deck: ($) =>
      repeat(
        choice(
          $["CommentCard"]!,
          $["CommentEndCard"]!,
          $["SymbolicCard"]!,
          $["WireCard"]!,
          $["ArcCard"]!,
          $["HelixCard"]!,
          $["TransformCard"]!,
          $["SymmetryCard"]!,
          $["ScaleCard"]!,
          $["PatchCard"]!,
          $["MultiPatchCard"]!,
          $["GeometryEndCard"]!,
          $["FrequencyCard"]!,
          $["ExcitationCard"]!,
          $["LoadCard"]!,
          $["GroundCard"]!,
          $["NetworkCard"]!,
          $["TransmissionLineCard"]!,
          $["RadiationPatternCard"]!,
          $["ExecuteCard"]!,
          $["EndCard"]!,
          $["LineComment"]!,
        ),
      ),

    // Comment cards (CM / CE)
    CommentCard: () => /CM[^\r\n]*/,
    CommentEndCard: () => /CE[^\r\n]*/,

    // 4NEC2 Symbolic variable card (SY)
    SymbolicCard: ($) => seq("SY", $["SymbolicAssignment"]!, repeat(seq(optional(","), $["SymbolicAssignment"]!))),

    SymbolicAssignment: ($) => seq(field("name", $["Identifier"]!), "=", field("value", $["Expr"]!)),

    // Geometry cards
    WireCard: ($) =>
      seq(
        "GW",
        field("tag", $["CardField"]!),
        field("segments", $["CardField"]!),
        field("x1", $["CardField"]!),
        field("y1", $["CardField"]!),
        field("z1", $["CardField"]!),
        field("x2", $["CardField"]!),
        field("y2", $["CardField"]!),
        field("z2", $["CardField"]!),
        field("radius", $["CardField"]!),
      ),

    ArcCard: ($) =>
      seq(
        "GA",
        field("tag", $["CardField"]!),
        field("segments", $["CardField"]!),
        field("arcRadius", $["CardField"]!),
        field("angle1", $["CardField"]!),
        field("angle2", $["CardField"]!),
        field("wireRadius", $["CardField"]!),
      ),

    HelixCard: ($) =>
      seq(
        "GH",
        field("tag", $["CardField"]!),
        field("segments", $["CardField"]!),
        field("spacing", $["CardField"]!),
        field("length", $["CardField"]!),
        field("rx1", $["CardField"]!),
        field("ry1", $["CardField"]!),
        field("rx2", $["CardField"]!),
        field("ry2", $["CardField"]!),
        field("wireRadius", $["CardField"]!),
      ),

    TransformCard: ($) => seq("GM", repeat($["CardField"]!)),
    SymmetryCard: ($) => seq("GR", field("tagInc", $["CardField"]!), field("copies", $["CardField"]!)),
    ScaleCard: ($) => seq("GS", repeat($["CardField"]!)),
    PatchCard: ($) => seq("SP", repeat($["CardField"]!)),
    MultiPatchCard: ($) => seq("SM", repeat($["CardField"]!)),
    GeometryEndCard: ($) => seq("GE", optional(field("gpflag", $["CardField"]!))),

    // Control & excitation cards
    FrequencyCard: ($) =>
      seq(
        "FR",
        field("ifrq", $["CardField"]!),
        field("nfrq", $["CardField"]!),
        $["CardField"]!,
        $["CardField"]!,
        field("fmhz", $["CardField"]!),
        optional(field("delFreq", $["CardField"]!)),
      ),

    ExcitationCard: ($) =>
      seq(
        "EX",
        field("type", $["CardField"]!),
        field("tag", $["CardField"]!),
        field("segment", $["CardField"]!),
        repeat($["CardField"]!),
      ),

    LoadCard: ($) => seq("LD", repeat($["CardField"]!)),
    GroundCard: ($) => seq("GN", repeat($["CardField"]!)),
    NetworkCard: ($) => seq("NT", repeat($["CardField"]!)),
    TransmissionLineCard: ($) => seq("TL", repeat($["CardField"]!)),
    RadiationPatternCard: ($) => seq("RP", repeat($["CardField"]!)),
    ExecuteCard: ($) => seq("XQ", optional($["CardField"]!)),
    EndCard: () => "EN",

    // Card argument field (numeric literal, symbolic identifier, or parenthesized expression)
    CardField: ($) => seq(optional(","), $["Expr"]!),

    Expr: ($) =>
      choice(
        $["NumberLiteral"]!,
        $["Identifier"]!,
        seq("(", $["Expr"]!, ")"),
        prec.left(1, seq($["Expr"]!, choice("+", "-", "*", "/", "^"), $["Expr"]!)),
      ),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    LineComment: () => /(?:!|' )[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInNec2LibrarySync();
