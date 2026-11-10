// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Molecular Biology & Sequence Analysis (GenBank).
 *
 * Evaluates:
 * 1. NCBI GenBank flat-file parsing of synthetic expression plasmid (pGFP_Mini, 90 bp circular ds-DNA)
 * 2. Feature annotations (rep_origin, promoter, RBS, CDS, terminator)
 * 3. 6-frame ORF discovery, CAI evaluation, and restriction endonuclease mapping (EcoRI, BamHI, HindIII, XbaI)
 * 4. Central dogma transcription/translation ODE lowering into square DAEBuilder arena
 */

import assert from "node:assert/strict";
import {
  parseGenbank,
  analyzeGenbankSequence,
  lowerGenbankToDae,
  type GenbankDocument,
} from "../src/index.js";

export const PGFP_MINI_GENBANK_BENCHMARK = `LOCUS       pGFP_Mini                 90 bp    ds-DNA  circular SYN 04-NOV-2026
DEFINITION  Synthetic mini-GFP expression plasmid with BioBrick sites.
ACCESSION   pGFP_Mini
VERSION     pGFP_Mini.1
KEYWORDS    synthetic biology; plasmid; GFP.
SOURCE      synthetic DNA construct
  ORGANISM  Escherichia coli
FEATURES             Location/Qualifiers
     rep_origin      1..6
                     /label="pMB1_ori"
     promoter        7..14
                     /label="pLac"
     RBS             15..24
                     /label="B0034"
     CDS             25..72
                     /gene="gfp_mini"
                     /product="Mini green fluorescent protein"
                     /codon_start=1
                     /translation="MSKGEELFTGVVPIL"
     terminator      73..90
                     /label="B0015"
ORIGIN
        1 gaattcttga caaagaggag aaatatgtct aaaggtgaag aactgttcac cggtgttgtt
       61 ccgatcctgt aaggatccaa gctttctaga
//`;

export interface GenbankBenchmarkMetrics {
  locus: string;
  lengthNt: number;
  topology: string;
  moleculeType: string;
  featuresCount: number;
  gcContent: number;
  meltingTemperatureC: number;
  orfsCount: number;
  caiGfp: number;
  restrictionCutsCount: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runGenbankBenchmark(gbStr = PGFP_MINI_GENBANK_BENCHMARK): GenbankBenchmarkMetrics {
  const doc: GenbankDocument = parseGenbank(gbStr, "pGFP_Mini.gb");
  assert.equal(doc.records.length, 1);
  const rec = doc.records[0]!;

  assert.equal(rec.locus, "pGFP_Mini");
  assert.equal(rec.sequence.length, 90);
  assert.equal(rec.topology, "circular");
  assert.equal(rec.features.length, 5);

  const res = analyzeGenbankSequence(doc, { minOrfLengthNt: 30 });
  assert.equal(res.length, 90);
  assert.ok(res.gcContent > 0.35 && res.gcContent < 0.55);
  assert.ok(res.meltingTemperatureC > 65.0 && res.meltingTemperatureC < 85.0);
  assert.ok(res.orfs.length >= 1);
  assert.equal(res.combinedDigestFragmentSizes.length, 4);

  const cai = res.caiByFeature["gfp_mini"] ?? 0;
  assert.ok(cai > 0.85);

  // Lower into linear memory DAEBuilder arena
  const dae = lowerGenbankToDae(doc, { modelName: "pGFP_Mini_DAE" });
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  // 1 shared copy_number + 6 variables for gfp_mini CDS (mRNA, Protein, k_tx, k_tl, gamma_m, gamma_p) = 7 vars & 7 eqs
  assert.equal(varCount, 7);
  assert.equal(eqCount, 7);
  assert.equal(varCount, eqCount);

  return {
    locus: rec.locus,
    lengthNt: rec.sequence.length,
    topology: rec.topology,
    moleculeType: rec.moleculeType,
    featuresCount: rec.features.length,
    gcContent: res.gcContent,
    meltingTemperatureC: res.meltingTemperatureC,
    orfsCount: res.orfs.length,
    caiGfp: cai,
    restrictionCutsCount: res.combinedDigestFragmentSizes.length,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("genbank-benchmark-runner.ts")) {
  const m = runGenbankBenchmark();
  console.log("GenBank Benchmark Results:", m);
}
