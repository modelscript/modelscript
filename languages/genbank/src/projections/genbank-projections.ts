// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/genbank — Modelica 3.x and SBOL3 RDF/XML Projections for GenBank & FASTA Sequences.
 *
 * Translates GenBank/FASTA plasmid maps and annotated coding sequences into:
 * 1. Standalone Modelica 3.x transcriptional/translational ODE models (`genbankToModelica`)
 * 2. SBOL3 RDF/XML genetic components, sequences, and Sequence Ontology features (`genbankToSbolXml`)
 */

import { extractExpressedGenes } from "../dae/genbank-to-dae.js";
import { getFeatureDisplayName } from "../lints/genbank-linter.js";
import type { GenbankDocument, GenbankFeatureKey, GenbankRecord } from "../types.js";

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  if (cleaned.length === 0) return "GenbankModel";
  if (/^[0-9]/.test(cleaned)) return `M_${cleaned}`;
  return cleaned;
}

function escapeXml(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mapFeatureKeyToSequenceOntology(key: GenbankFeatureKey): string {
  switch (key.toLowerCase()) {
    case "promoter":
      return "SO:0000167";
    case "rbs":
    case "ribosome_binding_site":
      return "SO:0000139";
    case "cds":
      return "SO:0000316";
    case "terminator":
      return "SO:0000141";
    case "rep_origin":
      return "SO:0000296";
    case "operator":
    case "protein_bind":
      return "SO:0000057";
    case "gene":
      return "SO:0000704";
    case "mrna":
      return "SO:0000234";
    default:
      return "SO:0000110";
  }
}

export function genbankToModelica(input: GenbankDocument | GenbankRecord, modelName?: string): string {
  const firstLocus = "records" in input ? (input.records[0]?.locus ?? "GenbankPlasmid") : input.locus;
  const safeModelName = sanitizeId(modelName ?? firstLocus);
  const genes = extractExpressedGenes(input);
  const copyNumber = genes[0]?.copyNumber ?? 1.0;

  const lines: string[] = [];
  lines.push(`model ${safeModelName}`);
  lines.push(`  "GenBank Plasmid & CDS Expression Model (${genes.length} expressed genes)"`);
  lines.push(``);
  lines.push(`  // --- Global Plasmid Parameters ---`);
  lines.push(`  parameter Real copy_number = ${copyNumber} "Plasmid copy number per cell";`);
  lines.push(``);

  lines.push(`  // --- Gene-Specific Transcription & Translation Parameters ---`);
  for (const g of genes) {
    lines.push(`  parameter Real k_tx_${g.id} = ${g.kTx} "Transcription rate of ${g.name} [1/min]";`);
    lines.push(
      `  parameter Real k_tl_${g.id} = ${g.kTl} "CAI-weighted translation rate of ${g.name} (CAI=${g.cai}) [1/min]";`,
    );
    lines.push(`  parameter Real gamma_m_${g.id} = ${g.gammaM} "mRNA degradation rate of ${g.name} [1/min]";`);
    lines.push(
      `  parameter Real gamma_p_${g.id} = ${g.gammaP} "Protein degradation/dilution rate of ${g.name} [1/min]";`,
    );
  }
  lines.push(``);

  lines.push(`  // --- mRNA & Protein State Variables ---`);
  for (const g of genes) {
    lines.push(`  Real mRNA_${g.id}(start = 0.0) "mRNA concentration of ${g.name}";`);
    lines.push(`  Real Protein_${g.id}(start = 0.0) "Protein concentration of ${g.product}";`);
  }
  lines.push(``);

  lines.push(`equation`);
  for (const g of genes) {
    lines.push(`  der(mRNA_${g.id}) = k_tx_${g.id} * copy_number - gamma_m_${g.id} * mRNA_${g.id};`);
    lines.push(`  der(Protein_${g.id}) = k_tl_${g.id} * mRNA_${g.id} - gamma_p_${g.id} * Protein_${g.id};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

export function genbankToSbolXml(
  input: GenbankDocument | GenbankRecord,
  namespace = "http://modelscript.org/genbank#",
): string {
  const records: GenbankRecord[] = "records" in input ? input.records : [input];
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#" xml:base="${escapeXml(namespace)}">`,
  ];

  for (const rec of records) {
    const compId = sanitizeId(rec.locus);
    const seqId = `seq_${compId}`;
    const encoding = rec.moleculeType.toUpperCase() === "PROTEIN" ? "IUPAC_PROTEIN" : "IUPAC_DNA";

    lines.push(`  <sbol:Sequence displayId="${seqId}" encoding="${encoding}">`);
    lines.push(`    <sbol:elements>${escapeXml(rec.sequence)}</sbol:elements>`);
    lines.push(`  </sbol:Sequence>`);

    const compNameAttr = rec.definition ? ` name="${escapeXml(rec.definition)}"` : "";
    lines.push(`  <sbol:Component displayId="${compId}"${compNameAttr} role="SO:0000804" hasSequence="${seqId}">`);

    for (let i = 0; i < rec.features.length; i++) {
      const feat = rec.features[i]!;
      const rawFeatName = getFeatureDisplayName(feat, i);
      const featId = sanitizeId(`${rawFeatName}_${i + 1}`);
      const soRole = mapFeatureKeyToSequenceOntology(feat.key);
      const orientation = feat.location.isComplement ? "reverseComplement" : "inline";
      lines.push(
        `    <sbol:SequenceFeature displayId="${featId}" name="${escapeXml(rawFeatName)}" role="${soRole}" start="${feat.location.start}" end="${feat.location.end}" orientation="${orientation}"/>`,
      );
    }

    lines.push(`  </sbol:Component>`);
  }

  lines.push(`</rdf:RDF>`);
  return lines.join("\n");
}

export const genbankToSbol = genbankToSbolXml;
