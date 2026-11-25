// SPDX-License-Identifier: AGPL-3.0-or-later

import { field, language, repeat, repeat1, seq } from "@modelscript/dsl";
import { registerBuiltInIhexLibrarySync } from "./catalog/library-package-adapter.js";
import { IhexErrorCode } from "./errors.js";
import { ihexIndexing } from "./indexing.js";

/**
 * DSL language specification for Intel HEX (.hex, .ihx, .ihex, .h86, .mcs).
 *
 * Record frame grammar:
 *   `:` `LL` `AAAA` `TT` `[DD...]` `CC`
 * where every 2-hex-digit octet is tokenized as `HexByte` (`/[0-9A-Fa-f][0-9A-Fa-f]/`)
 * to guarantee conflict-free O(n) WASM GLR parsing across all record types `00`–`05`.
 */
export const ihexLanguage = language({
  name: "ihex",
  fileExtensions: [".hex", ".ihx", ".ihex", ".h86", ".mcs"],
  maturity: "beta",
  indexing: ihexIndexing,
  lsp: {
    fileExtensions: [".hex", ".ihx", ".ihex", ".h86", ".mcs"],
  },
  ui: {
    panels: [
      {
        id: "ihexEditor",
        viewType: "modelscript.ihexEditor",
        title: "Intel HEX Memory Map & Hex Viewer",
        shortTitle: "Intel HEX",
        selector: ["*.hex", "*.ihx", "*.ihex", "*.h86", "*.mcs"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/IhexPanel.tsx",
        artifactViewTypes: ["ihex", "hex", "ihx"],
      },
    ],
  },

  errorCodes: IhexErrorCode,
  extras: () => [/\s+/],

  rules: {
    Document: ($) => repeat($["Record"]!),

    Record: ($) =>
      seq(
        ":",
        field("byteCount", $["HexByte"]!),
        field("address", $["AddressWord"]!),
        field("recordType", $["HexByte"]!),
        field("payloadAndChecksum", repeat1($["HexByte"]!)),
      ),

    AddressWord: ($) => seq($["HexByte"]!, $["HexByte"]!),

    HexByte: () => /[0-9A-Fa-f][0-9A-Fa-f]/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInIhexLibrarySync();
