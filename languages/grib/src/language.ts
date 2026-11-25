// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Formal DSL Language Specification & WASM GLR Grammar.
 *
 * Defines the declarative `@modelscript/dsl` grammar for textual WMO GRIB Edition 1
 * descriptor dumps (`GRIB`, `IS`, `PDS`, `GDS`, `BMS`, `BDS`, `7777`), enabling
 * compilation into native WebAssembly GLR parse tables (`dist/parser.wasm`).
 */

import { choice, field, language, optional, repeat, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInGribLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerGribToDae } from "./dae/grib-to-dae.js";
import { renderGribMapSvg } from "./diagram/grib-map.js";
import { GribErrorCode } from "./errors.js";
import { gribIndexing } from "./indexing.js";
import { lintGribDocument } from "./lints/index.js";
import { parseGribDescriptor } from "./parser/text-parser.js";
import { gribToNetCdfCdl } from "./projections/grib-to-cdl.js";
import { gribToCsv } from "./projections/grib-to-csv.js";

registerBuiltInGribLibrarySync();

export const gribLanguage = language({
  name: "grib",
  fileExtensions: [".grb", ".grib", ".grib1"],
  maturity: "beta",
  indexing: gribIndexing,
  lsp: {
    fileExtensions: [".grb", ".grib", ".grib1"],
    outline: ["GribMessage", "IndicatorSection", "PdsSection", "GdsSection", "BmsSection", "BdsSection"],
  },
  ui: {
    panels: [
      {
        id: "gribViewer",
        viewType: "modelscript.gribViewer",
        title: "WMO GRIB Edition 1 Geographic Viewer & Editor",
        shortTitle: "GRIB1",
        selector: ["*.grb", "*.grib", "*.grib1"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/GribPanel.tsx",
        artifactViewTypes: ["grib", "grib1", "grb"],
      },
    ],
  },
  errorCodes: GribErrorCode,
  extras: () => [/[ \t\r\n]+/, /#[^\r\n]*/, /\/\/[^\r\n]*/],

  rules: {
    GribDocument: ($) => repeat($["GribMessage"]!),

    GribMessage: ($) =>
      seq(
        $["GribHeader"]!,
        repeat(choice($["IndicatorSection"]!, $["PdsSection"]!, $["GdsSection"]!, $["BmsSection"]!, $["BdsSection"]!)),
        optional($["EndSection"]!),
      ),

    GribHeader: ($) => seq("GRIB", repeat($["Attribute"]!)),

    IndicatorSection: ($) => seq("IS", "{", repeat($["Attribute"]!), "}"),
    PdsSection: ($) => seq("PDS", "{", repeat($["Attribute"]!), "}"),
    GdsSection: ($) => seq("GDS", "{", repeat($["Attribute"]!), "}"),
    BmsSection: ($) => seq("BMS", "{", repeat($["Attribute"]!), "}"),
    BdsSection: ($) => seq("BDS", "{", repeat($["Attribute"]!), "}"),

    EndSection: () => "7777",

    Attribute: ($) =>
      seq(field("key", $["Identifier"]!), choice("=", ":"), field("value", $["Value"]!), optional(choice(",", ";"))),

    Value: ($) => choice($["ArrayLiteral"]!, $["StringLiteral"]!, $["NumberLiteral"]!, $["Identifier"]!),

    ArrayLiteral: ($) =>
      seq("[", optional(seq($["NumberLiteral"]!, repeat(seq(optional(","), $["NumberLiteral"]!)))), "]"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
  },

  actions: [
    {
      id: "grib_lint",
      title: "Lint WMO GRIB Edition 1 Descriptor",
      description: "Validates GRIB1 headers, 7777 trailers, PDS date/parameters, GDS bounds, and BDS bit-width.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseGribDescriptor(context.documentText || "", context["documentUri"] as string | undefined);
        return lintGribDocument(doc);
      },
    },
    {
      id: "grib_to_dae",
      title: "Lower GRIB1 Atmospheric Balance to DAE Arena",
      description: "Emits hydrostatic and geostrophic balance primitive equations directly into DAEBuilder.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseGribDescriptor(context.documentText || "", context["documentUri"] as string | undefined);
        const arena = lowerGribToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "grib_to_cdl",
      title: "Export GRIB1 to NetCDF CDL",
      description: "Projects GRIB1 gridded meteorological fields to CF-1.8 NetCDF CDL.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseGribDescriptor(context.documentText || "", context["documentUri"] as string | undefined);
        return gribToNetCdfCdl(doc);
      },
    },
    {
      id: "grib_to_csv",
      title: "Export GRIB1 Grid to CSV",
      description: "Projects GRIB1 lat/lon grid points and physical values to CSV.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseGribDescriptor(context.documentText || "", context["documentUri"] as string | undefined);
        return gribToCsv(doc);
      },
    },
    {
      id: "grib_to_svg",
      title: "Render GRIB1 Geographic Heatmap SVG",
      description: "Generates a pure SVG geographic scalar heatmap with isobars and wind barbs.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseGribDescriptor(context.documentText || "", context["documentUri"] as string | undefined);
        return renderGribMapSvg(doc);
      },
    },
  ],
});
