// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInDxfLibrarySync } from "./catalog/library-package-adapter.js";
import { DxfErrorCode } from "./errors.js";
import { dxfIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for AutoCAD DXF (.dxf).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm`) supporting
 * DXF group-code/value pairs across `HEADER`, `TABLES` (`LAYER`), `BLOCKS`
 * (`BLOCK`/`ENDBLK`), `ENTITIES` (`LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE`,
 * `POLYLINE`/`VERTEX`/`SEQEND`, `SPLINE`, `ELLIPSE`, `3DFACE`, `POINT`, `TEXT`,
 * `INSERT`), `OBJECTS`, and `EOF`.
 */
export const dxfLanguage = language({
  name: "dxf",
  fileExtensions: [".dxf"],
  maturity: "beta",
  indexing: dxfIndexing,
  lsp: {
    fileExtensions: [".dxf"],
  },
  errorCodes: DxfErrorCode,

  extras: () => [/\s+/],

  conflicts: ($) => [
    [$["EntityRecord"]!, $["GroupCode"]!, $["NonZeroCode"]!],
    [$["LayerRecord"]!, $["GroupCode"]!, $["NonZeroCode"]!],
    [$["BlockDef"]!, $["GroupCode"]!, $["NonZeroCode"]!],
    [$["PolylineSequence"]!, $["GroupCode"]!, $["NonZeroCode"]!],
  ],

  rules: {
    Document: ($) => seq(repeat($["Section"]!), optional($["EofMarker"]!)),

    EofMarker: () => seq("0", "EOF"),

    Section: ($) =>
      seq("0", "SECTION", "2", field("name", $["SectionName"]!), repeat($["SectionItem"]!), "0", "ENDSEC"),

    SectionName: () => choice("HEADER", "CLASSES", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS", "THUMBNAILIMAGE"),

    SectionItem: ($) =>
      choice($["TableBlock"]!, $["BlockDef"]!, $["PolylineSequence"]!, $["EntityRecord"]!, $["GroupPair"]!),

    TableBlock: ($) => seq("0", "TABLE", repeat(choice($["LayerRecord"]!, $["GroupPair"]!)), "0", "ENDTAB"),

    LayerRecord: ($) => seq("0", "LAYER", repeat($["GroupPair"]!)),

    BlockDef: ($) =>
      seq(
        "0",
        "BLOCK",
        repeat($["GroupPair"]!),
        repeat(choice($["PolylineSequence"]!, $["EntityRecord"]!)),
        "0",
        "ENDBLK",
        repeat($["GroupPair"]!),
      ),

    PolylineSequence: ($) =>
      seq("0", "POLYLINE", repeat($["GroupPair"]!), repeat($["VertexRecord"]!), "0", "SEQEND", repeat($["GroupPair"]!)),

    VertexRecord: ($) => seq("0", "VERTEX", repeat($["GroupPair"]!)),

    EntityRecord: ($) => seq("0", field("entityType", $["EntityType"]!), repeat($["GroupPair"]!)),

    EntityType: () =>
      choice("LINE", "ARC", "CIRCLE", "LWPOLYLINE", "SPLINE", "ELLIPSE", "3DFACE", "POINT", "TEXT", "MTEXT", "INSERT"),

    GroupPair: ($) => seq(field("code", $["GroupCode"]!), field("value", $["GroupValue"]!)),

    GroupCode: ($) => choice("2", $["NonZeroCode"]!),

    GroupValue: ($) =>
      choice(
        "0",
        "2",
        $["NonZeroCode"]!,
        $["FloatLiteral"]!,
        $["HeaderVarName"]!,
        $["SectionName"]!,
        $["EntityType"]!,
        "LAYER",
        $["Identifier"]!,
      ),

    NonZeroCode: () => /-?[1-9][0-9]*/,
    FloatLiteral: () => /[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|[+-]?\d+[eE][+-]?\d+/,
    HeaderVarName: () => /\$[A-Za-z_][A-Za-z0-9_]*/,
    Identifier: () => /[A-Za-z_*][A-Za-z0-9_.\-/]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInDxfLibrarySync();
