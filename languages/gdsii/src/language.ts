// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInGdsiiLibrarySync } from "./catalog/library-package-adapter.js";
import { GdsiiErrorCode } from "./errors.js";
import { gdsiiIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for GDSII GDT / ASCII Stream Format.
 */
export const gdsiiLanguage = language({
  name: "gdsii",
  fileExtensions: [".gds", ".gds2", ".gdsii", ".gdt"],
  maturity: "beta",
  indexing: gdsiiIndexing,
  lsp: {
    fileExtensions: [".gds", ".gds2", ".gdsii", ".gdt"],
  },
  errorCodes: GdsiiErrorCode,

  rules: {
    Library: ($) =>
      seq(
        optional($["HeaderRecord"]!),
        optional($["BgnlibRecord"]!),
        optional($["LibnameRecord"]!),
        optional($["UnitsRecord"]!),
        repeat(choice($["Structure"]!, $["Comment"]!)),
        optional("ENDLIB"),
      ),

    HeaderRecord: ($) => seq("HEADER", field("version", $["NumberLiteral"]!)),

    BgnlibRecord: ($) => seq("BGNLIB", repeat($["NumberLiteral"]!)),

    LibnameRecord: ($) => seq("LIBNAME", field("name", choice($["Identifier"]!, $["StringLiteral"]!))),

    UnitsRecord: ($) =>
      seq("UNITS", field("dbUnitInUserUnits", $["NumberLiteral"]!), field("dbUnitInMeters", $["NumberLiteral"]!)),

    Structure: ($) =>
      seq(
        "BGNSTR",
        repeat($["NumberLiteral"]!),
        optional($["StrnameRecord"]!),
        repeat(choice($["Element"]!, $["Comment"]!)),
        "ENDSTR",
      ),

    StrnameRecord: ($) => seq("STRNAME", field("name", choice($["Identifier"]!, $["StringLiteral"]!))),

    Element: ($) =>
      choice($["BoundaryElement"]!, $["PathElement"]!, $["SrefElement"]!, $["ArefElement"]!, $["TextElement"]!),

    BoundaryElement: ($) =>
      seq("BOUNDARY", repeat(choice($["LayerRecord"]!, $["DatatypeRecord"]!, $["XyRecord"]!)), "ENDEL"),

    PathElement: ($) =>
      seq(
        "PATH",
        repeat(
          choice($["LayerRecord"]!, $["DatatypeRecord"]!, $["PathtypeRecord"]!, $["WidthRecord"]!, $["XyRecord"]!),
        ),
        "ENDEL",
      ),

    SrefElement: ($) =>
      seq(
        "SREF",
        repeat(choice($["SnameRecord"]!, $["StransRecord"]!, $["MagRecord"]!, $["AngleRecord"]!, $["XyRecord"]!)),
        "ENDEL",
      ),

    ArefElement: ($) =>
      seq(
        "AREF",
        repeat(
          choice(
            $["SnameRecord"]!,
            $["StransRecord"]!,
            $["MagRecord"]!,
            $["AngleRecord"]!,
            $["ColrowRecord"]!,
            $["XyRecord"]!,
          ),
        ),
        "ENDEL",
      ),

    TextElement: ($) =>
      seq(
        "TEXT",
        repeat(
          choice(
            $["LayerRecord"]!,
            $["TexttypeRecord"]!,
            $["StransRecord"]!,
            $["MagRecord"]!,
            $["AngleRecord"]!,
            $["XyRecord"]!,
            $["StringRecord"]!,
          ),
        ),
        "ENDEL",
      ),

    LayerRecord: ($) => seq("LAYER", field("layer", $["NumberLiteral"]!)),
    DatatypeRecord: ($) => seq("DATATYPE", field("datatype", $["NumberLiteral"]!)),
    TexttypeRecord: ($) => seq("TEXTTYPE", field("texttype", $["NumberLiteral"]!)),
    PathtypeRecord: ($) => seq("PATHTYPE", field("pathtype", $["NumberLiteral"]!)),
    WidthRecord: ($) => seq("WIDTH", field("width", $["NumberLiteral"]!)),
    SnameRecord: ($) => seq("SNAME", field("sname", choice($["Identifier"]!, $["StringLiteral"]!))),
    StransRecord: ($) => seq("STRANS", field("flags", $["NumberLiteral"]!)),
    MagRecord: ($) => seq("MAG", field("mag", $["NumberLiteral"]!)),
    AngleRecord: ($) => seq("ANGLE", field("angle", $["NumberLiteral"]!)),
    ColrowRecord: ($) => seq("COLROW", field("columns", $["NumberLiteral"]!), field("rows", $["NumberLiteral"]!)),
    StringRecord: ($) => seq("STRING", field("text", choice($["StringLiteral"]!, $["Identifier"]!))),
    XyRecord: ($) => seq("XY", repeat($["CoordPair"]!)),
    CoordPair: ($) => seq($["NumberLiteral"]!, optional(choice(":", ",")), $["NumberLiteral"]!),

    Identifier: () => /[A-Za-z_$][A-Za-z0-9_$.-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:#|\/\/)[^\r\n]*/,
  },
});

registerBuiltInGdsiiLibrarySync();
