// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { SimaErrorCode } from "./lints/error-codes.js";

/**
 * DSL language specification for SINTEF Ocean SIMO / RIFLEX and SIMA (.inp, .sima, .sys, .hyd).
 */
export const simaLanguage = language({
  name: "sima",
  fileExtensions: [".inp", ".sima", ".sys", ".hyd"],
  lsp: {
    fileExtensions: [".inp", ".sima", ".sys", ".hyd"],
  },

  errorCodes: SimaErrorCode,

  rules: {
    Deck: ($) => repeat(choice($.CardStatement, $.Comment)),

    CardStatement: ($) =>
      choice(
        $.SysCard,
        $.BodyCard,
        $.FairleadCard,
        $.LineCard,
        $.SegmentCard,
        $.WaveCard,
        $.WindCard,
        $.CurrentCard,
        $.TimeCard,
        $.GenericCard,
      ),

    SysCard: ($) =>
      seq(
        choice("SYS", "SYSTEM"),
        field("depth", $.NumberLiteral),
        optional(field("density", $.NumberLiteral)),
        optional(field("gravity", $.NumberLiteral)),
      ),

    BodyCard: ($) =>
      seq(choice("BODY", "VESSEL"), field("id", $.Identifier), field("name", $.Identifier), repeat($.NumberLiteral)),

    FairleadCard: ($) =>
      seq(
        choice("FAIRLEAD", "ATTACH"),
        field("id", $.Identifier),
        field("vessel", $.Identifier),
        field("x", $.NumberLiteral),
        field("y", $.NumberLiteral),
        field("z", $.NumberLiteral),
      ),

    LineCard: ($) =>
      seq(
        choice("LINE", "MOORING"),
        field("id", $.Identifier),
        field("type", $.Identifier),
        field("fairlead", $.Identifier),
        field("anchorX", $.NumberLiteral),
        field("anchorY", $.NumberLiteral),
        field("anchorZ", $.NumberLiteral),
      ),

    SegmentCard: ($) => seq(choice("SEGM", "SEGMENT", "CRS"), field("typeRef", $.Identifier), repeat($.NumberLiteral)),

    WaveCard: ($) =>
      seq(
        "WAVE",
        field("spectrum", $.Identifier),
        field("hs", $.NumberLiteral),
        field("tp", $.NumberLiteral),
        repeat($.NumberLiteral),
      ),

    WindCard: ($) => seq("WIND", field("speed", $.NumberLiteral), field("direction", $.NumberLiteral)),

    CurrentCard: ($) =>
      seq(choice("CURR", "CURRENT"), field("speed", $.NumberLiteral), field("direction", $.NumberLiteral)),

    TimeCard: ($) => seq(choice("TIME", "DYNMOD"), field("dt", $.NumberLiteral), field("duration", $.NumberLiteral)),

    GenericCard: ($) => seq($.Identifier, repeat(choice($.NumberLiteral, $.Identifier, $.StringLiteral))),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_:-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:!.*|\*.*|#.*|\/\/.*)/,
  },
});
