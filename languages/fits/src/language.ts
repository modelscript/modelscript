// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Formal DSL Language Specification & WASM GLR Grammar.
 *
 * Defines the declarative `@modelscript/dsl` grammar for FITS 4.0 80-character
 * header keyword cards (`SIMPLE`, `BITPIX`, `NAXIS`, `NAXIS1`/`NAXIS2`, `EXTEND`,
 * `XTENSION`, `PCOUNT`, `GCOUNT`, `BSCALE`, `BZERO`, `TFIELDS`, `TTYPE`, `TFORM`,
 * `CRVAL`, `CRPIX`, `CDELT`, `CTYPE`, `CD1_1`..`CD2_2`, `HISTORY`, `COMMENT`, `END`),
 * enabling compilation into native WebAssembly GLR parse tables (`dist/parser.wasm`).
 */

import { choice, field, language, optional, repeat, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInFitsLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerFitsToDae } from "./dae/fits-to-dae.js";
import { FitsErrorCode } from "./errors.js";
import { fitsIndexing } from "./indexing.js";
import { lintFitsDocument } from "./lints/index.js";
import { parseFitsHeaderText } from "./parser/header-parser.js";
import { fitsToCcsdsMetadata, fitsToCsv, fitsToJsonMetadata, fitsToSvg } from "./projections/index.js";

registerBuiltInFitsLibrarySync();

export const fitsLanguage = language({
  name: "fits",
  fileExtensions: [".fits", ".fit", ".fts", ".hdr"],
  maturity: "beta",
  indexing: fitsIndexing,
  lsp: {
    fileExtensions: [".fits", ".fit", ".fts", ".hdr"],
    outline: ["HduHeader", "MandatoryCard", "WcsCard", "EndCard"],
  },
  errorCodes: FitsErrorCode,
  extras: () => [/[ \t\r\n]+/],

  rules: {
    FitsDocument: ($) => repeat($["HduHeader"]!),

    HduHeader: ($) =>
      seq(
        repeat(
          choice(
            $["MandatoryCard"]!,
            $["WcsCard"]!,
            $["TableCard"]!,
            $["ScalingCard"]!,
            $["HistoryCard"]!,
            $["CommentCard"]!,
            $["GenericKeywordCard"]!,
          ),
        ),
        $["EndCard"]!,
      ),

    MandatoryCard: ($) =>
      seq(
        field(
          "keyword",
          choice("SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2", "EXTEND", "XTENSION", "PCOUNT", "GCOUNT"),
        ),
        "=",
        field("value", $["CardValue"]!),
        optional($["InlineComment"]!),
      ),

    ScalingCard: ($) =>
      seq(
        field("keyword", choice("BSCALE", "BZERO")),
        "=",
        field("value", $["NumberLiteral"]!),
        optional($["InlineComment"]!),
      ),

    TableCard: ($) =>
      seq(
        field("keyword", choice("TFIELDS", $["IndexedTableKeyword"]!)),
        "=",
        field("value", $["CardValue"]!),
        optional($["InlineComment"]!),
      ),

    WcsCard: ($) =>
      seq(
        field(
          "keyword",
          choice(
            "CRVAL1",
            "CRVAL2",
            "CRPIX1",
            "CRPIX2",
            "CDELT1",
            "CDELT2",
            "CTYPE1",
            "CTYPE2",
            "CD1_1",
            "CD1_2",
            "CD2_1",
            "CD2_2",
            "CRVAL",
            "CRPIX",
            "CDELT",
            "CTYPE",
          ),
        ),
        "=",
        field("value", $["CardValue"]!),
        optional($["InlineComment"]!),
      ),

    GenericKeywordCard: ($) =>
      seq(
        field("keyword", $["KeywordIdentifier"]!),
        "=",
        field("value", $["CardValue"]!),
        optional($["InlineComment"]!),
      ),

    HistoryCard: ($) => seq("HISTORY", optional(field("text", $["CommentaryText"]!))),

    CommentCard: ($) => seq("COMMENT", optional(field("text", $["CommentaryText"]!))),

    EndCard: () => "END",

    CardValue: ($) => choice($["BooleanLiteral"]!, $["NumberLiteral"]!, $["StringLiteral"]!),

    InlineComment: () => /\/[^\r\n]*/,
    CommentaryText: () => /[^\r\n]+/,
    IndexedTableKeyword: () => /(?:TTYPE|TFORM|TUNIT|TBCOL|TSCAL|TZERO)[0-9]+/,
    KeywordIdentifier: () => /[A-Z][A-Z0-9_-]{0,7}/,
    BooleanLiteral: () => /[TF]/,
    NumberLiteral: () => /[-+]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eEdD][-+]?[0-9]+)?/,
    StringLiteral: () => /'(?:''|[^'\r\n])*'/,
  },

  actions: [
    {
      id: "fits_lint",
      title: "Lint FITS 4.0 Header & WCS",
      description: "Validates mandatory keywords, BITPIX/NAXIS consistency, 2880-byte framing, and WCS projections.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseFitsHeaderText(context.documentText || "", context["documentUri"] as string | undefined);
        return lintFitsDocument(doc);
      },
    },
    {
      id: "fits_to_dae",
      title: "Lower FITS Photometry & Radiative Transfer to DAE Arena",
      description:
        "Emits BSCALE/BZERO physical calibration and Beer-Lambert radiative transfer equations into DAEBuilder.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseFitsHeaderText(context.documentText || "", context["documentUri"] as string | undefined);
        const arena = lowerFitsToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "fits_to_csv",
      title: "Export FITS HDU to CSV",
      description: "Projects FITS tables, 2D pixel grids with WCS, or header cards to CSV.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseFitsHeaderText(context.documentText || "", context["documentUri"] as string | undefined);
        return fitsToCsv(doc);
      },
    },
    {
      id: "fits_to_json",
      title: "Export FITS Metadata to JSON",
      description: "Extracts structured JSON metadata, WCS parameters, and statistics.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseFitsHeaderText(context.documentText || "", context["documentUri"] as string | undefined);
        return fitsToJsonMetadata(doc);
      },
    },
    {
      id: "fits_to_ccsds",
      title: "Export FITS Observation to CCSDS Metadata",
      description: "Generates interoperable CCSDS KVN tracking metadata from FITS WCS keywords.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseFitsHeaderText(context.documentText || "", context["documentUri"] as string | undefined);
        return fitsToCcsdsMetadata(doc);
      },
    },
    {
      id: "fits_to_svg",
      title: "Render FITS Image & WCS Reticle to SVG",
      description: "Generates a deterministic SVG preview of FITS image data and WCS pointing reticle.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseFitsHeaderText(context.documentText || "", context["documentUri"] as string | undefined);
        return fitsToSvg(doc);
      },
    },
  ],
});
