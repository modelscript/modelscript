// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Declarative WASM GLR Grammar & Language Registration.
 *
 * Covers both Wavefront OBJ (`.obj`) geometry directives (`v`, `vt`, `vn`, `vp`, `f`,
 * `l`, `p`, `o`, `g`, `s`, `mtllib`, `usemtl`, `#` comments) and companion Wavefront
 * MTL (`.mtl`) material directives (`newmtl`, `Ka`, `Kd`, `Ks`, `Ke`, `Ns`, `d`, `Tr`,
 * `Ni`, `illum`).
 */

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInObjLibrarySync } from "./catalog/library-package-adapter.js";
import { ObjErrorCode } from "./errors.js";
import { objIndexing } from "./indexing.js";

export const objLanguage = language({
  name: "obj",
  fileExtensions: [".obj", ".mtl"],
  maturity: "beta",
  indexing: objIndexing,
  lsp: {
    fileExtensions: [".obj", ".mtl"],
  },
  ui: {
    panels: [
      {
        id: "objEditor",
        viewType: "modelscript.objEditor",
        title: "Wavefront OBJ/MTL 3D Mesh & Material Viewer",
        shortTitle: "OBJ 3D",
        selector: ["*.obj", "*.mtl"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/ObjPanel.tsx",
        artifactViewTypes: ["obj", "mtl"],
      },
    ],
  },
  errorCodes: ObjErrorCode,
  extras: () => [/\s+/],

  rules: {
    ObjFile: ($) =>
      repeat(
        choice(
          $["VertexStatement"]!,
          $["TexCoordStatement"]!,
          $["NormalStatement"]!,
          $["ParamVertexStatement"]!,
          $["FaceStatement"]!,
          $["LineStatement"]!,
          $["PointStatement"]!,
          $["ObjectStatement"]!,
          $["GroupStatement"]!,
          $["SmoothingStatement"]!,
          $["MtlLibStatement"]!,
          $["UseMtlStatement"]!,
          $["NewMtlStatement"]!,
          $["MtlColorStatement"]!,
          $["MtlScalarStatement"]!,
          $["Comment"]!,
        ),
      ),

    // ── Wavefront OBJ Geometry Statements ────────────────────────────────
    VertexStatement: ($) =>
      seq(
        "v",
        field("x", $["NumberLiteral"]!),
        field("y", $["NumberLiteral"]!),
        field("z", $["NumberLiteral"]!),
        optional(field("w", $["NumberLiteral"]!)),
      ),

    TexCoordStatement: ($) =>
      seq(
        "vt",
        field("u", $["NumberLiteral"]!),
        optional(seq(field("v", $["NumberLiteral"]!), optional(field("w", $["NumberLiteral"]!)))),
      ),

    NormalStatement: ($) =>
      seq("vn", field("nx", $["NumberLiteral"]!), field("ny", $["NumberLiteral"]!), field("nz", $["NumberLiteral"]!)),

    ParamVertexStatement: ($) =>
      seq(
        "vp",
        field("u", $["NumberLiteral"]!),
        optional(seq(field("v", $["NumberLiteral"]!), optional(field("w", $["NumberLiteral"]!)))),
      ),

    FaceStatement: ($) =>
      seq("f", $["FaceVertexRef"]!, $["FaceVertexRef"]!, $["FaceVertexRef"]!, repeat($["FaceVertexRef"]!)),

    FaceVertexRef: ($) => choice($["FaceSlashRef"]!, $["IntegerLiteral"]!),

    LineStatement: ($) => seq("l", $["FaceVertexRef"]!, $["FaceVertexRef"]!, repeat($["FaceVertexRef"]!)),

    PointStatement: ($) => seq("p", $["IntegerLiteral"]!, repeat($["IntegerLiteral"]!)),

    ObjectStatement: ($) => seq("o", field("name", $["Identifier"]!)),

    GroupStatement: ($) => seq("g", field("name", $["Identifier"]!), repeat($["Identifier"]!)),

    SmoothingStatement: ($) => seq("s", field("group", choice("off", $["IntegerLiteral"]!))),

    MtlLibStatement: ($) => seq("mtllib", field("file", $["Identifier"]!), repeat($["Identifier"]!)),

    UseMtlStatement: ($) => seq("usemtl", field("material", $["Identifier"]!)),

    // ── Wavefront MTL Material Statements ────────────────────────────────
    NewMtlStatement: ($) => seq("newmtl", field("name", $["Identifier"]!)),

    MtlColorStatement: ($) =>
      seq(
        field("property", choice("Ka", "Kd", "Ks", "Ke")),
        field("r", $["NumberLiteral"]!),
        optional(seq(field("g", $["NumberLiteral"]!), field("b", $["NumberLiteral"]!))),
      ),

    MtlScalarStatement: ($) =>
      seq(field("property", choice("Ns", "d", "Tr", "Ni", "illum")), field("value", $["NumberLiteral"]!)),

    // ── Lexical Primitives ───────────────────────────────────────────────
    NumberLiteral: ($) => choice($["FloatLiteral"]!, $["IntegerLiteral"]!),
    FaceSlashRef: () => /[+-]?\d+\/(?:[+-]?\d+)?(?:\/[+-]?\d+)?/,
    FloatLiteral: () => /[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|[+-]?\d+[eE][+-]?\d+/,
    IntegerLiteral: () => /[+-]?\d+/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_./-]*/,
    Comment: () => /#[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInObjLibrarySync();
