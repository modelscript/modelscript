// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  GenbankErrorCode,
  GenbankWorkspaceIndex,
  analyzeGenbankSequence,
  computeCodonAdaptationIndex,
  discoverOrfs,
  executeGenbankAction,
  findRestrictionCutSites,
  genbankLanguage,
  genbankToModelica,
  genbankToSbolXml,
  getGenbankDocumentSymbols,
  getGenbankHover,
  lintGenbank,
  lowerGenbankToDae,
  parseFasta,
  parseGenbank,
  provideGenbankCompletions,
  reverseComplement,
  serializeFasta,
  serializeGenbank,
  translateCodingSequence,
  validateGenbank,
} from "../src/index.js";

// 25..72 is 48 bp = 16 codons (15 aa + TAA stop):
// ATG TCT AAA GGT GAA GAA CTG TTC ACC GGT GTT GTT CCG ATC CTG TAA -> MSKGEELFTGVVPIL*
const VALID_PLASMID_GB = `LOCUS       pGFP_Mini                 90 bp    ds-DNA  circular SYN 04-NOV-2026
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

const MULTI_RECORD_FASTA = `>rec_gfp Mini GFP coding sequence
ATGTCTAAAGGTGAAGAACTGTTCACCGGTGTTGTTCCGATCCTGTAA
>rec_luxR LuxR transcriptional activator fragment
ATGAAAGCAATTTTCGTACTGAAAGGTTGGTGGCGGTAA
`;

test("GenBank & FASTA Parser and Serializer: parses GenBank records, features, complement/join locations, and FASTA", () => {
  const doc = parseGenbank(VALID_PLASMID_GB, "pGFP_Mini.gb");
  assert.equal(doc.format, "genbank");
  assert.equal(doc.records.length, 1);

  const rec = doc.records[0]!;
  assert.equal(rec.locus, "pGFP_Mini");
  assert.equal(rec.declaredLength, 90);
  assert.equal(rec.sequence.length, 90);
  assert.equal(rec.moleculeType, "ds-DNA");
  assert.equal(rec.topology, "circular");
  assert.equal(rec.division, "SYN");
  assert.equal(rec.date, "04-NOV-2026");
  assert.equal(rec.accession, "pGFP_Mini");
  assert.equal(rec.version, "pGFP_Mini.1");
  assert.equal(rec.organism, "Escherichia coli");
  assert.equal(rec.features.length, 5);

  const cds = rec.features.find((f) => f.key === "CDS")!;
  assert.ok(cds);
  assert.equal(cds.location.start, 25);
  assert.equal(cds.location.end, 72);
  assert.equal(cds.location.strand, 1);
  assert.equal(cds.qualifiers["gene"], "gfp_mini");
  assert.equal(cds.qualifiers["translation"], "MSKGEELFTGVVPIL");

  // Roundtrip GenBank serialization
  const serializedGb = serializeGenbank(doc);
  assert.ok(serializedGb.includes("LOCUS       pGFP_Mini"));
  assert.ok(serializedGb.includes('/gene="gfp_mini"'));
  const reparsedGb = parseGenbank(serializedGb);
  assert.equal(reparsedGb.records.length, 1);
  assert.equal(reparsedGb.records[0]?.sequence, rec.sequence);
  assert.equal(reparsedGb.records[0]?.features.length, 5);

  // Parse & roundtrip multi-record FASTA
  const fastaDoc = parseFasta(MULTI_RECORD_FASTA, "reporters.fasta");
  assert.equal(fastaDoc.format, "fasta");
  assert.equal(fastaDoc.records.length, 2);
  assert.equal(fastaDoc.records[0]?.locus, "rec_gfp");
  assert.equal(fastaDoc.records[0]?.definition, "Mini GFP coding sequence");
  assert.equal(fastaDoc.records[0]?.sequence.length, 48);
  assert.equal(fastaDoc.records[1]?.locus, "rec_luxR");

  const serializedFa = serializeFasta(fastaDoc);
  const reparsedFa = parseGenbank(serializedFa);
  assert.equal(reparsedFa.format, "fasta");
  assert.equal(reparsedFa.records.length, 2);
  assert.equal(reparsedFa.records[0]?.sequence, fastaDoc.records[0]?.sequence);
});

test("GenBank Parser: supports complement(start..end) and join(...) spliced CDS features", () => {
  // Reverse complement of ATGGCCATTGTAATGGGCCGCTGGAAGGGTGCCCGATAG (39 bp)
  const senseCds = "ATGGCCATTGTAATGGGCCGCTGGAAGGGTGCCCGATAG";
  const revCompCds = reverseComplement(senseCds);
  assert.equal(revCompCds.length, 39);
  const expectedProtein = translateCodingSequence(senseCds, true, false);

  const gbComplement = `LOCUS       pCompTest                 39 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     CDS             complement(1..39)
                     /gene="tetR_rc"
                     /translation="${expectedProtein}"
ORIGIN
        1 ${revCompCds.toLowerCase()}
//`;
  const doc = parseGenbank(gbComplement);
  assert.equal(doc.records[0]?.features[0]?.location.isComplement, true);
  assert.equal(doc.records[0]?.features[0]?.location.strand, -1);
  assert.equal(lintGenbank(doc).length, 0);

  // Spliced join(1..18, 25..45) where 19..24 is a 6 bp intron (GTAAGT)
  const exon1 = senseCds.slice(0, 18);
  const intron = "GTAAGT";
  const exon2 = senseCds.slice(18);
  const joinedSeq = exon1 + intron + exon2;
  const gbJoin = `LOCUS       pJoinTest                 45 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     CDS             join(1..18,25..45)
                     /gene="spliced_cds"
                     /translation="${expectedProtein}"
ORIGIN
        1 ${joinedSeq.toLowerCase()}
//`;
  const joinDoc = parseGenbank(gbJoin);
  assert.equal(joinDoc.records[0]?.features[0]?.location.isJoin, true);
  assert.equal(joinDoc.records[0]?.features[0]?.location.spans.length, 2);
  assert.equal(lintGenbank(joinDoc).length, 0);
});

test("GenBank Linter: valid GenBank and FASTA documents produce zero diagnostics", () => {
  const doc = parseGenbank(VALID_PLASMID_GB);
  const diags = lintGenbank(doc);
  assert.equal(diags.length, 0, JSON.stringify(diags));

  const fastaDoc = parseFasta(MULTI_RECORD_FASTA);
  assert.equal(lintGenbank(fastaDoc).length, 0);
});

test("GenBank Linter M9351: detects LOCUS declared bp length mismatch with ORIGIN sequence", () => {
  const gb = `LOCUS       pMismatch                250 bp    DNA     linear   SYN 04-NOV-2026
ORIGIN
        1 atggccattg taatgggccg ctgaaagggt gcccgatag
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9351 = diags.find((d) => d.code === GenbankErrorCode.LOCUS_LENGTH_MISMATCH.code);
  assert.ok(m9351);
  assert.ok(m9351.message.includes("'pMismatch'"));
  assert.ok(m9351.message.includes("'250'"));
  assert.ok(m9351.message.includes("'39'"));
});

test("GenBank Linter M9352: detects non-IUPAC character in ORIGIN or FASTA sequence", () => {
  const gb = `LOCUS       pBadChar                  12 bp    DNA     linear   SYN 04-NOV-2026
ORIGIN
        1 atggcczttg ta
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9352 = diags.find((d) => d.code === GenbankErrorCode.INVALID_SEQUENCE_CHARACTER.code);
  assert.ok(m9352);
  assert.ok(m9352.message.includes("'pBadChar'"));
  assert.ok(m9352.message.includes("'Z'"));
  assert.ok(m9352.message.includes("'7'"));
});

test("GenBank Linter M9353: detects feature location out of bounds", () => {
  const gb = `LOCUS       pOob                      12 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     promoter        1..50
                     /label="prom_oob"
ORIGIN
        1 atggccattg ta
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9353 = diags.find((d) => d.code === GenbankErrorCode.FEATURE_LOCATION_OUT_OF_BOUNDS.code);
  assert.ok(m9353);
  assert.ok(m9353.message.includes("'prom_oob'"));
  assert.ok(m9353.message.includes("'[1..50]'"));
});

test("GenBank Linter M9354: detects CDS missing start codon (ATG/GTG/TTG)", () => {
  const gb = `LOCUS       pNoStart                  12 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     CDS             1..12
                     /gene="bad_start"
ORIGIN
        1 cccgccattg ta
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9354 = diags.find((d) => d.code === GenbankErrorCode.CDS_MISSING_START_CODON.code);
  assert.ok(m9354);
  assert.ok(m9354.message.includes("'bad_start'"));
  assert.ok(m9354.message.includes("'CCC'"));
});

test("GenBank Linter M9355: detects CDS missing terminal stop codon (TAA/TAG/TGA)", () => {
  const gb = `LOCUS       pNoStop                   12 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     CDS             1..12
                     /gene="bad_stop"
ORIGIN
        1 atggccattg gc
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9355 = diags.find((d) => d.code === GenbankErrorCode.CDS_MISSING_STOP_CODON.code);
  assert.ok(m9355);
  assert.ok(m9355.message.includes("'bad_stop'"));
  assert.ok(m9355.message.includes("'GGC'"));
});

test("GenBank Linter M9356: detects in-frame internal premature stop codon inside CDS", () => {
  // Codon 1: ATG, Codon 2: TAA (internal stop!), Codon 3: GCT, Codon 4: TGA (terminal stop)
  const gb = `LOCUS       pPremature                12 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     CDS             1..12
                     /gene="nonsense_mut"
ORIGIN
        1 atgtaagctt ga
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9356 = diags.find((d) => d.code === GenbankErrorCode.CDS_INTERNAL_PREMATURE_STOP.code);
  assert.ok(m9356);
  assert.ok(m9356.message.includes("'nonsense_mut'"));
  assert.ok(m9356.message.includes("'TAA'"));
  assert.ok(m9356.message.includes("'2'"));
});

test("GenBank Linter M9357: detects CDS /translation mismatch with NCBI Table 11 genetic code", () => {
  // ATG GCC ATT TAA translates to MAI
  const gb = `LOCUS       pBadTrans                 12 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     CDS             1..12
                     /gene="wrong_prot"
                     /translation="MKK"
ORIGIN
        1 atggccattt aa
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9357 = diags.find((d) => d.code === GenbankErrorCode.CDS_TRANSLATION_MISMATCH.code);
  assert.ok(m9357);
  assert.ok(m9357.message.includes("'wrong_prot'"));
  assert.ok(m9357.message.includes("'MAI'"));
  assert.ok(m9357.message.includes("'MKK'"));
});

test("GenBank Linter M9358: detects empty GenBank ORIGIN sequence", () => {
  const gb = `LOCUS       pEmpty                   100 bp    DNA     linear   SYN 04-NOV-2026
DEFINITION  Record with empty ORIGIN.
ORIGIN
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9358 = diags.find((d) => d.code === GenbankErrorCode.EMPTY_GENBANK_ORIGIN.code);
  assert.ok(m9358);
  assert.ok(m9358.message.includes("'pEmpty'"));
});

test("GenBank Linter M9359: detects inverted feature span (start > end) on non-circular sequence", () => {
  const gb = `LOCUS       pLinearInv                20 bp    DNA     linear   SYN 04-NOV-2026
FEATURES             Location/Qualifiers
     misc_feature    15..5
                     /label="inv_feat"
ORIGIN
        1 atggccattg taatgggccg
//`;
  const diags = lintGenbank(parseGenbank(gb));
  const m9359 = diags.find((d) => d.code === GenbankErrorCode.INVERTED_FEATURE_SPAN.code);
  assert.ok(m9359);
  assert.ok(m9359.message.includes("'inv_feat'"));
  assert.ok(m9359.message.includes("'[15..5]'"));
});

test("GenBank Linter M9360: detects duplicate LOCUS or FASTA identifiers", () => {
  const fasta = `>dup_seq First copy
ATGGCCATTTAA
>dup_seq Second copy
ATGAAAGCATAA
`;
  const diags = lintGenbank(parseFasta(fasta));
  const m9360 = diags.find((d) => d.code === GenbankErrorCode.DUPLICATE_LOCUS_IDENTIFIER.code);
  assert.ok(m9360);
  assert.ok(m9360.message.includes("'dup_seq'"));
});

test("Sequence Solver: computes GC content, melting temperature Tm, molecular weight, 6-frame ORFs, restriction digest, and CAI", () => {
  const doc = parseGenbank(VALID_PLASMID_GB);
  const res = analyzeGenbankSequence(doc, { minOrfLengthNt: 30 });

  assert.equal(res.locus, "pGFP_Mini");
  assert.equal(res.length, 90);
  assert.equal(res.topology, "circular");
  assert.ok(res.gcContent > 0.35 && res.gcContent < 0.55);
  assert.ok(res.meltingTemperatureC > 65 && res.meltingTemperatureC < 85);
  assert.ok(res.molecularWeightDsDnaDa > 50_000);
  assert.ok(res.molecularWeightSsDnaDa > 25_000);

  // 6-frame ORF discovery finds the 48 nt (15 aa) gfp_mini ORF
  assert.ok(res.orfs.length >= 1);
  const gfpOrf = res.orfs.find((o) => o.proteinSequence === "MSKGEELFTGVVPIL");
  assert.ok(gfpOrf);
  assert.equal(gfpOrf.start, 25);
  assert.equal(gfpOrf.end, 72);
  assert.equal(gfpOrf.lengthNt, 48);
  assert.equal(gfpOrf.lengthAa, 15);

  // Restriction sites in VALID_PLASMID_GB: EcoRI (GAATTC at 1), BamHI (GGATCC at 73), HindIII (AAGCTT at 79), XbaI (TCTAGA at 85)
  const enzymeNames = res.restrictionSites.map((s) => s.enzyme);
  assert.ok(enzymeNames.includes("EcoRI"));
  assert.ok(enzymeNames.includes("BamHI"));
  assert.ok(enzymeNames.includes("HindIII"));
  assert.ok(enzymeNames.includes("XbaI"));

  // Combined circular digest with 4 cuts produces 4 fragments whose sizes sum to 90 bp
  assert.equal(res.combinedDigestFragmentSizes.length, 4);
  const sumFragments = res.combinedDigestFragmentSizes.reduce((acc, v) => acc + v, 0);
  assert.equal(sumFragments, 90);

  // Also test SpeI, PstI, NotI, and BsaI recognition sites
  const polyLinker = "ACTAGTCTGCAGGCGGCCGCGGTCTCNNNNNGAGACC";
  const polySites = findRestrictionCutSites(polyLinker, "linear");
  const polyEnzymes = polySites.map((s) => s.enzyme);
  assert.ok(polyEnzymes.includes("SpeI"));
  assert.ok(polyEnzymes.includes("PstI"));
  assert.ok(polyEnzymes.includes("NotI"));
  assert.ok(polyEnzymes.includes("BsaI"));

  // CAI of gfp_mini (uses optimal E. coli codons TCT, AAA, GGT, GAA, CTG, TTC, ACC, GTT, CCG, ATC) should be high (> 0.85)
  const gfpCai = res.caiByFeature["gfp_mini"] ?? 0;
  assert.ok(gfpCai > 0.85, `Expected high CAI > 0.85 for codon-optimized GFP, got ${gfpCai}`);
  assert.ok(computeCodonAdaptationIndex("ATGTTATTATTGCTACTATAA") < 0.2);
  assert.ok(discoverOrfs(doc.records[0]!.sequence, 30).length >= 1);
});

test("GenBank DAE Lowering & Projections: compiles to DAEBuilder, Modelica 3.x, and SBOL3 RDF/XML", () => {
  const doc = parseGenbank(VALID_PLASMID_GB);
  const dae = lowerGenbankToDae(doc, { modelName: "pGFP_Mini_DAE" });

  // 1 shared copy_number parameter + 6 variables per expressed CDS (mRNA, Protein, k_tx, k_tl, gamma_m, gamma_p) = 7 variables & 7 equations
  assert.equal(dae.variables().length, 7);
  assert.equal(dae.equations().length, 7);

  const mo = genbankToModelica(doc, "pGFP_Mini_Model");
  assert.ok(mo.includes("model pGFP_Mini_Model"));
  assert.ok(mo.includes("der(mRNA_gfp_mini) = k_tx_gfp_mini * copy_number - gamma_m_gfp_mini * mRNA_gfp_mini;"));
  assert.ok(
    mo.includes("der(Protein_gfp_mini) = k_tl_gfp_mini * mRNA_gfp_mini - gamma_p_gfp_mini * Protein_gfp_mini;"),
  );
  assert.ok(mo.includes("end pGFP_Mini_Model;"));

  const sbolXml = genbankToSbolXml(doc);
  assert.ok(sbolXml.includes('<sbol:Sequence displayId="seq_pGFP_Mini" encoding="IUPAC_DNA">'));
  assert.ok(sbolXml.includes('<sbol:Component displayId="pGFP_Mini"'));
  assert.ok(sbolXml.includes('role="SO:0000167"'));
  assert.ok(sbolXml.includes('role="SO:0000139"'));
  assert.ok(sbolXml.includes('role="SO:0000316"'));
  assert.ok(sbolXml.includes('role="SO:0000141"'));
});

test("GenBank WorkspaceIndex & LSP: indexes symbols, validates, hovers, completes, and executes actions", async () => {
  const index = new GenbankWorkspaceIndex();
  const uri = "file:///workspace/pGFP_Mini.gb";
  index.register(uri);
  assert.equal(index.has(uri), true);

  index.indexFile(uri, VALID_PLASMID_GB);
  assert.equal(index.fileCount, 1);

  const symbols = index.getSymbols(uri);
  assert.ok(symbols.length >= 6);
  const gfpDef = index.findDefinition("gfp_mini");
  assert.ok(gfpDef);
  assert.equal(gfpDef.name, "gfp_mini");
  assert.equal(index.findReferences("gfp_mini").length, 1);

  const lspSyms = getGenbankDocumentSymbols(VALID_PLASMID_GB);
  assert.equal(lspSyms.length, 1);
  assert.equal(lspSyms[0]?.children?.[0]?.name, "pGFP_Mini");
  assert.equal(lspSyms[0]?.children?.[0]?.children?.length, 5);

  const locusHover = getGenbankHover(VALID_PLASMID_GB, { line: 0, character: 12 });
  assert.ok(locusHover);
  assert.ok(locusHover.contents.value.includes("GenBank Locus: **pGFP_Mini**"));

  const featHover = getGenbankHover(VALID_PLASMID_GB, { line: 15, character: 22 });
  assert.ok(featHover);
  assert.ok(featHover.contents.value.includes("GenBank Feature: **gfp_mini**"));

  const completions = provideGenbankCompletions(VALID_PLASMID_GB);
  assert.ok(completions.some((c) => c.label === "EcoRI"));
  assert.ok(completions.some((c) => c.label === "gfp_mini"));

  const diags = validateGenbank(VALID_PLASMID_GB);
  assert.equal(diags.length, 0);

  const daeInfo = await executeGenbankAction("genbank_to_dae", VALID_PLASMID_GB, {
    modelName: "pGFP_Mini",
  });
  assert.equal(daeInfo.variableCount, 7);
  assert.equal(daeInfo.equationCount, 7);

  const analysis = await executeGenbankAction("genbank_analyze", VALID_PLASMID_GB);
  assert.equal(analysis.length, 90);

  assert.equal(genbankLanguage.name, "genbank");
  assert.deepEqual(genbankLanguage.fileExtensions, [".gb", ".gbk", ".fasta", ".fa"]);
});
