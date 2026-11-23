// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInPlot3dLibrarySync } from "./catalog/library-package-adapter.js";
import { Plot3dErrorCode } from "./errors.js";
import { plot3dIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for NASA Ames PLOT3D
 * ASCII formatted structured grid (`.xyz`, `.g`), conservative solution (`.q`),
 * function (`.f`), and variable-name metadata (`.nam`) files.
 */
export const plot3dLanguage = language({
  name: "plot3d",
  fileExtensions: [".xyz", ".p3d", ".g", ".q", ".f", ".nam"],
  maturity: "beta",
  indexing: plot3dIndexing,
  lsp: {
    fileExtensions: [".xyz", ".p3d", ".g", ".q", ".f", ".nam"],
  },
  errorCodes: Plot3dErrorCode,
  extras: () => [/\s+/],

  rules: {
    Plot3dDocument: ($) => repeat(choice($["Comment"]!, $["RepeatValue"]!, $["NumberLiteral"]!, $["VariableName"]!)),

    RepeatValue: ($) => seq(field("count", $["NumberLiteral"]!), "*", field("value", $["NumberLiteral"]!)),

    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    VariableName: () => /[A-Za-z_][A-Za-z0-9_.\-/()]*/,
    Comment: () => /(?:#|!)[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInPlot3dLibrarySync();
