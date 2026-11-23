// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Formal DSL Language & Grammar Definition.
 *
 * Declarative Sandia MELCOR 2.x severe-accident input deck grammar defined via
 * `@modelscript/dsl` combinators, compiled into native WebAssembly GLR parse tables.
 */

import {
  choice,
  field,
  language,
  optional,
  repeat,
  semanticToken,
  seq,
  type ActionExecutionContext,
} from "@modelscript/dsl";

export const melcorLanguage = language({
  name: "melcor",
  fileExtensions: [".mel", ".melcor", ".mci", ".inp"],
  maturity: "beta",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t]+/, $.CommentLine],
  lsp: {
    fileExtensions: [".mel", ".melcor", ".mci", ".inp"],
    folding: [
      "PackageHeader",
      "CvhRecord",
      "FlRecord",
      "HsRecord",
      "CorRecord",
      "Rn1Record",
      "CfRecord",
      "TfRecord",
      "MpRecord",
      "NcgRecord",
    ],
    outline: [
      "PhaseHeader",
      "TitleRecord",
      "PackageHeader",
      "CvhRecord",
      "FlRecord",
      "HsRecord",
      "CorRecord",
      "Rn1Record",
      "CfRecord",
      "TfRecord",
      "MpRecord",
      "NcgRecord",
    ],
  },
  rules: {
    Deck: ($) => seq(repeat(choice(seq($.Statement, $.Newline), $.Newline)), optional($.Statement)),

    Statement: ($) =>
      choice(
        $.PhaseHeader,
        $.TitleRecord,
        $.PackageHeader,
        $.EndDirective,
        $.ExecRecord,
        $.CvhRecord,
        $.FlRecord,
        $.HsRecord,
        $.CorRecord,
        $.Rn1Record,
        $.CfRecord,
        $.TfRecord,
        $.MpRecord,
        $.NcgRecord,
        $.GenericRecord,
      ),

    PhaseHeader: ($) => field("phase", semanticToken("keyword", $.PhaseKw)),

    TitleRecord: ($) => seq(semanticToken("keyword", $.TitleKw), repeat(field("arg", $.RecordArg))),

    PackageHeader: ($) => field("package", semanticToken("namespace", $.PackageKw)),

    EndDirective: ($) => semanticToken("keyword", $.EndKw),

    ExecRecord: ($) => seq(field("keyword", semanticToken("keyword", $.ExecKw)), repeat(field("arg", $.RecordArg))),

    CvhRecord: ($) => seq(field("keyword", semanticToken("type", $.CvhKw)), repeat(field("arg", $.RecordArg))),

    FlRecord: ($) => seq(field("keyword", semanticToken("type", $.FlKw)), repeat(field("arg", $.RecordArg))),

    HsRecord: ($) => seq(field("keyword", semanticToken("type", $.HsKw)), repeat(field("arg", $.RecordArg))),

    CorRecord: ($) => seq(field("keyword", semanticToken("type", $.CorKw)), repeat(field("arg", $.RecordArg))),

    Rn1Record: ($) => seq(field("keyword", semanticToken("type", $.Rn1Kw)), repeat(field("arg", $.RecordArg))),

    CfRecord: ($) => seq(field("keyword", semanticToken("function", $.CfKw)), repeat(field("arg", $.RecordArg))),

    TfRecord: ($) => seq(field("keyword", semanticToken("function", $.TfKw)), repeat(field("arg", $.RecordArg))),

    MpRecord: ($) => seq(field("keyword", semanticToken("property", $.MpKw)), repeat(field("arg", $.RecordArg))),

    NcgRecord: ($) => seq(field("keyword", semanticToken("property", $.NcgKw)), repeat(field("arg", $.RecordArg))),

    GenericRecord: ($) => seq(field("keyword", $.Identifier), repeat(field("arg", $.RecordArg))),

    RecordArg: ($) => choice($.NumberLiteral, $.StringLiteral, $.Identifier, $.Punctuation),

    PhaseKw: () => choice("MELGEN_INPUT", "MELCOR_INPUT", "melgen_input", "melcor_input"),
    TitleKw: () => choice("TITLE", "title"),
    PackageKw: () =>
      choice(
        "EXEC_INPUT",
        "CVH_INPUT",
        "FL_INPUT",
        "HS_INPUT",
        "COR_INPUT",
        "RN1_INPUT",
        "CF_INPUT",
        "TF_INPUT",
        "MP_INPUT",
        "NCG_INPUT",
        "exec_input",
        "cvh_input",
        "fl_input",
        "hs_input",
        "cor_input",
        "rn1_input",
        "cf_input",
        "tf_input",
        "mp_input",
        "ncg_input",
      ),
    EndKw: () => choice("END", "end", "."),

    ExecKw: () =>
      choice(
        "EXEC_TEND",
        "EXEC_TSTART",
        "EXEC_DTMAX",
        "EXEC_DTMIN",
        "EXEC_DT",
        "EXEC_TIME",
        "EXEC_CPULIM",
        "EXEC_TITLE",
      ),
    CvhKw: () => choice("CV_ID", "CV_THR", "CV_PAS", "CV_TY", "CV_ALT", "CV_VAT", "CV_VEL", "CV_NCG"),
    FlKw: () => choice("FL_ID", "FL_FT", "FL_GEO", "FL_USL", "FL_SEG", "FL_VLV", "FL_IC"),
    HsKw: () => choice("HS_ID", "HS_GD", "HS_ND", "HS_LB", "HS_RB", "HS_SRC", "HS_TEMP", "HS_MAT"),
    CorKw: () => choice("COR_RP", "COR_ZDF", "COR_ZP", "COR_MAT", "COR_PWR", "COR_OX", "COR_LH", "COR_CELL"),
    Rn1Kw: () => choice("RN1_CLS", "RN1_DIM", "RN1_FLT", "RN1_REL", "RN1_MS"),
    CfKw: () => choice("CF_ID", "CF_SAI", "CF_ARG", "CF_LIM"),
    TfKw: () => choice("TF_ID", "TF_TAB", "TF_BND", "TF_SA"),
    MpKw: () => choice("MP_ID", "MP_MAT", "MP_PROP", "MP_TAB"),
    NcgKw: () => choice("NCG_ID", "NCG_GAS"),

    Punctuation: () => choice(",", "=", "(", ")", "/"),
    CommentLine: () => /![^\r\n]*/,
    Newline: () => /\r?\n/,
    NumberLiteral: () => /[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eEdD][-+]?[0-9]+)?/,
    StringLiteral: () => /'[^'\r\n]*'|"[^"\r\n]*"/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.:-]*/,
  },
  actions: [
    {
      id: "lint_melcor",
      title: "Lint MELCOR Deck",
      description: "Validates MELCOR control volumes, flow paths, heat structures, core, and control functions.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const { parseMelcor } = await import("./parser/melcor-parser.js");
        const { lintMelcor } = await import("./lints/index.js");
        return lintMelcor(parseMelcor(text));
      },
    },
    {
      id: "melcor_to_dae",
      title: "Lower MELCOR to DAE",
      description: "Compiles CVH, FL, HS, and COR equations directly into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const { parseMelcor } = await import("./parser/melcor-parser.js");
        const { lowerMelcorToDae } = await import("./dae/melcor-to-dae.js");
        const deck = parseMelcor(text);
        const dae = lowerMelcorToDae(deck);
        return {
          modelName: deck.title || "MelcorPlant",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "melcor_solve",
      title: "Run MELCOR Severe Accident Transient",
      description: "Solves coupled CVH blowdown, COR decay-heat heatup, and Zircaloy-steam oxidation.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const { parseMelcor } = await import("./parser/melcor-parser.js");
        const { solveMelcorTransient } = await import("./solver/melcor-solver.js");
        return solveMelcorTransient(parseMelcor(text));
      },
    },
    {
      id: "melcor_to_modelica",
      title: "Project MELCOR to Modelica",
      description: "Exports MELCOR severe-accident deck to Modelica 3.x source.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const { parseMelcor } = await import("./parser/melcor-parser.js");
        const { melcorToModelica } = await import("./projections/melcor-to-modelica.js");
        return melcorToModelica(parseMelcor(text), params?.modelName);
      },
    },
  ],
});

export default melcorLanguage;
