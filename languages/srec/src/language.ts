// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat } from "@modelscript/dsl";
import { registerBuiltInSrecLibrarySync } from "./catalog/library-package-adapter.js";
import { SrecErrorCode } from "./errors.js";
import { srecIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for Motorola S-Record
 * (`.srec`, `.s19`, `.s28`, `.s37`, `.mot`, `.sre`, `.sx`).
 *
 * Compiles directly to a native WebAssembly GLR parser (`dist/parser.wasm`).
 */
export const srecLanguage = language({
  name: "srec",
  fileExtensions: [".srec", ".s19", ".s28", ".s37", ".mot", ".sre", ".sx"],
  maturity: "beta",
  indexing: srecIndexing,
  lsp: {
    fileExtensions: [".srec", ".s19", ".s28", ".s37", ".mot", ".sre", ".sx"],
  },
  ui: {
    panels: [
      {
        id: "srecViewer",
        viewType: "modelscript.srecViewer",
        title: "Motorola S-Record Memory Map & Hex Viewer",
        shortTitle: "SREC",
        selector: ["*.srec", "*.s19", "*.s28", "*.s37", "*.mot"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/SrecPanel.tsx",
        artifactViewTypes: ["srec", "s19", "s28", "s37", "mot"],
      },
    ],
  },

  errorCodes: SrecErrorCode,

  rules: {
    SrecFile: ($) => repeat($["Record"]!),

    Record: ($) =>
      choice(
        $["HeaderRecord"]!,
        $["Data16Record"]!,
        $["Data24Record"]!,
        $["Data32Record"]!,
        $["ReservedRecord"]!,
        $["Count16Record"]!,
        $["Count24Record"]!,
        $["Start32Record"]!,
        $["Start24Record"]!,
        $["Start16Record"]!,
      ),

    HeaderRecord: ($) => field("record", $["S0Token"]!),
    Data16Record: ($) => field("record", $["S1Token"]!),
    Data24Record: ($) => field("record", $["S2Token"]!),
    Data32Record: ($) => field("record", $["S3Token"]!),
    ReservedRecord: ($) => field("record", $["S4Token"]!),
    Count16Record: ($) => field("record", $["S5Token"]!),
    Count24Record: ($) => field("record", $["S6Token"]!),
    Start32Record: ($) => field("record", $["S7Token"]!),
    Start24Record: ($) => field("record", $["S8Token"]!),
    Start16Record: ($) => field("record", $["S9Token"]!),

    // Motorola S-Record lexical tokens: S<type><count:2hex><addr:4|6|8hex><data:2n hex><checksum:2hex>
    S0Token: () => /S0[0-9A-Fa-f]{8,}/,
    S1Token: () => /S1[0-9A-Fa-f]{8,}/,
    S2Token: () => /S2[0-9A-Fa-f]{10,}/,
    S3Token: () => /S3[0-9A-Fa-f]{12,}/,
    S4Token: () => /S4[0-9A-Fa-f]{8,}/,
    S5Token: () => /S5[0-9A-Fa-f]{8}/,
    S6Token: () => /S6[0-9A-Fa-f]{10}/,
    S7Token: () => /S7[0-9A-Fa-f]{12}/,
    S8Token: () => /S8[0-9A-Fa-f]{10}/,
    S9Token: () => /S9[0-9A-Fa-f]{8}/,
  },

  extras: () => [/\s+/],
});

// Zero-I/O self-registration of `@modelscript/srec-std-lib` when this language module is imported.
registerBuiltInSrecLibrarySync();

export default srecLanguage;
