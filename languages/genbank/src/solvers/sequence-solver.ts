// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/genbank — Genomic Sequence, 6-Frame ORF, Restriction Digest & CAI Solver.
 *
 * Computes:
 * 1. Nucleotide composition, GC/AT content, melting temperature (Tm), and dsDNA/ssDNA molecular weight
 * 2. 6-frame Open Reading Frame (ORF) discovery across sense (+1, +2, +3) and antisense (-1, -2, -3) strands
 * 3. Restriction endonuclease cleavage mapping and linear/circular fragment size distributions
 *    for EcoRI, BamHI, HindIII, XbaI, SpeI, PstI, NotI, and BsaI
 * 4. Sharp & Li (1987) Codon Adaptation Index (CAI) against E. coli highly expressed genes
 */

import {
  VALID_START_CODONS,
  VALID_STOP_CODONS,
  extractFeatureSequence,
  getFeatureDisplayName,
  normalizeRnaToDna,
  reverseComplement,
  translateCodingSequence,
} from "../lints/genbank-linter.js";
import type {
  GenbankDocument,
  GenbankRecord,
  GenbankTopology,
  OrfPrediction,
  RestrictionCutSite,
  SequenceAnalysisOptions,
  SequenceAnalysisResult,
} from "../types.js";

export interface RestrictionEnzymeDefinition {
  name: string;
  recognitionSite: string;
  cutOffsetSense: number;
  overhang: "5'-overhang" | "3'-overhang" | "blunt";
  isPalindromic: boolean;
}

export const RESTRICTION_ENZYMES: Record<string, RestrictionEnzymeDefinition> = {
  EcoRI: {
    name: "EcoRI",
    recognitionSite: "GAATTC",
    cutOffsetSense: 1,
    overhang: "5'-overhang",
    isPalindromic: true,
  },
  BamHI: {
    name: "BamHI",
    recognitionSite: "GGATCC",
    cutOffsetSense: 1,
    overhang: "5'-overhang",
    isPalindromic: true,
  },
  HindIII: {
    name: "HindIII",
    recognitionSite: "AAGCTT",
    cutOffsetSense: 1,
    overhang: "5'-overhang",
    isPalindromic: true,
  },
  XbaI: {
    name: "XbaI",
    recognitionSite: "TCTAGA",
    cutOffsetSense: 1,
    overhang: "5'-overhang",
    isPalindromic: true,
  },
  SpeI: {
    name: "SpeI",
    recognitionSite: "ACTAGT",
    cutOffsetSense: 1,
    overhang: "5'-overhang",
    isPalindromic: true,
  },
  PstI: {
    name: "PstI",
    recognitionSite: "CTGCAG",
    cutOffsetSense: 5,
    overhang: "3'-overhang",
    isPalindromic: true,
  },
  NotI: {
    name: "NotI",
    recognitionSite: "GCGGCCGC",
    cutOffsetSense: 2,
    overhang: "5'-overhang",
    isPalindromic: true,
  },
  BsaI: {
    name: "BsaI",
    recognitionSite: "GGTCTC",
    cutOffsetSense: 7,
    overhang: "5'-overhang",
    isPalindromic: false,
  },
};

/**
 * Relative adaptiveness weights (w_ij) for E. coli highly expressed genes (Sharp & Li, 1987).
 */
export const E_COLI_CAI_WEIGHTS: Record<string, number> = {
  TTT: 0.296,
  TTC: 1.0,
  TTA: 0.02,
  TTG: 0.02,
  CTT: 0.042,
  CTC: 0.037,
  CTA: 0.007,
  CTG: 1.0,
  ATT: 0.185,
  ATC: 1.0,
  ATA: 0.003,
  ATG: 1.0,
  GTT: 1.0,
  GTC: 0.066,
  GTA: 0.495,
  GTG: 0.221,
  TCT: 0.849,
  TCC: 1.0,
  TCA: 0.048,
  TCG: 0.017,
  CCT: 0.07,
  CCC: 0.012,
  CCA: 0.135,
  CCG: 1.0,
  ACT: 0.965,
  ACC: 1.0,
  ACA: 0.076,
  ACG: 0.099,
  GCT: 1.0,
  GCC: 0.122,
  GCA: 0.586,
  GCG: 0.424,
  TAT: 0.239,
  TAC: 1.0,
  CAT: 0.291,
  CAC: 1.0,
  CAA: 0.124,
  CAG: 1.0,
  AAT: 0.051,
  AAC: 1.0,
  AAA: 1.0,
  AAG: 0.253,
  GAT: 0.434,
  GAC: 1.0,
  GAA: 1.0,
  GAG: 0.259,
  TGT: 0.5,
  TGC: 1.0,
  TGG: 1.0,
  CGT: 1.0,
  CGC: 0.356,
  CGA: 0.004,
  CGG: 0.004,
  AGT: 0.085,
  AGC: 0.41,
  AGA: 0.004,
  AGG: 0.002,
  GGT: 1.0,
  GGC: 0.724,
  GGA: 0.01,
  GGG: 0.019,
};

export function computeCodonAdaptationIndex(dnaSequence: string): number {
  const dna = normalizeRnaToDna(dnaSequence);
  let logSum = 0;
  let codonCount = 0;

  for (let i = 0; i + 3 <= dna.length; i += 3) {
    const codon = dna.slice(i, i + 3);
    if (VALID_STOP_CODONS.has(codon)) {
      continue;
    }
    const weight = E_COLI_CAI_WEIGHTS[codon];
    if (weight !== undefined && weight > 0) {
      logSum += Math.log(weight);
      codonCount++;
    }
  }

  if (codonCount === 0) return 0;
  return Number(Math.exp(logSum / codonCount).toFixed(6));
}

export function discoverOrfs(sequence: string, minOrfLengthNt = 30): OrfPrediction[] {
  const dna = normalizeRnaToDna(sequence);
  const seqLen = dna.length;
  if (seqLen < 6) return [];

  const revComp = reverseComplement(dna);
  const predictions: OrfPrediction[] = [];
  let orfCounter = 1;

  const scanStrand = (strandSeq: string, strand: 1 | -1, startCodonSet: ReadonlySet<string>): void => {
    for (let frameIdx = 0; frameIdx < 3; frameIdx++) {
      const frame = (strand === 1 ? frameIdx + 1 : -(frameIdx + 1)) as 1 | 2 | 3 | -1 | -2 | -3;
      let i = frameIdx;
      while (i + 3 <= seqLen) {
        const codon = strandSeq.slice(i, i + 3);
        if (startCodonSet.has(codon)) {
          let stopEnd = -1;
          let stopCodon = "";
          for (let j = i + 3; j + 3 <= seqLen; j += 3) {
            const c = strandSeq.slice(j, j + 3);
            if (VALID_STOP_CODONS.has(c)) {
              stopEnd = j + 3;
              stopCodon = c;
              break;
            }
          }
          if (stopEnd !== -1) {
            const lengthNt = stopEnd - i;
            if (lengthNt >= minOrfLengthNt) {
              const orfNt = strandSeq.slice(i, stopEnd);
              const proteinSequence = translateCodingSequence(orfNt, true, false);
              const cai = computeCodonAdaptationIndex(orfNt);
              const start = strand === 1 ? i + 1 : seqLen - stopEnd + 1;
              const end = strand === 1 ? stopEnd : seqLen - i;
              predictions.push({
                id: `ORF_${orfCounter++}`,
                frame,
                strand,
                start,
                end,
                lengthNt,
                lengthAa: proteinSequence.length,
                startCodon: codon,
                stopCodon,
                nucleotideSequence: orfNt,
                proteinSequence,
                cai,
              });
            }
            i = stopEnd;
            continue;
          }
        }
        i += 3;
      }
    }
  };

  const canonicalStart = new Set(["ATG"]);
  scanStrand(dna, 1, canonicalStart);
  scanStrand(revComp, -1, canonicalStart);

  if (predictions.length === 0) {
    scanStrand(dna, 1, VALID_START_CODONS);
    scanStrand(revComp, -1, VALID_START_CODONS);
  }

  return predictions.sort((a, b) => b.lengthNt - a.lengthNt || a.start - b.start);
}

export function findRestrictionCutSites(
  sequence: string,
  topology: GenbankTopology = "linear",
  enzymeNames?: string[],
): RestrictionCutSite[] {
  const dna = normalizeRnaToDna(sequence);
  const seqLen = dna.length;
  if (seqLen === 0) return [];

  const targetEnzymes = enzymeNames && enzymeNames.length > 0 ? enzymeNames : Object.keys(RESTRICTION_ENZYMES);
  const sites: RestrictionCutSite[] = [];

  for (const name of targetEnzymes) {
    const def = RESTRICTION_ENZYMES[name];
    if (!def) continue;

    const motif = def.recognitionSite;
    const motifLen = motif.length;
    if (seqLen < motifLen) continue;

    const searchSpace = topology === "circular" ? dna + dna.slice(0, motifLen - 1) : dna;
    const maxStartIdx = topology === "circular" ? seqLen : seqLen - motifLen + 1;

    for (let i = 0; i < maxStartIdx; i++) {
      if (searchSpace.slice(i, i + motifLen) === motif) {
        const position = i + 1;
        const rawCut = i + def.cutOffsetSense + 1;
        const cutPosition =
          topology === "circular" ? ((rawCut - 1) % seqLen) + 1 : Math.min(seqLen, Math.max(1, rawCut));
        sites.push({
          enzyme: def.name,
          recognitionSite: motif,
          position,
          cutPosition,
          strand: 1,
          overhang: def.overhang,
        });
      }
    }

    if (!def.isPalindromic) {
      const rcMotif = reverseComplement(motif);
      for (let i = 0; i < maxStartIdx; i++) {
        if (searchSpace.slice(i, i + motifLen) === rcMotif) {
          const position = i + 1;
          const rawCut = i - 1 + 1;
          const cutPosition =
            topology === "circular"
              ? ((((rawCut - 1) % seqLen) + seqLen) % seqLen) + 1
              : Math.min(seqLen, Math.max(1, rawCut));
          sites.push({
            enzyme: def.name,
            recognitionSite: motif,
            position,
            cutPosition,
            strand: -1,
            overhang: def.overhang,
          });
        }
      }
    }
  }

  return sites.sort((a, b) => a.position - b.position || a.enzyme.localeCompare(b.enzyme));
}

export function computeDigestFragmentSizes(
  seqLength: number,
  cutSites: RestrictionCutSite[],
  topology: GenbankTopology = "linear",
): number[] {
  if (seqLength <= 0) return [];
  if (cutSites.length === 0) return [seqLength];

  // Collect unique 0-based cleavage offsets in (0, seqLength)
  const uniqueOffsets = Array.from(
    new Set(cutSites.map((c) => c.cutPosition - 1).filter((offset) => offset >= 0 && offset < seqLength)),
  ).sort((a, b) => a - b);

  if (uniqueOffsets.length === 0) return [seqLength];

  if (topology === "circular") {
    if (uniqueOffsets.length === 1) {
      return [seqLength];
    }
    const fragments: number[] = [];
    for (let i = 0; i < uniqueOffsets.length - 1; i++) {
      fragments.push(uniqueOffsets[i + 1]! - uniqueOffsets[i]!);
    }
    const wrapFragment = seqLength - uniqueOffsets[uniqueOffsets.length - 1]! + uniqueOffsets[0]!;
    fragments.push(wrapFragment);
    return fragments.filter((f) => f > 0).sort((a, b) => b - a);
  }

  // Linear topology
  const fragments: number[] = [];
  let prev = 0;
  for (const cutOffset of uniqueOffsets) {
    if (cutOffset > prev) {
      fragments.push(cutOffset - prev);
      prev = cutOffset;
    }
  }
  if (seqLength > prev) {
    fragments.push(seqLength - prev);
  }
  return fragments.sort((a, b) => b - a);
}

export function analyzeGenbankSequence(
  input: GenbankDocument | GenbankRecord,
  options?: SequenceAnalysisOptions,
): SequenceAnalysisResult {
  const record: GenbankRecord | undefined = "records" in input ? input.records[options?.recordIndex ?? 0] : input;

  if (!record) {
    return {
      locus: "Empty",
      length: 0,
      topology: "linear",
      gcContent: 0,
      gcPercent: 0,
      atContent: 0,
      meltingTemperatureC: 0,
      molecularWeightDsDnaDa: 0,
      molecularWeightSsDnaDa: 0,
      baseCounts: { A: 0, T: 0, G: 0, C: 0, U: 0, N: 0, other: 0 },
      orfs: [],
      restrictionSites: [],
      digestFragments: {},
      combinedDigestFragmentSizes: [],
      caiByFeature: {},
      meanCai: 0,
    };
  }

  const seq = record.sequence.toUpperCase();
  const len = seq.length;
  const baseCounts = { A: 0, T: 0, G: 0, C: 0, U: 0, N: 0, other: 0 };

  for (let i = 0; i < len; i++) {
    const ch = seq[i];
    if (ch === "A") baseCounts.A++;
    else if (ch === "T") baseCounts.T++;
    else if (ch === "G") baseCounts.G++;
    else if (ch === "C") baseCounts.C++;
    else if (ch === "U") baseCounts.U++;
    else if (ch === "N") baseCounts.N++;
    else baseCounts.other++;
  }

  const gcBases = baseCounts.G + baseCounts.C;
  const atBases = baseCounts.A + baseCounts.T + baseCounts.U;
  const standardBases = gcBases + atBases;

  const gcContent = standardBases > 0 ? gcBases / standardBases : 0;
  const gcPercent = Number((gcContent * 100).toFixed(4));
  const atContent = standardBases > 0 ? atBases / standardBases : 0;

  let meltingTemperatureC = 0;
  if (standardBases > 0) {
    if (standardBases < 14) {
      meltingTemperatureC = 2 * atBases + 4 * gcBases;
    } else {
      meltingTemperatureC = 64.9 + (41.0 * (gcBases - 16.4)) / standardBases;
    }
  }
  meltingTemperatureC = Number(meltingTemperatureC.toFixed(2));

  const molecularWeightSsDnaDa =
    len > 0
      ? Number(
          (
            baseCounts.A * 313.21 +
            baseCounts.T * 304.2 +
            baseCounts.G * 329.21 +
            baseCounts.C * 289.18 +
            baseCounts.U * 290.16 +
            (baseCounts.N + baseCounts.other) * 308.95 +
            17.04
          ).toFixed(2),
        )
      : 0;

  const molecularWeightDsDnaDa =
    len > 0
      ? Number(
          (
            (baseCounts.A + baseCounts.T + baseCounts.U) * 617.41 +
            (baseCounts.G + baseCounts.C) * 618.39 +
            (baseCounts.N + baseCounts.other) * 617.9 +
            34.08
          ).toFixed(2),
        )
      : 0;

  const orfs = discoverOrfs(seq, options?.minOrfLengthNt ?? 30);
  const restrictionSites = findRestrictionCutSites(seq, record.topology, options?.enzymes);

  const enzymeList =
    options?.enzymes && options.enzymes.length > 0 ? options.enzymes : Object.keys(RESTRICTION_ENZYMES);
  const digestFragments: Record<string, number[]> = {};
  for (const enz of enzymeList) {
    const enzSites = restrictionSites.filter((s) => s.enzyme === enz);
    digestFragments[enz] = computeDigestFragmentSizes(len, enzSites, record.topology);
  }

  const combinedDigestFragmentSizes = computeDigestFragmentSizes(len, restrictionSites, record.topology);

  const caiByFeature: Record<string, number> = {};
  const caiValues: number[] = [];
  for (let i = 0; i < record.features.length; i++) {
    const feat = record.features[i]!;
    if (feat.key === "CDS") {
      const featName = getFeatureDisplayName(feat, i);
      const cdsSeq = extractFeatureSequence(record, feat);
      if (cdsSeq.length >= 6) {
        const cai = computeCodonAdaptationIndex(cdsSeq);
        caiByFeature[featName] = cai;
        caiValues.push(cai);
      }
    }
  }

  if (caiValues.length === 0 && orfs.length > 0) {
    for (const orf of orfs) {
      caiValues.push(orf.cai);
    }
  }

  const meanCai =
    caiValues.length > 0 ? Number((caiValues.reduce((acc, v) => acc + v, 0) / caiValues.length).toFixed(6)) : 0;

  return {
    locus: record.locus,
    length: len,
    topology: record.topology,
    gcContent: Number(gcContent.toFixed(6)),
    gcPercent,
    atContent: Number(atContent.toFixed(6)),
    meltingTemperatureC,
    molecularWeightDsDnaDa,
    molecularWeightSsDnaDa,
    baseCounts,
    orfs,
    restrictionSites,
    digestFragments,
    combinedDigestFragmentSizes,
    caiByFeature,
    meanCai,
  };
}
