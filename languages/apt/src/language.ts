// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInAptLibrarySync } from "./catalog/library-package-adapter.js";
import { AptErrorCode } from "./errors.js";
import { aptIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for APT
 * (Automatically Programmed Tools, MIT 1957–1960s / ISO 4342).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm`) supporting
 * `PARTNO`, postprocessor directives (`MACHIN`, `UNITS`, `INTOL`, `OUTTOL`,
 * `CUTTER`, `SPINDL`, `FEDRAT`, `COOLNT`, `RAPID`, `FINI`), canonical geometry
 * definitions (`POINT`, `LINE`, `CIRCLE`, `PLANE`, `PATERN`), continuous-path
 * and point-to-point motion statements (`FROM`, `GOTO`, `GODLTA`, `GO`,
 * `GOLFT`, `GORGT`, `GOFWD`, `GOBACK`, `GOUP`, `GODOWN`), `$` line continuations,
 * and `$$` comments.
 */
export const aptLanguage = language({
  name: "apt",
  fileExtensions: [".apt", ".aptsource", ".cls"],
  maturity: "beta",
  indexing: aptIndexing,
  lsp: {
    fileExtensions: [".apt", ".aptsource", ".cls"],
  },
  errorCodes: AptErrorCode,
  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!, $["Continuation"]!],

  rules: {
    Program: ($) => repeat(choice($["PartnoStmt"]!, $["GeometryDef"]!, $["CommandStmt"]!, $["BareKeyword"]!)),

    GeometryDef: ($) =>
      seq(field("label", $["Identifier"]!), "=", field("kind", $["GeometryKind"]!), "/", $["ArgList"]!),

    CommandStmt: ($) => seq(field("keyword", $["CommandKeyword"]!), "/", $["ArgList"]!),

    ArgList: ($) => seq($["Arg"]!, repeat(seq(",", $["Arg"]!))),

    Arg: ($) =>
      choice($["NestedExpr"]!, $["NumberLiteral"]!, $["ModifierKeyword"]!, $["GeometryKind"]!, $["Identifier"]!),

    NestedExpr: ($) => seq("(", choice(seq($["GeometryKind"]!, "/", $["ArgList"]!), $["ArgList"]!), ")"),

    GeometryKind: () => choice("POINT", "LINE", "CIRCLE", "PLANE", "PATERN"),

    CommandKeyword: () =>
      choice(
        "MACHIN",
        "UNITS",
        "INTOL",
        "OUTTOL",
        "CUTTER",
        "SPINDL",
        "FEDRAT",
        "COOLNT",
        "FROM",
        "GOTO",
        "GODLTA",
        "GO",
        "GOLFT",
        "GORGT",
        "GOFWD",
        "GOBACK",
        "GOUP",
        "GODOWN",
      ),

    BareKeyword: () => choice("RAPID", "FINI"),

    ModifierKeyword: () =>
      choice(
        "TO",
        "ON",
        "PAST",
        "TANTO",
        "CENTER",
        "RADIUS",
        "INTOF",
        "ATANGL",
        "PARLEL",
        "PERPTO",
        "XLARGE",
        "XSMALL",
        "YLARGE",
        "YSMALL",
        "LARGE",
        "SMALL",
        "LEFT",
        "RIGHT",
        "LINEAR",
        "ARC",
        "CLW",
        "CCLW",
        "OFF",
        "FLOOD",
        "MIST",
        "INCHES",
        "MM",
      ),

    PartnoStmt: () => /PARTNO[^\r\n]*/,
    Comment: () => /\$\$[^\r\n]*/,
    Continuation: () => "$",
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInAptLibrarySync();
