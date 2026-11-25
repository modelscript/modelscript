// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInJedecLibrarySync } from "./catalog/library-package-adapter.js";
import { JedecErrorCode } from "./errors.js";
import { jedecIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for JEDEC Standard 3 (JESD3)
 * Programmable Logic Device fuse-map and test-vector files (`.jed`, `.jedec`).
 */
export const jedecLanguage = language({
  name: "jedec",
  fileExtensions: [".jed", ".jedec"],
  maturity: "beta",
  indexing: jedecIndexing,
  lsp: {
    fileExtensions: [".jed", ".jedec"],
  },
  ui: {
    panels: [
      {
        id: "jedecEditor",
        viewType: "modelscript.jedecEditor",
        title: "JEDEC JESD3 PAL/GAL Fuse-Matrix Viewer",
        shortTitle: "JEDEC",
        selector: ["*.jed", "*.jedec"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/JedecPanel.tsx",
        artifactViewTypes: ["jedec", "jed"],
      },
    ],
  },

  errorCodes: JedecErrorCode,

  rules: {
    JedecFile: ($) =>
      seq(
        optional($["StxToken"]!),
        repeat(
          choice(
            $["PinCountField"]!,
            $["FuseCountField"]!,
            $["MaxVectorsField"]!,
            $["DefaultFuseField"]!,
            $["SecurityFuseField"]!,
            $["DefaultTestField"]!,
            $["FuseListField"]!,
            $["TestVectorField"]!,
            $["NoteField"]!,
            $["FuseChecksumField"]!,
          ),
        ),
        optional($["EtxChecksumToken"]!),
      ),

    PinCountField: ($) => field("pinCount", $["PinCountToken"]!),
    FuseCountField: ($) => field("fuseCount", $["FuseCountToken"]!),
    MaxVectorsField: ($) => field("maxVectors", $["MaxVectorsToken"]!),
    DefaultFuseField: ($) => field("defaultFuse", $["DefaultFuseToken"]!),
    SecurityFuseField: ($) => field("securityFuse", $["SecurityFuseToken"]!),
    DefaultTestField: ($) => field("defaultTest", $["DefaultTestToken"]!),
    FuseListField: ($) => field("fuseList", $["FuseListToken"]!),
    TestVectorField: ($) => field("testVector", $["TestVectorToken"]!),
    NoteField: ($) => field("note", $["NoteToken"]!),
    FuseChecksumField: ($) => field("checksum", $["FuseChecksumToken"]!),

    // eslint-disable-next-line no-control-regex
    StxToken: () => /\x02/,
    // eslint-disable-next-line no-control-regex
    EtxChecksumToken: () => /\x03[0-9A-Fa-f]{0,4}/,
    PinCountToken: () => /QP\d+\*/,
    FuseCountToken: () => /QF\d+\*/,
    MaxVectorsToken: () => /QV\d+\*/,
    DefaultFuseToken: () => /F[01]\*/,
    SecurityFuseToken: () => /G[01]\*/,
    DefaultTestToken: () => /X[01]\*/,
    FuseChecksumToken: () => /C[0-9A-Fa-f]{1,4}\*/,
    NoteToken: () => /N[^*]*\*/,
    FuseListToken: () => /L\d+[ \t\r\n]+[01 \t\r\n]*\*/,
    TestVectorToken: () => /V\d+[ \t]+[01CKHLXZNFPBckhlxznfpb]+\*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInJedecLibrarySync();
