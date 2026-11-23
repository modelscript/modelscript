// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInChemkinLibrarySync } from "./catalog/library-package-adapter.js";
import { ChemkinErrorCode } from "./errors.js";
import { chemkinIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for Sandia CHEMKIN
 * gas-phase & surface chemical kinetics decks (`.inp`, `.ck`, `.therm`).
 */
export const chemkinLanguage = language({
  name: "chemkin",
  fileExtensions: [".inp", ".ck", ".therm"],
  maturity: "beta",
  indexing: chemkinIndexing,
  lsp: {
    fileExtensions: [".inp", ".ck", ".therm"],
  },
  errorCodes: ChemkinErrorCode,
  extras: ($) => [/\s+/, $["Comment"]!],

  rules: {
    Deck: ($) =>
      repeat(
        choice($["ElementsSection"]!, $["SpeciesSection"]!, $["ThermoSection"]!, $["ReactionsSection"]!, $["Comment"]!),
      ),

    ElementsSection: ($) => seq(choice("ELEMENTS", "ELEM"), repeat(choice($["ElementEntry"]!, $["Comment"]!)), "END"),

    ElementEntry: ($) =>
      seq(field("name", $["Identifier"]!), optional(seq("/", field("weight", $["NumberLiteral"]!), "/"))),

    SpeciesSection: ($) => seq(choice("SPECIES", "SPEC"), repeat(choice($["SpeciesEntry"]!, $["Comment"]!)), "END"),

    SpeciesEntry: ($) => field("name", $["Identifier"]!),

    ThermoSection: ($) =>
      seq(choice("THERMO", "THER"), optional("ALL"), repeat(choice($["ThermoToken"]!, $["Comment"]!)), "END"),

    ThermoToken: ($) => choice($["NumberLiteral"]!, $["Identifier"]!, "/"),

    ReactionsSection: ($) =>
      seq(
        choice("REACTIONS", "REAC"),
        repeat($["UnitKeyword"]!),
        repeat(choice($["ReactionAuxClause"]!, $["ReactionEntry"]!, $["Comment"]!)),
        "END",
      ),

    UnitKeyword: () =>
      choice("CAL/MOLE", "KCAL/MOLE", "JOULES/MOLE", "KJOULES/MOLE", "KELVINS", "EVOLTS", "MOLES", "MOLECULES"),

    ReactionEntry: ($) =>
      seq(
        field("lhs", $["ReactionSide"]!),
        field("arrow", choice("<=>", "=>", "=")),
        field("rhs", $["ReactionSide"]!),
        field("A", $["NumberLiteral"]!),
        field("b", $["NumberLiteral"]!),
        field("Ea", $["NumberLiteral"]!),
      ),

    ReactionSide: ($) => seq($["ReactionTerm"]!, repeat(choice(seq("+", $["ReactionTerm"]!), $["FalloffCollider"]!))),

    ReactionTerm: ($) => choice($["Identifier"]!, seq($["NumberLiteral"]!, $["Identifier"]!)),

    FalloffCollider: ($) => seq("(", "+", $["Identifier"]!, ")"),

    ReactionAuxClause: ($) =>
      choice(
        "DUPLICATE",
        "DUP",
        seq(field("keyword", choice("LOW", "TROE", "SRI", "REV", "PLOG")), "/", repeat($["NumberLiteral"]!), "/"),
        seq(field("species", $["Identifier"]!), "/", field("efficiency", $["NumberLiteral"]!), "/"),
      ),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_*,-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Comment: () => /![^\r\n]*/,
  },
});

// Auto-register cleanroom CHEMKIN standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInChemkinLibrarySync();
