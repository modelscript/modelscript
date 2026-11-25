// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInNmea0183LibrarySync } from "./catalog/library-package-adapter.js";
import { Nmea0183ErrorCode } from "./errors.js";
import { nmea0183Indexing } from "./indexing.js";

/**
 * DSL language specification for NMEA 0183 (.nmea, .nme, .gps, .log).
 */
export const nmea0183Language = language({
  name: "nmea0183",
  fileExtensions: [".nmea", ".nme", ".gps", ".log"],
  maturity: "beta",
  indexing: nmea0183Indexing,
  lsp: {
    fileExtensions: [".nmea", ".nme", ".gps", ".log"],
  },
  ui: {
    panels: [
      {
        id: "nmea0183Viewer",
        viewType: "modelscript.nmea0183Viewer",
        title: "NMEA 0183 GPS Track & Satellite Skyplot",
        shortTitle: "NMEA 0183",
        selector: ["*.nmea", "*.nme", "*.gps"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/Nmea0183Panel.tsx",
        artifactViewTypes: ["nmea0183", "nmea", "gps"],
      },
    ],
  },

  errorCodes: Nmea0183ErrorCode,

  rules: {
    Stream: ($) => repeat(choice($["Sentence"]!, $["Comment"]!)),

    Sentence: ($) =>
      seq(field("header", $["SentenceHeader"]!), repeat($["FieldEntry"]!), optional(field("checksum", $["Checksum"]!))),

    FieldEntry: ($) => seq(",", optional(field("value", $["FieldValue"]!))),

    SentenceHeader: () => /[$!][A-Z]{2}[A-Z0-9]{3}/,

    Checksum: () => /\*[0-9A-Fa-f]{2}/,

    FieldValue: () => /[^,*\r\n$!#\s]+/,

    Comment: () => /#[^\r\n]*/,
  },
});

registerBuiltInNmea0183LibrarySync();
