// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInLsDynaLibrarySync } from "./catalog/library-package-adapter.js";
import { LsDynaErrorCode } from "./errors.js";
import { lsdynaIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for LS-DYNA / DYNA3D
 * explicit dynamics keyword decks (`.k`, `.key`, `.dyn`).
 */
export const lsdynaLanguage = language({
  name: "lsdyna",
  fileExtensions: [".k", ".key", ".dyn"],
  maturity: "beta",
  indexing: lsdynaIndexing,
  lsp: {
    fileExtensions: [".k", ".key", ".dyn"],
  },
  errorCodes: LsDynaErrorCode,

  rules: {
    Deck: ($) =>
      repeat(
        choice(
          $["KeywordSection"]!,
          $["TitleSection"]!,
          $["NodeSection"]!,
          $["ElementSolidSection"]!,
          $["ElementShellSection"]!,
          $["ElementBeamSection"]!,
          $["PartSection"]!,
          $["SectionSolidCard"]!,
          $["SectionShellCard"]!,
          $["SectionBeamCard"]!,
          $["MatElasticCard"]!,
          $["MatPlasticKinematicCard"]!,
          $["MatRigidCard"]!,
          $["BoundarySpcNodeCard"]!,
          $["BoundarySpcSetCard"]!,
          $["InitialVelocityCard"]!,
          $["LoadNodePointCard"]!,
          $["DefineCurveCard"]!,
          $["SetNodeListCard"]!,
          $["ControlTerminationCard"]!,
          $["ControlTimestepCard"]!,
          $["DatabaseGlstatCard"]!,
          $["EndSection"]!,
          $["Comment"]!,
        ),
      ),

    KeywordSection: () => "*KEYWORD",
    EndSection: () => "*END",

    TitleSection: ($) => seq("*TITLE", optional(field("title", $["Identifier"]!))),

    NodeSection: ($) => seq("*NODE", repeat($["DataRow"]!)),

    ElementSolidSection: ($) => seq("*ELEMENT_SOLID", repeat($["DataRow"]!)),
    ElementShellSection: ($) => seq("*ELEMENT_SHELL", repeat($["DataRow"]!)),
    ElementBeamSection: ($) => seq("*ELEMENT_BEAM", repeat($["DataRow"]!)),

    PartSection: ($) => seq("*PART", repeat(choice($["PartHeader"]!, $["DataRow"]!))),
    PartHeader: ($) => field("name", $["Identifier"]!),

    SectionSolidCard: ($) => seq("*SECTION_SOLID", repeat($["DataRow"]!)),
    SectionShellCard: ($) => seq("*SECTION_SHELL", repeat($["DataRow"]!)),
    SectionBeamCard: ($) => seq("*SECTION_BEAM", repeat($["DataRow"]!)),

    MatElasticCard: ($) => seq(choice("*MAT_ELASTIC", "*MAT_001"), repeat($["DataRow"]!)),
    MatPlasticKinematicCard: ($) => seq(choice("*MAT_PLASTIC_KINEMATIC", "*MAT_003"), repeat($["DataRow"]!)),
    MatRigidCard: ($) => seq(choice("*MAT_RIGID", "*MAT_020"), repeat($["DataRow"]!)),

    BoundarySpcNodeCard: ($) => seq("*BOUNDARY_SPC_NODE", repeat($["DataRow"]!)),
    BoundarySpcSetCard: ($) => seq("*BOUNDARY_SPC_SET", repeat($["DataRow"]!)),

    InitialVelocityCard: ($) => seq("*INITIAL_VELOCITY", repeat($["DataRow"]!)),
    LoadNodePointCard: ($) => seq("*LOAD_NODE_POINT", repeat($["DataRow"]!)),
    DefineCurveCard: ($) => seq("*DEFINE_CURVE", repeat($["DataRow"]!)),
    SetNodeListCard: ($) => seq("*SET_NODE_LIST", repeat($["DataRow"]!)),

    ControlTerminationCard: ($) => seq("*CONTROL_TERMINATION", repeat($["DataRow"]!)),
    ControlTimestepCard: ($) => seq("*CONTROL_TIMESTEP", repeat($["DataRow"]!)),
    DatabaseGlstatCard: ($) => seq("*DATABASE_GLSTAT", repeat($["DataRow"]!)),

    DataRow: ($) => seq($["NumberLiteral"]!, repeat(seq(optional(","), $["NumberLiteral"]!))),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Comment: () => /\$.*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInLsDynaLibrarySync();
