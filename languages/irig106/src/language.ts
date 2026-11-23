// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInIrig106LibrarySync } from "./catalog/library-package-adapter.js";
import { Irig106ErrorCode } from "./errors.js";
import { irig106Indexing } from "./indexing.js";

/**
 * DSL language specification for IRIG 106 Chapter 9 TMATS (.tmats, .tmt, .tma).
 */
export const irig106Language = language({
  name: "irig106",
  fileExtensions: [".tmats", ".tmt", ".tma"],
  maturity: "beta",
  indexing: irig106Indexing,
  lsp: {
    fileExtensions: [".tmats", ".tmt", ".tma"],
  },
  ui: {
    panels: [
      {
        id: "irig106Editor",
        viewType: "modelscript.irig106Editor",
        title: "IRIG 106 TMATS PCM Commutator & Telemetry Viewer",
        shortTitle: "IRIG 106",
        selector: ["*.tmats", "*.tmt", "*.tma"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/Irig106Panel.tsx",
        artifactViewTypes: ["irig106", "tmats"],
      },
    ],
  },

  errorCodes: Irig106ErrorCode,

  rules: {
    TmatsFile: ($) =>
      repeat(choice($["GeneralAttribute"]!, $["GroupAttribute"]!, $["CommentAttribute"]!, $["LineComment"]!)),

    GeneralAttribute: ($) => seq("G\\", field("subCode", $["SubCode"]!), ":", field("value", $["ValueExpr"]!), ";"),

    GroupAttribute: ($) =>
      seq(
        field("group", $["GroupPrefix"]!),
        field("subCode", $["SubCode"]!),
        ":",
        field("value", $["ValueExpr"]!),
        ";",
      ),

    CommentAttribute: ($) => seq("COMMENT", ":", field("text", $["ValueExpr"]!), ";"),

    SubCode: ($) => seq($["CodeAtom"]!, repeat(seq("\\", $["CodeAtom"]!))),

    ValueExpr: ($) => repeat(choice($["CodeAtom"]!, "COMMENT", "/", "+", ",", "(", ")", "%", "=", "*", "\\")),

    GroupPrefix: () => /[TMPDCRBSVH]-\d+\\/,
    CodeAtom: () => /[A-Za-z0-9_.-]+/,
    LineComment: () => /(?:\/\/[^\r\n]*|#[^\r\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInIrig106LibrarySync();
