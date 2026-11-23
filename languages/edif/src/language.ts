// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInEdifLibrarySync } from "./catalog/library-package-adapter.js";
import { EdifErrorCode } from "./errors.js";
import { edifIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for EDIF 2.0.0
 * (Electronic Design Interchange Format, EIA-548 / IEC 61690-1).
 */
export const edifLanguage = language({
  name: "edif",
  fileExtensions: [".edf", ".edif", ".edn"],
  maturity: "beta",
  indexing: edifIndexing,
  lsp: {
    fileExtensions: [".edf", ".edif", ".edn"],
  },
  errorCodes: EdifErrorCode,

  rules: {
    EdifFile: ($) =>
      seq(
        "(",
        "edif",
        field("name", $["NameDef"]!),
        repeat(
          choice(
            $["EdifVersion"]!,
            $["EdifLevel"]!,
            $["KeywordMap"]!,
            $["Status"]!,
            $["External"]!,
            $["Library"]!,
            $["Design"]!,
            $["Property"]!,
            $["GenericForm"]!,
          ),
        ),
        ")",
      ),

    EdifVersion: ($) =>
      seq(
        "(",
        "edifVersion",
        field("major", $["NumberLiteral"]!),
        field("minor", $["NumberLiteral"]!),
        field("patch", $["NumberLiteral"]!),
        ")",
      ),

    EdifLevel: ($) => seq("(", "edifLevel", field("level", $["NumberLiteral"]!), ")"),

    KeywordMap: ($) => seq("(", "keywordMap", repeat($["GenericForm"]!), ")"),

    Status: ($) => seq("(", "status", repeat($["GenericForm"]!), ")"),

    External: ($) =>
      seq(
        "(",
        "external",
        field("name", $["NameDef"]!),
        repeat(choice($["EdifLevel"]!, $["Technology"]!, $["Cell"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    Library: ($) =>
      seq(
        "(",
        "library",
        field("name", $["NameDef"]!),
        repeat(choice($["EdifLevel"]!, $["Technology"]!, $["Cell"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    Technology: ($) => seq("(", "technology", repeat($["GenericForm"]!), ")"),

    Cell: ($) =>
      seq(
        "(",
        "cell",
        field("name", $["NameDef"]!),
        repeat(choice($["CellType"]!, $["View"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    CellType: ($) => seq("(", "cellType", field("type", $["Identifier"]!), ")"),

    View: ($) =>
      seq(
        "(",
        "view",
        field("name", $["NameDef"]!),
        repeat(choice($["ViewType"]!, $["Interface"]!, $["Contents"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    ViewType: ($) => seq("(", "viewType", field("type", $["Identifier"]!), ")"),

    Interface: ($) => seq("(", "interface", repeat(choice($["Port"]!, $["Property"]!, $["GenericForm"]!)), ")"),

    Port: ($) =>
      seq(
        "(",
        "port",
        field("name", $["NameDef"]!),
        repeat(choice($["Direction"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    Direction: ($) => seq("(", "direction", field("dir", $["Identifier"]!), ")"),

    Contents: ($) =>
      seq("(", "contents", repeat(choice($["Instance"]!, $["Net"]!, $["Property"]!, $["GenericForm"]!)), ")"),

    Instance: ($) =>
      seq(
        "(",
        "instance",
        field("name", $["NameDef"]!),
        repeat(choice($["ViewRef"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    ViewRef: ($) => seq("(", "viewRef", field("view", $["NameDef"]!), optional($["CellRef"]!), ")"),

    CellRef: ($) => seq("(", "cellRef", field("cell", $["NameDef"]!), optional($["LibraryRef"]!), ")"),

    LibraryRef: ($) => seq("(", "libraryRef", field("library", $["NameDef"]!), ")"),

    Net: ($) =>
      seq(
        "(",
        "net",
        field("name", $["NameDef"]!),
        repeat(choice($["Joined"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    Joined: ($) => seq("(", "joined", repeat($["PortRef"]!), ")"),

    PortRef: ($) => seq("(", "portRef", field("port", $["NameDef"]!), optional($["InstanceRef"]!), ")"),

    InstanceRef: ($) => seq("(", "instanceRef", field("instance", $["NameDef"]!), ")"),

    Property: ($) =>
      seq("(", "property", field("name", $["NameDef"]!), repeat(choice($["Atom"]!, $["GenericForm"]!)), ")"),

    Design: ($) =>
      seq(
        "(",
        "design",
        field("name", $["NameDef"]!),
        repeat(choice($["CellRef"]!, $["ViewRef"]!, $["Property"]!, $["GenericForm"]!)),
        ")",
      ),

    Rename: ($) => seq("(", "rename", field("id", $["Identifier"]!), field("original", $["StringLiteral"]!), ")"),

    NameDef: ($) => choice($["Identifier"]!, $["Rename"]!),

    GenericForm: ($) => seq("(", field("head", $["Identifier"]!), repeat(choice($["Atom"]!, $["GenericForm"]!)), ")"),

    Atom: ($) => choice($["Identifier"]!, $["NumberLiteral"]!, $["StringLiteral"]!),

    Identifier: () => /[A-Za-z_&][A-Za-z0-9_$-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInEdifLibrarySync();
