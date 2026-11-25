// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInStlLibrarySync } from "./catalog/library-package-adapter.js";
import { StlErrorCode } from "./errors.js";
import { stlIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for 3D Systems ASCII STL (`.stl`).
 */
export const stlLanguage = language({
  name: "stl",
  fileExtensions: [".stl"],
  maturity: "beta",
  indexing: stlIndexing,
  lsp: {
    fileExtensions: [".stl"],
  },
  ui: {
    panels: [
      {
        id: "stlViewer",
        viewType: "modelscript.stlViewer",
        title: "STL 3D Mesh Viewer & Manifold Inspector",
        shortTitle: "STL 3D",
        selector: ["*.stl"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/StlPanel.tsx",
        artifactViewTypes: ["stl", "mesh"],
      },
    ],
  },

  errorCodes: StlErrorCode,

  rules: {
    StlFile: ($) => repeat($["SolidBlock"]!),

    SolidBlock: ($) =>
      seq(
        "solid",
        optional(field("name", $["Identifier"]!)),
        repeat($["FacetBlock"]!),
        "endsolid",
        optional(field("endName", $["Identifier"]!)),
      ),

    FacetBlock: ($) =>
      seq(
        "facet",
        "normal",
        field("nx", $["NumberLiteral"]!),
        field("ny", $["NumberLiteral"]!),
        field("nz", $["NumberLiteral"]!),
        $["OuterLoop"]!,
        "endfacet",
      ),

    OuterLoop: ($) =>
      seq(
        "outer",
        "loop",
        field("v0", $["VertexLine"]!),
        field("v1", $["VertexLine"]!),
        field("v2", $["VertexLine"]!),
        "endloop",
      ),

    VertexLine: ($) =>
      seq("vertex", field("x", $["NumberLiteral"]!), field("y", $["NumberLiteral"]!), field("z", $["NumberLiteral"]!)),

    NumberLiteral: () => /[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
    Whitespace: () => choice(/[ \t\r\n]+/, /#[^\r\n]*/),
  },
});

registerBuiltInStlLibrarySync();
