// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInCifLibrarySync } from "./catalog/library-package-adapter.js";
import { CifErrorCode } from "./errors.js";
import { cifIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for Caltech Intermediate Form 2.0 (CIF, 1979).
 */
export const cifLanguage = language({
  name: "cif",
  fileExtensions: [".cif"],
  maturity: "beta",
  indexing: cifIndexing,
  lsp: {
    fileExtensions: [".cif"],
  },
  errorCodes: CifErrorCode,

  rules: {
    Document: ($) => repeat($["Command"]!),

    Command: ($) =>
      choice(
        $["DefStartCommand"]!,
        $["DefFinishCommand"]!,
        $["DefDeleteCommand"]!,
        $["CallCommand"]!,
        $["LayerCommand"]!,
        $["BoxCommand"]!,
        $["PolygonCommand"]!,
        $["RoundflashCommand"]!,
        $["WireCommand"]!,
        $["UserExtensionCommand"]!,
        $["EndCommand"]!,
        $["CommentCommand"]!,
      ),

    DefStartCommand: ($) =>
      seq(
        "DS",
        field("symbolId", $["SignedInt"]!),
        optional(seq(field("a", $["SignedInt"]!), optional("/"), field("b", $["SignedInt"]!))),
        ";",
      ),

    DefFinishCommand: () => seq("DF", ";"),

    DefDeleteCommand: ($) => seq("DD", field("symbolId", $["SignedInt"]!), ";"),

    CallCommand: ($) => seq("C", field("symbolId", $["SignedInt"]!), repeat($["Transform"]!), ";"),

    Transform: ($) =>
      choice(
        seq("T", field("tx", $["SignedInt"]!), optional(","), field("ty", $["SignedInt"]!)),
        "MX",
        "MY",
        seq("R", field("rx", $["SignedInt"]!), optional(","), field("ry", $["SignedInt"]!)),
      ),

    LayerCommand: ($) => seq("L", field("layer", $["Identifier"]!), ";"),

    BoxCommand: ($) =>
      seq(
        "B",
        field("length", $["SignedInt"]!),
        optional(","),
        field("width", $["SignedInt"]!),
        optional(","),
        field("cx", $["SignedInt"]!),
        optional(","),
        field("cy", $["SignedInt"]!),
        optional(seq(optional(","), field("dx", $["SignedInt"]!), optional(","), field("dy", $["SignedInt"]!))),
        ";",
      ),

    PolygonCommand: ($) => seq("P", repeat($["Point"]!), ";"),

    RoundflashCommand: ($) =>
      seq(
        "R",
        field("diameter", $["SignedInt"]!),
        optional(","),
        field("cx", $["SignedInt"]!),
        optional(","),
        field("cy", $["SignedInt"]!),
        ";",
      ),

    WireCommand: ($) => seq("W", field("width", $["SignedInt"]!), repeat($["Point"]!), ";"),

    UserExtensionCommand: ($) =>
      seq(field("digit", $["SignedInt"]!), repeat(choice($["Identifier"]!, $["SignedInt"]!, ",")), ";"),

    EndCommand: () => seq("E", optional(";")),

    CommentCommand: ($) => seq($["Comment"]!, optional(";")),

    Point: ($) => seq(optional(","), field("x", $["SignedInt"]!), optional(","), field("y", $["SignedInt"]!)),

    SignedInt: () => /[+-]?\d+/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    Comment: () => /\([^)]*\)/,
  },
});

// Auto-register cleanroom MOSIS SCMOS & Mead-Conway standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInCifLibrarySync();
