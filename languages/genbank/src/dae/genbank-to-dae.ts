// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/genbank — Direct Linear-Memory DAE Arena Lowering for Plasmid & CDS Expression.
 *
 * Compiles annotated GenBank/FASTA transcriptional units and coding sequences (CDS) into
 * coupled mRNA transcription and CAI-weighted protein translation ODEs in ModelScript's
 * zero-GC WebAssembly DAEBuilder:
 *   1. State variables: mRNA_i, Protein_i
 *   2. Kinetic parameters: copy_number, k_tx_i, k_tl_i, gamma_m_i, gamma_p_i
 *   3. Differential equations:
 *        der(mRNA_i)    = k_tx_i * copy_number - gamma_m_i * mRNA_i
 *        der(Protein_i) = k_tl_i * mRNA_i - gamma_p_i * Protein_i
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { extractFeatureSequence, getFeatureDisplayName } from "../lints/genbank-linter.js";
import { computeCodonAdaptationIndex, discoverOrfs } from "../solvers/sequence-solver.js";
import type { GenbankDocument, GenbankRecord } from "../types.js";

export interface ExpressedGeneDescriptor {
  id: string;
  name: string;
  product: string;
  locus: string;
  start: number;
  end: number;
  strand: 1 | -1;
  cai: number;
  kTx: number;
  kTl: number;
  gammaM: number;
  gammaP: number;
  copyNumber: number;
}

export interface GenbankDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

function sanitizeIdentifier(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] ?? "";
    const code = ch.charCodeAt(0);
    const isAlphaNum =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === "_";
    out += isAlphaNum ? ch : "_";
  }
  if (out.length === 0) return "gene";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) {
    return `g_${out}`;
  }
  return out;
}

export function extractExpressedGenes(input: GenbankDocument | GenbankRecord): ExpressedGeneDescriptor[] {
  const records: GenbankRecord[] = "records" in input ? input.records : [input];
  const genes: ExpressedGeneDescriptor[] = [];
  const usedIds = new Set<string>();

  const makeUniqueId = (base: string): string => {
    const clean = sanitizeIdentifier(base);
    if (!usedIds.has(clean)) {
      usedIds.add(clean);
      return clean;
    }
    let idx = 2;
    while (usedIds.has(`${clean}_${idx}`)) {
      idx++;
    }
    const unique = `${clean}_${idx}`;
    usedIds.add(unique);
    return unique;
  };

  for (const record of records) {
    const hasRepOrigin = record.features.some((f) => f.key === "rep_origin");
    const copyNumber = hasRepOrigin || record.topology === "circular" ? 20.0 : 1.0;

    const promoters = record.features.filter((f) => f.key === "promoter");
    const rbsList = record.features.filter((f) => f.key === "RBS");
    const terminators = record.features.filter((f) => f.key === "terminator");
    const cdsFeatures = record.features.filter((f) => f.key === "CDS");

    if (cdsFeatures.length > 0) {
      for (let i = 0; i < cdsFeatures.length; i++) {
        const cds = cdsFeatures[i]!;
        const rawName = getFeatureDisplayName(cds, i);
        const id = makeUniqueId(rawName);
        const cdsSeq = extractFeatureSequence(record, cds);
        const cai = cdsSeq.length >= 6 ? computeCodonAdaptationIndex(cdsSeq) : 0.5;

        const hasUpstreamPromoter = promoters.some(
          (p) =>
            p.location.strand === cds.location.strand &&
            (cds.location.strand === 1 ? p.location.end <= cds.location.start : p.location.start >= cds.location.end),
        );
        const hasUpstreamRbs = rbsList.some(
          (r) =>
            r.location.strand === cds.location.strand &&
            (cds.location.strand === 1 ? r.location.end <= cds.location.start : r.location.start >= cds.location.end),
        );
        const hasDownstreamTerminator = terminators.some(
          (t) =>
            t.location.strand === cds.location.strand &&
            (cds.location.strand === 1 ? t.location.start >= cds.location.end : t.location.end <= cds.location.start),
        );

        const kTx = hasUpstreamPromoter ? 0.8 : 0.4;
        const kTl = Number(((hasUpstreamRbs ? 3.0 : 1.5) * Math.max(0.1, cai)).toFixed(4));
        const gammaM = hasDownstreamTerminator ? 0.15 : 0.25;
        const gammaP = 0.05;

        genes.push({
          id,
          name: rawName,
          product: cds.qualifiers["product"] ?? rawName,
          locus: record.locus,
          start: cds.location.start,
          end: cds.location.end,
          strand: cds.location.strand,
          cai,
          kTx,
          kTl,
          gammaM,
          gammaP,
          copyNumber,
        });
      }
    } else {
      const orfs = discoverOrfs(record.sequence, 24);
      if (orfs.length > 0) {
        for (const orf of orfs.slice(0, 5)) {
          const id = makeUniqueId(`${record.locus}_${orf.id}`);
          genes.push({
            id,
            name: orf.id,
            product: `Predicted ORF (${orf.lengthAa} aa)`,
            locus: record.locus,
            start: orf.start,
            end: orf.end,
            strand: orf.strand,
            cai: orf.cai,
            kTx: 0.4,
            kTl: Number((1.5 * Math.max(0.1, orf.cai)).toFixed(4)),
            gammaM: 0.25,
            gammaP: 0.05,
            copyNumber,
          });
        }
      } else {
        const id = makeUniqueId(record.locus);
        const cai = record.sequence.length >= 6 ? computeCodonAdaptationIndex(record.sequence) : 0.5;
        genes.push({
          id,
          name: record.locus,
          product: record.definition ?? record.locus,
          locus: record.locus,
          start: 1,
          end: Math.max(1, record.sequence.length),
          strand: 1,
          cai,
          kTx: 0.4,
          kTl: Number((1.5 * Math.max(0.1, cai)).toFixed(4)),
          gammaM: 0.25,
          gammaP: 0.05,
          copyNumber,
        });
      }
    }
  }

  return genes;
}

export function lowerGenbankToDae(input: GenbankDocument | GenbankRecord, options?: GenbankDaeOptions): DAEBuilder {
  const firstLocus = "records" in input ? (input.records[0]?.locus ?? "GenbankPlasmid") : input.locus;
  const modelName = sanitizeIdentifier(options?.modelName ?? firstLocus);
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const addSub = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Sub, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);

  const genes = extractExpressedGenes(input);
  const defaultCopyNumber = genes[0]?.copyNumber ?? 1.0;

  const copyNumVar = dae.addVariable(
    "copy_number",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    defaultCopyNumber,
  );
  dae.addEquation(EqKind.Simple, dae.addName(copyNumVar), dae.addRealLiteral(defaultCopyNumber));

  for (const g of genes) {
    const mRnaVar = dae.addVariable(`mRNA_${g.id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const proteinVar = dae.addVariable(`Protein_${g.id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const kTxVar = dae.addVariable(`k_tx_${g.id}`, VarType.Real, Variability.Parameter, Causality.Local, g.kTx);
    dae.addEquation(EqKind.Simple, dae.addName(kTxVar), dae.addRealLiteral(g.kTx));

    const kTlVar = dae.addVariable(`k_tl_${g.id}`, VarType.Real, Variability.Parameter, Causality.Local, g.kTl);
    dae.addEquation(EqKind.Simple, dae.addName(kTlVar), dae.addRealLiteral(g.kTl));

    const gammaMVar = dae.addVariable(
      `gamma_m_${g.id}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      g.gammaM,
    );
    dae.addEquation(EqKind.Simple, dae.addName(gammaMVar), dae.addRealLiteral(g.gammaM));

    const gammaPVar = dae.addVariable(
      `gamma_p_${g.id}`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      g.gammaP,
    );
    dae.addEquation(EqKind.Simple, dae.addName(gammaPVar), dae.addRealLiteral(g.gammaP));

    // der(mRNA_i) = k_tx_i * copy_number - gamma_m_i * mRNA_i
    const txTerm = addMul(dae.addName(kTxVar), dae.addName(copyNumVar));
    const mRnaDegTerm = addMul(dae.addName(gammaMVar), dae.addName(mRnaVar));
    dae.addEquation(EqKind.Simple, dae.addDer(mRnaVar), addSub(txTerm, mRnaDegTerm));

    // der(Protein_i) = k_tl_i * mRNA_i - gamma_p_i * Protein_i
    const tlTerm = addMul(dae.addName(kTlVar), dae.addName(mRnaVar));
    const protDegTerm = addMul(dae.addName(gammaPVar), dae.addName(proteinVar));
    dae.addEquation(EqKind.Simple, dae.addDer(proteinVar), addSub(tlTerm, protDegTerm));
  }

  return dae;
}
