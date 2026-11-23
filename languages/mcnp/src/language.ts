// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInMcnpLibrarySync } from "./catalog/library-package-adapter.js";
import { McnpErrorCode } from "./errors.js";
import { mcnpIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for MCNP
 * (Los Alamos Monte Carlo N-Particle Transport Deck).
 */
export const mcnpLanguage = language({
  name: "mcnp",
  fileExtensions: [".mcnp", ".mcnp5", ".mcnp6", ".i", ".inp"],
  maturity: "beta",
  indexing: mcnpIndexing,
  lsp: {
    fileExtensions: [".mcnp", ".mcnp5", ".mcnp6", ".i", ".inp"],
  },
  errorCodes: McnpErrorCode,

  rules: {
    Deck: ($) => repeat(choice($["CellCard"]!, $["SurfaceCard"]!, $["DataCard"]!, $["Comment"]!)),

    CellCard: ($) =>
      seq(
        field("id", $["PositiveInt"]!),
        field("material", $["NonNegInt"]!),
        optional(field("density", $["NumberLiteral"]!)),
        field("csg", $["CsgExpr"]!),
        repeat($["CellParam"]!),
      ),

    CsgExpr: ($) => seq($["CsgTerm"]!, repeat(choice(seq(":", $["CsgTerm"]!), $["CsgTerm"]!))),

    CsgTerm: ($) =>
      choice(
        seq("#", $["PositiveInt"]!),
        seq("#", "(", $["CsgExpr"]!, ")"),
        seq("(", $["CsgExpr"]!, ")"),
        $["SignedSurfaceId"]!,
      ),

    CellParam: ($) =>
      choice(
        seq(choice("IMP:N", "IMP:P", "IMP:E", "IMP:N,P", "imp:n", "imp:p"), optional("="), $["NumberLiteral"]!),
        seq(choice("VOL", "vol"), optional("="), $["NumberLiteral"]!),
        seq(choice("U", "u"), optional("="), $["NonNegInt"]!),
        seq(choice("FILL", "fill"), optional("="), $["NonNegInt"]!),
        seq(choice("TMP", "tmp"), optional("="), $["NumberLiteral"]!),
        seq(choice("TRCL", "trcl"), optional("="), $["NonNegInt"]!),
      ),

    SurfaceCard: ($) =>
      seq(
        optional(choice("*", "+")),
        field("id", $["PositiveInt"]!),
        field("mnemonic", $["SurfaceMnemonic"]!),
        repeat($["NumberLiteral"]!),
      ),

    SurfaceMnemonic: () =>
      choice(
        "C/X",
        "C/Y",
        "C/Z",
        "K/X",
        "K/Y",
        "K/Z",
        "PX",
        "PY",
        "PZ",
        "SO",
        "SX",
        "SY",
        "SZ",
        "CX",
        "CY",
        "CZ",
        "KX",
        "KY",
        "KZ",
        "GQ",
        "RPP",
        "RCC",
        "SPH",
        "P",
        "S",
      ),

    DataCard: ($) =>
      choice(
        $["ModeCard"]!,
        $["MaterialCard"]!,
        $["ThermalCard"]!,
        $["SdefCard"]!,
        $["KcodeCard"]!,
        $["KsrcCard"]!,
        $["TallyCard"]!,
        $["NpsCard"]!,
        $["PhysCard"]!,
      ),

    ModeCard: () => seq(choice("MODE", "mode"), repeat(choice("N", "P", "E", "n", "p", "e"))),

    MaterialCard: ($) => seq(field("id", $["MaterialId"]!), repeat(seq($["Zaid"]!, $["NumberLiteral"]!))),

    ThermalCard: ($) => seq(field("id", $["ThermalId"]!), repeat($["Identifier"]!)),

    SdefCard: ($) => seq(choice("SDEF", "sdef"), repeat($["SdefParam"]!)),

    SdefParam: ($) =>
      seq(
        field("key", choice("POS", "VEC", "DIR", "ERG", "PAR", "RAD", "CEL")),
        "=",
        repeat(choice($["NumberLiteral"]!, $["Identifier"]!)),
      ),

    KcodeCard: ($) =>
      seq(
        choice("KCODE", "kcode"),
        field("nsrck", $["NumberLiteral"]!),
        field("rkk", $["NumberLiteral"]!),
        field("ikz", $["NumberLiteral"]!),
        field("kct", $["NumberLiteral"]!),
      ),

    KsrcCard: ($) => seq(choice("KSRC", "ksrc"), repeat($["NumberLiteral"]!)),

    TallyCard: ($) => seq(field("id", $["TallyId"]!), repeat($["NumberLiteral"]!)),

    NpsCard: ($) => seq(choice("NPS", "nps"), field("count", $["NumberLiteral"]!)),

    PhysCard: ($) => seq(choice("PHYS:N", "PHYS:P", "PHYS:E", "PHYS"), repeat($["NumberLiteral"]!)),

    MaterialId: () => /[Mm]\d+/,
    ThermalId: () => /[Mm][Tt]\d+/,
    TallyId: () => /[Ff]\d+(?::[NnPpEe](?:,[NnPpEe])*)?/,
    Zaid: () => /\d{4,6}(?:\.\d{2}[A-Za-z])?/,
    SignedSurfaceId: () => /[+-]?\d+/,
    PositiveInt: () => /[1-9]\d*/,
    NonNegInt: () => /\d+/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.]*/,
    Comment: () => /(?:[cC][ \t][^\n]*|\$[^\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInMcnpLibrarySync();
