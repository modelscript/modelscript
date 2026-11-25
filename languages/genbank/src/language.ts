// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, optional, repeat, repeat1, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerGenbankToDae } from "./dae/genbank-to-dae.js";
import { indexGenbankDocument } from "./indexing.js";
import { lintGenbank } from "./lints/index.js";
import { parseGenbank } from "./parser/genbank-parser.js";
import { genbankToModelica, genbankToSbolXml } from "./projections/genbank-projections.js";
import { analyzeGenbankSequence } from "./solvers/sequence-solver.js";
import { genbankPolyglotConfig } from "./tgg/index.js";
import type { SequenceAnalysisOptions } from "./types.js";

/**
 * ModelScript GenBank & FASTA (.gb, .gbk, .fasta, .fa) Language Definition.
 */
export const genbankLanguage = language({
  polyglot: genbankPolyglotConfig,
  name: "genbank",
  fileExtensions: [".gb", ".gbk", ".fasta", ".fa"],
  maturity: "experimental",
  indexing: {
    indexFile: indexGenbankDocument,
  },
  lsp: {
    fileExtensions: [".gb", ".gbk", ".fasta", ".fa"],
    icons: {
      light: "./assets/genbank/icon-light.png",
      dark: "./assets/genbank/icon-dark.png",
    },
  },

  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      return {
        startOffset: entry.startOffset,
        endOffset: entry.endOffset,
        newText: newValue.trim(),
      };
    }
    return null;
  },

  ui: {
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "genbankAnalyze",
        label: "Analyze Sequence, 6-Frame ORFs, Restriction Digest & CAI",
        shortLabel: "Analyze",
        tooltip: "Analyze Sequence, 6-Frame ORFs, Restriction Digest & CAI",
        icon: "search",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "genbank_analyze",
      },
      {
        id: "genbankToDae",
        label: "Lower GenBank Plasmid to DAE",
        shortLabel: "Lower GenBank",
        tooltip: "Lower GenBank Plasmid to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "genbank_to_dae",
      },
      {
        id: "genbankToModelica",
        label: "Project GenBank to Modelica",
        shortLabel: "Project GenBank",
        tooltip: "Project GenBank to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "genbank_to_modelica",
      },
      {
        id: "genbankToSbol",
        label: "Project GenBank to SBOL3 RDF/XML",
        shortLabel: "Project GenBank",
        tooltip: "Project GenBank to SBOL3 RDF/XML",
        icon: "export",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "genbank_to_sbol",
      },
      {
        id: "lintGenbank",
        label: "Lint GenBank / FASTA Sequence",
        shortLabel: "Lint GenBank",
        tooltip: "Lint GenBank / FASTA Sequence",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "lint_genbank",
      },
    ],
  },
  actions: [
    {
      id: "lint_genbank",
      title: "Lint GenBank / FASTA Sequence",
      description:
        "Validates LOCUS length, IUPAC alphabet, feature bounds, CDS start/stop codons, premature stops, and NCBI Table 11 translations.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "genbank_lint",
          displayName: "Lint GenBank / FASTA Sequence",
          modelDescription:
            "Lints GenBank (.gb, .gbk) or FASTA (.fasta, .fa) file for sequence, feature, and CDS translation errors (M9351-M9360).",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseGenbank(text);
        return lintGenbank(parsed);
      },
    },
    {
      id: "genbank_analyze",
      title: "Analyze Sequence, 6-Frame ORFs, Restriction Digest & CAI",
      description:
        "Computes GC content, melting temperature Tm, molecular weight, 6-frame ORFs, restriction digest fragments, and Codon Adaptation Index.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: {
          documentText?: string | undefined;
          options?: SequenceAnalysisOptions | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseGenbank(text);
        return analyzeGenbankSequence(doc, params?.options);
      },
    },
    {
      id: "genbank_to_dae",
      title: "Lower GenBank Plasmid to DAE",
      description:
        "Compiles annotated transcriptional units and CDS features into mRNA/protein expression ODEs in DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseGenbank(text);
        const dae = lowerGenbankToDae(parsed);
        return {
          modelName: parsed.records[0]?.locus ?? "GenbankPlasmid",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "genbank_to_modelica",
      title: "Project GenBank to Modelica",
      description: "Synthesizes standalone Modelica 3.x mRNA transcription and CAI-weighted translation ODE models.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseGenbank(text);
        return genbankToModelica(parsed, params?.modelName);
      },
    },
    {
      id: "genbank_to_sbol",
      title: "Project GenBank to SBOL3 RDF/XML",
      description:
        "Exports GenBank plasmid sequence and annotated features to SBOL3 RDF/XML with Sequence Ontology roles.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; namespace?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseGenbank(text);
        return genbankToSbolXml(parsed, params?.namespace);
      },
    },
  ],
  word: ($) => $["Identifier"]!,
  extras: ($) => [/[ \t\r\n]+/, $["HashComment"]!],
  rules: {
    GenbankDocument: ($) => optional(choice(repeat1($["GenbankRecord"]!), $["FastaStream"]!)),

    GenbankRecord: ($) => seq("LOCUS", repeat1($["LineToken"]!), $["RecordEnd"]!),

    LineToken: ($) =>
      choice(
        $["Identifier"]!,
        $["NumberLiteral"]!,
        $["AlnumHyphen"]!,
        $["StringLiteral"]!,
        $["RangeDots"]!,
        $["FastaComment"]!,
        $["ParenGroup"]!,
        $["BracketGroup"]!,
        $["Punct"]!,
        "*",
        "-",
      ),

    ParenGroup: ($) => seq("(", repeat($["LineToken"]!), ")"),
    BracketGroup: ($) => seq("[", repeat($["LineToken"]!), "]"),

    FastaStream: ($) =>
      seq($["FastaHeader"]!, repeat(choice($["FastaHeader"]!, $["FastaComment"]!, $["Identifier"]!, "*", "-"))),

    RecordEnd: () => /\/\//,
    FastaHeader: () => />[^\r\n]*/,
    FastaComment: () => /;[^\r\n]*/,
    RangeDots: () => /\.\./,
    Punct: () => /[/:.,;=+<>^'~]/,
    AlnumHyphen: () => /[0-9]+[A-Za-z0-9_.'-]*[A-Za-z][A-Za-z0-9_.'-]*/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_'-]*/,
    NumberLiteral: () => /[0-9]+(?:\.[0-9]+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
    HashComment: () => /#[^\r\n]*/,
  },
});

export default genbankLanguage;
