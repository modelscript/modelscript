// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/genbank — Pre-flight Genomic Sequence, Feature & CDS Translation Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9351 - M9360) for GenBank (.gb, .gbk)
 * and FASTA (.fasta, .fa) documents with full NCBI Table 11 / Table 1 genetic code translation.
 */

import { type DiagnosticItem, GenbankErrorCode } from "../errors.js";
import type { GenbankDocument, GenbankFeature, GenbankRecord } from "../types.js";

export const VALID_IUPAC_NUCLEOTIDES = new Set([
  "A",
  "C",
  "G",
  "T",
  "U",
  "R",
  "Y",
  "S",
  "W",
  "K",
  "M",
  "D",
  "H",
  "V",
  "N",
]);

export const VALID_IUPAC_PROTEIN = new Set([
  "A",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "K",
  "L",
  "M",
  "N",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "V",
  "W",
  "Y",
  "*",
]);

export const VALID_START_CODONS = new Set(["ATG", "GTG", "TTG"]);
export const VALID_STOP_CODONS = new Set(["TAA", "TAG", "TGA"]);

/**
 * NCBI Genetic Code Table 11 (Bacterial, Archaeal and Plant Plastid) / Table 1 (Standard).
 */
export const NCBI_GENETIC_CODE_TABLE_11: Record<string, string> = {
  TTT: "F",
  TTC: "F",
  TTA: "L",
  TTG: "L",
  CTT: "L",
  CTC: "L",
  CTA: "L",
  CTG: "L",
  ATT: "I",
  ATC: "I",
  ATA: "I",
  ATG: "M",
  GTT: "V",
  GTC: "V",
  GTA: "V",
  GTG: "V",
  TCT: "S",
  TCC: "S",
  TCA: "S",
  TCG: "S",
  CCT: "P",
  CCC: "P",
  CCA: "P",
  CCG: "P",
  ACT: "T",
  ACC: "T",
  ACA: "T",
  ACG: "T",
  GCT: "A",
  GCC: "A",
  GCA: "A",
  GCG: "A",
  TAT: "Y",
  TAC: "Y",
  TAA: "*",
  TAG: "*",
  CAT: "H",
  CAC: "H",
  CAA: "Q",
  CAG: "Q",
  AAT: "N",
  AAC: "N",
  AAA: "K",
  AAG: "K",
  GAT: "D",
  GAC: "D",
  GAA: "E",
  GAG: "E",
  TGT: "C",
  TGC: "C",
  TGA: "*",
  TGG: "W",
  CGT: "R",
  CGC: "R",
  CGA: "R",
  CGG: "R",
  AGT: "S",
  AGC: "S",
  AGA: "R",
  AGG: "R",
  GGT: "G",
  GGC: "G",
  GGA: "G",
  GGG: "G",
};

const COMPLEMENT_MAP: Record<string, string> = {
  A: "T",
  T: "A",
  U: "A",
  G: "C",
  C: "G",
  R: "Y",
  Y: "R",
  S: "S",
  W: "W",
  K: "M",
  M: "K",
  B: "V",
  V: "B",
  D: "H",
  H: "D",
  N: "N",
};

export function reverseComplement(seq: string): string {
  const upper = seq.toUpperCase();
  let out = "";
  for (let i = upper.length - 1; i >= 0; i--) {
    const ch = upper[i] ?? "N";
    out += COMPLEMENT_MAP[ch] ?? ch;
  }
  return out;
}

export function normalizeRnaToDna(seq: string): string {
  let out = "";
  for (let i = 0; i < seq.length; i++) {
    const ch = (seq[i] ?? "").toUpperCase();
    out += ch === "U" ? "T" : ch;
  }
  return out;
}

export function translateCodingSequence(
  dnaSequence: string,
  useInitiatorMet = true,
  includeTerminalStop = false,
): string {
  const dna = normalizeRnaToDna(dnaSequence);
  let protein = "";
  for (let i = 0; i + 3 <= dna.length; i += 3) {
    const codon = dna.slice(i, i + 3);
    if (i === 0 && useInitiatorMet && VALID_START_CODONS.has(codon)) {
      protein += "M";
      continue;
    }
    const aa = NCBI_GENETIC_CODE_TABLE_11[codon] ?? "X";
    if (aa === "*" && i + 3 >= dna.length - 2 && !includeTerminalStop) {
      break;
    }
    protein += aa;
  }
  return protein;
}

export function getFeatureDisplayName(feat: GenbankFeature, index: number): string {
  return (
    feat.qualifiers["gene"] ??
    feat.qualifiers["locus_tag"] ??
    feat.qualifiers["label"] ??
    feat.qualifiers["product"] ??
    feat.qualifiers["note"] ??
    `${feat.key}_${index + 1}`
  );
}

export function extractFeatureSequence(record: GenbankRecord, feat: GenbankFeature): string {
  const seq = record.sequence;
  if (seq.length === 0) return "";

  let spliced = "";
  for (const span of feat.location.spans) {
    if (span.start < 1 || span.end < 1 || span.start > seq.length || span.end > seq.length) {
      return "";
    }
    if (span.start <= span.end) {
      spliced += seq.slice(span.start - 1, span.end);
    } else if (record.topology === "circular") {
      spliced += seq.slice(span.start - 1) + seq.slice(0, span.end);
    } else {
      return "";
    }
  }

  if (feat.location.isComplement) {
    spliced = reverseComplement(spliced);
  }

  const codonStartRaw = feat.qualifiers["codon_start"];
  if (codonStartRaw !== undefined) {
    const codonStart = Number(codonStartRaw);
    if (codonStart === 2 || codonStart === 3) {
      spliced = spliced.slice(codonStart - 1);
    }
  }

  return normalizeRnaToDna(spliced);
}

export function lintGenbank(doc: GenbankDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const seenLoci = new Set<string>();

  for (const record of doc.records) {
    // M9360: Duplicate LOCUS or FASTA identifier
    if (record.locus) {
      if (seenLoci.has(record.locus)) {
        diagnostics.push({
          code: GenbankErrorCode.DUPLICATE_LOCUS_IDENTIFIER.code,
          rule: GenbankErrorCode.DUPLICATE_LOCUS_IDENTIFIER.rule,
          severity: GenbankErrorCode.DUPLICATE_LOCUS_IDENTIFIER.severity,
          message: GenbankErrorCode.DUPLICATE_LOCUS_IDENTIFIER.message(record.locus),
          range: record.range,
        });
      } else {
        seenLoci.add(record.locus);
      }
    }

    const seq = record.sequence;

    // M9358: Empty GenBank ORIGIN sequence
    if (seq.length === 0) {
      diagnostics.push({
        code: GenbankErrorCode.EMPTY_GENBANK_ORIGIN.code,
        rule: GenbankErrorCode.EMPTY_GENBANK_ORIGIN.rule,
        severity: GenbankErrorCode.EMPTY_GENBANK_ORIGIN.severity,
        message: GenbankErrorCode.EMPTY_GENBANK_ORIGIN.message(record.locus),
        range: record.originRange ?? record.range,
      });
    }

    // M9351: Declared LOCUS length mismatch with ORIGIN sequence length
    if (
      doc.format === "genbank" &&
      record.declaredLength > 0 &&
      seq.length > 0 &&
      record.declaredLength !== seq.length
    ) {
      diagnostics.push({
        code: GenbankErrorCode.LOCUS_LENGTH_MISMATCH.code,
        rule: GenbankErrorCode.LOCUS_LENGTH_MISMATCH.rule,
        severity: GenbankErrorCode.LOCUS_LENGTH_MISMATCH.severity,
        message: GenbankErrorCode.LOCUS_LENGTH_MISMATCH.message(record.locus, record.declaredLength, seq.length),
        range: record.range,
      });
    }

    // M9352: Invalid sequence character in ORIGIN or FASTA sequence
    const alphabet = record.moleculeType.toUpperCase() === "PROTEIN" ? VALID_IUPAC_PROTEIN : VALID_IUPAC_NUCLEOTIDES;
    for (let i = 0; i < seq.length; i++) {
      const ch = (seq[i] ?? "").toUpperCase();
      if (!alphabet.has(ch)) {
        diagnostics.push({
          code: GenbankErrorCode.INVALID_SEQUENCE_CHARACTER.code,
          rule: GenbankErrorCode.INVALID_SEQUENCE_CHARACTER.rule,
          severity: GenbankErrorCode.INVALID_SEQUENCE_CHARACTER.severity,
          message: GenbankErrorCode.INVALID_SEQUENCE_CHARACTER.message(record.locus, ch, i + 1),
          range: record.originRange ?? record.range,
        });
        break;
      }
    }

    // Feature-level checks: M9353, M9354, M9355, M9356, M9357, M9359
    for (let fIdx = 0; fIdx < record.features.length; fIdx++) {
      const feat = record.features[fIdx]!;
      const featName = getFeatureDisplayName(feat, fIdx);
      let hasOutOfBounds = false;
      let hasInvertedSpan = false;

      for (const span of feat.location.spans) {
        // M9353: Feature location out of bounds (start < 1 or end > sequence.length)
        if (span.start < 1 || span.end < 1 || (seq.length > 0 && (span.start > seq.length || span.end > seq.length))) {
          hasOutOfBounds = true;
          diagnostics.push({
            code: GenbankErrorCode.FEATURE_LOCATION_OUT_OF_BOUNDS.code,
            rule: GenbankErrorCode.FEATURE_LOCATION_OUT_OF_BOUNDS.rule,
            severity: GenbankErrorCode.FEATURE_LOCATION_OUT_OF_BOUNDS.severity,
            message: GenbankErrorCode.FEATURE_LOCATION_OUT_OF_BOUNDS.message(
              featName,
              span.start,
              span.end,
              record.locus,
              seq.length,
            ),
            range: feat.range ?? record.range,
          });
          break;
        }

        // M9359: Inverted feature span on non-circular sequence (start > end)
        if (record.topology !== "circular" && span.start > span.end) {
          hasInvertedSpan = true;
          diagnostics.push({
            code: GenbankErrorCode.INVERTED_FEATURE_SPAN.code,
            rule: GenbankErrorCode.INVERTED_FEATURE_SPAN.rule,
            severity: GenbankErrorCode.INVERTED_FEATURE_SPAN.severity,
            message: GenbankErrorCode.INVERTED_FEATURE_SPAN.message(featName, span.start, span.end, record.locus),
            range: feat.range ?? record.range,
          });
          break;
        }
      }

      if (hasOutOfBounds || hasInvertedSpan || feat.key !== "CDS" || seq.length === 0) {
        continue;
      }

      const cdsSeq = extractFeatureSequence(record, feat);
      if (cdsSeq.length < 3) {
        continue;
      }

      // M9354: CDS missing valid start codon (ATG, GTG, TTG)
      const startCodon = cdsSeq.slice(0, 3);
      if (!feat.location.spans[0]?.partialStart && !VALID_START_CODONS.has(startCodon)) {
        diagnostics.push({
          code: GenbankErrorCode.CDS_MISSING_START_CODON.code,
          rule: GenbankErrorCode.CDS_MISSING_START_CODON.rule,
          severity: GenbankErrorCode.CDS_MISSING_START_CODON.severity,
          message: GenbankErrorCode.CDS_MISSING_START_CODON.message(featName, startCodon),
          range: feat.range ?? record.range,
        });
      }

      // M9355: CDS missing valid terminal stop codon (TAA, TAG, TGA)
      const lastSpan = feat.location.spans[feat.location.spans.length - 1];
      const stopCodon = cdsSeq.slice(cdsSeq.length - 3);
      if (!lastSpan?.partialEnd && !VALID_STOP_CODONS.has(stopCodon)) {
        diagnostics.push({
          code: GenbankErrorCode.CDS_MISSING_STOP_CODON.code,
          rule: GenbankErrorCode.CDS_MISSING_STOP_CODON.rule,
          severity: GenbankErrorCode.CDS_MISSING_STOP_CODON.severity,
          message: GenbankErrorCode.CDS_MISSING_STOP_CODON.message(featName, stopCodon),
          range: feat.range ?? record.range,
        });
      }

      // M9356: CDS internal premature stop codon before terminal codon
      for (let offset = 0; offset + 3 <= cdsSeq.length - 3; offset += 3) {
        const codon = cdsSeq.slice(offset, offset + 3);
        if (VALID_STOP_CODONS.has(codon)) {
          const codonIndex = offset / 3 + 1;
          diagnostics.push({
            code: GenbankErrorCode.CDS_INTERNAL_PREMATURE_STOP.code,
            rule: GenbankErrorCode.CDS_INTERNAL_PREMATURE_STOP.rule,
            severity: GenbankErrorCode.CDS_INTERNAL_PREMATURE_STOP.severity,
            message: GenbankErrorCode.CDS_INTERNAL_PREMATURE_STOP.message(featName, codon, codonIndex),
            range: feat.range ?? record.range,
          });
          break;
        }
      }

      // M9357: CDS /translation qualifier mismatch
      const declaredTranslationRaw = feat.qualifiers["translation"];
      if (declaredTranslationRaw !== undefined && declaredTranslationRaw.length > 0) {
        const declared = declaredTranslationRaw.endsWith("*")
          ? declaredTranslationRaw.slice(0, declaredTranslationRaw.length - 1)
          : declaredTranslationRaw;
        const expectedWithInitMet = translateCodingSequence(cdsSeq, true, false);
        const expectedLiteral = translateCodingSequence(cdsSeq, false, false);
        if (declared !== expectedWithInitMet && declared !== expectedLiteral) {
          diagnostics.push({
            code: GenbankErrorCode.CDS_TRANSLATION_MISMATCH.code,
            rule: GenbankErrorCode.CDS_TRANSLATION_MISMATCH.rule,
            severity: GenbankErrorCode.CDS_TRANSLATION_MISMATCH.severity,
            message: GenbankErrorCode.CDS_TRANSLATION_MISMATCH.message(featName, expectedWithInitMet, declared),
            range: feat.range ?? record.range,
          });
        }
      }
    }
  }

  return diagnostics;
}
