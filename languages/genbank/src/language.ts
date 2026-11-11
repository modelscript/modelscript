// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerGenbankToDae } from "./dae/genbank-to-dae.js";
import { indexGenbankDocument } from "./indexing.js";
import { lintGenbank } from "./lints/index.js";
import { parseGenbank } from "./parser/genbank-parser.js";
import { genbankToModelica, genbankToSbolXml } from "./projections/genbank-projections.js";
import { analyzeGenbankSequence } from "./solvers/sequence-solver.js";
import type { SequenceAnalysisOptions } from "./types.js";

/**
 * ModelScript GenBank & FASTA (.gb, .gbk, .fasta, .fa) Language Definition.
 */
export const genbankLanguage = language({
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
});
